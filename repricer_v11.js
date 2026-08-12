// ===== РЕПРАЙСЕР OZON v11 =====
// v11: исправлено соответствие столбцам листа "Репрайсер"
// A: Фото, B: Product ID, C: Offer ID, D: Название, E: Бренд, F: Рейтинг
// G: РРЦ, H: Мин.цена, I: Цена продавца (API), J: СПП%, K: Кошелек%
// L: Цена с кошельком, M: Цена без кошелька, N: Индекс цен, O: Цвет индекса
// P: Модель удержания, Q: Маржинальность, R: Цена для загрузки
// S: Загруженная цена, T: Статус загрузки, U: Бустинг + акции
// V: Остаток FBS, W: Остаток FBO
//
// Расчёты:
// M = L * (1 - K) — цена без кошелька
// J(СПП%) = (I - M) / I
// R = G / (1 - J) / (1 - K) если P="С кошельком"
// R = G / (1 - J) если P="Без кошелька"

var UPLOAD_COUNTER_KEY = 'repricer_upload_count';

function getConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = ss.getSheetByName('Настройки');
  return {
    clientId: settings.getRange('B3').getValue().toString().trim(),
    apiKey: settings.getRange('C3').getValue().toString().trim(),
    baseUrl: 'https://api-seller.ozon.ru'
  };
}

function ozonApi(endpoint, body) {
  var config = getConfig();
  if (!config.clientId || !config.apiKey) throw new Error('Заполните Client ID и API Key');
  var response = UrlFetchApp.fetch(config.baseUrl + endpoint, {
    method: 'post', contentType: 'application/json',
    headers: { 'Client-Id': config.clientId, 'Api-Key': config.apiKey },
    payload: JSON.stringify(body), muteHttpExceptions: true
  });
  return JSON.parse(response.getContentText());
}

function ozonApiGet(endpoint) {
  var config = getConfig();
  if (!config.clientId || !config.apiKey) throw new Error('Заполните Client ID и API Key');
  var response = UrlFetchApp.fetch(config.baseUrl + endpoint, {
    method: 'get', contentType: 'application/json',
    headers: { 'Client-Id': config.clientId, 'Api-Key': config.apiKey },
    muteHttpExceptions: true
  });
  return JSON.parse(response.getContentText());
}

function showAlert(title, msg) {
  try { SpreadsheetApp.getUi().alert(title, msg); }
  catch (e) { Logger.log(title + ': ' + msg); }
}

function logAction(action, status, details) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('Лог');
  if (!logSheet) return;

  var props = PropertiesService.getDocumentProperties();
  var count = parseInt(props.getProperty(UPLOAD_COUNTER_KEY) || '0');

  if (action === 'Загрузка цен') {
    count++;
    props.setProperty(UPLOAD_COUNTER_KEY, count.toString());
    if (count % 3 === 0) {
      var lastRow = logSheet.getLastRow();
      if (lastRow > 1) {
        logSheet.getRange(2, 1, lastRow - 1, logSheet.getLastColumn()).clearContent();
      }
    }
  }

  logSheet.appendRow([new Date(), action, status, details || '']);
}

function calcBuyerPrice(priceIndexValue, minCompetitorPrice) {
  if (!priceIndexValue || !minCompetitorPrice || priceIndexValue === 0 || minCompetitorPrice === 0) return null;
  var idx = parseFloat(priceIndexValue);
  var minP = parseFloat(minCompetitorPrice);
  if (idx < 1) return Math.round(idx * minP);
  if (idx > 1) return Math.round(minP / (2 - idx));
  return Math.round(minP);
}

function colorIndexText(color) {
  if (!color) return '';
  var c = color.toUpperCase();
  if (c === 'GREEN') return '🟢 Зелёный';
  if (c === 'PURPLE' || c === 'VIOLET' || c === 'SUPER') return '🟣 Супервыгодный';
  if (c === 'YELLOW') return '🟡 Пограничный';
  if (c === 'RED') return '🔴 Невыгодный';
  if (c === 'WITHOUT_INDEX') return '⚪ Без индекса';
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
    .addItem('3. Рассчитать цены (R)', 'calculatePrices')
    .addSeparator()
    .addItem('4. Загрузить цены на Ozon', 'uploadPrices')
    .addSeparator()
    .addItem('📊 Полный цикл (1→2→3→4)', 'fullCycle')
    .addSeparator()
    .addItem('5. Юнит экономика', 'loadUnitEconomics')
    .addSeparator()
    .addItem('⏱ Включить авто', 'enableAutoRun')
    .addItem('⏹ Выключить авто', 'disableAutoRun')
    .addToUi();
}

