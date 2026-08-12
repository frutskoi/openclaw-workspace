#!/usr/bin/env python3
"""Rebuild Ozon Repricer spreadsheet per new requirements."""

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
# STEP 1: Delete "Конкуренты" sheet
# =========================================================================
print("=== Step 1: Delete 'Конкуренты' sheet ===")
meta = sheets.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
competitor_sheet_id = None
for s in meta['sheets']:
    if s['properties']['title'] == 'Конкуренты':
        competitor_sheet_id = s['properties']['sheetId']
        break

if competitor_sheet_id is not None:
    req = {
        'deleteSheet': {
            'sheetId': competitor_sheet_id
        }
    }
    result = sheets.spreadsheets().batchUpdate(
        spreadsheetId=SPREADSHEET_ID,
        body={'requests': [req]}
    ).execute()
    print(f"  Deleted 'Конкуренты' (sheetId={competitor_sheet_id})")
else:
    print("  'Конкуренты' not found, skipping")

# =========================================================================
# STEP 2: Update "Репрайсер" headers + resize columns
# =========================================================================
print("\n=== Step 2: Update 'Репрайсер' headers ===")

# Get repricer sheet ID
repricer_sheet_id = None
meta = sheets.spreadsheets().get(spreadsheetId=SPREADSHEET_ID).execute()
for s in meta['sheets']:
    if s['properties']['title'] == 'Репрайсер':
        repricer_sheet_id = s['properties']['sheetId']
        break

# New headers (A-P = 16 columns)
new_headers = [
    'Фото товара',           # A
    'Product ID',            # B
    'Offer ID',              # C
    'Название товара',       # D
    'Бренд',                 # E
    'Рейтинг',               # F
    '',                      # G (separator)
    'РРЦ (целевая цена)',    # H
    'Минимальная цена',      # I
    'Цена продавца (API)',   # J
    'Цена на сайте Ozon, Москва',  # K
    'Скидка на сайте %',     # L
    '',                      # M (separator)
    'Цена для загрузки (расчётная)',  # N
    'В эластичном бустинге?',  # O
    'Статус загрузки',       # P
]

# Write headers
sheets.spreadsheets().values().update(
    spreadsheetId=SPREADSHEET_ID,
    range='Репрайсер!A1:P1',
    valueInputOption='USER_ENTERED',
    body={'values': [new_headers]}
).execute()
print("  Headers updated")

# Clear old data rows (but preserve user-entered RRC and min price in H,I)
# Actually we need to be careful — we should clear data but user might have RRC/min price
# Let's clear columns beyond the old structure first, then fix
# For safety, let's clear old O column (price competitor) and everything else auto
# We'll clear column O (old competitor data) and the old columns K,L,M,O

# Clear old data: column O (col 15, old competitor price)
# Actually, since we're restructuring, let's just update the sheet properly

# Resize grid to 16 columns
requests_list = []

# Update grid properties to 16 columns
requests_list.append({
    'updateSheetProperties': {
        'properties': {
            'sheetId': repricer_sheet_id,
            'gridProperties': {
                'rowCount': 1000,
                'columnCount': 16
            }
        },
        'fields': 'gridProperties.rowCount,gridProperties.columnCount'
    }
})

# Freeze first row
requests_list.append({
    'updateSheetProperties': {
        'properties': {
            'sheetId': repricer_sheet_id,
            'gridProperties': {
                'frozenRowCount': 1
            }
        },
        'fields': 'gridProperties.frozenRowCount'
    }
})

# Set column widths
col_widths = {
    0: 80,   # A - Фото
    1: 120,  # B - Product ID
    2: 120,  # C - Offer ID
    3: 300,  # D - Название
    4: 100,  # E - Бренд
    5: 70,   # F - Рейтинг
    6: 30,   # G - separator
    7: 120,  # H - РРЦ
    8: 120,  # I - Мин. цена
    9: 130,  # J - Цена продавца
    10: 180, # K - Цена на сайте
    11: 100, # L - Скидка
    12: 30,  # M - separator
    13: 160, # N - Цена для загрузки
    14: 150, # O - Бустинг
    15: 150, # P - Статус
}

