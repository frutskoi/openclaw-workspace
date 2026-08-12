/**
 * ОПИУ WB - Отчёт о прибылях и убытках
 *
 * Скрипты:
 * 1. wbOpiuFullUpdate() — полный цикл: импорт сырья → расчёт → заполнение ОПиУ
 * 2. importWbReports() — только импорт еженедельных отчётов из Drive
 * 3. fillOpiuWeekly() — заполнение листа "ОПиУ (недели)"
 * 4. fillOpiuMonthly() — заполнение листа "ОПиУ месяц"
 *
 * ID таблицы: 1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE
 */

// ============================================
// КОНСТАНТЫ
// ============================================

var SPREADSHEET_ID = '1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE';
var TZ = 'Europe/Moscow';

var SHEET_RAW = 'ОПиУ WB сырьё';
var SHEET_WEEKLY = 'ОПиУ (недели)';
var SHEET_MONTHLY = 'ОПиУ месяц';
var SHEET_REFERENCE = 'Справочник';
var SHEET_SETTINGS = 'Настройки';
var SHEET_IMPORT_LOG = 'ОПиУ импорт лог';

// Колонки листа "ОПиУ WB сырьё"
var RAW = {
  DATE: 0,        // A
  WEEK: 1,        // B
  MONTH: 2,       // C
  NM_ID: 3,       // D — Артикул WB
  SAUCE: 4,       // E — Артикул продавца
  REASON: 5,      // F — Обоснование
  SALES_GROSS: 6, // G
  RETURNS: 7,     // H
  SALES_QTY: 8,   // I
  RETURNS_QTY: 9, // J
  NET_REVENUE: 10,// K — К перечислению
  COMMISSION: 11, // L
  LOGISTICS: 12,  // M
  STORAGE: 13,    // N
  ADS: 14,        // O
  PENALTIES: 15,  // P
  EXTRA_PAY: 16,  // Q
  COGS: 17,       // R — Себестоимость
  SOURCE: 18,     // S
  FILE_ID: 19,    // T
  IMPORTED_AT: 20 // U
};

// Колонки листа "Справочник"
var REF = {
  NM_ID: 1,         // B — Артикул WB
  SELLER_SKU: 2,    // C — Артикул продавца
  NAME: 3,           // D
  COGS_KRASNOYARSK: 10, // K — Себестоимость Красноярск
  COGS_IVANOVO: 11,     // L — Себестоимость Иваново
  COMMISSION_PCT: 14    // O — % комиссии ВБ
};

// Колонки листа "ОПиУ (недели)"
var WK = {
  WEEK: 0,            // A
  SALES_GROSS: 1,     // B
  RETURNS: 2,         // C
  NET_REVENUE: 3,     // D
  SALES_QTY: 4,       // E
  RETURNS_QTY: 5,     // F
  COGS: 6,            // G
  GROSS_PROFIT: 7,    // H
  COMMISSION: 8,      // I
  LOGISTICS: 9,       // J
  STORAGE: 10,        // K
  ADS: 11,            // L
  PENALTIES: 12,      // M
  EXTRA_PAY: 13,      // N
  EBITDA: 14          // O
};

// ============================================
// ГЛАВНАЯ ФУНКЦИЯ — полный цикл
// ============================================

function wbOpiuFullUpdate() {
  log_('Запуск wbOpiuFullUpdate()');
  
  // 1. Импорт отчётов из Drive
  var imported = importWbReports();
  log_('Импортировано строк: ' + imported);
  
  // 2. Расчёт себестоимости из Справочника
  fillCogsFromReference();
  
  // 3. Заполнение недельного ОПиУ
  fillOpiuWeekly();
  
  // 4. Заполнение месячного ОПиУ
  fillOpiuMonthly();
  
  log_('wbOpiuFullUpdate() завершён');
}

// ============================================
// 1. ИМПОРТ ЕЖЕНЕДЕЛЬНЫХ ОТЧЁТОВ ИЗ DRIVE
// ============================================

