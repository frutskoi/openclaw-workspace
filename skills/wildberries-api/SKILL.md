---
name: "wildberries-api"
description: "Work with Wildberries API, Apps Script, reports, prices, ads, and OPIU automation."
---

# Wildberries API

Use this skill when working with Wildberries API, WB repricers, Google Sheets + Apps Script automations, OPIU/finance reports, price parsing, ads, or WB API debugging.

## Ground Rules

- Read tokens from the project's existing secure location: usually `Настройки` in Google Sheets (row 2, column B) or `PropertiesService`. Never print full tokens in chat or commit them.
- Prefer official APIs first. Use public/internal WB endpoints only for buyer-facing site prices when official supplier APIs do not expose the needed value.
- Handle `204` as "valid request, no rows". Handle `429` with exponential backoff (min 3s sleep).
- For Google Apps Script, include `muteHttpExceptions: true`, inspect status codes, and avoid long single runs when fetching a full year.
- **Rate limits are aggressive**: global per-seller limiter. Max ~10 requests per minute before 429. Always sleep 3+ seconds between calls.

## Base URLs

- `https://statistics-api.wildberries.ru` — orders, sales, realization/financial detail.
- `https://content-api.wildberries.ru` — product cards/content.
- `https://discounts-prices-api.wildberries.ru` — seller prices, discounts, upload prices.
- `https://advert-api.wildberries.ru` — advertising campaigns.
- `https://documents-api.wildberries.ru` — official documents (weekly reports, acts).
- `https://www.wildberries.ru/__internal/card/cards/v4/detail` — public buyer-facing card prices, useful for СПП/client prices in repricers.

Authentication header (no `Bearer` prefix, just the raw token):

```http
Authorization: <WB_API_TOKEN>
```

## Live-Verified Endpoints (tested 2026-07-23)

### ✅ Statistics API

#### Sales (last 30 days only)

```http
GET https://statistics-api.wildberries.ru/api/v1/supplier/sales?dateFrom=YYYY-MM-DD&flag=0
```

- Returns flat JSON array (not wrapped in `{response}`).
- `flag=0` = all records; `flag=1` = only final sales (no returns).
- **Rolling 30-day window**: dates older than 30 days from today return empty.
- Fields: `date`, `lastChangeDate`, `supplierArticle`, `techSize`, `barcode`, `totalPrice`, `discountPercent`, `isSupply`, `isRealization`, `promoCodeDiscount`, `warehouseName`, `countryName`, `oblastOkrugName`, `regionName`, `saleID`, `orderType`, `sticker`, `srid`, `nmId`, `brand`, `status`, `finishedPrice`, `priceWithDisc`, `commission_percent`, `spp`, `forPay`, `forPayNalog`.

#### Orders (last 30 days only)

```http
GET https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=YYYY-MM-DD&flag=0
```

- Returns flat JSON array.
- Same rolling 30-day limitation.
- Fields: `date`, `lastChangeDate`, `supplierArticle`, `techSize`, `barcode`, `totalPrice`, `discountPercent`, `warehouseName`, `oblastOkrugName`, `regionName`, `incomeID`, `odid`, `srid`, `nmId`, `orderAt`, `price`, `commission_percent`, `spp`, `isCancel`, `cancelReason`, `orderType`, `sticker`, `srid`.

#### Financial realization report (OPIU source — main endpoint)

```http
GET https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&limit=100000&rrdid=0
```

- Returns flat JSON array of rows. **88 fields per row** (see full field reference below).
- **Latency**: data available ~45 days after period end. June 2026 data not ready as of July 23, 2026. May 2026 data available.
- **Pagination**: start with `rrdid=0`. If response has `limit` rows, re-request with last row's `rrd_id`. Stop on 204, empty array, or fewer rows than limit.
- **Rate limit**: `X-Ratelimit-Remaining` header shows remaining quota. Sleep 3s between paginated calls.
- **Week grouping**: WB groups data by weekly periods (Fri–Thu). Each row has `date_from` / `date_to` showing the weekly bucket.

**Full 88-field reference** (verified live, sorted by category):