for col_idx, width in col_widths.items():
    requests_list.append({
        'updateDimensionProperties': {
            'range': {
                'sheetId': repricer_sheet_id,
                'dimension': 'COLUMNS',
                'startIndex': col_idx,
                'endIndex': col_idx + 1
            },
            'properties': {
                'pixelSize': width
            },
            'fields': 'pixelSize'
        }
    })

# Bold headers
requests_list.append({
    'repeatCell': {
        'range': {
            'sheetId': repricer_sheet_id,
            'startRowIndex': 0,
            'endRowIndex': 1,
            'startColumnIndex': 0,
            'endColumnIndex': 16
        },
        'cell': {
            'userEnteredFormat': {
                'textFormat': {
                    'bold': True
                }
            }
        },
        'fields': 'userEnteredFormat.textFormat.bold'
    }
})

# Center alignment for ALL cells (header + data) columns B-F, H-L, N-P (skip A image, D name)
center_cols = [1, 2, 4, 5, 7, 8, 9, 10, 11, 13, 14, 15]  # B,C,E,F,H,I,J,K,L,N,O,P
for col in center_cols:
    requests_list.append({
        'repeatCell': {
            'range': {
                'sheetId': repricer_sheet_id,
                'startRowIndex': 0,
                'endRowIndex': 1000,
                'startColumnIndex': col,
                'endColumnIndex': col + 1
            },
            'cell': {
                'userEnteredFormat': {
                    'horizontalAlignment': 'CENTER'
                }
            },
            'fields': 'userEnteredFormat.horizontalAlignment'
        }
    })

# Also center header row for ALL columns (including A, D, G, M)
for col in [0, 3, 6, 12]:
    requests_list.append({
        'repeatCell': {
            'range': {
                'sheetId': repricer_sheet_id,
                'startRowIndex': 0,
                'endRowIndex': 1,
                'startColumnIndex': col,
                'endColumnIndex': col + 1
            },
            'cell': {
                'userEnteredFormat': {
                    'horizontalAlignment': 'CENTER'
                }
            },
            'fields': 'userEnteredFormat.horizontalAlignment'
        }
    })

# Background color for separator columns (G=6, M=12)
for col in [6, 12]:
    requests_list.append({
        'repeatCell': {
            'range': {
                'sheetId': repricer_sheet_id,
                'startRowIndex': 0,
                'endRowIndex': 1000,
                'startColumnIndex': col,
                'endColumnIndex': col + 1
            },
            'cell': {
                'userEnteredFormat': {
                    'backgroundColor': {
                        'red': 0.85,
                        'green': 0.85,
                        'blue': 0.85
                    }
                }
            },
            'fields': 'userEnteredFormat.backgroundColor'
        }
    })

# Header row background - light purple
requests_list.append({
    'repeatCell': {
        'range': {
            'sheetId': repricer_sheet_id,
            'startRowIndex': 0,
            'endRowIndex': 1,
            'startColumnIndex': 0,
            'endColumnIndex': 16
        },
        'cell': {
            'userEnteredFormat': {
                'backgroundColor': {
                    'red': 0.93,
                    'green': 0.88,
                    'blue': 0.98
                }
            }
        },
        'fields': 'userEnteredFormat.backgroundColor'
    }
})

# Now we need to shift data: old K(11)->now K(11), old L(12)->now L(12), but remove old M(13), old O(15)
# Actually the structure change is: remove old K(marketing), L(card), M(discount), O(competitor)
# and add new K(site price), L(site discount), O(boosting)
# The old data in K,L,M was API data that gets overwritten anyway.
# Old O was competitor data that we're removing.
# So we can just clear those old columns.

# Clear old data in columns that are being removed/changed:
# Old K (маркетинговая), L (ozon card), M (скидка %) - these were cols 11,12,13 in old layout
# New K = site price, L = site discount - will be filled by new script
# We need to clear old K,L,M data rows

