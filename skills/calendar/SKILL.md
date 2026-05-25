# Calendar Skill

## Purpose
Работа с Google Calendar API: события, встречи, напоминания.

## Setup
1. Google Cloud Project с включенным Calendar API
2. OAuth credentials настроены
3. Scopes: `https://www.googleapis.com/auth/calendar`

## Commands
- `list events` — список событий
- `add event <title> <start> <end>` — добавить событие
- `event details <id>` — детали события
- `update event <id>` — обновить событие

## Usage
Опиши событие или попроси управление календарем.

## Notes
- Все времена в UTC или указывай timezone
- Проверяй пересечения событий перед созданием