function importWbReports() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheetRaw = ss.getSheetByName(SHEET_RAW);
  var sheetLog = ss.getSheetByName(SHEET_IMPORT_LOG);
  
  // Получаем ID папки из Настроек (строка 12, колонка B)
  var folderId = getSetting_('Папка отчётов WB ОПиУ');
  if (!folderId) {
    throw new Error('Не указана папка отчётов WB ОПиУ в Настройках');
  }
  
  var folder = DriveApp.getFolderById(folderId);
  
  // Собираем уже импортированные File IDs
  var lastRow = sheetRaw.getLastRow();
  var importedIds = {};
  if (lastRow >= 2) {
    var fileIds = sheetRaw.getRange(2, RAW.FILE_ID + 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < fileIds.length; i++) {
      if (fileIds[i][0]) importedIds[fileIds[i][0]] = true;
    }
  }
  
  // Ищем файлы отчётов
  var files = folder.getFiles();
  var newRows = [];
  var processedFiles = [];
  
  while (files.hasNext()) {
    var file = files.next();
    var fileId = file.getId();
    var fileName = file.getName();
    var mime = file.getMimeType();
    
    if (importedIds[fileId]) continue;
    
    try {
      var rows = parseReportFile_(file, mime);
      for (var r = 0; r < rows.length; r++) {
        rows[r][RAW.FILE_ID] = fileId;
        rows[r][RAW.SOURCE] = fileName;
        rows[r][RAW.IMPORTED_AT] = new Date();
        newRows.push(rows[r]);
      }
      processedFiles.push(fileName + ' (' + rows.length + ' строк)');
    } catch (e) {
      log_('Ошибка импорта ' + fileName + ': ' + e.message);
    }
  }
  
  // Запись в сырьё
  if (newRows.length > 0) {
    sheetRaw.getRange(lastRow + 1, 1, newRows.length, RAW.IMPORTED_AT + 1).setValues(newRows);
  }
  
  // Запись в лог импорта
  if (processedFiles.length > 0) {
    var logRow = [new Date(), processedFiles.length, newRows.length, processedFiles.join('; ')];
    sheetLog.appendRow(logRow);
  }
  
  return newRows.length;
}

/**
 * Парсинг файла отчёта WB (xlsx, csv, или google sheets)
 * Ожидаемые колонки: Дата, Артикул, Продажи, Возвраты, Комиссия, Логистика, Хранение, Реклама, Удержания, Доплаты
 */
function parseReportFile_(file, mime) {
  var rows = [];
  
  if (mime === MimeType.GOOGLE_SHEETS) {
    // Google Sheets — открываем напрямую
    var ss = SpreadsheetApp.openById(file.getId());
    var sheet = ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    rows = parseReportData_(data, file.getName());
  } else {
    // XLSX / CSV — через SpreadsheetApp импорт
    var blob = file.getBlob();
    var ss = SpreadsheetApp.open(blob);
    var sheet = ss.getSheets()[0];
    var data = sheet.getDataRange().getValues();
    rows = parseReportData_(data, file.getName());
  }
  
  return rows;
}

/**
 * Универсальный парсер: находит колонки по заголовкам и мапит в формат сырья
 */
