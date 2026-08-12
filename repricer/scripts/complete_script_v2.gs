// ==================== АВТОРИЗАЦИЯ WILDBERRIES ====================

const WB_API_BASE = 'https://suppliers-api.wildberries.ru';

/**
 * Читает токены из листа "Настройки"
 */
function getWBSettings() {
  const ss = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  const settingsSheet = ss.getSheetByName('Настройки');

  if (!settingsSheet) {
    throw new Error('Лист "Настройки" не найден');
  }

  const settings = settingsSheet.getRange('A2:B7').getValues();
  const settingsMap = {};

  settings.forEach(row => {
    if (row[0]) {
      settingsMap[row[0]] = row[1];
    }
  });

  return settingsMap;
}

/**
 * Создает заголовки для API запросов
 */
function getWBHeaders(useUserToken = false) {
  const settings = getWBSettings();

  const apiKey = settings['API ключ WB (только чтение)'];
  const userToken = settings['Токен авторизованного пользователя WB'];

  const token = useUserToken ? userToken : apiKey;

  if (!token) {
    throw new Error('Токен не найден в настройках. Проверьте лист "Настройки"');
  }

  return {
    'Authorization': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

/**
 * Выполняет запрос к WB API с обработкой ошибок
 */
function fetchWBAPI(endpoint, options = {}, useUserToken = false) {
  try {
    const url = `${WB_API_BASE}${endpoint}`;
    const headers = getWBHeaders(useUserToken);

    const response = UrlFetchApp.fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      },
      muteHttpExceptions: true
    });

    const statusCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (statusCode >= 200 && statusCode < 300) {
      return JSON.parse(responseBody);
    } else {
      throw new Error(`API Error ${statusCode}: ${responseBody}`);
    }
  } catch (error) {
    throw error;
  }
}

// ==================== ЗАГРУЗКА ДАННЫХ ====================

const SPREADSHEET_ID = '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE';

/**
 * Основная функция загрузки данных с WB
 */
function loadWBData() {
  const startTime = new Date();
  const scriptName = "Загрузить данные с ВБ";

  try {
    Logger.log(`[${startTime}] Запуск скрипта: ${scriptName}`);

    // Получаем данные товаров из WB API
    const goodsData = fetchGoodsData();
    Logger.log(`Получено товаров: ${goodsData.length}`);

    // Получаем данные цен из WB API
    const pricesData = fetchPricesData();
    Logger.log(`Получено цен: ${pricesData.length}`);

    // Объединяем данные
    const combinedData = combineData(goodsData, pricesData);
    Logger.log(`Объединено записей: ${combinedData.length}`);

    // Записываем в таблицу
    writeDataToSheet(combinedData);

    const endTime = new Date();
    const duration = (endTime - startTime) / 1000;

    // Записываем лог успеха
    logToSheet({
      timestamp: endTime,
      sku: 'ВСЕ',
      action: 'Загрузка данных',
      oldPrice: '-',
      newPrice: '-',
      status: 'УСПЕХ',
      message: `Загружено ${combinedData.length} товаров за ${duration.toFixed(2)} сек`
    });

    Logger.log(`[${endTime}] Скрипт завершен успешно. Загружено: ${combinedData.length} товаров`);

    SpreadsheetApp.getUi().alert(
      `✅ Загрузка завершена!\n\nЗагружено товаров: ${combinedData.length}\nВремя выполнения: ${duration.toFixed(2)} сек`
    );

    return {
      success: true,
      loaded: combinedData.length,
      duration: duration
    };

  } catch (error) {
    const endTime = new Date();

    // Записываем лог ошибки
    logToSheet({
      timestamp: endTime,
      sku: 'ОШИБКА',
      action: 'Загрузка данных',
      oldPrice: '-',
      newPrice: '-',
      status: 'ОШИБКА',
      message: error.toString()
    });

    Logger.log(`[${endTime}] Ошибка: ${error.toString()}`);

    SpreadsheetApp.getUi().alert(
      `❌ Ошибка загрузки!\n\n${error.toString()}`
    );

    throw error;
  }
}

/**
 * Получает данные товаров из WB API
 */
function fetchGoodsData() {
  try {
    const result = fetchWBAPI('/public/api/v1/info/getGoodsList');

    if (result && result.data && result.data.goods) {
      return result.data.goods;
    }

    return [];
  } catch (error) {
    Logger.log(`Ошибка получения товаров: ${error.toString()}`);
    throw new Error(`Не удалось получить данные товаров: ${error.message}`);
  }
}

/**
 * Получает данные цен из WB API
 */
