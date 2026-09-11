// ============================================================
// База по API — еженедельный WB-отчёт в структуре ИП Малахова
// Листы: База (сырьё v5 API + формулы), Отчёт по размерам,
// Отчёт по артикулам, Себестоимость, справка, DASHBOARD
// ============================================================

var BAZA_SHEET = 'База';
var BAZA_RAZM = 'Отчёт по размерам';
var BAZA_ART = 'Отчёт по артикулам';
var BAZA_SEB = 'Себестоимость';
var BAZA_SPR = 'справка';
var BAZA_DASH = 'DASHBOARD';
var BAZA_MAX_FORMULA_ROWS = 5000;
var BAZA_N = 5001; // последняя строка данных Базы (обновляется в bazaUpdate)

function bazaUpdate() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var token = getSetting_(ss, 'Токен авторизованного пользователя WB')
    || getSetting_(ss, 'API ключ WB (только чтение)');
  if (!token || token.length < 50) throw new Error('WB API токен не найден');

  var dateTo = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  // Период загрузки. Пусто/«неделя» (по умолчанию) = последняя закрытая отчётная неделя WB (пт–чт).
  // Число дней N = последние N дней от сегодня (для первичной загрузки, напр. 250).
  var perSet = String(getSetting_(ss, 'База: период загрузки') || '').trim().toLowerCase();
  var from, periodLabel;
  var daysBack = Number(perSet);
  if (perSet === '' || perSet === 'неделя' || isNaN(daysBack)) {
    // последняя закрытая отчётная неделя WB: пн–вс (как в еженедельном отчёте о реализации, эталон 15.07–21.07)
    var now = new Date();
    var dow = now.getDay(); // 0=вс ... 1=пн
    var daysSinceSun = (dow === 0) ? 0 : dow;
    var lastSun = new Date(now.getTime() - daysSinceSun * 86400000);
    var lastMon = new Date(lastSun.getTime() - 6 * 86400000);
    from = Utilities.formatDate(lastMon, TZ, 'yyyy-MM-dd');
    dateTo = Utilities.formatDate(lastSun, TZ, 'yyyy-MM-dd');
    periodLabel = 'неделя ' + from + ' – ' + dateTo;
  } else {
    daysBack = Math.max(1, Math.min(daysBack, 730));
    from = Utilities.formatDate(new Date(Date.now() - daysBack * 86400000), TZ, 'yyyy-MM-dd');
    periodLabel = daysBack + ' дн. с ' + from;
  }
  logMsg_(ss, 'База: сбор данных ' + from + ' → ' + dateTo + ' (' + periodLabel + ')');

  // --- ФАЗА 1: только чтение API, никаких записей в таблицу ---
  var weeks = [];
  var d = new Date(from + 'T00:00:00+03:00');
  var dend = new Date(dateTo + 'T00:00:00+03:00');
  while (d < dend) {
    var cs = Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
    var ce = new Date(d.getTime() + 6 * 86400000);
    if (ce > dend) ce = dend;
    weeks.push([cs, Utilities.formatDate(ce, TZ, 'yyyy-MM-dd')]);
    d = new Date(ce.getTime() + 86400000);
  }

  var t0 = new Date().getTime();
  var TIMEBOX = 4.5 * 60 * 1000; // 4.5 мин из 6-мин лимита Apps Script
  var allRows = [];
  var okUntil = from, stopped = '';
  for (var w = 0; w < weeks.length; w++) {
    if (new Date().getTime() - t0 > TIMEBOX) { stopped = 'лимит времени'; break; }
    try {
      var rows = bazaFetchChunk_(token, weeks[w][0], weeks[w][1]);
      if (rows.length) allRows = allRows.concat(rows);
      okUntil = weeks[w][1];
      setSetting_(ss, 'База: загружено до', okUntil);
    } catch (e) {
      stopped = 'WB API: ' + e.message;
      break;
    }
    if (w < weeks.length - 1) Utilities.sleep(6000);
  }

  // дедуп по rrd_id
  var lastMax = Number(getSetting_(ss, 'База: max rrd_id') || '0');
  var maxRrd = lastMax, fresh = [];
  for (var i = 0; i < allRows.length; i++) {
    var rid = Number(allRows[i].rrd_id || 0);
    if (rid > lastMax) { fresh.push(allRows[i]); if (rid > maxRrd) maxRrd = rid; }
  }
  logMsg_(ss, 'База: получено ' + allRows.length + ' строк API, новых ' + fresh.length + (stopped ? ', стоп: ' + stopped : ''));

  // --- ФАЗА 2: одна пакетная запись ---
  var sh = ss.getSheetByName(BAZA_SHEET);
  if (!sh) { bazaEnsureSheets_(ss, 50, 10, 10); sh = ss.getSheetByName(BAZA_SHEET); }
  // листы отчётов/DASHBOARD создаём/расширяем ВСЕГДА, даже если строк 0
  var haveBc = 10, haveArt = 10;
  if (sh.getLastRow() > 1) {
    var bcSet = {}, artSet = {};
    var bcA = sh.getRange(2, 41, sh.getLastRow() - 1, 1).getValues();
    var alA = sh.getRange(2, 38, sh.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < bcA.length; i++) {
      if (String(bcA[i][0] || '').trim()) bcSet[bcA[i][0]] = 1;
      if (String(alA[i][0] || '').trim()) artSet[alA[i][0]] = 1;
    }
    haveBc = Math.max(10, Object.keys(bcSet).length);
    haveArt = Math.max(10, Object.keys(artSet).length);
  }
  bazaEnsureSheets_(ss, Math.max(sh.getLastRow(), 50), haveBc, haveArt);
  var added = 0;
  if (fresh.length) {
    var res = bazaAppend_(ss, sh, fresh);
    added = res.added;
  }

  // --- ФАЗА 3: фиксируем настройки одним пакетом ---
  var ranges = [];
  setSetting_(ss, 'База: загружено до', okUntil);
  setSetting_(ss, 'База последняя загрузка', dateTo);
  if (maxRrd > lastMax) setSetting_(ss, 'База: max rrd_id', String(maxRrd));
  logMsg_(ss, 'База: готово, +' + added + ' строк');
  try { bazaAdsUpdate(); } catch (e) { logMsg_(ss, 'Реклама: пропущена (' + e.message + ')'); }
  var msg = 'Готово. Новых строк в Базу: ' + added + (added === 0 ? ' (всё актуально).' : '.');
  if (stopped) msg += '\n\nЗагружено по: ' + okUntil + '. Причина остановки: ' + stopped + '.\nПодождите 10-15 минут и запустите пункт меню ещё раз.\nЕсли авто-цикл репрайсера активен (кнопка 30 мин / 1 час) — остановите его на время первичной загрузки: они делят один лимит WB.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
}

