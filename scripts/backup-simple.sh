#!/bin/bash
# Backup OpenClaw workspace to GitHub (manual version)

REPO_NAME="openclaw-workspace"

WORKSPACE="$HOME/.openclaw/workspace"
cd "$WORKSPACE" || exit 1

# Check if git is initialized
if [ ! -d ".git" ]; then
    echo "❌ Git not initialized in workspace"
    exit 1
fi

# Check if remote exists
if ! git remote get-url origin &> /dev/null; then
    echo "❌ No GitHub remote configured"
    echo ""
    echo "To set up manually:"
    echo "1. Create a repository on GitHub: https://github.com/new"
    echo "2. Run: git remote add origin <your-repo-url>"
    echo "3. Run: git push -u origin master"
    exit 1
fi

# Add all changes
git add -A

# Check if there are changes
if git diff --cached --quiet; then
    echo "✅ No changes to backup"
    exit 0
fi

# Commit changes
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")
git commit -m "Backup: $TIMESTAMP" -m "Automated backup from OpenClaw"

# Push to GitHub
echo "📤 Pushing to GitHub..."
git push origin master

echo "✅ Backup complete!"
echo "📍 Repository: $(git remote get-url origin)"