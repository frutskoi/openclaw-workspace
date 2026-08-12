import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

with open('/home/clawd/.openclaw/workspace/google-creds/token.json') as f:
    creds_data = json.load(f)

creds = Credentials(
    token=creds_data.get('token', ''),
    refresh_token=creds_data.get('refresh_token', ''),
    token_uri=creds_data['token_uri'],
    client_id=creds_data['client_id'],
    client_secret=creds_data.get('client_secret', ''),
    scopes=creds_data['scopes']
)

if creds.expired:
    creds.refresh(Request)

# Читаем код скрипта
with open('/home/clawd/.openclaw/workspace/repricer/scripts/complete_script_v2.gs', 'r') as f:
    script_code = f.read()

# Создаем лист для кода
sheets_service = build('sheets', 'v4', credentials=creds)
spreadsheet_id = '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE'

# Проверяем есть ли лист "Код скрипта"
ss_info = sheets_service.spreadsheets().get(
    spreadsheetId=spreadsheet_id,
    fields='sheets(properties(title))'
).execute()

existing_sheets = [s['properties']['title'] for s in ss_info.get('sheets', [])]

if 'Код скрипта' not in existing_sheets:
    # Создаем новый лист
    add_sheet_request = {
        'requests': [
            {
                'addSheet': {
                    'properties': {
                        'title': 'Код скрипта',
                        'gridProperties': {
                            'rowCount': 1000,
                            'columnCount': 1
                        }
                    }
                }
            }
        ]
    }

    sheets_service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body=add_sheet_request
    ).execute()
    print("✅ Лист 'Код скрипта' создан")
else:
    print("ℹ️ Лист 'Код скрипта' уже существует")

# Находим sheetId для "Код скрипта"
ss_info = sheets_service.spreadsheets().get(
    spreadsheetId=spreadsheet_id,
    fields='sheets(properties(title,sheetId))'
).execute()

script_sheet_id = None
for sheet in ss_info.get('sheets', []):
    if sheet['properties']['title'] == 'Код скрипта':
        script_sheet_id = sheet['properties']['sheetId']
        break

if script_sheet_id:
    # Записываем код в ячейку A1
    lines = script_code.split('\n')
    values = [[line] for line in lines]

    result = sheets_service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f'Код скрипта!A1',
        valueInputOption='USER_ENTERED',
        body={'values': values}
    ).execute()

    print(f"✅ Код записан в лист 'Код скрипта'")
    print(f"   Строк: {len(lines)}")
    print(f"   URL: https://docs.google.com/spreadsheets/d/{spreadsheet_id}/edit?gid={script_sheet_id}")
    print(f"\n📋 Инструкция:")
    print(f"1. Открой лист 'Код скрипта'")
    print(f"2. Выдели ячейки A1:A{len(lines)}")
    print(f"3. Скопируй (Ctrl+C)")
    print(f"4. Открой Extensions → Apps Script")
    print(f"5. Вставь код (Ctrl+V)")
    print(f"6. Сохрани (Ctrl+S)")

else:
    print("❌ Лист 'Код скрипта' не найден")