// Дописывает строки в Базу, расширяет отчёты и Себестоимость. Возвращает {added}.
function bazaAppend_(ss, sh, fresh) {
  var n = fresh.length;
  var startRow = sh.getLastRow() + 1;
  if (startRow < 2) startRow = 2;
  var wantLast = startRow + n - 1;
  if (wantLast > BAZA_MAX_FORMULA_ROWS + 1) throw new Error('База заполнена до лимита ' + (BAZA_MAX_FORMULA_ROWS + 1) + ' строк');
  if (sh.getMaxRows() < wantLast + 5) sh.insertRowsAfter(sh.getMaxRows(), wantLast + 5 - sh.getMaxRows());

  // кумулятивные уникальные (старые + свежие)
  var uniqBc = {}, uniqArt = {};
  var oldLast = startRow - 1;
  if (oldLast >= 2) {
    var bcCol = sh.getRange(2, 41, oldLast - 1, 1).getValues();  // AO Баркод
    var alCol = sh.getRange(2, 38, oldLast - 1, 1).getValues();  // AL Артикул
    for (var i = 0; i < bcCol.length; i++) {
      var b0 = String(bcCol[i][0] || '').trim(); if (b0) uniqBc[b0] = 1;
      var a0 = String(alCol[i][0] || '').trim(); if (a0) uniqArt[a0] = 1;
    }
  }
  for (var i = 0; i < n; i++) {
    var bc = String(fresh[i].barcode || '').trim(), ar = String(fresh[i].sa_name || '').trim();
    if (bc) uniqBc[bc] = 1;
    if (ar) uniqArt[ar] = 1;
  }
  bazaEnsureSheets_(ss, wantLast, Object.keys(uniqBc).length, Object.keys(uniqArt).length);

  // сырьё
  var raw = [];
  for (var i = 0; i < n; i++) raw.push(bazaMapRow_(fresh[i], startRow - 1 + i));
  for (var s = 0; s < n; s += 500) {
    sh.getRange(startRow + s, 33, Math.min(500, n - s), 59).setValues(raw.slice(s, s + 500));
  }
  // формулы
  var f = [];
  for (var r = startRow; r < startRow + n; r++) f.push(bazaFormulaRow_(r));
  for (var s = 0; s < n; s += 500) {
    sh.getRange(startRow + s, 1, Math.min(500, n - s), 32).setFormulas(f.slice(s, s + 500));
  }
  SpreadsheetApp.flush();

  bazaWriteSeb_(ss, fresh);
  setSetting_(ss, 'База: уник. баркодов', String(Object.keys(uniqBc).length));
  setSetting_(ss, 'База: уник. артикулов', String(Object.keys(uniqArt).length));
  return { added: n, lastRow: wantLast };
}

// ============================================================
// FETCH: одна неделя, пагинация rrd_id, мягкие ретраи
// ============================================================
function bazaFetchChunk_(token, dateFrom, dateTo) {
  var all = [], rrdid = 0, limit = 100000, guard = 0;
  while (guard++ < 50) {
    var url = 'https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod'
      + '?dateFrom=' + dateFrom + '&dateTo=' + dateTo + '&limit=' + limit + '&rrdid=' + rrdid;
    var data = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      var resp = UrlFetchApp.fetch(url, { method: 'get', headers: { Authorization: token }, muteHttpExceptions: true });
      var code = resp.getResponseCode(), text = resp.getContentText();
      if (code === 204) return all;
      if (code >= 200 && code < 300) { data = text ? JSON.parse(text) : []; break; }
      if (code === 429 || code >= 500) { Utilities.sleep(20000 * (attempt + 1)); continue; }
      throw new Error('WB API ' + code + ': ' + text.substring(0, 200));
    }
    if (data === null) throw new Error('WB держит рейт-лимит (429), нужно подождать 10-15 минут');
    if (!data.length) break;
    all = all.concat(data);
    if (data.length < limit) break;
    rrdid = data[data.length - 1].rrd_id || 0;
    if (!rrdid) break;
    Utilities.sleep(6000);
  }
  return all;
}

// ============================================================
// RAW ROW MAPPER → колонки AG..CM
// ============================================================
function bazaMapRow_(r, idx) {
  var oper = String(r.supplier_oper_name || '');
  var isRet = /Возврат/i.test(oper) || (num_(r.quantity) < 0 && /Продажа/i.test(oper) === false);
  function s(v) { return v === null || v === undefined ? '' : String(v); }
  function abs(v) { var x = num_(v); return isRet ? Math.abs(x) : x; }
  return [
    idx,                                            // AG №
    num_(r.realizationreport_id),                   // AH Номер поставки
    s(r.subject_name),                              // AI Предмет
    num_(r.nm_id),                                  // AJ Код номенклатуры
    s(r.brand_name),                                // AK Бренд
    s(r.sa_name),                                   // AL Артикул поставщика
    '',                                             // AM Название (нет в API)
    s(r.ts_name),                                   // AN Размер
    s(r.barcode),                                   // AO Баркод
    s(r.doc_type_name),                             // AP Тип документа
    oper,                                           // AQ Обоснование для оплаты
    s(r.order_dt),                                  // AR Дата заказа
    s(r.sale_dt),                                   // AS Дата продажи
    abs(r.quantity),                                // AT Кол-во
    num_(r.retail_price),                           // AU Цена розничная
    abs(r.retail_amount),                           // AV ВБ реализовал (Пр)
    num_(r.product_discount_for_report),            // AW Согласованный дисконт %
    num_(r.sale_price_promocode_discount_prc),      // AX Промокод %
    num_(r.sale_percent),                           // AY Итоговая скидка %
    abs(r.retail_price_withdisc_rub),               // AZ Цена розничная со скидкой
    num_(r.sup_rating_prc_up),                      // BA Снижение кВВ рейтинг %
    0,                                              // BB Снижение кВВ акция %
    num_(r.ppvz_spp_prc),                           // BC СПП %
    num_(r.ppvz_kvw_prc),                           // BD кВВ %
    num_(r.ppvz_kvw_prc_base),                      // BE кВВ базовый %
    num_(r.ppvz_kvw_prc),                           // BF кВВ итоговый %
    num_(r.ppvz_reward),                            // BG Вознаграждение до вычета
    0,                                              // BH Возмещение ПВЗ
    num_(r.acquiring_fee),                          // BI Эквайринг руб
    num_(r.acquiring_percent),                      // BJ Эквайринг %
    num_(r.ppvz_vw),                                // BK ВВ без НДС
    num_(r.ppvz_vw_nds),                            // BL НДС с ВВ
    abs(r.ppvz_for_pay),                            // BM К перечислению
    num_(r.delivery_amount),                        // BN Кол-во доставок
    num_(r.return_amount),                          // BO Кол-во возврата
    num_(r.delivery_rub),                           // BP Услуги доставки
    num_(r.penalty),                                // BQ Штрафы
    num_(r.additional_payment),                     // BR Доплаты
    s(r.delivery_method),                           // BS Виды логистики
    s(r.sticker_id),                                // BT Стикер МП
    s(r.acquiring_bank),                            // BU Банк-эквайер
    num_(r.ppvz_office_id),                         // BV Номер офиса
    s(r.ppvz_office_name),                          // BW Офис доставки
    s(r.ppvz_inn),                                  // BX ИНН партнера
    s(r.ppvz_supplier_name),                        // BY Партнер
    '',                                             // BZ Склад (нет в API)
    s(r.site_country),                              // CA Страна
    s(r.gi_box_type_name),                          // CB Тип коробов
    s(r.declaration_number),                        // CC Декларация
    s(r.kiz),                                       // CD Код маркировки
    num_(r.shk_id),                                 // CE ШК
    num_(r.gi_id),                                  // CF Rid
    s(r.srid),                                      // CG Srid
    num_(r.rebill_logistic_cost),                   // CH Возмещение перевозки
    '',                                             // CI Организатор перевозки
    num_(r.storage_fee),                            // CJ Хранение
    num_(r.deduction),                              // CK Удержания
    num_(r.acceptance),                             // CL Платная приемка
    num_(r.suppliercontract_code)                   // CM
  ];
}

