/**
 * Репрайсер WB - Скрипт "Загрузить данные с ВБ"
 *
 * Загружает данные о товарах из WB Content API в таблицу
 *
 * ID таблицы: 1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE
 * Лист: Репрайсер (ID: 858313582)
 */

// ============================================
// КОНСТАНТЫ
// ============================================

var WB_CONTENT_API = 'https://content-api.wildberries.ru';
var CARDS_LIST_URL = WB_CONTENT_API + '/content/v2/get/cards/list';
var SHEET_NAME = 'Репрайсер';
var SETTINGS_SHEET = 'Настройки';
var TOKEN_CELL = 'B3'; // API токен в Настройки!B3

// Столбцы (1-indexed)
var COL_PHOTO = 1;        // A - Фото товара
var COL_WB_ID = 2;        // B - Артикул WB
var COL_VENDOR_CODE = 3;  // C - Артикул продавца
var COL_NAME = 4;         // D - Название товара
var COL_BRAND = 5;        // E - Бренд товара
var COL_RATING = 6;       // F - Рейтинг товара

// ============================================
// WB API ФУНКЦИИ
// ============================================

/**
 * Выполняет POST-запрос к WB Content API.
 * @param {string} url - URL метода
 * @param {string} token - API токен
 * @param {Object} body - тело запроса (объект)
 * @returns {Object|null} - распарсенный JSON-ответ или null при ошибке
 */
function callWbApi(url, token, body) {
  try {
    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'Authorization': token
      },
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

/**
 * Загружает ВСЕ карточки товаров через WB API с пагинацией.
 * @param {string} token - API токен
 * @returns {Array} массив объектов карточек
 */
function fetchAllCards(token) {
  var allCards = [];
  var cursor = null; // { updatedAt, nmID } для пагинации
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

    // Добавляем курсор для пагинации (со 2-й страницы)
    if (cursor) {
      requestBody.settings.cursor.updatedAt = cursor.updatedAt;
      requestBody.settings.cursor.nmID = cursor.nmID;
    }

    var response = callWbApi(CARDS_LIST_URL, token, requestBody);
    if (!response) {
      Logger.log('Ошибка запроса на странице ' + pageCount);
      break;
    }

    var cards = response.cards || [];
    allCards = allCards.concat(cards);

    Logger.log('Получено на странице ' + pageCount + ': ' + cards.length + ' карточек');

    // Обновляем курсор для следующей итерации
    var responseCursor = response.cursor || {};
    cursor = {
      updatedAt: responseCursor.updatedAt,
      nmID: responseCursor.nmID
    };

    // Выходим, если получили меньше лимита (это последняя страница)
    if (cards.length < limit) break;

    // Небольшая пауза, чтобы не превысить rate limit
    Utilities.sleep(500);

  } while (true);

  return allCards;
}

// ============================================
// GOOGLE SHEETS ФУНКЦИИ
// ============================================

/**
 * Получить URL фото товара
 * @param {Object} card - карточка товара
 * @returns {string} URL фото
 */
function getProductPhotoUrl(card) {
  var photoUrl = '';
  var photos = card.photos || [];
  if (photos.length > 0) {
    var ph = photos[0];
    // Приоритет: big > c516x688 > square
    photoUrl = ph.big || ph['c516x688'] || ph.square || ph['164x218'] || '';
  }
  return photoUrl;
}

/**
 * Получить рейтинг товара
 * @param {Object} card - карточка товара
 * @returns {number} рейтинг
 */
function getProductRating(card) {
  if (card.rating) {
    return card.rating;
  } else if (card.productRating) {
    return card.productRating;
  } else if (card.reviewRating) {
    return card.reviewRating;
  }
  return 0;
}

/**
 * Записывает массив карточек в лист Google Sheets.
 * @param {Sheet} sheet - лист для записи
 * @param {Array} cards - массив карточек из WB API
 */
function writeCardsToSheet(sheet, cards) {
  for (var i = 0; i < cards.length; i++) {
    var card = cards[i];
    var rowNum = i + 2; // строки начинаются со 2-й (1-я — заголовки)

    var nmID = card.nmID || '';
    var vendorCode = card.vendorCode || '';
    var title = card.title || '';
    var brand = card.brand || '';
    var rating = getProductRating(card);

    // Артикул WB
    sheet.getRange(rowNum, COL_WB_ID).setValue(nmID);

    // Артикул продавца
    sheet.getRange(rowNum, COL_VENDOR_CODE).setValue(vendorCode);

    // Название товара
    sheet.getRange(rowNum, COL_NAME).setValue(title);

    // Бренд
    sheet.getRange(rowNum, COL_BRAND).setValue(brand);

    // Рейтинг
    sheet.getRange(rowNum, COL_RATING).setValue(rating);

    // Фото — вставляем через формулу IMAGE
    var photoUrl = getProductPhotoUrl(card);
    if (photoUrl) {
      sheet.getRange(rowNum, COL_PHOTO).setFormula('=IMAGE("' + photoUrl + '";4;80;80)');
    } else {
      sheet.getRange(rowNum, COL_PHOTO).setValue('');
    }

    // Каждые 50 строк делаем flush (чтобы не терять данные при долгой работе)
    if ((i + 1) % 50 === 0) {
      SpreadsheetApp.flush();
      Logger.log('Записано строк: ' + (i + 1));
    }
  }

  // Финальный flush
  SpreadsheetApp.flush();

  // Автоподбор высоты строк для фото
  try {
    var dataRows = cards.length;
    if (dataRows > 0) {
      sheet.setRowHeightsForced(2, dataRows, 85);
    }
  } catch (e) {
    Logger.log('Не удалось установить высоту строк: ' + e);
  }
}

