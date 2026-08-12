#!/usr/bin/env python3
"""
WB API Weekly Check Script (Fixed)
Проверяет все endpoints WB API на работоспособность и изменения
Запускается еженедельно через cron
"""

import requests
import json
import time
from datetime import datetime
import hashlib

# Конфигурация
WB_API_TOKEN = "eyJhbG…TSYA"

# Правильные базовые URL для разных сервисов WB API
BASE_URLS = {
    "content": "https://content-api.wildberries.ru",
    "suppliers": "https://suppliers-api.wb.ru",
    "common": "https://common-api.wildberries.ru",
    "statistics": "https://statistics-api.wb.ru"
}

# Список всех проверяемых endpoints с правильными сервисами
ENDPOINTS_TO_CHECK = [
    # ЧТЕНИЕ - Content API
    ("POST", "/content/v2/get/cards/list", "content", "📦 Список карточек", {
        "settings": {"cursor": {"limit": 1}, "sort": {"ascending": False}},
        "sort": {"cursor": {"updatedAt": 0, "nmID": 0}}
    }),

    # ЧТЕНИЕ - Suppliers API
    ("POST", "/api/v2/supplier/list/goods/sum", "suppliers", "💰 Цены и остатки", {"skus": []}),
    ("GET", "/api/v2/supplier/orders", "suppliers", "📦 Заказы", {}),
    ("GET", "/api/v2/supplier/incomes", "suppliers", "📥 Поставки", {}),
    ("GET", "/api/v2/supplier/stocks", "suppliers", "📦 Остатки на складе", {}),

    # ПРИМЕЧАНИЕ: Многие endpoints могут требовать других путей
    # Это базовый список для проверки доступности сервисов
]


def make_request(method, endpoint, body=None, service="content"):
    """Выполняет запрос к WB API"""
    base_url = BASE_URLS.get(service, BASE_URLS["content"])
    url = base_url + endpoint
    headers = {
        'Authorization': WB_API_TOKEN,
        'Content-Type': 'application/json'
    }

    try:
        response = requests.request(
            method,
            url,
            headers=headers,
            json=body,
            timeout=10
        )
        return response.status_code, response.text, service
    except Exception as e:
        return 500, str(e), service


def get_response_hash(status_code, response_text):
    """Создаёт хеш ответа для сравнения изменений"""
    content_to_hash = str(status_code) + response_text[:500]
    return hashlib.md5(content_to_hash.encode()).hexdigest()


def check_api():
    """Проверяет все endpoints WB API"""
    results = []
    changes = []

    for method, endpoint, service, description, body in ENDPOINTS_TO_CHECK:
        print(f"Проверка: {description} ({service})")

        # Делаем запрос
        status_code, response_text, used_service = make_request(method, endpoint, body, service)

        # Определяем статус
        if status_code == 200:
            status = "✅ РАБОТАЕТ"
        elif status_code == 404:
            status = "❌ НЕ НАЙДЕН"
        elif status_code == 401 or status_code == 403:
            status = "🔒 ОШИБКА АВТОРИЗАЦИИ"
        elif status_code == 429:
            status = "⏰ RATE LIMIT"
        elif status_code == 500:
            status = "💥 ОШИБКА СЕРВЕРА"
        else:
            status = f"⚠️ HTTP {status_code}"

        # Создаём хеш ответа
        response_hash = get_response_hash(status_code, response_text)

        result = {
            "method": method,
            "endpoint": endpoint,
            "service": used_service,
            "description": description,
            "status_code": status_code,
            "status": status,
            "response_hash": response_hash,
            "timestamp": datetime.now().isoformat()
        }

        results.append(result)
        print(f"  {status}")

        # Небольшая задержка между запросами
        time.sleep(0.3)

    return results


def compare_with_previous(current_results):
    """Сравнивает текущие результаты с предыдущей проверкой"""
    try:
        with open('wb_api_check_history.json', 'r') as f:
            previous_results = json.load(f)
    except:
        return {"changed": False, "details": "Нет предыдущих проверок"}

    changes = []

    for current, previous in zip(current_results, previous_results):
        if current["response_hash"] != previous["response_hash"]:
            changes.append({
                "endpoint": current["endpoint"],
                "description": current["description"],
                "previous_status": previous["status"],
                "current_status": current["status"],
                "previous_code": previous["status_code"],
                "current_code": current["status_code"]
            })

    return {
        "changed": len(changes) > 0,
        "changes": changes,
        "total_endpoints": len(current_results),
        "changed_endpoints": len(changes)
    }


def save_results(results):
    """Сохраняет результаты проверки"""
    with open('wb_api_check_results.json', 'w') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    with open('wb_api_check_history.json', 'w') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)


def create_report(results, comparison):
    """Создаёт отчёт о проверке"""
    working = len([r for r in results if r["status_code"] == 200])
    total = len(results)

    report = {
        "timestamp": datetime.now().isoformat(),
        "summary": {
            "total": total,
            "working": working,
            "failed": total - working,
            "success_rate": f"{(working/total)*100:.1f}%"
        },
        "changes": comparison,
        "results": results
    }

    with open('wb_api_weekly_report.json', 'w') as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    return report


def main():
    """Главная функция"""
    print("=" * 60)
    print("🔍 WB API Weekly Check")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    print()

    # Проверяем API
    results = check_api()

    # Сравниваем с предыдущей проверкой
    comparison = compare_with_previous(results)

    # Сохраняем результаты
    save_results(results)

    # Создаём отчёт
    report = create_report(results, comparison)

    # Выводим итоги
    print()
    print("=" * 60)
    print("📊 ИТОГИ:")
    print(f"  Всего endpoints: {report['summary']['total']}")
    print(f"  Работает: {report['summary']['working']}")
    print(f"  Не работает: {report['summary']['failed']}")
    print(f"  Успешность: {report['summary']['success_rate']}")
    print()

    if comparison["changed"]:
        print("🔄 ОБНАРУЖЕНЫ ИЗМЕНЕНИЯ:")
        for change in comparison["changes"]:
            print(f"  • {change['description']}")
            print(f"    {change['previous_status']} → {change['current_status']}")
    else:
        print("✅ Изменений нет")
    print()

    # Сохраняем в ежедневный лог
    log_entry = f"""
## WB API Weekly Check - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

### Итоги:
- Всего endpoints: {report['summary']['total']}
- Работает: {report['summary']['working']}
- Не работает: {report['summary']['failed']}
- Успешность: {report['summary']['success_rate']}

### Изменения:
{json.dumps(comparison, indent=2, ensure_ascii=False)}

### Детали:
{json.dumps(results, indent=2, ensure_ascii=False)}
"""

    log_file = f"memory/{datetime.now().strftime('%Y-%m-%d')}.md"
    try:
        with open(log_file, 'a') as f:
            f.write(log_entry)
        print(f"💾 Лог записан в {log_file}")
    except:
        print("⚠️ Не удалось записать лог")

    print("=" * 60)
    print()


if __name__ == "__main__":
    main()