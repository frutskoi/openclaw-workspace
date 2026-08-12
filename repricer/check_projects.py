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

# Проверяем проекты которые мы создавали
projects = [
    {'id': '1Nan5GqIv2eY4tC-wmdrOQaxkEGL_9vbISnSfCN1c4vcwnXGUfVRrm6Qo', 'name': 'Первый (ошибка авторизации)'},
    {'id': '11-BwnBOqLr-1-3JAwS0qXj4_hbByfwfG6wdiKVn3Gsum_cMmq7isBEyb', 'name': 'Активный (с кодом)'}
]

print("Список Apps Script проектов:\n")
for i, p in enumerate(projects, 1):
    try:
        content = script_service.projects().getContent(
            scriptId=p['id']
        ).execute()
        
        title = content.get('title', 'Без названия')
        create_time = content.get('createTime', 'Нет даты')
        
        print(f"{i}. {p['name']}")
        print(f"   Название: {title}")
        print(f"   ID: {p['id']}")
        print(f"   Создан: {create_time}")
        print(f"   URL: https://script.google.com/d/{p['id']}/edit")
        print()
        
    except Exception as e:
        print(f"{i}. {p['name']} - ❌ Ошибка: {str(e)}")
        print()

print("Активный проект (оставить):")
print("✅ 11-BwnBOqLr-1-3JAwS0qXj4_hbByfwfG6wdiKVn3Gsum_cMmq7isBEyb")