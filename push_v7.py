#!/usr/bin/env python3
"""Push v7 — 22 cols A-V, retention price S = G/(1-K)/(1-L)"""

import json, os
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

def get_creds():
    token_path = os.path.expanduser('~/.openclaw/workspace/google-creds/token.json')
    with open(token_path) as f:
        data = json.load(f)
    creds = Credentials.from_authorized_user_info(data)
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        data['token'] = creds.token
        data['expiry'] = creds.expiry.isoformat()
        with open(token_path, 'w') as f:
            json.dump(data, f, indent=2)
    return creds

SPREADSHEET_ID = '1VUf_ryMnXuTkD7PBBfRu36fYScwPQtXDu75Dx_iyJgk'
SCRIPT_ID = '1_ULT1JZsw-rFh0qXsjCkvr00VA3Xcp1rt5TwGf6Amqm75NF3-4oRwdWw'

creds = get_creds()
sheets = build('sheets', 'v4', credentials=creds)
script = build('script', 'v1', credentials=creds)

# Read current headers to confirm structure
print("=== Current headers ===")
result = sheets.spreadsheets().values().get(spreadsheetId=SPREADSHEET_ID, range='Репрайсер!1:1').execute()
headers = result.get('values', [[]])[0]
for i, h in enumerate(headers):
    print(f"  {chr(65+i)}({i+1}): {h}")

# Push script v7
print("\n=== Push Apps Script v7 ===")
with open(os.path.expanduser('~/.openclaw/workspace/ozon-repriser-v7.gs'), 'r') as f:
    new_code = f.read()

project = script.projects().getContent(scriptId=SCRIPT_ID).execute()
files = project.get('files', [])

update_files = [{'name': 'Code', 'type': 'SERVER_JS', 'source': new_code}]
for f in files:
    if f['name'] == 'appsscript':
        update_files.append({'name': 'appsscript', 'type': 'JSON', 'source': f['source']})

script.projects().updateContent(scriptId=SCRIPT_ID, body={'files': update_files}).execute()
print("  Script v7 pushed")

# Update formatting for 22 columns
print("\n=== Format 22 columns ===")
meta = sheets.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
sheet_id = None
for s in meta['sheets']:
    if s['properties']['title'] == 'Репрайсер':
        sheet_id = s['properties']['sheetId']
        break

requests_list = []

# Resize grid to 22 columns
requests_list.append({
    'updateSheetProperties': {
        'properties': {
            'sheetId': sheet_id,
            'gridProperties': {'rowCount': 1000, 'columnCount': 22}
        },
        'fields': 'gridProperties.rowCount,gridProperties.columnCount'
    }
})

# Column widths for new columns
new_widths = {
    10: 90,   # K СПП %
    11: 90,   # L Кошелек %
    12: 160,  # M Цена с кошельком
    13: 80,   # N Скидка %
    14: 90,   # O Индекс цен
    15: 140,  # P Цвет индекса
    16: 140,  # Q Модель удержания
    17: 160,  # R Заданное значение маржинальности
    18: 140,  # S Цена для загрузки
    19: 130,  # T Загруженная цена
    20: 140,  # U Статус загрузки
    21: 160,  # V Бустинг + акции
}
for col_idx, width in new_widths.items():
    requests_list.append({
        'updateDimensionProperties': {
            'range': {'sheetId': sheet_id, 'dimension': 'COLUMNS', 'startIndex': col_idx, 'endIndex': col_idx + 1},
            'properties': {'pixelSize': width},
            'fields': 'pixelSize'
        }
    })

# Header row for columns beyond original (Q-V)
requests_list.append({
    'repeatCell': {
        'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 1, 'startColumnIndex': 16, 'endColumnIndex': 22},
        'cell': {
            'userEnteredFormat': {
                'textFormat': {'bold': True},
                'backgroundColor': {'red': 0.93, 'green': 0.88, 'blue': 0.98}
            }
        },
        'fields': 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor'
    }
})

# Center align for new columns
for col in range(10, 22):
    requests_list.append({
        'repeatCell': {
            'range': {'sheetId': sheet_id, 'startRowIndex': 0, 'endRowIndex': 1000, 'startColumnIndex': col, 'endColumnIndex': col + 1},
            'cell': {'userEnteredFormat': {'horizontalAlignment': 'CENTER'}},
            'fields': 'userEnteredFormat.horizontalAlignment'
        }
    })

sheets.spreadsheets().batchUpdate(spreadsheetId=SPREADSHEET_ID, body={'requests': requests_list}).execute()
print("  Formatting applied")

# Update Инструкция
print("\n=== Update Инструкция ===")
instruction = [
    ['# Репрайсер Ozon v7'],
    [],
    ['## Колонки (A-V)'],
    ['A — Фото (авто)'],
    ['B — Product ID (авто)'],
    ['C — Offer ID (авто)'],
    ['D — Название (авто)'],
    ['E — Бренд (авто)'],
    ['F — Рейтинг (авто)'],
    ['G — РРЦ (целевая) ⚠️ ВРУЧНУЮ'],
    ['H — Минимальная цена ⚠️ ВРУЧНУЮ'],
    ['I — Цена продавца (API)'],
    ['J — Цена с сайта (парсинг)'],
    ['K — СПП % = M × (1 − L)'],
    ['L — Кошелек % ⚠️ ВРУЧНУЮ'],
    ['M — Цена с кошельком (расчёт из индекса)'],
    ['N — Скидка %'],
    ['O — Индекс цен (цифра)'],
    ['P — Цвет индекса'],
    ['Q — Модель удержания'],
    ['R — Заданное значение маржинальности'],
    ['S — Цена для загрузки (расчёт)'],
    ['T — Загруженная цена'],
    ['U — Статус загрузки'],
    ['V — Бустинг + акции'],
    [],
    ['## Расчёт S (цена для загрузки)'],
    ['Без кошелька: S = G / (1 − K)'],
    ['С кошельком: S = G / (1 − K) / (1 − L)'],
    ['K (СПП%) = M × (1 − L)'],
    ['Если K ≥ 1 или пусто — S = G (без корректировки)'],
    ['Не ниже H (минимальная цена)'],
    [],
    ['## Меню'],
    ['1. Загрузить товары'],
    ['2. Цены + индекс (API)'],
    ['3. Цена с сайта (парсинг, 3 метода)'],
    ['4. Рассчитать цены (S)'],
    ['5. Загрузить цены на Ozon'],
    ['📊 Полный цикл (1→2→3→4)'],
]

sheets.spreadsheets().values().clear(spreadsheetId=SPREADSHEET_ID, range='Инструкция!A1:E100').execute()
sheets.spreadsheets().values().update(
    spreadsheetId=SPREADSHEET_ID, range='Инструкция!A1',
    valueInputOption='USER_ENTERED',
    body={'values': instruction}
).execute()
print("  Инструкция updated")

print("\n=== DONE v7 ===")
