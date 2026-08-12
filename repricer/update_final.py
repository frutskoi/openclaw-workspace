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

with open('/home/clawd/.openclaw/workspace/repricer/scripts/final_script.gs', 'r') as f:
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

print("Обновляю код с собственным прокси...")
try:
    response = script_service.projects().updateContent(
        scriptId=script_id,
        body=file_request
    ).execute()

    print("✅ Код обновлен!")
    print(f"\n📋 Что изменилось:")
    print(f"- Прокси: http://77.110.114.5:5000/")
    print(f"- CORS: разрешен через Flask")
    print(f"- Теперь WB API доступен из Apps Script")
    print(f"\n🔗 Скрипт: https://script.google.com/d/{script_id}/edit")
    print(f"\n📋 Инструкция:")
    print(f"1. Открой скрипт: https://script.google.com/d/{script_id}/edit")
    print(f"2. Нажми Run → onOpen")
    print(f"3. Разреши доступ")
    print(f"4. Перезагрузи таблицу (F5)")
    print(f"5. Нажми 'Загрузить данные с ВБ'")
    
except Exception as e:
    print(f"❌ Ошибка: {str(e)}")