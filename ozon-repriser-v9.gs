// ===== РЕПРАЙСЕР OZON v9 =====
// v9: вывод из акций перед сменой цены, проверка и добавление после
// + сортировка по Offer ID (A→Z) при загрузке

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
  var logSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Лог');
  if (logSheet) logSheet.appendRow([new Date(), action, status, details]);
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
    .addItem('3. Цена с сайта (парсинг)', 'parseOzonSitePrices')
    .addSeparator()
    .addItem('4. Рассчитать цены (S)', 'calculatePrices')
    .addItem('5. Загрузить цены на Ozon', 'uploadPrices')
    .addSeparator()
    .addItem('📊 Полный цикл (1→2→3→4→5)', 'fullCycle')
    .addToUi();
}

// =====================================================================
// Акции: получить все акции бустинга
// =====================================================================
function getAllBoostActions() {
  var actions = [];
  try {
    var result = ozonApiGet('/v1/actions');
    if (result && result.result) {
      for (var i = 0; i < result.result.length; i++) {
        var a = result.result[i];
        var title = (a.title || '').toLowerCase();
        if (title.indexOf('эластич') !== -1 || title.indexOf('бустинг') !== -1) {
          actions.push(a);
        }
      }
    }
  } catch (e) { Logger.log('Ошибка акций: ' + e.message); }
  return actions;
}

// =====================================================================
// Акции: получить кандидатов с диапазонами цен
// Возвращает map: productId -> { actionId, minElastic, maxElastic, minBoost, maxBoost }
// =====================================================================
function getBoostCandidates(actions) {
  var boostMap = {};
  for (var ai = 0; ai < actions.length; ai++) {
    var actionId = actions[ai].id;
    try {
      var offset = 0;
      while (true) {
        var candResult = ozonApi('/v1/actions/candidates', {
          action_id: actionId.toString(), limit: 100, offset: offset
        });
        if (!candResult || !candResult.result) break;
        var products = candResult.result.products || [];
        for (var j = 0; j < products.length; j++) {
          var p = products[j];
          if (!boostMap[p.id]) {
            boostMap[p.id] = [];
          }
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
    } catch (e) { Logger.log('Ошибка кандидатов: ' + e.message); }
  }
  return boostMap;
}

// =====================================================================
// Акции: получить товары уже в акциях
// Возвращает map: productId -> [actionId, ...]
// =====================================================================
function getProductsInActions(actions) {
  var inActionMap = {};
  for (var ai = 0; ai < actions.length; ai++) {
    var actionId = actions[ai].id;
    try {
      var offset = 0;
      while (true) {
        var result = ozonApi('/v1/actions/products', {
          action_id: actionId.toString(), limit: 100, offset: offset
        });
        if (!result || !result.result) break;
        var products = result.result.products || [];
        for (var j = 0; j < products.length; j++) {
          var pid = products[j].id || products[j].product_id;
          if (!inActionMap[pid]) inActionMap[pid] = [];
          inActionMap[pid].push(actionId);
        }
        if (products.length < 100) break;
        offset += 100;
        Utilities.sleep(300);
      }
    } catch (e) {}
  }
  return inActionMap;
}

// =====================================================================
// Акции: удалить товар из всех акций
// =====================================================================
function removeFromActions(productId, actions) {
  for (var i = 0; i < actions.length; i++) {
    try {
      ozonApi('/v1/actions/products/deactivate', {
        action_id: actions[i].id,
        product_ids: [productId]
      });
    } catch (e) {}
  }
}

// =====================================================================
// Акции: добавить товар в акцию с ценой
// =====================================================================
function addToAction(productId, actionId, actionPrice) {
  try {
    var result = ozonApi('/v1/actions/products/activate', {
      action_id: actionId,
      products: [{ product_id: productId, action_price: actionPrice }]
    });
    return result && result.result && result.result.product_ids &&
           result.result.product_ids.indexOf(productId) !== -1;
  } catch (e) {
    Logger.log('Ошибка добавления в акцию: ' + e.message);
    return false;
  }
}

// =====================================================================
// 1. Загрузить товары (с сортировкой A→Z по Offer ID)
// =====================================================================
function loadOzonProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  Logger.log('=== Загрузка товаров ===');
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
  Logger.log('Отсортировано по Offer ID: ' + allItems.length + ' товаров');

  // Сохранить ручные данные
  var userData = {};
  if (lastRow >= 2) {
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      if (pid) userData[pid.toString()] = {
        rrc: sheet.getRange(r, 7).getValue(),
        minP: sheet.getRange(r, 8).getValue(),
        wallet: sheet.getRange(r, 12).getValue(),
        model: sheet.getRange(r, 17).getValue(),
        margin: sheet.getRange(row, 18).getValue()
      };
    }
  }

  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 22).clearContent();

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

  var success = 0, errors = 0;
  for (var i = 0; i < allItems.length; i++) {
    try {
      var item = allItems[i];
      var productId = item.product_id;
      var offerId = item.offer_id || '';
      var name = '';
      try {
        var detail = ozonApi('/v1/product/info/description', { product_id: productId });
        if (detail && detail.result) name = detail.result.name || '';
      } catch (e) {}

      var row = i + 2;
      if (photoMap[productId]) sheet.getRange(row, 1).setFormula('=IMAGE("' + photoMap[productId] + '")');
      sheet.getRange(row, 2).setValue(productId);
      sheet.getRange(row, 3).setValue(offerId);
      sheet.getRange(row, 4).setValue(name);

      var saved = userData[productId.toString()];
      if (saved) {
        if (saved.rrc) sheet.getRange(row, 7).setValue(saved.rrc);
        if (saved.minP) sheet.getRange(row, 8).setValue(saved.minP);
        if (saved.wallet) sheet.getRange(row, 12).setValue(saved.wallet);
        if (saved.model) sheet.getRange(row, 17).setValue(saved.model);
        if (saved.margin) sheet.getRange(row, 18).setValue(saved.margin);
      }
      success++;
      if (i % 5 === 4) Utilities.sleep(1000);
    } catch (e) { errors++; }
  }
  logAction('Загрузка товаров', 'ОК', 'ОК: ' + success + ', отсортировано по Offer ID');
  showAlert('Готово', 'Загружено: ' + success + '\nОтсортировано A→Z по Offer ID\nОшибок: ' + errors);
}

