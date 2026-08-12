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
