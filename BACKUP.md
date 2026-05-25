# OpenClaw Backup Guide

## GitHub Repository Setup

### Option 1: Create Repository Manually

1. Go to https://github.com/new
2. Create repository: `openclaw-workspace` (or any name)
3. Copy repository URL: `https://github.com/<username>/openclaw-workspace.git`
4. Run:

```bash
cd ~/.openclaw/workspace
git remote add origin https://github.com/<username>/openclaw-workspace.git
git push -u origin master
```

### Option 2: Use GitHub CLI (if installed)

```bash
gh auth login
cd ~/.openclaw/workspace
gh repo create openclaw-workspace --public --source=. --remote=origin --push
```

## Backup Scripts

### Manual Backup

```bash
~/workspace/scripts/backup-simple.sh
```

This will:
- Stage all changes
- Commit with timestamp
- Push to GitHub

### Automated Backup (Cron)

Add to crontab:

```bash
# Backup OpenClaw workspace every 6 hours
0 */6 * * * ~/workspace/scripts/backup-simple.sh >> ~/workspace/.backup.log 2>&1
```

## What Gets Backed Up

✅ **Included:**
- Agent configuration (AGENTS.md, SOUL.md, USER.md)
- Skills and scripts
- Google Workspace integration code
- Documentation

❌ **Excluded (via .gitignore):**
- Google OAuth tokens (`google-creds/`)
- Memory files (`memory/*.md`)
- Session data (`.openclaw/`)
- Python cache files

## Recovery

To restore your workspace:

```bash
# Clone repository
git clone https://github.com/<username>/openclaw-workspace.git ~/.openclaw/workspace
cd ~/.openclaw/workspace

# Restore credentials manually (never backed up)
# Set up Google OAuth again if needed
```

## Security Notes

⚠️ **Never commit sensitive data:**
- OAuth tokens
- API keys
- Passwords
- Personal memory files

These are excluded by `.gitignore`. Verify before pushing:

```bash
git status
git diff --cached
```