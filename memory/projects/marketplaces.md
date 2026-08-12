# Маркетплейсы — система автоматизации

**Статус:** 🟡 пауза
**Цель:** Мульти-клиент платформа для WB/Ozon: аналитика, репрайсинг, автоответы
**Топик:** — (пока не привязан к конкретному топику)

## Контекст

Концепция платформы для работы с несколькими клиентами-продавцами на WB и Ozon.

### Архитектура (концепт)
- **OpenClaw (VPS)** — orchestrator, cron, webhook, координация
- **Claude** — анализ, тексты, стратегии, автоответы
- **Codex** — код, скрипты API, парсеры
- **Perplexity** — правила WB/Ozon, тренды, конкуренты

### Мульти-клиенты
- 5 клиентов, каждый = отдельная организация (org_id)
- Изоляция данных по org_id
- Мульти-магазины на WB/Ozon

### БД (концепт PostgreSQL)
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

## Решения
- [2026-05-27] PostgreSQL на VPS в Docker — полный контроль, бесплатно, JSONB
- [2026-05-27] Python + SQLAlchemy или Node.js + Prisma для ORM слоя

## Текущее состояние
Концепт готов, план работ написан (5 шагов, ~1 час до рабочей БД).
Поставлен на паузу — приоритет на рабочих репрайсерах Ozon и WB.

### Что готово
- API ключ Ozon: ✅ (client_id: 959359)
- API ключ WB: нужен
- Скрипты: ozon-auth.py, ozon-api-test.py, parse_wb_prices.js, версии repriser

### Что дальше (когда вернёмся)
1. Развернуть PostgreSQL в Docker
2. SQL миграции
3. ORM слой
4. Тестовые данные
5. Интеграция с OpenClaw

## Ссылки / файлы
- Спопулярные скрипты: `~/.openclaw/workspace/`
- Ozon API skill: `skills/ozon-api/SKILL.md`
