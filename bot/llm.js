const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

class LLMService {
    constructor() {
        this.openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY
        });
        this.rules = fs.readFileSync(path.join(__dirname, '../rules.md'), 'utf-8');
    }

    async evaluate(messages) {
        const transcript = messages.join('\n');

        const systemPrompt = `
${this.rules}

You are evaluating the recent transcript of a WhatsApp group chat.
Return a STRICT JSON object in the exact format:
{
  "violation": boolean,           // true if there is a severe violation, toxicity, or off-topic message that needs warning/redirection
  "reason": "string",             // A brief internal reason for the action
  "action": "strike",             // The action to take, usually "strike"
  "target_user": "string",        // The precise name or number of the user who committed the violation or is being addressed
  "reply_message": "string"       // The human-like message to send in the chat regarding this warning, redirect, or response. Empty string if no violation or response needed.
}

If no violation is detected but you wish to provide a helpful, data-backed value-add response to an on-topic question, you may set violation to false, populate target_user, and include your response in reply_message.
If the discussion is fine and requires no intervention, return violation=false and an empty reply_message.`;

        const fallbackCascade = [
            "qwen/qwen3.5-flash-02-23"
        ];

        for (let i = 0; i < fallbackCascade.length; i++) {
            const currentModel = fallbackCascade[i];
            try {
                const response = await this.openai.chat.completions.create({
                    model: currentModel,
                    response_format: { type: "json_object" },
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: `Transcript:\n${transcript}` }
                    ],
                    extra_body: {
                        thinking: { type: "disabled" }
                    }
                });

                let content = response.choices[0].message.content.trim();
                content = content.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
                return JSON.parse(content);
            } catch (e) {
                // Determine if it's a rate limit / quota / service error, or a missing model error (400, 404, 429, 503)
                const isTransientError = e.status === 429 || e.status >= 500 || e.status === 404 || e.status === 400 || (e.message && e.message.includes('quota'));

                if (isTransientError && i < fallbackCascade.length - 1) {
                    if (e.status === 404) {
                        console.error(`[API] Model ${currentModel} not found (404). Error: ${e.message}`);
                    }
                    console.warn(`[API] ${currentModel} returned ${e.status}. Error: ${e.message}\nBacking off to ${fallbackCascade[i + 1]}...`);
                    continue;
                }

                console.error(`[Fatal Error] Evaluation failed on ${currentModel} without recovery:`, e.status, e.message);
                if (e.status === 429 || (e.message && e.message.includes('quota'))) {
                    return { error: 'QUOTA_EXHAUSTED' };
                }
                return { violation: false };
            }
        }
    }
}

module.exports = LLMService;
