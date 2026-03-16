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

            if (message.includes('[FEATURE]') || /^feat(\(.*\))?:/.test(message)) {
                minor++;
                patch = 0;
            } else if (message.includes('[FIX]') || /^fix(\(.*\))?:/.test(message) || /^[Ff]ix\s/.test(message)) {
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
        executablePath: process.env.CHROME_PATH || undefined,
    }
});

client.on('qr', (qr) => {
    systemLogger.log('Generating QR code...');
    qrcode.generate(qr, { small: true });
    systemLogger.log('Please scan the QR Code with your WhatsApp app.');
});

client.on('authenticated', () => {
    systemLogger.log('WhatsApp Bot authenticated successfully!');
});

client.on('auth_failure', (msg) => {
    systemLogger.error('WhatsApp Bot authentication failure:', msg);
});

client.on('ready', async () => {
    systemLogger.log('WhatsApp Bot Client is ready and connected!');

    // Log all groups the bot is in
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        systemLogger.log(`Bot is in ${groups.length} groups.`);
        groups.forEach(group => {
            const ruleFilePath = path.join(__dirname, 'rules', `${group.name}.md`);
            const exists = fs.existsSync(ruleFilePath);
            systemLogger.log(`- Group: "${group.name}" | Rules exists: ${exists} | ID: ${group.id._serialized}`);
        });

        // Test sending a message to WarRoom or Priority Ayre Mail
        const priorityChat = groups.find(g => g.name === 'Priority Ayre Mail');
        if (priorityChat) {
            await priorityChat.sendMessage('WhatsMod is back online and monitoring this channel. (v' + version + ')');
            systemLogger.log('Sent startup message to Priority Ayre Mail');
        }
    } catch (err) {
        systemLogger.error('Error listing groups on ready:', err);
    }
});



client.on('disconnected', (reason) => {
    systemLogger.warn('WhatsApp Bot was disconnected:', reason);
    // Exit with error code to let systemd restart the service
    systemLogger.log('Restarting bot in 5 seconds...');
    setTimeout(() => {
        process.exit(1);
    }, 5000);
});

client.on('change_state', (state) => {
    systemLogger.log('WhatsApp Bot state changed:', state);
});

// Using 'message_create' event for receiving all new messages (including those sent by you)
client.on('message_create', async (message) => {
    try {
        // Log EVERY message received for debugging
        systemLogger.log(`[DEBUG] message_create event for message from ${message.from}`);

        const chat = await message.getChat();

        systemLogger.log(`[DEBUG] Chat resolved: ${chat.name} (isGroup: ${chat.isGroup})`);


        // As a Group Moderator Bot, we only care about groups.
        if (chat.isGroup) {
            const ruleFilePath = path.join(__dirname, 'rules', `${chat.name}.md`);
            const globalRulePath = path.join(__dirname, 'rules', 'global_rules.md');

            // If a rules file exists for this group, evaluate it
            if (!fs.existsSync(ruleFilePath) && !fs.existsSync(globalRulePath)) {
                systemLogger.log(`[DEBUG] No rules found for group ${chat.name}. Skipping.`);
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


// Hourly heartbeat to logs
setInterval(() => {
    systemLogger.log(`Heartbeat: WhatsMod v${version} (${hash}) is active. Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
}, 60 * 60 * 1000);

systemLogger.log(`Starting WhatsMod v${version} (${hash})...`);
systemLogger.log('Initializing WhatsApp Client...');
client.initialize();

