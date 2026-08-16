// ===== РЕПРАЙСЕР OZON v12.1 =====
// v12.1: цена покупателя считается из индекса по всем трём базам конкурентов
//        (ozon / external / self_marketplaces) с выбором минимума, плюс резервный
//        источник индекса /v3/product/info/list, если в /v5 индекс пустой.
//        Прямой цены покупателя в Seller API больше нет: Ozon убрал marketing_price
//        12.11.2025, поэтому реконструкция из индекса — единственный путь в рамках API.
// Правки относительно v11:
//  1) uploadPrices: разбор ответа Ozon по каждому товару (updated/errors) —
//     статус ✅ ставится только если цена реально применилась.
//  2) Юнит экономика: безубыток Y приведён к долям СПП (V/(1+spp)),
//     баллы Ozon оставлены как доход (T = E*spp), СПП берётся из «Репрайсера».
//  3) Порог обновления берётся из «Настройки!B7» (а не зашитый 1 ₽).
//  4) calcBuyerPrice: защита от деления на 0/отрицательного при индексе ≥ 2.
//  5) Кошелёк %: нормализация (8 → 0.08) и защита от некорректных значений.
//  6) Пустая «Модель удержания» = «Без кошелька» (без лишнего множителя).
//  7) Пакетное чтение/запись диапазонов (getValues/setValues) — быстрее, без таймаутов.
//  8) loadOzonProducts больше не грузит остатки дважды.
//  9) Индекс без данных пишется пустым (а не 1), цвет = «⚪ Без индекса».
// 10) Комментарии приведены в соответствие с кодом.
// 11) СПП(J) больше не «восстанавливается» как ручные данные (он расчётный).
// 12) getConfig: ключи можно хранить в Script Properties (Файл → Свойства проекта →
//     Свойства скрипта: OZON_CLIENT_ID / OZON_API_KEY); лист «Настройки» — резерв.
//
// Столбцы листа «Репрайсер»:
// A Фото, B Product ID, C Offer ID, D Название, E Бренд, F Рейтинг,
// G РРЦ, H Мин.цена, I Цена продавца(API), J СПП%, K Кошелек%,
// L Цена с кошельком, M Цена без кошелька, N Индекс цен, O Цвет индекса,
// P Модель удержания, Q Маржинальность, R Цена для загрузки,
// S Загруженная цена, T Статус загрузки, U Бустинг+акции, V Остаток FBS, W Остаток FBO
//
// Расчёты:
// M (без кошелька) = L / (1 - K)
// J (СПП%)         = (I - M) / I
// R (для загрузки) = G / (1 - J) / (1 - K)  если P = «С кошельком»
// R               = G / (1 - J)            если P = «Без кошелька»

var UPLOAD_COUNTER_KEY = 'repricer_upload_count';

// =====================================================================
// Конфиг / API
// =====================================================================
function getConfig() {
  var clientId = '', apiKey = '';
  try {
    var props = PropertiesService.getScriptProperties();
    clientId = (props.getProperty('OZON_CLIENT_ID') || '').toString().trim();
    apiKey = (props.getProperty('OZON_API_KEY') || '').toString().trim();
  } catch (e) {}

  if (!clientId || !apiKey) {
    var settings = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Настройки');
    if (settings) {
      if (!clientId) clientId = settings.getRange('B3').getValue().toString().trim();
      if (!apiKey) apiKey = settings.getRange('C3').getValue().toString().trim();
    }
  }
  return { clientId: clientId, apiKey: apiKey, baseUrl: 'https://api-seller.ozon.ru' };
}

// Минимальная разница цены (₽), при которой делаем перезагрузку. «Настройки!B7».
function getUpdateThreshold() {
  try {
    var s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Настройки');
    var v = parseFloat(s.getRange('B7').getValue());
    if (!isNaN(v) && v > 0) return v;
  } catch (e) {}
  return 1;
}

// Нормализация дробного процента: 0.08 → 0.08, 8 → 0.08, мусор → 0.
function normFraction(v) {
  var x = parseFloat(v);
  if (isNaN(x) || x <= 0) return 0;
  if (x >= 1) x = x / 100;   // ввели «8» вместо «0.08»
  if (x >= 1) return 0;      // всё ещё некорректно
  return x;
}

