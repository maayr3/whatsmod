require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Moderator = require('../bot/moderator');

// Mock data
const mockDb = {
    getOffenses: () => [],
    getAllUserStats: () => ({}),
    init: () => { },
    addOffense: () => [],
    setSystemState: () => { },
    getSystemState: () => null
};

const mockQueue = {
    addMessage: (chatId, sender, text, messageId, imageData, fromMe, callback) => {
        console.log(`[MockQueue] Added message: "${text}"`);
        // Simulate the callback trigger
        // In reality, this is triggered by a timer in messageQueue.js
    },
    addSystemMarker: (chatId, text) => {
        console.log(`[MockQueue] Added system marker: "${text}"`);
    }
};

const mockLogger = {
    log: (msg) => console.log(`[Log] ${msg}`),
    warn: (msg) => console.warn(`[Warn] ${msg}`),
    error: (msg) => console.error(`[Error] ${msg}`)
};

const mockChat = {
    id: { _serialized: 'test_chat_id' },
    name: 'DEBUG',
    isGroup: true,
    sendMessage: async (msg) => console.log(`[MockChat] Sent message: ${msg}`)
};

const mockMessage = {
    id: { _serialized: 'test_message_id' },
    body: '',
    fromMe: false,
    hasMedia: true,
    type: 'ptt', // voice note
    from: 'test_sender',
    author: 'test_sender',
    getChat: async () => mockChat,
    getContact: async () => ({ pushname: 'Tester', number: '123456789' }),
    downloadMedia: async () => {
        // A slightly more realistic dummy with OGG/Opus header
        const oggS = Buffer.from([0x4f, 0x67, 0x67, 0x53]); // OggS
        const opusHead = Buffer.from('OpusHead');
        const dummyData = Buffer.concat([oggS, Buffer.alloc(100), opusHead, Buffer.alloc(1000)]);
        return {
            mimetype: 'audio/ogg; codecs=opus',
            data: dummyData.toString('base64')
        };
    },
    reply: async (msg) => console.log(`[MockMsg] Replied: ${msg}`)
};

async function testAudioTranscription() {
    console.log("Starting Audio Transcription Test...");
    console.log("Using model: google/gemini-flash-1.5 (via TranscriptionService)");
    const moderator = new Moderator(mockDb, mockQueue);

    try {
        await moderator.handleMessage(mockMessage, mockChat, mockLogger);
        console.log("Test execution finished.");
    } catch (err) {
        console.error("Test failed with error:", err);
    }
}

testAudioTranscription();
