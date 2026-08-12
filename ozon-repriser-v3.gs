// ===== РЕПРАЙСЕР OZON v3 =====
// Исправлено: ui.alert() с одним аргументом, улучшена логика

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
  const json = JSON.parse(response.getContentText());
  if (json.code && json.code !== 0) {
    Logger.log('API Error ' + endpoint + ': ' + JSON.stringify(json));
  }
  return json;
}

// Безопасный alert (один аргумент — строка)
function showAlert(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log('Alert: ' + msg);
  }
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
      logSheet.appendRow([new Date(), 'Загрузка товаров', 'Ошибка', 'API вернул ошибку: ' + JSON.stringify(result)]);
      showAlert('❌ Ошибка загрузки товаров. Проверьте лог.');
      return;
    }

    const items = result.result.items || [];
    allItems = allItems.concat(items);
    lastId = result.result.last_id;
    hasMore = items.length === 100;
  }

  Logger.log('Найдено товаров: ' + allItems.length);

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
        Logger.log('Нет деталей для товара ' + productId);
        errors++;
      }

      // Пауза для лимитов API (6 запросов/сек)
      if (i % 5 === 4) {
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log('Ошибка товара ' + allItems[i].product_id + ': ' + e.message);
      errors++;
    }
  }

  logSheet.appendRow([new Date(), 'Загрузка товаров', 'Успешно', 'Загружено: ' + success + ', Ошибок: ' + errors]);
  showAlert('✅ Загрузка завершена\n\nЗагружено: ' + success + '\nОшибок: ' + errors);
}

// Скрипт 2: Получить цены с Ozon Seller API
function getOzonPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('Начинаю получение цен Ozon API...');

  // Получить все цены через пагинацию
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
    for (const item of items) {
      if (item.product_id) {
        priceMap[item.product_id] = item;
      }
    }

    cursor = result.cursor || '';
    hasMore = items.length === 100 && cursor !== '';
  }

  Logger.log('Получено цен из API: ' + Object.keys(priceMap).length);

  // Записать цены в таблицу
  let success = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;

    const priceData = priceMap[pid];
    if (!priceData) continue;

    try {
      const priceInfo = priceData.price || {};

      // J (10) — Цена продавца
      const sellerPrice = priceInfo.price || '';
      sheet.getRange(row, 10).setValue(sellerPrice);
      success++;
    } catch (e) {
      Logger.log('Ошибка цены товара ' + pid + ': ' + e.message);
      errors++;
    }
  }

  logSheet.appendRow([new Date(), 'Получение цен (API)', 'Завершено', 'Успешно: ' + success + ', Ошибок: ' + errors]);
  showAlert('✅ Цены обновлены (API)\n\nУспешно: ' + success + '\nОшибок: ' + errors);
}

// Скрипт 3: Парсинг цен с сайта Ozon (регион Москва)
function parseOzonSitePrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('Начинаю парсинг цен с сайта Ozon (Москва)...');

  let success = 0;
  let errors = 0;

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    const offerId = sheet.getRange(row, 3).getValue();
    if (!productId) continue;

    try {
      // Запрос к публичному API карточки товара
      // X-O3-Region-Id: 1 = Москва
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

        // Парсим widgetStates для поиска цены
        if (json && json.widgetStates) {
          const ws = json.widgetStates;

          for (const key in ws) {
            try {
              const widget = JSON.parse(ws[key]);

              // Структура 1: price в корне виджета
              if (widget.price !== undefined && widget.price !== null) {
                sitePrice = typeof widget.price === 'string' ? parseInt(widget.price) : widget.price;
                if (widget.discount !== undefined) siteDiscount = widget.discount;
                break;
              }

              // Структура 2: cellTrackingData.finalPrice
              if (widget.cellTrackingData) {
                const td = widget.cellTrackingData;
                if (td.finalPrice) {
                  sitePrice = parseInt(td.finalPrice);
                  siteDiscount = td.discount || null;
                  break;
                }
              }

              // Структура 3: mainState.price
              if (widget.mainState && widget.mainState.price) {
                sitePrice = typeof widget.mainState.price === 'string' ? parseInt(widget.mainState.price) : widget.mainState.price;
                siteDiscount = widget.mainState.discount || null;
                break;
              }

              // Структура 4: глубокий поиск через регулярки
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
          Logger.log('Цена не найдена в ответе для товара ' + productId);
          sheet.getRange(row, 11).setValue('Не найдено');
          errors++;
        }
      } else {
        Logger.log('Ozon site вернул код ' + responseCode + ' для товара ' + productId);
        sheet.getRange(row, 11).setValue('Ошибка ' + responseCode);
        errors++;
      }

      // Пауза 2 сек чтобы не получить бан
      Utilities.sleep(2000);

    } catch (e) {
      Logger.log('Ошибка парсинга товара ' + productId + ': ' + e.message);
      sheet.getRange(row, 11).setValue('Ошибка');
      errors++;
    }
  }

  logSheet.appendRow([new Date(), 'Парсинг цен сайта (Москва)', 'Завершено', 'Успешно: ' + success + ', Ошибок: ' + errors]);
  showAlert('✅ Парсинг завершен\n\nУспешно: ' + success + '\nОшибок: ' + errors);
}

