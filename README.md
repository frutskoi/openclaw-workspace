# OpenClaw Workspace

Configuration and data for OpenClaw AI assistant.

## Structure

- `AGENTS.md` - Agent workspace rules
- `SOUL.md` - Personality and behavior
- `USER.md` - User information
- `MEMORY.md` - Long-term memory (if exists)
- `memory/` - Daily notes
- `skills/` - OpenClaw skills
- `scripts/` - Helper scripts
- `google-*.py` - Google Workspace integration

## Security

**⚠️ NEVER commit credentials!**
- `google-creds/` contains sensitive OAuth tokens
- Any API keys or secrets

These are excluded by `.gitignore`.

## Backup Strategy

- This workspace backs up configuration and personality
- Sensitive data (tokens, API keys) must be backed up separately
- Memory files (`memory/*.md`) are too large for Git - backup manually if needed

## Google Workspace Integration

OAuth2-based integration with Google APIs:
- Gmail (read/send)
- Calendar (read/create)
- Drive (list/search)
- Sheets (read/write)
- Docs (read)

See `skills/google-workspace/SKILL.md` for usage instructions.

## Setup

1. Install GitHub CLI (gh) for automated backups
2. Create GitHub repository
3. Run initial commit
4. Configure automated backups via cron

## Recovery

To restore this workspace:
1. Clone repository
2. Set up credentials manually (never backed up)
3. Verify all scripts work