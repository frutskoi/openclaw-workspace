/**
 * Репрайсер WB - Загрузка данных + Цены + СПП
 *
 * Скрипты:
 * 1. loadWBData() - Загрузить данные с WB (колонки A-F)
 * 2. getWbPrices() - Получить цены по API ВБ (колонки M, N, O)
 * 3. parsePricesFromWbSite() - Парсить цены с сайта ВБ (J, K, R) + СПП История
 *
 * ID таблицы: 1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE
 */

// ============================================
// КОНСТАНТЫ
// ============================================

var WB_CONTENT_API = 'https://content-api.wildberries.ru';
var CARDS_LIST_URL = WB_CONTENT_API + '/content/v2/get/cards/list';
var WB_PRICES_API = 'https://discounts-prices-api.wildberries.ru';
var WB_INTERNAL = 'https://www.wildberries.ru/__internal/card/cards/v4/detail';
var SHEET_NAME = 'Репрайсер';
var SETTINGS_SHEET = 'Настройки';
var SPP_HISTORY_SHEET = 'СПП История';
var TOKEN_CELL = 'B3';
var TZ = 'Europe/Moscow';

// Internal endpoint settings
var DEST = -1257786; // Москва
var SPP_FIXED = 30;
var NM_BATCH = 20;
var SLEEP_MS = 300;
var RETRIES = 3;

// Столбцы (1-indexed)
var COL_PHOTO = 1;        // A - Фото товара
var COL_WB_ID = 2;        // B - Артикул WB
var COL_VENDOR_CODE = 3;  // C - Артикул продавца
var COL_NAME = 4;         // D - Название товара
var COL_BRAND = 5;        // E - Бренд товара
var COL_RATING = 6;       // F - Рейтинг товара
var COL_PRICE_NO_WALLET = 10;        // J - Цена без кошелька ВБ
var COL_PRICE_WALLET = 11;           // K - Цена с кошельком ВБ
var COL_PRICE_BEFORE_DISCOUNT = 13;  // M - Цена до скидки продавца
var COL_SELLER_DISCOUNT = 14;        // N - Скидка продавца (%)
var COL_PRICE_WITH_DISCOUNT = 15;    // O - Цена со скидкой (M * (1 - N))
var COL_SPP = 16;                    // P - СПП % (рассчитывается, доля)
var COL_WALLET_PCT = 17;             // Q - Кошелек % (фикс 0.03)
var COL_UPLOAD_PRICE = 18;           // R - Цена для загрузки в кабинет ВБ
var COL_MODEL = 12;                  // L - Модель удержания
var COL_TARGET_PRICE = 8;            // H - РРЦ (целевая удерживаемая цена)
var COL_MIN_PRICE = 9;               // I - Минимальная цена (со скидкой продавца)
var COL_UPLOADED_PRICE = 19;          // S - Загруженная цена
var COL_CLUB_DISCOUNT = 20;           // T - Добавить скидку WB клуб
var COL_STATUS = 22;                 // V - Статус загрузки
var COL_LAST_UPDATE = 23;            // W - Дата и время последнего обновления

// Безопасный alert — не падает при запуске из триггера
function safeAlert(msg) {
  try {
    safeAlert(msg);
  } catch (e) {
    Logger.log('UI: ' + msg);
  }
}

// ============================================
// WB CONTENT API ФУНКЦИИ
// ============================================

function callWbApi(url, token, body) {
  try {
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': token },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    };
    var response = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();
    var responseText = response.getContentText();
    if (statusCode !== 200) {
      Logger.log('WB API ошибка ' + statusCode + ': ' + responseText);
      return null;
    }
    return JSON.parse(responseText);
  } catch (e) {
    Logger.log('Исключение при запросе к WB API: ' + e.toString());
    return null;
  }
}

function fetchAllCards(token) {
  var allCards = [];
  var cursor = null;
  var limit = 100;
  var pageCount = 0;
  do {
    pageCount++;
    Logger.log('Загружаем страницу ' + pageCount + '...');
    var requestBody = {
      settings: {
        sort: { ascending: false },
        cursor: { limit: limit },
        filter: { withPhoto: -1 }
      }
    };
    if (cursor) {
      requestBody.settings.cursor.updatedAt = cursor.updatedAt;
      requestBody.settings.cursor.nmID = cursor.nmID;
    }
    var response = callWbApi(CARDS_LIST_URL, token, requestBody);
    if (!response) { Logger.log('Ошибка на странице ' + pageCount); break; }
    var cards = response.cards || [];
    allCards = allCards.concat(cards);
    Logger.log('Страница ' + pageCount + ': ' + cards.length + ' карточек');
    var responseCursor = response.cursor || {};
    cursor = { updatedAt: responseCursor.updatedAt, nmID: responseCursor.nmID };
    if (cards.length < limit) break;
    Utilities.sleep(500);
  } while (true);
  return allCards;
}

// ============================================
// ПОЛУЧИТЬ ЦЕНЫ ПО API ВБ (M, N, O)
// ============================================

