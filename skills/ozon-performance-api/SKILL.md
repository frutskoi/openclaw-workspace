---
name: "ozon-performance-api"
description: "Ozon Performance API: authenticate, fetch SKU ad spend reports, compute DRR. Use for ad data pulls and Ozon seller/performance integrations."
---

# Ozon Performance API (реклама)

Получение рекламных расходов по SKU и ДРР из Performance API Ozon.

## Аутентификация
1. Домен ТОЛЬКО `https://api-performance.ozon.ru` — старый `performance.ozon.ru` отдаёт 307/404.
2. Токен: POST `/api/client/token`, Content-Type `application/x-www-form-urlencoded`, body: `client_id=<id>@advertising.performance.ozon.ru&client_secret=<secret>&grant_type=client_credentials`. Токен живёт 1800 сек — перевыпускай перед каждой сессией.
3. Каждый запрос: заголовок `Authorization: Bearer <token>` + `Accept: application/json`. Без Accept возможен 401 «Запрос не аутентифицирован» даже с валидным токеном.

## Отчёт по расходам SKU
1. GET `/api/client/campaign` → список кампаний; фильтруй `state == "CAMPAIGN_STATE_RUNNING"` (архивные пусты).
2. POST `/api/client/statistics/json` c `{"campaigns":[...до 10 id...],"dateFrom":"YYYY-MM-DD","dateTo":"YYYY-MM-DD","groupBy":"SKU"}` → в ответе `UUID`.
3. GET `/api/client/statistics/report?UUID=<uuid>` — отчёт готов не сразу: лови 404 и повторяй с паузой 8 сек до ~25 раз.
4. Строки отчёта: поля `sku`, `moneySpent`, `orders`, `ordersMoney`, `views`, `clicks`, `ctr`, `drr` — числа с запятой, парси заменой `,`→`.`.
5. Чанки кампаний по 10; некоторые кампании спецформатов отдают 400 «generation of this type of report is forbidden» — пропускай их, не роняй цикл.
6. SKU отчёта ≠ Offer ID: маппинг через Seller API `/v3/product/info/list` → `sources[].sku` → `product_id`.

## ДРР
- ДРР = расход SKU / (продажи SKU × цена) × 100. Норма 10–20%; допуск = маржинальность − целевая чистая прибыль (обычно 10%).
- Продажи 30д: Seller API `/v2/posting/fbo/list` status=delivered за период, суммируй quantity по offer_id.

## Известные грабли
- Seller API `/v1/analytics/data` старые метрики (hits_view_search, ordered_units_value и т.п.) → 400 «deprecated metrics used». Не трать попытки — ищи актуальный список метрик в доках.
- Seller API ключ и Performance Client ID/Secret — независимые учётки; Seller ключ в «Настройки» таблицы, Performance секрет — только в защищённое хранилище.
