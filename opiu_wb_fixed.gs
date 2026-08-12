// ============================================================
// ОПиУ WB — v2 (July 2026 rewrite)
// Simplified: month-only, direct API, no trigger chains
// ============================================================

var SPREADSHEET_ID = '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE';
var TZ = 'Europe/Moscow';
var SHEET_MONTH = 'ОПиУ месяц';
var SHEET_DICT = 'Справочник';
var SHEET_SETTINGS = 'Настройки';
var SHEET_RAW = 'ОПиУ WB сырьё';
var SHEET_LOG = 'ОПиУ импорт лог';

var MONTHS = ['янв.26','фев.26','мар.26','апр.26','май.26','июн.26','июл.26','авг.26','сен.26','окт.26','ноя.26','дек.26'];
var MONTH_LABELS = ['янв.26','фев.26','мар.26','апр.26','май.26','июн.26','июл.26','авг.26','сен.26','окт.26','ноя.26','дек.26'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('ОПиУ WB')
    .addItem('🔄 Обновить ОПиУ месяц', 'wbOpiuUpdate')
    .addItem('🗑 Очистить ОПиУ месяц', 'clearOpiuMonth')
    .addToUi();
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

function wbOpiuUpdate() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  // Use authorized user token (B3) — gives full data (2272 vs 86 rows)
  var token = getSetting_(ss, 'Токен авторизованного пользователя WB')
    || getSetting_(ss, 'API ключ WB (только чтение)');
  if (!token || token.length < 50) throw new Error('WB API токен не найден или некорректен');

  logMsg_(ss, '=== Старт обновления ОПиУ ===');

  // 1. Fetch ALL available data from reportDetailByPeriod
  var dateFrom = '2026-01-01';
  var dateTo = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  logMsg_(ss, 'Запрос: ' + dateFrom + ' → ' + dateTo);
  var allRows = fetchReportDetail_(token, dateFrom, dateTo);
  logMsg_(ss, 'Получено строк: ' + allRows.length);

  if (allRows.length === 0) {
    SpreadsheetApp.getUi().alert('Нет данных за период ' + dateFrom + ' — ' + dateTo);
    return;
  }

  // 2. Save raw rows to ОПиУ WB сырьё
  saveRawRows_(ss, allRows);

  // 3. Aggregate by month
  var costDict = loadCostDict_(ss);
  var monthly = aggregateByMonth_(allRows, costDict);

  // 4. Fetch ad expenses
  var adData = fetchAdExpenses_(token, dateFrom, dateTo);
  logMsg_(ss, 'Реклама: ' + adData.length + ' записей');
  mergeAdsIntoMonthly_(monthly, adData);

  // 5. Write to ОПиУ месяц
  writeOpiuMonth_(ss, monthly);

  // 6. Update settings
  setSetting_(ss, 'ОПиУ последняя загрузка', dateTo);
  setSetting_(ss, 'Источник ОПиУ WB', 'WB API reportDetailByPeriod');

  logMsg_(ss, '=== Готово ===');
}

// ============================================================
// CLEAR
// ============================================================

function clearOpiuMonth() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert('Очистить ОПиУ месяц?', 'Будут очищены все автозаполняемые ячейки. Продолжить?', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_MONTH);
  if (!sheet) return;

  // Clear data rows (B2:N30), keep col A labels
  sheet.getRange(2, 2, 29, 13).clearContent();

  // Clear raw sheet
  var rawSheet = ss.getSheetByName(SHEET_RAW);
  if (rawSheet && rawSheet.getLastRow() > 1) {
    rawSheet.getRange(2, 1, rawSheet.getLastRow() - 1, rawSheet.getLastColumn()).clearContent();
  }

  logMsg_(ss, 'ОПиУ месяц очищен');
}

// ============================================================
// API: reportDetailByPeriod
// ============================================================

function fetchReportDetail_(token, dateFrom, dateTo) {
  var url = 'https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod'
    + '?dateFrom=' + dateFrom + '&dateTo=' + dateTo
    + '&limit=100000&rrdid=0';

  for (var attempt = 0; attempt < 5; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: token },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var text = resp.getContentText();

    if (code === 204) return [];  // No data yet
    if (code >= 200 && code < 300) {
      if (!text) return [];
      var data = JSON.parse(text);
      return data || [];
    }
    if (code === 429 || code >= 500) {
      Utilities.sleep(5000 * (attempt + 1));
      continue;
    }
    throw new Error('WB API ' + code + ': ' + text.substring(0, 300));
  }
  throw new Error('WB API retry limit exceeded');
}

