#!/usr/bin/env python3
"""
Получение списка файлов в Google Apps Script проекте
"""

import json
import sys
sys.path.insert(0, '/home/clawd/.openclaw/venv/lib/python3.11/site-packages')

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

def get_script_files(script_id):
    """Получает список файлов в проекте Apps Script"""
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

        print(f"Проект: {script_id}")
        print(f"Всего файлов: {len(files)}\n")

        for i, file in enumerate(files, 1):
            name = file.get('name', 'Без имени')
            file_type = file.get('type', 'unknown')
            file_id = file.get('id', '')

            print(f"{i}. {name}")
            print(f"   Тип: {file_type}")
            print(f"   ID: {file_id}")
            print()

        return files

    except Exception as e:
        print(f"Ошибка: {e}")
        import traceback
        traceback.print_exc()
        return None

if __name__ == '__main__':
    # ID проекта: 19PATaFRs-HOczfm3Ez0CY94lQJ6aU_fC9kq38IBu8PVUfeJ7WDtcBy2s
    script_id = '19PATaFRs-HOczfm3Ez0CY94lQJ6aU_fC9kq38IBu8PVUfeJ7WDtcBy2s'

    get_script_files(script_id)