# Gmail Skill

## Purpose
Работа с Gmail API: чтение, отправка, поиск, управление почтой.

## Setup
1. Google Cloud Project с включенным Gmail API
2. OAuth credentials настроены
3. Scopes: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`

## Commands
- `check inbox` — проверить новые письма
- `search <query>` — поиск писем
- `read <id>` — прочитать письмо
- `send <to> <subject> <body>` — отправить письмо

## Usage
В сообщениях используй команды или просто опиши что нужно.

## Notes
- Все операции требуют авторизации
- Используй memory для контекста переписок