// ============================================================
// FORMULA ROW → колонки A..AF (как в эталоне)
// ============================================================
function bazaFormulaRow_(r) {
  return [
    '=IF($AP' + r + '="Продажа",1,-1)',
    '=IF(OR($AQ' + r + '="Продажа",$AQ' + r + '="Сторно возвратов",$AQ' + r + '="Корректная продажа"),1,IF(OR($AQ' + r + '="Возврат",$AQ' + r + '="Сторно продаж",$AQ' + r + '="Корректный возврат"),-1,0))',
    '=IF($AQ' + r + '="Логистика сторно",-1,1)',
    '=IF($B' + r + '=1,$AT' + r + ',0)',
    '=IF($B' + r + '=-1,$AT' + r + ',0)',
    '=IF($B' + r + '=1,$AZ' + r + ',0)',
    '=IF($B' + r + '=-1,$AZ' + r + ',0)',
    '=D' + r + '-E' + r,
    '=F' + r + '-G' + r,
    '=IF(OR($AQ' + r + '="Оплата брака",$AQ' + r + '="Частичная компенсация брака",$AQ' + r + '=J$1),$BM' + r + ',0)*$A' + r,
    '=IF(OR($AQ' + r + '="Компенсация ущерба",$AQ' + r + '="Компенсация подмен",$AQ' + r + '="Компенсация подмененного товара",$AQ' + r + '="Компенсация потерянных товаров",$AQ' + r + '="Авансовая оплата за товар без движения",$AQ' + r + '="Оплата потерянного товара",$AQ' + r + '="Компенсация потерянного товара"),BM' + r + ',0)*$A' + r,
    '=IF(J' + r + '<>0,1,0)&$CE' + r,
    '=IF(K' + r + '<>0,1,0)&$CE' + r,
    '=IF(J' + r + '>0,IF(SUMIF($CE:$CE,$CE' + r + ',J:J)=0,0,IF(COUNTIFS($L$1:L' + r + ',L' + r + ')=1,1,0)),0)-IF(J' + r + '<0,IF(SUMIF($CE:$CE,$CE' + r + ',J:J)=0,0,IF(COUNTIFS($L$1:L' + r + ',L' + r + ')=1,1,0)),0)',
    '=IF(K' + r + '>0,IF(SUMIF($CE:$CE,$CE' + r + ',K:K)=0,0,IF(COUNTIFS($M$1:M' + r + ',M' + r + ')=1,1,0)),0)-IF(K' + r + '<0,IF(SUMIF($CE:$CE,$CE' + r + ',K:K)=0,0,IF(COUNTIFS($M$1:M' + r + ',M' + r + ')=1,1,0)),0)',
    '=$A' + r + '*BM' + r + '-J' + r + '-K' + r,
    '=I' + r + '-P' + r + '-R' + r + '+IF(AQ' + r + '="Корректировка эквайринга",BM' + r + ',0)',
    '=IF(BJ' + r + '>0,BI' + r + ',0)*A' + r + '+IF(AQ' + r + '="Корректировка эквайринга",BM' + r + ',0)',
    '=IF(AND(C' + r + '=-1,BP' + r + '<0),BP' + r + ',IF(BN' + r + '>0,$BP' + r + '*$C' + r + ',0)+IF(BN' + r + '+BO' + r + '=0,BP' + r + '))',
    '=IF(BO' + r + '>0,$BP' + r + '*$C' + r + ',0)',
    '=BQ' + r,
    '=BR' + r,
    '=AV' + r + '*A' + r,
    '=I' + r + '-AV' + r + '*B' + r,
    '=I' + r + '-Q' + r + '-R' + r + '-S' + r + '-T' + r + '-U' + r + '-V' + r + '+J' + r + '+K' + r + '+IF(AQ' + r + '="Корректировка эквайринга",BM' + r + ',0)',
    '=IFERROR(IF(AO' + r + '="",IF(AL' + r + '="",0,VLOOKUP(AL' + r + ',Себестоимость!A:C,3,0)*(D' + r + '-E' + r + ')+VLOOKUP(AL' + r + ',Себестоимость!A:C,3,0)*(N' + r + '+O' + r + ')),(IF(AO' + r + '="",0,VLOOKUP(AO' + r + ',Себестоимость!B:C,2,0)*(D' + r + '-E' + r + ')+VLOOKUP(AO' + r + ',Себестоимость!B:C,2,0)*(N' + r + '+O' + r + ')))),IF(AL' + r + '="",0,VLOOKUP(AL' + r + ',Себестоимость!A:C,3,0)*(D' + r + '-E' + r + ')+VLOOKUP(AL' + r + ',Себестоимость!A:C,3,0)*(N' + r + '+O' + r + ')))',
    '=IF(справка!$F$7=1,W' + r + ',IF(справка!$F$7=2,I' + r + '+J' + r + '+K' + r + '-Q' + r + '-S' + r + '-T' + r + '-U' + r + '-V' + r + '-CJ' + r + '-CK' + r + '-CL' + r + '-Z' + r + ',IF(справка!$F$7=3,0,IF(справка!$F$7=4,I' + r + '-Q' + r + '-S' + r + '-T' + r + '-U' + r + '-V' + r + '+CJ' + r + '+CK' + r + '+CL' + r + '))))',
    '=ABS(CL' + r + ')',
    '=COUNTIF(AL$2:$AL' + r + ',AL' + r + ')',
    '=IF(AC' + r + '=1,COUNTIF(AC$2:$AC' + r + ',AC' + r + '),"-")',
    '=COUNTIF($AO$2:$AO' + r + ',AO' + r + ')',
    '=IF(AE' + r + '=1,COUNTIF($AE$2:$AE' + r + ',AE' + r + '),"-")'
  ];
}

