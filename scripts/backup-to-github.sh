#!/bin/bash
# Backup OpenClaw workspace to GitHub

REPO_NAME="openclaw-workspace"
GITHUB_USER="${GITHUB_USER:-openclaw-backup}"

WORKSPACE="$HOME/.openclaw/workspace"
cd "$WORKSPACE" || exit 1

# Check if GitHub CLI is available
if ! command -v gh &> /dev/null; then
    echo "❌ GitHub CLI (gh) not installed"
    echo "Install: curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg"
    exit 1
fi

# Check if logged in
if ! gh auth status &> /dev/null; then
    echo "❌ Not logged into GitHub"
    echo "Run: gh auth login"
    exit 1
fi

# Check if remote exists
if ! git remote get-url origin &> /dev/null; then
    echo "📦 Creating GitHub repository..."
    gh repo create "$REPO_NAME" --public --source=. --remote=origin --push
    echo "✅ Repository created: https://github.com/$GITHUB_USER/$REPO_NAME"
else
    echo "📤 Pushing to existing repository..."
fi

# Add all changes
git add -A

# Check if there are changes
if git diff --cached --quiet; then
    echo "✅ No changes to commit"
    exit 0
fi

# Commit changes
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
git commit -m "Backup: $TIMESTAMP" -m "Automated backup from OpenClaw"

# Push to GitHub
git push origin master

echo "✅ Backup complete!"
echo "📍 Repository: $(git remote get-url origin)"