#!/bin/bash

# Usage: ./scripts/push_state.sh <vm_host> [vm_user] [vm_path]
# Example: ./scripts/push_state.sh 192.168.1.100
# Example: ./scripts/push_state.sh 192.168.1.100 matt /opt/whatsmod

if [ -z "$1" ]; then
    echo "Usage: $0 <vm_host> [vm_user] [vm_path]"
    exit 1
fi

VM_HOST="$1"
VM_USER="${2:-ubuntu}"
VM_PATH="${3:-whatsmod}"

echo "Pushing state to $VM_USER@$VM_HOST:$VM_PATH..."

# Ensure the remote directory exists
echo "Ensuring remote directory $VM_PATH exists..."
ssh "$VM_USER@$VM_HOST" "mkdir -p $VM_PATH"


# Sync the auth folder
if [ -d ".wwebjs_auth" ]; then
    echo "Syncing .wwebjs_auth..."
    rsync -avz --progress --exclude='SingletonLock' --exclude='SingletonSocket' --exclude='SingletonCookie' .wwebjs_auth/ "$VM_USER@$VM_HOST:$VM_PATH/.wwebjs_auth/"
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
