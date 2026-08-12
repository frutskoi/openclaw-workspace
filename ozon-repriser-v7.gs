// ===== РЕПРАЙСЕР OZON v7 =====
// 22 колонки A-V, без разделителей
// S = цена для загрузки (G / (1-K) или G / (1-K) / (1-L))
// K = СПП % = M*(1-L), L = Кошелек % (вручную)

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
  if (!config.clientId || !config.apiKey) throw new Error('Заполните Client ID и API Key в "Настройки"');
  var response = UrlFetchApp.fetch(config.baseUrl + endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'Client-Id': config.clientId, 'Api-Key': config.apiKey },
    payload: JSON.stringify(body),
    muteHttpExceptions: true
  });
  return JSON.parse(response.getContentText());
}

function ozonApiGet(endpoint) {
  var config = getConfig();
  if (!config.clientId || !config.apiKey) throw new Error('Заполните Client ID и API Key в "Настройки"');
  var response = UrlFetchApp.fetch(config.baseUrl + endpoint, {
    method: 'get',
    contentType: 'application/json',
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
  var result;
  if (idx < 1) result = idx * minP;
  else if (idx > 1) result = minP / (2 - idx);
  else result = minP;
  return Math.round(result);
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
    .addItem('📊 Полный цикл (1→2→3→4)', 'fullCycle')
    .addToUi();
}

// =====================================================================
// 1. Загрузить товары
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
    if (!result || !result.result) {
      showAlert('Ошибка', result ? JSON.stringify(result) : 'Пустой ответ');
      return;
    }
    var items = result.result.items || [];
    allItems = allItems.concat(items);
    lastId = result.result.last_id;
    if (items.length < 100) break;
  }
  Logger.log('Товаров: ' + allItems.length);
  if (allItems.length === 0) { showAlert('Внимание', 'Товары не найдены'); return; }

  // Сохранить ручные данные (G=РРЦ, H=Мин.цена, L=Кошелек%, Q=Модель, R=Маржинальность)
  var userData = {};
  if (lastRow >= 2) {
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      if (pid) {
        userData[pid.toString()] = {
          rrc: sheet.getRange(r, 7).getValue(),     // G
          minP: sheet.getRange(r, 8).getValue(),     // H
          wallet: sheet.getRange(r, 12).getValue(),  // L
          model: sheet.getRange(r, 17).getValue(),   // Q
          margin: sheet.getRange(r, 18).getValue()   // R
        };
      }
    }
  }

  // Очистить (22 колонки)
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
  } catch (e) { Logger.log('Фото ошибка: ' + e.message); }

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

      // Восстановить ручные данные
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
  logAction('Загрузка товаров', 'ОК', 'Всего: ' + allItems.length + ', ОК: ' + success);
  showAlert('Готово', 'Загружено: ' + success + '\nОшибок: ' + errors);
}