function enableAutoRun() {
  // Удалить старый триггер если есть
  disableAutoRun(true);
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = ss.getSheetByName('Настройки');
  var minutes = parseInt(settings.getRange('B6').getValue()) || 30;
  
  ScriptApp.newTrigger('autoFullCycle')
    .timeBased()
    .everyMinutes(minutes)
    .create();
  
  logAction('Авто', 'Включено', 'Интервал: ' + minutes + ' мин');
  showAlert('Авто включено', 'Полный цикл будет запускаться каждые ' + minutes + ' минут');
}

function disableAutoRun(silent) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoFullCycle') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  if (!silent) {
    logAction('Авто', 'Выключено', '');
    showAlert('Авто выключено', 'Триггер удалён');
  }
}

function autoFullCycle() {
  try {
    getOzonPrices();
    calculatePrices();
    uploadPrices();
  } catch (e) {
    logAction('Авто', 'Ошибка', e.message);
  }
}

// =====================================================================
// Акции
// =====================================================================
function getAllBoostActions() {
  var actions = [];
  try {
    var result = ozonApiGet('/v1/actions');
    if (result && result.result) {
      for (var i = 0; i < result.result.length; i++) {
        var a = result.result[i];
        var title = (a.title || '').toLowerCase();
        if (title.indexOf('эластич') !== -1 || title.indexOf('бустинг') !== -1) actions.push(a);
      }
    }
  } catch (e) {}
  return actions;
}

function getBoostCandidates(actions) {
  var boostMap = {};
  for (var ai = 0; ai < actions.length; ai++) {
    var actionId = actions[ai].id;
    try {
      var offset = 0;
      while (true) {
        var candResult = ozonApi('/v1/actions/candidates', { action_id: actionId.toString(), limit: 100, offset: offset });
        if (!candResult || !candResult.result) break;
        var products = candResult.result.products || [];
        for (var j = 0; j < products.length; j++) {
          var p = products[j];
          if (!boostMap[p.id]) boostMap[p.id] = [];
          boostMap[p.id].push({
            actionId: actionId,
            minElastic: p.price_min_elastic || 0,
            maxElastic: p.price_max_elastic || 0,
            minBoost: p.min_boost || 0,
            maxBoost: p.max_boost || 0
          });
        }
        if (products.length < 100) break;
        offset += 100;
        Utilities.sleep(500);
      }
    } catch (e) {}
  }
  return boostMap;
}

function getProductsInActions(actions) {
  var inActionMap = {};
  for (var ai = 0; ai < actions.length; ai++) {
    try {
      var offset = 0;
      while (true) {
        var result = ozonApi('/v1/actions/products', { action_id: actions[ai].id.toString(), limit: 100, offset: offset });
        if (!result || !result.result) break;
        var products = result.result.products || [];
        for (var j = 0; j < products.length; j++) {
          var pid = products[j].id || products[j].product_id;
          if (!inActionMap[pid]) inActionMap[pid] = [];
          inActionMap[pid].push(actions[ai].id);
        }
        if (products.length < 100) break;
        offset += 100;
        Utilities.sleep(300);
      }
    } catch (e) {}
  }
  return inActionMap;
}

function removeFromActions(productId, actions) {
  for (var i = 0; i < actions.length; i++) {
    try { ozonApi('/v1/actions/products/deactivate', { action_id: actions[i].id, product_ids: [productId] }); }
    catch (e) {}
  }
}

function addToAction(productId, actionId, actionPrice) {
  try {
    var result = ozonApi('/v1/actions/products/activate', {
      action_id: actionId,
      products: [{ product_id: productId, action_price: actionPrice }]
    });
    return result && result.result && result.result.product_ids && result.result.product_ids.indexOf(productId) !== -1;
  } catch (e) { return false; }
}