// Средний валидный СПП из колонки J, только по строкам ГДЕ ЕСТЬ индекс цен (реальные данные).
// Используется как fallback для товаров без индекса: в J всегда пишется средний СПП.
// rowsIdx — индекс колонки N (price index) в массиве vals (col N = idx 12 при чтении с B).
function avgSppFromRows(rows, sppIdx, idxCol) {
  var sum = 0, cnt = 0;
  if (!rows) return 0;
  for (var i = 0; i < rows.length; i++) {
    // Только строки с валидным индексом цен
    if (idxCol !== undefined) {
      var pIdx = parseFloat(rows[i][idxCol]);
      if (!(pIdx > 0)) continue;
    }
    var spp = normFraction(rows[i][sppIdx]);
    if (spp > 0 && spp <= 0.95) { sum += spp; cnt++; } // >0.95 = мусор, не учитываем
  }
  return cnt > 0 ? sum / cnt : 0;
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

// Восстановление цены покупателя из индекса цен и мин. цены конкурента.
function calcBuyerPrice(priceIndexValue, minCompetitorPrice) {
  if (!priceIndexValue || !minCompetitorPrice || priceIndexValue === 0 || minCompetitorPrice === 0) return null;
  var idx = parseFloat(priceIndexValue);
  var minP = parseFloat(minCompetitorPrice);
  if (idx < 1) return Math.round(idx * minP);
  if (idx > 1) {
    var denom = 2 - idx;
    if (denom > 0) return Math.round(minP / denom);
    return Math.round(idx * minP); // idx ≥ 2: защита от деления на 0/отрицательного
  }
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

// Резервный источник индекса цен: /v3/product/info/list.
// Формат полей отличается от /v5: ozon/external/self_marketplaces с minimal_price.
function fetchV3Indices(productIds) {
  var map = {};
  if (!productIds || productIds.length === 0) return map;
  for (var i = 0; i < productIds.length; i += 1000) {
    var batch = productIds.slice(i, i + 1000);
    try {
      var res = ozonApi('/v3/product/info/list', { product_id: batch.map(String) });
      var items = (res && (res.items || (res.result && res.result.items))) || [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        var pid = it.id || it.product_id;
        if (pid) map[pid] = it.price_indexes || {};
      }
    } catch (e) { Logger.log('v3 info/list error: ' + e.message); }
    Utilities.sleep(300);
  }
  return map;
}

// Оценка цены покупателя: перебираем все базы конкурентов из /v5 и /v3,
// считаем цену по индексу для каждой и берём минимум (консервативная оценка).
// displayIdx — индекс для показа (приоритет ozon → external → self).
// fromV3 = true, если в /v5 индексов не было, а помог /v3.
function estimateBuyerPrice(v5idx, v3idx) {
  var cands = [];
  var v5count = 0, v3count = 0;
  var displayIdx = 0;

  function consider(idxVal, minP, src) {
    var iv = parseFloat(idxVal), mp = parseFloat(minP);
    if (iv > 0 && mp > 0) {
      var bp = calcBuyerPrice(iv, mp);
      if (bp && bp > 0) { cands.push(bp); if (src === 'v5') v5count++; else v3count++; }
      return iv;
    }
    return 0;
  }

  if (v5idx) {
    var o = v5idx.ozon_index_data || {}, e = v5idx.external_index_data || {}, s = v5idx.self_marketplaces_index_data || {};
    var io = consider(o.price_index_value, o.min_price, 'v5');
    var ie = consider(e.price_index_value, e.min_price, 'v5');
    var is = consider(s.price_index_value, s.min_price, 'v5');
    displayIdx = io || ie || is || 0;
  }
  if (v3idx) {
    var o2 = v3idx.ozon || {}, e2 = v3idx.external || {}, s2 = v3idx.self_marketplaces || {};
    var io2 = consider(o2.price_index_value, o2.minimal_price, 'v3');
    var ie2 = consider(e2.price_index_value, e2.minimal_price, 'v3');
    var is2 = consider(s2.price_index_value, s2.minimal_price, 'v3');
    if (!displayIdx) displayIdx = io2 || ie2 || is2 || 0;
  }

  return {
    buyerPrice: cands.length ? Math.min.apply(null, cands) : 0,
    displayIdx: displayIdx,
    fromV3: (v5count === 0 && v3count > 0)
  };
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
    .addItem('6. Обновить ОПиУ', 'updateOpiu')
    .addSeparator()
    .addItem('7. ABC-анализ (квартал)', 'runAbcAnalysis')
    .addSeparator()
    .addItem('⏱ Включить авто', 'enableAutoRun')
    .addItem('⏹ Выключить авто', 'disableAutoRun')
    .addToUi();
}

function enableAutoRun() {
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
// 1. Загрузить товары  (пакетная запись)
// =====================================================================
function loadOzonProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  // Все товары
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

  // Сохранить ручные данные (пакетно): G РРЦ, H Мин.цена, K Кошелек%, P Модель, Q Маржа.
  // J (СПП) НЕ сохраняем — он расчётный.
  var userData = {};
  if (lastRow >= 2) {
    var old = sheet.getRange(2, 2, lastRow - 1, 16).getValues(); // B..Q (cols2..17)
    for (var r = 0; r < old.length; r++) {
      var pid = old[r][0]; // B
      if (pid) userData[pid.toString()] = {
        rrc: old[r][5],       // G
        minP: old[r][6],      // H
        walletPct: old[r][9], // K
        model: old[r][14],    // P
        margin: old[r][15]    // Q
      };
    }
  }

  // Фото (батч)
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

  // Названия (по одному — батч-эндпоинта нет)
  var nameMap = {};
  for (var ni = 0; ni < allItems.length; ni++) {
    try {
      var descResult = ozonApi('/v1/product/info/description', { product_id: allItems[ni].product_id });
      if (descResult && descResult.result) nameMap[allItems[ni].product_id] = descResult.result.name || '';
    } catch (e) {}
    if ((ni + 1) % 5 === 0) Utilities.sleep(500);
  }

  // Остатки (батч) — один раз
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

  // Построить массив A..W (23 столбца) и записать одним setValues
  var out = [];
  for (var i = 0; i < allItems.length; i++) {
    var item = allItems[i];
    var row = new Array(23).fill('');
    var pidStr = item.product_id.toString();

    row[0] = photoMap[item.product_id] ? '=IMAGE("' + photoMap[item.product_id] + '")' : ''; // A
    row[1] = item.product_id;           // B
    row[2] = item.offer_id || '';       // C
    row[3] = nameMap[item.product_id] || ''; // D

    if (stockMap[item.product_id]) {
      row[21] = stockMap[item.product_id].fbs; // V
      row[22] = stockMap[item.product_id].fbo; // W
    }

    var saved = userData[pidStr];
    if (saved) {
      if (saved.rrc !== '' && saved.rrc != null) row[6] = saved.rrc;        // G
      if (saved.minP !== '' && saved.minP != null) row[7] = saved.minP;     // H
      if (saved.walletPct !== '' && saved.walletPct != null) row[10] = saved.walletPct; // K
      if (saved.model !== '' && saved.model != null) row[15] = saved.model; // P
      if (saved.margin !== '' && saved.margin != null) row[16] = saved.margin; // Q
    }
    out.push(row);
  }

  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 23).clearContent();
  if (out.length > 0) sheet.getRange(2, 1, out.length, 23).setValues(out);

  logAction('Загрузка товаров', 'ОК', 'Загружено: ' + out.length);
  showAlert('Готово', 'Загружено: ' + out.length + '\nОтсортировано A→Z');
}

// =====================================================================
// 2. Цены + индекс (API)  (пакетная запись)
// Заполняет: I цена, J СПП%, L с кошельком, M без кошелька, N индекс, O цвет
// =====================================================================
function getOzonPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Загрузите товары'); return; }
  var n = lastRow - 1;

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

  // Читаем B..O (cols 2..15): idx = col - 2
  var vals = sheet.getRange(2, 2, n, 14).getValues();

  // Резервный источник индекса: /v3/product/info/list
  var pidsForV3 = [];
  for (var pi = 0; pi < n; pi++) { if (vals[pi][0]) pidsForV3.push(vals[pi][0]); }
  var indexMapV3 = fetchV3Indices(pidsForV3);

  var sPrice = 0, sIndex = 0, notFound = 0, usedV3 = 0;
  var noIndexRows = [];
  for (var i = 0; i < n; i++) {
    var pid = vals[i][0]; // B
    if (!pid) continue;
    var pd = priceMap[pid];
    if (!pd) { notFound++; continue; }

    var sellerPrice = parseFloat(pd.price.price) || 0;
    vals[i][7] = pd.price.price || ''; // I
    sPrice++;

    var v5idx = pd.price_indexes || {};
    var v3idx = indexMapV3[pid] || null;

    // Цена покупателя: минимум по всем базам конкурентов из /v5 и /v3
    var est = estimateBuyerPrice(v5idx, v3idx);
    if (est.fromV3) usedV3++;
    var hasIndexOrCompetitors = (est.displayIdx && est.displayIdx > 0) || (est.buyerPrice && est.buyerPrice > 0);
    if (!hasIndexOrCompetitors) noIndexRows.push(i);

    // N — индекс (пусто, если данных нет)
    vals[i][12] = (est.displayIdx && est.displayIdx !== 0) ? est.displayIdx : '';
    // O — цвет (берётся из /v5)
    var colorIdx = v5idx.color_index || '';
    if (colorIdx) vals[i][13] = colorIndexText(colorIdx);

    // L — цена с кошельком (оценка из индекса) либо цена продавца
    var wp = (est.buyerPrice && est.buyerPrice > 0) ? est.buyerPrice : sellerPrice;
    if (wp) {
      vals[i][10] = wp; // L
      sIndex++;

      // M — без кошелька = L / (1 - K)
      var wPct = normFraction(vals[i][9]); // K
      var priceWithoutWallet = (wPct > 0) ? wp / (1 - wPct) : wp;
      vals[i][11] = Math.round(priceWithoutWallet); // M

      // J — СПП% = (I - M) / I. Без индекса/конкурентов ставим ниже общий fallback.
      if (hasIndexOrCompetitors && sellerPrice && priceWithoutWallet && sellerPrice > 0) {
        var sppPct = (sellerPrice - priceWithoutWallet) / sellerPrice;
        if (sppPct < 0) sppPct = 0;
        // Cap: СПП > 0.95 = мусор (несбыточная цена продавца от API)
        if (sppPct > 0.95) sppPct = 0;
        vals[i][8] = Math.round(sppPct * 10000) / 10000; // J
      }
    }
  }

  // J = idx 8 при чтении с B, N (индекс) = idx 12
  var fallbackSpp = avgSppFromRows(vals, 8, 12); // средний СПП по строкам с индексом
  if (fallbackSpp > 0) {
    var fallbackRounded = Math.round(fallbackSpp * 10000) / 10000;
    var fallbackApplied = 0;
    for (var ri = 0; ri < n; ri++) {
      var hasIdx = parseFloat(vals[ri][12]) > 0; // N — индекс есть
      var hasSpp = parseFloat(vals[ri][8]) > 0;  // J — валидный СПП
      // Без индекса — ВСЕГДА перезаписываем средним (старые/застрявшие значения не мешают).
      // С индексом, но СПП = 0 (cap 0.95, мусорная цена API) — тоже средний.
      if (!hasIdx || !hasSpp) {
        vals[ri][8] = fallbackRounded; // J
        fallbackApplied++;
      }
    }
    Logger.log('Fallback СПП (средний ' + fallbackRounded + ') применён к строкам: ' + fallbackApplied);
  } else {
    Logger.log('WARNING: fallback СПП = 0, нет ни одной строки с индексом и валидным СПП');
  }

  // Запись I..O (cols 9..15) одним блоком
  var out = vals.map(function(r) { return r.slice(7, 14); });
  sheet.getRange(2, 9, n, 7).setValues(out);

  // Остатки FBS/FBO
  loadStocksByPid(sheet, lastRow);

  // Дата обновления в X1
  sheet.getRange(1, 24).setValue('Обновлено: ' + Utilities.formatDate(new Date(), 'Europe/Moscow', 'dd.MM.yyyy HH:mm'));

  logAction('Цены + индекс', 'ОК', 'Цен: ' + sPrice + ', С кошельком: ' + sIndex + ', Не найдено: ' + notFound + ', Индекс из v3: ' + usedV3);
  showAlert('Готово', 'Цен: ' + sPrice + '\nС кошельком: ' + sIndex + '\nНе найдено: ' + notFound + '\nИндекс из v3 (резерв): ' + usedV3);
}

