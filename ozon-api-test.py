#!/usr/bin/env python3
"""
Ozon API Client - Тест доступа и получение документации
"""

import requests
import json

CLIENT_ID = "545769"
API_KEY = "4a354024-83bb-4a8d-8668-7212e3044463"
BASE_URL = "https://api-seller.ozon.ru"

def test_api_access():
    """Проверяем доступ к API Seller"""

    headers = {
        "Client-Id": CLIENT_ID,
        "Api-Key": API_KEY,
        "Content-Type": "application/json"
    }

    # Пробуем разные эндпоинты
    endpoints = [
        ("/v1/seller/info", "GET", None),
        ("/v2/posting/fbo/list", "POST", {"filter": {"status": ""}, "limit": 1}),
        ("/v1/product/info/attributes", "POST", {"offer_id": "", "product_id": 0})
    ]

    results = []
    for endpoint, method, payload in endpoints:
        url = f"{BASE_URL}{endpoint}"

        try:
            if method == "GET":
                response = requests.get(url, headers=headers, timeout=10)
            else:
                response = requests.post(url, headers=headers, json=payload, timeout=10)

            results.append({
                "endpoint": endpoint,
                "method": method,
                "status_code": response.status_code,
                "success": response.status_code == 200,
                "response": response.json() if response.status_code == 200 and response.text else response.text[:500]
            })
        except Exception as e:
            results.append({
                "endpoint": endpoint,
                "method": method,
                "error": str(e)
            })

    return results

def get_products_list(limit=10):
    """Получаем список товаров"""

    headers = {
        "Client-Id": CLIENT_ID,
        "Api-Key": API_KEY,
        "Content-Type": "application/json"
    }

    url = f"{BASE_URL}/v2/product/info/list"

    payload = {
        "filter": {},
        "limit": limit,
        "last_id": ""
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=10)

        return {
            "success": response.status_code == 200,
            "status_code": response.status_code,
            "response": response.json() if response.status_code == 200 else response.text
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

if __name__ == "__main__":
    print("🔍 Тест доступа к Ozon API...\n")

    # Тест 1: Информация о продавце
    print("📋 Тест 1: Информация о продавце")
    result1 = test_api_access()
    print(json.dumps(result1, ensure_ascii=False, indent=2))

    print("\n" + "="*50 + "\n")

    # Тест 2: Список товаров
    print("📦 Тест 2: Список товаров")
    result2 = get_products_list()
    print(json.dumps(result2, ensure_ascii=False, indent=2))