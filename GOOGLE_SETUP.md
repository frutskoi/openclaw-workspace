# Google Workspace Integration

## Setup Complete ✅

**Google Cloud Project:** `openclaw-integration-497405`
**Client ID:** `864225289733-i7prgopau73ojgevfrk18o17avt0a7ru.apps.googleusercontent.com`
**Credentials:** `/home/clawd/.openclaw/secrets/google-credentials.json`

## Enabled Services

**Not yet enabled in Google Cloud:**
- Gmail API
- Google Calendar API
- Google Drive API
- Google Sheets API
- Google Docs API
- Google Apps Script API

## Next Steps

1. **Enable APIs in Google Cloud Console:**
   - https://console.cloud.google.com/apis/library
   - Search and enable each API

2. **Test OAuth flow:**
   ```bash
   # Will be implemented in skills
   ```

3. **Skills Created:**
   - `skills/gmail/SKILL.md`
   - `skills/calendar/SKILL.md`

## Usage Examples

**Gmail:**
- "Проверь почту"
- "Найди письма от John"
- "Отправь письмо boss@example.com"

**Calendar:**
- "Что сегодня в календаре?"
- "Добавь встречу завтра в 14:00"
- "Список событий на этой неделе"

**Drive:**
- "Список файлов на Drive"
- "Загрузи файл"
- "Поделись файлом"

## Notes

OAuth credentials сохранены. Google plugin в OpenClaw это только model provider, для сервисов нужны навыки.

Пока API не включены в Google Cloud — навыки не будут работать.

## Memory Update

Update MEMORY.md with Google setup details.