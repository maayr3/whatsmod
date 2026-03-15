#!/bin/bash
echo "Pulling latest code..."
git pull

echo "Installing dependencies..."
npm install

echo "Restarting whatsmod service..."
sudo systemctl restart whatsmod
echo "Done!"
