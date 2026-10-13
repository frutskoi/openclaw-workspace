import json, urllib.request, urllib.parse, datetime

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
WN = "'" + titles[1927429751] + "'"
PN = "'" + titles[294758817] + "'"
SB = "'" + titles[2145575072] + "'"

# 1) current L61:L67 state: formula + computed value
for opt, name in [('FORMULA', 'FORMULA'), ('UNFORMATTED_VALUE', 'VALUE')]:
    url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!K61:N67') + '?valueRenderOption=' + opt
    d = get(url)
    print('---- L-zone', name)
    for i, row in enumerate(d.get('values', []), start=61):
        print(i, json.dumps(row, ensure_ascii=False)[:600])

# 2) ground truth from weekly report
ranges = [WN + '!H2:K5032', WN + '!J2:J5032']
q = urllib.parse.urlencode([('ranges', r) for r in ranges] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
data = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q)
rows_hk = data['valueRanges'][0].get('values', [])
rows_j = data['valueRanges'][1].get('values', [])

seb = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(SB + '!A1:C100') + '?valueRenderOption=UNFORMATTED_VALUE')
cost = {}
for r in seb.get('values', []):
    if r and isinstance(r[0], (int, float)):
        cost[int(r[0])] = r[2] if len(r) > 2 and isinstance(r[2], (int, float)) else 0
print('COST MAP:', cost)

for b, c in [(46286, 46292), (46293, 46299)]:
    sales = rets = 0
    costsum = 0.0
    missing = set()
    for i in range(len(rows_hk)):
        r = rows_hk[i]
        if len(r) < 4:
            continue
        h, j, k = r[0], r[1], r[3]
        if not isinstance(h, (int, float)) or not isinstance(j, (int, float)):
            continue
        if b <= h <= c and k in ('Продажа', 'Возврат'):
            cu = cost.get(int(j))
            if cu is None:
                missing.add(int(j)); cu = 0
            if k == 'Продажа':
                sales += 1; costsum += cu
            else:
                rets += 1; costsum -= cu
    print('week', b, '-', c, ': sales=', sales, 'returns=', rets, 'cost=', costsum, 'missing SKUs=', missing)
