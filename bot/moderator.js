const LLMService = require('./llm');

const VIDEO_SIZE_LIMIT_BYTES = 10 * 1024 * 1024; // 10 MB

class Moderator {
    constructor(db, messageQueue) {
        this.db = db;
        this.messageQueue = messageQueue;
        this.llm = new LLMService();
    }

    async handleMessage(message, chat) {
        let text = message.body || "";
        let imageData = null; // { mimeType, base64 } for new images to send to LLM

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
                    console.warn(`[Media] Failed to download image: ${e.message}`);
                    text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
                }
            } else if (mediaType === 'video') {
                // Silently ignore videos larger than 10 MB
                const fileSizeBytes = message.filesize || 0;
                if (fileSizeBytes > VIDEO_SIZE_LIMIT_BYTES) {
                    console.log(`[Media] Ignoring video (${(fileSizeBytes / 1024 / 1024).toFixed(1)} MB > 10 MB limit)`);
                    return; // Silently drop, don't add to transcript or evaluate
                }
                text = text ? `${text} [Media Attachment: ${mediaType}]` : `[Media Attachment: ${mediaType}]`;
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
            console.log(`Timer triggered: Evaluating ${transcript.length} messages for chat ${chatId}` +
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
                        console.log(`[Moderator] Sent quota exhaustion warning for ${currentDate}.`);
                    } catch (err) {
                        console.error("Failed to send quota warning:", err);
                    }
                } else {
                    console.log(`[Moderator] Quota exhausted, warning already sent for ${currentDate}.`);
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
                    console.log(`[Bot Reply] (offense) to ${userKey}: ${fullReply}`);
                    if (result.classification_analysis) {
                        console.log(`[LLM Analysis] ${result.classification_analysis}`);
                    }

                    // Inject system marker into context history to stop recursive firing
                    this.messageQueue.addSystemMarker(chatId, `Warned ${userKey} for ${result.reason}`);
                } catch (e) {
                    console.error("Failed to send warning message:", e);
                }
            } else if (result && !result.violation && result.reply_message) {
                // Value-add response or polite redirection without strike
                try {
                    const fullReply = `${result.reply_message}`;
                    await chat.sendMessage(fullReply);
                    console.log(`[Bot Reply] (info) to ${sender}: ${fullReply}`);
                    if (result.classification_analysis) {
                        console.log(`[LLM Analysis] ${result.classification_analysis}`);
                    }
                    this.messageQueue.addSystemMarker(chatId, `Responded to ${sender} with helpful context.`);
                } catch (e) {
                    console.error("Failed to send helpful reply:", e);
                }
            } else {
                console.log(`[LLM] Evaluated transcript cleanly. No action required.`);
                if (result && result.classification_analysis) {
                    console.log(`[LLM Analysis] ${result.classification_analysis}`);
                }
            }
        });
    }
}

module.exports = Moderator;
