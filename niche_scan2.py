import json, time, urllib.parse, urllib.request, gzip, os, re, sys
os.makedirs('niche_aerosol', exist_ok=True)
H = {'User-Agent': 'Ozon/4.0 (Android 14; Phone)', 'Accept': 'application/json', 'X-O3-Region-Id': '1', 'X-O3-Device-Type': 'mobile', 'Accept-Encoding': 'gzip'}
QUERIES = [
 ('aerozolnyy-kley', 'аэрозольный клей', 2),
 ('aerozolnyy-kley-universal', 'аэрозольный клей универсальный', 1),
 ('kley-dlya-shumoizolyacii', 'клей для шумоизоляции', 2),
 ('aerozolnyy-kley-avto', 'аэрозольный клей для автомобиля', 1),
]
def get(url):
    req = urllib.request.Request(url, headers=H)
    with urllib.request.urlopen(req, timeout=40) as r:
        data = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            data = gzip.decompress(data)
    return json.loads(data.decode('utf-8', 'replace'))

summary = {}
sample_keys = None
for slug, q, pages in QUERIES:
    items_out = []
    for page in range(1, pages + 1):
        u = 'https://www.ozon.ru/api/composer-api.bx/page/json/v2?url=' + urllib.parse.quote('/search/?text=%s&page=%d' % (urllib.parse.quote(q), page), safe='')
        try:
            j = get(u)
        except Exception as e:
            print(slug, page, 'ERR', repr(e)[:150], flush=True); break
        ws = j.get('widgetStates') or {}
        raw = []
        for k, v in ws.items():
            if 'searchResultsV2' in k or 'tileGrid' in k.lower():
                try:
                    w = json.loads(v)
                    raw += w.get('items') or []
                except Exception:
                    pass
        if page == 1 and raw and sample_keys is None:
            open('niche_aerosol/sample_item.json', 'w').write(json.dumps(raw[0], ensure_ascii=False, indent=1)[:6000])
        for it in raw:
            link = ((it.get('action') or {}).get('link')) or ''
            msku = re.search(r'/product/(?:[^/]+/)?(\d{6,})', link)
            sku = it.get('skuId') or it.get('sku') or (msku.group(1) if msku else None)
            if not sku:
                continue
            s = json.dumps(it, ensure_ascii=False)
            prices = []
            for m in re.findall(r'([0-9][0-9\s\u00a0]{2,9})\s*\u20bd', s):
                p = int(re.sub(r'[^0-9]', '', m))
                if 99 <= p <= 200000: prices.append(p)
            price = min(prices) if prices else None
            old = max(prices) if prices else None
            rating = None
            mr = re.search(r'"rating"\s*:\s*"?([0-9][.,0-9]?)', s) or re.search(r'[Rr]ating[^0-9]{0,4}([0-9][.,0-9])', s)
            if mr: rating = float(mr.group(1).replace(',', '.'))
            reviews = None
            mv = re.search(r'([0-9]{1,5})\s*(?:отзыв|оценк)', s, re.I)
            if mv: reviews = int(mv.group(1))
            name = it.get('title') or it.get('name') or ''
            if not name and link:
                pre = link.split('/product/')[1] if '/product/' in link else link
                name = re.sub(r'/\d{6,}.*$', '', pre).replace('-', ' ')
            brand = it.get('brand') or ''
            if not brand:
                mb = re.search(r'"brand"\s*:\s*"([^"]{2,40})', s)
                brand = mb.group(1) if mb else ''
            items_out.append({'sku': str(sku), 'name': str(name)[:140], 'brand': str(brand)[:50], 'price': price, 'old': (old if old != price else None), 'rating': rating, 'reviews': reviews, 'link': 'https://www.ozon.ru' + link})
        time.sleep(3)
    seen = set(); uniq = []
    for x in items_out:
        if x['sku'] in seen: continue
        seen.add(x['sku']); uniq.append(x)
    json.dump(uniq, open('niche_aerosol/parsed_%s.json' % slug, 'w'), ensure_ascii=False)
    summary[slug] = len(uniq)
    print(slug, '->', len(uniq), flush=True)
print('SUMMARY', json.dumps(summary))
