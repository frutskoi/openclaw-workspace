// ===== РЕПРАЙСЕР OZON v5 =====
// Изменения v5:
// - Колонка K: "Цена с кошельком" — расчёт через price_indexes из API
// - Колонка L: "Индекс цен" — price_index_value из ozon_index_data
// - Убран парсинг сайта из полного цикла (заменён расчётом через API)
// - Формула: index<1 → price=index*minPrice, index>1 → price=minPrice/(2-index)

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

// API POST запрос
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

// API GET запрос
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

// Безопасный alert
function showAlert(title, msg) {
  try {
    SpreadsheetApp.getUi().alert(title, msg);
  } catch (e) {
    Logger.log(title + ': ' + msg);
  }
}

// Логирование
function logAction(action, status, details) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('Лог');
  if (logSheet) {
    logSheet.appendRow([new Date(), action, status, details]);
  }
}

// =====================================================================
// Расчёт цены покупателя из индекса цен
// Формула из статьи Cleverence:
//   index < 1: buyerPrice = index × minPrice
//   index > 1: buyerPrice = minPrice / (2 - index)
//   index = 1: buyerPrice = minPrice
// =====================================================================
function calcBuyerPrice(priceIndexValue, minCompetitorPrice) {
  if (!priceIndexValue || !minCompetitorPrice || priceIndexValue === 0 || minCompetitorPrice === 0) {
    return null;
  }
  var idx = parseFloat(priceIndexValue);
  var minP = parseFloat(minCompetitorPrice);
  var result;
  if (idx < 1) {
    result = idx * minP;
  } else if (idx > 1) {
    result = minP / (2 - idx);
  } else {
    result = minP;
  }
  return Math.round(result);
}

// =====================================================================
// Создать меню
// =====================================================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🟣 Репрайсер Ozon')
    .addItem('1. Загрузить товары', 'loadOzonProducts')
    .addItem('2. Получить цены + индекс (API)', 'getOzonPrices')
    .addSeparator()
    .addItem('3. Рассчитать цены', 'calculatePrices')
    .addItem('4. Загрузить цены на Ozon', 'uploadPrices')
    .addSeparator()
    .addItem('📊 Полный цикл (1→2→3)', 'fullCycle')
    .addSeparator()
    .addItem('🔍 Парсинг цен с сайта (альтернатива)', 'parseOzonSitePrices')
    .addToUi();
}

// =====================================================================
// Скрипт 1: Загрузить товары с Ozon
// =====================================================================
function loadOzonProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  Logger.log('=== Начинаю загрузку товаров Ozon ===');

  // Шаг 1: Получить список товаров через /v3/product/list
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
      logAction('Загрузка товаров', 'Ошибка', 'v3/product/list: ' + errMsg);
      showAlert('Ошибка', 'Ошибка загрузки товаров.\n\n' + errMsg);
      return;
    }

    var items = result.result.items || [];
    allItems = allItems.concat(items);
    lastId = result.result.last_id;
    hasMore = items.length === 100;
  }

  Logger.log('Найдено товаров: ' + allItems.length);

  if (allItems.length === 0) {
    showAlert('Внимание', 'Товары не найдены. Проверьте API ключи.');
    logAction('Загрузка товаров', 'Пусто', '0 товаров');
    return;
  }

  // Сохранить пользовательские данные (H=РРЦ, I=Мин.цена) перед очисткой
  var userData = {};
  if (lastRow >= 2) {
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      var rrc = sheet.getRange(r, 8).getValue();
      var minP = sheet.getRange(r, 9).getValue();
      if (pid) {
        userData[pid.toString()] = { rrc: rrc, minP: minP };
      }
    }
  }

  // Очистить старые данные (кроме заголовка)
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 16).clearContent();
  }

  // Шаг 2: Загрузить фото через batch-запрос /v2/product/pictures/info
  var productIds = [];
  for (var i = 0; i < allItems.length; i++) {
    productIds.push(allItems[i].product_id);
  }

  var photoMap = {};
  try {
    var photoResult = ozonApi('/v2/product/pictures/info', { product_id: productIds });
    if (photoResult && photoResult.items) {
      for (var p = 0; p < photoResult.items.length; p++) {
        var pItem = photoResult.items[p];
        var primaryPhoto = pItem.primary_photo || [];
        if (primaryPhoto.length > 0) {
          photoMap[pItem.product_id] = primaryPhoto[0];
        }
      }
    }
    Logger.log('Загружено фото: ' + Object.keys(photoMap).length);
  } catch (e) {
    Logger.log('Ошибка загрузки фото: ' + e.message);
  }

  // Шаг 3: Получить описания товаров через /v1/product/info/description
  var success = 0;
  var errors = 0;

  for (var i = 0; i < allItems.length; i++) {
    try {
      var item = allItems[i];
      var productId = item.product_id;
      var offerId = item.offer_id || '';

      // Получить название товара
      var name = '';
      try {
        var detail = ozonApi('/v1/product/info/description', { product_id: productId });
        if (detail && detail.result) {
          name = detail.result.name || '';
        }
      } catch (e) {
        Logger.log('Ошибка описания ' + productId + ': ' + e.message);
      }

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
      // E, F — Бренд, Рейтинг (позже через /v3/product/info/list)

      // Восстановить РРЦ и мин. цену
      var saved = userData[productId.toString()];
      if (saved) {
        if (saved.rrc) sheet.getRange(row, 8).setValue(saved.rrc);
        if (saved.minP) sheet.getRange(row, 9).setValue(saved.minP);
      }

      success++;

      // Пауза каждые 5 товаров
      if (i % 5 === 4) {
        Utilities.sleep(1000);
      }
    } catch (e) {
      Logger.log('Ошибка товара ' + allItems[i].product_id + ': ' + e.message);
      errors++;
    }
  }

  logAction('Загрузка товаров', 'Успешно', 'Всего: ' + allItems.length + ', Загружено: ' + success + ', Ошибок: ' + errors);
  showAlert('Готово', 'Загрузка завершена\n\nВсего: ' + allItems.length + '\nЗагружено: ' + success + '\nОшибок: ' + errors);
}

