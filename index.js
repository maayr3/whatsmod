require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const logger = require('./bot/logger');
const systemLogger = logger.system;
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Database = require('./bot/database');
const MessageQueue = require('./bot/messageQueue');
const Moderator = require('./bot/moderator');

// Calculate semantic version from git history
function calculateVersion() {
    let major = 1;
    let minor = 0;
    let patch = 0;
    let hash = 'unknown';

    try {
        // Get short hash
        hash = execSync('git rev-parse --short HEAD').toString().trim();

        // Get all commit messages in chronological order
        const log = execSync('git log --oneline --reverse').toString().trim().split('\n');

        for (const line of log) {
            const message = line.substring(8); // Skip the hash at the start of oneline log

            if (message.includes('[FEATURE]') || message.includes('feat:')) {
                minor++;
                patch = 0;
            } else if (message.includes('[FIX]') || message.includes('fix:') || /^[Ff]ix\s/.test(message)) {
                patch++;
            }
        }
    } catch (e) {
        systemLogger.warn('Could not calculate version from git history, falling back to package.json');
        try {
            return { version: require('./package.json').version, hash: 'unknown' };
        } catch (err) {
            return { version: '1.0.0', hash: 'unknown' };
        }
    }
    return { version: `${major}.${minor}.${patch}`, hash };
}

const { version, hash } = calculateVersion();


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
    systemLogger.log('Generating QR code...');
    qrcode.generate(qr, { small: true });
    systemLogger.log('Please scan the QR Code with your WhatsApp app.');
});

client.on('ready', () => {
    systemLogger.log('WhatsApp Bot Client is ready and connected!');
});

// Using 'message_create' event for receiving all new messages (including those sent by you)
client.on('message_create', async (message) => {
    try {
        const chat = await message.getChat();

        // As a Group Moderator Bot, we only care about groups.
        if (chat.isGroup) {
            const ruleFilePath = path.join(__dirname, 'rules', `${chat.name}.md`);

            // If a rules file exists for this group, evaluate it
            if (!fs.existsSync(ruleFilePath)) {
                return;
            }

            const channelLogger = new logger.ChannelLogger(chat.name);
            channelLogger.log(`[Group Match] Received message from ${message.author || message.from}: "${message.body}"`);
            await moderator.handleMessage(message, chat, channelLogger);
        }
    } catch (err) {
        systemLogger.error('Error handling message:', err);
    }
});

systemLogger.log(`Starting WhatsMod v${version} (${hash})...`);
systemLogger.log('Initializing WhatsApp Client...');
client.initialize();
