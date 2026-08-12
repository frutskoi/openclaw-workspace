// ===== РЕПРАЙСЕР OZON v4 =====
// Исправлено: правильные API эндпоинты, рабочий loadOzonProducts

// Конфигурация
function getConfig() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const settings = ss.getSheetByName('Настройки');
  return {
    clientId: settings.getRange('B3').getValue().toString().trim(),
    apiKey: settings.getRange('C3').getValue().toString().trim(),
    baseUrl: 'https://api-seller.ozon.ru',
    threshold: parseFloat(settings.getRange('B8').getValue()) || 5
  };
}

// API запрос к Ozon Seller API
function ozonApi(endpoint, body) {
  const config = getConfig();
  if (!config.clientId || !config.apiKey) {
    throw new Error('Заполните Client ID и API Key в листе "Настройки"');
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
  return JSON.parse(response.getContentText());
}

// API GET запрос
function ozonApiGet(endpoint) {
  const config = getConfig();
  if (!config.clientId || !config.apiKey) {
    throw new Error('Заполните Client ID и API Key в листе "Настройки"');
  }
  const options = {
    method: 'get',
    contentType: 'application/json',
    headers: {
      'Client-Id': config.clientId,
      'Api-Key': config.apiKey
    },
    muteHttpExceptions: true
  };
  const response = UrlFetchApp.fetch(config.baseUrl + endpoint, options);
  return JSON.parse(response.getContentText());
}

// Безопасный alert
function showAlert(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log('Alert: ' + msg);
  }
}

// Логирование
function logAction(action, status, details) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName('Лог');
  logSheet.appendRow([new Date(), action, status, details]);
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
  const lastRow = sheet.getLastRow();

  Logger.log('=== Начинаю загрузку товаров Ozon ===');

  // Шаг 1: Получить список товаров через /v3/product/list
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
      const errMsg = result ? JSON.stringify(result) : 'Пустой ответ';
      logAction('Загрузка товаров', 'Ошибка', 'v3/product/list: ' + errMsg);
      showAlert('❌ Ошибка загрузки товаров.\n\n' + errMsg);
      return;
    }

    const items = result.result.items || [];
    allItems = allItems.concat(items);
    lastId = result.result.last_id;
    hasMore = items.length === 100;
  }

  Logger.log('Найдено товаров: ' + allItems.length);

  if (allItems.length === 0) {
    showAlert('⚠️ Товары не найдены. Проверьте API ключи.');
    logAction('Загрузка товаров', 'Пусто', '0 товаров');
    return;
  }

  // Сохранить пользовательские данные (H=РРЦ, I=Мин.цена) перед очисткой
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

  // Очистить старые данные
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 16).clearContent();
  }

  // Шаг 2: Получить описания товаров через /v1/product/info/description
  let success = 0;
  let errors = 0;

  for (let i = 0; i < allItems.length; i++) {
    try {
      const item = allItems[i];
      const productId = item.product_id;
      const offerId = item.offer_id || '';

      // Получить название товара
      let name = '';
      try {
        const detail = ozonApi('/v1/product/info/description', { product_id: productId });
        if (detail && detail.result) {
          name = detail.result.name || '';
        }
      } catch (e) {
        Logger.log('Ошибка описания ' + productId + ': ' + e.message);
      }

      const row = i + 2;

      // A — Фото (конструируем URL из product_id)
      // Ozon CDN: /s3/multimedia-1c/{product_id}.jpg или /multimedia/{product_id}.jpg
      // Надёжнее всего использовать offer_id для ссылки на Ozon
      // Используем формулу IMAGE с публичной ссылкой на товар
      if (productId) {
        sheet.getRange(row, 1).setValue('');
        // Фото пока пустое — Ozon не даёт прямые ссылки через API
        // Можно позже добавить через парсинг сайта
      }

      // B — Product ID
      sheet.getRange(row, 2).setValue(productId);
      // C — Offer ID
      sheet.getRange(row, 3).setValue(offerId);
      // D — Название
      sheet.getRange(row, 4).setValue(name);
      // E — Бренд (из offer_id или имени)
      // F — Рейтинг (позже через парсинг)

      // Восстановить РРЦ и мин. цену
      const saved = userData[productId.toString()];
      if (saved) {
        if (saved.rrc) sheet.getRange(row, 8).setValue(saved.rrc);
        if (saved.minP) sheet.getRange(row, 9).setValue(saved.minP);
      }

      success++;

      // Пауза каждые 5 товаров (лимит 6 запросов/сек)
      if (i % 5 === 4) {
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log('Ошибка товара ' + allItems[i].product_id + ': ' + e.message);
      errors++;
    }
  }

  logAction('Загрузка товаров', 'Успешно', 'Всего: ' + allItems.length + ', Загружено: ' + success + ', Ошибок: ' + errors);
  showAlert('✅ Загрузка завершена\n\nВсего товаров: ' + allItems.length + '\nЗагружено: ' + success + '\nОшибок: ' + errors);
}

