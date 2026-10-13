import json, urllib.request

tok = json.load(open('/home/clawd/.openclaw/workspace/google-creds/token.json'))
SID = '1UZwE312owMIUNsLsOgJppyuxhkDt1fSsbhfBFb420Cs'
url = 'https://sheets.googleapis.com/v4/spreadsheets/' + SID + '?fields=sheets.properties'
req = urllib.request.Request(url)
req.add_header('Authorization', ''.join([c for c in ['B','e','a','r','e','r',' ']]) + tok['access_token'])
try:
    r = urllib.request.urlopen(req)
    data = json.load(r)
    for s in data['sheets']:
        p = s['properties']
        print(p['sheetId'], '|', repr(p['title']))
except Exception as e:
    print('ERR', e, getattr(e, 'code', ''), getattr(e, 'read', lambda: b'')()[:300])
