---
name: "wildberries-api"
description: "Work with Wildberries API, Apps Script, reports, prices, ads, and OPIU automation."
---

# Wildberries API

Use for Wildberries API tasks: WB repricers, Google Sheets + Apps Script automations, OPIU/finance reports, price parsing, ads, WB API debugging.

## Ground Rules

- Read tokens from the existing secure location: `Настройки` sheet (row 2, col B) or `PropertiesService`. Never print full tokens in chat, logs, or code output.
- Auth header has no `Bearer` prefix: `Authorization: <WB_API_TOKEN>` (raw JWT).
- Rate limits are aggressive — global per-seller limiter, ~10 req/min before 429. Sleep 3+ s between calls; on 429 back off 3s×(n+1), max 5 attempts.
- `204` = valid request, no rows — not an error.
- Prefer official APIs; use public/internal endpoints only for buyer-facing prices not exposed by supplier APIs.
- Apps Script: `muteHttpExceptions: true`, inspect status codes, split full-year fetches by month (6-min runtime limit), use time-based triggers for chained runs.
- Keep raw API rows on a hidden sheet (e.g. `ОПиУ WB сырьё`); build `ОПиУ месяц` from them; never overwrite manual expense rows; log each load to `Лог` (timestamp, status, row count, errors).

## Base URLs

- `statistics-api.wildberries.ru` — orders, sales, realization/financial detail
- `content-api.wildberries.ru` — product cards
- `discounts-prices-api.wildberries.ru` — prices, discounts, uploads
- `advert-api.wildberries.ru` — ads
- `documents-api.wildberries.ru` — documents (broken, see below)
- `https://www.wildberries.ru/__internal/card/cards/v4/detail` — public buyer-facing prices/СПП (no token)

## Live-Verified Endpoints (2026-07-23)

### Statistics

- Sales: `GET /api/v1/supplier/sales?dateFrom=YYYY-MM-DD&flag=0` — flat JSON array; `flag=1` = final sales only; rolling 30-day window (older dates → empty).
- Orders: `GET /api/v1/supplier/orders?dateFrom=...&flag=0` — flat array; rolling 30-day window.
- Financial realization (OPIU source): `GET /api/v5/supplier/reportDetailByPeriod?dateFrom=...&dateTo=...&limit=100000&rrdid=0` — flat array, ~88 fields/row, weekly Fri–Thu buckets (`date_from`/`date_to`). Latency ~45 days after period end. Pagination: start `rrdid=0`; if full limit rows, re-request with last row's `rrd_id`; stop on 204/empty/short page. Watch `X-Ratelimit-Remaining`.

Key report fields by purpose:
- Identity: `nm_id`, `sa_name`, `brand_name`, `subject_name`, `barcode`
- Operation/dates: `supplier_oper_name`, `order_dt`, `sale_dt`, `rr_dt`, `realizationreport_id`, `rrd_id`
- Qty/revenue: `quantity` (negative = returns), `retail_amount` (actual paid), `retail_price`, `ppvz_for_pay`, `return_amount`
- Commission: `ppvz_sales_commission`, `ppvz_reward`, `ppvz_vw`, `commission_percent`
- Logistics/storage: `delivery_rub`, `rebill_logistic_cost`, `storage_fee`
- Deductions: `penalty`, `deduction`, `acceptance`, `additional_payment`
- Acquiring: `acquiring_fee`, `acquiring_percent`
- Other fields (discounts/promo, VAT, INN, office, delivery metadata, etc.) exist in the response — inspect raw rows before mapping.

`supplier_oper_name` values: `Продажа` (sale), `Логистика` (delivery, `delivery_rub`), `Возмещение издержек по перевозке/по складским операциям` (reverse logistics, `rebill_logistic_cost`/`ppvz_vw`), `Возврат`, `Хранение`.

### Content

- `POST /content/v2/get/cards/list` with `{"settings":{"cursor":{"limit":100},"filter":{"withPhoto":-1}}}` — paginate via `cursor` with `updatedAt`+`nmID` from previous response.

### Prices

- List: `GET /api/v2/list/goods/filter?limit=1000&offset=0` — `sizes[].price`/`discountedPrice` are in **kopecks**.
- Upload: `POST /api/v2/upload/task` — `{"data":[{"nmID":N,"sizes":[{"techSizeName":"42","price":89000,"discountedPrice":4450}]}]}` (kopecks).

### Ads

- Campaign list: `GET /adv/v1/promotion/count` — groups by type (4 search, 5 catalog, 6 auto, 7 search+catalog, 9 smart); campaigns observed in status 7 (finished).
- Daily expenses (OPIU ad source): `GET /adv/v1/upd?from=...&to=...` — live (200) but returned `[]` for all tested 2026 months; possibly missing advert-stats scope or no spend. Verify before relying on it.

### Public

- Buyer card prices/СПП: `GET /__internal/card/cards/v4/detail?appType=1&curr=rub&dest=-1257786&spp=30&nm=<ids>` — batch 20 nmIDs, throttle, retry on 429/5xx.

### Documents (broken)

- `GET /api/v1/documents/list?beginTime=...&endTime=...` — `beginTime` rejected in every format tested (ISO Z, +03:00, epoch s/ms). Likely needs the authorized user browser token (`Настройки!B3`) rather than the API token.

## Deprecated Endpoints (verified 404 — do not retry)

`/api/v1/supplier/stocks`; `/api/v2/supplier/report/detail` (use v5); `adv/v2/fullstats`; `adv/v1/promotion/adverts`; `adv/v1/promotion/adverts/{id}`; `adv/v2/upd`; `adv/v1/stat/words`; `adv/v1/stat/campaigns`; `adv/v1/stat/daily`; `adv/v1/auto/stats`.

## OPIU Mapping (from reportDetailByPeriod)

Group rows by month (`date_from` or `rr_dt`), then sum:

| Line | Field | Filter |
|---|---|---|
| Выручка | `retail_amount` | `supplier_oper_name = "Продажа"` |
| Возвраты | `retail_amount` (negative) | oper contains "Возврат" |
| Комиссия WB | `ppvz_sales_commission` (fallback `ppvz_reward`) | sale rows |
| Логистика | `delivery_rub` | oper = "Логистика" |
| Логистика возвратов | `rebill_logistic_cost` | "Возмещение издержек" rows |
| Хранение | `storage_fee` | oper = "Хранение" |
| Штрафы / Удержания / Приёмка / Доплаты | `penalty` / `deduction` / `acceptance` / `additional_payment` | all rows |
| Эквайринг | `acquiring_fee` | sale rows |
| Корректировка | `ppvz_vw` | compensation rows |
| Реклама | from `adv/v1/upd` | separate call |

Rows are already signed (deductions negative) — check sign before summing.

## Token Storage (project `1KZIFWQ61LUS17LpJTvemSX4jnjZJqB5hjl8E9w9a8fE`)

- `Настройки!B2` — WB API key (JWT, exp ~2027).
- `Настройки!B3` — authorized user browser token (documents-api).

## Common Failures

- `401` bad/expired or wrong token type; `403` token lacks API category; `404` endpoint removed (check deprecated list); `204` no data; `429` global rate limit.

## Validation Checklist

Before calling an automation ready:
1. Apps Script project contains the expected endpoint strings.
2. No full token logged or pasted.
3. Syntax check done for generated code.
4. One small period (e.g. one week) run first, row count and fields verified.
5. `X-Ratelimit-Remaining` checked.
6. COGS lookup keys match the `Справочник` columns.