// Скрипт 2: Получить цены с Ozon Seller API
function getOzonPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('=== Получение цен Ozon API ===');

  // Получить ВСЕ цены через /v5/product/info/prices
  const priceMap = {};
  let cursor = '';
  let hasMore = true;

  while (hasMore) {
    const result = ozonApi('/v5/product/info/prices', {
      filter: { visibility: 'ALL' },
      cursor: cursor,
      limit: 100
    });

    if (!result) break;

    const items = result.items || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.product_id) {
        priceMap[item.product_id] = item;
      }
    }

    cursor = result.cursor || '';
    hasMore = items.length === 100 && cursor !== '';
  }

  Logger.log('Получено цен: ' + Object.keys(priceMap).length);

  // Записать цены в таблицу
  let success = 0;
  let notFound = 0;

  for (let row = 2; row <= lastRow; row++) {
    const pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;

    const priceData = priceMap[pid];
    if (!priceData) {
      notFound++;
      continue;
    }

    const priceInfo = priceData.price || {};

    // J (10) — Цена продавца (price из API)
    sheet.getRange(row, 10).setValue(priceInfo.price || '');

    success++;
  }

  logAction('Получение цен (API)', 'Завершено', 'Успешно: ' + success + ', Не найдено: ' + notFound);
  showAlert('✅ Цены обновлены (API)\n\nУспешно: ' + success + '\nНе найдено: ' + notFound);
}

// Скрипт 3: Парсинг цен с сайта Ozon (регион Москва)
function parseOzonSitePrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('=== Парсинг цен с сайта Ozon (Москва) ===');

  let success = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    if (!productId) continue;

    try {
      // Публичный API карточки товара, X-O3-Region-Id: 1 = Москва
      const productUrl = 'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/product/-/' + productId + '/&layout_page_id=&page_changed=true';

      const options = {
        method: 'get',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Accept-Language': 'ru-RU,ru;q=0.9',
          'X-O3-Region-Id': '1'
        },
        muteHttpExceptions: true,
        followRedirects: true
      };

      const response = UrlFetchApp.fetch(productUrl, options);
      const responseCode = response.getResponseCode();

      if (responseCode === 200) {
        const json = JSON.parse(response.getContentText());

        let sitePrice = null;
        let siteDiscount = null;

        if (json && json.widgetStates) {
          const ws = json.widgetStates;

          for (const key in ws) {
            try {
              const widget = JSON.parse(ws[key]);

              // Структура 1: price в корне
              if (widget.price !== undefined && widget.price !== null && typeof widget.price === 'number') {
                sitePrice = widget.price;
                if (widget.discount !== undefined) siteDiscount = widget.discount;
                break;
              }

              // Структура 2: cellTrackingData
              if (widget.cellTrackingData && widget.cellTrackingData.finalPrice) {
                sitePrice = parseInt(widget.cellTrackingData.finalPrice);
                siteDiscount = widget.cellTrackingData.discount || null;
                break;
              }

              // Структура 3: mainState
              if (widget.mainState && widget.mainState.price) {
                sitePrice = typeof widget.mainState.price === 'number' ? widget.mainState.price : parseInt(widget.mainState.price);
                siteDiscount = widget.mainState.discount || null;
                break;
              }

              // Структура 4: регулярка
              if (!sitePrice) {
                const priceStr = JSON.stringify(widget);
                const priceMatch = priceStr.match(/"price"\s*:\s*(\d+)/);
                const discountMatch = priceStr.match(/"discount"\s*:\s*(\d+(?:\.\d+)?)/);

                if (priceMatch) {
                  sitePrice = parseInt(priceMatch[1]);
                  siteDiscount = discountMatch ? parseFloat(discountMatch[1]) : null;
                }
              }

            } catch (e) {
              // skip non-JSON
            }
          }
        }

        if (sitePrice && sitePrice > 0) {
          // K (11) — Цена на сайте Ozon (Москва)
          sheet.getRange(row, 11).setValue(sitePrice);

          // L (12) — Скидка на сайте %
          if (siteDiscount !== null) {
            sheet.getRange(row, 12).setValue(siteDiscount);
          } else {
            const sellerPrice = parseFloat(sheet.getRange(row, 10).getValue());
            if (sellerPrice && sellerPrice > sitePrice) {
              sheet.getRange(row, 12).setValue(Math.round((1 - sitePrice / sellerPrice) * 100));
            }
          }
          success++;
        } else {
          Logger.log('Цена не найдена для товара ' + productId);
          errors++;
        }
      } else {
        Logger.log('HTTP ' + responseCode + ' для товара ' + productId);
        errors++;
      }

      // Пауза 2 сек
      Utilities.sleep(2000);

    } catch (e) {
      Logger.log('Ошибка парсинга ' + productId + ': ' + e.message);
      errors++;
    }
  }

  logAction('Парсинг цен (Москва)', 'Завершено', 'Успешно: ' + success + ', Ошибок: ' + errors);
  showAlert('✅ Парсинг завершен\n\nУспешно: ' + success + '\nОшибок: ' + errors);
}

