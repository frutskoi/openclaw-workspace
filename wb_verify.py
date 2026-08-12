import json
from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

with open("/home/clawd/.openclaw/workspace/google-creds/token.json") as f:
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

for f in content.get("files", []):
    if f.get("type") == "SERVER_JS":
        src = f.get("source", "")
        lines = src.split("\n")
        # Find Шаг 3
        for i, line in enumerate(lines):
            if "Шаг 3" in line:
                print(f"LINE {i+1}: {line}")
                # Print a few lines after
                for j in range(i, min(i+5, len(lines))):
                    print(f"  {j+1}: {lines[j]}")
                break