// =====================================================================
// Скрипт 2: Получить цены + индекс цен (API)
// Заполняет: J (цена продавца), K (цена с кошельком), L (индекс цен)
// =====================================================================
function getOzonPrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('Ошибка', 'Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('=== Получение цен + индексов Ozon API ===');

  // Получить ВСЕ цены через /v5/product/info/prices (содержит price_indexes)
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
      var item = items[i];
      if (item.product_id) {
        priceMap[item.product_id] = item;
      }
    }

    cursor = result.cursor || '';
    hasMore = items.length === 100 && cursor !== '';
  }

  Logger.log('Получено записей: ' + Object.keys(priceMap).length);

  // Записать цены и рассчитать цену с кошельком
  var successPrice = 0;
  var successIndex = 0;
  var notFound = 0;

  for (var row = 2; row <= lastRow; row++) {
    var pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;

    var priceData = priceMap[pid];
    if (!priceData) {
      notFound++;
      continue;
    }

    var priceInfo = priceData.price || {};

    // J (10) — Цена продавца
    var sellerPrice = priceInfo.price || '';
    sheet.getRange(row, 10).setValue(sellerPrice);
    successPrice++;

    // === Извлечь price_indexes ===
    var pIdx = priceData.price_indexes || {};
    var ozonIdx = pIdx.ozon_index_data || {};
    var extIdx = pIdx.external_index_data || {};
    var selfIdx = pIdx.self_marketplaces_index_data || {};
    var colorIdx = pIdx.color_index || '';

    // Определяем приоритетный индекс: ozon → external → self
    var idxValue = 0;
    var minCompPrice = 0;

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

    if (idxValue !== 0 && minCompPrice !== 0) {
      // L (12) — Индекс цен (значение)
      sheet.getRange(row, 12).setValue(idxValue);

      // K (11) — Цена с кошельком (расчёт из индекса)
      var walletPrice = calcBuyerPrice(idxValue, minCompPrice);
      if (walletPrice) {
        sheet.getRange(row, 11).setValue(walletPrice);
        successIndex++;
      }
    } else {
      // Нет данных индекса — пометить
      sheet.getRange(row, 12).setValue('');
      sheet.getRange(row, 11).setValue('');
    }
  }

  logAction('Получение цен + индекс', 'Завершено',
    'Цены: ' + successPrice + ', С кошельком: ' + successIndex + ', Не найдено: ' + notFound);
  showAlert('Готово', 'Цены + индекс обновлены\n\nЦен: ' + successPrice +
    '\nС кошельком: ' + successIndex + '\nНе найдено: ' + notFound);
}

