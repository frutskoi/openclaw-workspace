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

with open('/home/clawd/.openclaw/workspace/repricer/scripts/full_script_es5.gs', 'r') as f:
    script_code = f.read()

script_id = '19PATaFRs-HOczfm3Ez0CY94lQJ6aU_fC9kq38IBu8PVUfeJ7WDtcBy2s'

script_service = build('script', 'v1', credentials=creds)

file_request = {
    'files': [
        {
            'name': 'Code',
            'type': 'SERVER_JS',
            'source': script_code
        },
        {
            'name': 'appsscript',
            'type': 'JSON',
            'source': json.dumps({
                "timeZone": "Europe/Moscow",
                "dependencies": {},
                "exceptionLogging": "STACKDRIVER"
            })
        }
    ]
}

print(f"Добавляю код в проект {script_id}...")
try:
    response = script_service.projects().updateContent(
        scriptId=script_id,
        body=file_request
    ).execute()

    print("✅ Код добавлен!")
    print(f"URL: https://script.google.com/d/{script_id}/edit")
    print(f"\n📋 Что делать:")
    print(f"1. Открой таблицу: https://docs.google.com/spreadsheets/d/1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE/edit")
    print(f"2. Перезагрузи страницу (F5)")
    print(f"3. Появится меню 'Репрайсер'")
    print(f"4. Нажми 'Загрузить данные с ВБ'")
    
except Exception as e:
    print(f"❌ Ошибка: {str(e)}")