Product identity:
- `nm_id` — WB article ID (maps to `nmId` in other endpoints)
- `sa_name` — seller account name
- `brand_name` — brand
- `subject_name` — category/subject
- `barcode` — EAN barcode
- `shk_id` — barcode shipment ID

Operation/date:
- `supplier_oper_name` — operation type (see values below)
- `doc_type_name` — document type (often empty except for sales)
- `order_dt`, `sale_dt`, `rr_dt` — order/sale/report dates
- `date_from`, `date_to` — weekly period bounds
- `create_dt` — report creation timestamp
- `realizationreport_id` — report ID
- `rrd_id` — row ID (used for pagination cursor)
- `report_type` — numeric report type

Quantity/revenue:
- `quantity` — units (can be negative for returns)
- `retail_amount` — actual money paid to seller (after discounts)
- `retail_price` — list price
- `retail_price_withdisc_rub` — price with seller discount
- `ppvz_for_pay` — amount to pay seller (after WB deductions)
- `return_amount` — return refund amount

Commission:
- `ppvz_sales_commission` — sales commission (rubles)
- `ppvz_reward` — WB reward
- `ppvz_vw` — compensation adjustment (can be negative)
- `ppvz_vw_nds` — VAT on compensation
- `ppvz_kvw_prc`, `ppvz_kvw_prc_base` — commission rates
- `ppvz_spp_prc` — СПП rate
- `commission_percent` — commission percentage
- `sale_percent` — sale percentage

Logistics/storage:
- `delivery_rub` — delivery charge to seller
- `delivery_amount` — delivery quantity/flag
- `rebill_logistic_cost` — reverse logistics cost
- `storage_fee` — storage cost

Deductions/extras:
- `penalty` — penalties
- `deduction` — other deductions
- `acceptance` — acceptance fee
- `additional_payment` — extra payments to seller

Acquiring:
- `acquiring_bank` — bank name
- `acquiring_fee` — acquiring fee (rubles)
- `acquiring_percent` — acquiring rate

Discounts/promo:
- `seller_promo_discount`, `seller_promo_id`, `supplier_promo`
- `loyalty_discount`, `loyalty_id`
- `cashback_amount`, `cashback_commission_change`, `cashback_discount`
- `product_discount_for_report`
- `sale_price_affiliated_discount_prc`
- `sale_price_promocode_discount_prc`
- `sale_price_wholesale_discount_prc`
- `wibes_wb_discount_percent`
- `installment_cofinancing_amount`

Other:
- `currency_name`, `suppliercontract_code`, `office_name`
- `ppvz_inn`, `ppvz_office_id`, `ppvz_office_name`, `ppvz_supplier_id`, `ppvz_supplier_name`
- `srid`, `gi_id`, `gi_box_type_name`, `trbx_id`, `assembly_id`
- `sticker_id`, `declaration_number`, `site_country`
- `delivery_method`, `dlv_prc`, `fix_tariff_date_from`, `fix_tariff_date_to`
- `b2b_customer_tin`, `is_legal_entity`, `is_kgvp_v2`
- `payment_processing`, `payment_schedule`
- `sup_rating_prc_up`, `article_substitution`, `acquiring_bank`
- `srv_dbs`, `uuid_promocode`, `order_uid`, `ts_name`

**`supplier_oper_name` values observed (May 2026):**
- `Продажа` — sale (has retail_amount, commissions, acquiring)
- `Логистика` — delivery charge (delivery_rub populated)
- `Возмещение издержек по перевозке/по складским операциям с товаром` — reverse logistics (rebill_logistic_cost, ppvz_vw)
- `Возврат` — return (expected, not in May sample)
- `Хранение` — storage (expected, not in May sample; check other months)

### ✅ Content API

#### Product cards

```http
POST https://content-api.wildberries.ru/content/v2/get/cards/list
```

Payload:
```json
{
  "settings": {
    "cursor": { "limit": 100 },
    "filter": { "withPhoto": -1 }
  }
}
```

- Use `settings.cursor` pagination with `updatedAt` and `nmID` from the previous response.
- Fields: `brand`, `characteristics`, `createdAt`, `description`, `dimensions`, `imtID`, `kizMarked`, `needKiz`, `nmID`, `nmUUID`, `photos`, `sizes`, `subjectID`, `subjectName`, `tags`, `title`, `updatedAt`, `vendorCode`, `video`.