// =====================================================================
// 1. Загрузить товары
// =====================================================================
function loadOzonProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  // Получить все товары
  var allItems = [];
  var lastId = '';
  while (true) {
    var result = ozonApi('/v3/product/list', { filter: { visibility: 'ALL' }, limit: 100, last_id: lastId });
    if (!result || !result.result) { showAlert('Ошибка', JSON.stringify(result)); return; }
    var items = result.result.items || [];
    allItems = allItems.concat(items);
    lastId = result.result.last_id;
    if (items.length < 100) break;
  }
  if (allItems.length === 0) { showAlert('Внимание', 'Товары не найдены'); return; }

  // Сортировка A→Z по Offer ID
  allItems.sort(function(a, b) {
    var oa = (a.offer_id || '').toLowerCase();
    var ob = (b.offer_id || '').toLowerCase();
    return oa < ob ? -1 : oa > ob ? 1 : 0;
  });

  // Сохранить ручные данные перед очисткой
  // G(7)=РРЦ, H(8)=Мин.цена, J(10)=СПП%, K(11)=Кошелек%, P(16)=Модель, Q(17)=Маржинальность
  var userData = {};
  if (lastRow >= 2) {
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      if (pid) userData[pid.toString()] = {
        rrc: sheet.getRange(r, 7).getValue(),       // G
        minP: sheet.getRange(r, 8).getValue(),       // H
        sppPct: sheet.getRange(r, 10).getValue(),    // J
        walletPct: sheet.getRange(r, 11).getValue(),  // K
        model: sheet.getRange(r, 16).getValue(),     // P
        margin: sheet.getRange(r, 17).getValue()     // Q
      };
    }
  }

  // Очистить 23 столбца (A-W)
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 23).clearContent();

  // Фото batch
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
  } catch (e) {}

  // Батч: получить названия через /v1/product/info/description (по одному — других батчей нет)
  var nameMap = {};
  for (var ni = 0; ni < allItems.length; ni++) {
    try {
      var descResult = ozonApi('/v1/product/info/description', { product_id: allItems[ni].product_id });
      if (descResult && descResult.result) nameMap[allItems[ni].product_id] = descResult.result.name || '';
    } catch (e) {}
    if ((ni + 1) % 5 === 0) Utilities.sleep(500);
  }

  // Батч: получить остатки через /v4/product/info/stocks
  var stockMap = {};
  for (var si = 0; si < allItems.length; si += 100) {
    var stockBatch = allItems.slice(si, si + 100);
    var stockPids = [];
    for (var sx = 0; sx < stockBatch.length; sx++) stockPids.push(stockBatch[sx].product_id);
    try {
      var stockResult = ozonApi('/v4/product/info/stocks', {
        filter: { offer_id: [], product_id: stockPids, visibility: 'ALL' },
        limit: 100, last_id: ''
      });
      if (stockResult && stockResult.items) {
        for (var sj = 0; sj < stockResult.items.length; sj++) {
          var sItem = stockResult.items[sj];
          var fbs = 0, fbo = 0;
          var stocks = sItem.stocks || [];
          for (var sk = 0; sk < stocks.length; sk++) {
            if (stocks[sk].type === 'fbs') fbs += (stocks[sk].present || 0);
            if (stocks[sk].type === 'fbo') fbo += (stocks[sk].present || 0);
          }
          stockMap[sItem.product_id] = { fbs: fbs, fbo: fbo };
        }
      }
    } catch (e) { Logger.log('stocks error: ' + e.message); }
    Utilities.sleep(500);
  }

  var success = 0, errors = 0;
  for (var i = 0; i < allItems.length; i++) {
    try {
      var item = allItems[i];
      var row = i + 2;

      // A(1): Фото
      if (photoMap[item.product_id]) sheet.getRange(row, 1).setFormula('=IMAGE("' + photoMap[item.product_id] + '")');
      // B(2): Product ID
      sheet.getRange(row, 2).setValue(item.product_id);
      // C(3): Offer ID
      sheet.getRange(row, 3).setValue(item.offer_id || '');

      // D(4): Название
      sheet.getRange(row, 4).setValue(nameMap[item.product_id] || '');

      // V(22): Остаток FBS, W(23): Остаток FBO
      if (stockMap[item.product_id]) {
        sheet.getRange(row, 22).setValue(stockMap[item.product_id].fbs);
        sheet.getRange(row, 23).setValue(stockMap[item.product_id].fbo);
      }

      // Восстановить ручные данные
      var saved = userData[item.product_id.toString()];
      if (saved) {
        if (saved.rrc) sheet.getRange(row, 7).setValue(saved.rrc);         // G
        if (saved.minP) sheet.getRange(row, 8).setValue(saved.minP);       // H
        if (saved.sppPct) sheet.getRange(row, 10).setValue(saved.sppPct);  // J
        if (saved.walletPct) sheet.getRange(row, 11).setValue(saved.walletPct); // K
        if (saved.model) sheet.getRange(row, 16).setValue(saved.model);    // P
        if (saved.margin) sheet.getRange(row, 17).setValue(saved.margin);  // Q
      }
      success++;
    } catch (e) { errors++; Logger.log('Row error: ' + e.message); }
  }

  // Загрузить остатки FBS/FBO
  loadStocksBatch(sheet, allItems);

  logAction('Загрузка товаров', 'ОК', 'Загружено: ' + success + ', Ошибок: ' + errors);
  showAlert('Готово', 'Загружено: ' + success + '\nОтсортировано A→Z\nОшибок: ' + errors);
}

