// ===== РЕПРАЙСЕР OZON v6 =====
// v6: убраны разделители, новые колонки M-P-Q
// A-Q = 17 колонок

// Конфигурация
function getConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = ss.getSheetByName('Настройки');
  return {
    clientId: settings.getRange('B3').getValue().toString().trim(),
    apiKey: settings.getRange('C3').getValue().toString().trim(),
    baseUrl: 'https://api-seller.ozon.ru'
  };
}

// API POST
function ozonApi(endpoint, body) {
  var config = getConfig();
  if (!config.clientId || !config.apiKey) {
    throw new Error('Заполните Client ID и API Key в листе "Настройки"');
  }
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Client-Id': config.clientId,
      'Api-Key': config.apiKey
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(config.baseUrl + endpoint, options);
  return JSON.parse(response.getContentText());
}

// API GET
function ozonApiGet(endpoint) {
  var config = getConfig();
  if (!config.clientId || !config.apiKey) {
    throw new Error('Заполните Client ID и API Key в листе "Настройки"');
  }
  var options = {
    method: 'get',
    contentType: 'application/json',
    headers: {
      'Client-Id': config.clientId,
      'Api-Key': config.apiKey
    },
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(config.baseUrl + endpoint, options);
  return JSON.parse(response.getContentText());
}

function showAlert(title, msg) {
  try { SpreadsheetApp.getUi().alert(title, msg); }
  catch (e) { Logger.log(title + ': ' + msg); }
}

function logAction(action, status, details) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('Лог');
  if (logSheet) logSheet.appendRow([new Date(), action, status, details]);
}

// Расчёт цены покупателя из индекса
function calcBuyerPrice(priceIndexValue, minCompetitorPrice) {
  if (!priceIndexValue || !minCompetitorPrice || priceIndexValue === 0 || minCompetitorPrice === 0) return null;
  var idx = parseFloat(priceIndexValue);
  var minP = parseFloat(minCompetitorPrice);
  var result;
  if (idx < 1) { result = idx * minP; }
  else if (idx > 1) { result = minP / (2 - idx); }
  else { result = minP; }
  return Math.round(result);
}

// Цвет индекса → текст
function colorIndexText(color) {
  if (!color) return '';
  var c = color.toUpperCase();
  if (c === 'GREEN') return '🟢 Зелёный';
  if (c === 'PURPLE' || c === 'VIOLET') return '🟣 Супервыгодный';
  if (c === 'YELLOW') return '🟡 Пограничный';
  if (c === 'RED') return '🔴 Невыгодный';
  return color;
}

// =====================================================================
// Меню
// =====================================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🟣 Репрайсер Ozon')
    .addItem('1. Загрузить товары', 'loadOzonProducts')
    .addItem('2. Цены + индекс (API)', 'getOzonPrices')
    .addItem('3. Цена с сайта (парсинг)', 'parseOzonSitePrices')
    .addSeparator()
    .addItem('4. Рассчитать цены', 'calculatePrices')
    .addItem('5. Загрузить цены на Ozon', 'uploadPrices')
    .addSeparator()
    .addItem('📊 Полный цикл (1→2→3→4)', 'fullCycle')
    .addToUi();
}

