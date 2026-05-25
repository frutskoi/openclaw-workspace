#!/bin/bash
# Test Google Workspace Setup

echo "🔍 Testing Google Workspace Setup..."
echo ""

# Check Python venv
echo "1️⃣ Python Environment:"
if ~/.openclaw/venv/bin/python --version &>/dev/null; then
    echo "   ✅ Python venv: OK"
    ~/.openclaw/venv/bin/python --version
else
    echo "   ❌ Python venv: Missing"
fi

echo ""

# Check dependencies
echo "2️⃣ Python Dependencies:"
if ~/.openclaw/venv/bin/python -c "import google.auth" 2>/dev/null; then
    echo "   ✅ google-auth: Installed"
else
    echo "   ❌ google-auth: Missing"
fi

if ~/.openclaw/venv/bin/python -c "import googleapiclient" 2>/dev/null; then
    echo "   ✅ google-api-python-client: Installed"
else
    echo "   ❌ google-api-python-client: Missing"
fi

if ~/.openclaw/venv/bin/python -c "import requests" 2>/dev/null; then
    echo "   ✅ requests: Installed"
else
    echo "   ❌ requests: Missing"
fi

echo ""

# Check credentials
echo "3️⃣ Credentials:"
if [ -f "$HOME/.openclaw/workspace/google-creds/client_secret.json" ]; then
    echo "   ✅ client_secret.json: Present"
else
    echo "   ❌ client_secret.json: Missing"
fi

if [ -f "$HOME/.openclaw/workspace/google-creds/token.json" ]; then
    echo "   ✅ token.json: Present"
    echo "   📊 Token status:"
    cat "$HOME/.openclaw/workspace/google-creds/token.json" | jq -r '{
        access: .access_token[:20] + "...",
        refresh: (.refresh_token // null),
        expires: .expires_in // "unknown"
    }'
else
    echo "   ❌ token.json: Missing (needs authorization)"
fi

echo ""

# Check scripts
echo "4️⃣ Scripts:"
for script in google-auth.sh google-check.sh google.sh; do
    if [ -f "$HOME/.openclaw/workspace/scripts/$script" ]; then
        echo "   ✅ $script: Present"
    else
        echo "   ❌ $script: Missing"
    fi
done

echo ""

# Check skill
echo "5️⃣ OpenClaw Skill:"
if [ -f "$HOME/.openclaw/workspace/skills/google-workspace/SKILL.md" ]; then
    echo "   ✅ google-workspace skill: Present"
else
    echo "   ❌ google-workspace skill: Missing"
fi

echo ""
echo "✅ Test complete!"
echo ""
echo "📝 Next steps:"
echo "   - If missing token: Run ~/workspace/scripts/google-auth.sh"
echo "   - If missing deps: Run ~/.openclaw/venv/bin/pip install google-auth google-auth-oauthlib google-api-python-client requests"
echo "   - Test commands: ~/workspace/scripts/google.sh gmail list"