// =====================================================================
// 2. Цены + индекс (API)
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

  var sPrice = 0, sIndex = 0;
  for (var row = 2; row <= lastRow; row++) {
    var pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;
    var pd = priceMap[pid];
    if (!pd) continue;

    sheet.getRange(row, 9).setValue(pd.price.price || '');
    sPrice++;

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

    if (idxValue !== 0) sheet.getRange(row, 15).setValue(idxValue);
    if (colorIdx) sheet.getRange(row, 16).setValue(colorIndexText(colorIdx));
    if (idxValue !== 0 && minCompPrice !== 0) {
      var wp = calcBuyerPrice(idxValue, minCompPrice);
      if (wp) { sheet.getRange(row, 13).setValue(wp); sIndex++; }
    }
  }
  logAction('Цены + индекс', 'ОК', 'Цен: ' + sPrice + ', Кошелёк: ' + sIndex);
  showAlert('Готово', 'Цен: ' + sPrice + '\nС кошельком: ' + sIndex);
}

// =====================================================================
// 3. Цена с сайта (парсинг)
// =====================================================================
function parseOzonSitePrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;

  var success = 0, errors = 0;
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    if (!productId) continue;
    var sitePrice = null, siteDiscount = null;
    try { var r1 = fetchEntrypointPrice(productId); if (r1 && r1.price) { sitePrice = r1.price; siteDiscount = r1.discount; } } catch (e) {}
    if (!sitePrice) { try { var r2 = fetchMobilePrice(productId); if (r2 && r2.price) { sitePrice = r2.price; siteDiscount = r2.discount; } } catch (e) {} }
    if (!sitePrice) { try { var r3 = fetchGraphQLPrice(productId); if (r3 && r3.price) { sitePrice = r3.price; siteDiscount = r3.discount; } } catch (e) {} }
    if (sitePrice && sitePrice > 0) {
      sheet.getRange(row, 10).setValue(sitePrice);
      if (siteDiscount !== null) sheet.getRange(row, 14).setValue(siteDiscount);
      else {
        var sp = parseFloat(sheet.getRange(row, 9).getValue());
        if (sp && sp > sitePrice) sheet.getRange(row, 14).setValue(Math.round((1 - sitePrice / sp) * 100));
      }
      success++;
    } else { errors++; }
    Utilities.sleep(2000);
  }
  logAction('Парсинг сайта', 'ОК', 'Успешно: ' + success + ', Ошибок: ' + errors);
  showAlert('Готово', 'Успешно: ' + success + '\nОшибок: ' + errors);
}

