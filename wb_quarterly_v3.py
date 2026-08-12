#!/usr/bin/env python3
"""
Fill Google Sheets quarterly reports with WB analytics data.
Uses seller-analytics-api v3 sales-funnel/products for columns E:J.
K:O (advert) - WB changed their advert API, all old endpoints return 404.
"""
import os, json, time, sys, requests
from datetime import datetime
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SPREADSHEET_ID = '1d7rdQF33susHEDfLUwThGOYVWmF4jLYi5VzZd7O5Qn8'
TOKEN_FILE = os.path.expanduser('~/.openclaw/workspace/google-creds/token.json')
WB_BASE = 'https://seller-analytics-api.wildberries.ru'
GS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

QUARTERS = [
    {'sheet': 'Отчет за 1 квартал', 'begin': '2026-01-01', 'end': '2026-03-31'},
    {'sheet': 'Отчет за 2 квартал', 'begin': '2026-04-01', 'end': '2026-06-30'},
]


def get_google_service():
    with open(TOKEN_FILE) as f:
        td = json.load(f)
    creds = Credentials.from_authorized_user_info(td, GS_SCOPES)
    return build('sheets', 'v4', credentials=creds)


def get_wb_token(service):
    rng = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID, range="Ключ!A1"
    ).execute()
    return rng.get('values', [['']])[0][0]


def get_nmids(service, sheet_name):
    rng = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID, range=f"{sheet_name}!B3:B108"
    ).execute()
    return [row[0].strip() for row in rng.get('values', []) if row and row[0].strip()]


def wb_request(method, url, headers, json_body=None, max_retries=8, base_delay=5):
    for attempt in range(max_retries):
        try:
            if method == 'POST':
                r = requests.post(url, headers=headers, json=json_body, timeout=90)
            else:
                r = requests.get(url, headers=headers, timeout=90)
            if r.status_code == 429:
                delay = min(base_delay * (2 ** attempt), 300)
                print(f"  429, waiting {delay}s (attempt {attempt+1}/{max_retries})")
                time.sleep(delay)
                continue
            if 500 <= r.status_code < 600:
                delay = base_delay * (attempt + 1)
                print(f"  {r.status_code}, waiting {delay}s")
                time.sleep(delay)
                continue
            return r
        except requests.exceptions.RequestException as e:
            delay = base_delay * (attempt + 1)
            print(f"  Connection error: {type(e).__name__}, waiting {delay}s")
            time.sleep(delay)
    return None


def fetch_sales_funnel(headers, nmids, begin, end):
    """Fetch sales funnel data with pagination (50 per page)."""
    url = f"{WB_BASE}/api/analytics/v3/sales-funnel/products"
    result = {}
    offset = 0

    while True:
        payload = {
            'selectedPeriod': {'start': begin, 'end': end},
            'filter': {'nmIDs': nmids},
            'pagination': {'limit': 50, 'offset': offset}
        }
        r = wb_request('POST', url, headers, payload)
        if r is None:
            break
        if r.status_code == 204:
            print(f"  Page offset={offset}: 204 (no data)")
            break
        if r.status_code != 200:
            print(f"  Page offset={offset}: error {r.status_code}: {r.text[:300]}")
            break

        data = r.json()
        products = data.get('data', {}).get('products', [])
        if not products:
            break

        for p in products:
            nmid = str(p.get('product', {}).get('nmId', ''))
            result[nmid] = p

        print(f"  Page offset={offset}: got {len(products)} products (total so far: {len(result)})")

        if len(products) < 50:
            break  # last page

        offset += 50
        time.sleep(2)

    print(f"  Total: {len(result)}/{len(nmids)} nmIDs received from API")
    return result


def compute_row(funnel, nmid):
    """Compute E:O values for one nmID."""
    f = funnel.get(str(nmid), {})
    product = f.get('product', {})
    stat = f.get('statistic', {}).get('selected', {})

    # E: Рейтинг карточки (feedbackRating)
    rating = product.get('feedbackRating', '')
    if rating in (0, None):
        rating = ''

    # F: Показов (общие) - openCount
    open_count = stat.get('openCount', '')
    if open_count == 0:
        open_count = ''

    # G: Кликов % - WB sales-funnel не отдаёт CTR отдельно от openCount
    # openCount = card opens (essentially clicks), no separate "impressions" metric
    clicks_pct = ''

    # H: Корзин %
    cart_pct = stat.get('conversions', {}).get('addToCartPercent', '')
    if cart_pct == 0:
        cart_pct = ''

    # I: Заказов %
    orders_pct = stat.get('conversions', {}).get('cartToOrderPercent', '')
    if orders_pct == 0:
        orders_pct = ''

    # J: % Отказов
    cancel_count = stat.get('cancelCount', 0)
    order_count = stat.get('orderCount', 0)
    if order_count and order_count > 0:
        fail_pct = round(cancel_count / order_count * 100, 2)
    else:
        fail_pct = ''

    # K-O: Рекламные — WB API рекламы изменён, все endpoints 404
    # Оставляем пустыми
    adv_views = ''
    adv_ctr = ''
    adv_cart_pct = ''
    adv_orders_pct = ''
    adv_fail = ''

    return [rating, open_count, clicks_pct, cart_pct, orders_pct, fail_pct,
            adv_views, adv_ctr, adv_cart_pct, adv_orders_pct, adv_fail]


def clear_and_write(service, sheet_name, rows):
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{sheet_name}!E3:O108"
    ).execute()
    print(f"  Cleared E3:O108 on {sheet_name}")

    if not rows:
        return
    body = {'values': rows}
    rng = f"{sheet_name}!E3:O{3 + len(rows) - 1}"
    result = service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID, range=rng,
        valueInputOption='USER_ENTERED', body=body
    ).execute()
    print(f"  Wrote {result.get('updatedCells', 0)} cells to {sheet_name}")


def main():
    print(f"=== WB Quarterly Fill v3 — {datetime.now().isoformat()} ===")

    service = get_google_service()
    wb_token = get_wb_token(service)
    headers = {'Authorization': wb_token, 'Content-Type': 'application/json'}

    for q in QUARTERS:
        sheet = q['sheet']
        begin = q['begin']
        end = q['end']

        print(f"\n{'='*60}")
        print(f"{sheet} ({begin} -> {end})")
        print(f"{'='*60}")

        nmids = get_nmids(service, sheet)
        print(f"  {len(nmids)} nmIDs")

        print(f"\n  --- Sales Funnel (with pagination) ---")
        funnel = fetch_sales_funnel(headers, nmids, begin, end)

        if funnel:
            sample_key = list(funnel.keys())[0]
            sample = funnel[sample_key]
            prod = sample.get('product', {})
            sel = sample.get('statistic', {}).get('selected', {})
            print(f"\n  Sample nmID={sample_key}:")
            print(f"    feedbackRating={prod.get('feedbackRating')}, openCount={sel.get('openCount')}")
            print(f"    cartCount={sel.get('cartCount')}, orderCount={sel.get('orderCount')}")
            print(f"    cancelCount={sel.get('cancelCount')}, conversions={sel.get('conversions')}")

        rows = []
        missing = []
        for nmid in nmids:
            if str(nmid) not in funnel:
                missing.append(nmid)
            rows.append(compute_row(funnel, nmid))

        if missing:
            print(f"\n  WARNING: {len(missing)} nmIDs missing: {missing[:10]}")

        print(f"\n  --- Writing ---")
        clear_and_write(service, sheet, rows)
        print(f"  {sheet} DONE")

    print(f"\n=== ALL DONE — {datetime.now().isoformat()} ===")


if __name__ == '__main__':
    main()
