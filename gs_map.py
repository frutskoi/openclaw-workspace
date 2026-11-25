import json, urllib.request, urllib.parse

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
WN = "'" + titles[1927429751] + "'"
OLD = "'" + titles[1466051262] + "'"

# old sheet headers around Z..AF (col 26..32) to name AA/AC/AF
old_hdr = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(OLD + '!Z1:AG1') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
print('OLD Z1:AG1:', json.dumps(old_hdr, ensure_ascii=False))

rows = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(WN + '!H2:AB6000') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
idx = {'U': 13, 'V': 14, 'W': 15, 'X': 16, 'Y': 17, 'Z': 18, 'AA': 19, 'AB': 20}
agg = {}
for r in rows:
    h = r[0] if r and isinstance(r[0], (int, float)) else None
    if h is None:
        continue
    wk = 46286 + ((h - 46286) // 7) * 7
    d = agg.setdefault(wk, {k: 0.0 for k in idx})
    for k, i in idx.items():
        v = r[i] if len(r) > i and isinstance(r[i], (int, float)) else 0
        d[k] += v

known = {46272: {'M': 57010.11, 'O': 402.52, 'P': 7127}, 46279: {'M': 50424.06, 'O': 469.12, 'P': 6212}}
for wk in [46272, 46279, 46286, 46293, 46300, 46307, 46314, 46321, 46328, 46335, 46342, 46349]:
    d = agg.get(wk)
    if not d:
        print('week', wk, ': no data')
        continue
    line = 'week %d: U=%.2f V=%.2f W=%.2f X=%.2f Y=%.2f Z=%.2f AB=%.2f' % (wk, d['U'], d['V'], d['W'], d['X'], d['Y'], d['Z'], d['AB'])
    if wk in known:
        line += '  | old M=%.2f O=%.2f P=%.2f' % (known[wk]['M'], known[wk]['O'], known[wk]['P'])
    print(line)
for wk in [46272, 46279]:
    d = agg.get(wk)
    if d:
        print('week', wk, 'candidates: X+Y+Z=%.2f X+Y+Z+AB=%.2f X+Y+Z+V=%.2f all=%.2f' % (d['X'] + d['Y'] + d['Z'], d['X'] + d['Y'] + d['Z'] + d['AB'], d['X'] + d['Y'] + d['Z'] + d['V'], d['U'] + d['V'] + d['W'] + d['X'] + d['Y'] + d['Z'] + d['AB']))
