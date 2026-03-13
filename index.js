require('dotenv').config();
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Database = require('./bot/database');
const MessageQueue = require('./bot/messageQueue');
const Moderator = require('./bot/moderator');

// Initialize local database
const db = new Database('./database.json');
db.init();

// Initialize the queue and the moderator subsystem
const messageQueue = new MessageQueue();
const moderator = new Moderator(db, messageQueue);

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    console.log('Generating QR code...');
    qrcode.generate(qr, { small: true });
    console.log('Please scan the QR Code with your WhatsApp app.');
});

client.on('ready', () => {
    console.log('WhatsApp Bot Client is ready and connected!');
});

// Using 'message_create' event for receiving all new messages (including those sent by you)
client.on('message_create', async (message) => {
    try {
        const chat = await message.getChat();

        // Ignore bot's own moderation replies to prevent re-entrancy (double-post loop)
        if ((message.body || '').startsWith('[mod]')) return;

        // As a Group Moderator Bot, we only care about groups.
        if (chat.isGroup) {
            const targetGroup = process.env.TARGET_GROUP;

            // If TARGET_GROUP is defined in .env, restrict moderation to that specific group
            if (targetGroup && chat.name !== targetGroup) {
                return;
            }

            console.log(`[Group Match] Received message in "${chat.name}" from ${message.author || message.from}: "${message.body}"`);
            await moderator.handleMessage(message, chat);
        }
    } catch (err) {
        console.error('Error handling message:', err);
    }
});

console.log('Initializing WhatsApp Client...');
client.initialize();
