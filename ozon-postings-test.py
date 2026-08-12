#!/usr/bin/env python3
"""
Ozon API - Проверка рабочего эндпоинта
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

print("📦 Тестирование /v2/posting/fbo/list...\n")

# Правильная структура запроса
payload = {
    "dir": "asc",
    "filter": {
        "since": "2025-01-01T00:00:00.000Z",
        "status": "",
        "to": "2025-12-31T23:59:59.999Z"
    },
    "limit": 10,
    "offset": 0,
    "with": {
        "barcodes": True,
        "financial_data": True
    }
}

url = f"{BASE_URL}/v2/posting/fbo/list"

response = requests.post(url, headers=headers, json=payload, timeout=10)

print(f"Status: {response.status_code}")
print(f"Response:\n{json.dumps(response.json(), ensure_ascii=False, indent=2)}")