function getWbPrices() {
  Logger.log('=== НАЧАЛО: Получить цены по API ВБ ===');

  try {
    var sheet = getRepricerSheet();
    var settings = getSettingsSheet();
    var logSheet = getOrCreateLogSheet();

    var token = String(settings.getRange(TOKEN_CELL).getValue()).trim();
    if (!token) {
      safeAlert('API-токен не заполнен в ячейке ' + TOKEN_CELL);
      return;
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      safeAlert('Нет данных на листе "' + SHEET_NAME + '". Сначала загрузите товары.');
      return;
    }

    var priceMap = fetchSellerPricesMap_(token, logSheet);
    var priceCount = Object.keys(priceMap).length;
    Logger.log('Цен получено: ' + priceCount);

    if (priceCount === 0) {
      safeAlert('Не удалось загрузить цены. Проверьте токен и лог.');
      logMessage(logSheet, 'ОШИБКА: цены не загружены (получено 0)');
      return;
    }

    var successCount = 0;
    var notFoundCount = 0;

    for (var i = 1; i < data.length; i++) {
      var nmId = String(data[i][COL_WB_ID - 1]).trim();
      if (!nmId) continue;

      var priceInfo = priceMap[nmId];
      if (priceInfo && priceInfo.price > 0) {
        var priceBeforeDiscount = priceInfo.price;
        var sellerDiscount = priceInfo.sellerDiscount;
        var priceWithDiscount = Math.round(priceBeforeDiscount * (1 - sellerDiscount));

        sheet.getRange(i + 1, COL_PRICE_BEFORE_DISCOUNT).setValue(priceBeforeDiscount);
        sheet.getRange(i + 1, COL_SELLER_DISCOUNT).setValue(sellerDiscount);
        sheet.getRange(i + 1, COL_PRICE_WITH_DISCOUNT).setValue(priceWithDiscount);

        successCount++;
        Logger.log('nmID ' + nmId + ': цена=' + priceBeforeDiscount + ', скидка=' + (sellerDiscount * 100) + '%, итого=' + priceWithDiscount);
      } else {
        notFoundCount++;
        Logger.log('nmID ' + nmId + ': цены не найдены');
      }
    }

    SpreadsheetApp.flush();

    var resultMsg = 'Цены загружены: успешно ' + successCount + ', не найдено ' + notFoundCount;
    Logger.log(resultMsg);
    logMessage(logSheet, resultMsg);
    safeAlert(resultMsg);

  } catch (e) {
    Logger.log('Критическая ошибка: ' + e.message);
    safeAlert('Ошибка: ' + e.message);
  }
}

function fetchSellerPricesMap_(token, logSheet) {
  var result = {};
  var limit = 1000;
  var offset = 0;
  var keepGoing = true;

  while (keepGoing) {
    var url = WB_PRICES_API + '/api/v2/list/goods/filter?limit=' + limit + '&offset=' + offset;

    try {
      var options = {
        method: 'get',
        headers: { 'Authorization': token },
        muteHttpExceptions: true
      };
      var response = UrlFetchApp.fetch(url, options);
      var statusCode = response.getResponseCode();
      var responseText = response.getContentText();

      Logger.log('Prices API: offset=' + offset + ', status=' + statusCode);

      if (statusCode !== 200) {
        Logger.log('Prices API ошибка: ' + responseText.substring(0, 300));
        logMessage(logSheet, 'ОШИБКА Prices API: status=' + statusCode);
        break;
      }

      var json = JSON.parse(responseText);
      var items = [];

      if (json.data && Array.isArray(json.data.listGoods)) {
        items = json.data.listGoods;
      } else if (json.data && Array.isArray(json.data)) {
        items = json.data;
      }

      Logger.log('Prices: получено элементов=' + items.length);

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var nmId = String(item.nmID || item.nmId || '').trim();
        if (!nmId) continue;

        var price = 0;
        var sellerDiscount = 0;
        var discountedPrice = 0;

        if (item.discount) {
          sellerDiscount = item.discount / 100; // 61 → 0.61
        }

        if (item.sizes && item.sizes.length > 0) {
          var size = item.sizes[0];
          price = size.price || 0;
          discountedPrice = size.discountedPrice || 0;
        }

        // Цены в рублях, НЕ делим на 100

        if (sellerDiscount === 0 && price > 0 && discountedPrice > 0 && price !== discountedPrice) {
          sellerDiscount = 1 - (discountedPrice / price);
        }

        result[nmId] = {
          price: price,
          sellerDiscount: sellerDiscount,
          discountedPrice: discountedPrice
        };
      }

      if (items.length < limit) {
        keepGoing = false;
      } else {
        offset += limit;
        Utilities.sleep(300);
      }

    } catch (e) {
      Logger.log('Ошибка загрузки цен: ' + e.message);
      logMessage(logSheet, 'ОШИБКА загрузки цен: ' + e.message);
      break;
    }
  }

  return result;
}

// ============================================
// ПАРСИНГ ЦЕН С САЙТА ВБ (J, K, R) + СПП История
// Через __internal/card/cards/v4/detail
// ============================================

/**
 * Парсить цены с сайта ВБ
 * Использует WB internal endpoint (без токена)
 * Записывает:
 * - J (10): Цена без кошелька (client price с сайта)
 * - K (11): Цена с кошельком (J × 0.97)
 * - P (16): СПП (доля) = 1 - (client / sellerPrice)
 * - Q (17): Кошелек % (фиксированно 0.03)
 * + Записывает snapshot СПП в лист "СПП История"
 */
