#!/usr/bin/env python3
"""Push Ozon Repriser v5 to Apps Script + update sheet headers."""

import json, os, sys
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

# =========================================================================
# STEP 1: Update headers
# =========================================================================
print("=== Step 1: Update headers ===")

new_headers = [
    'Фото товара',              # A
    'Product ID',               # B
    'Offer ID',                 # C
    'Название товара',          # D
    'Бренд',                    # E
    'Рейтинг',                  # F
    '',                         # G (separator)
    'РРЦ (целевая цена)',       # H
    'Минимальная цена',         # I
    'Цена продавца (API)',      # J
    'Цена с кошельком (расчёт)',# K — NEW: calculated from price index
    'Индекс цен',               # L — NEW: price_index_value from API
    '',                         # M (separator)
    'Цена для загрузки',        # N
    'В эластичном бустинге?',   # O
    'Статус загрузки',          # P
]

sheets.spreadsheets().values().update(
    spreadsheetId=SPREADSHEET_ID,
    range='Репрайсер!A1:P1',
    valueInputOption='USER_ENTERED',
    body={'values': [new_headers]}
).execute()
print("  Headers updated: K=Цена с кошельком, L=Индекс цен")

# =========================================================================
# STEP 2: Push Apps Script v5
# =========================================================================
print("\n=== Step 2: Push Apps Script v5 ===")

script_path = os.path.expanduser('~/.openclaw/workspace/ozon-repriser-v5.gs')
with open(script_path, 'r') as f:
    new_script_code = f.read()

# Get existing files (to keep appsscript.json)
project_content = script.projects().getContent(scriptId=SCRIPT_ID).execute()
files = project_content.get('files', [])

update_files = [
    {
        'name': 'Code',
        'type': 'SERVER_JS',
        'source': new_script_code
    }
]

# Keep appsscript.json
for f in files:
    if f['name'] == 'appsscript':
        update_files.append({
            'name': 'appsscript',
            'type': 'JSON',
            'source': f['source']
        })

result = script.projects().updateContent(
    scriptId=SCRIPT_ID,
    body={'files': update_files}
).execute()
print("  Apps Script v5 pushed successfully")

# =========================================================================
# STEP 3: Update Инструкция
# =========================================================================
print("\n=== Step 3: Update Инструкция ===")

instruction = [
    ['# Репрайсер Ozon v5 — Инструкция'],
    [],
    ['## Меню "🟣 Репрайсер Ozon"'],
    [],
    ['1. Загрузить товары — загружает товары + фото с Ozon API'],
    ['2. Получить цены + индекс (API) — цены продавца + расчёт цены с кошельком через индекс'],
    ['3. Рассчитать цены — целевые цены + проверка эластичного бустинга'],
    ['4. Загрузить цены на Ozon — отправляет рассчитанные цены'],
    ['📊 Полный цикл (1→2→3) — всё разом'],
    ['🔍 Парсинг цен с сайта — альтернатива (напрямую с сайта Ozon)'],
    [],
    ['## Колонки "Репрайсер"'],
    [],
    ['A — Фото товара (авто)'],
    ['B — Product ID (авто)'],
    ['C — Offer ID (авто)'],
    ['D — Название товара (авто)'],
    ['E — Бренд (авто)'],
    ['F — Рейтинг (авто)'],
    ['G — разделитель'],
    ['H — РРЦ / целевая цена ⚠️ ВРУЧНУЮ'],
    ['I — Минимальная цена ⚠️ ВРУЧНУЮ'],
    ['J — Цена продавца (из Ozon Seller API)'],
    ['K — Цена с кошельком (расчёт через индекс цен)'],
    ['L — Индекс цен (price_index_value из API)'],
    ['M — разделитель'],
    ['N — Цена для загрузки (расчёт)'],
    ['O — В эластичном бустинге? (авто)'],
    ['P — Статус загрузки (авто)'],
    [],
    ['## Как считается "Цена с кошельком"'],
    ['Ozon убрал marketing_price из API (ноябрь 2025).'],
    ['Но остался price_indexes в /v5/product/info/prices.'],
    ['Из него можно вычислить цену покупателя:'],
    [],
    ['Формула расчёта:'],
    ['• Индекс < 1 (мы дешевле): цена = индекс × мин.цена_конкурента'],
    ['• Индекс > 1 (мы дороже): цена = мин.цена_конкурента / (2 − индекс)'],
    ['• Индекс = 1: цена = мин.цена_конкурента'],
    [],
    ['Результат ≈ цена с картой Ozon (погрешность ~2%)'],
    ['Приоритет данных: ozon_index_data → external_index_data → self_marketplaces_index_data'],
    [],
    ['## Алгоритм расчёта цены для загрузки'],
    ['1. Целевая = РРЦ (если задана) или текущая цена продавца'],
    ['2. Если целевая < минимальная → целевая = минимальная'],
    ['3. Округление до целого'],
    ['4. Проверка эластичного бустинга → TRUE/FALSE'],
]

sheets.spreadsheets().values().clear(
    spreadsheetId=SPREADSHEET_ID,
    range='Инструкция!A1:E100'
).execute()

sheets.spreadsheets().values().update(
    spreadsheetId=SPREADSHEET_ID,
    range='Инструкция!A1',
    valueInputOption='USER_ENTERED',
    body={'values': instruction}
).execute()
print("  Инструкция updated")

print("\n=== ALL DONE ===")
print("v5 changes:")
print("  K → Цена с кошельком (расчёт через price_indexes API)")
print("  L → Индекс цен (price_index_value)")
print("  Полный цикл: loadOzonProducts → getOzonPrices → calculatePrices")
print("  Парсинг сайта убран из полного цикла (оставлен как альтернатива)")
