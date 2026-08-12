// Полный скрипт репрайсера WB

const SPREADSHEET_ID = '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE';
const WB_API_BASE = 'https://suppliers-api.wildberries.ru';

function getWBSettings() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const settingsSheet = ss.getSheetByName('Настройки');
  
  if (!settingsSheet) {
    throw new Error('Лист Настройки не найден');
  }
  
  const settings = settingsSheet.getRange('A2:B7').getValues();
  const settingsMap = {};
  
  settings.forEach(function(row) {
    if (row[0]) {
      settingsMap[row[0]] = row[1];
    }
  });
  
  return settingsMap;
}

function getWBHeaders(useUserToken) {
  const settings = getWBSettings();
  const apiKey = settings['API ключ WB (только чтение)'];
  const userToken = settings['Токен авторизованного пользователя WB'];
  
  const token = useUserToken ? userToken : apiKey;
  
  if (!token) {
    throw new Error('Токен не найден в настройках');
  }
  
  return {
    'Authorization': token,
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
}

function fetchWBAPI(endpoint, options, useUserToken) {
  var url = WB_API_BASE + endpoint;
  var headers = getWBHeaders(useUserToken);
  
  var response = UrlFetchApp.fetch(url, {
    headers: headers,
    muteHttpExceptions: true
  });
  
  var statusCode = response.getResponseCode();
  var responseBody = response.getContentText();
  
  if (statusCode >= 200 && statusCode < 300) {
    return JSON.parse(responseBody);
  } else {
    throw new Error('API Error ' + statusCode + ': ' + responseBody);
  }
}

function fetchGoodsData() {
  var result = fetchWBAPI('/public/api/v1/info/getGoodsList');
  
  if (result && result.data && result.data.goods) {
    return result.data.goods;
  }
  
  return [];
}

function fetchPricesData() {
  var result = fetchWBAPI('/public/api/v1/prices/getPrices');
  
  if (result && result.data && result.data.list) {
    return result.data.list;
  }
  
  return [];
}

function combineData(goodsData, pricesData) {
  var pricesMap = {};
  
  pricesData.forEach(function(item) {
    if (item.nmId) {
      pricesMap[item.nmId.toString()] = item;
    }
  });
  
  return goodsData.map(function(good) {
    var nmId = good.nmId ? good.nmId.toString() : null;
    var priceInfo = pricesMap[nmId] || {};
    
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

function writeDataToSheet(data) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Репрайсер');
  
  if (!sheet) {
    throw new Error('Лист Репрайсер не найден');
  }
  
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 26).clearContent();
  }
  
  if (data.length === 0) {
    return;
  }
  
  var rows = data.map(function(item) {
    return [
      item.photo,
      item.sku_wb,
      item.sku_seller,
      item.name,
      item.brand,
      item.rating,
      item.turnover,
      '',
      '',
      '',
      '',
      '',
      '',
      item.price_before_discount,
      item.seller_discount,
      item.price_after_discount,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      ''
    ];
  });
  
  sheet.getRange(2, 1, rows.length, 26).setValues(rows);
  sheet.getRange(2, 1, rows.length, 1).setWrap(false);
  sheet.setColumnWidth(1, 120);
}

function logToSheet(logData) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var logSheet = ss.getSheetByName('Лог');
  
  if (!logSheet) {
    throw new Error('Лист Лог не найден');
  }
  
  var logRow = [
    Utilities.formatDate(logData.timestamp, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'dd.MM.yyyy HH:mm:ss'),
    logData.sku,
    logData.action,
    logData.oldPrice,
    logData.newPrice,
    logData.status,
    logData.message
  ];
  
  logSheet.appendRow(logRow);
}

function loadWBData() {
  var startTime = new Date();
  
  try {
    Logger.log('[' + startTime + '] Запуск скрипта: Загрузить данные с ВБ');
    
    var goodsData = fetchGoodsData();
    Logger.log('Получено товаров: ' + goodsData.length);
    
    var pricesData = fetchPricesData();
    Logger.log('Получено цен: ' + pricesData.length);
    
    var combinedData = combineData(goodsData, pricesData);
    Logger.log('Объединено записей: ' + combinedData.length);
    
    writeDataToSheet(combinedData);
    
    var endTime = new Date();
    var duration = (endTime - startTime) / 1000;
    
    logToSheet({
      timestamp: endTime,
      sku: 'ВСЕ',
      action: 'Загрузка данных',
      oldPrice: '-',
      newPrice: '-',
      status: 'УСПЕХ',
      message: 'Загружено ' + combinedData.length + ' товаров за ' + duration.toFixed(2) + ' сек'
    });
    
    Logger.log('[' + endTime + '] Скрипт завершен успешно. Загружено: ' + combinedData.length + ' товаров');
    
    SpreadsheetApp.getUi().alert('✅ Загрузка завершена!\n\nЗагружено товаров: ' + combinedData.length + '\nВремя выполнения: ' + duration.toFixed(2) + ' сек');
    
    return {
      success: true,
      loaded: combinedData.length,
      duration: duration
    };
    
  } catch (error) {
    var endTime = new Date();
    
    logToSheet({
      timestamp: endTime,
      sku: 'ОШИБКА',
      action: 'Загрузка данных',
      oldPrice: '-',
      newPrice: '-',
      status: 'ОШИБКА',
      message: error.toString()
    });
    
    Logger.log('[' + endTime + '] Ошибка: ' + error.toString());
    
    SpreadsheetApp.getUi().alert('❌ Ошибка загрузки!\n\n' + error.toString());
    
    throw error;
  }
}

function createRepricerMenu() {
  var ui = SpreadsheetApp.getUi();
  var menu = ui.createMenu('Репрайсер');
  menu.addItem('Загрузить данные с ВБ', 'loadWBData');
  menu.addToUi();
}

function onOpen() {
  createRepricerMenu();
}