function parsePricesFromWbSite() {
  Logger.log('=== НАЧАЛО ПАРСИНГА ЦЕН С WB (internal endpoint) ===');

  try {
    var sheet = getRepricerSheet();
    var settings = getSettingsSheet();
    var logSheet = getOrCreateLogSheet();

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      safeAlert('Нет данных на листе "' + SHEET_NAME + '"');
      return;
    }

    // Собираем nmId из колонки B
    var nmIds = [];
    for (var i = 1; i < data.length; i++) {
      var nmId = String(data[i][COL_WB_ID - 1]).trim();
      if (nmId) nmIds.push(nmId);
    }

    if (nmIds.length === 0) {
      safeAlert('Нет артикулов на листе');
      return;
    }

    Logger.log('Артикулов для парсинга: ' + nmIds.length);

    // 1) Получаем цены с сайта через internal endpoint (basic + client)
    var pricesMap = fetchInternalPrices_(nmIds);
    Logger.log('Цен с сайта получено: ' + Object.keys(pricesMap).length);

    if (Object.keys(pricesMap).length === 0) {
      safeAlert('Не удалось получить цены с сайта. Проверьте лог.');
      logMessage(logSheet, 'ОШИБКА: internal endpoint не вернул цены');
      return;
    }

    // 2) Получаем скидку продавца из ЛК WB
    var token = String(settings.getRange(TOKEN_CELL).getValue()).trim();
    var discountMap = {};
    if (token) {
      discountMap = fetchSellerDiscountsForParse_(token, nmIds, logSheet);
      Logger.log('Скидок получено: ' + Object.keys(discountMap).length);
    } else {
      Logger.log('WARN: нет токена, берём скидку из колонки N');
    }

    // 3) Пишем цены и считаем СПП
    var successCount = 0;
    var notFoundCount = 0;
    var sppData = {}; // для СПП История

    for (var i = 1; i < data.length; i++) {
      var nmId = String(data[i][COL_WB_ID - 1]).trim();
      if (!nmId) continue;

      var priceInfo = pricesMap[nmId];
      if (priceInfo) {
        var client = priceInfo.client;   // цена для клиента (без кошелька)
        var basic = priceInfo.basic;     // базовая цена

        // J - цена без кошелька = client
        sheet.getRange(i + 1, COL_PRICE_NO_WALLET).setValue(client);
        // K - цена с кошельком = client × 0.97 (кошелёк 3%)
        var priceWithWallet = Math.round(client * 0.97 * 100) / 100;
        sheet.getRange(i + 1, COL_PRICE_WALLET).setValue(priceWithWallet);
        // Q - Кошелек % (фиксированно 0.03)
        sheet.getRange(i + 1, COL_WALLET_PCT).setValue(0.03);

        // Скидка продавца: из ЛК или из колонки N
        var discFrac = discountMap[nmId];
        if (discFrac === undefined || discFrac === null) {
          discFrac = Number(data[i][COL_SELLER_DISCOUNT - 1]) || 0; // из колонки N
        }

        // СПП = 1 - (client / (basic * (1 - discount)))
        if (basic > 0 && client > 0) {
          var sellerPrice = basic * (1 - discFrac);
          if (sellerPrice > 0) {
            var sppFrac = 1 - (client / sellerPrice);
            var sppRounded = Math.round(sppFrac * 10000) / 10000;
            sheet.getRange(i + 1, COL_SPP).setValue(sppRounded);
            sppData[nmId] = sppRounded;
            Logger.log('nmID ' + nmId + ': client=' + client + ', кошелёк=' + priceWithWallet + ', basic=' + basic + ', скидка=' + (discFrac * 100) + '%, СПП=' + (sppFrac * 100).toFixed(2) + '%');
          }
        }

        successCount++;
      } else {
        notFoundCount++;
        Logger.log('nmID ' + nmId + ': цены не найдены');
      }
    }

    SpreadsheetApp.flush();

    // 4) Записываем СПП в историю
    writeSppHistory_(sppData);

    var resultMsg = 'Парсинг завершён: успешно ' + successCount + ', не найдено ' + notFoundCount;
    Logger.log(resultMsg);
    logMessage(logSheet, resultMsg);
    safeAlert(resultMsg);

  } catch (e) {
    Logger.log('Критическая ошибка: ' + e.message);
    safeAlert('Ошибка: ' + e.message);
  }
}

/**
 * Получает цены через WB internal endpoint
 * @param {string[]} nmIds - массив nmId
 * @returns {Object} карта { nmId: { basic, client } } цены в рублях
 */