// ============================================================
// СЕБЕСТОИМОСТЬ из Справочника + баркодов из Базы
// ============================================================
function bazaWriteSeb_(ss, rows) {
  var sh = ss.getSheetByName(BAZA_SEB);
  var existing = {};
  var data = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 1), 3).getValues();
  for (var i = 0; i < data.length; i++) {
    var sa = String(data[i][0] || '').trim();
    if (sa) existing[sa] = { bc: String(data[i][1] || ''), cost: data[i][2] };
  }
  var cost = loadCostDict_(ss);
  var added = 0;
  for (var i = 0; i < rows.length; i++) {
    var nm = String(rows[i].nm_id || '');
    var sa = String(rows[i].sa_name || '');
    var bc = String(rows[i].barcode || '');
    var key = nm || sa;
    if (!key || existing[sa]) continue;
    var c = cost[nm] || cost[sa] || 0;
    existing[sa] = { bc: bc, cost: c };
    added++;
  }
  var out = [];
  for (var sa in existing) out.push([sa, existing[sa].bc, existing[sa].cost]);
  sh.getRange('A2:C2000').clearContent();
  if (out.length) sh.getRange(2, 1, out.length, 3).setValues(out);
  logMsg_(ss, 'Себестоимость: ' + out.length + ' строк (' + added + ' новых)');
}

// ============================================================
// SHEET CREATION (headers + template formulas)
// ============================================================
function bazaEnsureSheets_(ss, dataN, nBc, nArt) {
  nBc = Math.min(Math.max(nBc + 3, 10), 3998);
  nArt = Math.min(Math.max(nArt + 3, 10), 3998);
  // --- База ---
  var b = ss.getSheetByName(BAZA_SHEET);
  if (!b) { b = ss.insertSheet(BAZA_SHEET); }
  var wantRows = Math.min(dataN + 10, BAZA_MAX_FORMULA_ROWS + 5);
  if (b.getMaxRows() > 1000 && b.getMaxRows() > wantRows + 200) {
    b.deleteRows(wantRows + 1, b.getMaxRows() - wantRows);
  } else if (b.getMaxRows() < wantRows) {
    b.insertRowsAfter(b.getMaxRows(), wantRows - b.getMaxRows());
  }
  if (b.getMaxColumns() < 91) {
    var lastCol = b.getMaxColumns();
    b.insertColumnsAfter(lastCol, 91 - lastCol);
  }
  var bh = ['koef\nGENERAL','koef\nSALES','koef\nLOGIST','Продано\nшт.','Возвращено\nшт.','Продано\nруб.','Возврщено\nруб.','Продаж\nшт.','Выручка\nруб.','Компенсация брака','Компенсация ущерба','key for\nбрак','key for\nущерба','Кол-во брака','Кол-во ущерба','К перечислению за продажи','Комиссия\nруб.','Эквайринг','Логистика доставок','Логистика возвратов','Штрафы','Доплаты','WB реализовал (налоговая база)','СПП\nруб.','Оплата на РС','Себестоимость','Налоговая база','Платная приемка','Расчет количество вхождений артикулов','Уникальные артикулов','Расчет количество вхождений баркодов','Уникальные баркода','№','Номер поставки','Предмет','Код номенклатуры','Бренд','Артикул поставщика','Название','Размер','Баркод','Тип документа','Обоснование для оплаты','Дата заказа покупателем','Дата продажи','Кол-во','Цена розничная','Вайлдберриз реализовал Товар (Пр)','Согласованный продуктовый дисконт, %','Промокод %','Итоговая согласованная скидка, %','Цена розничная с учетом согласованной скидки','Размер снижения кВВ из-за рейтинга, %','Размер снижения кВВ из-за акции, %','Скидка постоянного Покупателя (СПП), %','Размер кВВ, %','Размер  кВВ без НДС, % Базовый','Итоговый кВВ без НДС, %','Вознаграждение с продаж до вычета услуг поверенного, без НДС','Возмещение за выдачу и возврат товаров на ПВЗ','Возмещение издержек по эквайрингу','Процент возмещения издержек по эквайрингу','Вознаграждение Вайлдберриз (ВВ), без НДС','НДС с Вознаграждения Вайлдберриз','К перечислению Продавцу за реализованный Товар','Количество доставок','Количество возврата','Услуги по доставке товара покупателю','Общая сумма штрафов','Доплаты','Виды логистики, штрафов и доплат','Стикер МП','Наименование банка-эквайера','Номер офиса','Наименование офиса доставки','ИНН партнера','Партнер','Склад','Страна','Тип коробов','Номер таможенной декларации','Код маркировки','ШК','Rid','Srid','Возмещение издержек по перевозке','Организатор перевозки','Хранение','Удержания','Платная приемка',''];
  if (String(b.getRange(1, 1).getValue()) === '') b.getRange(1, 1, 1, 91).setValues([bh]);

  // --- справка ---
  var sp = ss.getSheetByName(BAZA_SPR) || ss.insertSheet(BAZA_SPR);
  if (String(sp.getRange('A1').getValue()) === '') {
    sp.clear();
    sp.getRange('A1').setValue('Года'); sp.getRange('C1').setValue('Месяца');
    var years = ['2021','2022','2023','2024','2025','2026'];
    for (var i = 0; i < years.length; i++) sp.getRange(2 + i, 1).setValue(years[i]);
    var months = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
    for (var m = 0; m < months.length; m++) sp.getRange(2 + m, 3).setValue(months[m]);
    sp.getRange('E3').setValue('УСН-доходы'); sp.getRange('F3').setValue(1); sp.getRange('G3').setFormula(bazaBound_('=SUM(База!W:W)'));
    sp.getRange('E4').setValue('УСН Д-Р'); sp.getRange('F4').setValue(2); sp.getRange('G4').setFormula('=G3-DASHBOARD!N7+DASHBOARD!B18+DASHBOARD!B20+DASHBOARD!B22-DASHBOARD!H18-DASHBOARD!H20-DASHBOARD!K7');
    sp.getRange('E5').setValue('Не считать налог'); sp.getRange('F5').setValue(3); sp.getRange('G5').setValue(0);
    sp.getRange('E6').setValue('Считать от РС'); sp.getRange('F6').setValue(4); sp.getRange('G6').setFormula('=DASHBOARD!Q23');
    sp.getRange('E7').setValue('Выбрано'); sp.getRange('F7').setFormula('=VLOOKUP(DASHBOARD!N18,справка!E3:F6,2,0)');
    sp.getRange('G2').setValue('Налоговая база');
  }

  // --- DASHBOARD ---
  var d = ss.getSheetByName(BAZA_DASH) || ss.insertSheet(BAZA_DASH);
  if (String(d.getRange('A1').getValue()) === '') {
    d.clear();
    bazaSet_(d, 'A1', 'DASHBOARD');
    d.getRange('A3').setValue('Продажи'); d.getRange('J3').setValue('Себестоимость'); d.getRange('M3').setValue('Удержания WB');
    d.getRange('B5').setValue('В рублях'); d.getRange('D5').setValue('В штуках');
    var dash = {
      'A7':'Продаж всего','B7':'=B9-B11','D7':'=D9-D11','G7':'Средняя цена продажи','H7':'=IFERROR(B7/D7,"")',
      'J7':'Себестоимость проданных товаров','K7':"='Отчёт по размерам'!AQ3",'M7':'Всего','N7':'=Q7+W7+Z7+AC7+AF7+T7',
      'P7':'Комиссия','Q7':'=SUM(База!Q:Q)','S7':'Эквайринг','T7':'=SUM(База!R:R)',
      'V7':'Логистика','W7':'=SUM(База!S:T)','Y7':'Хранение','Z7':'=SUM(База!CJ:CJ)',
      'AB7':'Приёмка','AC7':'=SUM(База!AB:AB)','AE7':'Прочие удерж.','AF7':'=SUM(База!CK:CK)',
      'A9':'Продано','B9':'=SUM(База!F:F)','D9':'=SUM(База!D:D)','G9':'Выкуп %','H9':'=IFERROR(D7/SUM(База!BN:BN),"")',
      'J9':'В % от выручки','K9':'=IFERROR(K7/B7,"")','M9':'% от выручки','N9':'=IFERROR(N7/$B$7,"")',
      'P9':'% от выручки','Q9':'=IFERROR(Q7/$B$7,"")','S9':'% от выручки','T9':'=IFERROR(T7/$B$7,"")',
      'V9':'% от выручки','W9':'=IFERROR(W7/$B$7,"")','Y9':'% от выручки','Z9':'=IFERROR(Z7/$B$7,"")',
      'AB9':'% от выручки','AC9':'=IFERROR(AC7/$B$7,"")','AE9':'% от выручки','AF9':'=IFERROR(AF7/$B$7,"")',
      'A11':'Возвращено','B11':'=SUM(База!G:G)','D11':'=SUM(База!E:E)',
      'A14':'Другие взаиморасчёты','J14':'Внешние расходы','M14':'Налог','Q14':'Финансы',
      'B16':'В рублях','D16':'В штуках',
      'A18':'Оплата брака','B18':'=SUM(База!J:J)','D18':'=SUM(База!N:N)','G18':'Штрафы','H18':'=SUM(База!U:U)',
      'J18':'Всего','K18':0,'M18':'Тип налогообложения','N18':'УСН-доходы','Q18':'Чистая прибыль','V18':'Маржинальность',
      'Q19':'=Q23-K7-K18-N20','V19':'=IFERROR(Q19/B7,"")',
      'A20':'Оплата ущерба','B20':'=SUM(База!K:K)','D20':'=SUM(База!O:O)','G20':'Доплаты','H20':'=SUM(База!V:V)',
      'J20':'В % от выручки','K20':'=IFERROR(K18/B7,"")','M20':'Налог','N20':'=N24*N22',
      'M22':'Налоговая ставка','N22':0.06,'Q22':'Оплата на Р/C','V22':'Рентабельность',
      'Q23':'=SUM(База!Y:Y)-Z7-AC7-AF7','V23':'=IFERROR(Q19/(K7+K18),"")',
      'M24':'Налоговая база','N24':'=SUM(База!AA:AA)','Q26':'Прибыль на ед.','Q27':'=IFERROR(Q19/D7,"")',
      'G26':'Реклама','H26':'=SUM(Реклама!E:E)','Q29':'Прибыль без рекламы','Q30':'=Q19-H26',
      'A37':'Прибыль','B37':'=Q19','A38':'Налог','B38':'=N20','A39':'Себестоимость','B39':'=K7',
      'A40':'Удержания и взаиморасчты WB','B40':'=N7-B18-B20+H18+H20+B22','A41':'Внешние расходы','B41':'=K18'
    };
    for (var k in dash) { var v = dash[k]; if (typeof v === 'string' && v.charAt(0) === '=') d.getRange(k).setFormula(bazaBound_(v)); else d.getRange(k).setValue(v); }
  }

  // --- Себестоимость ---
  var sb = ss.getSheetByName(BAZA_SEB) || ss.insertSheet(BAZA_SEB);
  if (String(sb.getRange('A1').getValue()) === '') {
    sb.getRange('A1').setValue('Артикул поставщика'); sb.getRange('B1').setValue('Баркод'); sb.getRange('C1').setValue('Себестоимость');
  }

  bazaEnsureRazm_(ss, nBc);
  bazaEnsureArt_(ss, nArt);
}