// =====================================================================
// Парсинг цен с сайта (альтернатива, не в полном цикле)
// =====================================================================
function parseOzonSitePrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('Ошибка', 'Нет данных. Сначала загрузите товары.');
    return;
  }

  Logger.log('=== Парсинг цен с сайта Ozon (Москва) ===');

  var success = 0;
  var errors = 0;

  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    if (!productId) continue;

    try {
      var productUrl = 'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/product/-/' + productId + '/&layout_page_id=&page_changed=true';

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

      var response = UrlFetchApp.fetch(productUrl, options);
      var responseCode = response.getResponseCode();

      if (responseCode === 200) {
        var json = JSON.parse(response.getContentText());
        var sitePrice = null;
        var siteDiscount = null;

        if (json && json.widgetStates) {
          var ws = json.widgetStates;

          for (var key in ws) {
            try {
              var widget = JSON.parse(ws[key]);

              if (widget.price !== undefined && widget.price !== null && typeof widget.price === 'number') {
                sitePrice = widget.price;
                if (widget.discount !== undefined) siteDiscount = widget.discount;
                break;
              }

              if (widget.cellTrackingData && widget.cellTrackingData.finalPrice) {
                sitePrice = parseInt(widget.cellTrackingData.finalPrice);
                siteDiscount = widget.cellTrackingData.discount || null;
                break;
              }

              if (widget.mainState && widget.mainState.price) {
                sitePrice = typeof widget.mainState.price === 'number' ? widget.mainState.price : parseInt(widget.mainState.price);
                siteDiscount = widget.mainState.discount || null;
                break;
              }

              if (!sitePrice) {
                var priceStr = JSON.stringify(widget);
                var priceMatch = priceStr.match(/"price"\s*:\s*(\d+)/);
                var discountMatch = priceStr.match(/"discount"\s*:\s*(\d+(?:\.\d+)?)/);

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
          sheet.getRange(row, 11).setValue(sitePrice);

          if (siteDiscount !== null) {
            sheet.getRange(row, 12).setValue(siteDiscount);
          } else {
            var sellerPrice = parseFloat(sheet.getRange(row, 10).getValue());
            if (sellerPrice && sellerPrice > sitePrice) {
              sheet.getRange(row, 12).setValue(Math.round((1 - sitePrice / sellerPrice) * 100));
            }
          }
          success++;
        } else {
          errors++;
        }
      } else {
        errors++;
      }

      Utilities.sleep(2000);

    } catch (e) {
      Logger.log('Ошибка парсинга ' + productId + ': ' + e.message);
      errors++;
    }
  }

  logAction('Парсинг цен (Москва)', 'Завершено', 'Успешно: ' + success + ', Ошибок: ' + errors);
  showAlert('Готово', 'Парсинг завершен\n\nУспешно: ' + success + '\nОшибок: ' + errors);
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

      if (title.indexOf('эластич') !== -1 || desc.indexOf('эластич') !== -1 ||
          title.indexOf('бустинг') !== -1) {
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

function checkProductInBoost(productId, price, boostActions) {
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
          return true;
        }
      }
    } catch (e) {
      Logger.log('Ошибка проверки бустинга: ' + e.message);
    }
  }
  return false;
}

// =====================================================================
// Скрипт 3: Рассчитать цены
// =====================================================================
function calculatePrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('Ошибка', 'Нет данных');
    return;
  }

  Logger.log('=== Расчёт цен ===');

  // Получаем акции эластичного бустинга
  var boostActions = [];
  try {
    boostActions = getElasticBoostActions();
  } catch (e) {
    Logger.log('Не удалось получить акции: ' + e.message);
  }

  var updated = 0;

  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var minPrice = parseFloat(sheet.getRange(row, 9).getValue());     // I — Мин. цена
    var rrc = parseFloat(sheet.getRange(row, 8).getValue());          // H — РРЦ
    var currentPrice = parseFloat(sheet.getRange(row, 10).getValue()); // J — Цена продавца

    if (!currentPrice) continue;

    // Целевая цена = РРЦ если задана, иначе текущая
    var targetPrice = rrc || currentPrice;

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
        var isInBoost = checkProductInBoost(productId, targetPrice, boostActions);
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
  showAlert('Готово', 'Цены рассчитаны\n\nОбновлено: ' + updated + '\nАкций эл. бустинга: ' + boostActions.length);
}

// =====================================================================
// Скрипт 4: Загрузить цены на Ozon
// =====================================================================
function uploadPrices() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  if (lastRow < 2) {
    showAlert('Ошибка', 'Нет данных');
    return;
  }

  Logger.log('=== Загрузка цен на Ozon ===');

  var prices = [];

  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var targetPrice = parseFloat(sheet.getRange(row, 14).getValue()); // N — Цена для загрузки
    var currentPrice = parseFloat(sheet.getRange(row, 10).getValue()); // J — Текущая цена

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
    showAlert('Готово', 'Нет товаров для обновления (все цены актуальны)');
    return;
  }

  // Загружаем батчами по 100
  var totalSuccess = 0;
  var totalErrors = 0;

  for (var i = 0; i < prices.length; i += 100) {
    var batch = prices.slice(i, i + 100);

    var result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price }; })
    });

    if (result && !result.code) {
      totalSuccess += batch.length;
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 16).setValue('✅ ' + batch[j].price + '₽');
      }
    } else {
      totalErrors += batch.length;
      var errMsg = result ? result.message || JSON.stringify(result) : 'неизвестная ошибка';
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 16).setValue('❌ ' + errMsg);
      }
    }

    Utilities.sleep(500);
  }

  logAction('Загрузка цен', 'Завершено', 'Успешно: ' + totalSuccess + ', Ошибок: ' + totalErrors);
  showAlert('Готово', 'Цены загружены\n\nУспешно: ' + totalSuccess + '\nОшибок: ' + totalErrors);
}

// =====================================================================
// Полный цикл (без парсинга сайта — через индекс API)
// =====================================================================
function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  calculatePrices();
}
