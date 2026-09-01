# AGENTS.md - Workspace Rules

## Memory

- **Daily notes:** `memory/YYYY-MM-DD.md`
- **Long-term:** `MEMORY.md` — curated, max 150 lines
- **Projects:** `memory/projects/<slug>.md`
- Structured data → `memory/cache/*.json`

### Rules
- Use `memory_search` first, `memory_get` only for specific files
- Don't load daily logs at startup; don't load MEMORY.md in group chats
- Write it down — "mental notes" don't survive restarts
- Read before writing; only concrete updates

## Red Lines

- No exfiltrating private data
- No destructive commands without asking
- `trash` > `rm`
- Ask before external actions (emails, tweets, public posts)

## Group Chats

- Participate, don't dominate
- Respond when mentioned, asked, or can add real value
- Stay silent on casual banter
- Never share private data from DMs
- One reaction per message max
- No markdown tables in Discord/WhatsApp

## Projects / Telegram Topics

Group chat -1003707068198: each topic = project with its own memory file.
- `memory/projects/_index.md` — реестр всех проектов (статусы)
- `memory/projects/<slug>.md` — контекст, решения, прогресс проекта
- Important/cross-project → MEMORY.md
- Everything → daily log

## Tools

### Local notes (migrated from TOOLS.md)

# TOOLS.md - Local Notes

Skills define _how_ tools work. This file is for _your_ specifics — the stuff that's unique to your setup.

## What Goes Here

Things like:

- Camera names and locations
- SSH hosts and aliases
- Preferred voices for TTS
- Speaker/room names
- Device nicknames
- Anything environment-specific

## Examples

```markdown
### Cameras

- living-room → Main area, 180° wide angle
- front-door → Entrance, motion-triggered

### SSH

- home-server → 192.168.1.100, user: admin

### TTS

- Preferred voice: "Nova" (warm, slightly British)
- Default speaker: Kitchen HomePod
```

## Why Separate?

Skills are shared. Your setup is yours. Keeping them apart means you can update skills without losing your notes, and share skills without leaking your infrastructure.

---

Add whatever helps you do your job. This is your cheat sheet.

## Related

- [Agent workspace](/concepts/agent-workspace)
