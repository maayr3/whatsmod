const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    console.log('QR Code received! Please scan:');
    qrcode.generate(qr, { small: true });
});

client.on('authenticated', () => {
    console.log('Authenticated successfully!');
});

client.on('auth_failure', (msg) => {
    console.error('Authentication failure:', msg);
});

client.on('ready', async () => {
    console.log('Client is ready!');
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        console.log('Groups found:', groups.length);
        groups.forEach(group => {
            console.log(`- ${group.name} (ID: ${group.id._serialized})`);
        });
    } catch (err) {
        console.error('Error fetching chats:', err);
    }
    process.exit(0);
});

console.log('Initializing client...');
client.initialize();