// ============================================================
// API: Ad expenses (adv/v1/upd)
// ============================================================

function fetchAdExpenses_(token, dateFrom, dateTo) {
  var url = 'https://advert-api.wildberries.ru/adv/v1/upd?from=' + dateFrom + '&to=' + dateTo;

  for (var attempt = 0; attempt < 3; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: token },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var text = resp.getContentText();

    if (code === 204) return [];
    if (code >= 200 && code < 300) {
      if (!text) return [];
      var data = JSON.parse(text);
      return Array.isArray(data) ? data : [];
    }
    if (code === 429 || code >= 500) {
      Utilities.sleep(5000 * (attempt + 1));
      continue;
    }
    // Don't throw on advert errors — just return empty
    logMsg_(SpreadsheetApp.openById(SPREADSHEET_ID), 'Реклама: HTTP ' + code);
    return [];
  }
  return [];
}

// ============================================================
// AGGREGATION
// ============================================================

function aggregateByMonth_(rows, costDict) {
  // Initialize all months
  var months = {};
  for (var i = 0; i < MONTHS.length; i++) {
    months[MONTHS[i]] = emptyMonth_();
  }

  for (var r = 0; r < rows.length; r++) {
    var x = rows[r];
    var dt = parseDate_(x.rr_dt || x.sale_dt || x.date_from || x.create_dt);
    if (!dt) continue;

    var monthKey = monthLabel_(dt);
    if (!months[monthKey]) continue;

    var d = months[monthKey];
    var op = String(x.supplier_oper_name || '').toLowerCase();
    var qty = Math.abs(num_(x.quantity));
    var nmId = String(x.nm_id || '').trim();

    // SALES
    if (op.indexOf('продажа') >= 0) {
      d.salesGross += Math.abs(num_(x.retail_amount));
      d.salesQty += qty;
      d.commission += Math.abs(num_(x.ppvz_sales_commission));
      d.acquiring += Math.abs(num_(x.acquiring_fee));
      d.cost += (costDict[nmId] || 0) * qty;
      d.rowCount++;
    }
    // RETURNS
    else if (op.indexOf('возврат') >= 0) {
      d.returns += Math.abs(num_(x.retail_amount));
      d.returnsQty += qty;
      d.cost -= (costDict[nmId] || 0) * qty;
    }
    // LOGISTICS (delivery to customer)
    else if (op.indexOf('логистика') >= 0) {
      d.logistics += Math.abs(num_(x.delivery_rub));
    }
    // REVERSE LOGISTICS (rebill / возмещение издержек)
    else if (op.indexOf('возмещение') >= 0 && op.indexOf('пвз') < 0) {
      d.rebillLogistics += Math.abs(num_(x.rebill_logistic_cost));
    }
    // STORAGE
    else if (op.indexOf('хранен') >= 0) {
      d.storage += Math.abs(num_(x.storage_fee));
    }
    // PENALTIES / FINES
    else if (op.indexOf('штраф') >= 0) {
      d.penalties += Math.abs(num_(x.penalty)) + Math.abs(num_(x.deduction));
    }
    // WITHHOLDING (удержание)
    else if (op.indexOf('удержан') >= 0) {
      d.penalties += Math.abs(num_(x.penalty)) + Math.abs(num_(x.deduction));
    }
    // PROCESSING (обработка товара)
    else if (op.indexOf('обработка') >= 0) {
      d.penalties += Math.abs(num_(x.penalty)) + Math.abs(num_(x.deduction));
    }
    // PVZ compensation (возмещение за выдачу и возврат товаров на ПВЗ)
    else if (op.indexOf('пвз') >= 0 || op.indexOf('выдачу') >= 0) {
      d.extraPay += Math.abs(num_(x.additional_payment));
    }
    // LOYALTY COMPENSATION (компенсация скидки по программе лояльности)
    else if (op.indexOf('лояльн') >= 0 || op.indexOf('компенсация скидки') >= 0) {
      d.extraPay += Math.abs(num_(x.additional_payment));
    }
    // VOLUNTARY COMPENSATION (добровольная компенсация при возврате)
    else if (op.indexOf('добровольн') >= 0) {
      d.extraPay += Math.abs(num_(x.additional_payment));
    }

    // These can appear on ANY operation type as additional fields
    d.penalties += Math.abs(num_(x.penalty)) + Math.abs(num_(x.deduction));
    d.acceptance += Math.abs(num_(x.acceptance));
    d.extraPay += Math.abs(num_(x.additional_payment));
  }

  return months;
}