// =====================================================================
// 2. Цены + индекс (API)
// Заполняет: I(9) цена, L(12) с кошельком, M(13) без кошелька,
//           J(10) СПП%, N(14) индекс, O(15) цвет
// =====================================================================
function getOzonPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Загрузите товары'); return; }

  var priceMap = {};
  var cursor = '';
  while (true) {
    var result = ozonApi('/v5/product/info/prices', { filter: { visibility: 'ALL' }, cursor: cursor, limit: 100 });
    if (!result) break;
    var items = result.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].product_id) priceMap[items[i].product_id] = items[i];
    }
    cursor = result.cursor || '';
    if (items.length < 100 || !cursor) break;
  }

  var sPrice = 0, sIndex = 0, notFound = 0;
  for (var row = 2; row <= lastRow; row++) {
    var pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;
    var pd = priceMap[pid];
    if (!pd) { notFound++; continue; }

    // I(9) — Цена продавца
    sheet.getRange(row, 9).setValue(pd.price.price || '');
    sPrice++;

    // Индекс цен
    var pIdx = pd.price_indexes || {};
    var ozonIdx = pIdx.ozon_index_data || {};
    var extIdx = pIdx.external_index_data || {};
    var selfIdx = pIdx.self_marketplaces_index_data || {};
    var colorIdx = pIdx.color_index || '';

    var idxValue = 0, minCompPrice = 0;
    if (ozonIdx.price_index_value && ozonIdx.price_index_value !== 0 && ozonIdx.min_price) {
      idxValue = parseFloat(ozonIdx.price_index_value); minCompPrice = parseFloat(ozonIdx.min_price);
    } else if (extIdx.price_index_value && extIdx.price_index_value !== 0 && extIdx.min_price) {
      idxValue = parseFloat(extIdx.price_index_value); minCompPrice = parseFloat(extIdx.min_price);
    } else if (selfIdx.price_index_value && selfIdx.price_index_value !== 0 && selfIdx.min_price) {
      idxValue = parseFloat(selfIdx.price_index_value); minCompPrice = parseFloat(selfIdx.min_price);
    }

    // N(14) — Индекс цен
    if (idxValue !== 0) sheet.getRange(row, 14).setValue(idxValue);
    // O(15) — Цвет индекса
    if (colorIdx) sheet.getRange(row, 15).setValue(colorIndexText(colorIdx));

    // L(12) — Цена с кошельком (из индекса)
    if (idxValue !== 0 && minCompPrice !== 0) {
      var wp = calcBuyerPrice(idxValue, minCompPrice);
      if (wp) {
        sheet.getRange(row, 12).setValue(wp);
        sIndex++;

        // M(13) — Цена без кошелька = L * (1 - K)
        var wPct = parseFloat(sheet.getRange(row, 11).getValue()); // K
        var priceWithoutWallet = 0;
        if (wPct && !isNaN(wPct)) {
          priceWithoutWallet = wp / (1 - wPct);
        } else {
          priceWithoutWallet = wp;
        }
        sheet.getRange(row, 13).setValue(Math.round(priceWithoutWallet));

        // J(10) — СПП % = (I - M) / I
        var sPrice2 = parseFloat(pd.price.price);
        if (sPrice2 && priceWithoutWallet && sPrice2 > 0) {
          var sppPct = (sPrice2 - priceWithoutWallet) / sPrice2;
          if (sppPct < 0) sppPct = 0;
          sheet.getRange(row, 10).setValue(Math.round(sppPct * 10000) / 10000);
        }
      }
    }
  }

  // Загрузить остатки FBS/FBO
  var sheetP = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lr = sheetP.getLastRow();
  if (lr >= 2) loadStocksByPid(sheetP, lr);

  logAction('Цены + индекс', 'ОК', 'Цен: ' + sPrice + ', С кошельком: ' + sIndex + ', Не найдено: ' + notFound);
  showAlert('Готово', 'Цен: ' + sPrice + '\nС кошельком: ' + sIndex + '\nНе найдено: ' + notFound);
}

// =====================================================================
// Загрузка остатков FBS/FBO → V(22), W(23)
// Использует /v4/product/info/stocks напрямую по product_id
// =====================================================================
function loadStocksBatch(sheet, allItems) {
  try {
    var pids = [];
    for (var i = 0; i < allItems.length; i++) pids.push(allItems[i].product_id);
    if (pids.length === 0) return;
    doLoadStocksV4(sheet, pids);
  } catch (e) {
    Logger.log('loadStocksBatch error: ' + e.message);
  }
}

function loadStocksByPid(sheet, lastRow) {
  try {
    var pids = [];
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      if (pid) pids.push(pid);
    }
    if (pids.length === 0) return;
    doLoadStocksV4(sheet, pids);
  } catch (e) {
    Logger.log('loadStocksByPid error: ' + e.message);
  }
}

