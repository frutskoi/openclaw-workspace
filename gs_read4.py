import json, urllib.request, urllib.parse

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
P = "'" + titles[1466051262] + "'"
ranges = [P + '!L2:U100']
q = urllib.parse.urlencode([('ranges', r) for r in ranges] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
data = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q)
rows = data['valueRanges'][0].get('values', [])
seen = {}
for r in rows:
    m = r[11] if len(r) > 11 else ''
    u = r[18] if len(r) > 18 else None
    if m in ('Продажа', 'Возврат') and m not in seen:
        seen[m] = u
print('Old source sample U (qty) by M:', json.dumps(seen, ensure_ascii=False))
