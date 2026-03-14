const fs = require('fs');
const path = require('path');
const Database = require('./bot/database');
const LLMService = require('./bot/llm');

// Mock environment
process.env.OPENROUTER_API_KEY = 'test_key';

async function test() {
    console.log("--- Testing Stats Injection ---");

    // 1. Setup Mock Database
    const dbPath = path.join(__dirname, 'test_db.json');
    const mockData = {
        "UserA": { offenses: [{ timestamp: new Date().toISOString(), contentType: "test" }] },
        "UserB": {
            offenses: [
                { timestamp: new Date(Date.now() - 10 * 86400000).toISOString(), contentType: "old" },
                { timestamp: new Date(Date.now() - 40 * 86400000).toISOString(), contentType: "expired" }
            ]
        },
        "_system": {}
    };
    fs.writeFileSync(dbPath, JSON.stringify(mockData));

    const db = new Database(dbPath);
    db.init();

    // 2. Get Stats
    const stats = db.getAllUserStats(30);
    console.log("Extracted Stats:", stats);

    // 3. Test LLM Prompt Construction (Monkey-patching the call)
    const llm = new LLMService();

    // We'll override the evaluate method's call to openai to just log the system prompt
    const originalCreate = llm.openai.chat.completions.create.bind(llm.openai.chat.completions);
    llm.openai.chat.completions.create = async (body) => {
        console.log("\n--- System Prompt Generated ---");
        const systemMsg = body.messages.find(m => m.role === 'system');
        console.log(systemMsg.content);
        console.log("--- End of System Prompt ---\n");
        return { choices: [{ message: { content: '{"violation": false, "reason": "test", "action": "none", "target_user": "", "reply_message": ""}' } }] };
    };

    await llm.evaluate(["UserA: Hello"], [], stats);

    // Cleanup
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    console.log("Verification script completed.");
}

test().catch(console.error);
