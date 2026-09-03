---
name: "ozon-seller-api"
description: "Ozon Seller API unit economics: auth via Настройки!C3, commissions with avg tariff, buyback from postings, FBS no-return-cost model."
---

# Ozon Seller API — Unit Economics

## Когда
Пересчёт листа «Юнит экономика» или проверка комиссий/логистики/остатков Ozon по Seller API.

## Доступ
- Client-Id `959359`, ключ читается из листа «Настройки!C3» таблицы `1VUf_ryMnXuTkD7PBBfRu36fYScwPQtXDu75Dx_iyJgk` (Google OAuth refresh в `google-creds/token.json`, scopes script.projects + spreadsheets).
- Apps Script проекта: `1_ULT1JZsw-rFh0qXsjCkvr00VA3Xcp1rt5TwGf6Amqm75NF3-4oRwdWw`; обновлять файл `Code` через `projects/{id}/content` PUT, сохраняя остальные файлы.

## Правильный расчёт (модель FBS, решения Босса 2026-08-31..09-02)
1. Комиссия: `sales_percent_fbs` от цены продажи.
2. Логистика туда = **средний тариф** `(fbs_direct_flow_trans_max_amount + fbs_direct_flow_trans_min_amount)/2` — max это дальняя зона, завышает расходы на 30–50%.
3. Обратная логистика — только справочно: невыкуп по FBS остаётся на складе Ozon, обратной перевозки продавец не платит → «расход на возвраты» = 0.
4. Невыкуп входит иначе: каждая отправка едет отдельно → логистика на единицу = `(логТуда + последняя_миля)/выкуп`.
5. Реклама = 10% от цены, налог = 8% (УСН), если не задано вручную.
6. Баллы Ozon (СПП) НЕ входят в прибыль/безубыток.
7. % выкупа: фактический `delivered/(delivered+cancelled)` по `/v2/posting/fbo/list` за 3 месяца, точность до сотых; без истории — 0.9.
8. Архивные товары исключать: сверять с `/v3/product/list` (фильтр is_archived игнорируется — только сверкой списков).
9. Прибыль = цена − (комиссия + логистика/выкуп + первый км + эквайринг + себестоимость + реклама + налог). Безубыток = итого расходы.

## Фактическая юнитка за месяц (лист «Юнитка по месяцам (факт)»)
1. Выгрузить все операции `/v3/finance/transaction/list` (обязательны `page`+`page_size`, не from/limit) за месяц: `filter.date.from/to` ISO Z.
2. SKU→offer через `/v3/product/info/list` (передавать `sku: [...]`, до 900 за запрос; source[].sku → product_id/offer_id).
3. Разнести: OperationAgentDeliveredToCustomer → qty=len(items), выручка=`accruals_for_sale`, комиссия=`sale_commission` (отрицательные — брать abs), услуги из `services[]` по имени: Acquiring→эквайринг, Logistic/LastMile/Dropoff→логистика, StarsMembership→прочее. MarketplaceRedistributionOfAcquiring→эквайринг, BrandCommission→комиссия, CostPerClick/PromotionWithCostPerOrder→реклама, DefectFine→штрафы, Return*→возвраты.
4. Себестоимость из «Справочник» по pid, налог 8% от выручки.
5. Операции без SKU (реклама по кампаниям, штрафы) не разнесутся — выводить отдельной строкой «НЕ РАСПРЕДЕЛЕНО» с расшифровкой, не терять.

## Проверка данных
- `/v5/product/info/prices` (пагинация limit=100): commissions, acquiring, volume_weight.
- У Ozon `fbs_return_flow_amount` всегда равен max-тарифу туда — совпадение колонок туда/обратно это норма тарификации, не баг.
- Google-токен живёт ~1ч: перед серией запросов обновлять через refresh_token (паттерн /tmp/gsh.py refresh+retry).
