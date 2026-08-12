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

# Список всех проектов
print("Получаю список всех Apps Script проектов...")
projects = []

# Пагинация для получения всех проектов
page_token = None
while True:
    result = script_service.projects().list(
        pageToken=page_token,
        pageSize=100
    ).execute()
    
    if 'projects' in result:
        projects.extend(result['projects'])
    
    page_token = result.get('nextPageToken')
    if not page_token:
        break

print(f"Всего проектов: {len(projects)}")
print("\nСписок проектов:")
for i, p in enumerate(projects, 1):
    title = p.get('title', 'Без названия')
    script_id = p.get('scriptId', 'Нет ID')
    create_time = p.get('createTime', 'Нет даты')
    print(f"{i}. {title}")
    print(f"   ID: {script_id}")
    print(f"   Создан: {create_time}")
    print()

# Удаляем все кроме активного
active_id = '11-BwnBOqLr-1-3JAwS0qXj4_hbByfwfG6wdiKVn3Gsum_cMmq7isBEyb'

print(f"Активный проект: {active_id}")
print("\nУдаляю лишние проекты...")

deleted_count = 0
for p in projects:
    script_id = p.get('scriptId')
    if script_id and script_id != active_id:
        try:
            script_service.projects().delete(scriptId=script_id).execute()
            print(f"✅ Удален: {p.get('title', 'Без названия')} ({script_id})")
            deleted_count += 1
        except Exception as e:
            print(f"❌ Ошибка удаления {p.get('title', 'Без названия')}: {str(e)}")

print(f"\n✅ Готово! Удалено проектов: {deleted_count}")
print(f"✅ Остался только активный: {active_id}")