function parseReportData_(data, fileName) {
  if (data.length < 2) return [];
  
  var headers = data[0];
  var colMap = {};
  
  // Нормализуем заголовки
  for (var c = 0; c < headers.length; c++) {
    var h = String(headers[c]).toLowerCase().trim();
    colMap[h] = c;
  }
  
  // Поиск колонки артикула
  var nmCol = findCol_(colMap, ['артикул', 'артикул продавца', 'nm id', 'nmid', 'товар', 'barcode']);
  var dateCol = findCol_(colMap, ['дата', 'период', 'неделя']);
  var salesGrossCol = findCol_(colMap, ['продажи', 'продажи gross', 'выручка', 'реализация']);
  var returnsCol = findCol_(colMap, ['возвраты', 'возврат']);
  var salesQtyCol = findCol_(colMap, ['продажи шт', 'количество продаж', 'шт продано']);
  var returnsQtyCol = findCol_(colMap, ['возвраты шт', 'шт возврат']);
  var netRevenueCol = findCol_(colMap, ['к перечислению', 'netto', 'выручка netto', 'перечислено']);
  var commissionCol = findCol_(colMap, ['комиссия', 'комиссия wb', 'комиссия мп']);
  var logisticsCol = findCol_(colMap, ['логистика', 'доставка', 'логистика wb']);
  var storageCol = findCol_(colMap, ['хранение', 'склад']);
  var adsCol = findCol_(colMap, ['реклама', 'реклама wb', 'рк']);
  var penaltiesCol = findCol_(colMap, ['удержания', 'штрафы', 'штраф', 'удержание']);
  var extraPayCol = findCol_(colMap, ['доплаты', 'доплата', 'компенсации']);
  var reasonCol = findCol_(colMap, ['обоснование', 'тип операции', 'операция']);
  
  var result = [];
  
  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var nmId = nmCol >= 0 ? String(row[nmCol]).trim() : '';
    if (!nmId || nmId === '') continue;
    
    var dateVal = dateCol >= 0 ? row[dateCol] : '';
    var dateObj = null;
    if (dateVal instanceof Date) {
      dateObj = dateVal;
    } else if (dateVal) {
      dateObj = parseDate_(String(dateVal));
    }
    
    // Если нет даты — берём дату из названия файла
    if (!dateObj) {
      dateObj = parseDateFromName_(fileName);
    }
    
    if (!dateObj) continue;
    
    var weekNum = getWeekNumber_(dateObj);
    var monthName = formatMonth_(dateObj);
    
    var rawRow = new Array(RAW.IMPORTED_AT + 1).fill('');
    rawRow[RAW.DATE] = dateObj;
    rawRow[RAW.WEEK] = weekNum;
    rawRow[RAW.MONTH] = monthName;
    rawRow[RAW.NM_ID] = nmId;
    rawRow[RAW.REASON] = reasonCol >= 0 ? String(row[reasonCol]) : '';
    rawRow[RAW.SALES_GROSS] = num_(salesGrossCol >= 0 ? row[salesGrossCol] : 0);
    rawRow[RAW.RETURNS] = num_(returnsCol >= 0 ? row[returnsCol] : 0);
    rawRow[RAW.SALES_QTY] = num_(salesQtyCol >= 0 ? row[salesQtyCol] : 0);
    rawRow[RAW.RETURNS_QTY] = num_(returnsQtyCol >= 0 ? row[returnsQtyCol] : 0);
    rawRow[RAW.NET_REVENUE] = num_(netRevenueCol >= 0 ? row[netRevenueCol] : 0);
    rawRow[RAW.COMMISSION] = num_(commissionCol >= 0 ? row[commissionCol] : 0);
    rawRow[RAW.LOGISTICS] = num_(logisticsCol >= 0 ? row[logisticsCol] : 0);
    rawRow[RAW.STORAGE] = num_(storageCol >= 0 ? row[storageCol] : 0);
    rawRow[RAW.ADS] = num_(adsCol >= 0 ? row[adsCol] : 0);
    rawRow[RAW.PENALTIES] = num_(penaltiesCol >= 0 ? row[penaltiesCol] : 0);
    rawRow[RAW.EXTRA_PAY] = num_(extraPayCol >= 0 ? row[extraPayCol] : 0);
    rawRow[RAW.COGS] = 0; // Будет заполнено из Справочника
    
    result.push(rawRow);
  }
  
  return result;
}

// ============================================
// 2. ЗАПОЛНЕНИЕ СЕБЕСТОИМОСТИ ИЗ СПРАВОЧНИКА
// ============================================

function fillCogsFromReference() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheetRaw = ss.getSheetByName(SHEET_RAW);
  var sheetRef = ss.getSheetByName(SHEET_REFERENCE);
  
  // Загружаем справочник себестоимости
  var refLastRow = sheetRef.getLastRow();
  if (refLastRow < 2) return;
  
  var refData = sheetRef.getRange(1, 1, refLastRow, REF.COMMISSION_PCT + 1).getValues();
  
  // Map: nmId → cogs
  var cogsMap = {};
  for (var i = 1; i < refData.length; i++) {
    var nmId = String(refData[i][REF.NM_ID]).trim();
    var cogsVal = refData[i][REF.COGS_KRASNOYARSK];
    if (nmId && cogsVal) {
      cogsMap[nmId] = num_(cogsVal);
    }
  }
  
  // Обновляем сырьё
  var lastRow = sheetRaw.getLastRow();
  if (lastRow < 2) return;
  
  var rawData = sheetRaw.getRange(2, 1, lastRow - 1, RAW.IMPORTED_AT + 1).getValues();
  var updated = false;
  
  for (var r = 0; r < rawData.length; r++) {
    var nmId = String(rawData[r][RAW.NM_ID]).trim();
    var salesQty = num_(rawData[r][RAW.SALES_QTY]);
    var returnsQty = num_(rawData[r][RAW.RETURNS_QTY]);
    var netQty = salesQty - returnsQty;
    
    if (cogsMap[nmId] !== undefined && netQty > 0) {
      var cogs = cogsMap[nmId] * netQty;
      rawData[r][RAW.COGS] = Math.round(cogs * 100) / 100;
      updated = true;
    }
  }
  
  if (updated) {
    sheetRaw.getRange(2, 1, lastRow - 1, RAW.IMPORTED_AT + 1).setValues(rawData);
  }
  
  log_('Себестоимость обновлена из Справочника: ' + Object.keys(cogsMap).length + ' SKU');
}

