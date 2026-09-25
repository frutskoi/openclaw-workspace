if True:
    import json, time, os, urllib.request, urllib.parse
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    cs = json.load(open('google-creds/client_secret.json'))
    inst = cs.get('installed') or cs.get('web')
    tok = json.load(open('google-creds/token.json'))
    d = urllib.parse.urlencode({'client_id': inst['client_id'], 'client_secret': inst['client_secret'], 'refresh_token': tok['refresh_token'], 'grant_type': 'refresh_token'}).encode()
    rr = json.load(urllib.request.urlopen(urllib.request.Request('https://oauth2.googleapis.com/token', data=d), timeout=30))
    tok['access_token'] = rr['access_token']
    json.dump(tok, open('google-creds/token.json', 'w'))
    AT = tok['access_token']
    def gapi(url, payload=None, method=None):
        h = {'Authorization': 'Bearer ' + AT, 'Content-Type': 'application/json'}
        body = json.dumps(payload).encode() if payload is not None else None
        rq = urllib.request.Request(url, data=body, method=method or ('POST' if body is not None else 'GET'), headers=h)
        return json.load(urllib.request.urlopen(rq, timeout=90))
    SHEET = '1VUf_ryMnXuTkD7PBBfRu36fYScwPQtXDu75Dx_iyJgk'
    CODE = open('niche_aerosol/apps_code.gs').read()
    manifest = json.dumps({'timeZone': 'Europe/Moscow', 'exceptionLogging': 'STACKDRIVER', 'oauthScopes': ['https://www.googleapis.com/auth/script.external_request', 'https://www.googleapis.com/auth/spreadsheets']})
    proj = gapi('https://script.googleapis.com/v1/projects', {'title': 'ozon-niche-scanner'})
    SID = proj['scriptId']
    print('project:', SID, flush=True)
    gapi('https://script.googleapis.com/v1/projects/%s/content' % SID, {'files': [{'name': 'appsscript', 'type': 'JSON', 'source': manifest}, {'name': 'Code', 'type': 'SERVER_JS', 'source': CODE}]}, method='PUT')
    ver = gapi('https://script.googleapis.com/v1/projects/%s/versions' % SID, {})
    vn = ver.get('versionNumber')
    gapi('https://script.googleapis.com/v1/projects/%s/deployments' % SID, {'scriptId': SID, 'versionNumber': vn, 'manifestFileName': 'appsscript', 'description': 'api'})
    print('deployed v', vn, flush=True)
    op = gapi('https://script.googleapis.com/v1/scripts/%s:run' % SID, {'function': 'scanOzonNiche', 'parameters': [SHEET], 'devMode': False})
    for i in range(50):
        if op.get('done'):
            break
        time.sleep(5)
        if op.get('name'):
            op = gapi('https://script.googleapis.com/v1/' + op['name'])
    out = {'ok': False}
    if op.get('error'):
        out = {'ok': False, 'error': op['error']}
    elif op.get('response') and 'result' in op['response']:
        out = json.loads(op['response']['result'])
    os.makedirs('niche_aerosol', exist_ok=True)
    json.dump(out, open('niche_aerosol/run_result.json', 'w'), ensure_ascii=False)
    print('DONE total=', out.get('total'), 'summary=', out.get('summary'), flush=True)

