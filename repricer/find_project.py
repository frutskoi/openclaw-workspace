import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

with open('/home/clawd/.openclaw/workspace/google-creds/token.json') as f:
    creds_data = json.load(f)

creds = Credentials(
    token=creds_data['token'],
    refresh_token=creds_data['refresh_token'],
    token_uri=creds_data['token_uri'],
    client_id=creds_data['client_id'],
    client_secret=creds_data['client_secret'],
    scopes=creds_data['scopes']
)

if creds.expired:
    creds.refresh(Request)

script_service = build('script', 'v1', credentials=creds)
spreadsheet_id = '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE'

# Проверяем существующий скрипт в таблице
ss_service = build('sheets', 'v4', credentials=creds)

# Проверяем metadata
ss = ss_service.spreadsheets().get(
    spreadsheetId=spreadsheet_id,
    fields='properties'
).execute()

print(f"Таблица: {ss['properties']['title']}")

# Проверяем через Drive
drive_service = build('drive', 'v3', credentials=creds)

# Ищем файлы в той же папке
folder = ss['properties']['title']

print(f"\nИщу скрипт 'Репрайсер WB (openclaw)'...")
q = f"name = 'Репрайсер WB (openclaw)' and mimeType = 'application/vnd.google-apps.script'"
files = drive_service.files().list(q=q, pageSize=10).execute()

if files.get('files'):
    for f in files['files']:
        print(f"✅ Найден: {f['name']}")
        print(f"   ID: {f['id']}")
        print(f"   Parents: {f.get('parents', [])}")
        
        # Проверяем содержимое
        try:
            cont = script_service.projects().getContent(scriptId=f['id']).execute()
            print(f"   Файлов: {len(cont.get('files', []))}")
            for file in cont.get('files', []):
                print(f"     - {file.get('name', '')} ({file.get('type', '')})")
        except Exception as e:
            print(f"   Ошибка: {str(e)[:50]}")
else:
    print("❌ Проект 'Репрайсер WB (openclaw)' не найден")
    print("\nВозможно, название другое. Проверяю в Google Drive:")
    print("https://drive.google.com/drive/u/0/search?q=Репрайсер+WB+openclaw")