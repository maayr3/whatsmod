# WhatsMod - Maintenance Notes (Gemini)

## 🔄 Rule Synchronization (WarRoom & DEBUG)

**IMPORTANT:** The rules for the `DEBUG` channel must ALWAYS be an exact clone of the rules for the `WarRoom` channel.

- **Source of Truth:** [WarRoom.md](file:///Users/mayre/Documents/whatsmod/rules/WarRoom.md)
- **Clone:** [DEBUG.md](file:///Users/mayre/Documents/whatsmod/rules/DEBUG.md)

### Why?
The `DEBUG` channel is used for testing features, and it must mirror the operational environment of the `WarRoom` to ensure tests are valid.

### Character Persona Logic
The **Daily Character Mode** is exclusive to these two channels. The logic is implemented in `bot/llm.js` but relies on the character pool and instructions being present in these rule files.


### Maintenance Workflow:
1. When editing `WarRoom.md`, immediately sync the changes to `DEBUG.md`.
2. Do NOT edit `DEBUG.md` independently.
3. If you add or remove characters, update the `CHARACTER_POOL` array in `bot/llm.js` as well (inside the conditional block).

## 🚀 Deployment & Integrity
- **ALWAYS commit, push, and deploy** when a feature or fix is completed and the user gives the "go ahead".
- Use the `/complete-feature` and `/deploy` workflows to maintain the remote VM's state.