// =====================================================================
// 1. Загрузить товары
// =====================================================================
function loadOzonProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  Logger.log('=== Загрузка товаров Ozon ===');

  // Получить список
  var allItems = [];
  var lastId = '';
  var hasMore = true;
  while (hasMore) {
    var result = ozonApi('/v3/product/list', {
      filter: { visibility: 'ALL' },
      limit: 100,
      last_id: lastId
    });
    if (!result || !result.result) {
      var errMsg = result ? JSON.stringify(result) : 'Пустой ответ';
      logAction('Загрузка товаров', 'Ошибка', errMsg);
      showAlert('Ошибка', errMsg);
      return;
    }
    var items = result.result.items || [];
    allItems = allItems.concat(items);
    lastId = result.result.last_id;
    hasMore = items.length === 100;
  }
  Logger.log('Товаров: ' + allItems.length);
  if (allItems.length === 0) {
    showAlert('Внимание', 'Товары не найдены');
    return;
  }

  // Сохранить пользовательские данные (G=РРЦ, H=Мин.цена)
  var userData = {};
  if (lastRow >= 2) {
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      var rrc = sheet.getRange(r, 7).getValue();
      var minP = sheet.getRange(r, 8).getValue();
      if (pid) userData[pid.toString()] = { rrc: rrc, minP: minP };
    }
  }

  // Очистить данные (17 колонок A-Q)
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 17).clearContent();

  // Загрузить фото batch
  var productIds = [];
  for (var i = 0; i < allItems.length; i++) productIds.push(allItems[i].product_id);

  var photoMap = {};
  try {
    var photoResult = ozonApi('/v2/product/pictures/info', { product_id: productIds });
    if (photoResult && photoResult.items) {
      for (var p = 0; p < photoResult.items.length; p++) {
        var pItem = photoResult.items[p];
        var primary = pItem.primary_photo || [];
        if (primary.length > 0) photoMap[pItem.product_id] = primary[0];
      }
    }
    Logger.log('Фото: ' + Object.keys(photoMap).length);
  } catch (e) {
    Logger.log('Ошибка фото: ' + e.message);
  }

  // Загрузить детали каждого товара
  var success = 0, errors = 0;
  for (var i = 0; i < allItems.length; i++) {
    try {
      var item = allItems[i];
      var productId = item.product_id;
      var offerId = item.offer_id || '';
      var name = '';
      try {
        var detail = ozonApi('/v1/product/info/description', { product_id: productId });
        if (detail && detail.result) name = detail.result.name || '';
      } catch (e) {}

      var row = i + 2;

      // A — Фото
      if (photoMap[productId]) {
        sheet.getRange(row, 1).setFormula('=IMAGE("' + photoMap[productId] + '")');
      }
      // B — Product ID
      sheet.getRange(row, 2).setValue(productId);
      // C — Offer ID
      sheet.getRange(row, 3).setValue(offerId);
      // D — Название
      sheet.getRange(row, 4).setValue(name);
      // E, F — Бренд, Рейтинг (позже)

      // Восстановить РРЦ и мин. цену
      var saved = userData[productId.toString()];
      if (saved) {
        if (saved.rrc) sheet.getRange(row, 7).setValue(saved.rrc);
        if (saved.minP) sheet.getRange(row, 8).setValue(saved.minP);
      }
      success++;
      if (i % 5 === 4) Utilities.sleep(1000);
    } catch (e) {
      errors++;
    }
  }
  logAction('Загрузка товаров', 'Успешно', 'Всего: ' + allItems.length + ', ОК: ' + success + ', Ошибок: ' + errors);
  showAlert('Готово', 'Загружено: ' + success + '\nОшибок: ' + errors);
}

// =====================================================================
// 2. Цены + индекс (API)
// Заполняет: I (цена продавца), K (цена с кошельком), M (индекс цен), N (цвет)
// =====================================================================
function getOzonPrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Сначала загрузите товары'); return; }

  Logger.log('=== Цены + индекс API ===');

  // Получить ВСЕ данные через /v5/product/info/prices
  var priceMap = {};
  var cursor = '';
  var hasMore = true;
  while (hasMore) {
    var result = ozonApi('/v5/product/info/prices', {
      filter: { visibility: 'ALL' },
      cursor: cursor,
      limit: 100
    });
    if (!result) break;
    var items = result.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].product_id) priceMap[items[i].product_id] = items[i];
    }
    cursor = result.cursor || '';
    hasMore = items.length === 100 && cursor !== '';
  }
  Logger.log('Записей: ' + Object.keys(priceMap).length);

  var successPrice = 0, successIndex = 0, notFound = 0;

  for (var row = 2; row <= lastRow; row++) {
    var pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;
    var priceData = priceMap[pid];
    if (!priceData) { notFound++; continue; }

    var priceInfo = priceData.price || {};

    // I (9) — Цена продавца
    sheet.getRange(row, 9).setValue(priceInfo.price || '');
    successPrice++;

    // === Индекс цен ===
    var pIdx = priceData.price_indexes || {};
    var ozonIdx = pIdx.ozon_index_data || {};
    var extIdx = pIdx.external_index_data || {};
    var selfIdx = pIdx.self_marketplaces_index_data || {};
    var colorIdx = pIdx.color_index || '';

    // Приоритет: ozon → external → self
    var idxValue = 0, minCompPrice = 0;
    if (ozonIdx.price_index_value && ozonIdx.price_index_value !== 0 && ozonIdx.min_price && ozonIdx.min_price !== 0) {
      idxValue = parseFloat(ozonIdx.price_index_value);
      minCompPrice = parseFloat(ozonIdx.min_price);
    } else if (extIdx.price_index_value && extIdx.price_index_value !== 0 && extIdx.min_price && extIdx.min_price !== 0) {
      idxValue = parseFloat(extIdx.price_index_value);
      minCompPrice = parseFloat(extIdx.min_price);
    } else if (selfIdx.price_index_value && selfIdx.price_index_value !== 0 && selfIdx.min_price && selfIdx.min_price !== 0) {
      idxValue = parseFloat(selfIdx.price_index_value);
      minCompPrice = parseFloat(selfIdx.min_price);
    }

    // M (13) — Индекс цен (цифра)
    if (idxValue !== 0) {
      sheet.getRange(row, 13).setValue(idxValue);
    }

    // N (14) — Цвет индекса
    if (colorIdx) {
      sheet.getRange(row, 14).setValue(colorIndexText(colorIdx));
    }

    // K (11) — Цена с кошельком (расчёт)
    if (idxValue !== 0 && minCompPrice !== 0) {
      var walletPrice = calcBuyerPrice(idxValue, minCompPrice);
      if (walletPrice) {
        sheet.getRange(row, 11).setValue(walletPrice);
        successIndex++;
      }
    }
  }

  logAction('Цены + индекс', 'Завершено', 'Цен: ' + successPrice + ', Кошелёк: ' + successIndex + ', Не найдено: ' + notFound);
  showAlert('Готово', 'Цены: ' + successPrice + '\nС кошельком: ' + successIndex + '\nНе найдено: ' + notFound);
}

