#!/bin/bash
# WhatsMod Deployment Script
# This script updates the bot and restarts the service while preserving and backing up the session cache.

set -e # Exit immediately if a command exits with a non-zero status.

echo "--- Starting Deployment ---"

# 1. Update code
echo "[1/5] Pulling latest code from git..."
git pull

# 2. Backup session cache (Safeguard)
if [ -d ".wwebjs_auth" ]; then
    echo "[2/5] Backing up .wwebjs_auth to .wwebjs_auth.bak..."
    # Use rsync for efficient backup, excluding large/unnecessary files
    rsync -a --delete --exclude='SingletonLock' --exclude='SingletonSocket' --exclude='SingletonCookie' .wwebjs_auth/ .wwebjs_auth.bak/
else
    echo "[2/5] Warning: .wwebjs_auth not found. Skipping backup."
fi

# 3. Install dependencies
echo "[3/5] Installing dependencies..."
# Use --no-audit and --no-fund for speed and less noise
npm install --no-audit --no-fund

# 4. Ensure logs directory exists
echo "[4/5] Ensuring logs directory exists..."
mkdir -p logs
chmod 755 logs

# 5. Restart the service
# Note: This assumes the service is named 'whatsmod' and is managed by systemd.
echo "[5/5] Restarting whatsmod service..."
if command -v systemctl >/dev/null 2>&1; then
    sudo systemctl restart whatsmod
    echo "Service restarted successfully."
else
    echo "Warning: systemctl not found. Please restart the bot manually."
fi

echo "--- Deployment Complete ---"
echo "To check for a QR code if the bot isn't responding, run: tail -f logs/System.log"
echo "If the session is lost, you can try restoring from .wwebjs_auth.bak"
