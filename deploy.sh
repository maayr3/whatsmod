#!/bin/bash
echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
npm install

echo "Preparing logs directory..."
mkdir -p logs
chmod 755 logs

echo "Installing logrotate configuration..."
sudo cp whatsmod.logrotate /etc/logrotate.d/whatsmod
sudo chmod 644 /etc/logrotate.d/whatsmod

echo "Restarting whatsmod service..."
sudo systemctl restart whatsmod
echo "Done!"
