#!/usr/bin/env python3
"""
Exchange OAuth code for tokens
"""
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials
import json
import os
import urllib.parse

SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
    'https://www.googleapis.com/auth/script.projects',
]

def main():
    creds_dir = os.path.expanduser('~/.openclaw/workspace/google-creds')
    client_secret = os.path.join(creds_dir, 'client_secret.json')
    token_path = os.path.join(creds_dir, 'token.json')

    # OAuth code from user
    auth_code = "4/0AeoWuM8N1F-oor2stQ5UYmnqzO2Pq41ha22emkE7KZ5eWEpYzjxj_DAZrpVe5fP7exEMMg"

    # Load client secrets
    flow = InstalledAppFlow.from_client_secrets_file(
        client_secret,
        SCOPES,
        redirect_uri='http://localhost:8080'
    )

    # Exchange code for credentials
    print("🔄 Exchanging code for tokens...")
    try:
        flow.fetch_token(code=auth_code)
        creds = flow.credentials

        # Save credentials
        with open(token_path, 'w') as f:
            f.write(creds.to_json())

        print()
        print("=" * 70)
        print("✅ SUCCESS! Token saved")
        print("=" * 70)
        print(f"📍 Token file: {token_path}")
        print()
        print("📊 Token info:")
        print(f"  - Access token: {creds.token[:20]}...")
        print(f"  - Refresh token: {'✅ Present' if creds.refresh_token else '❌ Missing'}")
        print(f"  - Expires at: {creds.expiry}")
        print(f"  - Token URI: {creds.token_uri}")
        print()
        print("🚀 Google Workspace authorization complete!")
        print("=" * 70)

    except Exception as e:
        print(f"❌ Error exchanging token: {e}")
        import traceback
        traceback.print_exc()

if __name__ == '__main__':
    main()