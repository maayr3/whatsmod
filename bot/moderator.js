const LLMService = require('./llm');
const TranscriptionService = require('./transcription');
const YouTubeService = require('./youtube');

const VIDEO_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

class Moderator {
    constructor(db, messageQueue) {
        this.db = db;
        this.messageQueue = messageQueue;
        this.llm = new LLMService();
        this.transcription = new TranscriptionService();
    }

    async handleMessage(message, chat, logger) {
        const log = logger || require('./logger').system;
        let text = message.body || "";
        let imageData = null; // { mimeType, base64 } for new images to send to LLM

        // YouTube handling: Detect links and fetch metadata/thumbnail
        const videoId = YouTubeService.extractVideoId(text);
        if (videoId) {
            log.log(`[YouTube] Detected video ID: ${videoId}`);
            const metadata = await YouTubeService.getMetadata(text);
            if (metadata) {
                const metaStr = `[YouTube Content: "${metadata.title}" by ${metadata.author}]`;
                text = text ? `${text} ${metaStr}` : metaStr;
                log.log(`[YouTube] Fetched metadata: ${metaStr}`);
            }
            
            // Fetch thumbnail for visual context (thumbnail acts as the "nailclip" or "opening frame")
            const thumbnail = await YouTubeService.getThumbnailBase64(videoId);
            if (thumbnail) {
                imageData = thumbnail;
                log.log(`[YouTube] Fetched thumbnail for visual analysis.`);
            }

            // Fetch transcript for deeper content analysis
            const transcript = await YouTubeService.getTranscript(videoId);
            if (transcript) {
                text = `${text} [YouTube Transcript: "${transcript}"]`;
                log.log(`[YouTube] Fetched transcript (${transcript.length} chars).`);
            }
        }

        // Handle media messages
        if (message.hasMedia) {
            const mediaType = message.type; // 'image', 'video', 'audio', 'document', etc.

            if (mediaType === 'image') {
                try {
                    const media = await message.downloadMedia();
                    if (media && media.data) {
                        // media.data is already base64-encoded
                        imageData = { mimeType: media.mimetype, base64: media.data };
                        text = text ? `${text} [Image Attachment]` : `[Image Attachment]`;
                    } else {
                        text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
                    }
                } catch (e) {
                    log.warn(`[Media] Failed to download image: ${e.message}`);
                    text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
                }
            } else if (mediaType === 'video') {
                // Silently ignore videos larger than 10 MB
                const fileSizeBytes = message.filesize || 0;
                if (fileSizeBytes > VIDEO_SIZE_LIMIT_BYTES) {
                    log.log(`[Media] Ignoring video (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB > 10 MB limit)`);
                    return; // Silently drop, don't add to transcript or evaluate
                }
                text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
            } else if (mediaType === 'audio' || mediaType === 'ptt') {
                try {
                    const media = await message.downloadMedia();
                    if (media && media.data) {
                        const transcribedText = await this.transcription.transcribe(media.data, media.mimetype, log);
                        if (transcribedText) {
                            text = text ? `${text} [Audio Transcription: "${transcribedText}"]` : `[Audio Transcription: "${transcribedText}"]`;
                        } else {
                            text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
                        }
                    } else {
                        text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
                    }
                } catch (e) {
                    log.warn(`[Media] Failed to transcribe audio: ${e.message}`);
                    text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
                }
            } else {
                text = text ? `${text} [Sticker/Media: ${mediaType}]` : `[Sticker/Media: ${mediaType}]`;
            }
        }

        let sender = "";

        if (message.fromMe) {
            sender = "AI_Moderator";
        } else {
            try {
                const contact = await message.getContact();
                sender = contact.pushname || contact.number;
            } catch (e) {
                sender = "Unknown";
            }
        }

        // Handle quoted messages to provide context to the LLM
        if (message.hasQuotedMsg) {
            try {
                const quotedMsg = await message.getQuotedMessage();
                let quotedSender = "Unknown";
                if (quotedMsg.fromMe) {
                    quotedSender = "AI_Moderator";
                } else {
                    const quotedContact = await quotedMsg.getContact();
                    quotedSender = quotedContact.pushname || quotedContact.number;
                }
                const quotedBody = quotedMsg.body || "[Media]";
                text = `(Replying to ${quotedSender}: "${quotedBody}") ${text}`;
            } catch (e) {
                log.warn(`[Moderator] Failed to fetch quoted message: ${e.message}`);
            }
        }

        const chatId = chat.id._serialized;
        const messageId = message.id._serialized;

        if (text.toLowerCase() === '@bot stats' || text.toLowerCase() === 'stats') {
            const offenses = this.db.getOffenses(chat.name, sender);
            const total = offenses.length;
            if (total === 0) {
                await message.reply(`Hey ${sender}, you have a clean record — no offenses logged.`);
            } else {
                const now = Date.now();
                const inWindow = (ms) => offenses.filter(o => now - new Date(o.timestamp).getTime() < ms).length;
                const today = inWindow(86400000);
                const week = inWindow(7 * 86400000);

                let reply = `Hey ${sender}, you have ${total} offense(s) on record (${today} today, ${week} this week).`;
                if (total > 0) {
                    const recent = offenses.slice(-3).reverse();
                    reply += `\n\nRecent violations:\n` + recent.map(o => `- [${new Date(o.timestamp).toLocaleDateString()}] ${o.contentType}`).join('\n');
                }
                await message.reply(reply);
            }
            return;
        }

        // Process message through sliding window queue
        // imageData is only non-null for brand-new images not yet in history.
        // pendingImages are drained after each evaluation, so they won't be re-uploaded.
        this.messageQueue.addMessage(chatId, sender, text, messageId, imageData, message.fromMe, async (transcript, pendingImages) => {
            log.log(`Timer triggered: Evaluating ${transcript.length} messages` +
                (pendingImages.length ? ` (with ${pendingImages.length} new image(s))` : ''));

            const userStats = this.db.getAllUserStats(chat.name, 30);
            const result = await this.llm.evaluate(chat.name, transcript, pendingImages, userStats);

            if (result && result.error === 'QUOTA_EXHAUSTED') {
                // Gemini API resets at midnight Pacific Time
                const tz = 'America/Los_Angeles';
                const formatter = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit'
                });
                const currentDate = formatter.format(new Date());
                const lastQuotaDate = this.db.getSystemState('lastQuotaWarningDate');

                if (lastQuotaDate !== currentDate) {
                    try {
                        const messageText = `Moderator disabled for today due to API limits. Will resume tomorrow.`;
                        await chat.sendMessage(messageText);
                        this.db.setSystemState('lastQuotaWarningDate', currentDate);
                        log.log(`[Moderator] Sent quota exhaustion warning for ${currentDate}.`);
                    } catch (err) {
                        log.error("Failed to send quota warning:", err);
                    }
                } else {
                    log.log(`[Moderator] Quota exhausted, warning already sent for ${currentDate}.`);
                }
                return;
            }

            if (result && result.violation && result.target_user) {
                const userKey = result.target_user;
                const contentType = result.reason || 'unknown';

                // Log timestamped offense
                const offenses = this.db.addOffense(chat.name, userKey, contentType);

                // Build offense frequency context for the LLM reply (no hardcoded suffix)
                const now = Date.now();
                const inWindow = (ms) => offenses.filter(o => now - new Date(o.timestamp).getTime() < ms).length;
                const todayCount = inWindow(86400000);
                const weekCount = inWindow(7 * 86400000);
                const monthCount = inWindow(30 * 86400000);

                // Tally by content type this week
                const weekOffenses = offenses.filter(o => now - new Date(o.timestamp).getTime() < 7 * 86400000);
                const typeCounts = weekOffenses.reduce((acc, o) => {
                    acc[o.contentType] = (acc[o.contentType] || 0) + 1;
                    return acc;
                }, {});
                const typeBreakdown = Object.entries(typeCounts).map(([t, c]) => `${t}: ${c}`).join(', ');

                const offenseContext = `[Offense log for ${userKey}: ${offenses.length} total | today: ${todayCount}, this week: ${weekCount}, this month: ${monthCount}${typeBreakdown ? ` | breakdown this week: ${typeBreakdown}` : ''}]`;

                // The LLM reply_message already incorporates the offense context via rules.md guidance.
                // Inject the offense context as a system note before replying.
                this.messageQueue.addSystemMarker(chatId, offenseContext);

                const replyMsg = result.reply_message || `Warning: ${result.reason}.`;

                try {
                    const fullReply = `${replyMsg}`;
                    await message.reply(fullReply);
                    log.log(`[Bot Reply] (offense) to ${userKey}: ${fullReply}`);
                    if (result.classification_analysis) {
                        log.log(`[LLM Analysis] ${result.classification_analysis}`);
                    }

                    // Inject system marker into context history to stop recursive firing
                    this.messageQueue.addSystemMarker(chatId, `Warned ${userKey} for ${result.reason}`);
                } catch (e) {
                    log.error("Failed to send warning message:", e);
                }
            } else if (result && !result.violation && result.action === 'reply' && result.reply_message) {
                // Value-add response or polite redirection without strike
                try {
                    const fullReply = `${result.reply_message}`;
                    await chat.sendMessage(fullReply);
                    log.log(`[Bot Reply] (info) to ${sender}: ${fullReply}`);
                    if (result.classification_analysis) {
                        log.log(`[LLM Analysis] ${result.classification_analysis}`);
                    }
                    this.messageQueue.addSystemMarker(chatId, `Responded to ${sender} with helpful context.`);
                } catch (e) {
                    log.error("Failed to send helpful reply:", e);
                }
            } else {
                log.log(`[LLM] Evaluated transcript cleanly. No action required.`);
                if (result && result.classification_analysis) {
                    log.log(`[LLM Analysis] ${result.classification_analysis}`);
                }
            }
        });
    }
}

module.exports = Moderator;
