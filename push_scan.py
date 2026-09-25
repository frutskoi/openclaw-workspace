if True:
    import json, os, urllib.request
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    SID = '1_ULT1JZsw-rFh0qXsjCkvr00VA3Xcp1rt5TwGf6Amqm75NF3-4oRwdWw'
    tok = json.load(open('google-creds/token.json'))
    AT = tok['access_token']
    def gapi(url, payload=None, method=None):
        h = {'Authorization': 'Bearer ' + AT, 'Content-Type': 'application/json'}
        body = json.dumps(payload).encode() if payload is not None else None
        rq = urllib.request.Request(url, data=body, method=method or ('POST' if body is not None else 'GET'), headers=h)
        return json.load(urllib.request.urlopen(rq, timeout=90))
    proj = gapi('https://script.googleapis.com/v1/projects/%s/content' % SID)
    files = proj['files']
    extra = open('niche_aerosol/apps_code.gs').read()
    extra += '\nfunction scanNicheMenu(){ return scanOzonNiche(\'1VUf_ryMnXuTkD7PBBfRu36fYScwPQtXDu75Dx_iyJgk\'); }\n'
    found_code = False
    for f in files:
        if f.get('type') == 'SERVER_JS' and f.get('name') == 'Code':
            if 'scanOzonNiche' in f.get('source', ''):
                print('ALREADY_PRESENT', flush=True)
            else:
                anchor = ".addItem('5. Юнит экономика', 'loadUnitEconomics')"
                if anchor in f['source']:
                    f['source'] = f['source'].replace(anchor, anchor + "\n    .addItem('6. Анализ ниши (клеи)', 'scanNicheMenu')")
                    print('menu item added', flush=True)
                else:
                    print('menu anchor NOT FOUND', flush=True)
                f['source'] = f['source'] + '\n\n' + extra
            found_code = True
    if not found_code:
        raise SystemExit('Code file not found')
    gapi('https://script.googleapis.com/v1/projects/%s/content' % SID, {'files': files}, method='PUT')
    check = gapi('https://script.googleapis.com/v1/projects/%s/content' % SID)
    ok = any('scanNicheMenu' in f.get('source', '') for f in check['files'])
    print('PUSH_OK scanNicheMenu_present=', ok, flush=True)