function fetchInternalPrices_(nmIds) {
  var map = {};

  for (var i = 0; i < nmIds.length; i += NM_BATCH) {
    var batch = nmIds.slice(i, i + NM_BATCH);
    var nmParam = batch.map(encodeURIComponent).join(';');
    var url = WB_INTERNAL
      + '?appType=1&curr=rub'
      + '&dest=' + encodeURIComponent(DEST)
      + '&spp=' + encodeURIComponent(SPP_FIXED)
      + '&lang=ru'
      + '&nm=' + nmParam;

    var resp = fetchWithRetriesInternal_(url);
    if (!resp) {
      Utilities.sleep(SLEEP_MS);
      continue;
    }

    try {
      var json = JSON.parse(resp.getContentText() || '{}');
      var products = [];

      if (json.data && Array.isArray(json.data.products)) {
        products = json.data.products;
      } else if (Array.isArray(json.products)) {
        products = json.products;
      }

      for (var j = 0; j < products.length; j++) {
        var p = products[j];
        var nm = String(p.id || p.nmId || '').trim();
        if (!nm) continue;

        var sizes = p.sizes || [];
        if (sizes.length === 0) continue;

        var size0 = sizes[0];
        var priceObj = size0.price || {};

        var basicU = Number(priceObj.basic || 0);
        var clientU = Number(priceObj.product || 0);

        if (basicU > 0 || clientU > 0) {
          map[nm] = {
            basic: basicU > 0 ? Math.round(basicU / 100 * 100) / 100 : '',
            client: clientU > 0 ? Math.round(clientU / 100 * 100) / 100 : ''
          };
        }
      }
    } catch (e) {
      Logger.log('WARN: internal parse error: ' + e.message);
    }

    Utilities.sleep(SLEEP_MS);
  }

  return map;
}

function fetchWithRetriesInternal_(url) {
  for (var attempt = 1; attempt <= RETRIES; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      muteHttpExceptions: true,
      followRedirects: true,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/plain,*/*',
        'Referer': 'https://www.wildberries.ru/'
      }
    });

    var code = resp.getResponseCode();
    if (code === 200) return resp;

    if (code === 429 || code >= 500) {
      Utilities.sleep(600 * Math.pow(2, attempt - 1));
      continue;
    }

    Logger.log('WARN: internal HTTP ' + code + ': ' + String(resp.getContentText() || '').substring(0, 120));
    return null;
  }
  return null;
}

/**
 * Получает скидку продавца из ЛК WB для парсинга
 * @returns {Object} карта { nmId: discountFrac (0..1) }
 */
function fetchSellerDiscountsForParse_(token, nmIds, logSheet) {
  var out = {};
  var limit = 1000;
  var offset = 0;
  var keepGoing = true;

  while (keepGoing) {
    var url = WB_PRICES_API + '/api/v2/list/goods/filter?limit=' + limit + '&offset=' + offset;
    try {
      var resp = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { 'Authorization': token },
        muteHttpExceptions: true
      });
      if (resp.getResponseCode() !== 200) break;

      var json = JSON.parse(resp.getContentText());
      var items = [];
      if (json.data && Array.isArray(json.data.listGoods)) items = json.data.listGoods;
      else if (json.data && Array.isArray(json.data)) items = json.data;

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var nmId = String(item.nmID || item.nmId || '').trim();
        if (!nmId) continue;
        var discPct = Number(item.discount || 0);
        out[nmId] = discPct / 100; // доля
      }

      if (items.length < limit) keepGoing = false;
      else { offset += limit; Utilities.sleep(300); }
    } catch (e) {
      break;
    }
  }
  return out;
}

// ============================================
// СПП ИСТОРИЯ
// ============================================

/**
 * Записывает snapshot СПП в лист "СПП История"
 * Структура: первая строка = заголовки (Артикул WB | дд.мм.гггг чч:мм)
 * Каждый запуск добавляет колонку с датой/временем и СПП для каждого артикула
 */
function writeSppHistory_(sppData) {
  var ss = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  var sheet = ss.getSheetByName(SPP_HISTORY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(SPP_HISTORY_SHEET);
  }

  var ts = Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm');
  var nmIds = Object.keys(sppData);
  if (nmIds.length === 0) return;

  // Проверяем структуру: колонка A = артикулы, колонки дальше = даты
  var lastCol = sheet.getLastColumn();
  var lastRow = sheet.getLastRow();

  // Если лист пустой — создаём заголовки
  if (lastCol === 0 || lastRow === 0) {
    sheet.getRange(1, 1).setValue('Артикул WB');
    lastCol = 1;
  }

  // Добавляем новую колонку с датой
  var newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(ts);

  // Читаем существующие артикулы из колонки A
  var existingData = sheet.getRange(1, 1, Math.max(lastRow, 1), 1).getValues();
  var existingMap = {}; // nmId -> row (1-indexed)
  for (var r = 2; r < existingData.length + 1; r++) {
    var key = String(existingData[r - 1][0]).trim();
    if (key) existingMap[key] = r;
  }

  // Пишем СПП для каждого артикула
  var nextEmptyRow = existingData.length + 1;

  for (var i = 0; i < nmIds.length; i++) {
    var nmId = nmIds[i];
    var sppVal = sppData[nmId];

    var row = existingMap[nmId];
    if (!row) {
      // Новый артикул — добавляем
      sheet.getRange(nextEmptyRow, 1).setValue(nmId);
      row = nextEmptyRow;
      nextEmptyRow++;
    }

    // Пишем СПП как % (доля * 100)
    sheet.getRange(row, newCol).setValue(Math.round(sppVal * 10000) / 100);
  }

  SpreadsheetApp.flush();
  Logger.log('СПП История: записано ' + nmIds.length + ' артикулов, колонка "' + ts + '"');
}