function mergeAdsIntoMonthly_(months, adRows) {
  for (var i = 0; i < adRows.length; i++) {
    var ad = adRows[i];
    var dt = parseDate_(ad.updTime || ad.upd_time || ad.date);
    if (!dt) continue;
    var key = monthLabel_(dt);
    if (!months[key]) continue;
    months[key].ads += Math.abs(num_(ad.updSum || ad.upd_sum || ad.sum || ad.amount));
  }
}

// ============================================================
// WRITE TO SHEET
// ============================================================

function writeOpiuMonth_(ss, months) {
  var sheet = ss.getSheetByName(SHEET_MONTH);
  if (!sheet) throw new Error('Лист "ОПиУ месяц" не найден');

  // Read header to find month columns
  var header = sheet.getRange(1, 1, 1, 14).getValues()[0];
  var colByMonth = {};
  for (var c = 0; c < header.length; c++) {
    var h = String(header[c] || '').trim().toLowerCase();
    for (var m = 0; m < MONTHS.length; m++) {
      if (h === MONTHS[m]) { colByMonth[MONTHS[m]] = c + 1; break; }
    }
  }

  // Read row labels and find row numbers
  var lastRow = sheet.getLastRow();
  var labels = sheet.getRange(1, 1, lastRow, 1).getValues();
  var rowMap = {};   // label → first row
  var rowMap2 = {};  // label → second row (for duplicate "Валовая прибыль")

  for (var r = 0; r < labels.length; r++) {
    var name = String(labels[r][0] || '').trim();
    if (!name) continue;
    if (!rowMap[name]) rowMap[name] = r + 1;
    else if (!rowMap2[name]) rowMap2[name] = r + 1;
  }

  // Write each month column
  for (var mi = 0; mi < MONTHS.length; mi++) {
    var month = MONTHS[mi];
    var col = colByMonth[month];
    if (!col) continue;

    var d = months[month] || emptyMonth_();
    var netRev = d.salesGross - d.returns;
    var gp = netRev - d.cost;  // Gross profit
    var rr = d.commission + d.logistics + d.rebillLogistics + d.storage + d.ads + d.penalties + d.acceptance - d.extraPay + d.acquiring;
    var gpAfterRr = gp - rr;   // Gross profit after realization costs
    var opExp = getManualOpExp_(sheet, col, rowMap);
    var ebitda = gpAfterRr - opExp;
    var tax = d.salesGross * 0.07;  // 7% tax on gross sales
    var netProfit = ebitda - tax;

    // Write rows
    setVal_(sheet, rowMap['Выручка'], col, netRev);
    setVal_(sheet, rowMap['Продажи'], col, d.salesGross);
    setVal_(sheet, rowMap['Возвраты'], col, d.returns);
    setVal_(sheet, rowMap['Себестоимость проданных товаров'], col, d.cost);
    setVal_(sheet, rowMap['Валовая прибыль'], col, gp);

    setVal_(sheet, rowMap['Комиссия МП'], col, d.commission);
    setVal_(sheet, rowMap['Логистика'], col, d.logistics + d.rebillLogistics);  // Combined logistics
    setVal_(sheet, rowMap['Продвижение и реклама'], col, d.ads);
    setVal_(sheet, rowMap['Хранение'], col, d.storage);
    setVal_(sheet, rowMap['Прочие удержания МП'], col, d.penalties + d.acceptance);
    setVal_(sheet, rowMap['Доплаты МП'], col, -d.extraPay);
    setVal_(sheet, rowMap['Эквайринг'], col, d.acquiring);
    setVal_(sheet, rowMap['Расходы на реализацию'], col, rr);

    // Second "Валовая прибыль" row = GP after realization
    var gp2Row = rowMap2['Валовая прибыль'] || rowMap['Валовая прибыль'];
    setVal_(sheet, gp2Row, col, gpAfterRr);

    setVal_(sheet, rowMap['Рентабельность ВП'], col, netRev ? gpAfterRr / netRev : 0);
    setVal_(sheet, rowMap['Операционная прибыль (EBITDA)'], col, ebitda);
    setVal_(sheet, rowMap['Рентабельность ОП'], col, netRev ? ebitda / netRev : 0);
    setVal_(sheet, rowMap['Налоги'], col, tax);
    setVal_(sheet, rowMap['Чистая прибыль'], col, netProfit);
    setVal_(sheet, rowMap['Рентабельность ЧП'], col, netRev ? netProfit / netRev : 0);
  }

  // Recalculate ИТОГО column (col B = 2)
  var totalCol = 2;
  var sumRows = ['Выручка','Продажи','Возвраты','Себестоимость проданных товаров',
    'Комиссия МП','Логистика','Продвижение и реклама','Хранение',
    'Прочие удержания МП','Эквайринг','Расходы на реализацию',
    'Операционная прибыль (EBITDA)','Налоги','Чистая прибыль'];

  for (var s = 0; s < sumRows.length; s++) {
    var r = rowMap[sumRows[s]];
    if (r) sheet.getRange(r, totalCol).setFormula(
      '=SUM(' + sheet.getRange(r, 3, 1, 12).getA1Notation() + ')'
    );
  }

  // Доплаты — sum with sign
  if (rowMap['Доплаты МП']) {
    sheet.getRange(rowMap['Доплаты МП'], totalCol).setFormula(
      '=SUM(' + sheet.getRange(rowMap['Доплаты МП'], 3, 1, 12).getA1Notation() + ')'
    );
  }

  // Both Валовая прибыль rows
  if (rowMap['Валовая прибыль']) {
    sheet.getRange(rowMap['Валовая прибыль'], totalCol).setFormula(
      '=SUM(' + sheet.getRange(rowMap['Валовая прибыль'], 3, 1, 12).getA1Notation() + ')'
    );
  }
  if (gp2Row && gp2Row !== rowMap['Валовая прибыль']) {
    sheet.getRange(gp2Row, totalCol).setFormula(
      '=SUM(' + sheet.getRange(gp2Row, 3, 1, 12).getA1Notation() + ')'
    );
  }

  // Percent rows
  var rentVP = rowMap['Рентабельность ВП'];
  var rentOP = rowMap['Рентабельность ОП'];
  var rentNP = rowMap['Рентабельность ЧП'];
  var revRow = rowMap['Выручка'];
  var ebitdaRow = rowMap['Операционная прибыль (EBITDA)'];
  var netRow = rowMap['Чистая прибыль'];

  if (rentVP && gp2Row && revRow)
    setFormula_(sheet, rentVP, totalCol, '=IFERROR(' + a1_(gp2Row, totalCol) + '/' + a1_(revRow, totalCol) + ';0)');
  if (rentOP && ebitdaRow && revRow)
    setFormula_(sheet, rentOP, totalCol, '=IFERROR(' + a1_(ebitdaRow, totalCol) + '/' + a1_(revRow, totalCol) + ';0)');
  if (rentNP && netRow && revRow)
    setFormula_(sheet, rentNP, totalCol, '=IFERROR(' + a1_(netRow, totalCol) + '/' + a1_(revRow, totalCol) + ';0)');

  // Format
  formatSheet_(sheet, rowMap, gp2Row);
}