function fetchPricesData() {
  try {
    const result = fetchWBAPI('/public/api/v1/prices/getPrices');

    if (result && result.data && result.data.list) {
      return result.data.list;
    }

    return [];
  } catch (error) {
    Logger.log(`Ошибка получения цен: ${error.toString()}`);
    throw new Error(`Не удалось получить данные цен: ${error.message}`);
  }
}

/**
 * Объединяет данные товаров и цен по SKU
 */
function combineData(goodsData, pricesData) {
  const pricesMap = {};

  // Создаем маппинг цен по nmId (SKU WB)
  pricesData.forEach(item => {
    if (item.nmId) {
      pricesMap[item.nmId.toString()] = item;
    }
  });

  // Объединяем данные
  return goodsData.map(good => {
    const nmId = good.nmId ? good.nmId.toString() : null;
    const priceInfo = pricesMap[nmId] || {};

    return {
      photo: good.photos && good.photos.length > 0 ? good.photos[0].big : '',
      sku_wb: nmId || '',
      sku_seller: good.vendorCode || '',
      name: good.goodsName || '',
      brand: good.brand || '',
      rating: good.rating || 0,
      turnover: good.volume || 0,
      price_before_discount: priceInfo.price || 0,
      seller_discount: priceInfo.discount || 0,
      price_after_discount: priceInfo.priceWithDiscount || 0
    };
  });
}

/**
 * Записывает данные в лист "Репрайсер"
 */
function writeDataToSheet(data) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('Репрайсер');

  if (!sheet) {
    throw new Error('Лист "Репрайсер" не найден');
  }

  // Очищаем данные (оставляем заголовки)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 26).clearContent();
  }

  if (data.length === 0) {
    return;
  }

  // Подготавливаем массив для записи (26 колонок)
  const rows = data.map(item => [
    item.photo,                                      // A: Фото
    item.sku_wb,                                     // B: Артикул WB
    item.sku_seller,                                 // C: Артикул продавца
    item.name,                                       // D: Название
    item.brand,                                      // E: Бренд
    item.rating,                                     // F: Рейтинг
    item.turnover,                                   // G: Оборачиваемость
    '',                                              // H: Пустая
    '',                                              // I: РРЦ
    '',                                              // J: Мин. цена
    '',                                              // K: Текущая цена сайт
    '',                                              // L: Текущая цена с кошельком
    '',                                              // M: Пустая
    item.price_before_discount,                      // N: Цена до скидки (колонка 13)
    item.seller_discount,                            // O: Скидка продавца (колонка 14)
    item.price_after_discount,                       // P: Цена со скидкой (колонка 15)
    '',                                              // Q: Пустая
    '',                                              // R: СПП %
    '',                                              // S: Кошелек %
    '',                                              // T: Пустая
    '',                                              // U: Цена для загрузки
    '',                                              // V: Загруженная цена
    '',                                              // W: Акции
    '',                                              // X: Заводит в акцию?
    '',                                              // Y: Статус загрузки
    ''                                               // Z: Пустая
  ]);

  // Записываем данные
  sheet.getRange(2, 1, rows.length, 26).setValues(rows);

  // Настраиваем форматирование
  sheet.getRange(2, 1, rows.length, 1).setWrap(false);
  sheet.setColumnWidth(1, 120); // Фото

  // Числовые форматы
  sheet.getRange(2, 6, rows.length, 1).setNumberFormat('0.0'); // Рейтинг
  sheet.getRange(2, 7, rows.length, 1).setNumberFormat('0');   // Оборачиваемость
  sheet.getRange(2, 13, rows.length, 3).setNumberFormat('0.00'); // Цены
  sheet.getRange(2, 14, rows.length, 1).setNumberFormat('0%');   // Скидка
}

/**
 * Записывает лог в лист "Лог"
 */
function logToSheet(logData) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const logSheet = ss.getSheetByName('Лог');

  if (!logSheet) {
    throw new Error('Лист "Лог" не найден');
  }

  // Формируем строку лога
  const logRow = [
    formatDate(logData.timestamp),   // Дата и время
    logData.sku,                     // Артикул WB
    logData.action,                  // Действие
    logData.oldPrice,                // Старая цена
    logData.newPrice,                // Новая цена
    logData.status,                  // Статус
    logData.message                  // Сообщение
  ];

  // Добавляем запись в лог
  logSheet.appendRow(logRow);
}

/**
 * Форматирует дату для лога
 */
function formatDate(date) {
  return Utilities.formatDate(date, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm:ss');
}

/**
 * Создает меню "Репрайсер"
 */
function createRepricerMenu() {
  const ui = SpreadsheetApp.getUi();
  const menu = ui.createMenu('Репрайсер');

  menu.addItem('Загрузить данные с ВБ', 'loadWBData');
  menu.addToUi();
}

/**
 * Автозапуск при открытии таблицы
 */
function onOpen() {
  createRepricerMenu();
}