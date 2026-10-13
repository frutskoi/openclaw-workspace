import json, urllib.request, urllib.parse, datetime

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
grids = {p['properties']['sheetId']: p['properties'].get('gridProperties', {}) for p in meta['sheets']}
print('GRIDS:', json.dumps({titles[k]: v for k, v in grids.items() if k in (1927429751, 2145575072, 294758817)}, ensure_ascii=False))

def rng(sid, a1):
    return "'" + titles[sid] + "'!" + a1

for vr_name, ro in [('FORMULA-view', 'FORMULA'), ('', 'UNFORMATTED_VALUE')]:
    pass

ranges = [rng(1927429751, 'N1:AZ1'), rng(1927429751, 'N2:AZ2'), rng(294758817, 'A52:N80')]
q = urllib.parse.urlencode([('ranges', r) for r in ranges] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
data = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q)
for vr in data['valueRanges']:
    print('==== ', vr.get('range'))
    for row in vr.get('values', []):
        print(json.dumps(row, ensure_ascii=False))

# find target rows: serial dates around 2026-09-21
d = datetime.date(2026, 9, 21)
serial = (d - datetime.date(1899, 12, 30)).days
print('SERIAL for 2026-09-21 =', serial)

q2 = urllib.parse.urlencode([('ranges', rng(294758817, 'A1:N80')), ('valueRenderOption', 'FORMULA')])
data2 = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q2)
for vr in data2['valueRanges']:
    rows = vr.get('values', [])
    print('==== FORMULA view, rows:', len(rows))
    for i, row in enumerate(rows, start=1):
        if i >= 50:
            print(str(i), json.dumps(row, ensure_ascii=False))
