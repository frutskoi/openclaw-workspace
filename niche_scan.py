import json, time, urllib.parse, urllib.request, gzip, os
os.makedirs('niche_aerosol', exist_ok=True)
H = {'User-Agent': 'Ozon/4.0 (Android 14; Phone)', 'Accept': 'application/json', 'X-O3-Region-Id': '1', 'X-O3-Device-Type': 'mobile', 'Accept-Encoding': 'gzip'}
QUERIES = {
 'aerozolnyy-kley': 'аэрозольный клей',
 'aerozolnyy-kley-universal': 'аэрозольный клей универсальный',
 'kley-dlya-shumoizolyacii': 'клей для шумоизоляции',
 'aerozolnyy-kley-avto': 'аэрозольный клей для автомобиля',
}
def get(url):
    req = urllib.request.Request(url, headers=H)
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            data = gzip.decompress(data)
    return json.loads(data.decode('utf-8', 'replace'))

def parse_search(query, slug):
    items_out = []
    for page in (1, 2):
        u = 'https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=' + urllib.parse.quote('/search/?text=%s&page=%d' % (urllib.parse.quote(query), page), safe='')
        try:
            j = get(u)
        except Exception as e:
            print(slug, 'page', page, 'ERR', repr(e)[:150]); break
        ws = j.get('widgetStates') or {}
        raw_items = []
        for k, v in ws.items():
            if 'searchResultsV2' in k or 'tileGrid' in k.lower():
                try:
                    w = json.loads(v)
                    raw_items += w.get('items') or []
                except Exception:
                    pass
        if not raw_items and page == 1:
            open('niche_aerosol/debug_%s.json' % slug, 'w').write(json.dumps(j, ensure_ascii=False)[:300000])
        for it in raw_items:
            s = json.dumps(it, ensure_ascii=False)
            sku = it.get('skuId') or it.get('sku')
            link = ((it.get('action') or {}).get('link')) or ''
            prices = []
            for m in re.findall(r'([0-9][0-9\s\u00a0]{2,9})\s*\u20bd', s):
                p = int(re.sub(r'[^0-9]', '', m))
                if 99 <= p <= 200000: prices.append(p)
            price = min(prices) if prices else None
            old = max(prices) if prices else None
            rating = None; reviews = None
            m = re.search(r'[Rr]ating\\?"?[:,\\"]+([0-9][.,0-9]?)', s)
            if m: rating = float(m.group(1).replace(',', '.'))
            m2 = re.search(r'([0-9]{1,5})\s*(?:отзыв|оценк|review)', s, re.I)
            if m2: reviews = int(m2.group(1))
            name = (it.get('title') or it.get('name') or '')
            if not name and link:
                slugpart = link.split('/product/')[1] if '/product/' in link else link
                name = slugpart.split('/')[0].replace('-', ' ')
            brand = it.get('brand') or ''
            if not brand:
                mb = re.search(r'brand\\?"?[:,\\"]+([^"\\]{2,40})', s)
                brand = mb.group(1) if mb else ''
            if sku:
                items_out.append({'sku': sku, 'name': name[:160], 'brand': brand[:60], 'price': price, 'old': (old if old != price else None), 'rating': rating, 'reviews': reviews, 'link': 'https://www.ozon.ru' + link})
        time.sleep(3)
    seen = set(); uniq = []
    for x in items_out:
        if x['sku'] in seen: continue
        seen.add(x['sku']); uniq.append(x)
    json.dump(uniq, open('niche_aerosol/parsed_%s.json' % slug, 'w'), ensure_ascii=False)
    print(slug, 'items:', len(uniq))
    return len(uniq)

total = 0
for slug, q in QUERIES.items():
    total += parse_search(q, slug)
print('TOTAL', total)