// ============================================
// 3. ЗАПОЛНЕНИЕ НЕДЕЛЬНОГО ОПиУ
// ============================================

function fillOpiuWeekly() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheetRaw = ss.getSheetByName(SHEET_RAW);
  var sheetWk = ss.getSheetByName(SHEET_WEEKLY);
  
  var lastRow = sheetRaw.getLastRow();
  if (lastRow < 2) {
    log_('fillOpiuWeekly: нет данных в сырье');
    return;
  }
  
  var rawData = sheetRaw.getRange(2, 1, lastRow - 1, RAW.IMPORTED_AT + 1).getValues();
  
  // Группировка по неделям
  var weekData = {};
  var weekLabels = [];
  
  for (var r = 0; r < rawData.length; r++) {
    var row = rawData[r];
    var week = String(row[RAW.WEEK]);
    if (!week || week === '') continue;
    
    if (!weekData[week]) {
      weekData[week] = {
        salesGross: 0, returns: 0, netRevenue: 0,
        salesQty: 0, returnsQty: 0,
        cogs: 0, commission: 0, logistics: 0,
        storage: 0, ads: 0, penalties: 0, extraPay: 0
      };
      weekLabels.push(week);
    }
    
    var w = weekData[week];
    w.salesGross += num_(row[RAW.SALES_GROSS]);
    w.returns += num_(row[RAW.RETURNS]);
    w.netRevenue += num_(row[RAW.NET_REVENUE]);
    w.salesQty += num_(row[RAW.SALES_QTY]);
    w.returnsQty += num_(row[RAW.RETURNS_QTY]);
    w.cogs += num_(row[RAW.COGS]);
    w.commission += num_(row[RAW.COMMISSION]);
    w.logistics += num_(row[RAW.LOGISTICS]);
    w.storage += num_(row[RAW.STORAGE]);
    w.ads += num_(row[RAW.ADS]);
    w.penalties += num_(row[RAW.PENALTIES]);
    w.extraPay += num_(row[RAW.EXTRA_PAY]);
  }
  
  // Сортировка недель
  weekLabels.sort();
  
  // Очистка и заполнение
  var headerRow = sheetWk.getRange(1, 1, 1, WK.EBITDA + 1).getValues()[0];
  var existingLastRow = sheetWk.getLastRow();
  if (existingLastRow > 1) {
    sheetWk.getRange(2, 1, existingLastRow - 1, WK.EBITDA + 1).clearContent();
  }
  
  var output = [];
  for (var wi = 0; wi < weekLabels.length; wi++) {
    var w = weekData[weekLabels[wi]];
    var grossProfit = w.netRevenue - w.cogs;
    var ebitda = grossProfit - w.commission - w.logistics - w.storage - w.ads - w.penalties + w.extraPay;
    
    output.push([
      weekLabels[wi],
      round2_(w.salesGross),
      round2_(w.returns),
      round2_(w.netRevenue),
      w.salesQty,
      w.returnsQty,
      round2_(w.cogs),
      round2_(grossProfit),
      round2_(w.commission),
      round2_(w.logistics),
      round2_(w.storage),
      round2_(w.ads),
      round2_(w.penalties),
      round2_(w.extraPay),
      round2_(ebitda)
    ]);
  }
  
  if (output.length > 0) {
    sheetWk.getRange(2, 1, output.length, WK.EBITDA + 1).setValues(output);
  }
  
  log_('Недельный ОПиУ заполнен: ' + output.length + ' недель');
}

// ============================================
// 4. ЗАПОЛНЕНИЕ МЕСЯЧНОГО ОПиУ
// ============================================