// =====================================================================
// Остатки FBS/FBO → V(22), W(23)  (пакетно)
// =====================================================================
function loadStocksByPid(sheet, lastRow) {
  try {
    if (lastRow < 2) return;
    var n = lastRow - 1;
    var pidCol = sheet.getRange(2, 2, n, 1).getValues();
    var pids = [];
    for (var r = 0; r < n; r++) { if (pidCol[r][0]) pids.push(pidCol[r][0]); }
    if (pids.length === 0) return;
    doLoadStocksV4(sheet, pids, pidCol, n);
  } catch (e) {
    Logger.log('loadStocksByPid error: ' + e.message);
  }
}

function doLoadStocksV4(sheet, pids, pidCol, n) {
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

  // Пакетная запись V/W (сохраняем существующие значения, где нет данных)
  var cur = sheet.getRange(2, 22, n, 2).getValues();
  for (var row = 0; row < n; row++) {
    var productId = pidCol[row][0];
    if (productId && stockMap[productId]) {
      cur[row][0] = stockMap[productId].fbs; // V
      cur[row][1] = stockMap[productId].fbo; // W
    }
  }
  sheet.getRange(2, 22, n, 2).setValues(cur);
}

// =====================================================================
// 3. Рассчитать цены  (пакетная запись)
// M = L/(1-K); J = (I-M)/I; R = G/(1-J)/(1-K) либо G/(1-J)
// =====================================================================
function calculatePrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }
  var n = lastRow - 1;

  Logger.log('=== Расчёт цен v12 ===');

  var actions = getAllBoostActions();
  var boostMap = getBoostCandidates(actions);

  // Читаем B..U (cols 2..21): idx = col - 2
  var vals = sheet.getRange(2, 2, n, 20).getValues();
  // Средний СПП по строкам с индексом (N = idx 12) — fallback для товаров без индекса
  var fallbackSpp = avgSppFromRows(vals, 8, 12); // J, фильтр по N (индекс)

  var updated = 0;
  for (var i = 0; i < n; i++) {
    var productId = vals[i][0];                  // B
    var rrc = parseFloat(vals[i][5]);            // G
    var minPrice = parseFloat(vals[i][6]);       // H
    var sellerPrice = parseFloat(vals[i][7]);    // I
    var walletPct = normFraction(vals[i][9]);    // K
    var walletPrice = parseFloat(vals[i][10]);   // L
    var priceIndex = parseFloat(vals[i][12]);    // N
    var model = (vals[i][14] || '').toString().trim(); // P

    if (!sellerPrice && !rrc) continue;

    var basePrice = rrc || sellerPrice;

    // M — без кошелька = L / (1 - K)
    var priceWithoutWallet = 0;
    if (walletPrice && walletPct > 0) {
      priceWithoutWallet = walletPrice / (1 - walletPct);
      vals[i][11] = Math.round(priceWithoutWallet); // M
    } else if (walletPrice) {
      priceWithoutWallet = walletPrice;
      vals[i][11] = Math.round(priceWithoutWallet);
    }

    // J — СПП% = (I - M) / I
    var sppPct = normFraction(vals[i][8]); // J
    if (priceIndex > 0 && sellerPrice && priceWithoutWallet && sellerPrice > 0) {
      sppPct = (sellerPrice - priceWithoutWallet) / sellerPrice;
      if (sppPct < 0) sppPct = 0;
      // Cap: СПП > 0.95 = мусор
      if (sppPct > 0.95) sppPct = 0;
      vals[i][8] = Math.round(sppPct * 10000) / 10000; // J
    } else if (!(priceIndex > 0) && fallbackSpp > 0) {
      sppPct = fallbackSpp;
      vals[i][8] = Math.round(sppPct * 10000) / 10000; // J
    }
    // Доп. fallback: если после расчёта СПП = 0 (cap 0.95, мусорная цена API) — берём fallback
    if (!(sppPct > 0) && fallbackSpp > 0) {
      sppPct = fallbackSpp;
      vals[i][8] = Math.round(sppPct * 10000) / 10000; // J
    }

    // R — цена для загрузки
    var targetPrice = basePrice;
    var modelLc = model.toLowerCase();
    var hasWallet = modelLc ? (modelLc.indexOf('без кошелька') === -1) : false; // пусто = Без кошелька

    if (sppPct > 0 && sppPct < 1) {
      if (hasWallet && walletPct > 0 && walletPct < 1) {
        targetPrice = targetPrice / (1 - sppPct) / (1 - walletPct);
      } else {
        targetPrice = targetPrice / (1 - sppPct);
      }
    }

    targetPrice = Math.round(targetPrice);
    if (minPrice && targetPrice < minPrice) targetPrice = minPrice;
    if (!targetPrice || targetPrice < 1) targetPrice = basePrice;

    vals[i][16] = targetPrice; // R

    // U — Бустинг + акции
    if (productId && boostMap[productId]) {
      var bidx = boostMap[productId];
      var bestBoost = null;
      for (var b2 = 0; b2 < bidx.length; b2++) {
        var b = bidx[b2];
        if (b.minElastic > 0 && b.maxElastic > 0 && targetPrice >= b.maxElastic && targetPrice <= b.minElastic) {
          var boostRange = b.minElastic - b.maxElastic;
          var priceOffset = targetPrice - b.maxElastic;
          var boostPct = boostRange > 0 ? Math.round(b.minBoost + (b.maxBoost - b.minBoost) * (1 - priceOffset / boostRange)) : b.minBoost;
          if (!bestBoost || boostPct > bestBoost.boostPct) bestBoost = { boostPct: boostPct };
        }
      }
      if (bestBoost) {
        vals[i][19] = '✅ ' + bestBoost.boostPct + '% | ' + bidx.length + ' акц.';
      } else {
        var best = bidx[0];
        for (var b3 = 1; b3 < bidx.length; b3++) {
          if (bidx[b3].minElastic > best.minElastic) best = bidx[b3];
        }
        if (targetPrice > best.minElastic) {
          vals[i][19] = '❌ Выше (' + best.maxElastic + '-' + best.minElastic + ') | ' + bidx.length + ' акц.';
        } else if (best.maxElastic > 0 && targetPrice < best.maxElastic) {
          vals[i][19] = '⚠️ Ниже (' + best.maxElastic + '-' + best.minElastic + ') | ' + bidx.length + ' акц.';
        } else {
          vals[i][19] = '❌ Не попал | ' + bidx.length + ' акц.';
        }
      }
    } else {
      vals[i][19] = '—';
    }
    updated++;
  }

  // Запись J..U (cols 10..21) одним блоком
  var out = vals.map(function(r) { return r.slice(8, 20); });
  sheet.getRange(2, 10, n, 12).setValues(out);

  logAction('Расчёт цен', 'ОК', 'Рассчитано: ' + updated);
  showAlert('Готово', 'Рассчитано: ' + updated);
}