### ✅ Prices API

#### Seller prices and discounts

```http
GET https://discounts-prices-api.wildberries.ru/api/v2/list/goods/filter?limit=1000&offset=0
```

- Fields: `nmID`, `vendorCode`, `discount`, `clubDiscount`, `currencyIsoCode4217`, `editableSizePrice`, `sizes[]`.
- `sizes[]` contains: `sizeID`, `price` (kopecks), `discountedPrice` (kopecks), `clubDiscountedPrice`, `techSizeName`.
- **All prices in kopecks** — divide by 100 for rubles.

#### Upload prices

```http
POST https://discounts-prices-api.wildberries.ru/api/v2/upload/task
```

Payload: `{ "data": [ { "nmID": 123, "sizes": [ { "techSizeName": "42", "price": 89000, "discountedPrice": 4450 } ] } ] }`

### ✅ Advert API

#### Campaign list

```http
GET https://advert-api.wildberries.ru/adv/v1/promotion/count
```

- Returns `{ "adverts": [ { "type": N, "status": N, "count": N, "advert_list": [ { "advertId": N, "changeTime": "ISO" } ] } ], "all": N }`.
- Type values observed: 4 (search promo, 3 camps), 5 (catalog, 19), 6 (auto, 92), 7 (search+catalog, 6), 9 (smart, 77).
- All campaigns in status 7 (finished/stopped) as of July 2026.

#### Daily ad expenses (OPIU advertising source)

```http
GET https://advert-api.wildberries.ru/adv/v1/upd?from=YYYY-MM-DD&to=YYYY-MM-DD
```

- Returns flat JSON array.
- **Currently returns empty `[]`** for all tested months (Jan, Mar, May 2026). Endpoint is live (200) but no spend data.
- May indicate token lacks advert-stats scope, or campaigns had no spend.

### ✅ Public (no token)

#### Buyer-facing card prices / СПП

```http
GET https://www.wildberries.ru/__internal/card/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&nm=<ids>
```

- Batch by 20 nmIDs, throttle, retry on 429/5xx.
- Returns product info, prices, discounts, СПП.

### ⚠️ Documents API

```http
GET https://documents-api.wildberries.ru/api/v1/documents/list?beginTime=...&endTime=...
```

- **Could not get this endpoint working**: `beginTime` rejected in all formats tested (ISO 8601 with Z, with +03:00, epoch seconds, epoch milliseconds).
- May require different auth token (authorized user token vs API token).

## ❌ Deprecated / Dead Endpoints (verified 2026-07-23)

| Endpoint | Status | Notes |
|---|---|---|
| `GET /api/v1/supplier/stocks` | 404 | Disabled `PLUG-404-20260720`. Deprecated. |
| `GET /api/v2/supplier/report/detail` | 404 | Use v5 `reportDetailByPeriod`. |
| `POST /adv/v2/fullstats` | 404 | Removed. |
| `GET /adv/v1/promotion/adverts` | 404 | Removed. |
| `GET /adv/v1/promotion/adverts/{id}` | 404 | Removed. |
| `GET /adv/v2/upd` | 404 | Removed. Use `adv/v1/upd`. |
| `GET /adv/v1/stat/words` | 404 | Removed. |
| `GET /adv/v1/stat/campaigns` | 404 | Removed. |
| `GET /adv/v1/stat/daily` | 404 | Removed. |
| `GET /adv/v1/auto/stats` | 404 | Removed. |

## OPIU Mapping (from reportDetailByPeriod)

Group raw rows by month (using `date_from` or `rr_dt`), then sum:

