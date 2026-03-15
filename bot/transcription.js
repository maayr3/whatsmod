class TranscriptionService {
    constructor() {
        this.apiKey = process.env.OPENROUTER_API_KEY;
        this.baseURL = "https://openrouter.ai/api/v1/chat/completions";
        // Use the same model identifier that the main LLM service uses.
        this.model = "google/gemini-3.1-flash-lite-preview";
    }

    /**
     * Transcribe audio data (base64) using OpenRouter's chat completions with audio input.
     * @param {string} base64Data - Base64 encoded audio data.
     * @param {string} mimeType - MIME type of the audio.
     * @param {object} log - Logger instance.
     * @returns {Promise<string>} - Transcribed text.
     */
    async transcribe(base64Data, mimeType, log) {
        try {
            log.log(`[Transcription] Sending audio to OpenRouter API (${base64Data.length} chars base64)...`);

            let format = 'mp3';
            if (mimeType.includes('ogg') || mimeType.includes('opus')) {
                format = 'ogg';
            } else if (mimeType.includes('wav')) {
                format = 'wav';
            }

            const payload = {
                model: this.model,
                messages: [
                    {
                        role: "user",
                        content: [
                            {
                                type: "text",
                                text: "Transcribe the following audio exactly. Output ONLY the transcribed text, no other conversation or notes."
                            },
                            {
                                type: "input_audio",
                                input_audio: {
                                    data: base64Data,
                                    format: format
                                }
                            }
                        ]
                    }
                ]
            };

            const response = await fetch(this.baseURL, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://github.com/maayr3/whatsmod", // Good practice for OpenRouter
                    "X-Title": "WhatsMod Bot"
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`API Error ${response.status}: ${JSON.stringify(errorData)}`);
            }

            const data = await response.json();
            const text = data.choices[0].message.content.trim();
            log.log(`[Transcription] Result: "${text.substring(0, 50)}${text.length > 50 ? '...' : ''}"`);
            return text;
        } catch (error) {
            log.error(`[Transcription] Error: ${error.message}`);
            throw error;
        }
    }
}

module.exports = TranscriptionService;
