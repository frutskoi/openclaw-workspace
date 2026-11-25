import json, urllib.request, urllib.parse, datetime

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'
Q = chr(39)

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
WN = Q + titles[1927429751] + Q
PN = Q + titles[294758817] + Q

rows = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(WN + '!H2:AB20000') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
idx = {'M': 13, 'O': 15, 'P': 18}
agg = {}
nrows = 0
for r in rows:
    h = r[0] if r and isinstance(r[0], (int, float)) else None
    if h is None:
        continue
    nrows += 1
    wk = 46286 + ((h - 46286) // 7) * 7
    d = agg.setdefault(wk, {'M': 0.0, 'O': 0.0, 'P': 0.0})
    for k, i in idx.items():
        v = r[i] if len(r) > i and isinstance(r[i], (int, float)) else 0
        d[k] += v

bcol = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!B64:C81') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
bmap = {64 + i: (row[0] if row and len(row) > 0 and isinstance(row[0], (int, float)) else None) for i, row in enumerate(bcol)}

back = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!M64:P81') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
today = (datetime.date(2026, 11, 24) - datetime.date(1899, 12, 30)).days
ROWS = [64, 65, 67, 68, 69, 70, 72, 73, 74, 75, 77, 78, 79, 80, 81]
fails = 0
for i, row in enumerate(back):
    rn = 64 + i
    if rn not in ROWS:
        continue
    got = {'M': row[0] if len(row) > 0 else '', 'O': row[2] if len(row) > 2 else '', 'P': row[3] if len(row) > 3 else ''}
    b = bmap.get(rn)
    if b is None or b > today:
        print('row', rn, '(future) ->', json.dumps([got['M'], got['O'], got['P']], ensure_ascii=False))
        continue
    t = agg.get(b, {'M': 0.0, 'O': 0.0, 'P': 0.0})
    ok = all(isinstance(got[k], (int, float)) and abs(got[k] - t[k]) < 0.02 for k in ('M', 'O', 'P'))
    if not ok:
        fails += 1
    print('row', rn, 'week', b, ': M %.2f vs %.2f | O %.2f vs %.2f | P %.2f vs %.2f ->' % (got['M'] if isinstance(got['M'], (int, float)) else -1, t['M'], got['O'] if isinstance(got['O'], (int, float)) else -1, t['O'], got['P'] if isinstance(got['P'], (int, float)) else -1, t['P']), 'OK' if ok else 'FAIL')
print('weekly-sheet data rows:', nrows, '(last data row ~', nrows + 1, ')')
print('RESULT:', 'ALL OK' if fails == 0 else str(fails) + ' FAILS')