# But wait - the data layout is shifting. Old structure had cols up to R(18).
# New structure goes up to P(16). Let me just clear all data rows for the
# auto-populated columns and leave H,I (user entered) intact.

# Clear data rows for columns that will be auto-populated: A, B, C, D, E, F, J, K, L, N, O, P
# Keep H (RRC) and I (min price) as user-entered

# Actually, old data is already there. The column mapping changed.
# Old: A-F same, G separator, H RRC, I min, J seller price, K marketing, L card, M discount, N separator, O competitor, P target, Q status
# New: A-F same, G separator, H RRC, I min, J seller price, K site price, L site discount, M separator, N target, O boosting, P status
# So H, I stayed the same. J stayed same. K,L changed meaning. O removed, replaced by boosting.
# N old was separator, now is target price. P old was target, Q old was status.

# Best approach: clear all data rows except H and I, then restructure
print("  Clearing old data rows (preserving H, I)...")
# Clear columns A-F (1-6), J-L (10-12), O (15), P (16), Q (17), R (18) for data rows
if True:
    # Read H,I data to preserve
    hi_data = sheets.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range='Репрайсер!H2:I1000'
    ).execute().get('values', [])
    
    # Clear all data rows
    sheets.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range='Репрайсер!A2:R1000'
    ).execute()
    
    # Restore H,I
    if hi_data:
        # Pad rows to match
        sheets.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range='Репрайсер!H2',
            valueInputOption='USER_ENTERED',
            body={'values': hi_data}
        ).execute()
    print("  Data cleared, H/I preserved")

# Batch update all formatting
result = sheets.spreadsheets().batchUpdate(
    spreadsheetId=SPREADSHEET_ID,
    body={'requests': requests_list}
).execute()
print("  Formatting applied")

# =========================================================================
# STEP 3: Update Apps Script
# =========================================================================
print("\n=== Step 3: Update Apps Script code ===")