// =====================================================================
// 3. Цена с сайта (парсинг) — несколько методов
// Заполняет: J (цена с сайта), L (скидка %)
// =====================================================================
function parseOzonSitePrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Сначала загрузите товары'); return; }

  Logger.log('=== Парсинг цен с сайта ===');

  var success = 0, errors = 0;

  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    if (!productId) continue;

    var sitePrice = null;
    var siteDiscount = null;

    // Метод 1: entrypoint-api
    try {
      var result = fetchEntrypointPrice(productId);
      if (result && result.price) {
        sitePrice = result.price;
        siteDiscount = result.discount || null;
      }
    } catch (e) {
      Logger.log('Entrypoint ошибка ' + productId + ': ' + e.message);
    }

    // Метод 2: мобильный API (если первый не сработал)
    if (!sitePrice) {
      try {
        var result2 = fetchMobilePrice(productId);
        if (result2 && result2.price) {
          sitePrice = result2.price;
          siteDiscount = result2.discount || null;
        }
      } catch (e) {
        Logger.log('Mobile API ошибка ' + productId + ': ' + e.message);
      }
    }

    // Метод 3: GraphQL (если первые два не сработали)
    if (!sitePrice) {
      try {
        var result3 = fetchGraphQLPrice(productId);
        if (result3 && result3.price) {
          sitePrice = result3.price;
          siteDiscount = result3.discount || null;
        }
      } catch (e) {
        Logger.log('GraphQL ошибка ' + productId + ': ' + e.message);
      }
    }

    if (sitePrice && sitePrice > 0) {
      // J (10) — Цена с сайта
      sheet.getRange(row, 10).setValue(sitePrice);

      // L (12) — Скидка %
      if (siteDiscount !== null) {
        sheet.getRange(row, 12).setValue(siteDiscount);
      } else {
        var sellerPrice = parseFloat(sheet.getRange(row, 9).getValue());
        if (sellerPrice && sellerPrice > sitePrice) {
          sheet.getRange(row, 12).setValue(Math.round((1 - sitePrice / sellerPrice) * 100));
        }
      }
      success++;
    } else {
      errors++;
    }

    Utilities.sleep(2000);
  }

  logAction('Парсинг сайта', 'Завершено', 'Успешно: ' + success + ', Ошибок: ' + errors);
  showAlert('Готово', 'Успешно: ' + success + '\nОшибок: ' + errors);
}

