require('dotenv').config();
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

const openai = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY
});

async function testSTT() {
    console.log("Testing OpenRouter STT integration...");
    console.log("Base URL:", "https://openrouter.ai/api/v1");
    // Don't log full key, but check if it's there
    console.log("API Key present:", !!process.env.OPENROUTER_API_KEY);

    const tempFile = path.join(__dirname, 'test.opus');
    // Create a 1KB dummy file
    fs.writeFileSync(tempFile, Buffer.alloc(1024, 'a'));

    try {
        console.log("Sending request...");
        const response = await openai.audio.transcriptions.create({
            file: fs.createReadStream(tempFile),
            model: "openai/whisper-large-v3",
        });
        console.log("Success! Response:", response);
    } catch (error) {
        console.error("STT Test Failed:");
        console.error("Message:", error.message);
        if (error.response) {
            console.error("Status:", error.response.status);
            console.error("Data:", error.response.data);
        }
    } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

testSTT();
