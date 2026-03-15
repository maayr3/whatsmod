# WhatsApp Group Moderator Bot – Architecture & Business Logic Spec

## 1. Core Purpose
The bot acts as an automated community moderator for WhatsApp groups. Its primary goal is to keep discussions on-topic, foster a positive environment, and redirect off-topic or inappropriate content, all while responding with a human-like tone and providing value-add data when applicable.

## 2. Infrastructure & Connection
* **Platform:** Node.js
* **WhatsApp Library:** `whatsapp-web.js` (unofficial headless browser wrapper). Used because the official Meta API does not easily support joining user-created groups without business verification constraints.
* **Authentication:** LocalAuth instance, which saves a session locally after an initial QR code scan via `qrcode-terminal`.
* **LLM Routing:** OpenRouter via the OpenAI SDK compatibility layer.
* **Rate-Limit Backoff:** Implements an automated cascading fallback to maximize quality and usability. If daily quotas or rate limits are hit (429/503/404), the system backs off down the `fallbackCascade` chain defined in `llm.js`.
* **Group Whitelisting:** The bot will process messages in any group that has a corresponding rules file in the `rules/` directory (e.g., `rules/GroupName.md`). This allows for multi-channel support without hardcoding a single target group.

## 3. Core Logic & State Management (Bot Concurrency)
To avoid overwhelming the LLM and the chat with API calls on every single message (especially during burst-typing):
* **Sliding Window Context:** The bot maintains a rolling array of the last 20 messages per chat. It records the Sender and Text in the format `[Sender]: Message`. This gives the LLM full conversational context rather than evaluating messages in isolation.
* **3-Second Debounce:** When a message is received, it is added to the chat's sliding window and a 3-second timer starts. If another message arrives *within* those 3 seconds, the timer resets. The LLM evaluation is only triggered when the chat has gone idle for a full 3 seconds.

## 4. Media Handling
* **Images:** When a new image message is received, the bot downloads it and queues the raw base64 data as a *pending image*. On the next LLM evaluation, pending images are uploaded inline as vision content so the LLM can visually assess them. After that evaluation, the image data is discarded — the message stays in the 20-message rolling window as a text placeholder only (`[Image Attachment]`). **Images already in the 20-message history are never re-uploaded to the LLM.**
* **Videos > 10 MB:** Silently ignored. The message is not added to the transcript and the LLM is not called for it. Videos under the limit are added to the transcript as `[Media Attachment: video]`.
* **Other media (audio, documents, etc.):** Added to the transcript as `[Media Attachment: <type>]` text placeholders only; no binary data is uploaded.

## 5. LLM Structure & Output
* **System Prompting:** Prompts and moderation rules are cleanly loaded from a static `rules.md` file.
* **Structured JSON Return:** The LLM is forced to return strict JSON using `response_format: { type: "json_object" }`. 
  Expected structure:
  ```json
  {
    "violation": boolean,           // true if there is an actionable offense
    "reason": "string",             // internal reasoning
    "action": "strike",             // usually "strike" 
    "target_user": "string",        // precise name/number of the user
    "reply_message": "string"       // The human-like message to send back to the group
  }
  ```

## 6. Persistent Memory & Actions
* **Database:** `bot/database.js` manages a persistent flat-file `database.json`. It tracks users and their total strike counts.
* **Stat Retrievals:** When a violation occurs, the system logs the strike, increments the database, and pairs the LLM's `reply_message` with the strike count to inform the user.
* **Direct Commands:** The bot intercepts explicit commands like `@bot stats` or `stats` to dump the user's current strike tally into the chat *without* invoking the LLM, saving on API costs and reducing latency.

## 7. System Markers (Context Injection)
When the bot issues a warning, it alters the active sliding window by injecting a system log:
`[System]: Warned [User] for [Reason]`
This is a critical architectural requirement. It prevents the LLM from repeatedly flagging the same offense when evaluating subsequent messages in the same 20-message transcript. The prompt generation logic actively uses this marker to split the context into two blocks:
1. **PRIOR CONTEXT (Already Moderated):** Messages before and including the most recent warning.
2. **MESSAGES TO EVALUATE:** Any messages that have arrived since the last warning.

The LLM is strictly instructed to only evaluate the "MESSAGES TO EVALUATE" block for new violations, solving infinite moderation loops.
