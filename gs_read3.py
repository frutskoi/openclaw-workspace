import json, urllib.request, urllib.parse

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
W = "'" + titles[1927429751] + "'"
SB = "'" + titles[2145575072] + "'"

# K (doc type), H (date), J (sku), P (qty delivered), Q (qty returned), S (sale)
ranges = [W + '!A2:AB1479']
q = urllib.parse.urlencode([('ranges', r) for r in ranges] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
data = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q)
rows = data['valueRanges'][0].get('values', [])
print('total data rows:', len(rows))
from collections import Counter
kcount = Counter()
samples = {}
last_h = None
for r in rows:
    k = (r[10] if len(r) > 10 else '')
    kcount[k] += 1
    if k not in samples:
        samples[k] = r
    if len(r) > 7 and r[7] != '':
        last_h = r[7]
print('K values:', dict(kcount))
print('last H (date op serial):', last_h)
for k, r in samples.items():
    print('SAMPLE K=' + repr(k), json.dumps({'H': r[7] if len(r) > 7 else '', 'J': r[9] if len(r) > 9 else '', 'P': r[15] if len(r) > 15 else '', 'Q': r[16] if len(r) > 16 else '', 'S': r[18] if len(r) > 18 else ''}, ensure_ascii=False))

# Sept rows around 46286-46299 by doc type, with qty
print('---- rows week 46286..46299:')
for r in rows:
    if len(r) > 18 and isinstance(r[7], (int, float)) and 46286 <= r[7] <= 46299:
        k = r[10] if len(r) > 10 else ''
        if k in ('Продажа', 'Возврат'):
            print(json.dumps({'H': r[7], 'J': r[9], 'K': k, 'P': r[15], 'Q': r[16], 'S': r[18]}, ensure_ascii=False))

seb = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(SB + '!A1:C30') + '?valueRenderOption=UNFORMATTED_VALUE')
print('---- Себес A1:C30:')
for row in seb.get('values', []):
    print(json.dumps(row, ensure_ascii=False))
