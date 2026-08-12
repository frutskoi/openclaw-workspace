#!/bin/bash

# Скрипт для обновления Google OAuth токена с нужными scopes

echo "=== Обновление OAuth токена для Apps Script ==="
echo ""

# Путь к клиентскому секрету
CLIENT_SECRET="/home/clawd/.openclaw/workspace/google-creds/client_secret.json"

# Новый scopes для Apps Script
NEW_SCOPES="https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/script.projects https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/documents"

# Запускаем Python скрипт для обновления токена
python3 << 'PYEOF'
import json
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse
import threading
import time

# Загружаем client_secret
with open('/home/clawd/.openclaw/workspace/google-creds/client_secret.json') as f:
    client_config = json.load(f)

# Определяем тип конфига
if 'installed' in client_config:
    client_id = client_config['installed']['client_id']
    client_secret = client_config['installed']['client_secret']
    auth_uri = client_config['installed']['auth_uri']
    token_uri = client_config['installed']['token_uri']
    redirect_uri = 'http://localhost:8080'
elif 'web' in client_config:
    client_id = client_config['web']['client_id']
    client_secret = client_config['web']['client_secret']
    auth_uri = client_config['web']['auth_uri']
    token_uri = client_config['web']['token_uri']
    redirect_uri = 'http://localhost:8080'
else:
    raise Exception("Неизвестный формат client_secret")

# Scopes для Apps Script
scopes = [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/documents'
]

# Создаем URL авторизации
auth_params = {
    'response_type': 'code',
    'client_id': client_id,
    'redirect_uri': redirect_uri,
    'scope': ' '.join(scopes),
    'access_type': 'offline',
    'prompt': 'consent'
}

auth_url = f"{auth_uri}?{urllib.parse.urlencode(auth_params)}"

print(f"🌐 Открой в браузере:\n{auth_url}\n")
print("Ожидаю код авторизации...")

# HTTP сервер для получения кода
auth_code = None

class AuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)

        if 'code' in params:
            auth_code = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b"<h1>Authorization successful!</h1><p>You can close this window.</p>")
        else:
            self.send_response(400)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # Отключаем логирование HTTP запросов

# Запускаем сервер
server = HTTPServer(('localhost', 8080), AuthHandler)
server_thread = threading.Thread(target=server.handle_request)
server_thread.start()

# Ждем код
timeout = 300  # 5 минут
start_time = time.time()

while auth_code is None and (time.time() - start_time) < timeout:
    time.sleep(1)

if auth_code is None:
    print("❌ Тайм-аут ожидания кода авторизации")
    server.shutdown()
    exit(1)

server.shutdown()

print("✅ Код авторизации получен")

# Обмениваем код на токен
import requests

token_data = {
    'code': auth_code,
    'client_id': client_id,
    'client_secret': client_secret,
    'redirect_uri': redirect_uri,
    'grant_type': 'authorization_code'
}

print("Получаю токен...")
response = requests.post(token_uri, data=token_data)

if response.status_code == 200:
    token_info = response.json()

    # Сохраняем токен
    with open('/home/clawd/.openclaw/workspace/google-creds/token.json', 'w') as f:
        json.dump({
            'token': token_info['access_token'],
            'refresh_token': token_info['refresh_token'],
            'token_uri': token_uri,
            'client_id': client_id,
            'client_secret': client_secret,
            'scopes': scopes,
            'expiry': token_info.get('expiry')
        }, f, indent=2)

    print("✅ Токен сохранен!")
    print(f"Scopes: {len(scopes)}")
    for scope in scopes:
        print(f"  - {scope}")
else:
    print(f"❌ Ошибка получения токена: {response.status_code}")
    print(response.text)
    exit(1)

PYEOF

echo ""
echo "✅ Токен обновлен с нужными scopes для Apps Script!"