#!/bin/bash
# Google Workspace Authorization Helper

CREDS_DIR="$HOME/.openclaw/workspace/google-creds"
TOKEN_FILE="$CREDS_DIR/token.json"
WORKSPACE="$HOME/.openclaw/workspace"

# Check if authorized
if [ -f "$TOKEN_FILE" ]; then
    echo "✅ Google Workspace: Authorized"
    echo "Token: $(cat $TOKEN_FILE | jq -r '.access_token // "invalid" | cut -c1-20')..."
    exit 0
fi

echo "❌ Google Workspace: Not authorized"
echo ""
echo "Starting OAuth flow..."
echo ""

cd "$WORKSPACE" && ~/.openclaw/venv/bin/python google-oauth-server.py