// =====================================================================
// 2. Цены + индекс (API)
// Заполняет: I (цена продавца), M (цена с кошельком), O (индекс), P (цвет)
// =====================================================================
function getOzonPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Сначала загрузите товары'); return; }

  Logger.log('=== Цены + индекс API ===');

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
  Logger.log('Записей: ' + Object.keys(priceMap).length);

  var sPrice = 0, sIndex = 0, notFound = 0;

  for (var row = 2; row <= lastRow; row++) {
    var pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;
    var pd = priceMap[pid];
    if (!pd) { notFound++; continue; }

    var pi = pd.price || {};

    // I (9) — Цена продавца
    sheet.getRange(row, 9).setValue(pi.price || '');
    sPrice++;

    // Индекс цен
    var pIdx = pd.price_indexes || {};
    var ozonIdx = pIdx.ozon_index_data || {};
    var extIdx = pIdx.external_index_data || {};
    var selfIdx = pIdx.self_marketplaces_index_data || {};
    var colorIdx = pIdx.color_index || '';

    var idxValue = 0, minCompPrice = 0;
    if (ozonIdx.price_index_value && ozonIdx.price_index_value !== 0 && ozonIdx.min_price) {
      idxValue = parseFloat(ozonIdx.price_index_value);
      minCompPrice = parseFloat(ozonIdx.min_price);
    } else if (extIdx.price_index_value && extIdx.price_index_value !== 0 && extIdx.min_price) {
      idxValue = parseFloat(extIdx.price_index_value);
      minCompPrice = parseFloat(extIdx.min_price);
    } else if (selfIdx.price_index_value && selfIdx.price_index_value !== 0 && selfIdx.min_price) {
      idxValue = parseFloat(selfIdx.price_index_value);
      minCompPrice = parseFloat(selfIdx.min_price);
    }

    // O (15) — Индекс цен (цифра)
    if (idxValue !== 0) sheet.getRange(row, 15).setValue(idxValue);

    // P (16) — Цвет индекса
    if (colorIdx) sheet.getRange(row, 16).setValue(colorIndexText(colorIdx));

    // M (13) — Цена с кошельком (расчёт из индекса)
    if (idxValue !== 0 && minCompPrice !== 0) {
      var walletPrice = calcBuyerPrice(idxValue, minCompPrice);
      if (walletPrice) { sheet.getRange(row, 13).setValue(walletPrice); sIndex++; }
    }
  }

  logAction('Цены + индекс', 'ОК', 'Цен: ' + sPrice + ', Кошелёк: ' + sIndex + ', Не найдено: ' + notFound);
  showAlert('Готово', 'Цен: ' + sPrice + '\nС кошельком: ' + sIndex + '\nНе найдено: ' + notFound);
}

// =====================================================================
// 3. Цена с сайта (парсинг, 3 метода)
// Заполняет: J (цена с сайта), N (скидка %)
// =====================================================================
function parseOzonSitePrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Сначала загрузите товары'); return; }

  Logger.log('=== Парсинг цен с сайта ===');
  var success = 0, errors = 0;

  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    if (!productId) continue;

    var sitePrice = null, siteDiscount = null;

    // Метод 1: entrypoint-api
    try {
      var r1 = fetchEntrypointPrice(productId);
      if (r1 && r1.price) { sitePrice = r1.price; siteDiscount = r1.discount || null; }
    } catch (e) {}

    // Метод 2: mobile API
    if (!sitePrice) {
      try {
        var r2 = fetchMobilePrice(productId);
        if (r2 && r2.price) { sitePrice = r2.price; siteDiscount = r2.discount || null; }
      } catch (e) {}
    }

    // Метод 3: GraphQL
    if (!sitePrice) {
      try {
        var r3 = fetchGraphQLPrice(productId);
        if (r3 && r3.price) { sitePrice = r3.price; siteDiscount = r3.discount || null; }
      } catch (e) {}
    }

    if (sitePrice && sitePrice > 0) {
      sheet.getRange(row, 10).setValue(sitePrice); // J
      if (siteDiscount !== null) {
        sheet.getRange(row, 14).setValue(siteDiscount); // N
      } else {
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
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      'Accept': 'application/json',
      'Accept-Language': 'ru-RU,ru;q=0.9',
      'X-O3-Region-Id': '1'
    },
    muteHttpExceptions: true, followRedirects: true
  });
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());
  if (!json || !json.widgetStates) return null;
  var ws = json.widgetStates;
  for (var key in ws) {
    try {
      var w = JSON.parse(ws[key]);
      if (w.price !== undefined && typeof w.price === 'number' && w.price > 0) return { price: w.price, discount: w.discount || null };
      if (w.cellTrackingData && w.cellTrackingData.finalPrice) return { price: parseInt(w.cellTrackingData.finalPrice), discount: w.cellTrackingData.discount || null };
      if (w.mainState && w.mainState.price) return { price: typeof w.mainState.price === 'number' ? w.mainState.price : parseInt(w.mainState.price), discount: w.mainState.discount || null };
    } catch (e) {}
  }
  var fullStr = JSON.stringify(json);
  var pm = fullStr.match(/"(?:price|finalPrice)"\s*:\s*(\d{2,6})/);
  if (pm) return { price: parseInt(pm[1]), discount: null };
  return null;
}