// Метод 1: entrypoint-api
function fetchEntrypointPrice(productId) {
  var url = 'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/product/-/' + productId + '/&layout_page_id=&page_changed=true';
  var options = {
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
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());
  if (!json || !json.widgetStates) return null;

  var ws = json.widgetStates;
  for (var key in ws) {
    try {
      var widget = JSON.parse(ws[key]);
      // Структура 1: price в корне
      if (widget.price !== undefined && widget.price !== null && typeof widget.price === 'number' && widget.price > 0) {
        return { price: widget.price, discount: widget.discount || null };
      }
      // Структура 2: cellTrackingData
      if (widget.cellTrackingData && widget.cellTrackingData.finalPrice) {
        return { price: parseInt(widget.cellTrackingData.finalPrice), discount: widget.cellTrackingData.discount || null };
      }
      // Структура 3: mainState
      if (widget.mainState && widget.mainState.price) {
        var p = typeof widget.mainState.price === 'number' ? widget.mainState.price : parseInt(widget.mainState.price);
        return { price: p, discount: widget.mainState.discount || null };
      }
    } catch (e) {}
  }

  // Регулярка по всему ответу
  var fullStr = JSON.stringify(json);
  var pm = fullStr.match(/"(?:price|finalPrice)"\s*:\s*(\d{2,6})/);
  if (pm) return { price: parseInt(pm[1]), discount: null };
  return null;
}

// Метод 2: мобильный API
function fetchMobilePrice(productId) {
  // Сначала получим SKU через /v3/product/info/list
  var skuResult = ozonApi('/v3/product/info/list', {
    product_id: [productId],
    offer_id: [],
    sku: []
  });
  var sku = null;
  if (skuResult && skuResult.result && skuResult.result.items && skuResult.result.items.length > 0) {
    sku = skuResult.result.items[0].sku;
  }
  if (!sku) return null;

  var url = 'https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=/product/-/' + sku + '/&layout_page_id=&page_changed=true';
  var options = {
    method: 'get',
    headers: {
      'User-Agent': 'Ozon/4.0 (Android 14; Phone)',
      'Accept': 'application/json',
      'Accept-Language': 'ru-RU',
      'X-O3-Region-Id': '1',
      'X-O3-Device-Type': 'mobile'
    },
    muteHttpExceptions: true,
    followRedirects: true
  };
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());

  // Ищем цену в widgetStates
  if (json && json.widgetStates) {
    var ws = json.widgetStates;
    for (var key in ws) {
      try {
        var widget = JSON.parse(ws[key]);
        if (widget.price !== undefined && typeof widget.price === 'number' && widget.price > 0) {
          return { price: widget.price, discount: widget.discount || null };
        }
        if (widget.cellTrackingData && widget.cellTrackingData.finalPrice) {
          return { price: parseInt(widget.cellTrackingData.finalPrice), discount: widget.cellTrackingData.discount || null };
        }
      } catch (e) {}
    }
  }
  return null;
}

// Метод 3: GraphQL
function fetchGraphQLPrice(productId) {
  // Получить SKU
  var skuResult = ozonApi('/v3/product/info/list', {
    product_id: [productId],
    offer_id: [],
    sku: []
  });
  var sku = null;
  if (skuResult && skuResult.result && skuResult.result.items && skuResult.result.items.length > 0) {
    sku = skuResult.result.items[0].sku;
  }
  if (!sku) return null;

  var url = 'https://www.ozon.ru/api/composer-api.bx/_graphql';
  var payload = {
    query: 'query SearchProduct($slug: String!) { searchProduct(slug: $slug) { items { id sku price { price discount cardPrice } } } }',
    variables: { slug: sku.toString() }
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'application/json',
      'X-O3-Region-Id': '1'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };
  var response = UrlFetchApp.fetch(url, options);
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());
  if (json && json.data && json.data.searchProduct && json.data.searchProduct.items) {
    var items = json.data.searchProduct.items;
    for (var i = 0; i < items.length; i++) {
      if (items[i].sku == sku && items[i].price) {
        return { price: items[i].price.price, discount: items[i].price.discount || null };
      }
    }
  }
  return null;
}

// =====================================================================
// Эластичный бустинг
// =====================================================================
function getElasticBoostActions() {
  try {
    var result = ozonApiGet('/v1/actions');
    if (!result || !result.result) return [];
    var actions = result.result.actions || result.result || [];
    var boostActions = [];
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var title = (a.title || '').toLowerCase();
      var desc = (a.description || '').toLowerCase();
      if (title.indexOf('эластич') !== -1 || desc.indexOf('эластич') !== -1 || title.indexOf('бустинг') !== -1) {
        boostActions.push(a);
      }
    }
    Logger.log('Акций бустинга: ' + boostActions.length);
    return boostActions;
  } catch (e) {
    Logger.log('Ошибка акций: ' + e.message);
    return [];
  }
}