function fillOpiuMonthly() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheetRaw = ss.getSheetByName(SHEET_RAW);
  var sheetMo = ss.getSheetByName(SHEET_MONTHLY);
  
  var lastRow = sheetRaw.getLastRow();
  if (lastRow < 2) {
    log_('fillOpiuMonthly: нет данных в сырье');
    return;
  }
  
  var rawData = sheetRaw.getRange(2, 1, lastRow - 1, RAW.IMPORTED_AT + 1).getValues();
  
  // Группировка по месяцам (формат "YYYY-MM")
  var monthData = {};
  var monthLabels = [];
  
  for (var r = 0; r < rawData.length; r++) {
    var row = rawData[r];
    var month = String(row[RAW.MONTH]);
    if (!month || month === '') continue;
    
    if (!monthData[month]) {
      monthData[month] = {
        salesGross: 0, returns: 0, netRevenue: 0,
        salesQty: 0, returnsQty: 0,
        cogs: 0, commission: 0, logistics: 0,
        storage: 0, ads: 0, penalties: 0, extraPay: 0
      };
      monthLabels.push(month);
    }
    
    var m = monthData[month];
    m.salesGross += num_(row[RAW.SALES_GROSS]);
    m.returns += num_(row[RAW.RETURNS]);
    m.netRevenue += num_(row[RAW.NET_REVENUE]);
    m.salesQty += num_(row[RAW.SALES_QTY]);
    m.returnsQty += num_(row[RAW.RETURNS_QTY]);
    m.cogs += num_(row[RAW.COGS]);
    m.commission += num_(row[RAW.COMMISSION]);
    m.logistics += num_(row[RAW.LOGISTICS]);
    m.storage += num_(row[RAW.STORAGE]);
    m.ads += num_(row[RAW.ADS]);
    m.penalties += num_(row[RAW.PENALTIES]);
    m.extraPay += num_(row[RAW.EXTRA_PAY]);
  }
  
  monthLabels.sort();
  
  // Месячный ОПиУ: строки — статьи, колонки — месяцы
  // Строки: Выручка, Продажи, Возвраты, Себестоимость, Валовая прибыль,
  //         Комиссия МП, Логистика, Хранение, Реклама, Удержания, Доплаты, EBITDA
  
  var articles = [
    'Выручка',
    'Продажи gross',
    'Возвраты',
    'Себестоимость проданных товаров',
    'Валовая прибыль',
    'Расходы на реализацию',
    'Комиссия МП',
    'Логистика',
    'Хранение',
    'Реклама',
    'Удержания/штрафы',
    'Доплаты',
    'Операционная прибыль (EBITDA)',
    'Рентабельность ОП'
  ];
  
  // Колонки: B = ИТОГО, C..N = янв..дек
  var numMonths = monthLabels.length;
  var totalCols = 2 + Math.max(numMonths, 12); // min 12 months
  var data = [];
  
  for (var a = 0; a < articles.length; a++) {
    var rowOut = new Array(totalCols).fill(0);
    rowOut[0] = articles[a];
    
    var grandTotal = 0;
    
    for (var mi = 0; mi < monthLabels.length; mi++) {
      var m = monthData[monthLabels[mi]];
      var colIdx = mi + 2; // B=1 (итого), C=2 (first month)
      var val = 0;
      
      switch (a) {
        case 0: val = m.netRevenue; break;
        case 1: val = m.salesGross; break;
        case 2: val = m.returns; break;
        case 3: val = m.cogs; break;
        case 4: val = m.netRevenue - m.cogs; break;
        case 5: val = m.commission + m.logistics + m.storage + m.ads + m.penalties - m.extraPay; break;
        case 6: val = m.commission; break;
        case 7: val = m.logistics; break;
        case 8: val = m.storage; break;
        case 9: val = m.ads; break;
        case 10: val = m.penalties; break;
        case 11: val = m.extraPay; break;
        case 12: val = m.netRevenue - m.cogs - m.commission - m.logistics - m.storage - m.ads - m.penalties + m.extraPay; break;
        case 13: val = 0; break; // рентабельность — формула ниже
      }
      
      rowOut[colIdx] = round2_(val);
      grandTotal += val;
    }
    
    if (a === 13) {
      // Рентабельность = EBITDA / Выручка
      // Оставим 0, формула будет добавлена ниже
    } else {
      rowOut[1] = round2_(grandTotal);
    }
    
    data.push(rowOut);
  }
  
  // Очистка и запись
  var existingLastRow = sheetMo.getLastRow();
  if (existingLastRow > 1) {
    sheetMo.getRange(2, 1, existingLastRow - 1, totalCols).clearContent();
  }
  
  // Заголовок: месяцы в C..N
  var headerOut = sheetMo.getRange(1, 1, 1, totalCols).getValues()[0];
  headerOut[0] = 'СТАТЬЯ';
  headerOut[1] = 'ИТОГО';
  for (var mi = 0; mi < 12; mi++) {
    headerOut[mi + 2] = monthLabels[mi] || '';
  }
  sheetMo.getRange(1, 1, 1, totalCols).setValues([headerOut]);
  
  if (data.length > 0) {
    sheetMo.getRange(2, 1, data.length, totalCols).setValues(data);
  }
  
  // Добавляем формулу рентабельности
  var ebitdaRow = articles.indexOf('Операционная прибыль (EBITDA)') + 2;
  var revenueRow = articles.indexOf('Выручка') + 2;
  
  // Рентабельность ОП
  var rentRow = articles.indexOf('Рентабельность ОП') + 2;
  for (var c = 1; c < totalCols; c++) {
    var colLetter = columnLetter_(c);
    sheetMo.getRange(rentRow, c + 1).setFormula(
      '=IF(' + colLetter + revenueRow + '=0,0,' + colLetter + ebitdaRow + '/' + colLetter + revenueRow + ')'
    );
  }
  
  log_('Месячный ОПиУ заполнен: ' + monthLabels.length + ' месяцев');
}