function fetchEntrypointPrice(productId) {
  var url = 'https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=/product/-/' + productId + '/&layout_page_id=&page_changed=true';
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json', 'X-O3-Region-Id': '1' },
    muteHttpExceptions: true, followRedirects: true
  });
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());
  if (!json || !json.widgetStates) return null;
  for (var key in json.widgetStates) {
    try {
      var w = JSON.parse(json.widgetStates[key]);
      if (w.price !== undefined && typeof w.price === 'number' && w.price > 0) return { price: w.price, discount: w.discount || null };
      if (w.cellTrackingData && w.cellTrackingData.finalPrice) return { price: parseInt(w.cellTrackingData.finalPrice), discount: w.cellTrackingData.discount || null };
      if (w.mainState && w.mainState.price) return { price: typeof w.mainState.price === 'number' ? w.mainState.price : parseInt(w.mainState.price), discount: w.mainState.discount || null };
    } catch (e) {}
  }
  var pm = JSON.stringify(json).match(/"(?:price|finalPrice)"\s*:\s*(\d{2,6})/);
  if (pm) return { price: parseInt(pm[1]), discount: null };
  return null;
}

function fetchMobilePrice(productId) {
  var skuResult = ozonApi('/v3/product/info/list', { product_id: [productId], offer_id: [], sku: [] });
  var sku = null;
  if (skuResult && skuResult.result && skuResult.result.items && skuResult.result.items.length > 0) sku = skuResult.result.items[0].sku;
  if (!sku) return null;
  var response = UrlFetchApp.fetch('https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=/product/-/' + sku + '/&layout_page_id=&page_changed=true', {
    method: 'get',
    headers: { 'User-Agent': 'Ozon/4.0 (Android 14; Phone)', 'Accept': 'application/json', 'X-O3-Region-Id': '1', 'X-O3-Device-Type': 'mobile' },
    muteHttpExceptions: true, followRedirects: true
  });
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());
  if (json && json.widgetStates) {
    for (var key in json.widgetStates) {
      try {
        var w = JSON.parse(json.widgetStates[key]);
        if (w.price !== undefined && typeof w.price === 'number' && w.price > 0) return { price: w.price, discount: w.discount || null };
        if (w.cellTrackingData && w.cellTrackingData.finalPrice) return { price: parseInt(w.cellTrackingData.finalPrice), discount: w.cellTrackingData.discount || null };
      } catch (e) {}
    }
  }
  return null;
}

