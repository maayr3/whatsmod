# WhatsMod Deployment & Secrets Guide

This guide explains how to deploy the WhatsMod bot to a remote server and manage secrets securely.

## 1. Secret Management

All configuration and secrets are managed via the `.env` file. 

### Local Setup
1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your details:
   - `OPENROUTER_API_KEY`: Your OpenRouter API key.
   - `DEBUG_LEVEL`: Set to `1` for detailed moderation justifications.

> [!IMPORTANT]
> Never commit your `.env` file to version control. It is already included in `.gitignore`.

## 2. Pushing State (Secrets & Session)

To avoid re-scanning the QR code on the server and to transfer your secrets, use the `scripts/push_state.sh` script.

### Usage
```bash
./scripts/push_state.sh <vm_host> [vm_user] [vm_path]
```

**Example:**
```bash
./scripts/push_state.sh 192.168.1.100 ubuntu /home/ubuntu/whatsmod
```

This script will sync:
- `.env` (Your secrets)
- `.wwebjs_auth/` (WhatsApp session data)
- `database.json` (Existing violation history)

## 3. Remote Deployment

Once the state is pushed, you can update the code on the VM using `deploy.sh`.

### deploy.sh (on the VM)
The script perform these actions:
1. `git pull`: Gets latest code.
2. `npm install`: Updates dependencies.
3. `sudo systemctl restart whatsmod`: Restarts the service.

## 4. Systemd Service Setup

To ensure the bot runs automatically on the server, create a systemd service file at `/etc/systemd/system/whatsmod.service`:

```ini
[Unit]
Description=WhatsMod Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/whatsmod
ExecStart=/usr/bin/npm start
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

### Commands
- **Start:** `sudo systemctl start whatsmod`
- **Enable (on boot):** `sudo systemctl enable whatsmod`
- **Logs:** `journalctl -u whatsmod -f`