// ============================================================
// RAW DATA SHEET
// ============================================================

function saveRawRows_(ss, rows) {
  var sheet = ss.getSheetByName(SHEET_RAW);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_RAW);
    sheet.setHidden(true);
  }

  // Clear old data
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
  }

  if (rows.length === 0) return;

  // Build header from first row keys
  var keys = Object.keys(rows[0]).sort();
  var header = keys;
  sheet.getRange(1, 1, 1, header.length).setValues([header]);

  // Build data array
  var data = [];
  for (var i = 0; i < rows.length; i++) {
    var row = [];
    for (var k = 0; k < keys.length; k++) {
      row.push(rows[i][keys[k]] || '');
    }
    data.push(row);
  }

  sheet.getRange(2, 1, data.length, header.length).setValues(data);
  logMsg_(ss, 'Сырьё: ' + rows.length + ' строк на лист ' + SHEET_RAW);
}

// ============================================================
// UTILITIES
// ============================================================

function emptyMonth_() {
  return {
    salesGross: 0, returns: 0, salesQty: 0, returnsQty: 0,
    cost: 0, commission: 0, logistics: 0, rebillLogistics: 0,
    storage: 0, penalties: 0, acceptance: 0, extraPay: 0,
    acquiring: 0, ads: 0, rowCount: 0
  };
}