function fetchGraphQLPrice(productId) {
  var skuResult = ozonApi('/v3/product/info/list', { product_id: [productId], offer_id: [], sku: [] });
  var sku = null;
  if (skuResult && skuResult.result && skuResult.result.items && skuResult.result.items.length > 0) sku = skuResult.result.items[0].sku;
  if (!sku) return null;
  var response = UrlFetchApp.fetch('https://www.ozon.ru/api/composer-api.bx/_graphql', {
    method: 'post', contentType: 'application/json',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-O3-Region-Id': '1' },
    payload: JSON.stringify({ query: 'query SearchProduct($slug: String!) { searchProduct(slug: $slug) { items { id sku price { price discount cardPrice } } } }', variables: { slug: sku.toString() } }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());
  if (json && json.data && json.data.searchProduct && json.data.searchProduct.items) {
    for (var i = 0; i < json.data.searchProduct.items.length; i++) {
      if (json.data.searchProduct.items[i].sku == sku && json.data.searchProduct.items[i].price)
        return { price: json.data.searchProduct.items[i].price.price, discount: json.data.searchProduct.items[i].price.discount || null };
    }
  }
  return null;
}

// =====================================================================
// 4. Рассчитать цены (S) + проверка бустинга
// =====================================================================
function calculatePrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Расчёт цен + бустинг ===');

  var actions = getAllBoostActions();
  Logger.log('Акций бустинга: ' + actions.length);

  var boostMap = getBoostCandidates(actions);
  Logger.log('Товаров в кандидатах: ' + Object.keys(boostMap).length);

  var updated = 0;
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var rrc = parseFloat(sheet.getRange(row, 7).getValue());
    var minPrice = parseFloat(sheet.getRange(row, 8).getValue());
    var sellerPrice = parseFloat(sheet.getRange(row, 9).getValue());
    var walletPct = parseFloat(sheet.getRange(row, 12).getValue());
    var walletCalcPrice = parseFloat(sheet.getRange(row, 13).getValue());

    if (!sellerPrice && !rrc) continue;

    // K (11) — СПП %
    var sppPct = 0;
    if (walletCalcPrice && walletPct) {
      sppPct = walletCalcPrice * (1 - walletPct);
      sheet.getRange(row, 11).setValue(Math.round(sppPct * 100) / 100);
    } else if (walletCalcPrice) {
      sppPct = walletCalcPrice;
      sheet.getRange(row, 11).setValue(Math.round(sppPct * 100) / 100);
    }

    // S (19) — Цена для загрузки
    var basePrice = rrc || sellerPrice;
    var targetPrice = basePrice;
    if (sppPct && sppPct > 0 && sppPct < 1 && walletPct && walletPct > 0 && walletPct < 1) {
      targetPrice = targetPrice / (1 - sppPct) / (1 - walletPct);
    } else if (sppPct && sppPct > 0 && sppPct < 1) {
      targetPrice = targetPrice / (1 - sppPct);
    }
    targetPrice = Math.round(targetPrice);
    if (minPrice && targetPrice < minPrice) targetPrice = minPrice;
    sheet.getRange(row, 19).setValue(targetPrice);

    // V (22) — Проверка бустинга
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
        sheet.getRange(row, 22).setValue('✅ ' + bestBoost.boostPct + '% | ' + bi.length + ' акц.');
      } else {
        // Не попали — показать диапазон лучшей акции
        var best = bi[0];
        for (var bi3 = 1; bi3 < bi.length; bi3++) {
          if (bi[bi3].maxElastic > best.maxElastic) best = bi[bi3];
        }
        if (targetPrice > best.minElastic) {
          sheet.getRange(row, 22).setValue('❌ Выше (' + best.maxElastic + '-' + best.minElastic + ') | ' + bi.length + ' акц.');
        } else if (best.maxElastic > 0 && targetPrice < best.maxElastic) {
          sheet.getRange(row, 22).setValue('⚠️ Ниже (' + best.maxElastic + '-' + best.minElastic + ') | ' + bi.length + ' акц.');
        } else {
          sheet.getRange(row, 22).setValue('❌ Не попал | ' + bi.length + ' акц.');
        }
      }
    } else {
      sheet.getRange(row, 22).setValue('—');
    }
    updated++;
  }
  logAction('Расчёт цен', 'ОК', 'Рассчитано: ' + updated);
  showAlert('Готово', 'Рассчитано: ' + updated + '\nАкций бустинга: ' + actions.length);
}