// Получить список акций "Эластичный бустинг"
function getElasticBoostActions() {
  try {
    // GET /v1/actions — список акций
    const result = ozonApiGet('/v1/actions');

    if (!result || !result.result) return [];

    const actions = result.result.actions || result.result || [];
    const boostActions = [];

    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      const title = (a.title || '').toLowerCase();
      const desc = (a.description || '').toLowerCase();
      const type = (a.actions_type || a.action_type || '').toLowerCase();

      if (title.indexOf('эластич') !== -1 || desc.indexOf('эластич') !== -1 ||
          type.indexOf('elastic') !== -1 || title.indexOf('бустинг') !== -1) {
        boostActions.push(a);
      }
    }

    Logger.log('Найдено акций эластичного бустинга: ' + boostActions.length);
    return boostActions;
  } catch (e) {
    Logger.log('Ошибка получения акций: ' + e.message);
    return [];
  }
}

// Проверить, проходит ли товар в эластичный бустинг
function checkProductInBoost(productId, price, boostActions) {
  for (let i = 0; i < boostActions.length; i++) {
    try {
      const action = boostActions[i];
      const actionId = action.action_id || action.id;

      const result = ozonApi('/v1/actions/candidates', {
        action_id: actionId.toString(),
        limit: 100,
        offset: 0
      });

      if (!result || !result.result) continue;

      const candidates = result.result.candidates || result.result.products || [];
      for (let j = 0; j < candidates.length; j++) {
        if (candidates[j].product_id == productId) {
          return true;
        }
      }
    } catch (e) {
      Logger.log('Ошибка проверки бустинга: ' + e.message);
    }
  }
  return false;
}

// Скрипт 4: Рассчитать цены
function calculatePrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных');
    return;
  }

  Logger.log('=== Расчёт цен ===');

  // Получаем акции эластичного бустинга
  let boostActions = [];
  try {
    boostActions = getElasticBoostActions();
  } catch (e) {
    Logger.log('Не удалось получить акции: ' + e.message);
  }

  let updated = 0;

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    const minPrice = parseFloat(sheet.getRange(row, 9).getValue());     // I — Мин. цена
    const rrc = parseFloat(sheet.getRange(row, 8).getValue());          // H — РРЦ
    const currentPrice = parseFloat(sheet.getRange(row, 10).getValue()); // J — Цена продавца

    if (!currentPrice) continue;

    // Целевая цена = РРЦ если задана, иначе текущая
    let targetPrice = rrc || currentPrice;

    // Не ниже минимальной
    if (minPrice && targetPrice < minPrice) {
      targetPrice = minPrice;
    }

    targetPrice = Math.round(targetPrice);

    // N (14) — Цена для загрузки
    sheet.getRange(row, 14).setValue(targetPrice);

    // O (15) — Проверка эластичного бустинга
    if (productId && boostActions.length > 0) {
      try {
        const isInBoost = checkProductInBoost(productId, targetPrice, boostActions);
        sheet.getRange(row, 15).setValue(isInBoost);
      } catch (e) {
        sheet.getRange(row, 15).setValue(false);
      }
    } else {
      sheet.getRange(row, 15).setValue(false);
    }

    updated++;
  }

  logAction('Расчёт цен', 'Завершено', 'Обновлено: ' + updated + ', Акций бустинга: ' + boostActions.length);
  showAlert('✅ Цены рассчитаны\n\nОбновлено: ' + updated + '\nАкций эл. бустинга: ' + boostActions.length);
}

// Скрипт 5: Загрузить цены на Ozon
function uploadPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных');
    return;
  }

  Logger.log('=== Загрузка цен на Ozon ===');

  const prices = [];

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    const targetPrice = parseFloat(sheet.getRange(row, 14).getValue()); // N — Цена для загрузки
    const currentPrice = parseFloat(sheet.getRange(row, 10).getValue()); // J — Текущая цена

    if (!productId || !targetPrice) continue;

    // Пропускаем если разница < 1₽
    if (currentPrice && Math.abs(targetPrice - currentPrice) < 1) {
      sheet.getRange(row, 16).setValue('⏭ Без изменений');
      continue;
    }

    prices.push({
      product_id: productId,
      price: targetPrice.toString(),
      row: row
    });
  }

  if (prices.length === 0) {
    showAlert('✅ Нет товаров для обновления (все цены актуальны)');
    return;
  }

  // Загружаем батчами по 100
  let totalSuccess = 0;
  let totalErrors = 0;

  for (let i = 0; i < prices.length; i += 100) {
    const batch = prices.slice(i, i + 100);

    const result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price }; })
    });

    if (result && !result.code) {
      totalSuccess += batch.length;
      for (let j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 16).setValue('✅ ' + batch[j].price + '₽');
      }
    } else {
      totalErrors += batch.length;
      const errMsg = result ? result.message || JSON.stringify(result) : 'неизвестная ошибка';
      for (let j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 16).setValue('❌ ' + errMsg);
      }
    }

    Utilities.sleep(500);
  }

  logAction('Загрузка цен', 'Завершено', 'Успешно: ' + totalSuccess + ', Ошибок: ' + totalErrors);
  showAlert('✅ Цены загружены\n\nУспешно: ' + totalSuccess + '\nОшибок: ' + totalErrors);
}

// Полный цикл
function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  parseOzonSitePrices();
  calculatePrices();
}