// =====================================================================
// 4. Загрузить цены на Ozon  (разбор ответа по каждому товару)
// =====================================================================
function uploadPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }
  var n = lastRow - 1;

  Logger.log('=== Загрузка цен v12 ===');

  var threshold = getUpdateThreshold();

  // Читаем B..U (cols 2..21): idx = col - 2
  var vals = sheet.getRange(2, 2, n, 20).getValues();

  var prices = [];
  for (var i = 0; i < n; i++) {
    var productId = vals[i][0];                 // B
    var targetPrice = parseFloat(vals[i][16]);  // R
    var currentPrice = parseFloat(vals[i][7]);  // I
    if (!productId || !targetPrice) continue;
    if (currentPrice && Math.abs(targetPrice - currentPrice) < threshold) {
      vals[i][18] = '⏭ Без изменений'; // T
      continue;
    }
    prices.push({ product_id: productId, price: targetPrice, idx: i });
  }

  if (prices.length === 0) {
    var noChange = vals.map(function(r) { return r.slice(17, 20); }); // S,T,U
    sheet.getRange(2, 19, n, 3).setValues(noChange);
    showAlert('Готово', 'Нет товаров для обновления');
    return;
  }

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

  // Загрузить цены батчами с разбором ответа по каждому product_id
  var totalOk = 0, totalErr = 0;
  for (var bi = 0; bi < prices.length; bi += 100) {
    var batch = prices.slice(bi, bi + 100);
    var result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price.toString() }; })
    });

    // Карта результата: product_id → { updated, error }
    var resMap = {};
    if (result && result.result && result.result.length) {
      for (var k = 0; k < result.result.length; k++) {
        var it = result.result[k];
        var rid = it.product_id || it.offer_id;
        var errMsg = '';
        if (it.errors && it.errors.length) {
          errMsg = it.errors.map(function(e) { return e.message || e.code || JSON.stringify(e); }).join('; ');
        }
        resMap[rid] = { updated: it.updated === true && !errMsg, error: errMsg };
      }
    }

    var topError = (result && result.code) ? (result.message || JSON.stringify(result)) : '';

    for (var j = 0; j < batch.length; j++) {
      var rowIdx = batch[j].idx;
      var pid = batch[j].product_id;
      var info = resMap[pid];
      if (topError) {
        vals[rowIdx][18] = '❌ ' + topError; // T
        totalErr++;
      } else if (info && info.updated) {
        vals[rowIdx][17] = batch[j].price;               // S — загруженная цена
        vals[rowIdx][18] = '✅ ' + batch[j].price + '₽'; // T
        totalOk++;
      } else if (info && info.error) {
        vals[rowIdx][18] = '❌ ' + info.error; // T
        totalErr++;
      } else {
        // нет явного подтверждения — помечаем как непроверенное, не ставим ✅
        vals[rowIdx][18] = '⚠️ Без подтверждения'; // T
        totalErr++;
      }
    }
    Utilities.sleep(500);
  }

  // Добавить обратно в акции (только реально загруженные)
  Utilities.sleep(3000);
  var addedCount = 0;
  for (var i = 0; i < prices.length; i++) {
    var rowIdx = prices[i].idx;
    var statusT = (vals[rowIdx][18] || '').toString();
    if (statusT.indexOf('✅') === -1) continue; // не загрузилось — в акцию не добавляем

    var pid = prices[i].product_id;
    var price = prices[i].price;
    if (boostMap[pid]) {
      var bidx = boostMap[pid];
      for (var b2 = 0; b2 < bidx.length; b2++) {
        var b = bidx[b2];
        if (b.minElastic > 0 && b.maxElastic > 0 && price >= b.maxElastic && price <= b.minElastic) {
          var added = addToAction(pid, b.actionId, price);
          if (added) {
            addedCount++;
            var boostRange = b.minElastic - b.maxElastic;
            var priceOffset = price - b.maxElastic;
            var boostPct = boostRange > 0 ? Math.round(b.minBoost + (b.maxBoost - b.minBoost) * (1 - priceOffset / boostRange)) : b.minBoost;
            vals[rowIdx][19] = '✅ ' + boostPct + '% | в акции'; // U
          }
          break;
        }
      }
    }
  }

  // Пакетная запись S,T,U (cols 19..21)
  var out = vals.map(function(r) { return r.slice(17, 20); });
  sheet.getRange(2, 19, n, 3).setValues(out);

  logAction('Загрузка цен', 'ОК', 'ОК: ' + totalOk + ', Ошибок/непроверено: ' + totalErr + ', Из акций: ' + removedCount + ', В акции: ' + addedCount);
  showAlert('Готово', 'Загружено: ' + totalOk + '\nОшибок/непроверено: ' + totalErr + '\nИз акций: ' + removedCount + '\nВ акции: ' + addedCount);
}

function fullCycle() {
  loadOzonProducts();
  getOzonPrices();
  calculatePrices();
  uploadPrices();
}


// =====================================================================
// 6. ОПиУ — заполнение из документов/операций Ozon + себестоимость из «Справочник»
// Авто-заполняются:
// 2 Выручка, 3 Продажи, 4 Возвраты, 6 Баллы Ozon (СПП),
// 7 Себестоимость проданных товаров, 10..17 расходы реализации.
// Ручные строки 22..27 не трогаются. Итоговые строки — формулы.
// =====================================================================
function updateOpiu() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('ОПиУ');
  var refSheet = ss.getSheetByName('Справочник');
  if (!sheet) { showAlert('Ошибка', 'Лист «ОПиУ» не найден'); return; }
  if (!refSheet) { showAlert('Ошибка', 'Лист «Справочник» не найден'); return; }

  var year = getOpiuYear_(sheet);
  var cogsMap = getOpiuCogsMap_(refSheet);
  var monthData = [];
  var missingCogsRows = [['Месяц', 'Product ID', 'Offer ID', 'Название', 'Продано', 'Возвраты', 'К продаже', 'Причина']];
  var rawRows = [['Месяц', 'Тип операции', 'Название операции', 'Кол-во', 'Сумма', 'Начисления', 'Комиссия', 'Сервисы']];

  for (var m = 1; m <= 12; m++) {
    var txSummary = fetchOpiuTransactionsMonth_(year, m, rawRows);
    var cogsSummary = fetchOpiuCogsMonth_(year, m, cogsMap);
    for (var mr = 0; mr < cogsSummary.missingRows.length; mr++) missingCogsRows.push(cogsSummary.missingRows[mr]);
    var sales = cogsSummary.sales || txSummary.sales;
    var returns = cogsSummary.returns || txSummary.returns;
    monthData.push({
      revenue: Math.max(0, sales - returns),
      sales: sales,
      returns: returns,
      ozonPoints: cogsSummary.ozonPoints,
      cogs: cogsSummary.cogs,
      commission: txSummary.commission,
      logistics: txSummary.logistics,
      acquiring: txSummary.acquiring,
      storage: txSummary.storage,
      advertising: txSummary.advertising,
      penalties: txSummary.penalties,
      other: txSummary.other,
      compensations: txSummary.compensations
    });
    Utilities.sleep(300);
  }

  writeOpiuMonthValues_(sheet, monthData);
  writeOpiuFormulas_(sheet);
  writeOpiuRawSheet_(ss, rawRows);
  writeOpiuMissingCogsSheet_(ss, missingCogsRows);
  var missingCount = Math.max(0, missingCogsRows.length - 1);
  logAction('ОПиУ', 'ОК', 'Год: ' + year + ', месяцев: 12, без себестоимости: ' + missingCount);
  showAlert('ОПиУ обновлён', 'Автостроки заполнены из Ozon API, себестоимость — из «Справочник». Ручные поля не тронуты.\nБез себестоимости: ' + missingCount + ' строк.');
}

