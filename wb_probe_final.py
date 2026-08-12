import json, sys
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

TOKEN_PATH = "/home/clawd/.openclaw/workspace/google-creds/token.json"

with open(TOKEN_PATH) as f:
    td = json.load(f)

creds = Credentials(
    token=***"token"],
    refresh_token=***"refresh_token"],
    token_uri=td["token_uri"],
    client_id=td["client_id"],
    client_secret=***"client_secret"],
    scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/script.projects",
        "https://www.googleapis.com/auth/script.scriptapp",
    ],
)
creds.refresh(Request())
service = build("script", "v1", credentials=creds)

project_id = "19PATaFRs-HOczfm3Ez0CY94lQJ6aU_fC9kq38IBu8PVUfeJ7WDtcBy2s"
content = service.projects().getContent(scriptId=project_id).execute()

manifest_src = None
js_src = None
js_name = None

for f in content.get("files", []):
    if f["type"] == "JSON":
        manifest_src = f.get("source", "{}")
    elif f["type"] == "SERVER_JS":
        js_src = f.get("source", "")
        js_name = f["name"]

# Find FBW block (Шаг 3)
lines = js_src.split("\n")
fbw_start = None
fbw_end = None
for i, line in enumerate(lines):
    if "// --- Шаг 3: FBW" in line:
        fbw_start = i
    if fbw_start is not None and "// --- Шаг 4:" in line and i > fbw_start:
        fbw_end = i
        break

if fbw_start is None:
    print("ERROR: FBW block not found")
    sys.exit(1)

old_fbw = "\n".join(lines[fbw_start:fbw_end])
print(f"Old FBW block: lines {fbw_start+1}-{fbw_end}, {len(old_fbw)} chars")
print(f"First line: {lines[fbw_start]}")

# New probe code
new_fbw = """    // --- Шаг 3: FBW остатки — PROBE эндпоинтов ---
    var fbwMap = {};

    try {
      // PROBE 1: analytics GET wb-warehouses
      try {
        var p1Resp = UrlFetchApp.fetch('https://analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses', {
          method: 'get', headers: { 'Authorization': token }, muteHttpExceptions: true
        });
        Logger.log('PROBE1 analytics GET wb-warehouses: HTTP ' + p1Resp.getResponseCode() + ' body: ' + p1Resp.getContentText().substring(0, 400));
      } catch (e1) { Logger.log('PROBE1 exc: ' + e1.message); }

      // PROBE 2: analytics POST wb-warehouses with brands
      try {
        var p2Brands = [];
        var p2Bs = {};
        for (var ri2 = 1; ri2 < data.length; ri2++) {
          var bv = String(data[ri2][COL_BRAND - 1] || '').trim();
          if (bv && !p2Bs[bv]) { p2Bs[bv] = true; p2Brands.push(bv); }
        }
        var p2Resp = UrlFetchApp.fetch('https://analytics-api.wildberries.ru/api/analytics/v1/stocks-report/wb-warehouses', {
          method: 'post', contentType: 'application/json',
          headers: { 'Authorization': token },
          payload: JSON.stringify({ brands: p2Brands }), muteHttpExceptions: true
        });
        Logger.log('PROBE2 analytics POST brands: HTTP ' + p2Resp.getResponseCode() + ' body: ' + p2Resp.getContentText().substring(0, 400));
      } catch (e2) { Logger.log('PROBE2 exc: ' + e2.message); }

      // PROBE 3: analytics v2/stocks
      try {
        var p3Resp = UrlFetchApp.fetch('https://analytics-api.wildberries.ru/api/analytics/v2/stocks?limit=100', {
          method: 'get', headers: { 'Authorization': token }, muteHttpExceptions: true
        });
        Logger.log('PROBE3 analytics v2/stocks: HTTP ' + p3Resp.getResponseCode() + ' body: ' + p3Resp.getContentText().substring(0, 400));
      } catch (e3) { Logger.log('PROBE3 exc: ' + e3.message); }

      // PROBE 4: statistics supplier/stocks
      try {
        var p4Resp = UrlFetchApp.fetch('https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=2026-08-01', {
          method: 'get', headers: { 'Authorization': token }, muteHttpExceptions: true
        });
        Logger.log('PROBE4 statistics stocks: HTTP ' + p4Resp.getResponseCode() + ' body: ' + p4Resp.getContentText().substring(0, 400));
      } catch (e4) { Logger.log('PROBE4 exc: ' + e4.message); }

      // PROBE 5: analytics v1/stocks
      try {
        var p5Resp = UrlFetchApp.fetch('https://analytics-api.wildberries.ru/api/analytics/v1/stocks?limit=100', {
          method: 'get', headers: { 'Authorization': token }, muteHttpExceptions: true
        });
        Logger.log('PROBE5 analytics v1/stocks: HTTP ' + p5Resp.getResponseCode() + ' body: ' + p5Resp.getContentText().substring(0, 400));
      } catch (e5) { Logger.log('PROBE5 exc: ' + e5.message); }

      // PROBE 6: marketplace warehouses
      try {
        var p6Resp = UrlFetchApp.fetch('https://marketplace-api.wildberries.ru/api/v3/warehouses', {
          method: 'get', headers: { 'Authorization': token }, muteHttpExceptions: true
        });
        Logger.log('PROBE6 marketplace warehouses: HTTP ' + p6Resp.getResponseCode() + ' body: ' + p6Resp.getContentText().substring(0, 400));
      } catch (e6) { Logger.log('PROBE6 exc: ' + e6.message); }

      // PROBE 7: analytics stocks-report (no wb-warehouses)
      try {
        var p7Resp = UrlFetchApp.fetch('https://analytics-api.wildberries.ru/api/analytics/v1/stocks-report', {
          method: 'get', headers: { 'Authorization': token }, muteHttpExceptions: true
        });
        Logger.log('PROBE7 analytics stocks-report: HTTP ' + p7Resp.getResponseCode() + ' body: ' + p7Resp.getContentText().substring(0, 400));
      } catch (e7) { Logger.log('PROBE7 exc: ' + e7.message); }

    } catch (fbwErr) {
      Logger.log('FBW probe exception: ' + fbwErr.message);
    }

"""

assert old_fbw in js_src, "OLD BLOCK NOT FOUND IN CURRENT CODE!"
new_js = js_src.replace(old_fbw, new_fbw)

request_body = {
    "files": [
        {"name": "appsscript", "type": "JSON", "source": manifest_src},
        {"name": js_name, "type": "SERVER_JS", "source": new_js},
    ]
}

resp = service.projects().updateContent(scriptId=project_id, body=request_body).execute()
print("UPDATE OK!")
for f in resp.get("files", []):
    print(f"  {f['name']} ({f['type']}) - {len(f.get('source',''))} chars")
