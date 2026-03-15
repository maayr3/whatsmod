# 🛡️ whatsmod

### The Ultimate AI-Powered WhatsApp Group Moderator

![whatsmod Hero](./whatsmod_hero.png)

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/Node.js-v16+-green.svg)](https://nodejs.org/)
[![WhatsApp-Web.js](https://img.shields.io/badge/WhatsApp-Web.js-25D366?style=flat&logo=whatsapp&logoColor=white)](https://wwebjs.dev/)

**whatsmod** is a sleek, intelligent, and highly customizable WhatsApp bot designed to keep your groups clean, focused, and engaging. Built for communities that value high-quality discussion, it automatically filters junk media, enforces topicality, and interacts with members using a natural, human-like tone.

---

## ✨ Key Features

- **🤖 Intelligent Moderation**: Uses advanced AI to understand the context of messages and media.
- **🚫 Junk Filter**: Automatically detects and redirects memes, random TikToks, and off-topic comedy clips.
- **🎯 Dynamic Rules**: Easily configure what is "On-Topic" or "Off-Topic" via a simple `rules.md` file.
- **🧠 AGI Chat Mode**: Actively participates in discussions when the topic turns to AGI or when explicitly summoned.
- **⚡ Fast & Lightweight**: Built on Node.js and `whatsapp-web.js` for quick responses and low overhead.
- **📊 Offense Tracking**: Maintains a history of user violations to provide context-aware warnings.

---

## 🚀 Quick Start (3 Steps)

You don't need to be a coder to get **whatsmod** running!

### 1. Requirements
- A computer with **Node.js** installed (v16 or higher).
- A WhatsApp account to use for the bot.

### 2. Setup
1. Clone or download this project.
2. In your terminal, run:
   ```bash
   npm install
   ```
3. Copy `.env.example` to `.env` and add your OpenAI API key:
   ```env
   OPENAI_API_KEY=your_key_here
   ```

### 3. Launch
Run the bot with:
```bash
npm start
```
Scan the **QR Code** that appears in your terminal with your WhatsApp app (Settings > Linked Devices), and you're live! 🛡️

---

## 🛠️ Customizing Your Bot

### Edit the Rules
Open `rules.md` to define exactly what your bot should allow or block. No coding required—just plain English!

### Personalize the Tone
You can change how the bot speaks by updating the `Communication Style` section in `rules.md`. Make it your own!

---

## 📝 License
Distributed under the MIT License. See `LICENSE` for more information.

---

<p align="center">
  Built with ❤️ for better communities.
</p>