NEW_SCRIPT = r'''// ===== РЕПРАЙСЕР OZON v2 =====

// Конфигурация
function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName('Настройки');
  return {
    clientId: settings.getRange('B3').getValue().toString(),
    apiKey: settings.getRange('C3').getValue().toString(),
    baseUrl: 'https://api-seller.ozon.ru',
    threshold: parseFloat(settings.getRange('B8').getValue()) || 5
  };
}

// API запрос к Ozon Seller API
function ozonApi(endpoint, body) {
  const config = getConfig();
  if (!config.clientId || !config.apiKey) {
    SpreadsheetApp.getUi().alert('Ошибка', 'Заполните Client ID и API Key в листе "Настройки"');
    return null;
  }
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Client-Id': config.clientId,
      'Api-Key': config.apiKey
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(config.baseUrl + endpoint, options);
  const json = JSON.parse(response.getContentText());
  if (json.code && json.code !== 0) {
    Logger.log('API Error ' + endpoint + ': ' + JSON.stringify(json));
  }
  return json;
}

// Создать меню
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🟣 Репрайсер Ozon')
    .addItem('1. Загрузить товары', 'loadOzonProducts')
    .addItem('2. Получить цены (API)', 'getOzonPrices')
    .addItem('3. Парсить цены с сайта (Москва)', 'parseOzonSitePrices')
    .addSeparator()
    .addItem('4. Рассчитать цены', 'calculatePrices')
    .addItem('5. Загрузить цены на Ozon', 'uploadPrices')
    .addSeparator()
    .addItem('📊 Полный цикл (1→2→3→4)', 'fullCycle')
    .addToUi();
}

// Скрипт 1: Загрузить товары с Ozon
function loadOzonProducts() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');

  Logger.log('Начинаю загрузку товаров Ozon...');

  let allItems = [];
  let lastId = '';
  let hasMore = true;

  while (hasMore) {
    const result = ozonApi('/v3/product/list', {
      filter: { visibility: 'ALL' },
      limit: 100,
      last_id: lastId
    });

    if (!result || !result.result) {
      logSheet.appendRow([new Date(), 'Загрузка товаров', 'Ошибка', 'API вернул ошибку']);
      SpreadsheetApp.getUi().alert('Ошибка загрузки товаров. Проверьте лог.');
      return;
    }

    const items = result.result.items || [];
    allItems = allItems.concat(items);
    lastId = result.result.last_id;
    hasMore = items.length === 100;
  }

  // Сохранить пользовательские данные (H=РРЦ, I=Мин.цена) перед очисткой
  const lastRow = sheet.getLastRow();
  const userData = {};
  if (lastRow >= 2) {
    for (let r = 2; r <= lastRow; r++) {
      const pid = sheet.getRange(r, 2).getValue();
      const rrc = sheet.getRange(r, 8).getValue();
      const minP = sheet.getRange(r, 9).getValue();
      if (pid) {
        userData[pid.toString()] = { rrc: rrc, minP: minP };
      }
    }
  }

  // Очистить старые данные (кроме заголовка)
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 16).clearContent();
  }

  // Загрузить детали каждого товара
  let success = 0;
  let errors = 0;

  for (let i = 0; i < allItems.length; i++) {
    try {
      const item = allItems[i];
      const productId = item.product_id;
      const offerId = item.offer_id || '';

      // Получить детали товара
      const detail = ozonApi('/v2/product/info', { product_id: productId });

      if (detail && detail.result) {
        const d = detail.result;
        const row = i + 2;

        // A — Фото
        const images = d.images || [];
        if (images.length > 0) {
          sheet.getRange(row, 1).setFormula('=IMAGE("' + images[0] + '")');
        }

        sheet.getRange(row, 2).setValue(productId);       // B — Product ID
        sheet.getRange(row, 3).setValue(offerId);          // C — Offer ID
        sheet.getRange(row, 4).setValue(d.name || '');     // D — Название
        sheet.getRange(row, 5).setValue(d.brand || '');    // E — Бренд
        sheet.getRange(row, 6).setValue(d.rating || 0);    // F — Рейтинг

        // Восстановить РРЦ и мин. цену если были
        const saved = userData[productId.toString()];
        if (saved) {
          if (saved.rrc) sheet.getRange(row, 8).setValue(saved.rrc);
          if (saved.minP) sheet.getRange(row, 9).setValue(saved.minP);
        }

        success++;
      } else {
        errors++;
      }

      // Пауза для лимитов API
      if (i % 10 === 9) {
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log('Ошибка товара ' + allItems[i].product_id + ': ' + e.message);
      errors++;
    }
  }

  logSheet.appendRow([new Date(), 'Загрузка товаров', 'Успешно', 'Загружено: ' + success + ', Ошибок: ' + errors]);
  SpreadsheetApp.getUi().alert('Загрузка завершена', 'Загружено: ' + success + '\nОшибок: ' + errors);
}

// Скрипт 2: Получить цены с Ozon Seller API
function getOzonPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('Начинаю получение цен Ozon API...');

  // Собрать все product_id
  const productIds = [];
  for (let row = 2; row <= lastRow; row++) {
    const pid = sheet.getRange(row, 2).getValue();
    if (pid) productIds.push(pid);
  }

  if (productIds.length === 0) {
    SpreadsheetApp.getUi().alert('Нет товаров с Product ID');
    return;
  }

  // Получить все цены через пагинацию
  const priceMap = {};
  let cursor = '';
  let hasMore = true;

  while (hasMore) {
    const result = ozonApi('/v5/product/info/prices', {
      filter: { visibility: 'ALL' },
      last_id: '',
      cursor: cursor,
      limit: 100
    });

    if (!result) break;

    const items = result.items || [];
    for (const item of items) {
      if (item.product_id) {
        priceMap[item.product_id] = item;
      }
    }

    cursor = result.cursor || '';
    hasMore = items.length === 100 && cursor !== '';
  }

  // Записать цены в таблицу
  let success = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const pid = sheet.getRange(row, 2).getValue();
    if (!pid || !priceMap[pid]) continue;

    try {
      const p = priceMap[pid];
      const priceInfo = p.price || {};

      // J — Цена продавца (из API)
      sheet.getRange(row, 10).setValue(priceInfo.price || '');

      success++;
    } catch (e) {
      Logger.log('Ошибка цены товара ' + pid + ': ' + e.message);
      errors++;
    }
  }

  logSheet.appendRow([new Date(), 'Получение цен (API)', 'Завершено', 'Успешно: ' + success + ', Ошибок: ' + errors]);
  SpreadsheetApp.getUi().alert('Цены обновлены (API)', 'Успешно: ' + success + '\nОшибок: ' + errors);
}

// Скрипт 3: Парсинг цен с сайта Ozon (регион Москва)
function parseOzonSitePrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('Начинаю парсинг цен с сайта Ozon (Москва)...');

  let success = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    if (!productId) continue;

    try {
      // Используем публичный API Ozon для получения цен товара
      // Регион Москва = region_id 1 (или можно через заголовок X-O3-Region-Id: 1)
      const sku = productId;

      // Запрос к мобильному API Ozon (composer-api) для получения цены
      const apiUrl = 'https://www.ozon.ru/api/composer-api.bx/_graphql';
      const graphqlBody = {
        query: 'query GetProductPrice($sku: Int!, $regionId: Int!) { product(sku: $sku, regionId: $regionId) { actualPrice basePrice sale discount cardPrice } }',
        variables: { sku: parseInt(productId), regionId: 1 }
      };

      // Альтернативный подход — запрос к карточке товара через публичный API
      const productUrl = 'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/product/-/' + productId + '/&layout_page_id=&page_changed=true';

      const options = {
        method: 'get',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'X-O3-Region-Id': '1'
        },
        muteHttpExceptions: true,
        followRedirects: true
      };

      const response = UrlFetchApp.fetch(productUrl, options);
      const responseCode = response.getResponseCode();

      if (responseCode === 200) {
        const json = JSON.parse(response.getContentText());

        // Парсим JSON ответ для извлечения цены
        // Структура ответа может меняться, ищем цену в widgetStates
        let sitePrice = null;
        let siteDiscount = null;

        if (json && json.widgetStates) {
          const ws = json.widgetStates;

          // Ищем виджет с ценой
          for (const key in ws) {
            try {
              const widget = JSON.parse(ws[key]);

              // Проверяем разные структуры виджетов с ценой
              if (widget.price) {
                sitePrice = widget.price;
                siteDiscount = widget.discount || null;
                break;
              }
              if (widget.cellTrackingData) {
                const td = widget.cellTrackingData;
                if (td.finalPrice) {
                  sitePrice = parseInt(td.finalPrice);
                  siteDiscount = td.discount || null;
                  break;
                }
              }
              // Another common structure
              if (widget.mainState && widget.mainState.price) {
                sitePrice = widget.mainState.price;
                siteDiscount = widget.mainState.discount || null;
                break;
              }
              // Search for price in nested objects
              if (widget.defaultBreadcrumbs || widget.topBar) continue;

              // Deep search for price fields
              const priceStr = JSON.stringify(widget);
              const priceMatch = priceStr.match(/"price"\s*:\s*"?(\d+)"/);
              const discountMatch = priceStr.match(/"discount"\s*:\s*"?(\d+(?:\.\d+)?)"?/);

              if (priceMatch && !sitePrice) {
                sitePrice = parseInt(priceMatch[1]);
                siteDiscount = discountMatch ? parseFloat(discountMatch[1]) : null;
              }
            } catch (e) {
              // skip non-JSON widget state
            }
          }
        }

        if (sitePrice) {
          // K — Цена на сайте Ozon (Москва)
          sheet.getRange(row, 11).setValue(sitePrice);
          // L — Скидка на сайте %
          if (siteDiscount !== null) {
            sheet.getRange(row, 12).setValue(siteDiscount);
          } else {
            // Рассчитать скидку: (sellerPrice - sitePrice) / sellerPrice * 100
            const sellerPrice = parseFloat(sheet.getRange(row, 10).getValue());
            if (sellerPrice && sellerPrice > sitePrice) {
              const discount = Math.round((1 - sitePrice / sellerPrice) * 100);
              sheet.getRange(row, 12).setValue(discount);
            }
          }
          success++;
        } else {
          // Если не удалось распарсить, отметить
          sheet.getRange(row, 11).setValue('Не найдено');
          errors++;
        }
      } else {
        Logger.log('Ozon site returned code ' + responseCode + ' for product ' + productId);
        sheet.getRange(row, 11).setValue('Ошибка ' + responseCode);
        errors++;
      }

      // Пауза чтобы не получить бан
      Utilities.sleep(2000);

    } catch (e) {
      Logger.log('Ошибка парсинга товара ' + productId + ': ' + e.message);
      sheet.getRange(row, 11).setValue('Ошибка');
      errors++;
    }
  }

  logSheet.appendRow([new Date(), 'Парсинг цен сайта (Москва)', 'Завершено', 'Успешно: ' + success + ', Ошибок: ' + errors]);
  SpreadsheetApp.getUi().alert('Парсинг завершен', 'Успешно: ' + success + '\nОшибок: ' + errors);
}

// Скрипт 4: Рассчитать цены для загрузки
function calculatePrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const config = getConfig();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('Нет данных');
    return;
  }

  // Сначала получим список акций эластичного бустинга
  const boostActions = getElasticBoostActions();

  let updated = 0;

  for (let row = 2; row <= lastRow; row++) {
    const minPrice = parseFloat(sheet.getRange(row, 9).getValue());    // I — Мин. цена
    const rrc = parseFloat(sheet.getRange(row, 8).getValue());         // H — РРЦ
    const currentPrice = parseFloat(sheet.getRange(row, 10).getValue()); // J — Цена продавца

    if (!currentPrice) continue;

    // Целевая цена = РРЦ если задана, иначе текущая цена
    let targetPrice = rrc || currentPrice;

    // Не ниже минимальной
    if (minPrice && targetPrice < minPrice) {
      targetPrice = minPrice;
    }

    // Округлить до целого
    targetPrice = Math.round(targetPrice);

    // N — Цена для загрузки
    sheet.getRange(row, 14).setValue(targetPrice);

    // O — Проверка эластичного бустинга
    const productId = sheet.getRange(row, 2).getValue();
    if (productId && boostActions.length > 0) {
      const isInBoost = checkProductInBoost(productId, targetPrice, boostActions);
      sheet.getRange(row, 15).setValue(isInBoost ? true : false);
    } else {
      sheet.getRange(row, 15).setValue(false);
    }

    updated++;
  }

  SpreadsheetApp.getUi().alert('Цены рассчитаны', 'Обновлено: ' + updated + ' товаров');
}

// Получить список акций "Эластичный бустинг"
function getElasticBoostActions() {
  const result = ozonApi('/v1/actions/list', {
    filter: {},
    limit: 100,
    offset: 0
  });

  if (!result || !result.result) return [];

  // Ищем акции с "эластич" в названии
  const actions = result.result.actions || [];
  const boostActions = actions.filter(a =>
    (a.title && a.title.toLowerCase().includes('эластич')) ||
    (a.description && a.description.toLowerCase().includes('эластич')) ||
    (a.actions_type && a.actions_type.toLowerCase().includes('elastic'))
  );

  Logger.log('Найдено акций эластичного бустинга: ' + boostActions.length);
  return boostActions;
}

// Проверить, проходит ли товар в эластичный бустинг
function checkProductInBoost(productId, price, boostActions) {
  for (const action of boostActions) {
    try {
      const result = ozonApi('/v1/actions/candidates', {
        action_id: action.action_id.toString(),
        limit: 100,
        offset: 0
      });

      if (!result || !result.result) continue;

      const candidates = result.result.candidates || [];
      for (const candidate of candidates) {
        if (candidate.product_id == productId) {
          return true;
        }
      }
    } catch (e) {
      Logger.log('Ошибка проверки бустинга: ' + e.message);
    }
  }
  return false;
}

// Скрипт 5: Загрузить цены на Ozon
function uploadPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    SpreadsheetApp.getUi().alert('Нет данных');
    return;
  }

  const prices = [];

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    const targetPrice = parseFloat(sheet.getRange(row, 14).getValue()); // N — Цена для загрузки
    const currentPrice = parseFloat(sheet.getRange(row, 10).getValue()); // J — Текущая цена

    if (!productId || !targetPrice) continue;

    // Пропускаем если разница меньше 1 рубля
    if (currentPrice && Math.abs(targetPrice - currentPrice) < 1) continue;

    prices.push({
      product_id: productId,
      price: targetPrice.toString(),
      row: row
    });
  }

  if (prices.length === 0) {
    SpreadsheetApp.getUi().alert('Нет товаров для обновления цен');
    return;
  }

  // Загружаем батчами по 100
  let totalSuccess = 0;
  let totalErrors = 0;

  for (let i = 0; i < prices.length; i += 100) {
    const batch = prices.slice(i, i + 100);

    const result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(p => ({ product_id: p.product_id, price: p.price }))
    });

    if (result && result.result) {
      totalSuccess += batch.length;
      // Обновить статус загрузки
      for (const p of batch) {
        sheet.getRange(p.row, 16).setValue('✅ Загружено ' + p.price + '₽');
      }
    } else {
      totalErrors += batch.length;
      for (const p of batch) {
        sheet.getRange(p.row, 16).setValue('❌ Ошибка');
      }
    }

    Utilities.sleep(500);
  }

  logSheet.appendRow([new Date(), 'Загрузка цен', 'Завершено', 'Успешно: ' + totalSuccess + ', Ошибок: ' + totalErrors]);
  SpreadsheetApp.getUi().alert('Цены загружены', 'Успешно: ' + totalSuccess + '\nОшибок: ' + totalErrors);
}

// Полный цикл
function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  parseOzonSitePrices();
  calculatePrices();
}
'''