function getOpiuYear_(sheet) {
  var title = String(sheet.getRange('B1').getValue() || '');
  var m = title.match(/20\d{2}/);
  if (m) return parseInt(m[0], 10);
  var now = new Date();
  return now.getFullYear();
}

function getOpiuCogsMap_(refSheet) {
  var map = { byOffer: {}, byProduct: {}, productByOffer: {} };
  var last = refSheet.getLastRow();
  if (last < 2) return map;
  // B Product ID, C Offer ID, K Себестоимость
  var vals = refSheet.getRange(2, 2, last - 1, 10).getValues();
  for (var i = 0; i < vals.length; i++) {
    var productId = vals[i][0];
    var offerId = vals[i][1];
    var cogs = parseNumber_(vals[i][9]);
    if (offerId) map.byOffer[String(offerId).trim()] = cogs;
    if (productId) map.byProduct[String(productId).trim()] = cogs;
    if (offerId && productId) map.productByOffer[String(offerId).trim()] = String(productId).trim();
  }
  return map;
}

function parseNumber_(v) {
  if (typeof v === 'number') return v;
  var s = String(v || '').replace(/\s/g, '').replace(',', '.');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function monthPeriod_(year, month) {
  var from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
  var to = new Date(Date.UTC(year, month, 0, 23, 59, 59));
  return {
    from: Utilities.formatDate(from, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"),
    to: Utilities.formatDate(to, 'UTC', "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"),
    ym: Utilities.formatDate(from, 'UTC', 'yyyy-MM')
  };
}

function fetchOpiuTransactionsMonth_(year, month, rawRows) {
  var p = monthPeriod_(year, month);
  var s = {
    sales: 0, returns: 0, commission: 0, logistics: 0, acquiring: 0,
    storage: 0, advertising: 0, penalties: 0, other: 0, compensations: 0
  };
  var page = 1;
  while (true) {
    var res = ozonApi('/v3/finance/transaction/list', {
      filter: {
        date: { from: p.from, to: p.to },
        operation_type: [],
        posting_number: '',
        transaction_type: 'all'
      },
      page: page,
      page_size: 1000
    });
    var result = res && res.result;
    var ops = (result && result.operations) || [];
    for (var i = 0; i < ops.length; i++) {
      applyOpiuOperation_(s, ops[i]);
      if (rawRows) {
        rawRows.push([
          p.ym,
          ops[i].operation_type || '',
          ops[i].operation_type_name || '',
          1,
          parseNumber_(ops[i].amount),
          parseNumber_(ops[i].accruals_for_sale),
          parseNumber_(ops[i].sale_commission),
          sumServices_(ops[i])
        ]);
      }
    }
    var pageCount = (result && result.page_count) || 0;
    if (!pageCount || page >= pageCount || ops.length === 0) break;
    page++;
    Utilities.sleep(200);
  }
  return roundOpiu_(s);
}

function applyOpiuOperation_(s, op) {
  var type = String(op.operation_type || '');
  var txType = String(op.type || '');
  var amount = parseNumber_(op.amount);
  var accruals = parseNumber_(op.accruals_for_sale);
  var commission = parseNumber_(op.sale_commission);
  var services = sumServices_(op);

  if (type === 'OperationAgentDeliveredToCustomer') {
    if (accruals > 0) s.sales += accruals;
    if (accruals < 0) s.returns += Math.abs(accruals);
    s.commission += Math.abs(commission);
    s.logistics += Math.abs(sumLogisticServices_(op));
    return;
  }

  if (txType === 'returns') {
    if (accruals < 0) s.returns += Math.abs(accruals);
    s.logistics += Math.abs(services || amount);
    return;
  }

  if (type === 'MarketplaceRedistributionOfAcquiringOperation') {
    s.acquiring += Math.abs(amount || services);
    return;
  }
  if (type === 'OperationMarketplaceServiceStorage') {
    s.storage += Math.abs(amount);
    return;
  }
  if (isOpiuAdvertising_(type)) {
    s.advertising += Math.abs(amount || services);
    return;
  }
  if (isOpiuPenalty_(type, op.operation_type_name)) {
    s.penalties += Math.abs(amount || services);
    return;
  }
  if (isOpiuLogistics_(type, op.operation_type_name)) {
    s.logistics += Math.abs(amount || services);
    return;
  }

  if (amount < 0) s.other += Math.abs(amount);
  if (amount > 0) s.compensations -= amount;
}

function sumServices_(op) {
  var services = op.services || [];
  var sum = 0;
  for (var i = 0; i < services.length; i++) sum += parseNumber_(services[i].price);
  return sum;
}

function sumLogisticServices_(op) {
  var services = op.services || [];
  var sum = 0;
  for (var i = 0; i < services.length; i++) {
    var name = String(services[i].name || '');
    if (isOpiuLogistics_(name, name)) sum += parseNumber_(services[i].price);
  }
  return sum;
}

function isOpiuAdvertising_(type) {
  return [
    'OperationMarketplaceCostPerClick',
    'MarketplaceServiceBrandCommission',
    'OperationPromotionWithCostPerOrder',
    'StarsMembership',
    'OperationPointsForReviews',
    'OperationMarketplaceServicePremiumCashbackIndividualPoints',
    'MarketplaceSellerInstallmentOperation'
  ].indexOf(type) !== -1;
}

function isOpiuPenalty_(type, name) {
  var s = (String(type || '') + ' ' + String(name || '')).toLowerCase();
  return s.indexOf('penalty') >= 0 || s.indexOf('fine') >= 0 ||
         s.indexOf('штраф') >= 0 || s.indexOf('ошиб') >= 0 ||
         s.indexOf('наруш') >= 0;
}

function isOpiuLogistics_(type, name) {
  var s = (String(type || '') + ' ' + String(name || '')).toLowerCase();
  return s.indexOf('logistic') >= 0 || s.indexOf('delivery') >= 0 ||
         s.indexOf('return') >= 0 || s.indexOf('lastmile') >= 0 ||
         s.indexOf('directflow') >= 0 || s.indexOf('pickup') >= 0 ||
         s.indexOf('cargo') >= 0 || s.indexOf('достав') >= 0 ||
         s.indexOf('возврат') >= 0 || s.indexOf('вывоз') >= 0;
}

function fetchOpiuCogsMonth_(year, month, cogsMap) {
  var cogs = 0;
  var ozonPoints = 0;
  var sales = 0;
  var returns = 0;
  var missingRows = [];
  var p = monthPeriod_(year, month);
  try {
    var res = ozonApi('/v2/finance/realization', { year: year, month: month });
    var rows = (res && res.result && res.result.rows) || [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var item = row.item || {};
      var offerId = String(item.offer_id || '').trim();
      var productId = String(item.product_id || cogsMap.productByOffer[offerId] || item.sku || item.id || '').trim();
      var itemName = item.name || item.offer_name || row.name || '';
      var unitCogs = cogsMap.byOffer[offerId] || cogsMap.byProduct[productId] || 0;
      var soldQty = row.delivery_commission ? parseNumber_(row.delivery_commission.quantity) : 0;
      var returnQty = row.return_commission ? parseNumber_(row.return_commission.quantity) : 0;
      var netQty = Math.max(0, soldQty - returnQty);
      var bonus = row.delivery_commission ? parseNumber_(row.delivery_commission.bonus) : 0;
      var sellerPrice = parseNumber_(row.seller_price_per_instance);
      var deliveryAmount = sellerPrice * soldQty;
      var returnAmount = sellerPrice * returnQty;
      if (netQty > 0 && !unitCogs) {
        missingRows.push([p.ym, productId, offerId, itemName, soldQty, returnQty, netQty, 'Нет себестоимости в Справочник!K']);
      }
      sales += deliveryAmount;
      returns += Math.abs(returnAmount);
      cogs += unitCogs * netQty;
      ozonPoints += bonus;
    }
  } catch (e) {
    Logger.log('ОПиУ себестоимость ' + year + '-' + month + ': ' + e.message);
  }
  return {
    cogs: Math.round(cogs * 100) / 100,
    ozonPoints: Math.round(ozonPoints * 100) / 100,
    sales: Math.round(sales * 100) / 100,
    returns: Math.round(returns * 100) / 100,
    missingRows: missingRows
  };
}

function roundOpiu_(s) {
  for (var k in s) s[k] = Math.round(s[k] * 100) / 100;
  return s;
}

function writeOpiuMonthValues_(sheet, monthData) {
  var rowByKey = {
    revenue: 2,
    sales: 3,
    returns: 4,
    ozonPoints: 6,
    cogs: 7,
    commission: 10,
    logistics: 11,
    acquiring: 12,
    storage: 13,
    advertising: 14,
    penalties: 15,
    other: 16,
    compensations: 17
  };
  for (var key in rowByKey) {
    var vals = [];
    for (var m = 0; m < 12; m++) vals.push(monthData[m][key] || 0);
    sheet.getRange(rowByKey[key], 3, 1, 12).setValues([vals]);
  }
}

function writeOpiuFormulas_(sheet) {
  var cols = ['C','D','E','F','G','H','I','J','K','L','M','N'];
  var formulasByRow = {
    8: function(c) { return '=' + c + '2-' + c + '7'; },
    9: function(c) { return '=SUM(' + c + '10:' + c + '17)'; },
    18: function(c) { return '=' + c + '8-' + c + '9'; },
    19: function(c) { return '=IFERROR(' + c + '18/' + c + '2*100%;0)'; },
    20: function(c) { return '=SUM(' + c + '21:' + c + '26)'; },
    28: function(c) { return '=' + c + '18-' + c + '20-' + c + '27'; },
    29: function(c) { return '=IFERROR(' + c + '28/' + c + '2*100%;0)'; },
    30: function(c) { return '=' + c + '2*7%'; },
    31: function(c) { return '=' + c + '28-' + c + '30'; },
    32: function(c) { return '=IFERROR(' + c + '31/' + c + '2*100%;0)'; }
  };
  for (var row in formulasByRow) {
    for (var i = 0; i < cols.length; i++) {
      sheet.getRange(parseInt(row, 10), i + 3).setFormula(formulasByRow[row](cols[i]));
    }
  }

  // B = итог за год. Для процентов — формула от годовых итогов, не сумма месяцев.
  var totalRows = [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,20,21,22,23,24,25,26,27,28,30,31];
  for (var j = 0; j < totalRows.length; j++) {
    sheet.getRange(totalRows[j], 2).setFormula('=SUM(C' + totalRows[j] + ':N' + totalRows[j] + ')');
  }
  sheet.getRange(19, 2).setFormula('=IFERROR(B18/B2*100%;0)');
  sheet.getRange(29, 2).setFormula('=IFERROR(B28/B2*100%;0)');
  sheet.getRange(32, 2).setFormula('=IFERROR(B31/B2*100%;0)');
}

function writeOpiuRawSheet_(ss, rawRows) {
  var name = 'ОПиУ_Озон_операции';
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  if (rawRows && rawRows.length) sh.getRange(1, 1, rawRows.length, rawRows[0].length).setValues(rawRows);
  try { sh.hideSheet(); } catch (e) {}
}

function writeOpiuMissingCogsSheet_(ss, missingRows) {
  var name = 'ОПиУ_нет_себестоимости';
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  if (missingRows && missingRows.length) {
    sh.getRange(1, 1, missingRows.length, missingRows[0].length).setValues(missingRows);
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 8);
}

// =====================================================================
// 5. Юнит экономика  (пакетная запись)
// S Баллы Ozon (доля СПП из «Репрайсера», доход)
// T Доход баллы (₽) = E * S
// U Итого расходы Ozon = H + (I+M)/K + L + N + O
// V Итого расходы все = U + F + P + Q + R
// W Прибыль = E - V + T
// X Маржинальность (%) = W / E * 100
// Y Мин. цена (безубыток) = V / (1 + S)
// =====================================================================
function loadUnitEconomics() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Юнит экономика');
  var refSheet = ss.getSheetByName('Справочник');
  var repSheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

  // 1. Репрайсер (B..W, cols 2..23): idx = col - 2
  var repData = {};
  var repLastRow = repSheet.getLastRow();
  if (repLastRow >= 2) {
    var repVals = repSheet.getRange(2, 2, repLastRow - 1, 22).getValues();
    for (var r = 0; r < repVals.length; r++) {
      var pid = repVals[r][0]; // B
      if (pid) repData[pid.toString()] = {
        offerId: repVals[r][1],                         // C
        name: repVals[r][2],                            // D
        price: parseFloat(repVals[r][7]) || 0,          // I
        spp: parseFloat(repVals[r][8]) || 0,            // J — СПП% (доля)
        fbs: repVals[r][20],                            // V
        fbo: repVals[r][21]                             // W
      };
    }
  }

  // 2. Справочник (B..L, cols 2..12): idx = col - 2
  var refData = {};
  var refLastRow = refSheet.getLastRow();
  if (refLastRow >= 2) {
    var refVals = refSheet.getRange(2, 2, refLastRow - 1, 11).getValues();
    for (var r = 0; r < refVals.length; r++) {
      var pid = refVals[r][0]; // B
      if (pid) refData[pid.toString()] = {
        cogs: parseFloat(refVals[r][9]) || 0,    // K
        buyback: parseFloat(refVals[r][10]) || 0 // L
      };
    }
  }

  // 3. Комиссии из API
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

  // 4. Ручные данные листа (A..R, cols 1..18): idx = col - 1
  var manualData = {};
  if (lastRow >= 2) {
    var manVals = sheet.getRange(2, 1, lastRow - 1, 18).getValues();
    for (var r = 0; r < manVals.length; r++) {
      var pid = manVals[r][1]; // B
      if (pid) manualData[pid.toString()] = {
        scheme: manVals[r][3], // D
        adv: manVals[r][15],   // P
        pack: manVals[r][16],  // Q
        tax: manVals[r][17]    // R
      };
    }
  }

  // 5. Порядок по offerId
  var pids = [];
  for (var k in repData) pids.push({ pid: k, offerId: repData[k].offerId });
  pids.sort(function(a, b) {
    return (a.offerId || '').toString().toLowerCase() < (b.offerId || '').toString().toLowerCase() ? -1 : 1;
  });

  // 6. Построить массив A..AB (28 столбцов)
  var out = [];
  for (var i = 0; i < pids.length; i++) {
    var pid = pids[i].pid;
    var rep = repData[pid];
    if (!rep) continue;

    var row = new Array(28).fill('');
    var pd = priceMap[parseInt(pid)];
    var ref = refData[pid];
    var md = manualData[pid] || {};
    var scheme = md.scheme || ((rep.fbo && rep.fbo > 0) ? 'FBO' : 'FBS');

    row[0] = rep.offerId;     // A
    row[1] = parseInt(pid);   // B
    row[2] = rep.name;        // C
    row[3] = scheme;          // D
    row[4] = rep.price;       // E

    var cogs = ref ? ref.cogs : 0;
    row[5] = cogs;            // F

    var buyback = ref ? ref.buyback : 0;
    if (!buyback) buyback = 0.9;
    row[10] = buyback;        // K

    row[18] = rep.spp;        // S — баллы Ozon (доля СПП из «Репрайсера»)

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

      row[6] = salesPct; // G
      var commissionRub = salePrice * salesPct / 100;
      row[7] = Math.round(commissionRub * 100) / 100; // H
      row[8] = logForward; // I
      row[9] = logReturn;  // J
      var returnCost = (buyback > 0 && buyback < 1) ? logReturn * (1 - buyback) / buyback : 0;
      row[11] = Math.round(returnCost * 100) / 100; // L
      row[12] = lastMile;  // M
      row[13] = firstMile; // N
      row[14] = acq;       // O

      if (md.adv) row[15] = md.adv;   // P
      if (md.pack) row[16] = md.pack; // Q
      if (md.tax) row[17] = md.tax;   // R

      // T — доход баллы = E * S (доля)
      var pointsIncome = salePrice * rep.spp;
      row[19] = Math.round(pointsIncome * 100) / 100;

      // U — итого расходы Ozon
      var logWithBuyback = (buyback > 0) ? (logForward + lastMile) / buyback : (logForward + lastMile);
      var totalOzon = commissionRub + logWithBuyback + returnCost + firstMile + acq;
      row[20] = Math.round(totalOzon * 100) / 100;

      // V — итого расходы все
      var advCost = parseFloat(md.adv) || 0;
      var packCost = parseFloat(md.pack) || 0;
      var taxCost = parseFloat(md.tax) || 0;
      var totalCost = totalOzon + cogs + advCost + packCost + taxCost;
      row[21] = Math.round(totalCost * 100) / 100;

      // W — прибыль = E - V + T
      var profit = salePrice - totalCost + pointsIncome;
      row[22] = Math.round(profit * 100) / 100;

      // X — маржинальность %
      var margin = salePrice > 0 ? (profit / salePrice * 100) : 0;
      row[23] = Math.round(margin * 100) / 100;

      // Y — безубыток = V / (1 + S), S — доля СПП
      var sppFrac = rep.spp || 0;
      var minPrice = (sppFrac > 0) ? totalCost / (1 + sppFrac) : totalCost;
      row[24] = Math.round(minPrice * 100) / 100;

      // Z — объёмный вес
      row[25] = volWeight;
    }

    row[26] = rep.fbs || 0; // AA
    row[27] = rep.fbo || 0; // AB

    out.push(row);
  }

  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 28).clearContent();
  if (out.length > 0) sheet.getRange(2, 1, out.length, 28).setValues(out);

  logAction('Юнит экономика', 'ОК', 'Загружено: ' + out.length);
  showAlert('Готово', 'Юнит экономика рассчитана: ' + out.length + ' артикулов');
}
// =====================================================================
// 7. ABC-анализ за последний квартал
// Источник: /v2/finance/realization (выручка, количества) + Справочник (себестоимость)
// + Юнит экономика (маржинальность на единицу)
// ABC: A = 0-80% накопит., B = 80-95%, C = 95-100%
// =====================================================================
function runAbcAnalysis() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var refSheet = ss.getSheetByName('Справочник');
  var ueSheet = ss.getSheetByName('Юнит экономика');
  if (!refSheet) { showAlert('Ошибка', 'Лист «Справочник» не найден'); return; }

  // Определяем последний квартал: 3 месяца, заканчивая предыдущим месяцем
  var now = new Date();
  var year = now.getFullYear();
  var month = now.getMonth(); // 0-based; текущий месяц ещё не закончен
  if (month === 0) { year--; month = 12; }
  // month теперь = номер последнего полного месяца (1-based)
  var months = [];
  for (var i = 2; i >= 0; i--) {
    var m = month - i;
    var y = year;
    if (m <= 0) { m += 12; y--; }
    months.push({ year: y, month: m });
  }

  var quarterLabel = months[0].year + '-' + String(months[0].month).padStart(2, '0') + ' : ' +
                     months[2].year + '-' + String(months[2].month).padStart(2, '0');

  // 1. Загрузка себестоимости из Справочник
  var cogsMap = getOpiuCogsMap_(refSheet); // byOffer / byProduct

  // 2. Загрузка маржи на единицу из Юнит экономика (W = col 23, B = pid col 2)
  var profitPerUnit = {};
  var marginPctMap = {};
  if (ueSheet && ueSheet.getLastRow() >= 2) {
    var ueVals = ueSheet.getRange(2, 1, ueSheet.getLastRow() - 1, 24).getValues();
    for (var r = 0; r < ueVals.length; r++) {
      var offerKey = String(ueVals[r][0] || '').trim(); // A Offer ID
      var pid = String(ueVals[r][1] || '').trim();      // B Product ID
      var unitProfit = parseNumber_(ueVals[r][22]);     // W = прибыль
      var marginPct = parseNumber_(ueVals[r][23]);      // X = маржа %
      if (pid) {
        profitPerUnit[pid] = unitProfit;
        marginPctMap[pid] = marginPct;
      }
      if (offerKey) {
        profitPerUnit[offerKey] = unitProfit;
        marginPctMap[offerKey] = marginPct;
      }
    }
  }

  // 3. Сбор данных за каждый месяц квартала
  var productData = {}; // key = productId, value = { offerId, name, revenue, qty, cogs }

  for (var mi = 0; mi < months.length; mi++) {
    var ym = months[mi];
    try {
      var res = ozonApi('/v2/finance/realization', { year: ym.year, month: ym.month });
      var rows = (res && res.result && res.result.rows) || [];
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var item = row.item || {};
        var offerId = String(item.offer_id || '').trim();
        var productId = String(item.product_id || cogsMap.productByOffer[offerId] || '').trim();
        var sku = String(item.sku || item.id || '').trim();
        var itemName = item.name || item.offer_name || row.name || '';
        var key = productId || offerId || sku;
        if (!key) continue;

        var soldQty = row.delivery_commission ? parseNumber_(row.delivery_commission.quantity) : 0;
        var returnQty = row.return_commission ? parseNumber_(row.return_commission.quantity) : 0;
        var sellerPrice = parseNumber_(row.seller_price_per_instance);
        var deliveryAmount = sellerPrice * soldQty;
        var returnAmount = sellerPrice * returnQty;
        var priceAmount = Math.max(0, deliveryAmount - Math.abs(returnAmount)); // выручка
        var netQty = Math.max(0, soldQty - returnQty);

        if (!productData[key]) {
          productData[key] = {
            productId: productId,
            sku: sku,
            offerId: offerId,
            name: itemName,
            revenue: 0,
            qty: 0
          };
        }
        productData[key].revenue += priceAmount;
        productData[key].qty += netQty;
      }
    } catch (e) {
      Logger.log('ABC realization ' + ym.year + '-' + ym.month + ': ' + e.message);
    }
    Utilities.sleep(300);
  }

  // 4. Расчёт прибыли для каждого товара
  var items = [];
  for (var k in productData) {
    var d = productData[k];
    d.revenue = Math.round(d.revenue * 100) / 100;

    // Прибыль: если есть юнит-экономика — берём оттуда (на единицу × qty)
    // Иначе: выручка - себестоимость×qty (без комиссий, грубая оценка)
    var unitCogs = cogsMap.byProduct[d.productId] || cogsMap.byOffer[d.offerId] || 0;
    var totalCogs = unitCogs * d.qty;

    var unitProfit = profitPerUnit[d.productId] || profitPerUnit[d.offerId] || profitPerUnit[d.sku];
    var margin = marginPctMap[d.productId] || marginPctMap[d.offerId] || marginPctMap[d.sku];

    if (unitProfit && d.qty > 0) {
      // Прибыль через юнит-экономику (более точно с комиссиями)
      d.profit = Math.round(unitProfit * d.qty * 100) / 100;
    } else if (margin) {
      d.profit = Math.round(d.revenue * margin / 100 * 100) / 100;
    } else {
      d.profit = Math.round((d.revenue - totalCogs) * 100) / 100;
    }

    d.cogs = Math.round(totalCogs * 100) / 100;
    items.push(d);
  }

  if (items.length === 0) {
    showAlert('ABC-анализ', 'Нет данных за период ' + quarterLabel);
    return;
  }

  // 5. ABC по выручке
  var byRevenue = items.slice().sort(function(a, b) { return b.revenue - a.revenue; });
  var totalRevenue = byRevenue.reduce(function(s, d) { return s + d.revenue; }, 0);
  var cumPct = 0;
  for (var i = 0; i < byRevenue.length; i++) {
    cumPct += totalRevenue > 0 ? (byRevenue[i].revenue / totalRevenue * 100) : 0;
    byRevenue[i].revShare = totalRevenue > 0 ? Math.round(byRevenue[i].revenue / totalRevenue * 10000) / 100 : 0;
    byRevenue[i].revCumPct = Math.round(cumPct * 100) / 100;
    byRevenue[i].revClass = cumPct <= 80 ? 'A' : (cumPct <= 95 ? 'B' : 'C');
  }

  // 6. ABC по прибыли
  var byProfit = items.slice().sort(function(a, b) { return b.profit - a.profit; });
  var totalProfit = byProfit.reduce(function(s, d) { return s + d.profit; }, 0);
  cumPct = 0;
  for (var i = 0; i < byProfit.length; i++) {
    cumPct += totalProfit > 0 ? (byProfit[i].profit / totalProfit * 100) : 0;
    byProfit[i].profShare = totalProfit > 0 ? Math.round(byProfit[i].profit / totalProfit * 10000) / 100 : 0;
    byProfit[i].profCumPct = Math.round(cumPct * 100) / 100;
    byProfit[i].profClass = cumPct <= 80 ? 'A' : (cumPct <= 95 ? 'B' : 'C');
  }

  // Маппинг для объединения
  var profMap = {};
  byProfit.forEach(function(d) { profMap[d.productId || d.offerId || d.sku] = d; });

  // 7. Запись листа
  var sheetName = 'ABC-анализ';
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) sheet = ss.insertSheet(sheetName);

  // Заголовок
  var titleRow = [
    'ABC-анализ | Период: ' + quarterLabel + ' | ' + items.length + ' товаров | ' +
    'Выручка: ' + Math.round(totalRevenue) + ' ₽ | Прибыль: ' + Math.round(totalProfit) + ' ₽'
  ];

  // Очистка
  sheet.clearContents();
  sheet.clearFormats();

  // Заголовки
  var headers = [
    'Offer ID', 'Product ID', 'Название', 'Кол-во продаж',
    'Выручка, ₽', 'Доля %', 'Накопит. %', 'ABC (выручка)',
    'Прибыль, ₽', 'Доля %', 'Накопит. %', 'ABC (маржа)',
    'ABC комбиниров.'
  ];

  // Данные: берём сортировку по выручке (главный разрез), добавляем данные по прибыли
  var outRows = [];
  for (var i = 0; i < byRevenue.length; i++) {
    var d = byRevenue[i];
    var p = profMap[d.productId || d.offerId || d.sku] || {};
    var combined = '';
    var rc = d.revClass;
    var pc = p.profClass || '?';
    if (rc === 'A' && pc === 'A') combined = 'AA';
    else if (rc === 'A' && pc === 'B') combined = 'AB';
    else if (rc === 'B' && pc === 'A') combined = 'BA';
    else if (rc === 'B' && pc === 'B') combined = 'BB';
    else if (rc === 'C' || pc === 'C') combined = (rc === 'C' && pc === 'C') ? 'CC' : (rc + pc);

    outRows.push([
      d.offerId, d.productId, d.name, d.qty,
      d.revenue, d.revShare, d.revCumPct, rc,
      d.profit, p.profShare || 0, p.profCumPct || 0, pc,
      combined
    ]);
  }

  // Запись
  sheet.getRange(1, 1, 1, 1).setValue(titleRow[0]).setFontWeight('bold').setFontSize(12);
  sheet.getRange(1, 1, 1, 13).mergeAcross();
  sheet.getRange(2, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#4a148c').setFontColor('#ffffff').setHorizontalAlignment('center');
  sheet.setFrozenRows(2);

  if (outRows.length > 0) {
    sheet.getRange(3, 1, outRows.length, headers.length).setValues(outRows);
  }

  // Форматирование
  sheet.getRange(3, 5, outRows.length, 1).setNumberFormat('# ##0');       // Выручка
  sheet.getRange(3, 6, outRows.length, 2).setNumberFormat('0.00"%"');      // Доля выручки
  sheet.getRange(3, 9, outRows.length, 1).setNumberFormat('# ##0');       // Прибыль
  sheet.getRange(3, 10, outRows.length, 2).setNumberFormat('0.00"%"');     // Доля прибыли
  sheet.autoResizeColumns(1, headers.length);

  // Условное форматирование ABC
  var lastDataRow = outRows.length + 2;
  // ABC (выручка) — колонка H (8)
  applyAbcColor_(sheet, 8, 3, lastDataRow);
  // ABC (маржа) — колонка L (12)
  applyAbcColor_(sheet, 12, 3, lastDataRow);
  // ABC комбиниров. — колонка M (13)
  applyAbcColor_(sheet, 13, 3, lastDataRow);

  // Итоговая строка
  var totalRow = lastDataRow + 1;
  sheet.getRange(totalRow, 4).setValue('ИТОГО:');
  sheet.getRange(totalRow, 5).setFormula('=SUM(E3:E' + lastDataRow + ')').setNumberFormat('# ##0').setFontWeight('bold');
  sheet.getRange(totalRow, 9).setFormula('=SUM(I3:I' + lastDataRow + ')').setNumberFormat('# ##0').setFontWeight('bold');
  sheet.getRange(totalRow, 1, 1, headers.length).setBackground('#e0e0e0').setFontWeight('bold');

  logAction('ABC-анализ', 'ОК', 'Период: ' + quarterLabel + ', товаров: ' + items.length);
  showAlert('ABC-анализ готов',
    'Период: ' + quarterLabel + '\n' +
    'Товаров: ' + items.length + '\n' +
    'Выручка: ' + Math.round(totalRevenue) + ' ₽\n' +
    'Прибыль: ' + Math.round(totalProfit) + ' ₽');
}

function applyAbcColor_(sheet, col, firstRow, lastRow) {
  var range = sheet.getRange(firstRow, col, lastRow - firstRow + 1, 1);
  // A — зелёный, B — жёлтый, C — красный
  var rules = [
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('A')
      .setBackground('#c8e6c9')
      .setRanges([range])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('B')
      .setBackground('#fff9c4')
      .setRanges([range])
      .build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('C')
      .setBackground('#ffcdd2')
      .setRanges([range])
      .build()
  ];
  // Для комбинированной колонки — расширенные правила
  if (col === 13) {
    rules = [
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('AA')
        .setBackground('#a5d6a7')
        .setRanges([range])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('AB')
        .setBackground('#c8e6c9')
        .setRanges([range])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('BA')
        .setBackground('#c8e6c9')
        .setRanges([range])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('BB')
        .setBackground('#fff9c4')
        .setRanges([range])
        .build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenTextEqualTo('CC')
        .setBackground('#ffcdd2')
        .setRanges([range])
        .build()
    ];
  }
  sheet.setConditionalFormatRules(rules);
}
