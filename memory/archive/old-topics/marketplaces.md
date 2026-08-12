# Маркетплейсы - Проект

## Архитектура системы

### 4 ИИ агента
1. **OpenClaw (на VPS)** — orchestrator, координация, cron, webhook триггеры, координация всех агентов
2. **Claude (локальный/VPS)** — анализ, тексты, стратегии, автоответы, маркетинговые рекомендации
3. **Codex (локальный/VPS)** — написание кода, скрипты API, парсеры, интеграции
4. **Perplexity (локальный/VPS)** — свежая инфо о правилах WB/Ozon, трендах, competitor analysis

### Мульти-клиенты (5 клиентов)
- Каждый клиент = отдельная организация в БД
- Изоляция данных по org_id
- Мульти-магазины на WB/Ozon

## База данных

### Схема (PostgreSQL)
```
organizations → users
organizations → mp_accounts (WB/Ozon)
organizations → products
mp_accounts → mp_products
mp_accounts → warehouses
mp_accounts → orders
mp_accounts → financials
mp_accounts → ad_campaigns
mp_accounts → sync_logs
mp_products → stocks
mp_products → analytics_daily
orders → returns
```

### Где хранить
**Рекомендуется:** PostgreSQL на VPS в Docker
- Полный контроль
- Бесплатно
- JSONB поддержка
- Быстро (те же сети)

### Таблицы
- `organizations` — организации/клиенты
- `users` — пользователи
- `mp_accounts` — аккаунты маркетплейсов (WB/Ozon)
- `products` — товары
- `mp_products` — товары на маркетплейсах
- `warehouses` — склады
- `stocks` — остатки
- `orders` — заказы
- `returns` — возвраты
- `financials` — финансы
- `analytics_daily` — ежедневная аналитика
- `ad_campaigns` — рекламные кампании
- `sync_logs` — логи синхронизации

## Задачи автоматизации

### WB + Ozon
- Маркетинговый анализ
- Анализ инфографики
- Написание ТЗ на инфографику
- Написание описаний товаров
- Автоответы на вопросы и отзывы
- Предложение стратегий для роста заказов и маржинальности

## Текущий статус

### API ключи
- **Ozon:** есть (client_id: 545769, tested_at: 2025-05-27)
- **WB:** нужны

### Скрипты (существуют)
- `ozon-auth.py`
- `ozon-api-test.py`
- `ozon-postings-test.py`
- `parse_wb_prices.js`
- Несколько версий repriser

## План действий

### Шаг 1. Развернуть PostgreSQL (10 min)
- Docker-compose с PostgreSQL
- Настроить пользователя, БД
- Backup-скрипт

### Шаг 2. Создать структуру по схеме (15 min)
- SQL миграции для всех таблиц
- Индексы по FK
- JSONB колонки

### Шаг 3. ORM слой (20 min)
- SQLAlchemy (Python) или Prisma (Node.js)
- Модели по схеме
- Базовые CRUD операции

### Шаг 4. Тестовые данные (10 min)
- 1 организация
- 1-2 аккаунта маркетплейса
- Несколько товаров

### Шаг 5. Интеграция с OpenClaw (15 min)
- Модуль для работы с БД
- Коннекторы WB/Ozon пишут в БД

**Итого:** ~1 час до рабочей БД

## Вопросы для решения

1. Локальный ПК или VPS для всей системы?
2. Как связать агенты между собой?