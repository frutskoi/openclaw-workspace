/**
 * Скрипт загрузки данных с Wildberries
 * Загружает основные данные о товарах в лист "Репрайсер"
 */

// ID таблицы
const SPREADSHEET_ID = '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE';

// Маппинг колонок (A=1, B=2, ...)
const COLUMNS = {
  PHOTO: 1,           // A
  SKU_WB: 2,          // B
  SKU_SELLER: 3,      // C
  NAME: 4,            // D
  BRAND: 5,           // E
  RATING: 6,          // F
  TURNOVER: 7,        // G
  PRICE_BEFORE_DISCOUNT: 13, // M
  SELLER_DISCOUNT: 14,       // N
  PRICE_AFTER_DISCOUNT: 15   // O
};

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

  // Создаем маппинг цен по SKU
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

  // Подготавливаем массив для записи
  const rows = data.map(item => [
    item.photo,                                      // A: Фото
    item.sku_wb,                                     // B: Артикул WB
    item.sku_seller,                                 // C: Артикул продавца
    item.name,                                       // D: Название
    item.brand,                                      // E: Бренд
    item.rating,                                     // F: Рейтинг
    item.turnover,                                   // G: Оборачиваемость
    '',                                              // H: Пустая
    '',                                              // I: РРЦ (пока пусто)
    '',                                              // J: Мин. цена (пока пусто)
    '',                                              // K: Текущая цена сайт (пока пусто)
    '',                                              // L: Текущая цена с кошельком (пока пусто)
    '',                                              // M: Пустая
    item.price_before_discount,                      // N: Цена до скидки
    item.seller_discount,                            // O: Скидка продавца
    item.price_after_discount,                       // P: Цена со скидкой
    '',                                              // Q: Пустая
    '',                                              // R: СПП % (пока пусто)
    '',                                              // S: Кошелек % (пока пусто)
    '',                                              // T: Пустая
    '',                                              // U: Цена для загрузки (пока пусто)
    '',                                              // V: Загруженная цена (пока пусто)
    '',                                              // W: Акции (пока пусто)
    '',                                              // X: Заводит в акцию? (пока пусто)
    ''                                               // Y: Статус загрузки (пока пусто)
  ]);

  // Записываем данные
  sheet.getRange(2, 1, rows.length, 26).setValues(rows);

  // Устанавливаем форматирование для фото
  sheet.getRange(2, COLUMNS.PHOTO, rows.length, 1).setWrap(false);
  sheet.setColumnWidth(COLUMNS.PHOTO, 120);
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

  // Добавляем запись в начало лога (после заголовка)
  const lastRow = logSheet.getLastRow();
  if (lastRow === 1) {
    logSheet.appendRow(logRow);
  } else {
    logSheet.insertRowAfter(1);
    logSheet.getRange(2, 1, 1, 7).setValues([logRow]);
  }
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