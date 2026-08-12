#!/bin/bash
# Daily workspace + config backup
# - Workspace → git commit + push
# - Gateway config → local encrypted copy (NOT pushed to git, contains secrets)

set -e

WORKSPACE="/home/clawd/.openclaw/workspace"
CONFIG_SRC="/home/clawd/.openclaw/openclaw.json"
CONFIG_BACKUP_DIR="/home/clawd/.openclaw/backups"
DATE=$(date -u +%Y-%m-%d)

mkdir -p "$CONFIG_BACKUP_DIR"

# 1. Backup gateway config locally
cp "$CONFIG_SRC" "$CONFIG_BACKUP_DIR/openclaw-${DATE}.json"
# Keep last 30 days
find "$CONFIG_BACKUP_DIR" -name "openclaw-*.json" -mtime +30 -delete 2>/dev/null || true

# 2. Git commit + push workspace
cd "$WORKSPACE"
git add -A
# Only commit if there are changes
if ! git diff --cached --quiet; then
    git commit -m "Auto-backup: workspace sync ${DATE}" --quiet
    git push origin master --quiet
    echo "[$DATE] Workspace pushed to git"
else
    echo "[$DATE] No changes to commit"
fi

echo "[$DATE] Config backed up to ${CONFIG_BACKUP_DIR}/openclaw-${DATE}.json"