// ============================================
// РАСЧЁТ ЦЕН ДЛЯ ЗАГРУЗКИ (R)
// ============================================

/**
 * Рассчитать цены для загрузки в кабинет ВБ
 * Читает модель удержания из L и считает R
 * Без кошелька: R = Math.round(H / (1 - P) / (1 - N))
 * С кошельком: R = Math.round(H / 0.97 / (1 - P) / (1 - N))
 * Авто ИИ: пропускаем
 * Отключен / H пустая: пропускаем
 */
function calculatePricesForUpload() {
  Logger.log('=== НАЧАЛО: Расчёт цен для загрузки ===');

  try {
    var sheet = getRepricerSheet();
    var logSheet = getOrCreateLogSheet();

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      safeAlert('Нет данных на листе "' + SHEET_NAME + '"');
      return;
    }

    var calculatedCount = 0;
    var skippedCount = 0;
    var errorCount = 0;

    for (var i = 1; i < data.length; i++) {
      var nmId = String(data[i][COL_WB_ID - 1]).trim();
      if (!nmId) continue;

      var model = String(data[i][COL_MODEL - 1] || '').trim().toLowerCase();
      var targetPrice = Number(data[i][COL_TARGET_PRICE - 1]) || 0;

      // Если H пустая или модель не указана — пропускаем
      if (!targetPrice || !model) {
        skippedCount++;
        if (!targetPrice && model) Logger.log('nmID ' + nmId + ': H пустая, пропускаем');
        continue;
      }

      // Отключен — пропускаем
      if (model.indexOf('отключен') >= 0) {
        skippedCount++;
        continue;
      }

      // Авто ИИ — пока пропускаем
      if (model.indexOf('авто') >= 0 || model.indexOf('ии') >= 0) {
        skippedCount++;
        continue;
      }

      var sppFrac = Number(data[i][COL_SPP - 1]) || 0;          // P
      var discFrac = Number(data[i][COL_SELLER_DISCOUNT - 1]) || 0; // N

      Logger.log('nmID ' + nmId + ': модель=' + model + ', H=' + targetPrice + ', P(СПП)=' + sppFrac + ', N(скидка)=' + discFrac);

      // Проверяем что есть данные для расчёта
      if (sppFrac <= 0 || discFrac <= 0) {
        errorCount++;
        Logger.log('nmID ' + nmId + ': ПРОПУСК — нет данных (СПП=' + sppFrac + ', скидка=' + discFrac + ')');
        continue;
      }

      var uploadPrice = 0;

      if (model.indexOf('кошельк') >= 0 && model.indexOf('без') < 0) {
        // С кошельком: R = H / 0.97 / (1 - P) / (1 - N)
        uploadPrice = Math.round(targetPrice / 0.97 / (1 - sppFrac) / (1 - discFrac));
      } else if (model.indexOf('без') >= 0 && model.indexOf('кошельк') >= 0) {
        // Без кошелька: R = H / (1 - P) / (1 - N)
        uploadPrice = Math.round(targetPrice / (1 - sppFrac) / (1 - discFrac));
      } else {
        skippedCount++;
        continue;
      }

      sheet.getRange(i + 1, COL_UPLOAD_PRICE).setValue(uploadPrice);
      calculatedCount++;
      Logger.log('nmID ' + nmId + ': модель=' + model + ', H=' + targetPrice + ', R=' + uploadPrice);
    }

    SpreadsheetApp.flush();

    var resultMsg = 'Расчёт завершён: рассчитано ' + calculatedCount + ', пропущено ' + skippedCount + ', ошибок ' + errorCount;
    Logger.log(resultMsg);
    logMessage(logSheet, resultMsg);
    safeAlert(resultMsg);

  } catch (e) {
    Logger.log('Критическая ошибка: ' + e.message);
    safeAlert('Ошибка: ' + e.message);
  }
}

// ============================================
// GOOGLE SHEETS ФУНКЦИИ
// ============================================

function getProductPhotoUrl(card) {
  var photos = card.photos || [];
  if (photos.length > 0) {
    var ph = photos[0];
    return ph.big || ph['c516x688'] || ph.square || ph['164x218'] || '';
  }
  return '';
}

function getProductRating(card) {
  return card.rating || card.productRating || card.reviewRating || 0;
}

function writeCardsToSheet(sheet, cards) {
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var rowNum = i + 2;
    sheet.getRange(rowNum, COL_WB_ID).setValue(card.nmID || '');
    sheet.getRange(rowNum, COL_VENDOR_CODE).setValue(card.vendorCode || '');
    sheet.getRange(rowNum, COL_NAME).setValue(card.title || '');
    sheet.getRange(rowNum, COL_BRAND).setValue(card.brand || '');
    sheet.getRange(rowNum, COL_RATING).setValue(getProductRating(card));
    var photoUrl = getProductPhotoUrl(card);
    if (photoUrl) {
      sheet.getRange(rowNum, COL_PHOTO).setFormula('=IMAGE("' + photoUrl + '";4;80;80)');
    } else {
      sheet.getRange(rowNum, COL_PHOTO).setValue('');
    }
    if ((i + 1) % 50 === 0) {
      SpreadsheetApp.flush();
      Logger.log('Записано строк: ' + (i + 1));
    }
  }
  SpreadsheetApp.flush();
  try {
    if (cards.length > 0) sheet.setRowHeightsForced(2, cards.length, 85);
  } catch (e) { Logger.log('Высота строк: ' + e); }
}

