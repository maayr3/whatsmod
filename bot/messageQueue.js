class MessageQueue {
    constructor() {
        // chat_id -> { messages: [], timer: null }
        this.chats = {};
    }

    addMessage(chatId, sender, text, callback) {
        if (!this.chats[chatId]) {
            this.chats[chatId] = {
                messages: [],
                timer: null
            };
        }

        const chatState = this.chats[chatId];

        // Add message to rolling window
        chatState.messages.push(`[${sender}]: ${text}`);

        // Maintain sliding window of 20 messages max
        if (chatState.messages.length > 20) {
            chatState.messages.shift();
        }

        // Reset debounce timer on new message
        if (chatState.timer) {
            clearTimeout(chatState.timer);
        }

        chatState.timer = setTimeout(() => {
            // 3-second debounce expired, trigger evaluation callback
            callback([...chatState.messages]);
            chatState.timer = null;
        }, 3000);
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
