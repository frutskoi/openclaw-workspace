#!/usr/bin/env python3
"""
Puter.com Python CLI
Работа с Puter через HTTP API
"""

import requests
import json
import sys

# Конфигурация
PUTER_AUTH_TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0eXBlIjoiZ3VpIiwidmVyc2lvbiI6IjAuMC4wIiwidXVpZCI6ImE5MTY0MDZlLTA0YWQtNDljYy1hYTk5LThiNWEwNzQyZWM2NiIsInVzZXJfdWlkIjoiZGFjYmRkMjgtMzgwNC00MzM4LTkyYTktOTMxZTYwZTJiMWM4IiwiaWF0IjoxNzc3MDE2MjQ0fQ.qCvOVjmsTbyvnXE0ThDTkdhacC1cmD578QIVBAsqrwQ"
PUTER_API_URL = "https://api.puter.com"

# Заголовки с авторизаций
HEADERS = {
    "Authorization": f"Bearer {PUTER_AUTH_TOKEN}",
    "Content-Type": "application/json"
}


def test_connection():
    """Проверяет соединение с Puter API"""
    print("🔍 Проверка соединения с Puter API...")

    try:
        # Пробуем получить информацию о пользователе
        response = requests.get(f"{PUTER_API_URL}/user", headers=HEADERS, timeout=10)

        if response.status_code == 200:
            data = response.json()
            print("✅ Соединение установлено!")
            print(f"👤 Пользователь: {data.get('username', 'Unknown')}")
            return True
        else:
            print(f"❌ Ошибка авторизации: HTTP {response.status_code}")
            print(f"   {response.text[:200]}")
            return False

    except Exception as e:
        print(f"❌ Ошибка соединения: {e}")
        return False


def chat_with_ai(message):
    """Чат с Puter AI"""
    print(f"🤖 Отправка сообщения в Puter AI: {message[:50]}...")

    try:
        response = requests.post(
            f"{PUTER_API_URL}/ai/chat",
            headers=HEADERS,
            json={"message": message},
            timeout=30
        )

        if response.status_code == 200:
            data = response.json()
            response_text = data.get("message", {}).get("content", "")

            print("\n📝 Ответ:")
            print(response_text)
            return response_text
        else:
            print(f"❌ Ошибка: HTTP {response.status_code}")
            print(f"   {response.text[:200]}")
            return None

    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return None


def print_message(message):
    """Вывод сообщения в Puter"""
    print(f"📤 Отправка сообщения: {message[:50]}...")

    try:
        response = requests.post(
            f"{PUTER_API_URL}/print",
            headers=HEADERS,
            json={"content": message},
            timeout=10
        )

        if response.status_code == 200:
            print("✅ Сообщение отправлено")
            return True
        else:
            print(f"❌ Ошибка: HTTP {response.status_code}")
            return False

    except Exception as e:
        print(f"❌ Ошибка: {e}")
        return False


def show_help():
    """Показывает справку"""
    print("""
🔧 Puter CLI Tool (Python)

Использование:
  puter-cli <команда> [аргументы]

Команды:
  test                    Проверить соединение
  chat <сообщение>        Чат с Puter AI
  print <сообщение>       Вывести сообщение в Puter
  help                    Показать эту справку

Примеры:
  puter-cli test
  puter-cli chat "Привет, как дела?"
  puter-cli print "Привет, мир!"

Токен: ✅ настроен
API: https://api.puter.com
    """)


def main():
    """Главная функция"""
    if len(sys.argv) < 2:
        show_help()
        return

    command = sys.argv[1]

    try:
        if command == "test":
            test_connection()
        elif command == "chat":
            if len(sys.argv) < 3:
                print("❌ Укажите сообщение для чата")
                print("Пример: puter-cli chat \"Привет, как дела?\"")
                return
            message = " ".join(sys.argv[2:])
            chat_with_ai(message)
        elif command == "print":
            if len(sys.argv) < 3:
                print("❌ Укажите сообщение для вывода")
                print("Пример: puter-cli print \"Привет, мир!\"")
                return
            message = " ".join(sys.argv[2:])
            print_message(message)
        elif command == "help":
            show_help()
        else:
            print(f"❌ Неизвестная команда: {command}")
            show_help()

    except KeyboardInterrupt:
        print("\n\n👋 Прервано пользователем")
    except Exception as e:
        print(f"❌ Ошибка: {e}")


if __name__ == "__main__":
    main()