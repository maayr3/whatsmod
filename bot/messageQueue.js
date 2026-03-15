class MessageQueue {
    constructor() {
        // chat_id -> { messages: [], pendingImages: [], timer: null, isEvaluating: false }
        this.chats = {};
        // Set of message IDs already added to avoid double-processing (e.g. from duplicate events)
        this.processedIds = new Set();
        this.maxProcessedIds = 100;
    }

    /**
     * Add a message to the sliding window.
     * @param {string} chatId
     * @param {string} sender
     * @param {string} text        - The text representation (e.g. "[Media Attachment: image]")
     * @param {string} messageId   - Unique ID of the message
     * @param {object|null} image  - Optional: { mimeType, base64 } for a NEW image not yet evaluated
     * @param {boolean} isFromBot  - Flag indicating if the message is from the bot itself
     * @param {Function} callback  - Called with (messages, pendingImages) when the debounce fires
     */
    addMessage(chatId, sender, text, messageId, image, isFromBot, callback) {
        if (this.processedIds.has(messageId)) {
            console.log(`[Queue] Ignoring duplicate messageId: ${messageId}`);
            return;
        }

        // Add to processed set and prune if necessary
        this.processedIds.add(messageId);
        if (this.processedIds.size > this.maxProcessedIds) {
            const firstId = this.processedIds.values().next().value;
            this.processedIds.delete(firstId);
        }

        if (!this.chats[chatId]) {
            this.chats[chatId] = {
                messages: [],
                pendingImages: [],   // images that haven't been evaluated yet
                timer: null,
                isEvaluating: false
            };
        }

        const chatState = this.chats[chatId];

        // Add text representation to rolling window
        chatState.messages.push(`[${sender}]: ${text}`);

        // Maintain sliding window of 20 messages max
        if (chatState.messages.length > 20) {
            chatState.messages.shift();
        }

        // If this message has image data, queue it for the next LLM evaluation
        if (image) {
            chatState.pendingImages.push({ sender, mimeType: image.mimeType, base64: image.base64 });
        }

        // If the message is from the bot itself, don't trigger the evaluation timer
        if (isFromBot) {
            console.log(`[Queue] Added AI_Moderator message to transcript but skipping evaluation trigger for ${chatId}`);
            return;
        }

        // Debounce logic
        if (chatState.timer) {
            clearTimeout(chatState.timer);
        }

        const runEvaluation = async () => {
            chatState.timer = null;

            if (chatState.isEvaluating) {
                // If already evaluating, wait another bit
                console.log(`[Queue] Evaluation in-flight for ${chatId}, delaying...`);
                chatState.timer = setTimeout(runEvaluation, 1000);
                return;
            }

            chatState.isEvaluating = true;
            try {
                // Capture current snapshot
                const transcript = [...chatState.messages];
                const images = chatState.pendingImages.splice(0);

                await callback(transcript, images);
            } catch (err) {
                console.error(`[Queue] Error in evaluation callback for ${chatId}:`, err);
            } finally {
                chatState.isEvaluating = false;
            }
        };

        // Fire after a 3s quiet period
        chatState.timer = setTimeout(runEvaluation, 3000);
    }

    addSystemMarker(chatId, markerText) {
        if (!this.chats[chatId]) return;

        const chatState = this.chats[chatId];
        chatState.messages.push(`[System]: ${markerText}`);

        if (chatState.messages.length > 20) {
            chatState.messages.shift();
        }
    }
}

module.exports = MessageQueue;