function getRepricerSheet() {
  var spreadsheet = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("Лист '" + SHEET_NAME + "' не найден!");
  return sheet;
}

function getSettingsSheet() {
  var spreadsheet = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  var sheet = spreadsheet.getSheetByName(SETTINGS_SHEET);
  if (!sheet) throw new Error("Лист '" + SETTINGS_SHEET + "' не найден!");
  return sheet;
}

// ============================================
// ЗАГРУЗКА ЦЕН НА ВБ
// ============================================

/**
 * Загрузить цены на ВБ
 * Сравнивает R (цена для загрузки) и I (минимальная цена)
 * Если R < I -> загружаем I
 * Если R >= I -> загружаем R
 * Записывает: U (что отправили), V (статус), W (дата/время)
 */
function uploadPricesToWb() {
  Logger.log('=== НАЧАЛО: Загрузка цен на ВБ ===');

  try {
    var sheet = getRepricerSheet();
    var settings = getSettingsSheet();
    var logSheet = getOrCreateLogSheet();

    var token = String(settings.getRange(TOKEN_CELL).getValue()).trim();
    if (!token) {
      safeAlert('API-токен не заполнен в ячейке ' + TOKEN_CELL);
      return;
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      safeAlert('Нет данных на листе "' + SHEET_NAME + '"');
      return;
    }

    // Собираем товары для загрузки
    var uploadItems = [];
    var uploadRows = []; // для записи результатов

    for (var i = 1; i < data.length; i++) {
      var nmId = String(data[i][COL_WB_ID - 1]).trim();
      if (!nmId) continue;

      var uploadPrice = Number(data[i][COL_UPLOAD_PRICE - 1]) || 0;  // R
      var minPrice = Number(data[i][COL_MIN_PRICE - 1]) || 0;        // I

      // Пропускаем если нет цены для загрузки
      if (uploadPrice <= 0) continue;

      // Сравниваем R и I
      var finalPrice = Math.round(uploadPrice);
      if (minPrice > 0 && uploadPrice < minPrice) {
        finalPrice = Math.round(minPrice);
        Logger.log('nmID ' + nmId + ': R=' + uploadPrice + ' < I=' + minPrice + ' -> загружаем I=' + finalPrice);
      }

      // Скидка для WB клуба из T (если есть дробь)
      var clubDiscount = 0;
      var tRaw = data[i][COL_CLUB_DISCOUNT - 1]; // T
      var tVal = Number(tRaw);
      if (!isNaN(tVal) && tVal > 0 && tVal < 1) {
        clubDiscount = Math.round(tVal * 100); // дробь 0.03 -> 3%
        Logger.log('nmID ' + nmId + ': скидка клуба T=' + tRaw + ' -> clubDiscount=' + clubDiscount + '%');
      }

      var item = {
        nmId: Number(nmId),
        price: parseInt(finalPrice, 10)
      };

      // Если есть скидка клуба — добавляем
      if (clubDiscount > 0) {
        item.clubDiscount = parseInt(clubDiscount, 10);
      }

      uploadItems.push(item);
      uploadRows.push({
        row: i + 1,
        nmId: nmId,
        price: parseInt(finalPrice, 10),
        clubDiscount: parseInt(clubDiscount, 10)
      });
    }

    if (uploadItems.length === 0) {
      safeAlert('Нет товаров для загрузки. Проверьте колонку R.');
      logMessage(logSheet, 'ЗАГРУЗКА: нет товаров для загрузки');
      return;
    }

    Logger.log('Товаров для загрузки: ' + uploadItems.length);

    // Отправляем батчами по 50
    var batchSize = 50;
    var successTotal = 0;
    var errorTotal = 0;

    for (var b = 0; b < uploadItems.length; b += batchSize) {
      var batch = uploadItems.slice(b, b + batchSize);
      var batchRows = uploadRows.slice(b, b + batchSize);

      var body = { data: batch };
      var url = 'https://discounts-prices-api.wildberries.ru/api/v2/upload/task';

      try {
        var options = {
          method: 'post',
          contentType: 'application/json',
          headers: { 'Authorization': token },
          payload: JSON.stringify(body),
          muteHttpExceptions: true
        };
        var response = UrlFetchApp.fetch(url, options);
        var statusCode = response.getResponseCode();
        var responseText = response.getContentText();

        Logger.log('Upload batch: ' + batch.length + ' items, status=' + statusCode + ', body=' + responseText.substring(0, 300));

        var ts = Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm:ss');

        if (statusCode === 200 || statusCode === 208) {
          // Успех
          for (var j = 0; j < batchRows.length; j++) {
            var r = batchRows[j];
            sheet.getRange(r.row, COL_UPLOADED_PRICE).setValue(r.price);
            sheet.getRange(r.row, COL_STATUS).setValue('OK');
            sheet.getRange(r.row, COL_LAST_UPDATE).setValue(ts);
            successTotal++;
            Logger.log('nmID ' + r.nmId + ': загружено ' + r.price + (r.clubDiscount > 0 ? ' + club ' + r.clubDiscount + '%' : ''));
          }
        } else {
          // Ошибка
          for (var j = 0; j < batchRows.length; j++) {
            var r = batchRows[j];
            sheet.getRange(r.row, COL_STATUS).setValue('ОШИБКА: ' + statusCode);
          }
          errorTotal += batchRows.length;
          Logger.log('ОШИБКА загрузки батча: ' + responseText);
          logMessage(logSheet, 'ОШИБКА загрузки: status=' + statusCode + ' ' + responseText.substring(0, 200));
        }
      } catch (e) {
        Logger.log('Исключение при загрузке: ' + e.message);
        for (var j = 0; j < batchRows.length; j++) {
          sheet.getRange(batchRows[j].row, COL_STATUS).setValue('ОШИБКА: ' + e.message);
        }
        errorTotal += batchRows.length;
      }

      Utilities.sleep(500);
    }

    SpreadsheetApp.flush();

    var resultMsg = 'Загрузка завершена: успешно ' + successTotal + ', ошибок ' + errorTotal;
    Logger.log(resultMsg);
    logMessage(logSheet, resultMsg);
    safeAlert(resultMsg);

  } catch (e) {
    Logger.log('Критическая ошибка: ' + e.message);
    safeAlert('Ошибка: ' + e.message);
  }
}

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ ЗАГРУЗКИ ТОВАРОВ
// ============================================

