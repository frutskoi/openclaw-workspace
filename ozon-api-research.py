#!/usr/bin/env python3
"""
Ozon API Research - Изучение доступных эндпоинтов
"""

import requests
import json

CLIENT_ID = "545769"
API_KEY = "4a354024-83bb-4a8d-8668-7212e3044463"
BASE_URL = "https://api-seller.ozon.ru"

headers = {
    "Client-Id": CLIENT_ID,
    "Api-Key": API_KEY,
    "Content-Type": "application/json"
}

# Список популярных эндпоинтов для тестирования
endpoints_to_test = [
    # Продукты
    ("/v2/product/info/list", "POST", {"filter": {}, "limit": 1, "last_id": ""}),
    ("/v2/product/info/attributes", "POST", {"offer_id": "", "product_id": 0, "with_valid_parameters": True}),

    # Цены
    ("/v1/product/import/prices", "POST", {"prices": []}),

    # Заказы
    ("/v3/posting/fbo/list", "POST", {"filter": {}, "limit": 1, "with": {"analytics_data": False}}),
    ("/v3/posting/fbs/list", "POST", {"filter": {}, "limit": 1, "with": {"analytics_data": False}}),

    # Категории
    ("/v2/category/tree", "POST", {"category_id": 0, "language": "DEFAULT"}),

    # Информация о продавце
    ("/v2/seller/info", "POST", {}),

    # Склады
    ("/v1/warehouse/list", "POST", {}),

    # Отчёты
    ("/v1/report/info", "POST", {}),
]

results = []

print("🔍 Тестирование эндпоинтов Ozon API...\n")

for endpoint, method, payload in endpoints_to_test:
    url = f"{BASE_URL}{endpoint}"

    try:
        if method == "GET":
            response = requests.get(url, headers=headers, timeout=10)
        else:
            response = requests.post(url, headers=headers, json=payload, timeout=10)

        result = {
            "endpoint": endpoint,
            "method": method,
            "status_code": response.status_code,
            "success": response.status_code in [200, 201, 204],
        }

        if response.status_code in [200, 201] and response.text:
            try:
                result["response"] = response.json()
            except:
                result["response"] = response.text[:200]
        elif response.status_code != 204:
            result["error"] = response.text[:200]

        results.append(result)

        status = "✅" if result["success"] else "❌"
        print(f"{status} {method:4} {endpoint:40} -> {response.status_code}")

    except Exception as e:
        results.append({
            "endpoint": endpoint,
            "method": method,
            "error": str(e)
        })
        print(f"❌ {method:4} {endpoint:40} -> ERROR: {str(e)[:50]}")

print("\n" + "="*70)
print(f"Всего протестировано: {len(results)}")
print(f"Успешно: {sum(1 for r in results if r.get('success'))}")

# Сохраняем результаты
with open("/home/clawd/.openclaw/workspace/ozon-api-research.json", "w") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

print("\n📄 Результаты сохранены в: ozon-api-research.json")