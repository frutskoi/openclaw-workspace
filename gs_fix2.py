import json, urllib.request, urllib.parse

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
SB_T = titles[2145575072]
PN = Q + titles[294758817] + Q

TPL = open('/home/clawd/.openclaw/workspace/formula_tpl.txt', encoding='utf-8').read().strip()

def mkf(r):
    return TPL.replace('__R__', str(r)).replace('__W__', Q + WN_T + Q).replace('__S__', Q + SB_T + Q)

F64 = mkf(64)
F65 = mkf(65)
assert WN_T in F64 and SB_T in F64, 'placeholder replace failed'
assert '__' not in F64, 'leftover placeholders'
assert F64.count(Q + WN_T + Q) == 8 and F64.count(Q + SB_T + Q) == 4, 'unexpected ref count'
assert 'SUMPRODUCT' in F64 and F64.startswith('=IF(OR($B64')

seb = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(Q + SB_T + Q + '!A1:C100') + '?valueRenderOption=UNFORMATTED_VALUE')
cost = {}
for r in seb.get('values', []):
    if r and isinstance(r[0], (int, float)):
        cost[int(r[0])] = r[2] if len(r) > 2 and isinstance(r[2], (int, float)) else 0
q = urllib.parse.urlencode([('ranges', Q + WN_T + Q + '!H2:K5032')] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
rows = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q)['valueRanges'][0].get('values', [])
truth = {}
for b, c in [(46286, 46292), (46293, 46299)]:
    total = 0.0
    for r in rows:
        if len(r) < 4 or not isinstance(r[0], (int, float)) or not isinstance(r[2], (int, float)):
            continue
        if b <= r[0] <= c and r[3] in ('Продажа', 'Возврат'):
            total += cost.get(int(r[2]), 0) * (1 if r[3] == 'Продажа' else -1)
    truth[b] = total
print('TRUTH:', json.dumps(truth))

pre_f = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!L64:L67') + '?valueRenderOption=FORMULA').get('values', [])
print('PRE FORMULAS:', json.dumps([[(x[:50] if isinstance(x, str) else x) for x in row] for row in pre_f], ensure_ascii=False))

try:
    res = post('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchUpdate', {
        'valueInputOption': 'USER_ENTERED',
        'data': [
            {'range': PN + '!L64', 'values': [[F64]]},
            {'range': PN + '!L65', 'values': [[F65]]}
        ]
    })
    print('WRITE:', json.dumps(res.get('totalUpdatedCells')))
except urllib.error.HTTPError as e:
    print('WRITE ERR', e.code, e.read()[:500])
    raise SystemExit(1)

back_v = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!L62:L67') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
print('VALUES L62..L67:', json.dumps(back_v, ensure_ascii=False))
vals = {62 + i: (row[0] if row else None) for i, row in enumerate(back_v)}
ok64 = isinstance(vals.get(64), (int, float)) and abs(vals[64] - truth[46286]) < 0.01
ok65 = isinstance(vals.get(65), (int, float)) and abs(vals[65] - truth[46293]) < 0.01
print('CHECK L64', vals.get(64), '==', truth[46286], '->', ok64)
print('CHECK L65', vals.get(65), '==', truth[46293], '->', ok65)
print('SUBTOTAL L66 =', vals.get(66))