// =====================================================================
// 5. Загрузить цены на Ozon
// Порядок: вывести из акций → загрузить цену → проверить и добавить в акции
// =====================================================================
function uploadPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Загрузка цен (с акциями) ===');

  // Собрать товары для обновления
  var prices = [];
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var targetPrice = parseFloat(sheet.getRange(row, 19).getValue()); // S
    var currentPrice = parseFloat(sheet.getRange(row, 9).getValue()); // I
    if (!productId || !targetPrice) continue;
    if (currentPrice && Math.abs(targetPrice - currentPrice) < 1) {
      sheet.getRange(row, 21).setValue('⏭ Без изменений');
      continue;
    }
    prices.push({ product_id: productId, price: targetPrice, row: row });
  }

  if (prices.length === 0) { showAlert('Готово', 'Нет товаров для обновления'); return; }

  // Шаг 1: Получить акции и товары в них
  var actions = getAllBoostActions();
  var inActionMap = getProductsInActions(actions);
  var boostMap = getBoostCandidates(actions);

  // Шаг 2: Вывести из акций товары, которые будут обновлены
  var removedCount = 0;
  for (var i = 0; i < prices.length; i++) {
    var pid = prices[i].product_id;
    if (inActionMap[pid] && inActionMap[pid].length > 0) {
      removeFromActions(pid, actions);
      removedCount++;
    }
  }
  Logger.log('Выведено из акций: ' + removedCount);
  Utilities.sleep(2000); // Пауза чтобы Ozon обработал

  // Шаг 3: Загрузить цены батчами
  var totalOk = 0, totalErr = 0;
  for (var i = 0; i < prices.length; i += 100) {
    var batch = prices.slice(i, i + 100);
    var result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price.toString() }; })
    });
    if (result && !result.code) {
      totalOk += batch.length;
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 20).setValue(batch[j].price); // T
        sheet.getRange(batch[j].row, 21).setValue('✅ ' + batch[j].price + '₽'); // U
      }
    } else {
      totalErr += batch.length;
      var errMsg = result ? result.message || JSON.stringify(result) : 'ошибка';
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 21).setValue('❌ ' + errMsg);
      }
    }
    Utilities.sleep(500);
  }
  Logger.log('Цен загружено: ' + totalOk);

  // Шаг 4: Проверить попадание в акции и добавить
  Utilities.sleep(3000); // Пауза чтобы цена применилась
  var addedCount = 0;
  for (var i = 0; i < prices.length; i++) {
    var pid = prices[i].product_id;
    var price = prices[i].price;
    if (boostMap[pid]) {
      var bi = boostMap[pid];
      for (var bi2 = 0; bi2 < bi.length; bi2++) {
        var b = bi[bi2];
        // Диапазон: [maxElastic .. minElastic]
        if (b.minElastic > 0 && b.maxElastic > 0 && price >= b.maxElastic && price <= b.minElastic) {
          var added = addToAction(pid, b.actionId, price);
          if (added) addedCount++;
          break; // Добавляем в первую подходящую
        }
      }
    }
  }
  Logger.log('Добавлено в акции: ' + addedCount);

  // Шаг 5: Обновить колонку V
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
          sheet.getRange(prices[i].row, 22).setValue('✅ ' + boostPct + '% | в акции');
          break;
        }
      }
    }
  }

  logAction('Загрузка цен', 'ОК', 'ОК: ' + totalOk + ', Ошибок: ' + totalErr + ', Из акций: ' + removedCount + ', В акции: ' + addedCount);
  showAlert('Готово',
    'Цены: ' + totalOk + '\nОшибок: ' + totalErr +
    '\nИз акций выведено: ' + removedCount + '\nВ акции добавлено: ' + addedCount);
}

function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  parseOzonSitePrices();
  calculatePrices();
  uploadPrices();
}
