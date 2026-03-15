require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function testSTTFetch() {
    console.log("Testing OpenRouter STT with direct fetch...");

    const tempFile = path.join(__dirname, 'test.opus');
    fs.writeFileSync(tempFile, Buffer.alloc(1024, 'a'));

    const formData = new FormData();
    formData.append('file', new Blob([fs.readFileSync(tempFile)]), 'test.opus');
    formData.append('model', 'openai/whisper-large-v3');

    try {
        console.log("Sending fetch request...");
        const response = await fetch("https://openrouter.ai/api/v1/audio/transcriptions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            },
            body: formData
        });

        const data = await response.json();
        console.log("Response Status:", response.status);
        console.log("Response Data:", data);
    } catch (error) {
        console.error("Fetch Test Failed:");
        console.error("Message:", error.message);
    } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

testSTTFetch();