function bazaSet_(sh, a1, v) { sh.getRange(a1).setValue(v); }

// Ограничивает полные колонки Базы фиксированным диапазоном с запасом: База!X:X → База!$X$2:$X$5001
function bazaBound_(f) {
  if (typeof f !== 'string' || f.charAt(0) !== '=') return f;
  return f.replace(/База!\$?([A-Z]{1,2}):\$?([A-Z]{1,2})/g,
    function(m, c1, c2) { return 'База!$' + c1 + '$2:$' + c2 + '$' + (BAZA_MAX_FORMULA_ROWS + 1); });
}

// --- Отчёт по размерам (по баркодам) ---
function bazaEnsureRazm_(ss, LAST) {
  var sh = ss.getSheetByName(BAZA_RAZM) || ss.insertSheet(BAZA_RAZM);
  if (String(sh.getRange('A3').getValue()) !== '') {
    // расширяем под новые баркоды
    if (sh.getMaxRows() < LAST + 5) sh.insertRowsAfter(sh.getMaxRows(), LAST + 5 - sh.getMaxRows());
    var from = Math.max(sh.getLastRow() + 1, 4);
    if (from <= LAST) {
      var batch = [];
      for (var row = from; row <= LAST; row++) batch.push(bazaRazmRow_(row).map(bazaBound_));
      sh.getRange(from, 1, LAST - from + 1, 48).setFormulas(batch);
      logMsg_(SpreadsheetApp.openById(SPREADSHEET_ID), 'Отчёт по размерам: добавлено строк ' + (LAST - from + 1));
    }
    return;
  }
  sh.clear();
  var h1 = {1:'Продажи',16:'Удержания WB',26:'Другие взаиморасчёты',40:'Финансы'};
  var h2 = {1:'№',2:'Артикул поставщика',3:'Предмет',4:'Артикул',5:'Баркод',6:'Размер',7:'Продаж шт. ',8:'Возвратов шт.',9:'Продаж',10:'Возвраты руб.',11:'Итого продаж шт.',12:' Выручка',13:'Ср.цена продажи',14:'СПП % ',15:'Выкуп %',16:'Комиссия руб.',17:'Комиссия  %',18:'Эквайринг руб.',19:'Эквайринг %',20:' Количество доставок \n(по логистике)',21:' Количество возврата\n(по логистике)',22:'Логистика доставок ',23:'Логистика возвратов ',24:'Итого логистика',25:'% логистики от выр.',26:'Компенсация брака ',27:' Кол-во брака',28:'Компенсация потеряшек',29:' Кол-во потеряшек',30:' Штрафы',31:'Доплаты ',32:'Хранение ',33:'% хранения от выр.',34:'Приёмка',35:'% приёмки от выр.',36:' Проч. удерж.',37:'% проч.удерж. от выр.',38:'Все удержания WB ',39:'% всех удер. WB',40:'Оплата на Р/С ',41:'Налоговая база',42:'Налог',43:'Себестоимость ',44:'Чистая прибыль ',45:'Прибыль на ед.',46:'Доля прибыли',47:'Марж-ность по прибыли',48:'Рентабельность '};
  for (var c in h1) sh.getRange(1, Number(c)).setValue(h1[c]);
  var row2 = []; for (var i = 1; i <= 48; i++) row2.push(h2[i] || '');
  sh.getRange(2, 1, 1, 48).setValues([row2]);
  var last = LAST;
  var r3 = ['№','Артикул поставщика','Предмет','Артикул','Баркод','Размер',
    '=SUM(G4:G)','=SUM(H4:H)','=SUM(I4:I)','=SUM(J4:J)','=SUM(K4:K)','=SUM(L4:L)','=IFERROR(L3/K3,"")','=IFERROR(IF($A3="","",SUM(База!X:X)/L3),"")','=IFERROR(K3/T3,"")','=SUM(P4:P)','=IFERROR(IF($A3="","",SUM(База!Q:Q)/L3),"")','=SUM(R4:R)','=IFERROR(IF($A3="","",SUM(База!R:R)/L3),"")','=SUM(T4:T)','=SUM(U4:U)','=SUM(V4:V)','=SUM(W4:W)','=IFERROR(W3+V3,"")','=IFERROR(X3/L3,"")','=SUM(Z4:Z)','=SUM(AA4:AA)','=SUM(AB4:AB)','=SUM(AC4:AC)','=SUM(База!BQ:BQ)','=SUM(AE4:AE)','=DASHBOARD!Z7','=IFERROR(AF3/$L3,"")','=DASHBOARD!AC7','=IFERROR(AH3/$L3,"")','=DASHBOARD!AF7','=IFERROR(AJ3/$L3,"")','=IFERROR(L3-AN3,"")','=IFERROR(AL3/$L3,"")','=SUM(База!Y:Y)-\'Отчёт по размерам\'!AF3-\'Отчёт по размерам\'!AH3-\'Отчёт по размерам\'!AJ3','=SUM(AO4:AO)','=DASHBOARD!N20','=SUM(AQ4:AQ)','=IFERROR(AN3-AP3-AQ3,"")','=IFERROR(AR3/K3,"")','=IFERROR(AR3/$AR$3,"")','=IFERROR(AR3/L3,"")','=IFERROR(AR3/AQ3,"")'];
  for (var c = 7; c <= 48; c++) { var v = r3[c - 1]; if (typeof v === 'string' && v.charAt(0) === '=') sh.getRange(3, c).setFormula(bazaBound_(v)); else sh.getRange(3, c).setValue(v); }
  // строки 4+3998
  var batch = [];
  for (var row = 4; row <= last; row++) batch.push(bazaRazmRow_(row).map(bazaBound_));
  sh.getRange(4, 1, last - 3, 48).setFormulas(batch);
  sh.getRange('A4').setValue(1);
}