function loadWBData() {
  var sheet = getRepricerSheet();
  var settings = getSettingsSheet();
  var logSheet = getOrCreateLogSheet();

  var token = String(settings.getRange(TOKEN_CELL).getValue()).trim();
  if (!token) {
    safeAlert('API-токен не заполнен в ячейке ' + TOKEN_CELL);
    return;
  }

  logMessage(logSheet, 'Старт загрузки товаров...');
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, COL_PHOTO, lastRow - 1, 6).clearContent();
  }

  var allCards = fetchAllCards(token);
  if (allCards.length === 0) {
    safeAlert('Карточки не найдены. Проверьте токен.');
    logMessage(logSheet, 'ОШИБКА: карточки не найдены');
    return;
  }

  writeCardsToSheet(sheet, allCards);
  logMessage(logSheet, 'Загружено товаров: ' + allCards.length);
  safeAlert('Готово! Загружено ' + allCards.length + ' товаров.');
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ
// ============================================

function getOrCreateLogSheet() {
  var spreadsheet = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  var logSheet = spreadsheet.getSheetByName('Лог');
  if (!logSheet) {
    logSheet = spreadsheet.insertSheet('Лог');
    logSheet.appendRow(['Время', 'Действие', 'Сообщение']);
    logSheet.getRange(1, 1, 1, 3).setFontWeight('bold');
  }
  return logSheet;
}

function logMessage(logSheet, message) {
  var ts = new Date().toISOString().replace('T', ' ').substring(0, 19);
  logSheet.appendRow([ts, 'Репрайсер WB', message]);
}

function logAction(action, message) {
  logMessage(getOrCreateLogSheet(), action + ': ' + message);
}

// ============================================
// МЕНЮ
// ============================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Репрайсер')
    .addItem('Загрузить данные с WB', 'loadWBData')
    .addItem('Получить цены по API ВБ', 'getWbPrices')
    .addItem('Парсить цены с сайта ВБ', 'parsePricesFromWbSite')
    .addSeparator()
    .addItem('Рассчитать цены для загрузки', 'calculatePricesForUpload')
    .addSeparator()
    .addItem('Загрузить цены на ВБ', 'uploadPricesToWb')
    .addSeparator()
    .addItem('Запустить цикл раз в 30 мин', 'startCycle30min')
    .addItem('Запустить цикл раз в 1 час', 'startCycle1hour')
    .addItem('Остановить цикл', 'stopCycle')
    .addSeparator()
    .addItem('Установить API ключ WB', 'setupWbApiKey')
    .addToUi();
}

function setupWbApiKey() {
  var response = SpreadsheetApp.getUi().prompt(
    'Установка API ключа WB',
    'Введите API токен Wildberries:',
    SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() === SpreadsheetApp.getUi().Button.OK) {
    var token = response.getResponseText();
    if (token && token.trim()) {
      try {
        getSettingsSheet().getRange(TOKEN_CELL).setValue(token.trim());
        safeAlert('Токен сохранён');
      } catch (e) {
        safeAlert('Ошибка: ' + e.toString());
      }
    }
  }
}

function testWbApi() {
  try {
    var token = String(getSettingsSheet().getRange(TOKEN_CELL).getValue()).trim();
    if (!token) { safeAlert('Токен не установлен!'); return; }
    var cards = fetchAllCards(token);
    safeAlert('API работает! Товаров: ' + cards.length);
  } catch (e) {
    safeAlert('Ошибка API: ' + e.toString());
  }
}

function loadProductsFromWB() {
  loadWBData();
}

// ============================================
// ЦИКЛ АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ
// ============================================

/**
 * Полный цикл: загрузка -> цены -> парсинг -> расчёт -> загрузка на ВБ
 */
