#!/usr/bin/env python3
"""
Fill Google Sheets quarterly reports with WB analytics data.
Uses seller-analytics-api v3 sales-funnel/products for columns E:J
and advert-api v2 fullstats for columns K:O.
"""
import os, json, time, sys, requests
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

# ── Config ──────────────────────────────────────────────────────────────────
SPREADSHEET_ID = '1d7rdQF33susHEDfLUwThGOYVWmF4jLYi5VzZd7O5Qn8'
TOKEN_FILE = os.path.expanduser('~/.openclaw/workspace/google-creds/token.json')
WB_BASE = 'https://seller-analytics-api.wildberries.ru'
ADV_BASE = 'https://advert-api.wildberries.ru'
GS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

QUARTERS = [
    {
        'sheet': 'Отчет за 1 квартал',
        'begin': '2026-01-01',
        'end': '2026-03-31',
    },
    {
        'sheet': 'Отчет за 2 квартал',
        'begin': '2026-04-01',
        'end': '2026-06-30',
    },
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
    nmids = []
    for row in rng.get('values', []):
        if row and row[0].strip():
            nmids.append(row[0].strip())
    return nmids


def wb_request(method, url, headers, json_body=None, max_retries=10, base_delay=5):
    """WB API request with exponential backoff."""
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
    print(f"  FAILED after {max_retries} retries: {url}")
    return None


def fetch_sales_funnel(headers, nmids, begin, end):
    """Fetch sales funnel data for all nmIDs in one batch."""
    url = f"{WB_BASE}/api/analytics/v3/sales-funnel/products"

    # Try all nmIDs at once
    payload = {
        'selectedPeriod': {'start': begin, 'end': end},
        'filter': {'nmIDs': nmids},
        'pagination': {'limit': 2000, 'offset': 0}
    }

    r = wb_request('POST', url, headers, payload)
    if r is None:
        return {}

    if r.status_code == 200:
        data = r.json()
        products = data.get('data', {}).get('products', [])
        result = {}
        for p in products:
            nmid = str(p.get('product', {}).get('nmId', ''))
            result[nmid] = p
        print(f"  Got {len(result)}/{len(nmids)} products from sales-funnel")
        return result
    elif r.status_code == 204:
        print(f"  204: no data for period")
        return {}
    else:
        print(f"  Error {r.status_code}: {r.text[:500]}")
        return {}


def fetch_advert_stats(headers, nmids_set, begin, end):
    """Fetch advertising stats."""
    # Get campaign list
    r = wb_request('GET', f"{ADV_BASE}/adv/v1/promotion/count", headers, max_retries=8)
    if r is None or r.status_code != 200:
        print(f"  Cannot get campaigns: status={r.status_code if r else 'failed'}")
        return {}

    camps = r.json()
    if not camps:
        print("  No campaigns")
        return {}

    print(f"  Found {len(camps)} campaigns")

    # Build dates
    d_begin = datetime.strptime(begin, '%Y-%m-%d')
    d_end = datetime.strptime(end, '%Y-%m-%d')
    dates = []
    cur = d_begin
    while cur <= d_end:
        dates.append(cur.strftime('%Y-%m-%d'))
        cur += timedelta(days=1)

    date_chunks = [dates[i:i+30] for i in range(0, len(dates), 30)]
    camp_ids = [c['id'] for c in camps if 'id' in c]

    advert_data = {}

    for dc_idx, date_chunk in enumerate(date_chunks):
        for ci in range(0, len(camp_ids), 20):
            batch_ids = camp_ids[ci:ci+20]
            payload = [{'id': cid, 'dates': date_chunk} for cid in batch_ids]

            r = wb_request('POST', f"{ADV_BASE}/adv/v2/fullstats", headers, payload, max_retries=8)
            if r is None or r.status_code != 200:
                print(f"  fullstats: {r.status_code if r else 'failed'} (date chunk {dc_idx+1}, camp batch {ci//20+1})")
                continue

            for camp in r.json():
                if not isinstance(camp, dict):
                    continue
                for day in camp.get('days', []):
                    for app in day.get('apps', []):
                        for item in app.get('nm', []):
                            nmid = str(item.get('nm', ''))
                            if not nmid:
                                continue
                            if nmid not in advert_data:
                                advert_data[nmid] = {'views': 0, 'clicks': 0, 'atbs': 0, 'orders': 0}
                            advert_data[nmid]['views'] += item.get('views', 0)
                            advert_data[nmid]['clicks'] += item.get('clicks', 0)
                            advert_data[nmid]['atbs'] += item.get('atbs', 0)
                            advert_data[nmid]['orders'] += item.get('orders', 0)

            time.sleep(1)

    # Filter only nmids we need
    filtered = {k: v for k, v in advert_data.items() if k in nmids_set}
    print(f"  Got advert data for {len(filtered)} of our nmIDs (total {len(advert_data)})")
    return filtered


def compute_row(funnel, advert, nmid):
    """Compute E:O values."""
    f = funnel.get(str(nmid), {})
    a = advert.get(str(nmid), {})

    product = f.get('product', {})
    stat = f.get('statistic', {}).get('selected', {})

    # E: Рейтинг карточки (feedbackRating)
    rating = product.get('feedbackRating', '')
    if rating == 0:
        rating = ''

    # F: Показов (общие) - openCount
    open_count = stat.get('openCount', '')

    # G: Кликов % - not directly in sales-funnel
    # We have addToCartPercent but not CTR (clicks/views)
    # WB doesn't provide "clicks from search" separately from openCount
    # openCount IS essentially the clicks/views
    # So G (clicks %) doesn't apply to seller-analytics funnel
    clicks_pct = ''

    # H: Корзин % - addToCartPercent
    cart_pct = stat.get('conversions', {}).get('addToCartPercent', '')
    if cart_pct == 0:
        cart_pct = ''

    # I: Заказов % - cartToOrderPercent
    orders_pct = stat.get('conversions', {}).get('cartToOrderPercent', '')
    if orders_pct == 0:
        orders_pct = ''

    # J: % Отказов - cancelCount / orderCount * 100
    cancel_count = stat.get('cancelCount', 0)
    order_count = stat.get('orderCount', 0)
    if order_count and order_count > 0:
        fail_pct = round(cancel_count / order_count * 100, 2)
    else:
        fail_pct = ''

    # K-O: Рекламные
    adv_views = a.get('views', 0)
    adv_clicks = a.get('clicks', 0)
    adv_atbs = a.get('atbs', 0)
    adv_orders = a.get('orders', 0)

    # K: Показов (рекламные)
    adv_views_val = adv_views if adv_views else ''

    # L: Кликов % (CTR)
    if adv_views and adv_views > 0:
        adv_ctr = round(adv_clicks / adv_views * 100, 2)
    else:
        adv_ctr = ''

    # M: Корзин % (atbs / clicks)
    if adv_clicks and adv_clicks > 0:
        adv_cart_pct = round(adv_atbs / adv_clicks * 100, 2)
    else:
        adv_cart_pct = ''

    # N: Заказов % (orders / atbs)
    if adv_atbs and adv_atbs > 0:
        adv_orders_pct = round(adv_orders / adv_atbs * 100, 2)
    else:
        adv_orders_pct = ''

    # O: % Отказов (рекламные) - not available
    adv_fail = ''

    return [
        rating,          # E
        open_count,      # F
        clicks_pct,      # G
        cart_pct,        # H
        orders_pct,      # I
        fail_pct,        # J
        adv_views_val,   # K
        adv_ctr,         # L
        adv_cart_pct,    # M
        adv_orders_pct,  # N
        adv_fail,        # O
    ]


def clear_and_write(service, sheet_name, rows):
    """Clear E3:O108 and write data."""
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{sheet_name}!E3:O108"
    ).execute()
    print(f"  Cleared E3:O108 on {sheet_name}")

    if not rows:
        print(f"  No rows to write for {sheet_name}")
        return

    body = {'values': rows}
    rng = f"{sheet_name}!E3:O{3 + len(rows) - 1}"
    result = service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=rng,
        valueInputOption='USER_ENTERED',
        body=body
    ).execute()
    print(f"  Wrote {result.get('updatedCells', 0)} cells to {sheet_name}")


