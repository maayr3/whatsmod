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
let botWid = null; // Bot's own WhatsApp ID, set on 'ready'

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        headless: 'shell',
        pipe: true,
        protocolTimeout: 1200000, // 20 minutes
        executablePath: process.env.CHROME_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-default-apps',
            '--enable-logging=stderr',
            '--v=1',
            '--disable-gpu-shader-disk-cache',
            '--disk-cache-size=1',
            '--media-cache-size=1',
        ],
    }
});

// Capture browser console logs
client.on('remote_session_saved', () => {
    systemLogger.log('Remote session saved.');
});

client.on('qr', (qr) => {
    systemLogger.log('QR Code received! The session has expired or is invalid.');
    qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
    systemLogger.log(`WhatsApp Loading: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
    systemLogger.log('WhatsApp Client Authenticated successfully!');
});

client.on('auth_failure', (msg) => {
    systemLogger.error('WhatsApp Client Authentication FAILURE:', msg);
});

client.on('ready', async () => {
    systemLogger.log('WhatsApp Bot Client is ready and connected!');

    // Capture the bot's own WhatsApp ID for mention detection
    try {
        botWid = client.info.wid._serialized;
        systemLogger.log(`Bot WhatsApp ID: ${botWid}`);
    } catch (e) {
        systemLogger.warn('Could not determine bot WhatsApp ID:', e.message);
    }
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

        // Notify DEBUG channel that the bot is back online
        const debugChat = groups.find(g => g.name === 'DEBUG');
        if (debugChat) {
            await debugChat.sendMessage(`WhatsMod v${version} (${hash}) is back online.`);
            systemLogger.log('Sent startup notification to DEBUG channel.');
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
        const chat = await message.getChat();


        // As a Group Moderator Bot, we only care about groups.
        if (chat.isGroup) {
            const ruleFilePath = path.join(__dirname, 'rules', `${chat.name}.md`);
            const globalRulePath = path.join(__dirname, 'rules', 'global_rules.md');

            // If a rules file exists for this group, evaluate it
            if (!fs.existsSync(ruleFilePath) && !fs.existsSync(globalRulePath)) {
                return;
            }

            const channelLogger = new logger.ChannelLogger(chat.name);
            channelLogger.log(`[Group Match] Received message from ${message.author || message.from}: "${message.body}"`);
            await moderator.handleMessage(message, chat, channelLogger, botWid);
        }
    } catch (err) {
        systemLogger.error('Error handling message:', err);
    }
});


// Hourly heartbeat to logs
setInterval(() => {
    systemLogger.log(`Heartbeat: WhatsMod v${version} (${hash}) is active. Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
}, 15 * 60 * 1000);

// Proper shutdown handling
process.on('SIGTERM', async () => {
    systemLogger.log('SIGTERM received. Shutting down...');
    
    // Set a force-exit timeout in case client.destroy() hangs
    const forceExitTimeout = setTimeout(() => {
        systemLogger.warn('Shutdown timed out, forcing exit.');
        process.exit(1);
    }, 10000);

    try {
        if (client) {
            await client.destroy();
            systemLogger.log('Client destroyed successfully.');
        }
        clearTimeout(forceExitTimeout);
        process.exit(0);
    } catch (err) {
        systemLogger.error('Error during shutdown:', err);
        clearTimeout(forceExitTimeout);
        process.exit(1);
    }
});

systemLogger.log(`Starting WhatsMod v${version} (${hash})...`);
systemLogger.log('Initializing WhatsApp Client...');
client.initialize();

