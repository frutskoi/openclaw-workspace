#!/bin/bash
# Cron для автоматической проверки контекстного окна
# Запускается каждые 2 часа

# Проверяем контекст
python3 /home/clawd/.openclaw/workspace/scripts/check_context.py > /tmp/context-check.log 2>&1

# Если нужно ротировать — отправляем уведомление
if grep -q "НУЖНА РОТАЦИЯ СЕССИИ" /tmp/context-check.log; then
    echo "⚠️ Требуется ротация сессии OpenClaw!" >> /tmp/context-alert.log
    echo "Выполните /new для создания новой сессии" >> /tmp/context-alert.log
    echo "Детали: tail /tmp/context-check.log" >> /tmp/context-alert.log
fi