# Get current project files
project_content = script.projects().getContent(scriptId=SCRIPT_ID).execute()
files = project_content.get('files', [])

# Build update request
update_files = [
    {
        'name': 'Code',
        'type': 'SERVER_JS',
        'source': NEW_SCRIPT
    }
]

# Keep appsscript.json if exists
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
print("  Apps Script updated successfully")

# =========================================================================
# STEP 4: Update "Инструкция" sheet
# =========================================================================
print("\n=== Step 4: Update 'Инструкция' sheet ===")

instruction_content = [
    ['# Репрайсер Ozon v2 — Инструкция'],
    [],
    ['## 📋 Начало работы'],
    ['1. Откройте лист "Настройки"'],
    ['2. Вставьте Client ID в ячейку B3'],
    ['3. Вставьте API Key в ячейку C3'],
    ['4. Client ID и API Key берутся в кабинете Ozon → Настройки → API ключи'],
    [],
    ['## 🔧 Меню "🟣 Репрайсер Ozon"'],
    [],
    ['1. Загрузить товары — загружает все товары с Ozon (фото, название, бренд, рейтинг)'],
    ['2. Получить цены (API) — загружает текущие цены продавца через Ozon Seller API'],
    ['3. Парсить цены с сайта (Москва) — получает цены с сайта Ozon для региона Москва'],
    ['4. Рассчитать цены — рассчитывает целевые цены и проверяет эластичный бустинг'],
    ['5. Загрузить цены на Ozon — отправляет рассчитанные цены в Ozon'],
    ['📊 Полный цикл (1→2→3→4) — выполняет шаги 1→2→3→4 последовательно'],
    [],
    ['## 📊 Лист "Репрайсер" — Колонки'],
    [],
    ['A — Фото товара — автоматически (IMAGE формула)'],
    ['B — Product ID — автоматически (загрузка с Ozon)'],
    ['C — Offer ID — автоматически (загрузка с Ozon)'],
    ['D — Название товара — автоматически (загрузка с Ozon)'],
    ['E — Бренд — автоматически (загрузка с Ozon)'],
    ['F — Рейтинг — автоматически (загрузка с Ozon)'],
    ['G — (пустая разделитель)'],
    ['H — РРЦ (целевая цена) — ⚠️ ЗАПОЛНЯЕТ ПОЛЬЗОВАТЕЛЬ'],
    ['I — Минимальная цена — ⚠️ ЗАПОЛНЯЕТ ПОЛЬЗОВАТЕЛЬ'],
    ['J — Цена продавца (API) — автоматически (Ozon Seller API)'],
    ['K — Цена на сайте Ozon, Москва — автоматически (парсинг сайта)'],
    ['L — Скидка на сайте % — автоматически (из парсинга)'],
    ['M — (пустая разделитель)'],
    ['N — Цена для загрузки — рассчитывается автоматически'],
    ['O — В эластичном бустинге? — автоматически (TRUE/FALSE)'],
    ['P — Статус загрузки — автоматически после загрузки'],
    [],
    ['## 🧮 Алгоритм расчёта цены'],
    ['1. Целевая цена = РРЦ (если задана) или текущая цена продавца'],
    ['2. Если целевая < минимальная цена: целевая = минимальная'],
    ['3. Итоговая цена округляется до целого'],
    ['4. Проверка эластичного бустинга:'],
    ['   - Запрашивается список акций через /v1/actions/list'],
    ['   - Ищется акция "Эластичный бустинг"'],
    ['   - Через /v1/actions/candidates проверяется участие товара'],
    ['   - Результат: TRUE (в бустинге) или FALSE (не в бустинге)'],
    [],
    ['## 🌐 Парсинг цен с сайта Ozon (Москва)'],
    ['Запрос идёт к публичному API Ozon через entrypoint-api.'],
    ['Заголовок X-O3-Region-Id: 1 указывает регион Москва.'],
    ['Парсинг извлекает цену и скидку из widgetStates ответа.'],
    ['Между запросами пауза 2 секунды для предотвращения бана.'],
    [],
    ['## ⚙️ Настройки'],
    ['Client ID / API Key — учётные данные Ozon Seller API'],
    ['Частота автообновления — интервал для триггера (минуты)'],
    ['Пороговая разница — на сколько быть ниже конкурента (₽)'],
    [],
    ['## ⚠️ Важно'],
    ['• РРЦ и минимальные цены нужно заполнить вручную (колонки H, I)'],
    ['• Парсинг сайта может работать с перебоями при изменении API Ozon'],
    ['• При превышении лимитов API скрипт делает паузы автоматически'],
    ['• Лог всех операций записывается на лист "Лог"'],
]