function loadCostDict_(ss) {
  var sh = ss.getSheetByName(SHEET_DICT);
  if (!sh) return {};
  var data = sh.getDataRange().getValues();
  var dict = {};
  for (var r = 1; r < data.length; r++) {
    var nm = String(data[r][1] || '').trim();  // Col B = nm_id / article
    if (nm) dict[nm] = num_(data[r][10]) || num_(data[r][11]) || 0;  // Col K or L
  }
  return dict;
}

function getManualOpExp_(sheet, col, rowMap) {
  var s = rowMap['Коммерческие расходы'];
  var e = rowMap['Прочие расходы'];
  if (!s || !e || e < s) return 0;
  var vals = sheet.getRange(s, col, e - s + 1, 1).getValues();
  var total = 0;
  for (var i = 0; i < vals.length; i++) total += num_(vals[i][0]);
  if (rowMap['Операционные расходы']) setVal_(sheet, rowMap['Операционные расходы'], col, total);
  return total;
}

function getSetting_(ss, name) {
  var sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) return '';
  var data = sh.getDataRange().getValues();
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][0] || '').trim() === name) return String(data[r][1] || '').trim();
  }
  return '';
}

function setSetting_(ss, name, value) {
  var sh = ss.getSheetByName(SHEET_SETTINGS);
  if (!sh) return;
  var data = sh.getDataRange().getValues();
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][0] || '').trim() === name) {
      sh.getRange(r + 1, 2).setValue(value);
      return;
    }
  }
  var lr = sh.getLastRow();
  sh.getRange(lr + 1, 1).setValue(name);
  sh.getRange(lr + 1, 2).setValue(value);
}

function logMsg_(ss, msg) {
  var sh = ss.getSheetByName(SHEET_LOG);
  if (!sh) return;
  var ts = Utilities.formatDate(new Date(), TZ, 'dd.MM.yyyy HH:mm:ss');
  sh.getRange(sh.getLastRow() + 1, 1, 1, 3).setValues([[ts, 'ОПиУ', msg]]);
}

function monthLabel_(date) {
  if (!date) return '';
  var m = date.getMonth();
  var y = String(date.getFullYear()).substring(2);
  return MONTHS[m] || '';
}

function parseDate_(v) {
  if (v instanceof Date) return v;
  if (!v) return null;
  var d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

function num_(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  var n = parseFloat(String(v).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function round2_(n) { return Math.round((n || 0) * 100) / 100; }
function setVal_(sheet, r, c, v) { if (r && c) sheet.getRange(r, c).setValue(round2_(v)); }
function setFormula_(sheet, r, c, f) { if (r && c) sheet.getRange(r, c).setFormula(f); }
function a1_(r, c) { return colLetter_(c) + r; }
function colLetter_(col) {
  var s = '';
  while (col > 0) { var m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = Math.floor((col - m) / 26); }
  return s;
}

function formatSheet_(sheet, rowMap, gp2Row) {
  var moneyRows = ['Выручка','Продажи','Возвраты','Себестоимость проданных товаров',
    'Валовая прибыль','Расходы на реализацию','Комиссия МП','Логистика',
    'Продвижение и реклама','Хранение','Прочие удержания МП','Доплаты МП',
    'Эквайринг','Операционные расходы','Операционная прибыль (EBITDA)','Налоги','Чистая прибыль'];

  for (var i = 0; i < moneyRows.length; i++) {
    if (rowMap[moneyRows[i]]) {
      sheet.getRange(rowMap[moneyRows[i]], 2, 1, 13).setNumberFormat('#,##0.00');
    }
  }
  if (gp2Row) sheet.getRange(gp2Row, 2, 1, 13).setNumberFormat('#,##0.00');

  var pctRows = ['Рентабельность ВП','Рентабельность ОП','Рентабельность ЧП'];
  for (var p = 0; p < pctRows.length; p++) {
    if (rowMap[pctRows[p]]) sheet.getRange(rowMap[pctRows[p]], 2, 1, 13).setNumberFormat('0.00%');
  }
}
