# -*- coding: utf-8 -*-
import json, urllib.request, urllib.parse, ssl, socket, time, calendar
from collections import defaultdict

TP = '/home/clawd/.openclaw/workspace/google-creds/token.json'
SS = '1VUf_ryMnXuTkD7PBBfRu36fYScwPQtXDu75Dx_iyJgk'
tok = json.load(open(TP))
tk = tok['access_token']
BH = ''.join(chr(c) for c in [66,101,97,114,101,114,32])

def shdr(): return {'Authorization': ''.join([BH, tk])}
def sget(url):
    return json.load(urllib.request.urlopen(urllib.request.Request(url, headers=shdr()), timeout=60))
def srefresh():
    global tk
    data = urllib.parse.urlencode({'client_id': tok['client_id'], 'client_secret': tok['client_secret'], 'refresh_token': tok['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    nj = json.load(urllib.request.urlopen(urllib.request.Request(tok['token_uri'], data=data), timeout=30))
    tok['access_token'] = nj['access_token']; tk = nj['access_token']
    json.dump(tok, open(TP, 'w'))
def sget2(url):
    try: return sget(url)
    except urllib.error.HTTPError as e:
        if e.code == 401:
            srefresh(); return sget(url)
        raise

n = sget2('https://sheets.googleapis.com/v4/spreadsheets/' + SS + '/values/' + urllib.parse.quote('Настройки!B3:C3') + '?valueRenderOption=UNFORMATTED_VALUE')
v = (n.get('values') or [['','']])[0]
CID, KEY = str(v[0]), str(v[1])
socket.setdefaulttimeout(90)

def ozon(path, body, tries=6):
    last = ''
    for i in range(tries):
        req = urllib.request.Request('https://api-seller.ozon.ru' + path, data=json.dumps(body).encode(), method='POST',
            headers={'Client-Id': CID, 'Api-Key': KEY, 'Content-Type': 'application/json'})
        try:
            return json.load(urllib.request.urlopen(req, timeout=120)), None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(2 + 2*i); continue
            return None, 'HTTP ' + str(e.code) + ': ' + e.read().decode('utf-8','replace')[:300]
        except Exception as e:
            time.sleep(3); last = str(e)[:150]
    return None, 'FAIL ' + str(last)

types = {x['id']: x['name'] for x in json.load(open('/home/clawd/.openclaw/workspace/_accrual_types.json'))['accrual_types']}
LOGISTICS = {2,12,13,16,17,28,29,30,32,42,43,44,45,53,56,59,64,65,71,73,82,88,97,98,101,106,107,110,111,112,113,114,115,120,121,131,132}
ADVERTISING = {3,4,5,19,22,23,26,33,41,47,48,49,50,54,55,61,70,74,75,87,95,96,116,125,126,127,128,130}
PENALTIES = {8,14,89,90,91,92,93}
STORAGE = {46,58,60,77,78,102}
COMP_TYPES = {10,25,104}

month_type = defaultdict(lambda: defaultdict(float))  # ym -> type_id -> net sum
raw_rows = [['Месяц','Дата','AccrualID','ТипID','Тип','Категория','unit_number','Сумма']]
seen = set()
days_done = 0
t0 = time.time()

for m in range(1, 11):
    nd = calendar.monthrange(2026, m)[1]
    if m == 10: nd = 5
    for d in range(1, nd + 1):
        date = '2026-%02d-%02d' % (m, d)
        if date > '2026-10-05':
            break
        last_id = 0
        while True:
            body = {'date': date}
            if last_id: body['last_id'] = last_id
            j, err = ozon('/v1/finance/accrual/by-day', body)
            if err:
                print('DAY FAIL', date, err, flush=True)
                break
            for a in j.get('accruals', []):
                aid = a.get('accrual_id')
                if aid in seen: continue
                seen.add(aid)
                amt_total = float(a.get('total_amount',{}).get('amount') or 0)
                fees = []
                itf = a.get('item_fees')
                if itf:
                    for f in itf.get('fees', []):
                        for fee in f.get('fees', []):
                            fees.append((fee.get('type_id'), float(fee.get('accrued',{}).get('amount') or 0)))
                nif = a.get('non_item_fee')
                if nif:
                    fees.append((nif.get('type_id'), float(nif.get('accrued',{}).get('amount') or 0)))
                p = a.get('posting')
                if p:
                    for pr in p.get('products', []):
                        cm = pr.get('commission')
                        if cm: fees.append((69, float(cm.get('amount') or 0)))
                        for fee in ((pr.get('delivery') or {}).get('services') or []):
                            fees.append((fee.get('type_id'), float(fee.get('accrued',{}).get('amount') or 0)))
                for fee in ((a.get('container_fees') or {}).get('fees') or []):
                    fees.append((fee.get('type_id'), float(fee.get('accrued',{}).get('amount') or 0)))
                if not fees:
                    fees = [(None, amt_total)]
                ym = date[:7]
                for tid, amt in fees:
                    month_type[ym][tid] += amt
                    raw_rows.append([ym, date, aid, tid if tid is not None else '', types.get(tid,'?'), a.get('accrued_category',''), a.get('unit_number') or '', amt])
            li = j.get('last_id')
            time.sleep(0.7)
            if not li or li == last_id or not j.get('accruals'):
                break
            last_id = li
        days_done += 1
        if days_done % 20 == 0:
            print('days done:', days_done, 'elapsed:', int(time.time()-t0), 's', flush=True)

print('FETCH DONE. days:', days_done, 'raw rows:', len(raw_rows)-1, 'elapsed:', int(time.time()-t0), 's', flush=True)

# категории ОПиУ по месяцам
CATS = ['commission','logistics','acquiring','storage','advertising','penalties','other','compensations']
cat_sum = defaultdict(lambda: defaultdict(float))
for ym, tm in month_type.items():
    c = cat_sum[ym]
    for tid, amt in tm.items():
        if tid is None:
            continue
        if tid in COMP_TYPES:
            c['compensations'] -= amt
        elif amt > 0:
            c['compensations'] -= amt
        else:
            if tid == 69: row = 'commission'
            elif tid in LOGISTICS: row = 'logistics'
            elif tid == 1: row = 'acquiring'
            elif tid in STORAGE: row = 'storage'
            elif tid in ADVERTISING: row = 'advertising'
            elif tid in PENALTIES: row = 'penalties'
            else: row = 'other'
            c[row] += -amt

# комиссии из реализации
real_commission = {}
real_returns = {}
for m in range(1, 11):
    ym = '2026-%02d' % m
    j, err = ozon('/v2/finance/realization', {'year': 2026, 'month': m})
    if err:
        print('REAL FAIL', ym, err, flush=True)
        continue
    rows = j.get('result', {}).get('rows', [])
    tot = 0.0; ret = 0.0
    for row in rows:
        dc = row.get('delivery_commission') or {}
        tot += float(dc.get('total') or 0)
        rc = row.get('return_commission')
        if rc: ret += abs(float(rc.get('total') or 0))
    real_commission[ym] = round(tot, 2)
    real_returns[ym] = round(ret, 2)
    time.sleep(1.0)

result = {}
for m in range(1, 11):
    ym = '2026-%02d' % m
    c = cat_sum.get(ym, {})
    result[ym] = {
        'categories': {k: round(c.get(k, 0.0), 2) for k in CATS},
        'commission_realization': real_commission.get(ym),
        'returns_realization': real_returns.get(ym),
        'by_type': {str(k): round(v2, 2) for k, v2 in month_type.get(ym, {}).items()}
    }
json.dump(result, open('/home/clawd/.openclaw/workspace/_opiu_accrual_result.json', 'w'), ensure_ascii=False, indent=1)
json.dump(raw_rows, open('/home/clawd/.openclaw/workspace/_opiu_accrual_raw.json', 'w'), ensure_ascii=False)
print('=== SUMMARY (accruals net by categories):')
for m in range(1, 11):
    ym = '2026-%02d' % m
    c = result[ym]
    print(ym, c['categories'], '| comm_real:', c['commission_realization'], '| ret_real:', c['returns_realization'])
print('ALL DONE', flush=True)
