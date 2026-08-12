/**
 * Репрайсер WB - Загрузка данных + Парсинг цен
 *
 * Загружает данные о товарах из WB Content API
 * + Парсит цены через WB Prices API (discounts-prices-api)
 *
 * ID таблицы: 1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE
 * Лист: Репрайсер
 */

// ============================================
// КОНСТАНТЫ
// ============================================

var WB_CONTENT_API = 'https://content-api.wildberries.ru';
var CARDS_LIST_URL = WB_CONTENT_API + '/content/v2/get/cards/list';
var WB_PRICES_API = 'https://discounts-prices-api.wildberries.ru';
var SHEET_NAME = 'Репрайсер';
var SETTINGS_SHEET = 'Настройки';
var TOKEN_CELL = 'B3';

// Столбцы (1-indexed)
var COL_PHOTO = 1;        // A - Фото товара
var COL_WB_ID = 2;        // B - Артикул WB
var COL_VENDOR_CODE = 3;  // C - Артикул продавца
var COL_NAME = 4;         // D - Название товара
var COL_BRAND = 5;        // E - Бренд товара
var COL_RATING = 6;       // F - Рейтинг товара
var COL_PRICE_NO_WALLET = 10;  // J - Цена без кошелька ВБ
var COL_PRICE_WALLET = 11;     // K - Цена с кошельком ВБ

// ============================================
// WB API ФУНКЦИИ
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
// ПАРСИНГ ЦЕН ЧЕРЕЗ WB PRICES API
// ============================================

/**
 * Парсить цены с сайта ВБ
 * Использует официальный WB Prices API (discounts-prices-api)
 * Записывает:
 * - J (10): Цена со скидкой продавца (без кошелька ВБ)
 * - K (11): Цена с кошельком ВБ (clubDiscountedPrice)
 */
function parsePricesFromWbSite() {
  // DEBUG: test API access
  try {
    var testUrl = 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1&offset=0';
    var token = String(SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE').getSheetByName('Настройки').getRange('B3').getValue()).trim();
    var testResp = UrlFetchApp.fetch(testUrl, {method:'get', headers:{'Authorization':token}, muteHttpExceptions:true});
    Logger.log('DEBUG status: ' + testResp.getResponseCode());
    Logger.log('DEBUG body: ' + testResp.getContentText().substring(0, 500));
  } catch(debugE) {
    Logger.log('DEBUG ERROR: ' + debugE.message + ' | ' + debugE.stack);
  }

  Logger.log('=== НАЧАЛО ПАРСИНГА ЦЕН С WB ===');

  try {
    var sheet = getRepricerSheet();
    var settings = getSettingsSheet();
    var logSheet = getOrCreateLogSheet();

    var token = String(settings.getRange(TOKEN_CELL).getValue()).trim();
    if (!token) {
      SpreadsheetApp.getUi().alert('API-токен не заполнен в ячейке ' + TOKEN_CELL);
      return;
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      SpreadsheetApp.getUi().alert('Нет данных на листе "' + SHEET_NAME + '"');
      return;
    }

    // Загружаем цены через WB Prices API
    var priceMap = fetchPriceMap_(token, logSheet);
    Logger.log('Цен получено: ' + Object.keys(priceMap).length);

    if (Object.keys(priceMap).length === 0) {
      SpreadsheetApp.getUi().alert('Не удалось загрузить цены. Проверьте токен.');
      logMessage(logSheet, 'ОШИБКА: цены не загружены');
      return;
    }

    var successCount = 0;
    var notFoundCount = 0;

    for (var i = 1; i < data.length; i++) {
      var nmId = String(data[i][COL_WB_ID - 1]).trim();
      if (!nmId) continue;

      var priceInfo = priceMap[nmId];
      if (priceInfo) {
        sheet.getRange(i + 1, COL_PRICE_NO_WALLET).setValue(priceInfo.discountedPrice);
        sheet.getRange(i + 1, COL_PRICE_WALLET).setValue(priceInfo.clubDiscountedPrice);
        successCount++;
        Logger.log('nmID ' + nmId + ': без кошелька=' + priceInfo.discountedPrice + ', с кошельком=' + priceInfo.clubDiscountedPrice);
      } else {
        notFoundCount++;
        Logger.log('nmID ' + nmId + ': цены не найдены');
      }
    }

    var resultMsg = 'Парсинг завершён: успешно ' + successCount + ', не найдено ' + notFoundCount;
    Logger.log(resultMsg);
    logMessage(logSheet, resultMsg);
    SpreadsheetApp.getUi().alert(resultMsg);

  } catch (e) {
    Logger.log('Критическая ошибка: ' + e.message);
    SpreadsheetApp.getUi().alert('Ошибка: ' + e.message);
  }
}

/**
 * Загружает карту цен через WB Prices API
 * @param {string} token - WB API токен
 * @param {Sheet} logSheet - лист лога
 * @returns {Object} карта { nmId: {discountedPrice, clubDiscountedPrice} }
 */
function fetchPriceMap_(token, logSheet) {
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

      if (statusCode !== 200) {
        Logger.log('Prices API ошибка ' + statusCode + ': ' + response.getContentText());
        break;
      }

      var json = JSON.parse(response.getContentText());
      var items = [];

      if (json.data && Array.isArray(json.data.listGoods)) {
        items = json.data.listGoods;
      } else if (json.data && Array.isArray(json.data)) {
        items = json.data;
      }

      Logger.log('Prices: offset=' + offset + ', получено=' + items.length);

      for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var nmId = String(item.nmID || item.nmId || '').trim();
        if (!nmId) continue;

        // Берём цену первого размера
        var discountedPrice = '';
        var clubDiscountedPrice = '';

        if (item.sizes && item.sizes.length > 0) {
          discountedPrice = item.sizes[0].discountedPrice || '';
          clubDiscountedPrice = item.sizes[0].clubDiscountedPrice || '';
        }

        // Если размеров нет, берём из корня
        if (!discountedPrice) {
          discountedPrice = item.discountedPrice || '';
        }
        if (!clubDiscountedPrice) {
          clubDiscountedPrice = item.clubDiscountedPrice || discountedPrice;
        }

        result[nmId] = {
          discountedPrice: discountedPrice,
          clubDiscountedPrice: clubDiscountedPrice
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
      break;
    }
  }

  return result;
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
  var spreadsheet = SpreadsheetApp.openById("1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE");
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error("Лист '" + SHEET_NAME + "' не найден!");
  return sheet;
}

