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

hdr = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!A1:T1') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
print('HEADERS A1:T1:', json.dumps(hdr, ensure_ascii=False))

body = get('https://sheets.googleapis.com/v4/spreadsheets/' + SID + '/values/' + urllib.parse.quote(PN + '!B55:T120') + '?valueRenderOption=UNFORMATTED_VALUE').get('values', [])
print('---- B55:T120 values (row, B, C, F, I, L, M, N, O..T):')
for i, row in enumerate(body, start=55):
    sel = [row[j] if len(row) > j else '' for j in [0, 4, 6, 10, 11, 12, 13, 14, 15, 16, 17, 18]]
    if any(x != '' and x != 0 for x in sel) or i > 110:
        print(i, json.dumps(sel, ensure_ascii=False))
