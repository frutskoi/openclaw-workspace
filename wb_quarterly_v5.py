#!/usr/bin/env python3
"""
WB Quarterly Fill v5: batch by 10 nmIDs, long pauses, retry on SSL/429.
"""
import os, json, time, requests
from datetime import datetime
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

SPREADSHEET_ID = '1d7rdQF33susHEDfLUwThGOYVWmF4jLYi5VzZd7O5Qn8'
TOKEN_FILE = os.path.expanduser('~/.openclaw/workspace/google-creds/token.json')
WB_URL = 'https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/products'
GS_SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
BATCH_SIZE = 10
PAUSE_BETWEEN = 5  # seconds between batches

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


def nmids(svc, sheet):
    r = svc.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!B3:B108"
    ).execute()
    return [row[0].strip() for row in r.get('values', []) if row and row[0].strip()]


def wb_post(url, headers, payload, max_retries=12):
    for attempt in range(max_retries):
        try:
            r = requests.post(url, headers=headers, json=payload, timeout=90)
            if r.status_code == 429:
                d = min(10 * (2 ** attempt), 300)
                print(f"      429, sleep {d}s ({attempt+1}/{max_retries})")
                time.sleep(d)
                continue
            if 500 <= r.status_code < 600:
                time.sleep(10 * (attempt + 1))
                continue
            return r
        except requests.exceptions.RequestException as e:
            d = 15 * (attempt + 1)
            print(f"      {type(e).__name__}, sleep {d}s ({attempt+1}/{max_retries})")
            time.sleep(d)
    return None


def fetch_all(headers, nm_list, begin, end):
    result = {}
    batches = [nm_list[i:i+BATCH_SIZE] for i in range(0, len(nm_list), BATCH_SIZE)]
    
    for i, batch in enumerate(batches):
        payload = {
            'selectedPeriod': {'start': begin, 'end': end},
            'filter': {'nmIDs': batch},
            'pagination': {'limit': 50, 'offset': 0}
        }
        
        print(f"  Batch {i+1}/{len(batches)} ({len(batch)} nmIDs)...")
        r = wb_post(WB_URL, headers, payload)
        
        if r is None:
            print(f"      FAILED, skipping")
            continue
        if r.status_code == 204:
            print(f"      204: no data")
            continue
        if r.status_code != 200:
            print(f"      Error {r.status_code}: {r.text[:200]}")
            continue
        
        products = r.json().get('data', {}).get('products', [])
        for p in products:
            nmid = str(p.get('product', {}).get('nmId', ''))
            result[nmid] = p
        
        got_our = sum(1 for nm in batch if str(nm) in result)
        print(f"      Got {len(products)} products ({got_our}/{len(batch)} matched)")
        
        if i < len(batches) - 1:
            time.sleep(PAUSE_BETWEEN)
    
    return result


def row(funnel, nmid):
    f = funnel.get(str(nmid), {})
    p = f.get('product', {})
    s = f.get('statistic', {}).get('selected', {})
    c = s.get('conversions', {})
    
    rating = p.get('feedbackRating', '')
    if rating in (0, None): rating = ''
    
    oc = s.get('openCount', '')
    if oc == 0: oc = ''
    
    cart = c.get('addToCartPercent', '')
    if cart == 0: cart = ''
    
    ord_pct = c.get('cartToOrderPercent', '')
    if ord_pct == 0: ord_pct = ''
    
    cc = s.get('cancelCount', 0)
    oc2 = s.get('orderCount', 0)
    fail = round(cc / oc2 * 100, 2) if oc2 and oc2 > 0 else ''
    
    return [rating, oc, '', cart, ord_pct, fail, '', '', '', '', '']


def main():
    print(f"=== WB Fill v5 — {datetime.now().isoformat()} ===")
    svc = gs()
    tok = wb_token(svc)
    headers = {'Authorization': tok, 'Content-Type': 'application/json'}

    for q in QUARTERS:
        sheet = q['sheet']
        print(f"\n{'='*60}")
        print(f"{sheet} ({q['begin']} → {q['end']})")
        print(f"{'='*60}")
        
        nms = nmids(svc, sheet)
        print(f"  {len(nms)} nmIDs, batch={BATCH_SIZE}, pause={PAUSE_BETWEEN}s")
        
        funnel = fetch_all(headers, nms, q['begin'], q['end'])
        print(f"\n  Received: {len(funnel)}/{len(nms)} nmIDs")
        
        missing = [nm for nm in nms if str(nm) not in funnel]
        if missing:
            print(f"  Missing ({len(missing)}): {missing[:12]}")
        
        rows = [row(funnel, nm) for nm in nms]
        
        svc.spreadsheets().values().clear(
            spreadsheetId=SPREADSHEET_ID, range=f"{sheet}!E3:O108"
        ).execute()
        
        svc.spreadsheets().values().update(
            spreadsheetId=SPREADSHEET_ID,
            range=f"{sheet}!E3:O{3+len(rows)-1}",
            valueInputOption='USER_ENTERED',
            body={'values': rows}
        ).execute()
        print(f"  Written to {sheet}")
    
    print(f"\n=== DONE — {datetime.now().isoformat()} ===")


if __name__ == '__main__':
    main()
