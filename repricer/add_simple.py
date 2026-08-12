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

with open('/home/clawd/.openclaw/workspace/repricer/scripts/complete_script_v2.gs', 'r') as f:
    script_code = f.read()

with open('/home/clawd/.openclaw/workspace/google-creds/repricer_script_id.txt') as f:
    script_id = f.read().strip()

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

print(f"Добавляю простой код в {script_id}...")
try:
    response = script_service.projects().updateContent(
        scriptId=script_id,
        body=file_request
    ).execute()

    print("✅ Код добавлен!")
except Exception as e:
    print(f"❌ Ошибка: {str(e)}")