// Получить список акций "Эластичный бустинг"
function getElasticBoostActions() {
  try {
    // /v1/actions/list не существует как POST, попробуем GET
    // Используем /v1/actions (GET) для получения списка
    const config = getConfig();
    const options = {
      method: 'get',
      contentType: 'application/json',
      headers: {
        'Client-Id': config.clientId,
        'Api-Key': config.apiKey
      },
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(config.baseUrl + '/v1/actions', options);
    const json = JSON.parse(response.getContentText());

    if (!json.result) return [];

    const actions = json.result.actions || json.result || [];

    // Ищем акции эластичного бустинга
    const boostActions = actions.filter(function(a) {
      const title = (a.title || '').toLowerCase();
      const desc = (a.description || '').toLowerCase();
      const type = (a.actions_type || a.action_type || '').toLowerCase();
      return title.includes('эластич') || desc.includes('эластич') || type.includes('elastic') || title.includes('бустинг');
    });

    Logger.log('Найдено акций эластичного бустинга: ' + boostActions.length);
    return boostActions;
  } catch (e) {
    Logger.log('Ошибка получения акций: ' + e.message);
    return [];
  }
}

// Проверить, проходит ли товар в эластичный бустинг по цене
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

// Скрипт 4: Рассчитать цены для загрузки
function calculatePrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');
  const config = getConfig();
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных');
    return;
  }

  // Получаем акции эластичного бустинга
  const boostActions = getElasticBoostActions();

  let updated = 0;

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    const minPrice = parseFloat(sheet.getRange(row, 9).getValue());     // I — Мин. цена
    const rrc = parseFloat(sheet.getRange(row, 8).getValue());          // H — РРЦ
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

    // N (14) — Цена для загрузки
    sheet.getRange(row, 14).setValue(targetPrice);

    // O (15) — Проверка эластичного бустинга
    if (productId && boostActions.length > 0) {
      const isInBoost = checkProductInBoost(productId, targetPrice, boostActions);
      sheet.getRange(row, 15).setValue(isInBoost);
    } else {
      sheet.getRange(row, 15).setValue(false);
    }

    updated++;
  }

  logSheet.appendRow([new Date(), 'Расчёт цен', 'Завершено', 'Обновлено: ' + updated + ' товаров, Акций бустинга: ' + boostActions.length]);
  showAlert('✅ Цены рассчитаны\n\nОбновлено: ' + updated + ' товаров\nАкций эл. бустинга: ' + boostActions.length);
}

// Скрипт 5: Загрузить цены на Ozon
function uploadPrices() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('Репрайсер');
  const logSheet = ss.getSheetByName('Лог');
  const lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('❌ Нет данных');
    return;
  }

  const prices = [];

  for (let row = 2; row <= lastRow; row++) {
    const productId = sheet.getRange(row, 2).getValue();
    const targetPrice = parseFloat(sheet.getRange(row, 14).getValue()); // N — Цена для загрузки
    const currentPrice = parseFloat(sheet.getRange(row, 10).getValue()); // J — Текущая цена

    if (!productId || !targetPrice) continue;

    // Пропускаем если разница меньше 1 рубля
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
    showAlert('✅ Нет товаров для обновления цен\n(все цены актуальны)');
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
        sheet.getRange(batch[j].row, 16).setValue('✅ Загружено ' + batch[j].price + '₽');
      }
    } else {
      totalErrors += batch.length;
      for (let j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 16).setValue('❌ Ошибка: ' + (result ? result.message : 'unknown'));
      }
    }

    Utilities.sleep(500);
  }

  logSheet.appendRow([new Date(), 'Загрузка цен', 'Завершено', 'Успешно: ' + totalSuccess + ', Ошибок: ' + totalErrors]);
  showAlert('✅ Цены загружены\n\nУспешно: ' + totalSuccess + '\nОшибок: ' + totalErrors);
}

// Полный цикл
function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  parseOzonSitePrices();
  calculatePrices();
}
