#!/usr/bin/env python3
"""
Прокси сервер для WB API
Решает проблему CORS в Google Apps Script
"""

from flask import Flask, request, jsonify
import requests
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Разрешаем CORS для всех запросов

WB_API_BASE = 'https://suppliers-api.wildberries.ru'

@app.route('/<path:endpoint>', methods=['GET', 'POST', 'PUT', 'DELETE'])
def proxy_wb_api(endpoint):
    """Проксирует запросы к WB API"""
    
    # Формируем URL WB API
    url = f"{WB_API_BASE}/{endpoint}"
    
    # Получаем заголовки из запроса
    headers = dict(request.headers)
    
    # Удаляем заголовки Host (Flask добавляет свой)
    headers.pop('Host', None)
    headers.pop('Content-Length', None)
    
    # Получаем тело запроса если есть
    body = request.get_json() if request.method != 'GET' else None
    
    try:
        # Делаем запрос к WB API
        if request.method == 'GET':
            response = requests.get(url, headers=headers, params=request.args, timeout=30)
        elif request.method == 'POST':
            response = requests.post(url, headers=headers, json=body, timeout=30)
        elif request.method == 'PUT':
            response = requests.put(url, headers=headers, json=body, timeout=30)
        elif request.method == 'DELETE':
            response = requests.delete(url, headers=headers, timeout=30)
        else:
            return jsonify({'error': 'Method not allowed'}), 405
        
        # Возвращаем ответ WB API
        return jsonify(response.json()), response.status_code
        
    except requests.exceptions.RequestException as e:
        return jsonify({'error': f'Proxy error: {str(e)}'}), 500
    except Exception as e:
        return jsonify({'error': f'Internal error: {str(e)}'}), 500

@app.route('/health', methods=['GET'])
def health():
    """Проверка здоровья прокси"""
    return jsonify({'status': 'ok', 'service': 'WB API Proxy'}), 200

if __name__ == '__main__':
    print("🚀 WB API Proxy запущен!")
    print("📡 Listening on: http://0.0.0.0:5000")
    print("🔗 Пример запроса: http://ваш-сервер:5000/public/api/v1/info/getGoodsList")
    print("\nНажми Ctrl+C для остановки")
    
    app.run(host='0.0.0.0', port=5000, debug=False)