function runFullCycle() {
  Logger.log('=== НАЧАЛО ПОЛНОГО ЦИКЛА ===');
  var logSheet = getOrCreateLogSheet();
  logMessage(logSheet, 'ЦИКЛ: старт');

  try {
    // 1. Загрузить данные с WB
    Logger.log('ЦИКЛ: шаг 1 - Загрузить данные с WB');
    logMessage(logSheet, 'ЦИКЛ: шаг 1/5 - Загрузка данных с WB');
    loadWBData();
    Utilities.sleep(2000);
  } catch (e) {
    Logger.log('ЦИКЛ: ошибка шага 1: ' + e.message);
    logMessage(logSheet, 'ЦИКЛ: ОШИБКА шага 1 - ' + e.message);
  }

  try {
    // 2. Получить цены по API ВБ
    Logger.log('ЦИКЛ: шаг 2 - Получить цены по API ВБ');
    logMessage(logSheet, 'ЦИКЛ: шаг 2/5 - Получение цен по API');
    getWbPrices();
    Utilities.sleep(2000);
  } catch (e) {
    Logger.log('ЦИКЛ: ошибка шага 2: ' + e.message);
    logMessage(logSheet, 'ЦИКЛ: ОШИБКА шага 2 - ' + e.message);
  }

  try {
    // 3. Парсить цены с сайта ВБ
    Logger.log('ЦИКЛ: шаг 3 - Парсить цены с сайта ВБ');
    logMessage(logSheet, 'ЦИКЛ: шаг 3/5 - Парсинг цен с сайта');
    parsePricesFromWbSite();
    Utilities.sleep(2000);
  } catch (e) {
    Logger.log('ЦИКЛ: ошибка шага 3: ' + e.message);
    logMessage(logSheet, 'ЦИКЛ: ОШИБКА шага 3 - ' + e.message);
  }

  try {
    // 4. Рассчитать цены для загрузки
    Logger.log('ЦИКЛ: шаг 4 - Рассчитать цены');
    logMessage(logSheet, 'ЦИКЛ: шаг 4/5 - Расчёт цен');
    calculatePricesForUpload();
    Utilities.sleep(2000);
  } catch (e) {
    Logger.log('ЦИКЛ: ошибка шага 4: ' + e.message);
    logMessage(logSheet, 'ЦИКЛ: ОШИБКА шага 4 - ' + e.message);
  }

  try {
    // 5. Загрузить цены на ВБ
    Logger.log('ЦИКЛ: шаг 5 - Загрузить цены на ВБ');
    logMessage(logSheet, 'ЦИКЛ: шаг 5/5 - Загрузка цен на ВБ');
    uploadPricesToWb();
  } catch (e) {
    Logger.log('ЦИКЛ: ошибка шага 5: ' + e.message);
    logMessage(logSheet, 'ЦИКЛ: ОШИБКА шага 5 - ' + e.message);
  }

  Logger.log('=== КОНЕЦ ПОЛНОГО ЦИКЛА ===');
  logMessage(logSheet, 'ЦИКЛ: завершён');
}

/**
 * Запустить цикл раз в 30 минут
 */
function startCycle30min() {
  // Сначала удаляем старые триггеры цикла
  deleteCycleTriggers_();

  // Создаём повторяющийся триггер каждые 30 минут
  ScriptApp.newTrigger('runFullCycle')
    .timeBased()
    .everyMinutes(30)
    .create();

  // Запускаем первый цикл сразу
  safeAlert('Цикл запущен! Раз в 30 минут.\nПервый запуск начнётся автоматически.');
  Logger.log('Триггер создан: каждые 30 минут');
  getOrCreateLogSheet().appendRow([new Date().toISOString().replace('T', ' ').substring(0, 19), 'ЦИКЛ', 'Триггер установлен: каждые 30 мин']);
}

/**
 * Запустить цикл раз в 1 час
 */
function startCycle1hour() {
  // Сначала удаляем старые триггеры цикла
  deleteCycleTriggers_();

  // Создаём повторяющийся триггер каждый час
  ScriptApp.newTrigger('runFullCycle')
    .timeBased()
    .everyHours(1)
    .create();

  safeAlert('Цикл запущен! Раз в 1 час.\nПервый запуск начнётся автоматически.');
  Logger.log('Триггер создан: каждый час');
  getOrCreateLogSheet().appendRow([new Date().toISOString().replace('T', ' ').substring(0, 19), 'ЦИКЛ', 'Триггер установлен: каждый час']);
}

/**
 * Остановить цикл
 */
function stopCycle() {
  var deleted = deleteCycleTriggers_();
  if (deleted > 0) {
    safeAlert('Цикл остановлен! Удалено триггеров: ' + deleted);
  } else {
    safeAlert('Нет активных триггеров цикла.');
  }
  getOrCreateLogSheet().appendRow([new Date().toISOString().replace('T', ' ').substring(0, 19), 'ЦИКЛ', 'Триггеры удалены: ' + deleted]);
}

/**
 * Удаляет все триггеры runFullCycle
 * @returns {number} кол-во удалённых триггеров
 */
function deleteCycleTriggers_() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'runFullCycle') {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  return count;
}
