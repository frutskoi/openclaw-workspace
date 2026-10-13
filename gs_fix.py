import json, urllib.request, urllib.parse

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

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
WN = "'" + titles[1927429751] + "'"
PN = "'" + titles[294758817] + "'"
SB = "'" + titles[2145575072] + "'"

seb = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(SB + '!A1:C100') + '?valueRenderOption=UNFORMATTED_VALUE')
cost = {}
for r in seb.get('values', []):
    if r and isinstance(r[0], (int, float)):
        cost[int(r[0])] = r[2] if len(r) > 2 and isinstance(r[2], (int, float)) else 0

ranges = [WN + '!H2:K5032']
q = urllib.parse.urlencode([('ranges', r) for r in ranges] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
data = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q)
rows = data['valueRanges'][0].get('values', [])

truth = {}
for b, c in [(46286, 46292), (46293, 46299)]:
    s = rt = 0
    total = 0.0
    for r in rows:
        if len(r) < 4:
            continue
        h, j, k = r[0], r[2], r[3]
        if not isinstance(h, (int, float)) or not isinstance(j, (int, float)):
            continue
        if b <= h <= c and k in ('Продажа', 'Возврат'):
            cu = cost.get(int(j), 0)
            if k == 'Продажа':
                s += 1; total += cu
            else:
                rt += 1; total -= cu
    truth[b] = total
    print('TRUTH week', b, '-', c, ': sales=', s, 'returns=', rt, 'cost=', total)

F65 = ('=IF(OR($B65="";$B65>TODAY());"";IFNA(SUMPRODUCT(('' + titles[1927429751] + ''!$K$2:$K$5032="Продажа")'
       '*('' + titles[1927429751] + ''!$H$2:$H$5032>=$B65)*('' + titles[1927429751] + ''!$H$2:$H$5032<=$C65)'
       '*XLOOKUP('' + titles[1927429751] + ''!$J$2:$J$5032;'' + titles[2145575072] + ''!$A$1:$A$1000;'' + titles[2145575072] + ''!$C$1:$C$1000;0))'
       '-SUMPRODUCT(('' + titles[1927429751] + ''!$K$2:$K$5032="Возврат")'
       '*('' + titles[1927429751] + ''!$H$2:$H$5032>=$B65)*('' + titles[1927429751] + ''!$H$2:$H$5032<=$C65)'
       '*XLOOKUP('' + titles[1927429751] + ''!$J$2:$J$5032;'' + titles[2145575072] + ''!$A$1:$A$1000;'' + titles[2145575072] + ''!$C$1:$C$1000;0));0))')

pre = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!L65:L67') + '?valueRenderOption=FORMULA')
cur = pre.get('values', [])
assert len(cur) >= 1 and isinstance(cur[0][0], str) and cur[0][0].startswith('=IF(OR($B65'), 'L65 unexpected: ' + json.dumps(cur, ensure_ascii=False)[:200]
print('PRE-CHECK L65 ok (old formula present)')

try:
    res = post('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchUpdate', {
        'valueInputOption': 'USER_ENTERED',
        'data': [
            {'range': PN + '!L65', 'values': [[F65]]},
            {'range': PN + '!L67', 'values': [['']]}
        ]
    })
    print('WRITE:', json.dumps(res.get('totalUpdatedCells')))
except urllib.error.HTTPError as e:
    print('WRITE ERR', e.code, e.read()[:800])
    raise SystemExit(1)

back_v = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!L62:L67') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
back_f = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!L65') + '?valueRenderOption=FORMULA').get('values', [])
print('VALUES L62..L67:', json.dumps(back_v, ensure_ascii=False))
print('L65 formula starts:', back_f[0][0][:80] if back_f else 'NONE')
if len(back_v) >= 4:
    v65 = back_v[3][0] if back_v[3] else None
    print('CHECK L65:', v65, '== truth', truth[46293], '->', (isinstance(v65, (int, float)) and abs(v65 - truth[46293]) < 0.01))
