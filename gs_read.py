import json, urllib.request, urllib.parse

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'

def get(url):
    req = urllib.request.Request(url)
    req.add_header('Authorization', 'Bearer ' + tok['access_token'])
    return json.load(urllib.request.urlopen(req))

meta = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties')
titles = {p['properties']['sheetId']: p['properties']['title'] for p in meta['sheets']}
wanted = [1927429751, 2145575072, 294758817]
ranges = ["'" + titles[sid] + "'!" + rng for sid, rng in zip(wanted, ['A1:M5', 'A1:N15', 'A1:N25'])]
q = urllib.parse.urlencode([('ranges', r) for r in ranges] + [('valueRenderOption', 'UNFORMATTED_VALUE')])
url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values:batchGet?' + q
try:
    data = get(url)
    for vr in data['valueRanges']:
        print('==== ', vr.get('range'))
        for row in vr.get('values', []):
            print(json.dumps(row, ensure_ascii=False))
except Exception as e:
    print('ERR', e, getattr(e, 'code', ''), getattr(e, 'read', lambda: b'')()[:500])
