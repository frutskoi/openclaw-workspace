#!/usr/bin/env python3
"""
Fill Google Sheets quarterly reports with WB analytics.
v4: batch nmIDs by 50 to bypass WB pagination bug (offset ignored).
"""
import os, json, time, requests
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
    return build('sheets', 'v4', credentials=Credentials.from_authorized_user_info(td, GS_SCOPES))


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


def wb_request(url, headers, payload, max_retries=8, base_delay=5):
    for attempt in range(max_retries):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=90)
            if r.status_code == 429:
                delay = min(base_delay * (2 ** attempt), 120)
                print(f"    429, waiting {delay}s (attempt {attempt+1}/{max_retries})")
                time.sleep(delay)
                continue
            if 500 <= r.status_code < 600:
                delay = base_delay * (attempt + 1)
                time.sleep(delay)
                continue
            return r
        except requests.exceptions.RequestException as e:
            delay = base_delay * (attempt + 1)
            print(f"    Connection error: {type(e).__name__}, waiting {delay}s")
            time.sleep(delay)
    return None


def fetch_funnel_batched(headers, nmids, begin, end):
    """Fetch sales funnel data by batching nmIDs (max 50 per request)."""
    url = f"{WB_BASE}/api/analytics/v3/sales-funnel/products"
    result = {}
    
    batches = [nmids[i:i+50] for i in range(0, len(nmids), 50)]
    print(f"  {len(nmids)} nmIDs split into {len(batches)} batches of max 50")
    
    for i, batch in enumerate(batches):
        payload = {
            'selectedPeriod': {'start': begin, 'end': end},
            'filter': {'nmIDs': batch},
            'pagination': {'limit': 50, 'offset': 0}
        }
        
        print(f"  Batch {i+1}/{len(batches)} ({len(batch)} nmIDs)...")
        r = wb_request(url, headers, payload)
        if r is None:
            print(f"    FAILED batch {i+1}")
            continue
        if r.status_code == 204:
            print(f"    204: no data for these nmIDs")
            continue
        if r.status_code != 200:
            print(f"    Error {r.status_code}: {r.text[:300]}")
            continue
        
        data = r.json()
        products = data.get('data', {}).get('products', [])
        for p in products:
            nmid = str(p.get('product', {}).get('nmId', ''))
            result[nmid] = p
        
        print(f"    Got {len(products)}/{len(batch)} products")
        
        if i < len(batches) - 1:
            time.sleep(3)
    
    print(f"  Total unique: {len(result)}/{len(nmids)} nmIDs")
    return result


def compute_row(funnel, nmid):
    f = funnel.get(str(nmid), {})
    product = f.get('product', {})
    stat = f.get('statistic', {}).get('selected', {})
    conv = stat.get('conversions', {})

    rating = product.get('feedbackRating', '')
    if rating in (0, None):
        rating = ''

    open_count = stat.get('openCount', '')
    if open_count == 0:
        open_count = ''

    # G: Кликов % - WB sales-funnel не отдаёт отдельный CTR
    clicks_pct = ''

    cart_pct = conv.get('addToCartPercent', '')
    if cart_pct == 0:
        cart_pct = ''

    orders_pct = conv.get('cartToOrderPercent', '')
    if orders_pct == 0:
        orders_pct = ''

    cancel_count = stat.get('cancelCount', 0)
    order_count = stat.get('orderCount', 0)
    fail_pct = round(cancel_count / order_count * 100, 2) if order_count and order_count > 0 else ''

    # K-O: Реклама - WB API изменён, недоступно
    return [rating, open_count, clicks_pct, cart_pct, orders_pct, fail_pct,
            '', '', '', '', '']


def main():
    print(f"=== WB Quarterly Fill v4 — {datetime.now().isoformat()} ===")

    service = get_google_service()
    wb_token = get_wb_token(service)
    headers = {'Authorization': wb_token, 'Content-Type': 'application/json'}

    for q in QUARTERS:
        sheet = q['sheet']
        print(f"\n{'='*60}")
        print(f"{sheet} ({q['begin']} -> {q['end']})")
        print(f"{'='*60}")

        nmids = get_nmids(service, sheet)
        print(f"  {len(nmids)} nmIDs")

        funnel = fetch_funnel_batched(headers, nmids, q['begin'], q['end'])

        rows = []
        missing = []
        for nmid in nmids:
            if str(nmid) not in funnel:
                missing.append(nmid)
            rows.append(compute_row(funnel, nmid))

        if missing:
            print(f"\n  WARNING: {len(missing)} nmIDs missing from API")

        # Write
        service.spreadsheets().values().clear(
            spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!E3:O108"
        ).execute()
        print(f"  Cleared E3:O108")

        body = {'values': rows}
        rng = f"{sheet}!E3:O{3 + len(rows) - 1}"
        result = service.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID, range=rng,
            valueInputOption='USER_ENTERED', body=body
        ).execute()
        print(f"  Wrote {result.get('updatedCells', 0)} cells to {sheet}")

        # Verify: read back a sample
        verify = service.spreadsheets().values().get(
            spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!E3:J5"
        ).execute()
        print(f"  Verify E3:J5:")
        for row in verify.get('values', []):
            print(f"    {row}")

        print(f"  {sheet} DONE")

    print(f"\n=== ALL DONE — {datetime.now().isoformat()} ===")


if __name__ == '__main__':
    main()
