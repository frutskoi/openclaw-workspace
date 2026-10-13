import json, urllib.request, urllib.parse

path = '/home/clawd/.openclaw/workspace/google-creds/token.json'
tok = json.load(open(path))
body = urllib.parse.urlencode({
    'client_id': tok['client_id'],
    'client_secret': tok['client_secret'],
    'refresh_token': tok['refresh_token'],
    'grant_type': 'refresh_token',
}).encode()
req = urllib.request.Request(tok['token_uri'], data=body)
try:
    r = urllib.request.urlopen(req)
    resp = json.load(r)
    tok['access_token'] = resp['access_token']
    json.dump(tok, open(path, 'w'))
    print('REFRESH_OK')
except Exception as e:
    print('ERR', e, getattr(e, 'code', ''), getattr(e, 'read', lambda: b'')()[:300])