function fetchMobilePrice(productId) {
  var skuResult = ozonApi('/v3/product/info/list', { product_id: [productId], offer_id: [], sku: [] });
  var sku = null;
  if (skuResult && skuResult.result && skuResult.result.items && skuResult.result.items.length > 0) sku = skuResult.result.items[0].sku;
  if (!sku) return null;

  var url = 'https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=/product/-/' + sku + '/&layout_page_id=&page_changed=true';
  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: { 'User-Agent': 'Ozon/4.0 (Android 14; Phone)', 'Accept': 'application/json', 'Accept-Language': 'ru-RU', 'X-O3-Region-Id': '1', 'X-O3-Device-Type': 'mobile' },
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
    method: 'post',
    contentType: 'application/json',
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json', 'X-O3-Region-Id': '1' },
    payload: JSON.stringify({
      query: 'query SearchProduct($slug: String!) { searchProduct(slug: $slug) { items { id sku price { price discount cardPrice } } } }',
      variables: { slug: sku.toString() }
    }),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) return null;
  var json = JSON.parse(response.getContentText());
  if (json && json.data && json.data.searchProduct && json.data.searchProduct.items) {
    for (var i = 0; i < json.data.searchProduct.items.length; i++) {
      if (json.data.searchProduct.items[i].sku == sku && json.data.searchProduct.items[i].price) {
        return { price: json.data.searchProduct.items[i].price.price, discount: json.data.searchProduct.items[i].price.discount || null };
      }
    }
  }
  return null;
}

// =====================================================================
// Бустинг
// =====================================================================
function getElasticBoostActions() {
  try {
    var result = ozonApiGet('/v1/actions');
    if (!result || !result.result) return [];
    var actions = result.result.actions || result.result || [];
    var boost = [];
    for (var i = 0; i < actions.length; i++) {
      var a = actions[i];
      var t = (a.title || '').toLowerCase();
      var d = (a.description || '').toLowerCase();
      if (t.indexOf('эластич') !== -1 || d.indexOf('эластич') !== -1 || t.indexOf('бустинг') !== -1) boost.push(a);
    }
    Logger.log('Акций бустинга: ' + boost.length);
    return boost;
  } catch (e) { return []; }
}

function checkProductBoostInfo(productId, price, boostActions) {
  var inBoost = false, actionCount = 0;
  for (var i = 0; i < boostActions.length; i++) {
    try {
      var actionId = boostActions[i].action_id || boostActions[i].id;
      var result = ozonApi('/v1/actions/candidates', { action_id: actionId.toString(), limit: 100, offset: 0 });
      if (!result || !result.result) continue;
      var candidates = result.result.candidates || result.result.products || [];
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].product_id == productId) {
          actionCount++;
          if (!candidates[j].price || parseFloat(candidates[j].price) <= price) inBoost = true;
        }
      }
    } catch (e) {}
  }
  return { inBoost: inBoost, actionCount: actionCount };
}

