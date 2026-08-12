#!/usr/bin/env python3
"""
Browser automation tool for OpenClaw using Playwright
Supports: navigation, screenshot, text extraction, form filling
"""

from playwright.sync_api import sync_playwright
import sys
import json
import base64

def take_screenshot(url, output_path="/tmp/screenshot.png", full_page=False, wait_for="networkidle"):
    """Take screenshot of a webpage"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url, wait_until=wait_for, timeout=30000)

        page.screenshot(path=output_path, full_page=full_page)
        browser.close()

        return {"success": True, "path": output_path}

def get_page_text(url, wait_for="networkidle"):
    """Extract text from a webpage"""
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--no-sandbox",
                "--disable-dev-shm-usage"
            ]
        )
        
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            locale="ru-RU",
            timezone_id="Europe/Moscow"
        )
        
        # Add stealth scripts
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        """)
        
        page = context.new_page()

        page.goto(url, wait_until=wait_for, timeout=60000)
        page.wait_for_timeout(5000)  # Longer wait for Cloudflare challenge

        text = page.inner_text("body")
        browser.close()

        return {"success": True, "text": text, "url": url}

def get_page_html(url, wait_for="networkidle"):
    """Extract HTML from a webpage"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url, wait_until=wait_for, timeout=30000)

        html = page.content()
        browser.close()

        return {"success": True, "html": html, "url": url}

def interact_with_page(url, actions):
    """Interact with webpage (click, fill, etc.)"""
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        page.goto(url, wait_until="networkidle", timeout=30000)

        results = []

        for action in actions:
            action_type = action.get("type")

            if action_type == "click":
                selector = action.get("selector")
                page.click(selector)
                results.append({"action": "click", "selector": selector, "success": True})

            elif action_type == "fill":
                selector = action.get("selector")
                text = action.get("text")
                page.fill(selector, text)
                results.append({"action": "fill", "selector": selector, "success": True})

            elif action_type == "screenshot":
                output_path = action.get("path", "/tmp/screenshot.png")
                page.screenshot(path=output_path)
                results.append({"action": "screenshot", "path": output_path, "success": True})

            elif action_type == "wait":
                duration = action.get("duration", 1000)
                page.wait_for_timeout(duration)
                results.append({"action": "wait", "duration": duration, "success": True})

        browser.close()

        return {"success": True, "results": results}

def main():
    if len(sys.argv) < 2:
        print("Usage: browser.py <command> [args]")
        print("Commands:")
        print("  screenshot <url> [output_path]")
        print("  text <url>")
        print("  html <url>")
        sys.exit(1)

    command = sys.argv[1]

    try:
        if command == "screenshot":
            url = sys.argv[2]
            output_path = sys.argv[3] if len(sys.argv) > 3 else "/tmp/screenshot.png"
            result = take_screenshot(url, output_path)
            print(json.dumps(result))

        elif command == "text":
            url = sys.argv[2]
            result = get_page_text(url)
            print(json.dumps(result))

        elif command == "html":
            url = sys.argv[2]
            result = get_page_html(url)
            print(json.dumps(result))

        else:
            print(f"Unknown command: {command}")
            sys.exit(1)

    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()