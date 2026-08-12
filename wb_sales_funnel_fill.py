#!/usr/bin/env python3
"""
Fill Google Sheets 'Отчет за 1 квартал' and 'Отчет за 2 квартал' with WB analytics data.
Columns E:O from seller-analytics-api v3 sales-funnel/products + advert-api v2 fullstats.
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
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']

QUARTERS = [
    {
        'sheet': 'Отчет за 1 квартал',
        'begin': '2026-01-01',
        'end': '2026-03-30',  # WB uses inclusive end, but to avoid off-by-one, we use 03-30 then cover 31st
    },
    {
        'sheet': 'Отчет за 2 квартал',
        'begin': '2026-04-01',
        'end': '2026-06-30',
    },
]

# ── Helpers ──────────────────────────────────────────────────────────────────
def get_google_service():
    with open(TOKEN_FILE) as f:
        td = json.load(f)
    creds = Credentials.from_authorized_user_info(td, SCOPES)
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

def wb_request(method, url, headers, json_body=None, max_retries=12, base_delay=5):
    """Make WB API request with exponential backoff for 429/5xx."""
    for attempt in range(max_retries):
        try:
            if method == 'POST':
                r = requests.post(url, headers=headers, json=json_body, timeout=90)
            else:
                r = requests.get(url, headers=headers, timeout=90)
            
            if r.status_code == 429:
                delay = base_delay * (2 ** min(attempt, 6))  # 5, 10, 20, 40, 80, 160, 320...
                print(f"  429 rate limited, waiting {delay}s (attempt {attempt+1}/{max_retries})")
                time.sleep(delay)
                continue
            
            if 500 <= r.status_code < 600:
                delay = base_delay * (attempt + 1)
                print(f"  {r.status_code} server error, waiting {delay}s (attempt {attempt+1}/{max_retries})")
                time.sleep(delay)
                continue
            
            return r  # success or non-retryable error
        except requests.exceptions.RequestException as e:
            delay = base_delay * (attempt + 1)
            print(f"  Connection error: {e}, waiting {delay}s")
            time.sleep(delay)
    
    print(f"  FAILED after {max_retries} retries: {url}")
    return None

def fetch_sales_funnel(headers, nmids, begin, end):
    """Fetch sales funnel data for a list of nmIDs."""
    url = f"{WB_BASE}/api/analytics/v3/sales-funnel/products"
    
    # Try batch first (all nmIDs at once)
    payload = {
        'selectedPeriod': {'begin': begin, 'end': end},
        'filter': {'nmIDs': nmids},
        'pagination': {'limit': 1000, 'offset': 0}
    }
    
    r = wb_request('POST', url, headers, payload)
    if r is None:
        return {}
    
    if r.status_code == 200:
        data = r.json()
        products = data.get('products', data.get('data', {}).get('products', []))
        result = {}
        for p in products:
            nmid = str(p.get('nmID', p.get('nmId', '')))
            result[nmid] = p
        print(f"  Got {len(result)}/{len(nmids)} products from sales-funnel")
        return result
    elif r.status_code == 204:
        print(f"  204: no data for period {begin} to {end}")
        return {}
    else:
        print(f"  Error {r.status_code}: {r.text[:500]}")
        # Try smaller batches
        if r.status_code in (400, 404):
            print("  Trying smaller batches of 10...")
            result = {}
            for i in range(0, len(nmids), 10):
                batch = nmids[i:i+10]
                payload['filter']['nmIDs'] = batch
                r2 = wb_request('POST', url, headers, payload)
                if r2 and r2.status_code == 200:
                    d = r2.json()
                    prods = d.get('products', d.get('data', {}).get('products', []))
                    for p in prods:
                        nmid = str(p.get('nmID', p.get('nmId', '')))
                        result[nmid] = p
                    print(f"    Batch {i//10+1}: got {len(prods)} products")
                elif r2 and r2.status_code == 204:
                    print(f"    Batch {i//10+1}: no data (204)")
                else:
                    print(f"    Batch {i//10+1}: error {r2.status_code if r2 else 'failed'}")
                time.sleep(2)
            return result
        return {}

def fetch_advert_stats(headers, nmids, begin, end):
    """Fetch advertising stats from advert-api."""
    # First get list of advert campaigns
    url_count = f"{ADV_BASE}/adv/v1/promotion/count"
    r = wb_request('GET', url_count, headers, max_retries=8)
    if r is None or r.status_code != 200:
        print(f"  Cannot get advert campaigns: {r.status_code if r else 'failed'}")
        return {}
    
    camps = r.json()
    if not camps:
        print("  No advert campaigns found")
        return {}
    
    print(f"  Found {len(camps)} advert campaigns")
    
    # Get fullstats for all campaigns
    # Build dates list
    d_begin = datetime.strptime(begin, '%Y-%m-%d')
    d_end = datetime.strptime(end, '%Y-%m-%d')
    dates = []
    cur = d_begin
    while cur <= d_end:
        dates.append(cur.strftime('%Y-%m-%d'))
        cur += timedelta(days=1)
    
    # Batch campaigns (max 50 ids per request, but dates can be many)
    # Split dates into chunks of ~30 to keep payload reasonable
    date_chunks = [dates[i:i+30] for i in range(0, len(dates), 30)]
    
    advert_data = {}  # nmid -> aggregated stats
    
    camp_ids = [c['id'] for c in camps if 'id' in c]
    
    for dc_idx, date_chunk in enumerate(date_chunks):
        # Split camp_ids into chunks of 20
        for ci in range(0, len(camp_ids), 20):
            batch_ids = camp_ids[ci:ci+20]
            payload = []
            for cid in batch_ids:
                payload.append({'id': cid, 'dates': date_chunk})
            
            r = wb_request('POST', f"{ADV_BASE}/adv/v2/fullstats", headers, payload, max_retries=8)
            if r is None:
                continue
            if r.status_code != 200:
                print(f"  fullstats error: {r.status_code}: {r.text[:300]}")
                continue
            
            resp = r.json()
            # resp is list of campaign objects
            for camp in resp:
                if not isinstance(camp, dict):
                    continue
                days = camp.get('days', [])
                for day in days:
                    apps = day.get('apps', [])
                    for app in apps:
                        items = app.get('nm', [])
                        for item in items:
                            nmid = str(item.get('nm', ''))
                            if not nmid:
                                continue
                            if nmid not in advert_data:
                                advert_data[nmid] = {
                                    'views': 0, 'clicks': 0, 'atbs': 0, 'orders': 0, 'sum': 0
                                }
                            advert_data[nmid]['views'] += item.get('views', 0)
                            advert_data[nmid]['clicks'] += item.get('clicks', 0)
                            advert_data[nmid]['atbs'] += item.get('atbs', 0)
                            advert_data[nmid]['orders'] += item.get('orders', 0)
                            advert_data[nmid]['sum'] += item.get('sum', 0)
            
            print(f"  Advert stats: processed date chunk {dc_idx+1}/{len(date_chunks)}, camp batch {ci//20+1}")
            time.sleep(1)
    
    print(f"  Got advert data for {len(advert_data)} nmIDs")
    return advert_data

def compute_row(funnel, advert, nmid):
    """Compute E:O values for a single nmID."""
    f = funnel.get(str(nmid), {})
    a = advert.get(str(nmid), {})
    
    # E: Рейтинг карточки (feedbackRating)
    rating = f.get('feedbackRating', f.get('productRating', ''))
    
    # F: Показов (общие) - openCard / views of card
    open_card = f.get('openCard', 0)
    
    # G: Кликов % - CTR from search to card
    # In sales-funnel, we have addToCart from openCard
    # clicks/views not directly available, but we can compute from searchToCart or similar
    # Actually sales-funnel gives: openCardCount (shows), addToCartCount, ordersCount
    # CTR (click rate) would be: we don't have impressions count separately
    # Let's check what fields are available
    
    # H: Корзин % (addToCart / openCard)
    add_to_cart = f.get('addToCart', 0)
    if open_card and open_card > 0:
        cart_pct = round(add_to_cart / open_card * 100, 2)
    else:
        cart_pct = ''
    
    # I: Заказов % (orders / addToCart or orders / openCard)
    orders = f.get('orders', 0)
    if add_to_cart and add_to_cart > 0:
        orders_pct = round(orders / add_to_cart * 100, 2)
    else:
        orders_pct = ''
    
    # J: % Отказов - cancels / orders
    cancels = f.get('cancelCount', 0)
    if orders and orders > 0:
        fail_pct = round(cancels / orders * 100, 2)
    else:
        fail_pct = ''
    
    # K-O: Рекламные
    adv_views = a.get('views', 0)
    adv_clicks = a.get('clicks', 0)
    adv_atbs = a.get('atbs', 0)
    adv_orders = a.get('orders', 0)
    
    # K: Показов (рекламные)
    
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
    
    # O: % Отказов (рекламные) - not directly available
    adv_fail = ''
    
    return [
        rating if rating != '' else '',           # E
        open_card if open_card else '',            # F
        '',                                        # G - clicks% (will try to fill below)
        cart_pct,                                  # H
        orders_pct,                                # I
        fail_pct,                                  # J
        adv_views if adv_views else '',            # K
        adv_ctr,                                   # L
        adv_cart_pct,                              # M
        adv_orders_pct,                            # N
        adv_fail,                                  # O
    ]

def write_sheet(service, sheet_name, data):
    """Write data to E3:O{3+N} of the sheet."""
    if not data:
        print(f"No data to write for {sheet_name}")
        return
    
    body = {'values': data}
    rng = f"{sheet_name}!E3:O{3 + len(data) - 1}"
    result = service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_ID,
        range=rng,
        valueInputOption='USER_ENTERED',
        body=body
    ).execute()
    print(f"Wrote {result.get('updatedCells', 0)} cells to {sheet_name}")

def clear_sheet(service, sheet_name):
    """Clear E3:O108 before writing."""
    service.spreadsheets().values().clear(
        spreadsheetId=SPREADSHEET_ID,
        range=f"{sheet_name}!E3:O108"
    ).execute()
    print(f"Cleared E3:O108 on {sheet_name}")

# ── Main ─────────────────────────────────────────────────────────────────────
def main():
    print(f"=== WB Sales Funnel Report Fill — started {datetime.utcnow().isoformat()} ===")
    
    service = get_google_service()
    wb_token = get_wb_token(service)
    headers = {'Authorization': wb_token, 'Content-Type': 'application/json'}
    
    # Test API connectivity
    print("\n--- Testing API connectivity ---")
    test_url = f"{WB_BASE}/api/analytics/v3/sales-funnel/products"
    test_payload = {
        'selectedPeriod': {'begin': '2026-06-01', 'end': '2026-06-01'},
        'filter': {'nmIDs': [189772234]},
        'pagination': {'limit': 1, 'offset': 0}
    }
    r = wb_request('POST', test_url, headers, test_payload, max_retries=15, base_delay=10)
    if r is None:
        print("FATAL: Cannot connect to WB API after many retries. Aborting.")
        sys.exit(1)
    
    if r.status_code == 429:
        print("FATAL: Still rate limited after 15 retries. Try again later.")
        sys.exit(1)
    
    if r.status_code == 200:
        print("API responding OK, proceeding.")
    elif r.status_code == 204:
        print("API responding (204 for test - OK, proceeding).")
    else:
        print(f"WARNING: Unexpected status {r.status_code}: {r.text[:300]}")
    
    for q in QUARTERS:
        sheet = q['sheet']
        begin = q['begin']
        end = q['end']
        
        print(f"\n{'='*60}")
        print(f"Processing: {sheet} ({begin} to {end})")
        print(f"{'='*60}")
        
        nmids = get_nmids(service, sheet)
        print(f"Found {len(nmids)} nmIDs")
        
        # Fetch sales funnel data
        print(f"\n--- Fetching sales funnel data ---")
        funnel = fetch_sales_funnel(headers, nmids, begin, end)
        
        # Print sample to understand fields
        if funnel:
            sample_nmid = list(funnel.keys())[0]
            sample = funnel[sample_nmid]
            print(f"\nSample product fields (nmID={sample_nmid}):")
            for k, v in sample.items():
                print(f"  {k}: {v}")
        
        # Fetch advert data
        print(f"\n--- Fetching advertising stats ---")
        advert = fetch_advert_stats(headers, nmids, begin, end)
        
        # Build rows
        rows = []
        missing_funnel = []
        for nmid in nmids:
            f_data = funnel.get(str(nmid), {})
            a_data = advert.get(str(nmid), {})
            
            if not f_data:
                missing_funnel.append(nmid)
            
            row = compute_row(funnel, advert, nmid)
            rows.append(row)
        
        if missing_funnel:
            print(f"\nWARNING: {len(missing_funnel)} nmIDs missing from sales-funnel:")
            print(f"  {missing_funnel[:10]}{'...' if len(missing_funnel) > 10 else ''}")
        
        # Write to sheet
        print(f"\n--- Writing to {sheet} ---")
        clear_sheet(service, sheet)
        write_sheet(service, sheet, rows)
        
        print(f"\n{sheet} done.")
    
    print(f"\n=== ALL DONE — {datetime.utcnow().isoformat()} ===")

if __name__ == '__main__':
    main()
