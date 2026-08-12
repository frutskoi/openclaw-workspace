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
