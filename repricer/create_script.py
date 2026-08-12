import json
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

# Загружаем обновленный токен
with open('/home/clawd/.openclaw/workspace/google-creds/token.json') as f:
    creds_data = json.load(f)

# Создаем credentials
# Создаем credentials
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
with open('/home/clawd/.openclaw/workspace/repricer/scripts/complete_script.gs', 'r') as f:
    script_code = f.read()

# Создаем Apps Script проект
script_service = build('script', 'v1', credentials=creds)

request = {
    'title': 'Репрайсер WB',
    'parentId': '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE'
}

print("Создаю Apps Script проект...")
try:
    response = script_service.projects().create(body=request).execute()

    script_id = response.get('scriptId')
    script_url = f"https://script.google.com/d/{script_id}/edit"

    print("✅ Проект создан!")
    print(f"Script ID: {script_id}")
    print(f"URL: {script_url}")

    # Сохраняем ID
    with open('/home/clawd/.openclaw/workspace/google-creds/repricer_script_id.txt', 'w') as f:
        f.write(script_id)

    print(f"\n✅ ID сохранен")
    print(f"\n📊 Скрипт готов!")

except Exception as e:
    print(f"❌ Ошибка: {str(e)}")
    import traceback
    traceback.print_exc()