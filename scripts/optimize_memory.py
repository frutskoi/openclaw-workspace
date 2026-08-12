#!/usr/bin/env python3
"""
Оптимизация памяти OpenClaw
Очищает дубли, архивирует старое, экономит токены
"""

import os
import json
import re
from datetime import datetime, timedelta
from pathlib import Path

WORKSPACE = Path("/home/clawd/.openclaw/workspace")
MEMORY_FILE = WORKSPACE / "MEMORY.md"
MEMORY_DIR = WORKSPACE / "memory"
TOPICS_DIR = MEMORY_DIR / "topics"
CACHE_DIR = WORKSPACE / "memory" / "cache"

# Создаем cache directory если нет
CACHE_DIR.mkdir(parents=True, exist_ok=True)


def analyze_memory():
    """Анализ текущего состояния памяти"""
    print("📊 Анализ памяти...")

    # MEMORY.md
    if MEMORY_FILE.exists():
        lines = MEMORY_FILE.read_text(encoding='utf-8').count('\n')
        size = MEMORY_FILE.stat().st_size / 1024
        print(f"  MEMORY.md: {lines} строк, {size:.1f} KB")

    # Topic memory
    topic_files = list(TOPICS_DIR.glob("*.md"))
    total_topic_lines = sum(f.read_text(encoding='utf-8').count('\n') for f in topic_files)
    print(f"  Topics: {len(topic_files)} файлов, {total_topic_lines} строк")

    # Daily logs
    daily_files = [f for f in MEMORY_DIR.glob("*.md") if f.name != "README.md"]
    total_daily_size = sum(f.stat().st_size for f in daily_files) / 1024
    print(f"  Daily logs: {len(daily_files)} файлов, {total_daily_size:.1f} KB")

    # Cache
    cache_files = list(CACHE_DIR.glob("*.json"))
    total_cache_size = sum(f.stat().st_size for f in cache_files) / 1024
    print(f"  Cache: {len(cache_files)} файлов, {total_cache_size:.1f} KB")

    return {
        'memory_lines': lines if MEMORY_FILE.exists() else 0,
        'topic_lines': total_topic_lines,
        'topic_count': len(topic_files),
        'daily_size': total_daily_size,
        'daily_count': len(daily_files),
        'cache_size': total_cache_size,
        'cache_count': len(cache_files)
    }


def extract_cache_data():
    """Извлечь структурированные данные из MEMORY.md в cache"""
    print("\n🔍 Поиск данных для cache...")

    cache = {}
    memory_text = MEMORY_FILE.read_text(encoding='utf-8') if MEMORY_FILE.exists() else ""

    # Google Sheets ID
    sheets_match = re.search(r'ID:\s*`([A-Za-z0-9_-]+)`', memory_text)
    if sheets_match:
        cache['google_sheets_id'] = {
            'id': sheets_match.group(1),
            'name': 'Репрайсер WB',
            'updated': datetime.now().isoformat()
        }

    # API ключи (внимательно - не логируем!)
    if 'API ключ' in memory_text or 'token.json' in memory_text:
        cache['google_api_status'] = {
            'configured': True,
            'path': '~/.openclaw/workspace/google-creds/token.json',
            'updated': datetime.now().isoformat()
        }

    if cache:
        cache_file = CACHE_DIR / "google_services.json"
        cache_file.write_text(json.dumps(cache, indent=2, ensure_ascii=False), encoding='utf-8')
        print(f"  ✅ Сохранено: cache/google_services.json")


def cleanup_memory():
    """Очистка MEMORY.md от дублирующейся информации"""
    print("\n🧹 Очистка MEMORY.md...")

    if not MEMORY_FILE.exists():
        return

    memory_text = MEMORY_FILE.read_text(encoding='utf-8')

    # Удаляем дублирующиеся пустые строки (более 2 подряд)
    memory_text = re.sub(r'\n{3,}', '\n\n', memory_text)

    # Удаляем trailing whitespace
    lines = [line.rstrip() for line in memory_text.split('\n')]
    memory_text = '\n'.join(lines)

    # Сохраняем
    MEMORY_FILE.write_text(memory_text, encoding='utf-8')
    print("  ✅ MEMORY.md очищен")


def archive_old_daily(days=7):
    """Архивировать старые daily logs"""
    print(f"\n📦 Архивирование daily logs (старше {days} дней)...")

    cutoff = datetime.now() - timedelta(days=days)
    archived = 0

    for daily_file in MEMORY_DIR.glob("*.md"):
        if daily_file.name in ["README.md"]:
            continue

        # Пытаемся извлечь дату из имени
        date_match = re.match(r'(\d{4}-\d{2}-\d{2})', daily_file.name)
        if date_match:
            try:
                file_date = datetime.strptime(date_match.group(1), '%Y-%m-%d')
                if file_date < cutoff:
                    # Архивируем
                    archive_dir = MEMORY_DIR / "archive"
                    archive_dir.mkdir(exist_ok=True)
                    daily_file.rename(archive_dir / daily_file.name)
                    archived += 1
            except ValueError:
                pass

    print(f"  ✅ Архивировано: {archived} файлов")


def optimize_topic_memory():
    """Оптимизация topic memory"""
    print("\n🗂️ Оптимизация topic memory...")

    for topic_file in TOPICS_DIR.glob("*.md"):
        text = topic_file.read_text(encoding='utf-8')

        # Удаляем лишние пустые строки
        text = re.sub(r'\n{3,}', '\n\n', text)
        text = '\n'.join(line.rstrip() for line in text.split('\n'))

        # Если файл > 100 строк — предлагаю архивировать
        lines = text.count('\n')
        if lines > 100:
            print(f"  ⚠️ {topic_file.name}: {lines} строк (рекомендуется очистить)")

        topic_file.write_text(text, encoding='utf-8')

    print(f"  ✅ Topic memory оптимизирован")


def generate_report(before, after):
    """Генерация отчета"""
    print("\n📈 Отчет об оптимизации:")
    print(f"\nДо:")
    print(f"  MEMORY.md: {before['memory_lines']} строк")
    print(f"  Topics: {before['topic_count']} файлов, {before['topic_lines']} строк")
    print(f"  Daily: {before['daily_count']} файлов, {before['daily_size']:.1f} KB")
    print(f"  Cache: {before['cache_count']} файлов, {before['cache_size']:.1f} KB")

    print(f"\nПосле:")
    print(f"  MEMORY.md: {after['memory_lines']} строк")
    print(f"  Topics: {after['topic_count']} файлов, {after['topic_lines']} строк")
    print(f"  Daily: {after['daily_count']} файлов, {after['daily_size']:.1f} KB")
    print(f"  Cache: {after['cache_count']} файлов, {after['cache_size']:.1f} KB")

    # Расчет экономии токенов (приблизительно)
    tokens_before = before['memory_lines'] + before['topic_lines'] + (before['daily_size'] * 0.5)
    tokens_after = after['memory_lines'] + after['topic_lines'] + (after['daily_size'] * 0.5)
    saved = tokens_before - tokens_after

    print(f"\n💰 Оценка экономии токенов: ~{int(saved)} токенов на загрузку")


def main():
    print("👹 Оптимизация памяти КожЗам")
    print("=" * 50)

    # Анализ до
    before = analyze_memory()

    # Операции
    extract_cache_data()
    cleanup_memory()
    archive_old_daily(days=7)
    optimize_topic_memory()

    # Анализ после
    after = analyze_memory()

    # Отчет
    generate_report(before, after)

    print("\n✅ Оптимизация завершена!")


if __name__ == "__main__":
    main()