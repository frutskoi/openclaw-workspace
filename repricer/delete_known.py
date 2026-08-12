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

# Известные ID проектов для удаления
projects_to_delete = [
    '1Nan5GqIv2eY4tC-wmdrOQaxkEGL_9vbISnSfCN1c4vcwnXGUfVRrm6Qo',  # Первый проект
    # Добавь другие ID если нужно
]

active_id = '11-BwnBOqLr-1-3JAwS0qXj4_hbByfwfG6wdiKVn3Gsum_cMmq7isBEyb'

print(f"Активный проект: {active_id}")
print("\nУдаляю лишние проекты...")

deleted_count = 0
for script_id in projects_to_delete:
    if script_id != active_id:
        try:
            script_service.projects().delete(scriptId=script_id).execute()
            print(f"✅ Удален: {script_id}")
            deleted_count += 1
        except Exception as e:
            print(f"❌ Ошибка удаления {script_id}: {str(e)}")

print(f"\n✅ Готово! Удалено проектов: {deleted_count}")
print(f"✅ Остался только активный: {active_id}")