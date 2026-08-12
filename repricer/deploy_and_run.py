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

print("Запускаю onOpen() для создания меню...")

# Сначала нужно развернуть как Web App для доступа
# Создаем версию
version_request = {
    'description': 'Версия 1 - создание меню'
}

try:
    # Создаем версию
    version = script_service.projects().versions().create(
        scriptId=script_id,
        body=version_request
    ).execute()
    
    version_number = version.get('versionNumber')
    print(f"✅ Версия создана: {version_number}")
    
    # Развертываем как Web App
    deployment_request = {
        'versionNumber': version_number,
        'manifestFileName': 'appsscript',
        'entryPoint': 'onOpen',
        'executeAs': 'USER_ACCESSING',
        'webApp': {
            'access': 'MYSELF'
        }
    }
    
    deployment = script_service.projects().deployments().create(
        scriptId=script_id,
        body=deployment_request
    ).execute()
    
    deployment_id = deployment.get('deploymentId')
    print(f"✅ Развертывание создано: {deployment_id}")
    print(f"URL: https://script.google.com/macros/s/{script_id}/exec")
    
    print(f"\n📋 Инструкция:")
    print(f"1. Открой таблицу: https://docs.google.com/spreadsheets/d/1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE/edit")
    print(f"2. Extensions → Apps Script")
    print(f"3. Нажми Run → Выбери 'onOpen'")
    print(f"4. Разреши доступ")
    print(f"5. Закрой редактор скрипта")
    print(f"6. Перезагрузи таблицу (F5)")
    print(f"7. Появится меню 'Репрайсер'")
    
except Exception as e:
    print(f"❌ Ошибка: {str(e)}")
    import traceback
    traceback.print_exc()