// ===== РЕПРАЙСЕР OZON v10.2 =====
// J (10) = СПП % = (I - M) / I
// K (11) = Кошелек % (вручную)
// L (12) = Цена с кошельком (из API)
// M (13) = L * (1 - K) — цена без кошелька
// N (14) = Индекс цен (из API)
// O (15) = Цвет индекса
// P (16) = Мин. цена конкурента
// V (22) = Остаток продавца (FBS)
// W (23) = Остаток Ozon (FBO)
// R (18) = G / (1 - J) / (1 - K) если P="С кошельком"
// R (18) = G / (1 - J) если P="Без кошелька"
// Логи: перетирать каждую 3 загрузку

var UPLOAD_COUNTER_KEY = 'repricer_upload_count';

function getConfig() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var settings = ss.getSheetByName('Настройки');
  return {
    clientId: settings.getRange('B3').getValue().toString().trim(),
    apiKey: settings.getRange('C3').getValue().toString().trim(),
    baseUrl: 'https://api-seller.ozon.ru',
    autoInterval: parseInt(settings.getRange('B6').getValue()) || 0
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

// Логирование с перетиранием каждую 3 загрузку
function logAction(action, status, details) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = ss.getSheetByName('Лог');
  if (!logSheet) return;

  var props = PropertiesService.getDocumentProperties();
  var count = parseInt(props.getProperty(UPLOAD_COUNTER_KEY) || '0');

  // Если это загрузка цен — инкремент счётчика
  if (action === 'Загрузка цен') {
    count++;
    props.setProperty(UPLOAD_COUNTER_KEY, count.toString());

    // Каждую 3 загрузку — перетереть лог
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
    .addSeparator()
    .addItem('3. Загрузить цены на Ozon', 'uploadPrices')
    .addSeparator()
    .addItem('📊 Полный цикл (1→2→3)', 'fullCycle')
    .addSeparator()
    .addItem('⏱ Включить автозапуск', 'enableAutoRun')
    .addItem('⏱ Выключить автозапуск', 'disableAutoRun')
    .addToUi();
}

// =====================================================================
// Автозапуск по расписанию (интервал из B6 «Настройки»)
// =====================================================================
function enableAutoRun() {
  var config = getConfig();
  var interval = config.autoInterval;
  if (!interval || interval < 1) {
    showAlert('Ошибка', 'Укажите интервал в минутах в ячейке B6 листа «Настройки»');
    return;
  }
  // Удалить старый триггер
  disableAutoRun(true);
  // Создать новый
  ScriptApp.newTrigger('fullCycle')
    .timeBased()
    .everyMinutes(interval)
    .create();
  logAction('Автозапуск', 'Включён', 'Интервал: ' + interval + ' мин.');
  showAlert('Автозапуск', 'Включён каждые ' + interval + ' мин.');
}

function disableAutoRun(silent) {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'fullCycle') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  if (!silent) {
    logAction('Автозапуск', 'Выключен', '');
    showAlert('Автозапуск', 'Выключен');
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
// 1. Загрузить товары (с сортировкой A→Z по Offer ID)
// =====================================================================
function loadOzonProducts() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();

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

  // Сохранить ручные данные
  var userData = {};
  if (lastRow >= 2) {
    for (var r = 2; r <= lastRow; r++) {
      var pid = sheet.getRange(r, 2).getValue();
      if (pid) userData[pid.toString()] = {
        rrc: sheet.getRange(r, 7).getValue(),     // G
        minP: sheet.getRange(r, 8).getValue(),     // H
        sppPct: sheet.getRange(r, 10).getValue(),  // J
        walletPct: sheet.getRange(r, 11).getValue(), // K
        model: sheet.getRange(r, 16).getValue(),   // P — Модель
        margin: sheet.getRange(r, 17).getValue()   // Q — Маржинальность
      };
    }
  }

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

  var success = 0, errors = 0;
  for (var i = 0; i < allItems.length; i++) {
    try {
      var item = allItems[i];
      var row = i + 2;
      if (photoMap[item.product_id]) sheet.getRange(row, 1).setFormula('=IMAGE("' + photoMap[item.product_id] + '")');
      sheet.getRange(row, 2).setValue(item.product_id);
      sheet.getRange(row, 3).setValue(item.offer_id || '');

      var name = '';
      try {
        var detail = ozonApi('/v1/product/info/description', { product_id: item.product_id });
        if (detail && detail.result) name = detail.result.name || '';
      } catch (e) {}
      sheet.getRange(row, 4).setValue(name);

      var saved = userData[item.product_id.toString()];
      if (saved) {
        if (saved.rrc) sheet.getRange(row, 7).setValue(saved.rrc);
        if (saved.minP) sheet.getRange(row, 8).setValue(saved.minP);
        // J (СПП %) не восстанавливаем — рассчитывается в пункте 2
        if (saved.walletPct) sheet.getRange(row, 11).setValue(saved.walletPct);
        if (saved.model) sheet.getRange(row, 16).setValue(saved.model);
        if (saved.margin) sheet.getRange(row, 17).setValue(saved.margin);
      }
      success++;
      if (i % 5 === 4) Utilities.sleep(1000);
    } catch (e) { errors++; }
  }
  logAction('Загрузка товаров', 'ОК', 'Загружено: ' + success + ', Ошибок: ' + errors);
  showAlert('Готово', 'Загружено: ' + success + '\nОтсортировано A→Z по Offer ID\nОшибок: ' + errors);
}

// =====================================================================
// 2. Цены + индекс + остатки (API)
// Заполняет: I (цена продавца), L (с кошельком), M (без кошелька),
//           J (СПП %), N (индекс цен), O (цвет),
//           V (остаток продавца FBS), W (остаток Ozon FBO)
// =====================================================================
function getOzonPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Загрузите товары'); return; }

  // --- Цены ---
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

  // --- Остатки (FBS + FBO) ---
  var stocksMap = {};
  try {
    var lastStockId = '';
    while (true) {
      var stockResult = ozonApi('/v3/product/info/stocks', {
        filter: { visibility: 'ALL' },
        limit: 100,
        last_id: lastStockId
      });
      if (!stockResult || !stockResult.result) break;
      var stockItems = stockResult.result.items || [];
      for (var si = 0; si < stockItems.length; si++) {
        var st = stockItems[si];
        if (st.product_id) {
          var fbs = 0, fbo = 0;
          var stocks = st.stocks || [];
          for (var sj = 0; sj < stocks.length; sj++) {
            var s = stocks[sj];
            var present = parseInt(s.present) || 0;
            var sType = (s.type || '').toUpperCase();
            if (sType === 'FBO') { fbo += present; }
            else if (sType === 'FBS' || sType === 'RFBS') { fbs += present; }
            else { fbs += present; } // неизвестный тип → продавец
          }
          stocksMap[st.product_id] = { fbs: fbs, fbo: fbo };
        }
      }
      lastStockId = stockResult.result.last_id || '';
      if (stockItems.length < 100 || !lastStockId) break;
    }
  } catch (e) {
    Logger.log('Остатки: ' + e.message);
  }

  var sPrice = 0, sIndex = 0, notFound = 0;
  for (var row = 2; row <= lastRow; row++) {
    var pid = sheet.getRange(row, 2).getValue();
    if (!pid) continue;
    var pd = priceMap[pid];
    if (!pd) { notFound++; continue; }

    // I (9) — Цена продавца
    var sellerPrice = parseFloat(pd.price && pd.price.price) || 0;
    sheet.getRange(row, 9).setValue(sellerPrice || '');
    sPrice++;

    // --- Индекс цен ---
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

    // N (14) — Индекс цен
    if (idxValue !== 0) sheet.getRange(row, 14).setValue(idxValue);
    // O (15) — Цвет индекса
    if (colorIdx) sheet.getRange(row, 15).setValue(colorIndexText(colorIdx));

    // --- L, M, J, N ---
    // L (12) — Цена с кошельком
    if (idxValue !== 0 && minCompPrice !== 0) {
      var wp = calcBuyerPrice(idxValue, minCompPrice);
      if (wp) {
        sheet.getRange(row, 12).setValue(wp);

        // M (13) — Цена без кошелька = L * (1 - K)
        var kVal = parseFloat(sheet.getRange(row, 11).getValue());
        var priceM = wp;
        if (kVal && !isNaN(kVal) && kVal > 0 && kVal < 1) {
          priceM = Math.round(wp * (1 - kVal));
        }
        sheet.getRange(row, 13).setValue(priceM);

        // J (10) — СПП % = (I - M) / I
        if (sellerPrice > 0 && priceM > 0) {
          var sppVal = (sellerPrice - priceM) / sellerPrice;
          if (sppVal < 0) sppVal = 0;
          sppVal = Math.round(sppVal * 10000) / 10000;
          sheet.getRange(row, 10).setValue(sppVal);
        }

        sIndex++;
      }
    }

    // --- Остатки ---
    // V (22) — Остаток продавца (FBS)
    // W (23) — Остаток Ozon (FBO)
    var stData = stocksMap[pid];
    if (stData) {
      sheet.getRange(row, 22).setValue(stData.fbs);
      sheet.getRange(row, 23).setValue(stData.fbo);
    } else {
      sheet.getRange(row, 22).setValue(0);
      sheet.getRange(row, 23).setValue(0);
    }
  }
  logAction('Цены + индекс + остатки', 'ОК', 'Цен: ' + sPrice + ', С кошельком: ' + sIndex + ', Не найдено: ' + notFound);
  showAlert('Готово', 'Цен: ' + sPrice + '\nС кошельком: ' + sIndex + '\nНе найдено: ' + notFound);
}