function doLoadStocksV4(sheet, pids) {
  var stockMap = {};
  for (var bi = 0; bi < pids.length; bi += 100) {
    var batch = pids.slice(bi, bi + 100);
    try {
      var stockResult = ozonApi('/v4/product/info/stocks', {
        filter: { offer_id: [], product_id: batch, visibility: 'ALL' },
        limit: 100, last_id: ''
      });
      if (stockResult && stockResult.items) {
        for (var si = 0; si < stockResult.items.length; si++) {
          var sItem = stockResult.items[si];
          var fbs = 0, fbo = 0;
          var stocks = sItem.stocks || [];
          for (var sk = 0; sk < stocks.length; sk++) {
            if (stocks[sk].type === 'fbs') fbs += (stocks[sk].present || 0);
            if (stocks[sk].type === 'fbo') fbo += (stocks[sk].present || 0);
          }
          stockMap[sItem.product_id] = { fbs: fbs, fbo: fbo };
        }
      }
    } catch (e) {
      Logger.log('stocks v4 error: ' + e.message);
    }
    Utilities.sleep(300);
  }

  // Записать в таблицу
  var lastRow = sheet.getLastRow();
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    if (productId && stockMap[productId]) {
      sheet.getRange(row, 22).setValue(stockMap[productId].fbs);  // V: Остаток FBS
      sheet.getRange(row, 23).setValue(stockMap[productId].fbo);  // W: Остаток FBO
    }
  }
}

// =====================================================================
// 3. Рассчитать цены
// M(13) = L(12) * (1 - K(11))
// J(10) = (I(9) - M(13)) / I(9) — СПП %
// R(18) = G(7) / (1 - J) / (1 - K) если P="С кошельком"
// R(18) = G(7) / (1 - J) если P="Без кошелька"
// =====================================================================
function calculatePrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Расчёт цен v11 ===');

  var actions = getAllBoostActions();
  var boostMap = getBoostCandidates(actions);

  var updated = 0;
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var rrc = parseFloat(sheet.getRange(row, 7).getValue());           // G — РРЦ
    var minPrice = parseFloat(sheet.getRange(row, 8).getValue());      // H — Мин. цена
    var sellerPrice = parseFloat(sheet.getRange(row, 9).getValue());   // I — Цена продавца
    var walletPct = parseFloat(sheet.getRange(row, 11).getValue());    // K — Кошелек %
    var walletPrice = parseFloat(sheet.getRange(row, 12).getValue());  // L — Цена с кошельком
    var model = sheet.getRange(row, 16).getValue().toString().trim();  // P — Модель удержания

    if (!sellerPrice && !rrc) continue;

    var basePrice = rrc || sellerPrice;

    // M(13) — Цена без кошелька = L / (1 - K)
    var priceWithoutWallet = 0;
    if (walletPrice && walletPct && !isNaN(walletPct)) {
      priceWithoutWallet = walletPrice / (1 - walletPct);
      sheet.getRange(row, 13).setValue(Math.round(priceWithoutWallet));
    } else if (walletPrice) {
      priceWithoutWallet = walletPrice;
      sheet.getRange(row, 13).setValue(Math.round(priceWithoutWallet));
    }

    // J(10) — СПП % = (I - M) / I
    var sppPct = 0;
    if (sellerPrice && priceWithoutWallet && sellerPrice > 0) {
      sppPct = (sellerPrice - priceWithoutWallet) / sellerPrice;
      if (sppPct < 0) sppPct = 0;
      sheet.getRange(row, 10).setValue(Math.round(sppPct * 10000) / 10000);
    }

    // R(18) — Цена для загрузки
    var targetPrice = basePrice;

    var hasWallet = model.toLowerCase().indexOf('без кошелька') === -1;

    if (sppPct > 0 && sppPct < 1) {
      if (hasWallet && walletPct && walletPct > 0 && walletPct < 1) {
        // С кошельком: R = G / (1 - sppPct) / (1 - walletPct)
        targetPrice = targetPrice / (1 - sppPct) / (1 - walletPct);
      } else {
        // Без кошелька: R = G / (1 - sppPct)
        targetPrice = targetPrice / (1 - sppPct);
      }
    }

    targetPrice = Math.round(targetPrice);
    if (minPrice && targetPrice < minPrice) targetPrice = minPrice;
    if (!targetPrice || targetPrice < 1) targetPrice = basePrice;

    sheet.getRange(row, 18).setValue(targetPrice); // R(18)

    // U(21) — Бустинг + акции
    if (productId && boostMap[productId]) {
      var bi = boostMap[productId];
      var bestBoost = null;
      for (var bi2 = 0; bi2 < bi.length; bi2++) {
        var b = bi[bi2];
        if (b.minElastic > 0 && b.maxElastic > 0 && targetPrice >= b.maxElastic && targetPrice <= b.minElastic) {
          var boostRange = b.minElastic - b.maxElastic;
          var priceOffset = targetPrice - b.maxElastic;
          var boostPct = boostRange > 0 ? Math.round(b.minBoost + (b.maxBoost - b.minBoost) * (1 - priceOffset / boostRange)) : b.minBoost;
          if (!bestBoost || boostPct > bestBoost.boostPct) {
            bestBoost = { boostPct: boostPct, actionId: b.actionId, minEl: b.minElastic, maxEl: b.maxElastic };
          }
        }
      }
      if (bestBoost) {
        sheet.getRange(row, 21).setValue('✅ ' + bestBoost.boostPct + '% | ' + bi.length + ' акц.');
      } else {
        var best = bi[0];
        for (var bi3 = 1; bi3 < bi.length; bi3++) {
          if (bi[bi3].minElastic > best.minElastic) best = bi[bi3];
        }
        if (targetPrice > best.minElastic) {
          sheet.getRange(row, 21).setValue('❌ Выше (' + best.maxElastic + '-' + best.minElastic + ') | ' + bi.length + ' акц.');
        } else if (best.maxElastic > 0 && targetPrice < best.maxElastic) {
          sheet.getRange(row, 21).setValue('⚠️ Ниже (' + best.maxElastic + '-' + best.minElastic + ') | ' + bi.length + ' акц.');
        } else {
          sheet.getRange(row, 21).setValue('❌ Не попал | ' + bi.length + ' акц.');
        }
      }
    } else {
      sheet.getRange(row, 21).setValue('—');
    }
    updated++;
  }
  logAction('Расчёт цен', 'ОК', 'Рассчитано: ' + updated);
  showAlert('Готово', 'Рассчитано: ' + updated);
}

