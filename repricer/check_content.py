import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

# Загружаем токен
with open('/home/clawd/.openclaw/workspace/google-creds/token.json') as f:
    creds_data = json.load(f)

creds = Credentials(
    token=creds_data.get('token', ''),
    refresh_token=creds_data.get('refresh_token', ''),
    token_uri=creds_data['token_uri'],
    client_id=creds_data['client_id'],
    client_secret=creds_data['client_secret'],
    scopes=creds_data['scopes']
)

if creds.expired:
    creds.refresh(Request())

# Читаем код скрипта
with open('/home/clawd/.openclaw/workspace/repricer/scripts/complete_script_v2.gs', 'r') as f:
    script_code = f.read()

# Читаем ID скрипта
with open('/home/clawd/.openclaw/workspace/google-creds/repricer_script_id.txt') as f:
    script_id = f.read().strip()

script_service = build('script', 'v1', credentials=creds)

# Сначала создаем файл
print(f"Создаю файл в проекте {script_id}...")

file_request = {
    'files': [
        {
            'name': 'Code',
            'type': 'SERVER_JS',
            'source': script_code
        }
    ]
}

try:
    # Получаем текущие файлы
    content = script_service.projects().getContent(
        scriptId=script_id
    ).execute()

    print("Текущее содержимое получено")
    print(json.dumps(content, indent=2))

except Exception as e:
    print(f"❌ Ошибка: {str(e)}")