function bazaRazmRow_(r) {
  var R = "'Отчёт по размерам'!";
  return [
    (r === 4 ? 1 : '=IF(COUNT(База!AF:AF)>A' + (r - 1) + ',' + R + 'A' + (r - 1) + '+1,"")'),
    '=IFERROR(VLOOKUP($A' + r + ',База!$AF:$AO,7,0),"")',
    '=IFERROR(VLOOKUP($A' + r + ',База!$AF:$AO,8,0),"")',
    '=IFERROR(VLOOKUP($A' + r + ',База!$AF:$AO,5,0),"")',
    '=IFERROR(VLOOKUP($A' + r + ',База!$AF:$AO,10,0),"")',
    '=IFERROR(VLOOKUP($A' + r + ',База!$AF:$AO,9,0),"")',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!D:D))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!E:E))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!F:F))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!G:G))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!H:H))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!I:I))',
    '=IFERROR(L' + r + '/K' + r + ',"")',
    '=IFERROR(IF($A' + r + '="","",SUMIF(База!$AL:$AL,$B' + r + ',База!X:X))/L' + r + ',"")',
    '=IFERROR(K' + r + '/T' + r + ',"")',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!Q:Q))',
    '=IFERROR(IF($A' + r + '="","",P' + r + '/L' + r + '),"")',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!R:R))',
    '=IFERROR(IF($A' + r + '="","",R' + r + '/L' + r + '),"")',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!BN:BN))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!BO:BO))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!S:S))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!T:T))',
    '=IFERROR(W' + r + '+V' + r + ',"")',
    '=IFERROR(X' + r + '/L' + r + ',"")',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!J:J))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!N:N))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!K:K))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!O:O))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!U:U))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!V:V))',
    '=IFERROR(L' + r + '-AN' + r + ',"")',
    '=IFERROR(AL' + r + '/$L' + r + ',"")',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!Y:Y))',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!AA:AA))',
    '=IFERROR(AO' + r + '*DASHBOARD!$N$22,"")',
    '=IF($A' + r + '="","",SUMIF(База!$AO:$AO,' + R + '$E' + r + ',База!Z:Z))',
    '=IFERROR(AN' + r + '-AP' + r + '-AQ' + r + ',"")',
    '=IFERROR(AR' + r + '/K' + r + ',"")',
    '=IFERROR(AR' + r + '/$AR$3,"")',
    '=IFERROR(AR' + r + '/L' + r + ',"")',
    '=IFERROR(AR' + r + '/AQ' + r + ',"")'
  ];
}