// Проверить товар в бустинге, возвращает { inBoost: bool, actionCount: number }
function checkProductBoostInfo(productId, price, boostActions) {
  var inBoost = false;
  var actionCount = 0;
  for (var i = 0; i < boostActions.length; i++) {
    try {
      var action = boostActions[i];
      var actionId = action.action_id || action.id;
      var result = ozonApi('/v1/actions/candidates', {
        action_id: actionId.toString(),
        limit: 100,
        offset: 0
      });
      if (!result || !result.result) continue;
      var candidates = result.result.candidates || result.result.products || [];
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].product_id == productId) {
          actionCount++;
          // Проверяем подходит ли цена
          if (price && candidates[j].price && parseFloat(candidates[j].price) <= price) {
            inBoost = true;
          } else if (!candidates[j].price) {
            inBoost = true;
          }
        }
      }
    } catch (e) {
      Logger.log('Ошибка проверки бустинга: ' + e.message);
    }
  }
  return { inBoost: inBoost, actionCount: actionCount };
}

// =====================================================================
// 4. Рассчитать цены
// =====================================================================
function calculatePrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Расчёт цен ===');

  var boostActions = [];
  try { boostActions = getElasticBoostActions(); } catch (e) {}

  var updated = 0;

  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var rrc = parseFloat(sheet.getRange(row, 7).getValue());          // G — РРЦ
    var minPrice = parseFloat(sheet.getRange(row, 8).getValue());     // H — Мин. цена
    var currentPrice = parseFloat(sheet.getRange(row, 9).getValue()); // I — Цена продавца

    if (!currentPrice) continue;

    // Целевая цена = РРЦ если задана, иначе текущая
    var targetPrice = rrc || currentPrice;

    // Не ниже минимальной
    if (minPrice && targetPrice < minPrice) targetPrice = minPrice;
    targetPrice = Math.round(targetPrice);

    // P (16) — Цена для загрузки
    sheet.getRange(row, 16).setValue(targetPrice);

    // Q (17) — Эластичный бустинг + кол-во акций
    if (productId && boostActions.length > 0) {
      try {
        var boostInfo = checkProductBoostInfo(productId, targetPrice, boostActions);
        var boostText = (boostInfo.inBoost ? '✅' : '❌') + ' ' + boostInfo.actionCount + ' акц.';
        sheet.getRange(row, 17).setValue(boostText);
      } catch (e) {
        sheet.getRange(row, 17).setValue('❌ Ошибка');
      }
    } else {
      sheet.getRange(row, 17).setValue('—');
    }

    updated++;
  }

  logAction('Расчёт цен', 'Завершено', 'Обновлено: ' + updated + ', Акций: ' + boostActions.length);
  showAlert('Готово', 'Рассчитано: ' + updated + '\nАкций бустинга: ' + boostActions.length);
}

// =====================================================================
// 5. Загрузить цены на Ozon
// =====================================================================
function uploadPrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Загрузка цен ===');

  var prices = [];
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var targetPrice = parseFloat(sheet.getRange(row, 16).getValue()); // P
    var currentPrice = parseFloat(sheet.getRange(row, 9).getValue()); // I

    if (!productId || !targetPrice) continue;
    if (currentPrice && Math.abs(targetPrice - currentPrice) < 1) {
      sheet.getRange(row, 15).setValue('⏭ Без изменений');
      continue;
    }
    prices.push({ product_id: productId, price: targetPrice.toString(), row: row });
  }

  if (prices.length === 0) {
    showAlert('Готово', 'Нет товаров для обновления');
    return;
  }

  var totalSuccess = 0, totalErrors = 0;
  for (var i = 0; i < prices.length; i += 100) {
    var batch = prices.slice(i, i + 100);
    var result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price }; })
    });
    if (result && !result.code) {
      totalSuccess += batch.length;
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 15).setValue('✅ ' + batch[j].price + '₽');
      }
    } else {
      totalErrors += batch.length;
      var errMsg = result ? result.message || JSON.stringify(result) : 'ошибка';
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 15).setValue('❌ ' + errMsg);
      }
    }
    Utilities.sleep(500);
  }

  logAction('Загрузка цен', 'Завершено', 'ОК: ' + totalSuccess + ', Ошибок: ' + totalErrors);
  showAlert('Готово', 'Успешно: ' + totalSuccess + '\nОшибок: ' + totalErrors);
}

// Полный цикл
function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  parseOzonSitePrices();
  calculatePrices();
}
