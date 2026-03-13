# WhatsApp Group Moderator Bot – Architecture & Business Logic Spec

## 1. Core Purpose
The bot acts as an automated community moderator for WhatsApp groups. Its primary goal is to keep discussions on-topic, foster a positive environment, and redirect off-topic or inappropriate content, all while responding with a human-like tone and providing value-add data when applicable.

## 2. Infrastructure & Connection
* **Platform:** Node.js
* **WhatsApp Library:** `whatsapp-web.js` (unofficial headless browser wrapper). Used because the official Meta API does not easily support joining user-created groups without business verification constraints.
* **Authentication:** LocalAuth instance, which saves a session locally after an initial QR code scan via `qrcode-terminal`.
* **LLM Routing:** Google AI Studio via the OpenAI SDK compatibility layer.
* **Rate-Limit Backoff:** Implements an automated cascading fallback to maximize quality and usability. The LLM queue originates requests at `gemini-3.0-pro`. If daily quotas or rate limits are hit (429/503), it seamlessly backs off down the chain: `gemini-3.0-pro` -> `gemini-2.5-pro` -> `gemini-2.5-flash` -> `gemini-2.5-flash-lite`.
* **Group Whitelisting:** By specifying `TARGET_GROUP` inside the `.env` configuration, the bot will filter out and ignore all incoming events from any external or private group chats the host phone belongs to. It strictly reads/moderates the specified target group name.

## 3. Core Logic & State Management (Bot Concurrency)
To avoid overwhelming the LLM and the chat with API calls on every single message (especially during burst-typing):
* **Sliding Window Context:** The bot maintains a rolling array of the last 20 messages per chat. It records the Sender and Text in the format `[Sender]: Message`. This gives the LLM full conversational context rather than evaluating messages in isolation.
* **3-Second Debounce:** When a message is received, it is added to the chat's sliding window and a 3-second timer starts. If another message arrives *within* those 3 seconds, the timer resets. The LLM evaluation is only triggered when the chat has gone idle for a full 3 seconds.

## 4. LLM Structure & Output
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

## 5. Persistent Memory & Actions
* **Database:** `bot/database.js` manages a persistent flat-file `database.json`. It tracks users and their total strike counts.
* **Stat Retrievals:** When a violation occurs, the system logs the strike, increments the database, and pairs the LLM's `reply_message` with the strike count to inform the user.
* **Direct Commands:** The bot intercepts explicit commands like `@bot stats` or `stats` to dump the user's current strike tally into the chat *without* invoking the LLM, saving on API costs and reducing latency.

## 6. System Markers (Context Injection)
When the bot issues a warning, it alters the active sliding window by injecting a system log:
`[System]: Warned [User] for [Reason]`
This is a critical architectural requirement. It prevents the LLM from repeatedly flagging the same offense when evaluating subsequent messages in the same 20-message transcript.
