import json, urllib.request, urllib.parse, datetime

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'
Q = chr(39)

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

def post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method='POST')
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    req.add_header('Content-Type', 'application/json')
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
WN_T = titles[1927429751]
PN = Q + titles[294758817] + Q
WT = Q + WN_T + Q

tpl_m, tpl_o, tpl_p = [l.strip() for l in open('/home/clawd/.openclaw/workspace/formula_tpl3.txt', encoding='utf-8').read().splitlines() if l.strip()]
assert '$U$' in tpl_m and '$W$' in tpl_o and '$Z$' in tpl_p, 'template order wrong'

def mkf(tpl, r):
    f = tpl.replace('__R__', str(r)).replace('__T__', WT)
    assert '__' not in f and WT in f
    return f

ROWS = [64, 65, 67, 68, 69, 70, 72, 73, 74, 75, 77, 78, 79, 80, 81]

# truth from weekly sheet
idx = {'U': 13, 'W': 15, 'Z': 18}
rows = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(WT + '!H2:AB20000') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
agg = {}
for r in rows:
    h = r[0] if r and isinstance(r[0], (int, float)) else None
    if h is None:
        continue
    wk = 46286 + ((h - 46286) // 7) * 7
    d = agg.setdefault(wk, {'U': 0.0, 'W': 0.0, 'Z': 0.0})
    for k, i in idx.items():
        v = r[i] if len(r) > i and isinstance(r[i], (int, float)) else 0
        d[k] += v

bcol = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!B64:C81') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
bmap = {64 + i: (row[0] if row and len(row) > 0 and isinstance(row[0], (int, float)) else None) for i, row in enumerate(bcol)}
today = (datetime.date(2026, 11, 24) - datetime.date(1899, 12, 30)).days
truth = {}
for r in ROWS:
    b = bmap.get(r)
    if b is None or b > today:
        truth[r] = None
    else:
        d = agg.get(b, {'U': 0.0, 'W': 0.0, 'Z': 0.0})
        truth[r] = d

pre = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!M64:P81') + '?valueRenderOption=FORMULA').get('values', [])
bad = 0
for i, row in enumerate(pre):
    rn = 64 + i
    if rn not in ROWS:
        continue
    for j, c in [(0, 'M'), (2, 'O'), (3, 'P')]:
        v = row[j] if len(row) > j else ''
        if isinstance(v, str) and v.startswith('=') and 'Продажи по реализации' not in v:
            print('WARN', c + str(rn), 'unexpected formula:', v[:60])
            bad += 1
        elif not (isinstance(v, str) and (v.startswith('=') or v == '')):
            print('WARN', c + str(rn), 'static value:', repr(v))
            bad += 1
assert bad == 0, 'pre-check failed, aborting write'
print('PRE-CHECK OK: all target cells are old-source formulas')

data = []
for r in ROWS:
    for col, tpl in [('M', tpl_m), ('O', tpl_o), ('P', tpl_p)]:
        data.append({'range': PN + '!' + col + str(r), 'values': [[mkf(tpl, r)]]})
res = post('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchUpdate', {
    'valueInputOption': 'USER_ENTERED',
    'data': data
})
print('WRITE:', json.dumps({'cells': res.get('totalUpdatedCells'), 'rows': res.get('totalUpdatedRows')}))

back = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!M64:P81') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
fails = 0
for i, row in enumerate(back):
    rn = 64 + i
    if rn not in ROWS:
        continue
    got = {'M': row[0] if len(row) > 0 else '', 'O': row[2] if len(row) > 2 else '', 'P': row[3] if len(row) > 3 else ''}
    t = truth.get(rn)
    if t is None:
        print('row', rn, '(future):', json.dumps(got, ensure_ascii=False))
        continue
    ok = all(isinstance(got[k], (int, float)) and abs(got[k] - t[k]) < 0.02 for k in ('M', 'O', 'P'))
    if not ok:
        fails += 1
    print('row', rn, 'week', bmap.get(rn), 'M=%.2f/%.2f O=%.2f/%.2f P=%.2f/%.2f ->' % (got['M'] if isinstance(got['M'], (int, float)) else -1, t['M'], got['O'] if isinstance(got['O'], (int, float)) else -1, t['W'], got['P'] if isinstance(got['P'], (int, float)) else -1, t['Z']), 'OK' if ok else 'FAIL')
print('RESULT:', 'ALL OK' if fails == 0 else str(fails) + ' FAILS')