// =====================================================================
// 3. Рассчитать цены (вызывается из fullCycle)
// J = СПП % (уже заполнен в пункте 2)
// S = G / (1 - J) / (1 - K) если Q="С кошельком"
// S = G / (1 - J) если Q="Без кошелька"
// =====================================================================
function calculatePrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Расчёт цен ===');

  var actions = getAllBoostActions();
  var boostMap = getBoostCandidates(actions);

  var updated = 0;
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var rrc = parseFloat(sheet.getRange(row, 7).getValue());           // G — РРЦ
    var minPrice = parseFloat(sheet.getRange(row, 8).getValue());      // H — Мин. цена
    var sellerPrice = parseFloat(sheet.getRange(row, 9).getValue());   // I — Цена продавца
    var sppPct = parseFloat(sheet.getRange(row, 10).getValue());      // J — СПП %
    var walletPct = parseFloat(sheet.getRange(row, 11).getValue());    // K — Кошелек %
    var model = sheet.getRange(row, 16).getValue().toString().trim();  // P — Модель удержания (выпадающий)

    if (!sellerPrice && !rrc) continue;

    var basePrice = rrc || sellerPrice;

    // S (19) — Цена для загрузки
    var targetPrice = basePrice;

    var hasWallet = model.toLowerCase().indexOf('без кошелька') === -1; // по умолчанию с кошельком

    if (sppPct > 0 && sppPct < 1) {
      if (hasWallet && walletPct && walletPct > 0 && walletPct < 1) {
        // С кошельком: S = G / (1 - J) / (1 - K)
        targetPrice = targetPrice / (1 - sppPct) / (1 - walletPct);
      } else {
        // Без кошелька: S = G / (1 - J)
        targetPrice = targetPrice / (1 - sppPct);
      }
    }

    targetPrice = Math.round(targetPrice);
    if (minPrice && targetPrice < minPrice) targetPrice = minPrice;
    if (!targetPrice || targetPrice < 1) targetPrice = basePrice; // защита

    sheet.getRange(row, 18).setValue(targetPrice); // R — Цена для загрузки

    // U (21) — Бустинг + акции
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
// T = загруженная цена, U = статус
// =====================================================================
function uploadPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Репрайсер');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) { showAlert('Ошибка', 'Нет данных'); return; }

  Logger.log('=== Загрузка цен ===');

  // Собрать товары для обновления
  var prices = [];
  for (var row = 2; row <= lastRow; row++) {
    var productId = sheet.getRange(row, 2).getValue();
    var targetPrice = parseFloat(sheet.getRange(row, 18).getValue()); // R
    var currentPrice = parseFloat(sheet.getRange(row, 9).getValue()); // I
    if (!productId || !targetPrice) continue;
    if (currentPrice && Math.abs(targetPrice - currentPrice) < 1) {
      sheet.getRange(row, 20).setValue('⏭ Без изменений'); // T — Статус
      continue;
    }
    prices.push({ product_id: productId, price: targetPrice, row: row });
  }

  if (prices.length === 0) { showAlert('Готово', 'Нет товаров для обновления'); return; }

  // Шаг 1: Получить акции
  var actions = getAllBoostActions();
  var inActionMap = getProductsInActions(actions);
  var boostMap = getBoostCandidates(actions);

  // Шаг 2: Вывести из акций
  var removedCount = 0;
  for (var i = 0; i < prices.length; i++) {
    if (inActionMap[prices[i].product_id] && inActionMap[prices[i].product_id].length > 0) {
      removeFromActions(prices[i].product_id, actions);
      removedCount++;
    }
  }
  logAction('Загрузка цен', 'Вывод из акций', 'Выведено: ' + removedCount);
  Utilities.sleep(2000);

  // Шаг 3: Загрузить цены
  var totalOk = 0, totalErr = 0;
  for (var i = 0; i < prices.length; i += 100) {
    var batch = prices.slice(i, i + 100);
    var result = ozonApi('/v1/product/import/prices', {
      prices: batch.map(function(p) { return { product_id: p.product_id, price: p.price.toString() }; })
    });
    if (result && !result.code) {
      totalOk += batch.length;
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 19).setValue(batch[j].price);     // S — Загруженная цена
        sheet.getRange(batch[j].row, 20).setValue('✅ ' + batch[j].price + '₽'); // T — Статус
      }
    } else {
      totalErr += batch.length;
      var errMsg = result ? result.message || JSON.stringify(result) : 'ошибка';
      for (var j = 0; j < batch.length; j++) {
        sheet.getRange(batch[j].row, 20).setValue('❌ ' + errMsg); // T — Статус
      }
    }
    Utilities.sleep(500);
  }

  // Шаг 4: Проверить и добавить в акции
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

  // Обновить V
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
          sheet.getRange(prices[i].row, 21).setValue('✅ ' + boostPct + '% | в акции'); // U
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
