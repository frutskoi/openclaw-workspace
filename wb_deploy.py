import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

TPATH = "/home/clawd/.openclaw/workspace/google-creds/token.json"
with open(TPATH) as f:
    td = json.load(f)

tkn = td.get("token")
rtk = td.get("refresh_token")
csc = td.get("client_secret")

creds = Credentials(
    token=tkn,
    refresh_token=rtk,
    token_uri=td["token_uri"],
    client_id=td["client_id"],
    client_secret=csc,
    scopes=[
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/script.projects",
        "https://www.googleapis.com/auth/script.scriptapp",
    ],
)
creds.refresh(Request())
service = build("script", "v1", credentials=creds)

PID = "19PATaFRs-HOczfm3Ez0CY94lQJ6aU_fC9kq38IBu8PVUfeJ7WDtcBy2s"
content = service.projects().getContent(scriptId=PID).execute()

manifest_src = None
js_src = None
js_name = None

for f in content.get("files", []):
    if f["type"] == "JSON":
        manifest_src = f.get("source", "{}")
    elif f["type"] == "SERVER_JS":
        js_src = f.get("source", "")
        js_name = f["name"]

lines = js_src.split("\n")
fbw_start = None
fbw_end = None
for i, line in enumerate(lines):
    if "// --- Шаг 3: FBW" in line:
        fbw_start = i
    if fbw_start is not None and "// --- Шаг 4:" in line and i > fbw_start:
        fbw_end = i
        break

old_fbw = "\n".join(lines[fbw_start:fbw_end])
print(f"Replacing: lines {fbw_start+1}-{fbw_end}, {len(old_fbw)} chars")

with open("/tmp/new_fbw.txt", "r") as nf:
    new_fbw = nf.read()

assert old_fbw in js_src, "OLD BLOCK NOT FOUND!"
new_js = js_src.replace(old_fbw, new_fbw)

request_body = {
    "files": [
        {"name": "appsscript", "type": "JSON", "source": manifest_src},
        {"name": js_name, "type": "SERVER_JS", "source": new_js},
    ]
}

resp = service.projects().updateContent(scriptId=PID, body=request_body).execute()
print("UPDATE OK!")
for f in resp.get("files", []):
    n = f["name"]
    t = f["type"]
    s = len(f.get("source", ""))
    print(f"  {n} ({t}) - {s} chars")