| OPIU Line | Field(s) | Filter / Notes |
|---|---|---|
| **Выручка (продажи)** | `retail_amount` | `supplier_oper_name = "Продажа"` |
| **Возвраты** | `retail_amount` (negative) | `supplier_oper_name` contains "Возврат" |
| **Комиссия WB** | `ppvz_sales_commission` | From sale rows; fallback `ppvz_reward` |
| **Логистика** | `delivery_rub` | From rows with `supplier_oper_name = "Логистика"` |
| **Логистика возвратов** | `rebill_logistic_cost` | From "Возмещение издержек" rows |
| **Хранение** | `storage_fee` | From rows with `supplier_oper_name = "Хранение"` |
| **Штрафы** | `penalty` | All rows |
| **Удержания** | `deduction` | All rows |
| **Приёмка** | `acceptance` | All rows |
| **Доплаты** | `additional_payment` | All rows |
| **Эквайринг** | `acquiring_fee` | From sale rows |
| **Корректировка** | `ppvz_vw` | Compensation adjustments |
| **Реклама** | from `adv/v1/upd` | Separate API call |

**Important**: rows are already signed (negative for deductions). Check sign before summing.

**Sample May 2026 totals** (5 rows, one sale):
- Выручка: 494.00
- Комиссия: 2.25
- Логистика: 134.65
- Эквайринг: 19.76
- Reverse logistics: 16.02

## Apps Script Helper

```javascript
function wbFetchJson_(url, token, options) {
  options = options || {};
  var method = options.method || 'get';
  var payload = options.payload;

  for (var attempt = 0; attempt < 5; attempt++) {
    var resp = UrlFetchApp.fetch(url, {
      method: method,
      contentType: 'application/json',
      headers: { Authorization: token },
      payload: payload ? JSON.stringify(payload) : undefined,
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    var text = resp.getContentText();
    if (code === 204) return [];       // valid, no data
    if (code >= 200 && code < 300) return text ? JSON.parse(text) : null;
    if (code === 429 || code >= 500) {
      Utilities.sleep(3000 * (attempt + 1));  // aggressive backoff
      continue;
    }
    throw new Error('WB API ' + code + ': ' + text.substring(0, 500));
  }
  throw new Error('WB API retry limit: ' + url);
}

function wbFetchReportDetail_(token, dateFrom, dateTo) {
  var allRows = [];
  var rrdid = 0;
  var LIMIT = 100000;

  while (true) {
    var url = 'https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod'
      + '?dateFrom=' + dateFrom + '&dateTo=' + dateTo
      + '&limit=' + LIMIT + '&rrdid=' + rrdid;
    var rows = wbFetchJson_(url, token);
    if (!rows || rows.length === 0) break;
    allRows = allRows.concat(rows);
    if (rows.length < LIMIT) break;
    rrdid = rows[rows.length - 1].rrd_id;
    Utilities.sleep(3000);
  }
  return allRows;
}
```

## Google Sheets Patterns

- Keep raw API rows on a hidden sheet (e.g. `ОПиУ WB сырьё`).
- Build `ОПиУ месяц` from raw rows; do not overwrite manual expense rows.
- For full-year fetches, split by month to stay under Apps Script 6-min runtime and WB rate limits.
- Log each load to `Лог` with timestamp, status, row count, errors.
- Use time-based triggers for chained execution if processing >6 min.

## Token Storage

Current project (`1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE`):
- `Настройки!B2` — API ключ WB (read/write, JWT, exp ~2027).
- `Настройки!B3` — Authorized user browser token (for documents-api).
- Token is a JWT (ES256). Decoded payload reveals: `uid`, `sid` (seller ID), `exp`.
- **Never output full token in chat or logs.** Always read from the sheet at runtime.

## Common Failures

- `401`: bad/expired token or wrong token type.
- `403`: token lacks required WB API category.
- `404`: endpoint removed/deprecated. Check deprecated list above.
- `204`: no data for period (valid response, not an error).
- `429`: rate limit. **Global per-seller limiter** — ALL endpoints share quota. Sleep 3s+ between calls.
- `400 beginTime is invalid`: documents-api requires specific time format (possibly authorized user token, not API token).

## Validation Checklist

Before saying an automation is ready:

1. Confirm the Apps Script project contains the expected endpoint strings.
2. Confirm no full token was logged or pasted into output.
3. Run a syntax check if code was generated outside Apps Script.
4. Run one small period first (e.g., one week), verify row count and fields.
5. Check `X-Ratelimit-Remaining` header to monitor quota.
6. Confirm COGS lookup keys match the project's `Справочник` columns.
