#!/usr/bin/env python3
"""
OAuth 2.0 authorization flow for Google APIs using client_secret.json
Saves token.json for future use
"""

import os
import json
from pathlib import Path

try:
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
except ImportError as e:
    print("Installing required packages...")
    import subprocess
    subprocess.check_call([
        "pip3", "install", "--quiet",
        "google-auth-oauthlib",
        "google-auth-httplib2",
        "google-api-python-client"
    ])
    from google_auth_oauthlib.flow import InstalledAppFlow
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials

# Scopes for Vertex AI and general Google access
SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/aiplatform'
]

def main():
    workspace = Path.home() / '.openclaw' / 'workspace'
    creds_dir = workspace / 'google-creds'
    client_secret_file = creds_dir / 'client_secret.json'
    token_file = creds_dir / 'token.json'

    if not client_secret_file.exists():
        print(f"❌ client_secret.json not found at {client_secret_file}")
        return 1

    print(f"📁 Using client_secret from: {client_secret_file}")
    print(f"💾 Token will be saved to: {token_file}")
    print()

    creds = None

    # Load existing token
    if token_file.exists():
        print(f"📜 Found existing token.json")
        creds = Credentials.from_authorized_user_file(str(token_file), SCOPES)
        if creds and creds.valid:
            print("✅ Existing token is valid!")
            print(f"   Expires: {creds.expiry}")
            return 0
        elif creds and creds.expired and creds.refresh_token:
            print("🔄 Token expired, attempting refresh...")
            try:
                creds.refresh(Request())
                token_file.write_text(creds.to_json())
                print("✅ Token refreshed successfully!")
                return 0
            except Exception as e:
                print(f"⚠️  Refresh failed: {e}")
                print("   Will re-authorize...")
                creds = None

    # If no valid creds, run OAuth flow
    if not creds or not creds.valid:
        print("🔐 Starting OAuth 2.0 authorization flow...")
        print()
        print("   A browser window will open (or you'll get a URL).")
        print("   Sign in to your Google account and authorize the app.")
        print()

        flow = InstalledAppFlow.from_client_secrets_file(
            str(client_secret_file),
            SCOPES,
            redirect_uri='http://localhost:8080'
        )

        creds = flow.run_local_server(
            port=8080,
            open_browser=True,
            prompt='consent',
            authorization_prompt_message='Please visit this URL to authorize the application:',
            success_message='The authentication flow has completed.'
        )

        # Save credentials
        token_file.write_text(creds.to_json())
        print()
        print(f"✅ Token saved to {token_file}")
        print(f"   Expires: {creds.expiry}")

    return 0

if __name__ == '__main__':
    exit(main())