#!/usr/bin/env python3
"""
Получение содержимого проекта Apps Script (первый ID)
"""

import json
import sys
sys.path.insert(0, '/home/clawd/.openclaw/venv/lib/python3.11/site-packages')

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

def get_script_content(script_id):
    """Получает содержимое проекта Apps Script"""
    # Загружаем сохранённые токены
    with open('/home/clawd/.openclaw/workspace/google-creds/token.json', 'r') as f:
        token_data = json.load(f)

    credentials = Credentials.from_authorized_user_info(token_data)

    service = build('script', 'v1', credentials=credentials)

    try:
        # Получаем содержимое проекта
        content = service.projects().getContent(
            scriptId=script_id
        ).execute()

        files = content.get('files', [])

        for file in files:
            file_type = file.get('type', 'unknown')
            name = file.get('name', 'Без имени')
            source = file.get('source', '')

            if file_type == 'SERVER_JS':
                print(f"=== {name} ===")
                print(source)
                print("\n")

            elif file_type == 'JSON':
                print(f"=== {name}.json ===")
                print(source)
                print("\n")

    except Exception as e:
        print(f"Ошибка: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    # ID проекта из ссылки Босса
    script_id = '1892gfpI5y1VsnO3OZ7ngQ9VBjktzF3hD-yv5uQ6YLbFSflgo0cJ8BQVj'

    get_script_content(script_id)