def main():
    print(f"=== WB Quarterly Fill — {datetime.now().isoformat()} ===")

    service = get_google_service()
    wb_token = get_wb_token(service)
    headers = {'Authorization': wb_token, 'Content-Type': 'application/json'}

    for q in QUARTERS:
        sheet = q['sheet']
        begin = q['begin']
        end = q['end']

        print(f"\n{'='*60}")
        print(f"{sheet} ({begin} → {end})")
        print(f"{'='*60}")

        nmids = get_nmids(service, sheet)
        nmids_set = set(nmids)
        print(f"  {len(nmids)} nmIDs found")

        # Sales funnel
        print(f"\n  --- Sales Funnel ---")
        funnel = fetch_sales_funnel(headers, nmids, begin, end)

        # Debug: show sample
        if funnel:
            sample_key = list(funnel.keys())[0]
            sample = funnel[sample_key]
            print(f"\n  Sample (nmID={sample_key}):")
            prod = sample.get('product', {})
            sel = sample.get('statistic', {}).get('selected', {})
            print(f"    feedbackRating: {prod.get('feedbackRating')}")
            print(f"    openCount: {sel.get('openCount')}")
            print(f"    cartCount: {sel.get('cartCount')}")
            print(f"    orderCount: {sel.get('orderCount')}")
            print(f"    cancelCount: {sel.get('cancelCount')}")
            print(f"    conversions: {sel.get('conversions')}")

        # Advert
        print(f"\n  --- Advert Stats ---")
        advert = fetch_advert_stats(headers, nmids_set, begin, end)

        # Build rows
        rows = []
        missing = []
        for nmid in nmids:
            f_data = funnel.get(str(nmid), {})
            if not f_data:
                missing.append(nmid)
            rows.append(compute_row(funnel, advert, nmid))

        if missing:
            print(f"\n  WARNING: {len(missing)} nmIDs not returned by API: {missing[:8]}...")

        # Write
        print(f"\n  --- Writing ---")
        clear_and_write(service, sheet, rows)
        print(f"  {sheet} DONE")

    print(f"\n=== ALL DONE — {datetime.now().isoformat()} ===")


if __name__ == '__main__':
    main()
