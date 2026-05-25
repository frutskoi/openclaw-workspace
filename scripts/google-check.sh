#!/bin/bash
# Google Workspace Quick Check

CREDS_DIR="$HOME/.openclaw/workspace/google-creds"
TOKEN_FILE="$CREDS_DIR/token.json"
WORKSPACE="$HOME/.openclaw/workspace"

if [ ! -f "$TOKEN_FILE" ]; then
    echo "❌ Google Workspace: Not authorized"
    echo "Run: ~/workspace/scripts/google-auth.sh"
    exit 1
fi

echo "✅ Google Workspace: Authorized"
echo ""
echo "📧 Unread emails:"
cd "$WORKSPACE" && ~/.openclaw/venv/bin/python google-workspace.py gmail list --limit 5 2>/dev/null | jq -r '.unread // 0'
echo ""
echo "📅 Calendar events (7 days):"
cd "$WORKSPACE" && ~/.openclaw/venv/bin/python google-workspace.py calendar list --days 7 2>/dev/null | jq -r '.count // 0'
echo ""
echo "📁 Drive files:"
cd "$WORKSPACE" && ~/.openclaw/venv/bin/python google-workspace.py drive list --limit 10 2>/dev/null | jq -r '.count // 0'