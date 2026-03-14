class MessageQueue {
    constructor() {
        // chat_id -> { messages: [], pendingImages: [], timer: null, isEvaluating: false }
        this.chats = {};
    }

    /**
     * Add a message to the sliding window.
     * @param {string} chatId
     * @param {string} sender
     * @param {string} text        - The text representation (e.g. "[Media Attachment: image]")
     * @param {object|null} image  - Optional: { mimeType, base64 } for a NEW image not yet evaluated
     * @param {Function} callback  - Called with (messages, pendingImages) when the debounce fires
     */
    addMessage(chatId, sender, text, image, callback) {
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

        // Fire immediately if there's no active timer/cooldown, otherwise debounce
        const isFirstSinceEval = !chatState.timer;

        if (chatState.timer) {
            clearTimeout(chatState.timer);
        }

        const runEvaluation = async () => {
            chatState.timer = null;

            if (chatState.isEvaluating) {
                console.log(`[Queue] Evaluation already in-flight for ${chatId}, rescheduling...`);
                chatState.timer = setTimeout(async () => {
                    chatState.isEvaluating = true;
                    try {
                        const images = chatState.pendingImages.splice(0);
                        await callback([...chatState.messages], images);
                    } finally {
                        chatState.isEvaluating = false;
                    }
                }, 3000);
                return;
            }

            chatState.isEvaluating = true;
            try {
                const images = chatState.pendingImages.splice(0);
                await callback([...chatState.messages], images);
            } finally {
                chatState.isEvaluating = false;
            }
        };

        if (isFirstSinceEval) {
            // First message since last evaluation: run immediately, then set a cooldown
            // so any follow-up messages within 3s get debounced instead of firing again.
            runEvaluation();
            chatState.timer = setTimeout(() => { chatState.timer = null; }, 3000);
        } else {
            // Subsequent message: reset debounce
            chatState.timer = setTimeout(runEvaluation, 3000);
        }
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
