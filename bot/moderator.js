const LLMService = require('./llm');

class Moderator {
    constructor(db, messageQueue) {
        this.db = db;
        this.messageQueue = messageQueue;
        this.llm = new LLMService();
    }

    async handleMessage(message, chat) {
        let text = message.body || "";

        // Handle media messages that might not have a body
        if (!text && message.hasMedia) {
            text = `[Media Attachment: ${message.type}]`;
        }
        let sender = "";

        if (message.fromMe) {
            sender = "Host_Account";
        } else {
            try {
                const contact = await message.getContact();
                sender = contact.pushname || contact.number;
            } catch (e) {
                sender = "Unknown";
            }
        }

        const chatId = chat.id._serialized;

        if (text.toLowerCase() === '@bot stats' || text.toLowerCase() === 'stats') {
            const strikes = this.db.getStats(sender);
            await message.reply(`[mod] Hey ${sender}, you currently have ${strikes} strikes on record.`);
            return;
        }

        // Process message through sliding window queue
        this.messageQueue.addMessage(chatId, sender, text, async (transcript) => {
            console.log(`Timer triggered: Evaluating ${transcript.length} messages for chat ${chatId}`);

            const result = await this.llm.evaluate(transcript);

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
                        const messageText = `[mod] Moderator disabled for today due to API limits. Will resume tomorrow.`;
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
                // Determine user and update strikes
                const userKey = result.target_user;
                const newStrikes = this.db.addStrike(userKey);

                // Construct the reply
                // Ensure context about stats is included if LLM didn't naturally inject it
                let replyMsg = result.reply_message || `Warning: ${result.reason}.`;
                if (!replyMsg.includes('strike')) {
                    replyMsg += `\n(Note: You now have ${newStrikes} strikes).`;
                }

                try {
                    // Alert the user via direct reply
                    await message.reply(`[mod] ${replyMsg}`);

                    // Inject system marker into context history to stop recursive firing
                    this.messageQueue.addSystemMarker(chatId, `Warned ${userKey} for ${result.reason}`);
                } catch (e) {
                    console.error("Failed to send warning message:", e);
                }
            } else if (result && !result.violation && result.reply_message) {
                // Value-add response or polite redirection without strike
                try {
                    await chat.sendMessage(`[mod] ${result.reply_message}`);
                    this.messageQueue.addSystemMarker(chatId, `Responded to ${sender} with helpful context.`);
                } catch (e) {
                    console.error("Failed to send helpful reply:", e);
                }
            } else {
                console.log(`[LLM] Evaluated transcript cleanly. No action required.`);
            }
        });
    }
}

module.exports = Moderator;