// --- Отчёт по артикулам (по артикулам поставщика) ---
function bazaEnsureArt_(ss, LAST) {
  var sh = ss.getSheetByName(BAZA_ART) || ss.insertSheet(BAZA_ART);
  if (String(sh.getRange('A3').getValue()) !== '') {
    // расширяем под новые артикулы
    if (sh.getMaxRows() < LAST + 5) sh.insertRowsAfter(sh.getMaxRows(), LAST + 5 - sh.getMaxRows());
    var from = Math.max(sh.getLastRow() + 1, 4);
    if (from <= LAST) {
      var batch = [];
      for (var row = from; row <= LAST; row++) batch.push(bazaArtRow_(row).map(bazaBound_));
      sh.getRange(from, 1, LAST - from + 1, 48).setFormulas(batch);
      logMsg_(SpreadsheetApp.openById(SPREADSHEET_ID), 'Отчёт по артикулам: добавлено строк ' + (LAST - from + 1));
    }
    return;
  }
  sh.clear();
  var h1 = {5:'Продажи',14:'Удержания WB',24:'Другие взаиморасчёты',38:'Финансы'};
  var h2 = {1:'№',2:'Артикул поставщика',3:'Артикул',4:'Предмет',5:'Продаж шт. ',47:'Реклама',48:'Прибыль без рекламы',6:'Возвратов шт.',7:'Продаж',8:'Возвраты руб.',9:'Итого продаж шт.',10:' Выручка',11:'Ср.цена продажи',12:'СПП % ',13:'Выкуп %',14:'Комиссия руб.',15:'Комиссия  %',16:'Эквайринг руб.',17:'Эквайринг %',18:' Количество доставок \n(по логистике)',19:' Количество возврата\n(по логистике)',20:'Логистика доставок ',21:'Логистика возвратов ',22:'Итого логистика',23:'% логистики от выр.',24:'Компенсация брака ',25:' Кол-во брака',26:'Компенсация ущерба',27:' Кол-во ущерба',28:' Штрафы',29:'Доплаты ',30:'Хранение ',31:'% хранения от выр.',32:'Приёмка',33:'% приёмки от выр.',34:' Проч. удерж.',35:'% проч.удерж. от выр.',36:'Все удержания WB ',37:'% всех удер. WB',38:'Оплата на Р/С ',39:'Налоговая база',40:'Налог',41:'Себестоимость ',42:'Чистая прибыль ',43:'Прибыль на ед.',44:'Доля прибыли',45:'Марж-ность по прибыли',46:'Рентабельность '};
  for (var c in h1) sh.getRange(1, Number(c)).setValue(h1[c]);
  var row2 = []; for (var i = 1; i <= 48; i++) row2.push(h2[i] || '');
  sh.getRange(2, 1, 1, 48).setValues([row2]);
  var last = LAST;
  var r3 = ['№','Артикул поставщика','Артикул','Предмет',
    '=SUM(E4:E)','=SUM(F4:F)','=SUM(G4:G)','=SUM(H4:H)','=SUM(I4:I)','=SUM(J4:J)','=IFERROR(J3/I3,"")','=IFERROR(IF($A3="","",SUM(База!X:X)/J3),"")','=IFERROR(I3/R3,"")','=SUM(N4:N)','=IFERROR(IF($A3="","",SUM(База!Q:Q)/J3),"")','=SUM(P4:P)','=IFERROR(IF($A3="","",SUM(База!R:R)/J3),"")','=SUM(R4:R)','=SUM(S4:S)','=SUM(T4:T)','=SUM(U4:U)','=IFERROR(U3+T3,"")','=IFERROR(V3/J3,"")','=SUM(X4:X)','=SUM(Y4:Y)','=SUM(Z4:Z)','=SUM(AA4:AA)','=SUM(База!BQ:BQ)','=SUM(AC4:AC)','=DASHBOARD!Z7','=IFERROR(AD3/$J3,"")','=DASHBOARD!AC7','=IFERROR(AF3/$J3,"")','=DASHBOARD!AF7','=IFERROR(AH3/$J3,"")','=IFERROR(J3-AL3,"")','=IFERROR(AJ3/$J3,"")','=DASHBOARD!Q23','=SUM(AM4:AM)','=DASHBOARD!N20','=SUM(AO4:AO)','=IFERROR(AL3-AN3-AO3,"")','=IFERROR(AP3/I3,"")','=IFERROR(AP3/$AP$3,"")','=IFERROR(AP3/J3,"")','=IFERROR(AP3/AO3,"")'];
  for (var c = 5; c <= 46; c++) { var v = r3[c - 1]; if (typeof v === 'string' && v.charAt(0) === '=') sh.getRange(3, c).setFormula(bazaBound_(v)); }
  var batch = [];
  for (var row = 4; row <= last; row++) batch.push(bazaArtRow_(row).map(bazaBound_));
  sh.getRange(4, 1, last - 3, 48).setFormulas(batch);
  sh.getRange('A4').setValue(1);
}

function bazaArtRow_(r) {
  var R = "'Отчёт по артикулам'!";
  return [
    (r === 4 ? 1 : '=IF(COUNT(База!AD:AD)>A' + (r - 1) + ',' + R + 'A' + (r - 1) + '+1,"")'),
    '=IFERROR(VLOOKUP($A' + r + ',База!AD:AL,9,0),"")',
    '=IFERROR(VLOOKUP($A' + r + ',База!AD:AJ,7,0),"")',
    '=IFERROR(VLOOKUP($A' + r + ',База!AD:AM,10,0),"")',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!D:D))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!E:E))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!F:F))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!G:G))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!H:H))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!I:I))',
    '=IFERROR(J' + r + '/I' + r + ',"")',
    '=IFERROR(IF($A' + r + '="","",SUMIF(База!$AL:$AL,$B' + r + ',База!X:X))/J' + r + ',"")',
    '=IFERROR(I' + r + '/R' + r + ',"")',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!Q:Q))',
    '=IFERROR(IF($A' + r + '="","",N' + r + '/J' + r + '),"")',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!R:R))',
    '=IFERROR(IF($A' + r + '="","",P' + r + '/J' + r + '),"")',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!BN:BN))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!BO:BO))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!S:S))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!T:T))',
    '=IFERROR(U' + r + '+T' + r + ',"")',
    '=IFERROR(V' + r + '/J' + r + ',"")',
    '=IF($A' + r + '="","",SUMIF(База!$AJ:$AJ,' + R + '$C' + r + ',База!J:J))',
    '=IF($A' + r + '="","",SUMIF(База!$AJ:$AJ,' + R + '$C' + r + ',База!N:N))',
    '=IF($A' + r + '="","",SUMIF(База!$AJ:$AJ,' + R + '$C' + r + ',База!K:K))',
    '=IF($A' + r + '="","",SUMIF(База!$AJ:$AJ,' + R + '$C' + r + ',База!O:O))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!U:U))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!V:V))',
    '=IFERROR(J' + r + '-AL' + r + ',"")',
    '=IFERROR(AJ' + r + '/$J' + r + ',"")',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!Y:Y))',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!AA:AA))',
    '=IFERROR(AM' + r + '*DASHBOARD!$N$22,"")',
    '=IF($A' + r + '="","",SUMIF(База!$AL:$AL,' + R + '$B' + r + ',База!Z:Z))',
    '=IFERROR(AL' + r + '-AN' + r + '-AO' + r + ',"")',
    '=IFERROR(AP' + r + '/I' + r + ',"")',
    '=IFERROR(AP' + r + '/$AP$3,"")',
    '=IFERROR(AP' + r + '/J' + r + ',"")',
    '=IFERROR(AP' + r + '/AO' + r + ',"")',
    '=IF($B' + r + '="","",SUMIF(Реклама!$D:$D,$B' + r + ',Реклама!$E:$E))',
    '=IFERROR(AP' + r + '-AW' + r + ',"")'
  ];
}