// =====================================================================
// 4. Загрузить цены на Ozon
// Порядок: вывести из акций → загрузить цену → проверить и добавить в акции
// S(19) = загруженная цена, T(20) = статус
// =====================================================================
function uploadPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Загрузка цен v11 ===');

  var prices = [];
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var targetPrice = parseFloat(sheet.getRange(row, 18).getValue());  // R — Цена для загрузки
    var currentPrice = parseFloat(sheet.getRange(row, 9).getValue());  // I — Текущая цена
    if (!productId || !targetPrice) continue;
    if (currentPrice && Math.abs(targetPrice - currentPrice) < 1) {
      sheet.getRange(row, 20).setValue('⏭ Без изменений'); // T(20)
      continue;
    }
    prices.push({ product_id: productId, price: targetPrice, row: row });
  }

  if (prices.length === 0) { showAlert('Готово', 'Нет товаров для обновления'); return; }

  var actions = getAllBoostActions();
  var inActionMap = getProductsInActions(actions);
  var boostMap = getBoostCandidates(actions);

  // Вывести из акций
  var removedCount = 0;
  for (var i = 0; i < prices.length; i++) {
    if (inActionMap[prices[i].product_id] && inActionMap[prices[i].product_id].length > 0) {
      removeFromActions(prices[i].product_id, actions);
      removedCount++;
    }
  }
  logAction('Загрузка цен', 'Вывод из акций', 'Выведено: ' + removedCount);
  Utilities.sleep(2000);

  // Загрузить цены батчами
  var totalOk = 0, totalErr = 0;
  for (var i = 0; i < prices.length; i += 100) {
    var batch = prices.slice(i, i + 100);
    var result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price.toString() }; })
    });
    if (result && !result.code) {
      totalOk += batch.length;
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 19).setValue(batch[j].price);      // S(19) — Загруженная цена
        sheet.getRange(batch[j].row, 20).setValue('✅ ' + batch[j].price + '₽'); // T(20) — Статус
      }
    } else {
      totalErr += batch.length;
      var errMsg = result ? result.message || JSON.stringify(result) : 'ошибка';
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 20).setValue('❌ ' + errMsg); // T(20)
      }
    }
    Utilities.sleep(500);
  }

  // Добавить в акции
  Utilities.sleep(3000);
  var addedCount = 0;
  for (var i = 0; i < prices.length; i++) {
    var pid = prices[i].product_id;
    var price = prices[i].price;
    if (boostMap[pid]) {
      var bi = boostMap[pid];
      for (var bi2 = 0; bi2 < bi.length; bi2++) {
        var b = bi[bi2];
        if (b.minElastic > 0 && b.maxElastic > 0 && price >= b.maxElastic && price <= b.minElastic) {
          var added = addToAction(pid, b.actionId, price);
          if (added) addedCount++;
          break;
        }
      }
    }
  }

  // Обновить U(21) — Бустинг после загрузки
  for (var i = 0; i < prices.length; i++) {
    var pid = prices[i].product_id;
    var price = prices[i].price;
    if (boostMap[pid]) {
      var bi = boostMap[pid];
      for (var bi2 = 0; bi2 < bi.length; bi2++) {
        var b = bi[bi2];
        if (b.minElastic > 0 && b.maxElastic > 0 && price >= b.maxElastic && price <= b.minElastic) {
          var boostRange = b.minElastic - b.maxElastic;
          var priceOffset = price - b.maxElastic;
          var boostPct = boostRange > 0 ? Math.round(b.minBoost + (b.maxBoost - b.minBoost) * (1 - priceOffset / boostRange)) : b.minBoost;
          sheet.getRange(prices[i].row, 21).setValue('✅ ' + boostPct + '% | в акции');
          break;
        }
      }
    }
  }

  logAction('Загрузка цен', 'ОК', 'ОК: ' + totalOk + ', Ошибок: ' + totalErr + ', Из акций: ' + removedCount + ', В акции: ' + addedCount);
  showAlert('Готово', 'Цены: ' + totalOk + '\nОшибок: ' + totalErr + '\nИз акций: ' + removedCount + '\nВ акции: ' + addedCount);
}