function getSettingsSheet() {
  var spreadsheet = SpreadsheetApp.openById("1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE");
  var sheet = spreadsheet.getSheetByName(SETTINGS_SHEET);
  if (!sheet) throw new Error("Лист '" + SETTINGS_SHEET + "' не найден!");
  return sheet;
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
    SpreadsheetApp.getUi().alert('API-токен не заполнен в ячейке ' + TOKEN_CELL);
    return;
  }

  logMessage(logSheet, 'Старт загрузки товаров...');
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, COL_PHOTO, lastRow - 1, 6).clearContent();
  }

  var allCards = fetchAllCards(token);
  if (allCards.length === 0) {
    SpreadsheetApp.getUi().alert('Карточки не найдены. Проверьте токен.');
    logMessage(logSheet, 'ОШИБКА: карточки не найдены');
    return;
  }

  writeCardsToSheet(sheet, allCards);
  logMessage(logSheet, 'Загружено товаров: ' + allCards.length);
  SpreadsheetApp.getUi().alert('Готово! Загружено ' + allCards.length + ' товаров.');
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ
// ============================================

function getOrCreateLogSheet() {
  var spreadsheet = SpreadsheetApp.openById("1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE");
  var logSheet = spreadsheet.getSheetByName("Лог");
  if (!logSheet) {
    logSheet = spreadsheet.insertSheet("Лог");
    logSheet.appendRow(["Время", "Действие", "Сообщение"]);
    logSheet.getRange(1, 1, 1, 3).setFontWeight("bold");
  }
  return logSheet;
}

function logMessage(logSheet, message) {
  var ts = new Date().toISOString().replace("T", " ").substring(0, 19);
  logSheet.appendRow([ts, "Репрайсер WB", message]);
}

function logAction(action, message) {
  logMessage(getOrCreateLogSheet(), action + ": " + message);
}

// ============================================
// МЕНЮ
// ============================================

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Репрайсер")
    .addItem("Загрузить данные с WB", "loadWBData")
    .addItem("Парсить цены с сайта ВБ", "parsePricesFromWbSite")
    .addSeparator()
    .addItem("Установить API ключ WB", "setupWbApiKey")
    .addToUi();
}

function setupWbApiKey() {
  var response = SpreadsheetApp.getUi().prompt(
    "Установка API ключа WB",
    "Введите API токен Wildberries:",
    SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() === SpreadsheetApp.getUi().Button.OK) {
    var token = response.getResponseText();
    if (token && token.trim()) {
      try {
        getSettingsSheet().getRange(TOKEN_CELL).setValue(token.trim());
        SpreadsheetApp.getUi().alert("Токен сохранён");
      } catch (e) {
        SpreadsheetApp.getUi().alert("Ошибка: " + e.toString());
      }
    }
  }
}

function testWbApi() {
  try {
    var token = String(getSettingsSheet().getRange(TOKEN_CELL).getValue()).trim();
    if (!token) { SpreadsheetApp.getUi().alert("Токен не установлен!"); return; }
    var cards = fetchAllCards(token);
    SpreadsheetApp.getUi().alert("API работает! Товаров: " + cards.length);
  } catch (e) {
    SpreadsheetApp.getUi().alert("Ошибка API: " + e.toString());
  }
}

function loadProductsFromWB() {
  loadWBData();
}
