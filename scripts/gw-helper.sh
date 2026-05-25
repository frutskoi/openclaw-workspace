#!/bin/bash
# Quick Google Workspace access for OpenClaw

WORKSPACE="$HOME/.openclaw/workspace"

case "$1" in
    auth)
        echo "🔐 Starting Google Workspace authorization..."
        cd "$WORKSPACE" && ~/.openclaw/venv/bin/python google-oauth-server.py
        ;;
    check)
        echo "🔍 Checking Google Workspace status..."
        /home/clawd/.openclaw/workspace/scripts/google-check.sh
        ;;
    test)
        echo "🧪 Running Google Workspace tests..."
        /home/clawd/.openclaw/workspace/scripts/google-test.sh
        ;;
    status)
        if [ -f "$HOME/.openclaw/workspace/google-creds/token.json" ]; then
            echo "✅ Google Workspace: Authorized"
            echo "Token: $(cat $HOME/.openclaw/workspace/google-creds/token.json | jq -r '.access_token // "invalid" | cut -c1-20')..."
        else
            echo "❌ Google Workspace: Not authorized"
        fi
        ;;
    *)
        echo "Google Workspace Helper"
        echo ""
        echo "Usage: gw <command>"
        echo ""
        echo "Commands:"
        echo "  gw auth     - Start OAuth authorization flow"
        echo "  gw check    - Check current status (emails, events, files)"
        echo "  gw test     - Run full setup test"
        echo "  gw status   - Quick status check"
        echo ""
        echo "For service operations, use:"
        echo "  ~/workspace/scripts/google.sh <service> <action>"
        echo ""
        echo "Examples:"
        echo "  ~/workspace/scripts/google.sh gmail list 10"
        echo "  ~/workspace/scripts/google.sh calendar list 7"
        echo "  ~/workspace/scripts/google.sh drive search 'report'"
        exit 1
        ;;
esac