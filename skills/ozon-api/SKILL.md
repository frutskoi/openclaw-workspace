# Ozon Seller API Skill

**Проверено:** 2026-06-01  
**API версия:** v2/v3/v5

## 🔑 Ключи

| Аккаунт | Client-Id | API Key | Статус |
|---------|-----------|---------|--------|
| Основной | `959359` | `6294af59-7a87-46ec-b190-a9101a3e7b30` | ✅ Активен (2026-06-01) |
| Старый | `545769` | `4a354024-83bb-4a8d-8668-7212e3044463` | ⚠️ Устаревший |

## 🌐 Base URL

```
https://api-seller.ozon.ru
```

## 🔐 Аутентификация

```python
headers = {
    "Client-Id": "959359",
    "Api-Key": "6294af59-7a87-46ec-b190-a9101a3e7b30",
    "Content-Type": "application/json"
}
```

## ✅ Проверенные эндпоинты

### Список товаров
**POST** `/v3/product/list`

```python
payload = {
    "filter": {"visibility": "ALL"},  # ALL, VISIBLE, HIDDEN
    "limit": 100,                      # макс 1000
    "last_id": ""                      # строка! не число! пагинация
}
```

**Response:**
```json
{
  "result": {
    "items": [{"product_id": 123, "offer_id": "SKU-001"}],
    "total": 96,
    "last_id": "123"
  }
}
```

⚠️ **ВАЖНО:** `last_id` — **строка**, не число! `""` для первой страницы.

### Фото товаров
**POST** `/v2/product/pictures/info`

```python
payload = {
    "product_id": [123, 456, 789]  # массив ID (можно все разом)
}
```

**Response:**
```json
{
  "items": [
    {
      "product_id": 123,
      "primary_photo": ["https://ir.ozone.ru/s3/multimedia-1-c/...jpg"],
      "photo": ["url1.jpg", "url2.jpg", ...],
      "color_photo": [],
      "photo_360": [],
      "errors": []
    }
  ]
}
```

✅ Поддерживает batch-запрос (все 96 ID за один вызов).  
📝 `primary_photo` — главное фото (первый элемент = лучшее качество).  
📝 `photo` — все фото товара (включая главное + дополнительные).

### Детали товара
**POST** `/v2/product/info`

```python
payload = {"product_id": 123}
# или
payload = {"offer_id": "SKU-001"}
```

### Цены продавца
**POST** `/v5/product/info/prices`

```python
payload = {
    "filter": {"product_id": [], "offer_id": []},
    "limit": 1000,
    "last_id": ""
}
```

### Импорт цен
**POST** `/v1/product/import/prices`

```python
payload = {
    "prices": [
        {
            "offer_id": "SKU-001",
            "price": "900.00",
            "old_price": "1200.00",
            "currency_code": "RUB"
        }
    ]
}
```

### Акции / Эластичный бустинг
**POST** `/v1/actions/list` — список акций  
**POST** `/v1/actions/candidates` — товары-кандидаты  
**POST** `/v1/actions/products` — товары в акции

### Заказы FBO
**POST** `/v2/posting/fbo/list`

### Категории
**POST** `/v2/category/tree`

### Склады
**POST** `/v1/warehouse/list`

## 🚫 Rate Limiting

- Официальный лимит: ~10 req/sec (36000/час)
- **Рекомендация:** 5 сек задержки между вызовами для batch-операций
- Batch-запросы (как /v2/product/pictures/info) — 1 запрос вместо N
- 429 → `Retry-After` header

## 📝 Формат ответов

Все эндпоинты возвращают JSON с HTTP 200 при успехе.

Коды ошибок:
- `400` — неверный формат (часто: `last_id` как число вместо строки)
- `401` — неверные ключи
- `403` — нет прав
- `429` — rate limit

## ⚠️ Apps Script — первый запуск

**Первый запуск любой новой функции Apps Script всегда делает Босс вручную** — через меню таблицы. КожЗам не может выполнить функцию через Apps Script API (`scripts().run()` возвращает 404 для container-bound проектов).

Порядок работы:
1. КожЗам пишет код и загружает его в проект через `projects().updateContent()`
2. Босс открывает таблицу → меню → запускает функцию вручную
3. Дальнейшие запуски могут быть автоматическими (через триггеры/крон)

## 🔗 Google Sheets интеграция

**Spreadsheet ID:** `1VUf_ryMnXuTkD7PBBfRu36fYScwPQtXDu75Dx_iyJgk`  
**Лист:** `Репрайсер`  
**Фото (колонка A):** `=IMAGE("https://ir.ozone.ru/s3/multimedia-.../file.jpg")`

## 📂 Связанные файлы

- `ozon_api.py` — Python клиент (OzonAPI class)
- `ozon-api-research.json` — результаты исследования API
- `~/workspace/google-creds/token.json` — Google OAuth
- `~/workspace/venv/` — Python venv с google-api-python-client
