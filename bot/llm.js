const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

class LLMService {
    constructor() {
        this.openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY
        });
    }

    /**
     * Evaluate a transcript of recent messages using a two-pass approach to eliminate bias.
     */
    async evaluate(channelName, messages, pendingImages = [], userStats = {}) {
        let channelRules = "";
        let globalRules = "";
        try {
            globalRules = fs.readFileSync(path.join(__dirname, '../rules', 'global_rules.md'), 'utf-8');
        } catch (err) {
            // Optional: global rules might not exist
        }

        try {
            channelRules = fs.readFileSync(path.join(__dirname, '../rules', `${channelName}.md`), 'utf-8');
        } catch (err) {
            console.error(`[LLM] Could not load rules for channel ${channelName}: ${err.message}`);
        }

        const combinedRules = `${globalRules}\n\n${channelRules}`;

        // Find the index of the last moderation system marker
        let lastMarkerIndex = -1;
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].startsWith('[System]: Warned')) {
                lastMarkerIndex = i;
                break;
            }
        }

        let evaluateStr = "";
        let priorContextStr = "";

        if (lastMarkerIndex >= 0) {
            const priorContext = messages.slice(0, lastMarkerIndex + 1);
            const toEvaluate = messages.slice(lastMarkerIndex + 1);
            priorContextStr = `--- PRIOR CONTEXT (Already Moderated) ---\n${priorContext.join('\n\n')}\n-----------------------------------------`;
            evaluateStr = `--- MESSAGES TO EVALUATE ---\n${toEvaluate.join('\n\n')}\n----------------------------`;
        } else {
            evaluateStr = `--- MESSAGES TO EVALUATE ---\n${messages.join('\n\n')}\n----------------------------`;
        }
        const transcript = lastMarkerIndex >= 0 ? `${priorContextStr}\n\n${evaluateStr}` : evaluateStr;

        const debugLevel = parseInt(process.env.DEBUG_LEVEL || "0", 10);
        const justificationGuidance = debugLevel >= 1
            ? "Provide a detailed justification (2-5 sentences) for your decision."
            : "Provide a brief justification (exactly 1 sentence) for your decision.";

        // --- PASS 1: Neutral Classification (No Stats) ---
        const pass1SystemPrompt = `
${combinedRules}

### MODERATION PRIORITY (NEUTRAL CLASSIFICATION):
1. **CONTENT-FIRST EVALUATION:** You MUST judge each new message based ONLY on its intrinsic value. High-Value media (educational, tech/business news, tech reviews like CES updates, etc.) is STRICTLY PERMITTED.
2. **UNCERTAINTY = SILENCE (MANDATORY):** If you cannot definitively verify that a link contains "Junk Media" (e.g. memes, unrelated comedy), you MUST return violation=false. Do NOT assume a link is junk just because it is from Instagram/TikTok and lacks a caption.
3. **PRESUMPTION OF TOPICALITY:** Assume a link shared by a user is intended to be on-topic unless it is GLARINGLY obvious that it is junk (e.g. a meme format, a prank video, or unrelated comedy).

Return a STRICT JSON object in the exact format:
{
  "violation": boolean,
  "needs_reply": boolean, // Set to true ONLY if an @mention is detected OR users explicitly ask the moderator for help. Do NOT set to true for small talk or debugging. For everything else, this MUST BE FALSE unless evaluating a violation.
  "reason": "string",
  "classification_analysis": "string" // ${justificationGuidance}
}

### ANALYSIS INSTRUCTIONS:
- URL Assessment: Assess content type based on URL or creator (e.g. devdoesreviews is High-Value). 
- **Silence Precedence:** If you are even 1% unsure if a link is high-value or junk, you MUST stay silent (violation: false).
`;

        const pass1Result = await this._callLLM(pass1SystemPrompt, transcript, pendingImages);

        if (!pass1Result || (!pass1Result.violation && !pass1Result.needs_reply)) {
            return {
                violation: false,
                classification_analysis: pass1Result ? pass1Result.classification_analysis : "No action taken."
            };
        }

        // --- PASS 2: Response Tailoring (Include Stats) ---
        const statsContext = Object.entries(userStats)
            .map(([u, offenses]) => {
                if (!offenses || offenses.length === 0) return `${u}: No offenses`;
                const list = offenses.map(o => `- [${o.timestamp}] ${o.reason}`).join('\n');
                return `${u} (${offenses.length} offense(s)):\n${list}`;
            })
            .join('\n\n');

        const pass2SystemPrompt = `
${combinedRules}

USER PERFORMANCE STATS:
${statsContext || "No offenses logged for any user."}

The previous evaluation yielded the following context/reason: "${pass1Result.reason}".
Your task is to craft a human-like response and set the appropriate action.

Return a STRICT JSON object in the exact format:
{
  "violation": boolean, // Use the value from Pass 1
  "reason": "${pass1Result.reason || "none"}",
  "classification_analysis": "${pass1Result.classification_analysis}",
  "action": "string", // "strike" for violations, "reply" for Q&A, "none" for silence
  "target_user": "string", // The sender of the message being addressed
  "reply_message": "string" // Leave EMPTY ("") if action is "none" or if no reply is actually needed (e.g. casual small talk).
}

### RESPONSE INSTRUCTIONS:
- Tone: Adjust severity based on USER PERFORMANCE STATS.
- Consistency: Cite previous offenses naturally if applicable.
- Brevity: Keep it human and concise.
- Strict Silence: If the user is just making small talk or discussing the bot, DO NOT REPLY. Leave reply_message empty!
`;

        return await this._callLLM(pass2SystemPrompt, transcript, pendingImages);
    }

    async _callLLM(systemPrompt, transcript, pendingImages = []) {
        let userContent;
        if (pendingImages.length > 0) {
            userContent = [
                { type: 'text', text: `Transcript: \n${transcript}\n\nThe following image(s) require visual assessment: ` }
            ];
            for (const img of pendingImages) {
                userContent.push({ type: 'image_url', image_url: { url: `data:${img.mimeType}; base64, ${img.base64} ` } });
            }
        } else {
            userContent = `Transcript: \n${transcript} `;
        }

        const fallbackCascade = ["google/gemini-3.1-flash-lite-preview"];

        for (let i = 0; i < fallbackCascade.length; i++) {
            const currentModel = fallbackCascade[i];
            try {
                const response = await this.openai.chat.completions.create({
                    model: currentModel,
                    response_format: { type: "json_object" },
                    messages: [
                        { role: "system", content: systemPrompt },
                        { role: "user", content: userContent }
                    ]
                });
                let content = response.choices[0].message.content.trim();
                content = content.replace(/^```[a-zA-Z]*\s*/, '').replace(/\s*```$/, '');
                return JSON.parse(content);
            } catch (e) {
                if (i < fallbackCascade.length - 1) continue;
                console.error(`[Fatal Error] LLM call failed: `, e.message);
                return { violation: false };
            }
        }
    }
}

module.exports = LLMService;
