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

with open('/home/clawd/.openclaw/workspace/repricer/scripts/full_script_with_proxy.gs', 'r') as f:
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

print("Обновляю код с прокси...")
try:
    response = script_service.projects().updateContent(
        scriptId=script_id,
        body=file_request
    ).execute()

    print("✅ Код обновлен!")
    print(f"URL: https://script.google.com/d/{script_id}/edit")
    print(f"\n📋 Что изменилось:")
    print(f"- Добавлен прокси через cors-anywhere.herokuapp.com")
    print(f"- Теперь WB API доступен из Apps Script")
    print(f"\n1. Перезагрузи таблицу (F5)")
    print(f"2. Нажми 'Загрузить данные с ВБ'")
    print(f"3. Проверь данные и логи")
    
except Exception as e:
    print(f"❌ Ошибка: {str(e)}")