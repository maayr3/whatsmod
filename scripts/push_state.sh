#!/bin/bash

# Configuration - Update these with your VM details
VM_USER="yourusername"
VM_HOST="your.vm.ip.address"
VM_PATH="/path/to/whatsmod" # E.g., /opt/whatsmod, /home/ubuntu/whatsmod

echo "Pushing state to $VM_USER@$VM_HOST:$VM_PATH..."

# Sync the auth folder
if [ -d ".wwebjs_auth" ]; then
    echo "Syncing .wwebjs_auth..."
    rsync -avz --progress .wwebjs_auth/ "$VM_USER@$VM_HOST:$VM_PATH/.wwebjs_auth/"
else
    echo "Warning: .wwebjs_auth not found. Have you scanned the QR code locally?"
fi

# Sync the cache folder
if [ -d ".wwebjs_cache" ]; then
    echo "Syncing .wwebjs_cache..."
    rsync -avz --progress .wwebjs_cache/ "$VM_USER@$VM_HOST:$VM_PATH/.wwebjs_cache/"
fi

# Sync the env file
if [ -f ".env" ]; then
    echo "Syncing .env..."
    scp .env "$VM_USER@$VM_HOST:$VM_PATH/"
fi

# Sync the database (so offenses aren't lost)
if [ -f "database.json" ]; then
    echo "Syncing database.json..."
    scp database.json "$VM_USER@$VM_HOST:$VM_PATH/"
fi

echo ""
echo "State push complete!"
echo "Don't forget to restart the whatsmod service on the VM if it's currently running."