function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  calculatePrices();
  uploadPrices();
}

// =====================================================================
// 5. Юнит экономика
// =====================================================================
function loadUnitEconomics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Юнит экономика');
  var refSheet = ss.getSheetByName('Справочник');
  var repSheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  // 1. Собрать все товары из Репрайсера
  var repLastRow = repSheet.getLastRow();
  var repData = {};
  if (repLastRow >= 2) {
    for (var r = 2; r <= repLastRow; r++) {
      var pid = repSheet.getRange(r, 2).getValue();
      if (pid) repData[pid.toString()] = {
        offerId: repSheet.getRange(r, 3).getValue(),
        name: repSheet.getRange(r, 4).getValue(),
        price: parseFloat(repSheet.getRange(r, 9).getValue()) || 0,
        fbs: repSheet.getRange(r, 22).getValue(),
        fbo: repSheet.getRange(r, 23).getValue()
      };
    }
  }

  // 2. Собрать себестоимость и % выкупа из Справочника
  var refLastRow = refSheet.getLastRow();
  var refData = {};
  if (refLastRow >= 2) {
    for (var r = 2; r <= refLastRow; r++) {
      var pid = refSheet.getRange(r, 2).getValue();
      if (pid) refData[pid.toString()] = {
        cogs: parseFloat(refSheet.getRange(r, 11).getValue()) || 0,   // K — себестоимость
        buyback: parseFloat(refSheet.getRange(r, 12).getValue()) || 0 // L — % выкупа
      };
    }
  }

  // 3. Получить комиссии из API
  var priceMap = {};
  var cursor = '';
  while (true) {
    var result = ozonApi('/v5/product/info/prices', { filter: { visibility: 'ALL' }, cursor: cursor, limit: 100 });
    if (!result) break;
    var items = result.items || [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].product_id) priceMap[items[i].product_id] = items[i];
    }
    cursor = result.cursor || '';
    if (items.length < 100 || !cursor) break;
  }

  // 4. Сохранить ручные данные (D, P, Q, R)
  var manualData = {};
  if (lastRow >= 2) {
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      if (pid) manualData[pid.toString()] = {
        scheme: sheet.getRange(r, 4).getValue(),    // D
        adv: sheet.getRange(r, 16).getValue(),       // P
        pack: sheet.getRange(r, 17).getValue(),      // Q
        tax: sheet.getRange(r, 18).getValue()        // R
      };
    }
  }

  // 5. Очистить и записать
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 26).clearContent();

  // Собрать product_id в порядке Репрайсера
  var pids = [];
  for (var k in repData) {
    pids.push({ pid: k, offerId: repData[k].offerId });
  }
  pids.sort(function(a, b) {
    return (a.offerId || '').toLowerCase() < (b.offerId || '').toLowerCase() ? -1 : 1;
  });

  var count = 0;
  for (var i = 0; i < pids.length; i++) {
    var pid = pids[i].pid;
    var rep = repData[pid];
    if (!rep) continue;
    var row = i + 2;

    var pd = priceMap[parseInt(pid)];
    var ref = refData[pid];
    var md = manualData[pid] || {};
    var scheme = md.scheme || 'FBS';

    // Определить схему: если есть FBO остатки — FBO, иначе FBS
    if (!md.scheme) {
      scheme = (rep.fbo && rep.fbo > 0) ? 'FBO' : 'FBS';
    }

    // A: Offer ID
    sheet.getRange(row, 1).setValue(rep.offerId);
    // B: Product ID
    sheet.getRange(row, 2).setValue(parseInt(pid));
    // C: Название
    sheet.getRange(row, 3).setValue(rep.name);
    // D: Схема
    sheet.getRange(row, 4).setValue(scheme);
    // E: Цена продажи
    sheet.getRange(row, 5).setValue(rep.price);

    // F: Себестоимость из Справочника
    var cogs = ref ? ref.cogs : 0;
    sheet.getRange(row, 6).setValue(cogs);

    // K: % выкупа из Справочника
    var buyback = ref ? ref.buyback : 0;
    if (!buyback) buyback = 0.8; // по умолчанию 80%
    sheet.getRange(row, 11).setValue(buyback);

    // Данные из API комиссий
    if (pd) {
      var comm = pd.commissions || {};
      var acq = parseFloat(pd.acquiring) || 0;
      var volWeight = parseFloat(pd.volume_weight) || 0;
      var salePrice = rep.price;

      var salesPct = 0, logForward = 0, logReturn = 0, lastMile = 0, firstMile = 0;
      if (scheme === 'FBO') {
        salesPct = parseFloat(comm.sales_percent_fbo) || 0;
        logForward = parseFloat(comm.fbo_direct_flow_trans_max_amount) || 0;
        logReturn = parseFloat(comm.fbo_return_flow_amount) || 0;
        lastMile = parseFloat(comm.fbo_deliv_to_customer_amount) || 0;
        firstMile = 0;
      } else {
        salesPct = parseFloat(comm.sales_percent_fbs) || 0;
        logForward = parseFloat(comm.fbs_direct_flow_trans_max_amount) || 0;
        logReturn = parseFloat(comm.fbs_return_flow_amount) || 0;
        lastMile = parseFloat(comm.fbs_deliv_to_customer_amount) || 0;
        firstMile = parseFloat(comm.fbs_first_mile_max_amount) || 0;
      }

      // G: % комиссии
      sheet.getRange(row, 7).setValue(salesPct);
      // H: Комиссия (₽) = E * G / 100
      var commissionRub = salePrice * salesPct / 100;
      sheet.getRange(row, 8).setValue(Math.round(commissionRub * 100) / 100);
      // I: Логистика туда
      sheet.getRange(row, 9).setValue(logForward);
      // J: Логистика обратно
      sheet.getRange(row, 10).setValue(logReturn);
      // L: Расход на возвраты = J * (1 - K) / K
      var returnCost = (buyback > 0 && buyback < 1) ? logReturn * (1 - buyback) / buyback : 0;
      sheet.getRange(row, 12).setValue(Math.round(returnCost * 100) / 100);
      // M: Последняя миля
      sheet.getRange(row, 13).setValue(lastMile);
      // N: Первый километр
      sheet.getRange(row, 14).setValue(firstMile);
      // O: Эквайринг
      sheet.getRange(row, 15).setValue(acq);

      // Восстановить ручные P, Q, R
      if (md.adv) sheet.getRange(row, 16).setValue(md.adv);
      if (md.pack) sheet.getRange(row, 17).setValue(md.pack);
      if (md.tax) sheet.getRange(row, 18).setValue(md.tax);

      // S: Итого расходы Ozon = H + (I+M)/K + L + N + O
      var logWithBuyback = (buyback > 0) ? (logForward + lastMile) / buyback : (logForward + lastMile);
      var totalOzon = commissionRub + logWithBuyback + returnCost + firstMile + acq;
      sheet.getRange(row, 19).setValue(Math.round(totalOzon * 100) / 100);

      // T: Итого расходы все = S + F + P + Q + R
      var advCost = parseFloat(md.adv) || 0;
      var packCost = parseFloat(md.pack) || 0;
      var taxCost = parseFloat(md.tax) || 0;
      var totalCost = totalOzon + cogs + advCost + packCost + taxCost;
      sheet.getRange(row, 20).setValue(Math.round(totalCost * 100) / 100);

      // U: Прибыль = E - T
      var profit = salePrice - totalCost;
      sheet.getRange(row, 21).setValue(Math.round(profit * 100) / 100);

      // V: Маржинальность % = U / E * 100
      var margin = salePrice > 0 ? (profit / salePrice * 100) : 0;
      sheet.getRange(row, 22).setValue(Math.round(margin * 100) / 100);

      // W: Мин. цена (безубыток) = T
      sheet.getRange(row, 23).setValue(Math.round(totalCost * 100) / 100);

      // X: Объёмный вес
      sheet.getRange(row, 24).setValue(volWeight);
    }

    // Y: Остаток FBS
    sheet.getRange(row, 25).setValue(rep.fbs || 0);
    // Z: Остаток FBO
    sheet.getRange(row, 26).setValue(rep.fbo || 0);

    count++;
  }

  logAction('Юнит экономика', 'ОК', 'Загружено: ' + count);
  showAlert('Готово', 'Юнит экономика рассчитана: ' + count + ' артикулов');
}