/**
 * Получить лист таблицы
 * @returns {Sheet} Лист "Репрайсер"
 */
function getRepricerSheet() {
  var spreadsheet = SpreadsheetApp.openById("1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE");
  var sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) {
    throw new Error("Лист '" + SHEET_NAME + "' не найден!");
  }
  return sheet;
}

/**
 * Получить лист настроек
 * @returns {Sheet} Лист "Настройки"
 */
function getSettingsSheet() {
  var spreadsheet = SpreadsheetApp.openById("1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE");
  var sheet = spreadsheet.getSheetByName(SETTINGS_SHEET);
  if (!sheet) {
    throw new Error("Лист '" + SETTINGS_SHEET + "' не найден!");
  }
  return sheet;
}

// ============================================
// ОСНОВНАЯ ФУНКЦИЯ
// ============================================

/**
 * Загрузить данные с ВБ
 * Основная функция для вызова из меню
 */
function loadWBData() {
  var sheet = getRepricerSheet();
  var settings = getSettingsSheet();
  var logSheet = getOrCreateLogSheet();

  // Получаем токен
  var token = String(settings.getRange(TOKEN_CELL).getValue()).trim();
  if (!token) {
    SpreadsheetApp.getUi().alert('API-токен не заполнен в ячейке ' + TOKEN_CELL + ' листа "' + SETTINGS_SHEET + '"');
    return;
  }

  logMessage(logSheet, 'Старт загрузки товаров с WB API...');

  Logger.log('Начало загрузки товаров с WB API...');

  // Очищаем данные (начиная со строки 2, оставляем заголовки)
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, COL_PHOTO, lastRow - 1, 6).clearContent();
    // Удаляем формулы IMAGE
    sheet.getRange(2, COL_PHOTO, lastRow - 1, 1).clearContent();
  }

  // Загружаем все карточки с пагинацией
  var allCards = fetchAllCards(token);

  if (allCards.length === 0) {
    Logger.log('Карточки не найдены.');
    SpreadsheetApp.getUi().alert('Карточки товаров не найдены. Проверьте токен.');
    logMessage(logSheet, 'ОШИБКА: Карточки не найдены');
    return;
  }

  Logger.log('Загружено карточек: ' + allCards.length);

  // Заполняем лист
  writeCardsToSheet(sheet, allCards);

  logMessage(logSheet, 'Успешно загружено товаров: ' + allCards.length);
  SpreadsheetApp.getUi().alert('Готово! Загружено ' + allCards.length + ' карточек товаров.');
  Logger.log('Загрузка завершена. Записано строк: ' + allCards.length);
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

/**
 * Получить или создать лист лога
 * @returns {Sheet} Лист "Лог"
 */
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

/**
 * Логирование действий
 * @param {Sheet} logSheet - лист лога
 * @param {string} message - сообщение
 */
function logMessage(logSheet, message) {
  var timestamp = new Date().toISOString().replace("T", " ").substring(0, 19);
  logSheet.appendRow([timestamp, "Загрузка WB", message]);
}

/**
 * Логирование действий (совместимая функция)
 * @param {string} action - название действия
 * @param {string} message - сообщение
 */
function logAction(action, message) {
  var logSheet = getOrCreateLogSheet();
  logMessage(logSheet, action + ": " + message);
}

// ============================================
// МЕНЮ
// ============================================

/**
 * Создать меню при открытии таблицы
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu("Репрайсер")
    .addItem("Загрузить данные с WB", "loadWBData")
    .addSeparator()
    .addItem("Установить API ключ WB", "setupWbApiKey")
    .addToUi();
}

/**
 * Диалог для установки API ключа
 */
function setupWbApiKey() {
  var response = SpreadsheetApp.getUi().prompt(
    "Установка API ключа WB",
    "Введите API токен от Wildberries (Content API):",
    SpreadsheetApp.getUi().ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() === SpreadsheetApp.getUi().Button.OK) {
    var token = response.getResponseText();
    if (token && token.trim() !== "") {
      try {
        var settings = getSettingsSheet();
        settings.getRange(TOKEN_CELL).setValue(token.trim());
        SpreadsheetApp.getUi().alert("API токен сохранен в ячейке " + SETTINGS_SHEET + "!" + TOKEN_CELL);
        Logger.log("API токен сохранен");
      } catch (e) {
        SpreadsheetApp.getUi().alert("Ошибка сохранения токена: " + e.toString());
      }
    } else {
      SpreadsheetApp.getUi().alert("API токен не может быть пустым");
    }
  }
}

/**
 * Тестовая функция для проверки API
 */
function testWbApi() {
  try {
    var settings = getSettingsSheet();
    var token = String(settings.getRange(TOKEN_CELL).getValue()).trim();
    if (!token) {
      SpreadsheetApp.getUi().alert("API токен не установлен!");
      return;
    }
    
    var cards = fetchAllCards(token);
    SpreadsheetApp.getUi().alert("API работает! Получено товаров: " + cards.length);
  } catch (e) {
    SpreadsheetApp.getUi().alert("Ошибка API: " + e.toString());
  }
}

/**
 * Функция-алиас для совместимости
 */
function loadProductsFromWB() {
  loadWBData();
}