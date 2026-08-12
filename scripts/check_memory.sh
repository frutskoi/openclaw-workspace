#!/bin/bash
# Быстрая проверка и оптимизация памяти перед ответом

MEMORY_DIR="/home/clawd/.openclaw/workspace/memory"
DAILY_THRESHOLD_KB=50  # Если daily logs больше 50KB - optimize

# Размер daily logs
DAILY_SIZE=$(find "$MEMORY_DIR" -name "*.md" -not -path "*/archive/*" -not -name "README.md" -exec du -ck {} + 2>/dev/null | tail -1 | cut -f1)

if [ "$DAILY_SIZE" -gt "$DAILY_THRESHOLD_KB" ]; then
    echo "⚠️ Daily logs too large: ${DAILY_SIZE}KB (threshold: ${DAILY_THRESHOLD_KB}KB)"
    echo "Run: python3 /home/clawd/.openclaw/workspace/scripts/optimize_memory.py"
fi