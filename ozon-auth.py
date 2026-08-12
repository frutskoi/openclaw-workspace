#!/usr/bin/env python3
"""
Ozon Docs Auth - Авторизация в личном кабинете Ozon для доступа к документации
Сохраняет куки в файл для последующего использования
"""

from playwright.sync_api import sync_playwright
import json
import os

COOKIE_FILE = os.path.expanduser("~/.openclaw/workspace/ozon-cookies.json")

def auth_and_save_cookies():
    """Открывает браузер для ручной авторизации и сохраняет куки"""

    print("🔐 Запускаю браузер для авторизации в Ozon...")
    print("📋 Инструкция:")
    print("1. Войдите в личный кабинет продавца Ozon")
    print("2. Перейдите на страницу документации API")
    print("3. Нажмите Enter здесь, когда закончите")
    print()

    with sync_playwright() as p:
        # Запускаем браузер в headed режиме (с GUI)
        browser = p.chromium.launch(
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
            ]
        )

        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="ru-RU",
            timezone_id="Europe/Moscow"
        )

        # Stealth скрипты
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
            Object.defineProperty(navigator, 'plugins', {
                get: () => [1, 2, 3, 4, 5]
            });
            Object.defineProperty(navigator, 'languages', {
                get: () => ['ru-RU', 'ru', 'en']
            });
        """)

        page = context.new_page()

        # Переходим на страницу входа
        page.goto("https://docs.ozon.ru/api", timeout=60000)

        print("✅ Браузер открыт! Войдите в систему и перейдите на документацию API.")
        print("⏳ Ожидаю... (нажмите Enter когда закончите)")

        input()  # Ждем пока пользователь авторизуется

        # Сохраняем куки
        cookies = context.cookies()
        with open(COOKIE_FILE, 'w') as f:
            json.dump(cookies, f, indent=2)

        print(f"✅ Куки сохранены в: {COOKIE_FILE}")

        # Пробуем получить текст документации
        page.wait_for_timeout(2000)
        text = page.inner_text("body")

        # Сохраняем HTML
        html = page.content()
        html_file = os.path.expanduser("~/.openclaw/workspace/ozon-docs.html")
        with open(html_file, 'w', encoding='utf-8') as f:
            f.write(html)

        print(f"✅ HTML сохранен в: {html_file}")

        browser.close()

        return {
            "success": True,
            "cookies_saved": len(cookies),
            "text_length": len(text),
            "html_file": html_file
        }

def load_cookies_and_get_docs():
    """Загружает сохраненные куки и получает документацию"""

    if not os.path.exists(COOKIE_FILE):
        return {"success": False, "error": "Куки не найдены. Сначала запустите авторизацию."}

    with open(COOKIE_FILE, 'r') as f:
        cookies = json.load(f)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="ru-RU",
            timezone_id="Europe/Moscow"
        )

        context.add_cookies(cookies)

        page = context.new_page()
        page.goto("https://docs.ozon.ru/api", timeout=60000)
        page.wait_for_timeout(3000)

        text = page.inner_text("body")
        html = page.content()

        browser.close()

        return {
            "success": True,
            "text": text,
            "html": html,
            "text_length": len(text)
        }

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Использование:")
        print("  python3 ozon-auth.py auth    - Авторизация и сохранение кук")
        print("  python3 ozon-auth.py get     - Получить документацию по сохраненным кукам")
        sys.exit(1)

    command = sys.argv[1]

    if command == "auth":
        result = auth_and_save_cookies()
        print(json.dumps(result, ensure_ascii=False, indent=2))

    elif command == "get":
        result = load_cookies_and_get_docs()
        print(json.dumps(result, ensure_ascii=False, indent=2))

    else:
        print(f"Неизвестная команда: {command}")