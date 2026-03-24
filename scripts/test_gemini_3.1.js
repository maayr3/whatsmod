require('dotenv').config();
const { OpenAI } = require('openai');

async function testGemini31() {
    const openai = new OpenAI({
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
    });

    const modelId = "google/gemini-3.1-flash-lite-preview";
    console.log(`Testing model: ${modelId}...`);

    try {
        const response = await openai.chat.completions.create({
            model: modelId,
            response_format: { type: "json_object" },
            messages: [
                { role: "system", content: "You are a helpful assistant. Return a JSON object with a 'status' field set to 'success' and a 'message' field saying 'Gemini 3.1 is working'." },
                { role: "user", content: "Test." }
            ]
        });

        console.log("Response received:");
        console.log(JSON.stringify(response.choices[0].message.content, null, 2));

        const data = JSON.parse(response.choices[0].message.content);
        if (data.status === 'success') {
            console.log("\n✅ Gemini 3.1 is working correctly!");
        } else {
            console.log("\n❌ Received unexpected JSON structure.");
        }
    } catch (err) {
        console.error("\n❌ Error during Gemini 3.1 test:", err.message);
        if (err.response) {
            console.error("API response error:", err.response.data);
        }
    }
}

testGemini31();
