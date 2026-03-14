#!/bin/bash

# This script automates git add, commit, and push.
# Usage: ./scripts/auto_commit_push.sh "Commit message"

if [ -z "$1" ]; then
  echo "Error: No commit message provided."
  echo "Usage: $0 \"Your commit message\""
  exit 1
fi

MESSAGE="$1"

echo "Staging changes..."
git add .

echo "Committing changes with message: $MESSAGE"
git commit -m "[FEATURE] $MESSAGE"

echo "Pushing to origin main..."
git push origin main

echo "Done!"