// =====================================================================
// 4. Рассчитать цены (S)
// K (СПП%) = M * (1 - L)
// S = G / (1 - K)           — без кошелька
// S = G / (1 - K) / (1 - L) — с кошельком
// =====================================================================
function calculatePrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Расчёт цен ===');

  var boostActions = [];
  try { boostActions = getElasticBoostActions(); } catch (e) {}

  var updated = 0;

  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var rrc = parseFloat(sheet.getRange(row, 7).getValue());          // G — РРЦ
    var minPrice = parseFloat(sheet.getRange(row, 8).getValue());     // H — Мин. цена
    var sellerPrice = parseFloat(sheet.getRange(row, 9).getValue());  // I — Цена продавца
    var walletPct = parseFloat(sheet.getRange(row, 12).getValue());   // L — Кошелек %
    var walletCalcPrice = parseFloat(sheet.getRange(row, 13).getValue()); // M — Цена с кошельком

    if (!sellerPrice && !rrc) continue;

    // === K (11) — СПП % = M * (1 - L) ===
    var sppPct = 0;
    if (walletCalcPrice && walletPct) {
      sppPct = walletCalcPrice * (1 - walletPct);
      sheet.getRange(row, 11).setValue(Math.round(sppPct * 100) / 100);
    } else if (walletCalcPrice) {
      sppPct = walletCalcPrice;
      sheet.getRange(row, 11).setValue(Math.round(sppPct * 100) / 100);
    }

    // === S (19) — Цена для загрузки ===
    var basePrice = rrc || sellerPrice; // G если задана, иначе I
    var targetPrice = basePrice;

    // Не ниже минимальной
    if (minPrice && targetPrice < minPrice) targetPrice = minPrice;

    // Расчёт по модели удержания
    // Если есть СПП% и кошелек% — полная формула
    if (sppPct && sppPct > 0 && sppPct < 1 && walletPct && walletPct > 0 && walletPct < 1) {
      // С кошельком: S = G / (1 - K) / (1 - L)
      targetPrice = targetPrice / (1 - sppPct) / (1 - walletPct);
    } else if (sppPct && sppPct > 0 && sppPct < 1) {
      // Без кошелька: S = G / (1 - K)
      targetPrice = targetPrice / (1 - sppPct);
    }
    // Если СПП% нет или >= 1 — просто basePrice (без корректировки)

    targetPrice = Math.round(targetPrice);

    // Не ниже минимальной (повторно после расчёта)
    if (minPrice && targetPrice < minPrice) targetPrice = minPrice;

    sheet.getRange(row, 19).setValue(targetPrice); // S

    // V (22) — Бустинг + акции
    if (productId && boostActions.length > 0) {
      try {
        var bi = checkProductBoostInfo(productId, targetPrice, boostActions);
        sheet.getRange(row, 22).setValue((bi.inBoost ? '✅' : '❌') + ' ' + bi.actionCount + ' акц.');
      } catch (e) {
        sheet.getRange(row, 22).setValue('❌ Ошибка');
      }
    } else {
      sheet.getRange(row, 22).setValue('—');
    }

    updated++;
  }

  logAction('Расчёт цен', 'ОК', 'Обновлено: ' + updated);
  showAlert('Готово', 'Рассчитано: ' + updated + '\nАкций бустинга: ' + boostActions.length);
}

// =====================================================================
// 5. Загрузить цены на Ozon
// =====================================================================
function uploadPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Загрузка цен ===');

  var prices = [];
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var targetPrice = parseFloat(sheet.getRange(row, 19).getValue()); // S
    var currentPrice = parseFloat(sheet.getRange(row, 9).getValue()); // I
    if (!productId || !targetPrice) continue;

    if (currentPrice && Math.abs(targetPrice - currentPrice) < 1) {
      sheet.getRange(row, 21).setValue('⏭ Без изменений'); // U
      continue;
    }
    prices.push({ product_id: productId, price: targetPrice.toString(), row: row });
  }

  if (prices.length === 0) { showAlert('Готово', 'Нет товаров для обновления'); return; }

  var totalOk = 0, totalErr = 0;
  for (var i = 0; i < prices.length; i += 100) {
    var batch = prices.slice(i, i + 100);
    var result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price }; })
    });
    if (result && !result.code) {
      totalOk += batch.length;
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 20).setValue(batch[j].price);  // T — загруженная цена
        sheet.getRange(batch[j].row, 21).setValue('✅ ' + batch[j].price + '₽'); // U
      }
    } else {
      totalErr += batch.length;
      var errMsg = result ? result.message || JSON.stringify(result) : 'ошибка';
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 21).setValue('❌ ' + errMsg); // U
      }
    }
    Utilities.sleep(500);
  }

  logAction('Загрузка цен', 'ОК', 'Успешно: ' + totalOk + ', Ошибок: ' + totalErr);
  showAlert('Готово', 'Успешно: ' + totalOk + '\nОшибок: ' + totalErr);
}

// Полный цикл
function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  parseOzonSitePrices();
  calculatePrices();
}
