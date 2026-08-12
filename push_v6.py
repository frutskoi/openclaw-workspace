#!/usr/bin/env python3
"""Push Ozon Repriser v6: no separators, new columns P/Q."""

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

# =========================================================================
# STEP 1: Update headers (A-Q = 17 columns, no separators)
# =========================================================================
print("=== Step 1: Update headers ===")

headers = [
    'Фото товара',               # A (1)
    'Product ID',                # B (2)
    'Offer ID',                  # C (3)
    'Название товара',           # D (4)
    'Бренд',                     # E (5)
    'Рейтинг',                   # F (6)
    'РРЦ (целевая цена)',        # G (7)
    'Минимальная цена',          # H (8)
    'Цена продавца (API)',       # I (9)
    'Цена с сайта',              # J (10)
    'Цена с кошельком (расчёт)', # K (11)
    'Скидка %',                  # L (12)
    'Индекс цен',                # M (13)
    'Цвет индекса',              # N (14)
    'Статус загрузки',           # O (15)
    'Цена для загрузки',         # P (16)
    'Бустинг + акции',           # Q (17)
]

sheets.spreadsheets().values().update(
    spreadsheetId=SPREADSHEET_ID,
    range='Репрайсер!A1:Q1',
    valueInputOption='USER_ENTERED',
    body={'values': [headers]}
).execute()
print("  Headers updated (A-Q, 17 cols, no separators)")

# =========================================================================
# STEP 2: Format — remove old separator formatting, set new structure
# =========================================================================
print("\n=== Step 2: Format sheet ===")

meta = sheets.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
sheet_id = None
for s in meta['sheets']:
    if s['properties']['title'] == 'Репрайсер':
        sheet_id = s['properties']['sheetId']
        break

requests_list = []

# Resize grid to 17 columns
requests_list.append({
    'updateSheetProperties': {
        'properties': {
            'sheetId': sheet_id,
            'gridProperties': {'rowCount': 1000, 'columnCount': 17}
        },
        'fields': 'gridProperties.rowCount,gridProperties.columnCount'
    }
})

# Freeze first row
requests_list.append({
    'updateSheetProperties': {
        'properties': {
            'sheetId': sheet_id,
            'gridProperties': {'frozenRowCount': 1}
        },
        'fields': 'gridProperties.frozenRowCount'
    }
})

# Column widths
col_widths = {
    0: 80,   # A Фото
    1: 110,  # B Product ID
    2: 110,  # C Offer ID
    3: 300,  # D Название
    4: 100,  # E Бренд
    5: 70,   # F Рейтинг
    6: 120,  # G РРЦ
    7: 120,  # H Мин. цена
    8: 130,  # I Цена продавца
    9: 120,  # J Цена с сайта
    10: 160, # K Цена с кошельком
    11: 80,  # L Скидка
    12: 90,  # M Индекс цен
    13: 140, # N Цвет индекса
    14: 140, # O Статус загрузки
    15: 140, # P Цена для загрузки
    16: 160, # Q Бустинг + акции
}
for col_idx, width in col_widths.items():
    requests_list.append({
        'updateDimensionProperties': {
            'range': {
                'sheetId': sheet_id,
                'dimension': 'COLUMNS',
                'startIndex': col_idx,
                'endIndex': col_idx + 1
            },
            'properties': {'pixelSize': width},
            'fields': 'pixelSize'
        }
    })

# Bold + purple header row
requests_list.append({
    'repeatCell': {
        'range': {
            'sheetId': sheet_id,
            'startRowIndex': 0, 'endRowIndex': 1,
            'startColumnIndex': 0, 'endColumnIndex': 17
        },
        'cell': {
            'userEnteredFormat': {
                'textFormat': {'bold': True},
                'backgroundColor': {'red': 0.93, 'green': 0.88, 'blue': 0.98}
            }
        },
        'fields': 'userEnteredFormat.textFormat.bold,userEnteredFormat.backgroundColor'
    }
})