// ============================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
// ============================================

function findCol_(colMap, names) {
  for (var i = 0; i < names.length; i++) {
    var key = names[i].toLowerCase().trim();
    if (colMap[key] !== undefined) return colMap[key];
  }
  return -1;
}

function num_(val) {
  if (val === '' || val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  var s = String(val).replace(/\s/g, '').replace(',', '.').replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : n;
}

function round2_(val) {
  return Math.round(val * 100) / 100;
}

function getWeekNumber_(date) {
  var d = new Date(date);
  d.setHours(0, 0, 0, 0);
  // ISO week: Thursday-based
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  var week1 = new Date(d.getFullYear(), 0, 4);
  var weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return d.getFullYear() + '-W' + (weekNum < 10 ? '0' : '') + weekNum;
}

function formatMonth_(date) {
  var d = new Date(date);
  var y = d.getFullYear();
  var m = d.getMonth() + 1;
  return y + '-' + (m < 10 ? '0' : '') + m;
}

function parseDate_(str) {
  // DD.MM.YYYY or YYYY-MM-DD or DD/MM/YYYY
  str = str.trim();
  var parts;
  
  if (str.match(/^\d{4}-\d{2}-\d{2}$/)) {
    parts = str.split('-');
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
  }
  if (str.match(/^\d{1,2}\.\d{1,2}\.\d{4}$/)) {
    parts = str.split('.');
    return new Date(parseInt(parts[2]), parseInt(parts[1]) - 1, parseInt(parts[0]));
  }
  if (str.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
    parts = str.split('/');
    return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
  }
  
  var parsed = Date.parse(str);
  if (!isNaN(parsed)) return new Date(parsed);
  
  return null;
}

function parseDateFromName_(fileName) {
  // Пытаемся найти дату в названии файла
  var match = fileName.match(/(\d{4})[-._]?(\d{2})[-._]?(\d{2})/);
  if (match) {
    return new Date(parseInt(match[1]), parseInt(match[2]) - 1, parseInt(match[3]));
  }
  match = fileName.match(/(\d{2})[-._](\d{2})[-._](\d{4})/);
  if (match) {
    return new Date(parseInt(match[3]), parseInt(match[2]) - 1, parseInt(match[1]));
  }
  return null;
}

function getSetting_(name) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_SETTINGS);
  var data = sheet.getDataRange().getValues();
  
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === name) {
      return String(data[i][1]).trim();
    }
  }
  return '';
}

function log_(msg) {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName('Лог');
  if (sheet) {
    sheet.appendRow([new Date(), 'ОПИУ', msg]);
  }
  console.log(msg);
}

function columnLetter_(colIndex) {
  // 0-based → A1 notation letter
  var letter = '';
  colIndex++;
  while (colIndex > 0) {
    var rem = (colIndex - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    colIndex = Math.floor((colIndex - 1) / 26);
  }
  return letter;
}

// ============================================
// ФУНКЦИЯ ДЛЯ РУЧНОГО ТЕСТА
// ============================================

function showOpiuInfo() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var ui = SpreadsheetApp.getUi();
  
  var sheetRaw = ss.getSheetByName(SHEET_RAW);
  var rows = sheetRaw.getLastRow() - 1;
  var folderId = getSetting_('Папка отчётов WB ОПиУ');
  
  var msg = 'ОПиУ WB\n\n' +
    'Сырьё: ' + rows + ' строк\n' +
    'Папка отчётов: ' + (folderId || 'НЕ УКАЗАНА') + '\n' +
    'Справочник: ' + (ss.getSheetByName(SHEET_REFERENCE).getLastRow() - 1) + ' SKU\n\n' +
    'Запуск: wbOpiuFullUpdate()';
  
  ui.alert('ОПИУ', msg, ui.ButtonSet.OK);
}