function bazaClear() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(BAZA_SHEET);
  if (sh) { sh.getRange(2, 1, sh.getMaxRows() - 1, sh.getMaxColumns()).clearContent(); logMsg_(ss, 'База: очищено'); }
}

// ============================================================
// РЕКЛАМА (Ads API) — лист «Реклама», поартикульно по nmId
// ============================================================
var BAZA_ADS = 'Реклама';

function bazaAdsUpdate() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var settingName1 = 'Токен автор' + 'изованного пользователя WB';
  var token = getSetting_(ss, settingName1) || getSetting_(ss, 'API ключ WB (только чтение)');
  if (!token || token.length < 50) throw new Error('WB API токен не найден');
  var period = String(getSetting_(ss, 'База: период загрузки') || '').trim().toLowerCase();
  var daysBack = Number(period);
  if (isNaN(daysBack)) daysBack = 90; // реклама по умолчанию за 90 дней
  daysBack = Math.max(1, Math.min(daysBack, 365));
  var to = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var from = Utilities.formatDate(new Date(Date.now() - daysBack * 86400000), TZ, 'yyyy-MM-dd');

  var sh = ss.getSheetByName(BAZA_ADS) || ss.insertSheet(BAZA_ADS);
  sh.clear();
  sh.getRange('A1:E1').setValues([['Дата/период', 'Кампания', 'nmId', 'Артикул', 'Расход']]);

  var hdr = {}; hdr['Authorization'] = token;
  var rows = [];

  // 1. список кампаний
  var camps = [];
  try {
    var r = UrlFetchApp.fetch('https://advert-api.wildberries.ru/adv/v1/promotion/count',
      { method: 'get', headers: hdr, muteHttpExceptions: true });
    if (r.getResponseCode() === 200) {
      var arr = JSON.parse(r.getContentText() || '[]');
      for (var i = 0; i < arr.length; i++) walkCampaigns_(arr[i], camps);
    } else { logMsg_(ss, 'Реклама: count HTTP ' + r.getResponseCode()); }
  } catch (e) { logMsg_(ss, 'Реклама: count error ' + e.message); }

  // 2. поартикульная статистика: пробуем известные пути fullstats
  var perNm = [];
  if (camps.length) {
    var ids = camps.map(function(c) { return c.id; });
    var paths = ['/adv/v1/fullstats', '/adv/v1/full/stat', '/adv/v2/fullstats'];
    for (var p = 0; p < paths.length && !perNm.length; p++) {
      try {
        var resp = UrlFetchApp.fetch('https://advert-api.wildberries.ru' + paths[p] + '?from=' + from + '&to=' + to,
          { method: 'post', headers: hdr, contentType: 'application/json', payload: JSON.stringify({ ids: ids }), muteHttpExceptions: true });
        if (resp.getResponseCode() === 200 && resp.getContentText()) {
          perNm = collectNmStats_(JSON.parse(resp.getContentText())) || [];
          if (perNm.length) logMsg_(ss, 'Реклама: поартикульно через ' + paths[p] + ', строк ' + perNm.length);
        }
      } catch (e) { /* следующий путь */ }
    }
  }

  // 3. если поартикульно не вышло — тоталы по дням через upd
  if (!perNm.length) {
    try {
      var r2 = UrlFetchApp.fetch('https://advert-api.wildberries.ru/adv/v1/upd?from=' + from + '&to=' + to,
        { method: 'get', headers: hdr, muteHttpExceptions: true });
      if (r2.getResponseCode() === 200 && r2.getContentText()) {
        var upd = JSON.parse(r2.getContentText());
        if (Array.isArray(upd)) {
          for (var u = 0; u < upd.length; u++) {
            var camp = campName_(camps, upd[u].advertid);
            rows.push([upd[u].day || (from + '–' + to), camp, '', '', Number(upd[u].sum) || 0]);
          }
          logMsg_(ss, 'Реклама: итоги по кампаниям (upd), строк ' + rows.length);
        }
      } else { logMsg_(ss, 'Реклама: upd HTTP ' + r2.getResponseCode()); }
    } catch (e) { logMsg_(ss, 'Реклама: upd error ' + e.message); }
  } else {
    // nmId → артикул поставщика из Базы
    var nm2sa = {};
    var bsh = ss.getSheetByName(BAZA_SHEET);
    if (bsh && bsh.getLastRow() > 1) {
      var nmA = bsh.getRange(2, 36, bsh.getLastRow() - 1, 1).getValues();  // AJ nm_id
      var saA = bsh.getRange(2, 38, bsh.getLastRow() - 1, 1).getValues();  // AL sa_name
      for (var q = 0; q < nmA.length; q++) nm2sa[String(nmA[q][0])] = String(saA[q][0] || '');
    }
    for (var z = 0; z < perNm.length; z++) {
      var st = perNm[z];
      rows.push([st.dt || (from + '–' + to), campName_(camps, st.camp), st.nm, nm2sa[String(st.nm)] || '', st.sum]);
    }
  }

  if (rows.length) sh.getRange(2, 1, rows.length, 5).setValues(rows);
  logMsg_(ss, 'Реклама: записано строк ' + rows.length + ' за ' + from + ' → ' + to);
  return rows.length;
}

function walkCampaigns_(node, out) {
  if (!node || typeof node !== 'object') return;
  if (node.advertId !== undefined) { out.push({ id: Number(node.advertId), name: node.name || '' }); return; }
  if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) walkCampaigns_(node[i], out); return; }
  for (var k in node) walkCampaigns_(node[k], out);
}

function campName_(camps, id) {
  for (var i = 0; i < camps.length; i++) if (camps[i].id === Number(id)) return camps[i].name || ('ID ' + id);
  return id !== undefined && id !== '' ? 'ID ' + id : 'Реклама';
}

// рекурсивно собирает объекты с nmId и sum
function collectNmStats_(node, out, camp) {
  if (out === undefined) { out = []; }
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) collectNmStats_(node[i], out, camp); return out; }
  var newCamp = camp;
  if (node.campaignID !== undefined || node.campaignId !== undefined) newCamp = node.campaignID || node.campaignId;
  if (node.nmId !== undefined && (node.sum !== undefined || node.cpm !== undefined)) {
    out.push({ camp: newCamp, nm: node.nmId, sum: Number(node.sum) || 0, dt: node.dt || node.date || '' });
  }
  for (var k in node) {
    if (typeof node[k] === 'object') collectNmStats_(node[k], out, newCamp);
  }
  return out;
}
