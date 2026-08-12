#!/usr/bin/env python3
"""
WB Quarterly Fill v6: CORRECT columns F:P (not E:O).
F=Рейтинг, G=Показов, H=Клики%, I=Корзин%, J=Заказов%, K=Отказов%
L-P=Реклама (пусто — WB advert API изменён).
"""
import os, json, time, requests
from datetime import datetime
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SPREADSHEET_ID = '1d7rdQF33susHEDfLUwThGOYVWmF4jLYi5VzZd7O5Qn8'
TOKEN_FILE = os.path.expanduser('~/.openclaw/workspace/google-creds/token.json')
WB_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products'
GS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

QUARTERS = [
    {'sheet': 'Отчет за 1 квартал', 'begin': '2026-01-01', 'end': '2026-03-31'},
    {'sheet': 'Отчет за 2 квартал', 'begin': '2026-04-01', 'end': '2026-06-30'},
]


def gs():
    with open(TOKEN_FILE) as f:
        return build('sheets', 'v4', credentials=Credentials.from_authorized_user_info(json.load(f), GS_SCOPES))


def wb_token(svc):
    return svc.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID, range="Ключ!A1"
    ).execute().get('values', [['']])[0][0]


def get_nmids(svc, sheet):
    r = svc.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!B3:B108"
    ).execute()
    return [row[0].strip() for row in r.get('values', []) if row and row[0].strip()]


def wb_post(headers, payload, max_retries=15):
    for attempt in range(max_retries):
        try:
            r = requests.post(WB_URL, headers=headers, json=payload, timeout=90)
            if r.status_code == 429:
                d = min(10 * (2 ** attempt), 300)
                print(f"    429, sleep {d}s ({attempt+1}/{max_retries})")
                time.sleep(d)
                continue
            if 500 <= r.status_code < 600:
                time.sleep(10 * (attempt + 1))
                continue
            return r
        except requests.exceptions.RequestException as e:
            d = 20 * (attempt + 1)
            print(f"    {type(e).__name__}, sleep {d}s ({attempt+1}/{max_retries})")
            time.sleep(d)
    return None


def fetch_top50(headers, begin, end):
    """WB v3 sales-funnel returns max 50 products (top by revenue), ignores nmID filter & offset."""
    payload = {
        'selectedPeriod': {'start': begin, 'end': end},
        'pagination': {'limit': 50, 'offset': 0}
    }
    print(f"  Fetching top-50 for {begin} → {end}...")
    r = wb_post(headers, payload)
    if r is None:
        return {}
    if r.status_code == 204:
        return {}
    if r.status_code != 200:
        print(f"    Error {r.status_code}: {r.text[:300]}")
        return {}

    products = r.json().get('data', {}).get('products', [])
    result = {}
    for p in products:
        nmid = str(p.get('product', {}).get('nmId', ''))
        result[nmid] = p
    print(f"    Got {len(result)} products")
    return result


def build_row(funnel, nmid):
    """Build F:P row (11 values: F=rating .. P=fail%)."""
    f = funnel.get(str(nmid), {})
    p = f.get('product', {})
    s = f.get('statistic', {}).get('selected', {})
    c = s.get('conversions', {})

    # F: Рейтинг карточки
    rating = p.get('feedbackRating', '')
    if rating in (0, None):
        rating = ''

    # G: Показов (openCount)
    open_count = s.get('openCount', '')
    if open_count == 0:
        open_count = ''

    # H: Кликов % — WB не отдаёт отдельный CTR из sales-funnel
    clicks_pct = ''

    # I: Корзин %
    cart_pct = c.get('addToCartPercent', '')
    if cart_pct == 0:
        cart_pct = ''

    # J: Заказов %
    orders_pct = c.get('cartToOrderPercent', '')
    if orders_pct == 0:
        orders_pct = ''

    # K: % Отказов
    cancel_count = s.get('cancelCount', 0)
    order_count = s.get('orderCount', 0)
    fail_pct = round(cancel_count / order_count * 100, 2) if order_count and order_count > 0 else ''

    # L-P: Реклама — WB advert API endpoints все возвращают 404, пропускаем
    return [rating, open_count, clicks_pct, cart_pct, orders_pct, fail_pct,
            '', '', '', '', '']


def write_sheet(svc, sheet, rows):
    """Write F3:P{2+N}."""
    # Clear F:P first (not E!)
    svc.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!F3:P108"
    ).execute()
    # Also clear old E column if v4 put data there
    svc.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!E3:E108"
    ).execute()
    print(f"  Cleared E3:P108")

    if not rows:
        return
    body = {'values': rows}
    rng = f"{sheet}!F3:P{3 + len(rows) - 1}"
    result = svc.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID, range=rng,
        valueInputOption='USER_ENTERED', body=body
    ).execute()
    print(f"  Wrote {result.get('updatedCells', 0)} cells to {sheet}")


def main():
    print(f"=== WB Fill v6 (corrected columns) — {datetime.now().isoformat()} ===")
    svc = gs()
    tok = wb_token(svc)
    headers = {'Authorization': tok, 'Content-Type': 'application/json'}

    for q in QUARTERS:
        sheet = q['sheet']
        print(f"\n{'='*60}")
        print(f"{sheet} ({q['begin']} → {q['end']})")
        print(f"{'='*60}")

        nms = get_nmids(svc, sheet)
        print(f"  {len(nms)} nmIDs")

        funnel = fetch_top50(headers, q['begin'], q['end'])

        # Build rows in nmID order
        rows = []
        matched = 0
        missing = []
        for nm in nms:
            if str(nm) in funnel:
                matched += 1
            else:
                missing.append(nm)
            rows.append(build_row(funnel, nm))

        print(f"  Matched: {matched}/{len(nms)}")
        if missing:
            print(f"  Missing ({len(missing)}): {missing[:15]}...")

        write_sheet(svc, sheet, rows)

        # Verify
        verify = svc.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!F3:K6"
        ).execute()
        print(f"  Verify F3:K6:")
        for row in verify.get('values', []):
            print(f"    {row}")
        print(f"  {sheet} DONE")

    print(f"\n=== ALL DONE — {datetime.now().isoformat()} ===")


if __name__ == '__main__':
    main()