# Clear old instruction and write new
sheets.spreadsheets().values().clear(
    spreadsheetId=SPREADSHEET_ID,
    range='Инструкция!A1:E100'
).execute()

sheets.spreadsheets().values().update(
    spreadsheetId=SPREADSHEET_ID,
    range='Инструкция!A1',
    valueInputOption='USER_ENTERED',
    body={'values': instruction_content}
).execute()
print("  Инструкция updated")

# =========================================================================
# STEP 5: Update Настройки sheet - clean up competitor threshold row
# =========================================================================
print("\n=== Step 5: Update 'Настройки' sheet ===")
# Clear old row 8 (пороговая разница was for competitors, keep for general use)
# Keep as-is since threshold is still used in config
# Just ensure the structure is clean
settings_data = [
    ['Параметр', 'Значение', 'Описание'],
    ['Client ID', '', 'API Client ID'],
    ['API Key', '', 'API Key'],
    [],
    ['Параметр', 'Значение', 'Описание'],
    ['Пороговая разница цен (руб)', '5', 'Минимальная разница для обновления'],
]

# Don't overwrite settings - keep existing credentials
# Just verify structure is fine
print("  Настройки kept as-is (preserving credentials)")

print("\n=== ALL DONE ===")
print("Changes summary:")
print("1. ✅ Deleted 'Конкуренты' sheet")
print("2. ✅ Updated 'Репрайсер' headers (A-P, new structure)")
print("3. ✅ Formatted: center alignment, bold headers, frozen row, column widths")
print("4. ✅ Updated Apps Script (removed competitors, added site parsing, elastic boost)")
print("5. ✅ Updated 'Инструкция' sheet")
