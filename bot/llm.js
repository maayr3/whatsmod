const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');


class LLMService {
    constructor() {
        this.openai = new OpenAI({
            baseURL: "https://openrouter.ai/api/v1",
            apiKey: process.env.OPENROUTER_API_KEY,
            timeout: 60000 // 60 seconds
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
            if (messages[i].startsWith('[System]: Warned') || messages[i].startsWith('[System]: Responded')) {
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

        // Provide current AEST date
        const nowAESTString = new Date().toLocaleString("en-US", { timeZone: "Australia/Sydney" });
        const dateObj = new Date(nowAESTString);
        const yyyy = dateObj.getFullYear();
        const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
        const dd = String(dateObj.getDate()).padStart(2, '0');
        const compactDate = `${yyyy}${mm}${dd}`;

        // Daily Character Mode (AEST) - Only active for WarRoom and DEBUG
        let selectedCharacter = null;
        if (['WarRoom', 'DEBUG'].includes(channelName)) {
            const CHARACTER_POOL = [
                "Jack Sparrow", "Darth Vader", "The Joker", "Tony Stark", "Yoda",
                "Batman", "Dirty Harry", "Kevin McCallister", "Neo", "Terminator",
                "The Dude", "John Wick", "Lara Croft", "Michael Corleone", "Agent Smith",
                "Marty McFly", "Gandalf", "Sherlock Holmes", "Morpheus", "Tony Montana",
                "Doc Brown"
            ];
            const dateNum = parseInt(compactDate, 10);
            const characterIndex = dateNum % CHARACTER_POOL.length;
            selectedCharacter = CHARACTER_POOL[characterIndex];
        }

        const debugLevel = parseInt(process.env.DEBUG_LEVEL || "0", 10);
        const justificationGuidance = debugLevel >= 1
            ? "Provide a detailed justification (2-5 sentences) for your decision."
            : "Provide a brief justification (exactly 1 sentence) for your decision.";

        // --- PASS 1: Neutral Classification (No Stats) ---
        const pass1SystemPrompt = `
${combinedRules}

### CURRENT CONTEXT:
- **Current Date (AEST):** ${compactDate}
- **Channel:** ${channelName}
${selectedCharacter ? `- **Assigned Daily Character:** ${selectedCharacter}` : ""}

### MODERATION PRIORITY (NEUTRAL CLASSIFICATION):
1. **CONTENT-FIRST EVALUATION:** You MUST judge each new message based ONLY on its intrinsic value. High-Value media (educational, tech/business news, tech reviews like CES updates, etc.) is STRICTLY PERMITTED.
2. **UNCERTAINTY = SILENCE (MANDATORY):** If you cannot definitively verify that a link contains "Junk Media" (e.g. memes, unrelated comedy), you MUST return violation=false. Do NOT assume a link is junk just because it is from Instagram/TikTok and lacks a caption.
3. **PRESUMPTION OF TOPICALITY:** Assume a link shared by a user is intended to be on-topic unless it is GLARINGLY obvious that it is junk (e.g. a meme format, a prank video, or unrelated comedy).

Return a STRICT JSON object in the exact format:
{
  "violation": boolean,
  "needs_reply": boolean, // Set to true ONLY IF: 1) There is an explicit @mention of the bot (e.g., @bot, @AI_Moderator) in the newest messages, 2) A user asks a direct, clear question addressed TO YOU, OR 3) You were recently engaged in the PRIOR CONTEXT and a user is clearly continuing that direct conversation with you by replying to or following up on your last message. 
  // IMPORTANT: Do NOT set to true for: 1) General "on-topic" discussion where you are NOT addressed (e.g. people talking about tech/AI among themselves), 2) Small talk where you aren't the focus, 3) Messages that look like system status updates or others using your voice unless they ask YOU something. Being "on-topic" is NEVER a reason to interject. If a user is talking to someone else (e.g. "btw @Matt..."), you MUST stay silent.
  "reason": "string",
  "classification_analysis": "string" // Provide a brief internal justification (exactly 1 sentence) for your decision on violation and needs_reply. Do NOT put your reply message here.
}

### ANALYSIS INSTRUCTIONS:
- **Mention Check:** Check if the message contains "@AI_Moderator" or "@bot" or a clear nickname for you.
- **Direct Address:** Is the user talking TO you or ABOUT you to someone else? Only reply if they are talking TO you.
- **Silence Precedence:** If you are even 1% unsure if you should reply, you MUST stay silent (needs_reply: false).
- URL Assessment: Assess content type based on URL or creator (e.g. devdoesreviews is High-Value). 
- **Silence Precedence (Moderation):** If you are even 1% unsure if a link is high-value or junk, you MUST stay silent (violation: false).
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

### CURRENT CONTEXT:
- **Current Date (AEST):** ${compactDate}
${selectedCharacter ? `
### CHARACTER INSTRUCTIONS:
- **Daily Character Mode:** For today, you are **${selectedCharacter}**.
- **Requirement:** You MUST prefix every response with \`(${selectedCharacter}) - \`.
- **Persona:** Fully adopt the tone, vocabulary, idioms, and iconic style of ${selectedCharacter}.
` : ""}

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
- Tone: Adjust severity based on USER PERFORMANCE STATS and your persona.
- Consistency: Cite previous offenses naturally if applicable.
- Brevity: Keep it human and concise.
- Strict Silence: Generally stay silent for human-to-human small talk or when users are just talking about you in the third person. However, if the user is directly talking to YOU or replying to your last message, you MUST reply. Do not leave reply_message empty if you are in an active conversation with the user.
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

        const fallbackCascade = ["google/gemini-3.1-flash-lite-preview", "google/gemini-3-flash-preview"];

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
