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
    async evaluate(channelName, messages, pendingImages = [], userStats = {}, isBotMentioned = false) {
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
  "needs_reply": boolean, // DEFAULT: false. Set to true ONLY IF one of these EXACT conditions is met:
  // 1) The message contains a LITERAL @mention of the bot (e.g., "@bot", "@AI_Moderator", "@whatsmod").
  // 2) A user NAMES YOU specifically and asks YOU a question (e.g., "hey bot, what do you think?").
  // 3) A user REPLIES TO your previous message (indicated by "(Replying to AI_Moderator: ...)" prefix) AND asks a follow-up question.
  // 
  // HARD RULES - needs_reply MUST be false for ALL of these:
  // - General group questions (e.g., "any recommends on X?", "what do you guys think?", "has anyone tried Y?") — these are addressed to OTHER HUMANS, not you.
  // - On-topic discussion between humans, even if you know the answer.
  // - Small talk, banter, or casual conversation.
  // - Messages about you in the third person (e.g., "the bot is cool").
  // - Rhetorical questions or questions directed at another named user.
  // - System status updates or bot signatures.
  // YOU ARE NOT A PARTICIPANT IN CONVERSATIONS. You are a SILENT MODERATOR. You do NOT answer questions, give recommendations, or join discussions unless EXPLICITLY named/mentioned.
  "reason": "string",
  "classification_analysis": "string" // Provide a brief internal justification (exactly 1 sentence) for your decision on violation and needs_reply. Do NOT put your reply message here.
}

### ANALYSIS INSTRUCTIONS:
- **Mention Check:** Check if the message contains a LITERAL "@AI_Moderator" or "@bot" or "@whatsmod" string. General questions to the group do NOT count.
- **Direct Address:** Is the user talking TO you BY NAME, or just asking the group? If there is ANY ambiguity, the answer is NO.
- **Silence Precedence:** If you are even 1% unsure if you should reply, you MUST stay silent (needs_reply: false). When in doubt, ALWAYS return false.
- URL Assessment: Assess content type based on URL or creator (e.g. devdoesreviews is High-Value). 
- **Silence Precedence (Moderation):** If you are even 1% unsure if a link is high-value or junk, you MUST stay silent (violation: false).
`;

        const pass1Result = await this._callLLM(pass1SystemPrompt, transcript, pendingImages);

        // --- HARD GATE: Override LLM's needs_reply if bot was NOT actually @mentioned ---
        // The LLM cannot reliably distinguish @mentions of the bot from @mentions of other users
        // when raw LID numbers appear in the transcript. This code-level gate is the authoritative check.
        if (pass1Result && pass1Result.needs_reply && !isBotMentioned) {
            // Also check for textual name-based addressing (e.g. "hey bot", "@whatsmod")
            const lastMsg = messages[messages.length - 1] || '';
            const botNamePatterns = /\b(bot|whatsmod|ai.?mod|moderator)\b/i;
            const hasTextualMention = botNamePatterns.test(lastMsg);

            if (!hasTextualMention) {
                console.log(`[LLM HARD GATE] Overriding needs_reply=true -> false. Bot was NOT @mentioned and no textual name match. LLM reason: "${pass1Result.classification_analysis || pass1Result.reason}"`);
                pass1Result.needs_reply = false;
            }
        }

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
  "action": "string", // "strike" for violations, "reply" ONLY if the user explicitly @mentioned or named the bot, "none" for ALL other cases
  "target_user": "string", // The sender of the message being addressed
  "reply_message": "string" // MUST be "" (empty string) if action is "none". Only populate if action is "strike" or "reply".
}

### RESPONSE INSTRUCTIONS:
- **DEFAULT ACTION IS "none":** Unless there is a clear violation (action: "strike") or the user EXPLICITLY addressed the bot by name/mention (action: "reply"), the action MUST be "none" and reply_message MUST be empty.
- Tone: Adjust severity based on USER PERFORMANCE STATS and your persona.
- Consistency: Cite previous offenses naturally if applicable.
- Brevity: Keep it human and concise.
- **Strict Silence:** Do NOT reply to general group questions, recommendations requests, or casual conversation. You are a MODERATOR, not a participant. Only reply if the user literally used your name or @mention.
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
