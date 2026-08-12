/**
 * ДЕБАГ: Показать ВСЕ цены для артикула 790058495
 * Запустить из Apps Script → выбери функцию debugShowAllPrices
 * Результат появится в логах (Ctrl+Enter → Execution log)
 */
function debugShowAllPrices() {
  var nmId = '790058495';
  var ss = SpreadsheetApp.openById('1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE');
  var token = String(ss.getSheetByName('Настройки').getRange('B3').getValue()).trim();
  
  Logger.log('=================================================');
  Logger.log('ДЕБАГ АРТИКУЛА: ' + nmId);
  Logger.log('=================================================');
  
  // ==========================================
  // 1. discounts-prices-api (API продавца) — то что ИСПОЛЬЗУЕТ наш скрипт
  // ==========================================
  Logger.log('\n=== 1. discounts-prices-api (ИСПОЛЬЗУЕТСЯ СЕЙЧАС) ===');
  try {
    var url1 = 'https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=0';
    var resp1 = UrlFetchApp.fetch(url1, {
      method: 'get',
      headers: { 'Authorization': token },
      muteHttpExceptions: true
    });
    Logger.log('HTTP: ' + resp1.getResponseCode());
    var json1 = JSON.parse(resp1.getContentText());
    var items = [];
    if (json1.data && Array.isArray(json1.data.listGoods)) {
      items = json1.data.listGoods;
    }
    
    // Ищем наш артикул
    var found = null;
    for (var i = 0; i < items.length; i++) {
      if (String(items[i].nmID || items[i].nmId || '') === nmId) {
        found = items[i];
        break;
      }
    }
    
    if (found) {
      Logger.log('ТОВАР НАЙДЕН в discounts-prices-api!');
      Logger.log('--- Все поля объекта ---');
      var keys = Object.keys(found).sort();
      for (var k = 0; k < keys.length; k++) {
        var key = keys[k];
        var val = found[key];
        if (typeof val === 'object') {
          Logger.log('  ' + key + ': ' + JSON.stringify(val));
        } else {
          Logger.log('  ' + key + ': ' + val);
        }
      }
      
      // Детально по sizes
      if (found.sizes && found.sizes.length > 0) {
        Logger.log('\n--- sizes[0] (детально) ---');
        var sizeKeys = Object.keys(found.sizes[0]).sort();
        for (var s = 0; s < sizeKeys.length; s++) {
          var sk = sizeKeys[s];
          var sv = found.sizes[0][sk];
          if (typeof sv === 'object') {
            Logger.log('  ' + sk + ': ' + JSON.stringify(sv));
          } else {
            Logger.log('  ' + sk + ': ' + sv);
          }
        }
      }
      
      // Цены которые БЕРЁТ наш скрипт
      var dp = '';
      var cdp = '';
      if (found.sizes && found.sizes.length > 0) {
        dp = found.sizes[0].discountedPrice || '';
        cdp = found.sizes[0].clubDiscountedPrice || '';
      }
      if (!dp) dp = found.discountedPrice || '';
      if (!cdp) cdp = found.clubDiscountedPrice || dp;
      
      Logger.log('\n>>> ЧТО ЗАПИСЫВАЕТСЯ В ТАБЛИЦУ <<<');
      Logger.log('  J (кол.10) discountedPrice = ' + dp);
      Logger.log('  K (кол.11) clubDiscountedPrice = ' + cdp);
      
    } else {
      Logger.log('Товар ' + nmId + ' НЕ НАЙДЕН в discounts-prices-api');
      Logger.log('Всего товаров: ' + items.length);
      if (items.length > 0) {
        Logger.log('Пример nmID из ответа: ' + (items[0].nmID || items[0].nmId));
      }
    }
    
  } catch (e) {
    Logger.log('ОШИБКА: ' + e.message);
  }
  
  // ==========================================
  // 2. card.wb.ru (публичный API — цены покупателя)
  // ==========================================
  Logger.log('\n=== 2. card.wb.ru (ПУБЛИЧНЫЙ API — цены на сайте) ===');
  try {
    var url2 = 'https://card.wb.ru/cards/v1/detail?appType=1&curr=RUB&dest=-1257786&nm=' + nmId;
    var resp2 = UrlFetchApp.fetch(url2, {
      method: 'get',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json'
      },
      muteHttpExceptions: true
    });
    Logger.log('HTTP: ' + resp2.getResponseCode());
    
    if (resp2.getResponseCode() === 200) {
      var json2 = JSON.parse(resp2.getContentText());
      if (json2.data && json2.data.products && json2.data.products.length > 0) {
        var prod = json2.data.products[0];
        Logger.log('ТОВАР НАЙДЕН на card.wb.ru!');
        Logger.log('name: ' + prod.name);
        
        // Все ценовые поля верхнего уровня
        Logger.log('\n--- Все поля с ценами ---');
        var prodKeys = Object.keys(prod).sort();
        for (var p = 0; p < prodKeys.length; p++) {
          var pk = prodKeys[p];
          var pv = prod[pk];
          if (typeof pv === 'number' || typeof pv === 'string') {
            Logger.log('  ' + pk + ': ' + pv);
          }
        }
        
        // sizes с ценами
        if (prod.sizes && prod.sizes.length > 0) {
          Logger.log('\n--- sizes[0] ---');
          var sKeys = Object.keys(prod.sizes[0]).sort();
          for (var si = 0; si < sKeys.length; si++) {
            Logger.log('  ' + sKeys[si] + ': ' + JSON.stringify(prod.sizes[0][sKeys[si]]));
          }
        }
        
        // extended
        if (prod.extended) {
          Logger.log('\n--- extended ---');
          var eKeys = Object.keys(prod.extended).sort();
          for (var ei = 0; ei < eKeys.length; ei++) {
            Logger.log('  ' + eKeys[ei] + ': ' + prod.extended[eKeys[ei]]);
          }
        }
      } else {
        Logger.log('Товар не найден в ответе card.wb.ru');
      }
    } else {
      Logger.log('Ответ: ' + resp2.getContentText().substring(0, 300));
    }
  } catch (e) {
    Logger.log('ОШИБКА: ' + e.message);
  }
  
  // ==========================================
  // 3. content-api (API контента продавца)
  // ==========================================
  Logger.log('\n=== 3. content-api (карточки товаров продавца) ===');
  try {
    var url3 = 'https://content-api.wildberries.ru/content/v2/get/cards/list';
    var body3 = {
      settings: {
        sort: { ascending: false },
        cursor: { limit: 100 },
        filter: { withPhoto: -1 }
      }
    };
    var resp3 = UrlFetchApp.fetch(url3, {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': token },
      payload: JSON.stringify(body3),
      muteHttpExceptions: true
    });
    Logger.log('HTTP: ' + resp3.getResponseCode());
    
    if (resp3.getResponseCode() === 200) {
      var json3 = JSON.parse(resp3.getContentText());
      var cards = json3.cards || [];
      
      var cardFound = null;
      for (var ci = 0; ci < cards.length; ci++) {
        if (String(cards[ci].nmID) === nmId) {
          cardFound = cards[ci];
          break;
        }
      }
      
      if (cardFound) {
        Logger.log('ТОВАР НАЙДЕН в content-api!');
        Logger.log('name: ' + (cardFound.title || ''));
        Logger.log('vendorCode: ' + (cardFound.vendorCode || ''));
        Logger.log('nmID: ' + cardFound.nmID);
        
        // sizes из content-api
        if (cardFound.sizes) {
          for (var cs = 0; cs < cardFound.sizes.length; cs++) {
            Logger.log('  size[' + cs + ']: ' + JSON.stringify(cardFound.sizes[cs]));
          }
        }
      } else {
        Logger.log('Товар ' + nmId + ' НЕ НАЙДЕН в content-api');
        Logger.log('Всего карточек: ' + cards.length);
        // Покажем все nmID
        var ids = [];
        for (var ci2 = 0; ci2 < cards.length; ci2++) {
          ids.push(cards[ci2].nmID);
        }
        Logger.log('nmID в таблице: ' + ids.join(', '));
      }
    }
  } catch (e) {
    Logger.log('ОШИБКА: ' + e.message);
  }
  
  Logger.log('\n=================================================');
  Logger.log('КОНЕЦ ДЕБАГА');
  Logger.log('=================================================');
}
