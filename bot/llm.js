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

    /**
     * Evaluate a transcript of recent messages.
     * @param {string[]} messages      - Rolling window of text messages (last 20)
     * @param {object[]} pendingImages - New images not yet seen by the LLM
     * @param {object} userStats       - Stats for all users (e.g., { "UserA": 2, ... })
     */
    async evaluate(messages, pendingImages = [], userStats = {}) {
        // Find the index of the last moderation system marker
        let lastMarkerIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].startsWith('[System]: Warned')) {
                lastMarkerIndex = i;
                break;
            }
        }

        let priorContextStr = "";
        let evaluateStr = "";

        if (lastMarkerIndex >= 0) {
            const priorContext = messages.slice(0, lastMarkerIndex + 1);
            const toEvaluate = messages.slice(lastMarkerIndex + 1);
            priorContextStr = `--- PRIOR CONTEXT (Already Moderated) ---\n${priorContext.join('\n\n')}\n-----------------------------------------`;
            evaluateStr = `--- MESSAGES TO EVALUATE ---\n${toEvaluate.join('\n\n')}\n----------------------------`;
        } else {
            evaluateStr = `--- MESSAGES TO EVALUATE ---\n${messages.join('\n\n')}\n----------------------------`;
        }

        const transcript = lastMarkerIndex >= 0 ? `${priorContextStr}\n\n${evaluateStr}` : evaluateStr;

        const statsContext = Object.entries(userStats)
            .map(([u, c]) => `${u}: ${c} offense(s)`)
            .join(', ');

        const debugLevel = parseInt(process.env.DEBUG_LEVEL || "0", 10);
        const justificationGuidance = debugLevel >= 1
            ? "Provide a detailed justification (2-5 sentences) for your decision."
            : "Provide a brief justification (exactly 1 sentence) for your decision.";

        const systemPrompt = `
${this.rules}

USER PERFORMANCE STATS (Last 30 Days):
${statsContext || "No offenses logged for any user."}

You are evaluating the recent transcript of a WhatsApp group chat.
Return a STRICT JSON object in the exact format:
{
  "violation": boolean,           // true if there is a severe violation, toxicity, or off topic message that needs warning/redirection
  "reason": "string",             // A brief internal reason for the action
  "classification_analysis": "string", // ${justificationGuidance} This will be reviewed by an admin later.
  "action": "strike",             // The action to take, usually "strike"
  "target_user": "string",        // The precise name or number of the user who committed the violation or is being addressed
  "reply_message": "string"       // The human-like message to send in the chat regarding this warning, redirect, or response. Empty string if no violation or response needed.
}

### ANALYSIS INSTRUCTIONS:
1. **URL Assessment:** If a message contains a URL (especially YouTube/social media), you MUST assess its content type based on the URL metadata or your knowledge of common creators. Determine if it is "High-Value" (educational/on-topic) or "Junk" (memes/random clips).
2. **Contextual Analysis:** Evaluate media placeholders (e.g., [Media Attachment: video]) in the context of their captions and surrounding conversation.
3. **Silence Policy:** If there is no violation, no explicit @mention, and the topic is NOT about Artificial General Intelligence (AGI), you MUST return violation=false and an empty reply_message. Still provide the "classification_analysis" for why no action was taken. Do NOT provide "value-add" or helpful facts for general on-topic discussion. Stay silent unless action is required or you are directly engaged.
4. **Targeted Quoting and Moderation:** When issuing a warning or reply, you MUST identify the exact message within the "MESSAGES TO EVALUATE" section that caused the violation (do NOT evaluate messages in "PRIOR CONTEXT"). Quote that relevant message directly in your \`reply_message\` and tailor your response specifically to what that user said. Do not just blindly quote the most recent message if the violation happened earlier in the window.
5. **Self-Awareness:** Your own past messages are labeled with \`[AI_Moderator]\`. You MUST NOT flag your own past messages for moderation strikes, nor do you need to reply to your own messages. They are provided purely so you have context of what you have recently said.

If a violation is detected or you are summoned/@-mentioned or discussing AGI, return the appropriate JSON.`;

        // Build the user message content. If there are new images, include them inline
        // so the LLM can visually assess them. Images already processed (i.e. already in
        // the 20-message history from a prior evaluation) are not re-uploaded — they remain
        // as text placeholders in the transcript only.
        let userContent;
        if (pendingImages.length > 0) {
            userContent = [
                { type: 'text', text: `Transcript: \n${transcript}\n\nThe following image(s) were just shared in the chat and require visual assessment: ` }
            ];
            for (const img of pendingImages) {
                userContent.push({
                    type: 'image_url',
                    image_url: {
                        url: `data:${img.mimeType}; base64, ${img.base64} `
                    }
                });
            }
        } else {
            userContent = `Transcript: \n${transcript} `;
        }

        const fallbackCascade = [
            "google/gemini-3.1-flash-lite-preview"
        ];

        for (let i = 0; i < fallbackCascade.length; i++) {
            const currentModel = fallbackCascade[i];
            try {
                const requestBody = {
                    model: currentModel,
                    response_format: { type: "json_object" },
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent }
                    ]
                };
                const requestBytes = Buffer.byteLength(JSON.stringify(requestBody), 'utf8');
                const startTime = Date.now();

                const response = await this.openai.chat.completions.create(requestBody);

                const elapsed = Date.now() - startTime;
                console.log(`[API] ${currentModel} responded in ${elapsed} ms(request: ${(requestBytes / 1024).toFixed(1)}KB)`);

                let content = response.choices[0].message.content.trim();
                content = content.replace(/^```[a - zA - Z] *\s * /, '').replace(/\s * ```$/, '');
                return JSON.parse(content);
            } catch (e) {
                // Determine if it's a rate limit / quota / service error, or a missing model error (400, 404, 429, 503)
                const isTransientError = e.status === 408 || e.status === 429 || e.status >= 500 || e.status === 404 || e.status === 400 || (e.message && e.message.includes('quota'));

                if (isTransientError && i < fallbackCascade.length - 1) {
                    if (e.status === 404) {
                        console.error(`[API] Model ${currentModel} not found(404).Error: ${e.message} `);
                    }
                    console.warn(`[API] ${currentModel} returned ${e.status}.Error: ${e.message} \nBacking off to ${fallbackCascade[i + 1]}...`);
                    continue;
                }

                console.error(`[Fatal Error] Evaluation failed on ${currentModel} without recovery: `, e.status, e.message);
                if (e.status === 429 || (e.message && e.message.includes('quota'))) {
                    return { error: 'QUOTA_EXHAUSTED' };
                }
                return { violation: false };
            }
        }
    }
}

module.exports = LLMService;
