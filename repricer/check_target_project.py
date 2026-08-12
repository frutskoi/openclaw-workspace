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

script_id = '19PATaFRs-HOczfm3Ez0CY94lQJ6aU_fC9kq38IBu8PVUfeJ7WDtcBy2s'

print("Проверяю проект...")
try:
    content = script_service.projects().getContent(scriptId=script_id).execute()
    
    print(f"✅ Проект найден: {content.get('title', 'Без названия')}")
    print(f"ID: {script_id}")
    print(f"\nФайлы в проекте:")
    for f in content.get('files', []):
        print(f"  - {f.get('name', '')} ({f.get('type', '')})")
        if f.get('type') == 'SERVER_JS':
            source = f.get('source', '')
            lines = source.split('\n')
            print(f"    Строк: {len(lines)}")
            
except Exception as e:
    print(f"❌ Ошибка: {str(e)}")