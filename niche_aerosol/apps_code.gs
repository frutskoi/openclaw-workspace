function scanOzonNiche(spreadsheetId) {
  var QUERIES = [['aerozolnyy-kley','аэрозольный клей',2],['aerozolnyy-kley-universal','аэрозольный клей универсальный',1],['kley-dlya-shumoizolyacii','клей для шумоизоляции',2],['aerozolnyy-kley-avto','аэрозольный клей для автомобиля',1]];
  var OPTS = {method:'get', headers:{'User-Agent':'Ozon/4.0 (Android 14; Phone)','Accept':'application/json','X-O3-Region-Id':'1','X-O3-Device-Type':'mobile'}, muteHttpExceptions:true, followRedirects:true};
  var all = {};
  QUERIES.forEach(function(qp){
    var slug=qp[0], q=qp[1], pages=qp[2];
    var items=[];
    for(var page=1;page<=pages;page++){
      var url='https://www.ozon.ru/api/composer-api.bx/page/json/v2?url='+encodeURIComponent('/search/?text='+encodeURIComponent(q)+'&page='+page);
      var resp;
      try { resp = UrlFetchApp.fetch(url,OPTS); } catch(e){ continue; }
      if(resp.getResponseCode()!==200){ continue; }
      var j=JSON.parse(resp.getContentText());
      var ws=j.widgetStates||{};
      Object.keys(ws).forEach(function(k){
        if(k.indexOf('searchResultsV2')<0 && k.toLowerCase().indexOf('tilegrid')<0) return;
        var w; try{ w=JSON.parse(ws[k]); }catch(e){ return; }
        (w.items||[]).forEach(function(it){
          var link=(it.action&&it.action.link)||'';
          var sku=it.skuId||it.sku||null;
          if(!sku){ var m=link.match(/\/product\/(?:[^\/]+\/)?(\d{6,})/); if(m) sku=m[1]; }
          if(!sku) return;
          var s=JSON.stringify(it);
          var prices=[]; var re=/([\d][\d\s\u00A0]{2,9})\s*¥/g, mm;
          while((mm=re.exec(s))){ var p=parseInt(mm[1].replace(/[\s\u00A0]/g,''),10); if(p>=99&&p<=200000) prices.push(p); }
          var price=prices.length?Math.min.apply(null,prices):null;
          var old=prices.length?Math.max.apply(null,prices):null;
          var rating=null, mr=s.match(/"rating"\s*:\s*"?([0-9][.,0-9]?)/); if(mr) rating=parseFloat(mr[1].replace(',','.'));
          var reviews=null, mv=s.match(/(\d{1,5})\s*(?:отзыв|оценк)/i); if(mv) reviews=parseInt(mv[1],10);
          var name=it.title||it.name||''; if(!name&&link){ var pre=link.split('/product/')[1]||link; name=pre.split('/')[0].replace(/-/g,' '); }
          var brand=it.brand||''; if(!brand){ var mb=s.match(/"brand"\s*:\s*"([^"]{2,40})/); brand=mb?mb[1]:''; }
          items.push({sku:String(sku),name:String(name).slice(0,140),brand:String(brand).slice(0,50),price:price,old:(old!==price?old:null),rating:rating,reviews:reviews,link:'https://www.ozon.ru'+link});
        });
      });
      Utilities.sleep(1500);
    }
    var uniq=[], sn={};
    items.forEach(function(x){ if(sn[x.sku])return; sn[x.sku]=1; uniq.push(x); });
    all[slug]={query:q,count:uniq.length,items:uniq};
  });
  var ss=SpreadsheetApp.openById(spreadsheetId);
  var shName='Ниша аэрозольные клеи (raw)';
  var sh=ss.getSheetByName(shName); if(sh) ss.deleteSheet(sh);
  sh=ss.insertSheet(shName);
  sh.appendRow(['Запрос','SKU','Название','Бренд','Цена','Старая цена','Рейтинг','Отзывов','Ссылка']);
  Object.keys(all).forEach(function(slug){
    all[slug].items.forEach(function(x){ sh.appendRow([all[slug].query,x.sku,x.name,x.brand,x.price,x.old,x.rating,x.reviews,x.link]); });
  });
  var summary=Object.keys(all).map(function(k){return k+':'+all[k].count;}).join(', ');
  var total=Object.keys(all).reduce(function(s,k){return s+all[k].count;},0);
  return JSON.stringify({ok:true, summary:summary, total:total, data:all});
}
