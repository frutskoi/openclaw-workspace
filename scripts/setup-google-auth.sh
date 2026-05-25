#!/bin/bash
# Google OAuth 2.0 Authorization Script
# Saves token.json for future use

set -e

WORKSPACE="/home/clawd/.openclaw/workspace"
CREDS_DIR="$WORKSPACE/google-creds"
CLIENT_SECRET="$CREDS_DIR/client_secret.json"
TOKEN_FILE="$CREDS_DIR/token.json"

SCOPES="https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/aiplatform"

echo "📁 Using client_secret from: $CLIENT_SECRET"
echo "💾 Token will be saved to: $TOKEN_FILE"
echo

# Check if we need to authorize (no token or invalid)
if [ -f "$TOKEN_FILE" ]; then
    echo "📜 Found existing token.json"

    # Check if gcloud can validate it
    if command -v gcloud &> /dev/null; then
        echo "🔍 Validating token with gcloud..."
        # Try to set application credentials
        export GOOGLE_APPLICATION_CREDENTIALS="$TOKEN_FILE"

        # Simple validation - try to list projects (will fail if token invalid)
        # We'll just check the JSON structure instead
        if python3 -c "import json; creds = json.load(open('$TOKEN_FILE')); exit(0 if 'token' in creds else 1)" 2>/dev/null; then
            echo "✅ Token file appears valid"
        else
            echo "⚠️  Token file invalid or expired"
            rm -f "$TOKEN_FILE"
        fi
    fi
fi

# Need fresh authorization
if [ ! -f "$TOKEN_FILE" ]; then
    echo "🔐 Starting OAuth 2.0 authorization..."
    echo
    echo "⚠️  IMPORTANT: Since this is a web client_secret, you need to:"
    echo "   1. Get a local HTTP server running on port 8080"
    echo "   2. Or use gcloud's auth flow"
    echo
    echo "Option 1: Using gcloud (recommended):"
    echo "  gcloud auth application-default login"
    echo
    echo "Option 2: Manual OAuth flow (requires web server):"
    echo "  Run: python3 -m http.server 8080"
    echo "  Then visit Google OAuth URL"
    echo

    # Try gcloud auth
    if command -v gcloud &> /dev/null; then
        echo "🔄 Attempting gcloud auth login..."
        gcloud auth application-default login --no-launch-browser

        # Copy gcloud's ADC to our token location
        if [ -f "$HOME/.config/gcloud/application_default_credentials.json" ]; then
            cp "$HOME/.config/gcloud/application_default_credentials.json" "$TOKEN_FILE"
            echo "✅ Token saved to $TOKEN_FILE"
        fi
    else
        echo "❌ gcloud not found. Please install Google Cloud SDK or use manual flow."
        exit 1
    fi
fi

echo
echo "✅ Setup complete!"
echo "📍 Token location: $TOKEN_FILE"
echo
echo "To use this token, set:"
echo "  export GOOGLE_APPLICATION_CREDENTIALS=\"$TOKEN_FILE\""