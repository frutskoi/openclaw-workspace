/**
 * Парсить цены с сайта ВБ
 *
 * Парсит цены товаров из листа "Репрайсер":
 * - Кол J (10): Цена без кошелька ВБ с сайта
 * - Кол K (11): Цена с кошельком ВБ с сайта
 *
 * Токен куки берётся из настроек (лист «Настройки», ячейка B3)
 */

// ---- КОНСТАНТЫ ----
var SHEET_NAME        = 'Репрайсер';
var SETTINGS_SHEET    = 'Настройки';
var TOKEN_COOKIE_CELL = 'B3';        // ячейка с токеном куки
var COL_WB_ID         = 2;   // B - Артикул WB
var COL_PRICE_J       = 10;  // J - Цена без кошелька ВБ с сайта
var COL_PRICE_K       = 11;  // K - Цена с кошельком ВБ с сайта

/**
 * Главная функция парсинга цен с сайта WB.
 * Вызывается из меню или по кнопке.
 */
function parsePricesFromWbSite() {
  console.log('\n' + '============================================================');
  console.log('НАЧИНАЮ ПАРСИНГ ЦЕН С САЙТА WB');
  console.log('============================================================\n');

  try {
    var ss       = SpreadsheetApp.getActiveSpreadsheet();
    var sheet    = ss.getSheetByName(SHEET_NAME);
    var settings = ss.getSheetByName(SETTINGS_SHEET);

    if (!sheet) {
      throw new Error('Лист "' + SHEET_NAME + '" не найден');
    }
    if (!settings) {
      throw new Error('Лист "' + SETTINGS_SHEET + '" не найден');
    }

    // Получаем токен куки
    var token = String(settings.getRange(TOKEN_COOKIE_CELL).getValue()).trim();
    if (!token) {
      SpreadsheetApp.getUi().alert('Токен куки не заполнен в ячейке ' + TOKEN_COOKIE_CELL + ' листа "' + SETTINGS_SHEET + '"');
      throw new Error('Токен куки не заполнен');
    }

    var data = sheet.getDataRange().getValues();
    if (data.length <= 1) {
      throw new Error('В таблице нет товаров');
    }

    var products = [];
    for (var i = 1; i < data.length; i++) {
      var row  = data[i];
      var wbId = row[COL_WB_ID - 1];
      if (wbId) {
        products.push({
          rowIndex: i + 1,
          wbId:     wbId.toString().trim()
        });
      }
    }

    console.log('Обрабатываю ' + products.length + ' товаров');

    var successCount = 0;
    var errorCount   = 0;

    for (var j = 0; j < products.length; j++) {
      var product = products[j];

      try {
        console.log('\nТовар: WB ID ' + product.wbId);

        // Получаем цены через WB API
        var prices = fetchWbPricesFromApi_(product.wbId, token);

        if (!prices) {
          console.warn('Не удалось получить цены для WB ID ' + product.wbId);
          errorCount++;
          continue;
        }

        var priceJ = prices.priceWithoutWallet;  // Цена без кошелька
        var priceK = prices.priceWithWallet;     // Цена с кошельком

        console.log('Цена без кошелька (J): ' + (priceJ !== null ? priceJ : 'НЕ НАЙДЕНА'));
        console.log('Цена с кошельком (K): ' + (priceK !== null ? priceK : 'НЕ НАЙДЕНА'));

        // Записываем J и K
        sheet.getRange(product.rowIndex, COL_PRICE_J).setValue(priceJ !== null ? priceJ : '');
        sheet.getRange(product.rowIndex, COL_PRICE_K).setValue(priceK !== null ? priceK : '');

        console.log('Строка ' + product.rowIndex + ' обновлена');
        successCount++;

        // Пауза между запросами
        Utilities.sleep(500);

      } catch (e) {
        console.error('Ошибка для WB ID ' + product.wbId + ': ' + e.message);
        errorCount++;
      }
    }

    var result = 'Парсинг завершён: успешно ' + successCount + ', ошибок ' + errorCount;
    console.log('\n' + result + '\n');
    SpreadsheetApp.getActiveSpreadsheet().toast(result, 'Парсинг WB', 5);
    SpreadsheetApp.getUi().alert(result);
    return result;

  } catch (e) {
    console.error('Критическая ошибка: ' + e.message);
    console.error('Stack: ' + e.stack);
    SpreadsheetApp.getActiveSpreadsheet().toast('Ошибка: ' + e.message, 'Парсинг WB', 10);
    SpreadsheetApp.getUi().alert('Ошибка: ' + e.message);
    throw e;
  }
}

/**
 * Загружает цены товара WB через публичный API.
 * @param {string} nmId - артикул WB
 * @param {string} token - токен куки для авторизованных запросов
 * @returns {object|null} {priceWithoutWallet, priceWithWallet} или null
 */
function fetchWbPricesFromApi_(nmId, token) {
  var url = 'https://card.wb.ru/cards/v1/detail?appType=1&curr=rub&dest=-1257786&nm=' + nmId;
  console.log('Запрос API: ' + url);

  try {
    var options = {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
        'Cookie': token  // Добавляем токен как cookie
      },
      muteHttpExceptions: true
    };

    var response   = UrlFetchApp.fetch(url, options);
    var statusCode = response.getResponseCode();
    console.log('HTTP статус: ' + statusCode);

    if (statusCode !== 200) {
      console.warn('Статус не 200: ' + statusCode);
      return null;
    }

    var json = JSON.parse(response.getContentText('UTF-8'));

    if (!json.data || !json.data.products || json.data.products.length === 0) {
      console.warn('Товар не найден в API');
      return null;
    }

    var product = json.data.products[0];

    // salePriceU - цена со скидкой в копейках (без кошелька)
    var salePriceU = product.salePriceU || product.priceU;
    var priceWithoutWallet = salePriceU ? Math.round(salePriceU / 100) : null;

    // Цена с кошельком = salePriceU - скидка кошелька
    var walletDiscount = 0;
    if (product.extended && product.extended.clientSale) {
      walletDiscount = product.extended.clientSale;
    }

    var priceWithWallet = salePriceU && walletDiscount ?
      Math.round((salePriceU - walletDiscount) / 100) : priceWithoutWallet;

    console.log('salePriceU: ' + salePriceU + ', walletDiscount: ' + walletDiscount);

    return {
      priceWithoutWallet: priceWithoutWallet,
      priceWithWallet: priceWithWallet
    };

  } catch (e) {
    console.error('Ошибка загрузки цен: ' + e.message);
    return null;
  }
}