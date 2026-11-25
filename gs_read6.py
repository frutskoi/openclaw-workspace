import json, urllib.request, urllib.parse

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
PN = "'" + titles[294758817] + "'"
WN = "'" + titles[1927429751] + "'"

for ro, name in [('FORMULA', 'FORMULA'), ('UNFORMATTED_VALUE', 'VALUE')]:
    d = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!M60:P82') + '?valueRenderOption=' + ro).get('values', [])
    print('==== M60:P82', name)
    for i, row in enumerate(d, start=60):
        slim = [(x[:110] + '...' if isinstance(x, str) and len(x) > 110 else x) for x in row]
        print(i, json.dumps(slim, ensure_ascii=False))

# last operation date + totals of weekly sheet by relevant columns for target weeks
ranges = [WN + '!H2:AB6000']
q = urllib.parse.urlencode([('ranges', r) for r in ranges] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
rows = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q)['valueRanges'][0].get('values', [])
print('weekly rows:', len(rows))
last_h = None
from collections import defaultdict
agg = defaultdict(float)
for r in rows:
    h = r[0] if len(r) > 0 and isinstance(r[0], (int, float)) else None
    if h:
        last_h = max(last_h or 0, h)
    def g(i):
        v = r[i] if len(r) > i else 0
        return v if isinstance(v, (int, float)) else 0
    agg[h] += g(20) + g(22) + g(24) + g(25) + g(26)
print('last H in weekly sheet:', last_h)
for wk in [46286, 46293, 46300, 46307, 46314, 46321, 46328, 46335, 46342, 46349]:
    print('week', wk, 'sum(U,W,X,Y,Z,V,AB):', round(agg.get(wk, 0), 2))