# Center alignment for data columns (all except A, D)
center_cols = [1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
for col in center_cols:
    requests_list.append({
        'repeatCell': {
            'range': {
                'sheetId': sheet_id,
                'startRowIndex': 0, 'endRowIndex': 1000,
                'startColumnIndex': col, 'endColumnIndex': col + 1
            },
            'cell': {
                'userEnteredFormat': {'horizontalAlignment': 'CENTER'}
            },
            'fields': 'userEnteredFormat.horizontalAlignment'
        }
    })

sheets.spreadsheets().batchUpdate(
    spreadsheetId=SPREADSHEET_ID,
    body={'requests': requests_list}
).execute()
print("  Formatting applied")

# =========================================================================
# STEP 3: Migrate data (shift columns: old G/H→new G/H, etc)
# =========================================================================
print("\n=== Step 3: Migrate data ===")

# Read current data (old layout: A-P with G,M as separators)
old_data = sheets.spreadsheets().values().get(
    spreadsheetId=SPREADSHEET_ID,
    range='Репрайсер!A2:Q1000'
).execute().get('values', [])

if old_data:
    # Old layout (16 cols with separators):
    # A(0)=Фото, B(1)=PID, C(2)=OID, D(3)=Name, E(4)=Brand, F(5)=Rating
    # G(6)=separator, H(7)=РРЦ, I(8)=Мин.цена, J(9)=Цена продавца
    # K(10)=Цена с кошельком, L(11)=Индекс, M(12)=separator
    # N(13)=Цена загрузки, O(14)=Бустинг, P(15)=Статус
    
    # New layout (17 cols, no separators):
    # A(0)=Фото, B(1)=PID, C(2)=OID, D(3)=Name, E(4)=Brand, F(5)=Rating
    # G(6)=РРЦ, H(7)=Мин.цена, I(8)=Цена продавца, J(9)=Цена с сайта
    # K(10)=Цена с кошельком, L(11)=Скидка, M(12)=Индекс цен
    # N(13)=Цвет, O(14)=Статус, P(15)=Цена загрузки, Q(16)=Бустинг+акции
    
    new_rows = []
    for row in old_data:
        if not row or not any(row):
            continue
        # Pad to 16
        while len(row) < 16:
            row.append('')
        
        new_row = [''] * 17
        new_row[0] = row[0]   # A Фото
        new_row[1] = row[1]   # B PID
        new_row[2] = row[2]   # C OID
        new_row[3] = row[3]   # D Name
        new_row[4] = row[4]   # E Brand
        new_row[5] = row[5]   # F Rating
        new_row[6] = row[7]   # G РРЦ (was H)
        new_row[7] = row[8]   # H Мин.цена (was I)
        new_row[8] = row[9]   # I Цена продавца (was J)
        new_row[9] = ''       # J Цена с сайта (new, empty)
        new_row[10] = row[10] # K Цена с кошельком (same position)
        new_row[11] = ''      # L Скидка (new)
        new_row[12] = row[11] # M Индекс цен (was L)
        new_row[13] = ''      # N Цвет индекса (new)
        new_row[14] = row[15] # O Статус (was P)
        new_row[15] = row[13] # P Цена загрузки (was N)
        new_row[16] = row[14] # Q Бустинг (was O)
        new_rows.append(new_row)
    
    if new_rows:
        # Clear first
        sheets.spreadsheets().values().clear(
            spreadsheetId=SPREADSHEET_ID,
            range='Репрайсер!A2:Q1000'
        ).execute()
        
        sheets.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range='Репрайсер!A2',
            valueInputOption='USER_ENTERED',
            body={'values': new_rows}
        ).execute()
        print(f"  Migrated {len(new_rows)} rows")

# =========================================================================
# STEP 4: Push Apps Script v6
# =========================================================================
print("\n=== Step 4: Push Apps Script v6 ===")

with open(os.path.expanduser('~/.openclaw/workspace/ozon-repriser-v6.gs'), 'r') as f:
    new_code = f.read()

project = script.projects().getContent(scriptId=SCRIPT_ID).execute()
files = project.get('files', [])

update_files = [{'name': 'Code', 'type': 'SERVER_JS', 'source': new_code}]
for f in files:
    if f['name'] == 'appsscript':
        update_files.append({'name': 'appsscript', 'type': 'JSON', 'source': f['source']})

script.projects().updateContent(
    scriptId=SCRIPT_ID,
    body={'files': update_files}
).execute()
print("  Script v6 pushed")

# =========================================================================
# STEP 5: Update Инструкция
# =========================================================================
print("\n=== Step 5: Update Инструкция ===")

instruction = [
    ['# Репрайсер Ozon v6'],
    [],
    ['## Меню'],
    ['1. Загрузить товары — фото, названия, ID'],
    ['2. Цены + индекс (API) — цена продавца, кошелёк, индекс, цвет'],
    ['3. Цена с сайта (парсинг) — 3 метода: entrypoint, mobile, GraphQL'],
    ['4. Рассчитать цены — целевая цена + бустинг'],
    ['5. Загрузить цены на Ozon'],
    ['📊 Полный цикл (1→2→3→4)'],
    [],
    ['## Колонки'],
    ['A — Фото (авто)'],
    ['B — Product ID (авто)'],
    ['C — Offer ID (авто)'],
    ['D — Название (авто)'],
    ['E — Бренд (авто)'],
    ['F — Рейтинг (авто)'],
    ['G — РРЦ ⚠️ ВРУЧНУЮ'],
    ['H — Минимальная цена ⚠️ ВРУЧНУЮ'],
    ['I — Цена продавца (API)'],
    ['J — Цена с сайта (парсинг, 3 метода)'],
    ['K — Цена с кошельком (расчёт из индекса)'],
    ['L — Скидка %'],
    ['M — Индекс цен (цифра)'],
    ['N — Цвет индекса (🟢🟡🔴)'],
    ['O — Статус загрузки'],
    ['P — Цена для загрузки (расчётная)'],
    ['Q — Бустинг + кол-во акций'],
    [],
    ['## Формула цены с кошельком'],
    ['Индекс < 1: цена = индекс × мин.цена конкурента'],
    ['Индекс > 1: цена = мин.цена конкурента / (2 − индекс)'],
    ['Погрешность ~2% от реальной цены с картой Ozon'],
    [],
    ['## Парсинг цены с сайта — 3 метода'],
    ['1. entrypoint-api — ozon.ru/api/entrypoint-api.bx'],
    ['2. Mobile API — с SKU, User-Agent мобильного'],
    ['3. GraphQL — composer-api.bx/_graphql'],
    ['Если один метод не сработал — пробует следующий'],
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

print("\n=== DONE v6 ===")
print("A-Q 17 колонок, без разделителей")
print("P = цена для загрузки, Q = бустинг + кол-во акций")
print("M = индекс цен цифрой, J = цена с сайта (3 метода парсинга)")
