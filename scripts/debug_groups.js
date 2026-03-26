const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    }
});

client.on('qr', (qr) => {
    console.log('QR Code received!');
});

client.on('ready', async () => {
    console.log('Client is ready!');
    try {
        const chats = await client.getChats();
        const groups = chats.filter(chat => chat.isGroup);
        console.log('--- GROUPS FOUND ---');
        for (const group of groups) {
            console.log(`Name: [${group.name}] | ID: ${group.id._serialized}`);
            // Force a refresh of the group name if possible
            try {
                const refreshedChat = await client.getChatById(group.id._serialized);
                console.log(`Refreshed Name: [${refreshedChat.name}]`);
            } catch (e) {
                console.log(`Failed to refresh name: ${e.message}`);
            }
        }
        console.log('--------------------');
    } catch (err) {
        console.error('Error fetching chats:', err);
    }
    process.exit(0);
});

console.log('Initializing client...');
client.initialize();
