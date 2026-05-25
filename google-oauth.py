#!/usr/bin/env python3
"""
Google OAuth2 token generator with manual PKCE handling
"""
import hashlib
import base64
import secrets
import json
import os
import urllib.parse
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials

# Required scopes
SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/documents',
    # Note: Apps Script access requires separate project configuration
    # 'https://www.googleapis.com/auth/script.projects',
]

def generate_code_verifier():
    return secrets.token_urlsafe(43)

def generate_code_challenge(verifier):
    digest = hashlib.sha256(verifier.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest).decode('utf-8').replace('=', '')

def main():
    creds_dir = os.path.expanduser('~/.openclaw/workspace/google-creds')
    client_secret = os.path.join(creds_dir, 'client_secret.json')
    token_path = os.path.join(creds_dir, 'token.json')
    state_file = os.path.join(creds_dir, 'oauth_state.json')

    if not os.path.exists(client_secret):
        print(f"❌ client_secret.json not found at {client_secret}")
        return

    # Load client secrets
    with open(client_secret, 'r') as f:
        client_config = json.load(f)

    # Generate PKCE
    code_verifier = generate_code_verifier()
    code_challenge = generate_code_challenge(code_verifier)
    state = secrets.token_urlsafe(16)

    # Build auth URL manually
    auth_url = (
        f"https://accounts.google.com/o/oauth2/auth"
        f"?response_type=code"
        f"&client_id={client_config['installed']['client_id']}"
        f"&redirect_uri=http://localhost:8080"
        f"&scope={' '.join(SCOPES)}"
        f"&state={state}"
        f"&code_challenge={code_challenge}"
        f"&code_challenge_method=S256"
        f"&prompt=consent"
        f"&access_type=offline"
    )

    # Save state
    state_data = {
        'code_verifier': code_verifier,
        'state': state
    }
    with open(state_file, 'w') as f:
        json.dump(state_data, f)

    print()
    print("=" * 70)
    print("🔐 GOOGLE OAUTH2 AUTHORIZATION (UPDATED)")
    print("=" * 70)
    print()
    print("1️⃣  Open this URL in your browser:")
    print()
    print(f"   {auth_url}")
    print()
    print("2️⃣  Authorize the application with your Google account")
    print("3️⃣  After authorization, you'll be redirected to localhost")
    print("4️⃣  Copy the 'code' parameter from the URL")
    print()
    print("⚠️  The URL will look like:")
    print("   http://localhost:8080/?code=4/0AX4XfWj...&scope=...")
    print()
    print("=" * 70)
    print()

    # Get auth code from user
    auth_code = input("📋 Paste the authorization code here: ").strip()

    if not auth_code:
        print("❌ No code provided. Exiting.")
        return

    # Extract code from URL if full URL pasted
    if 'code=' in auth_code:
        auth_code = urllib.parse.parse_qs(urllib.parse.urlparse(auth_code).query)['code'][0]

    # Load state
    with open(state_file, 'r') as f:
        state_data = json.load(f)

    # Exchange code for credentials
    print()
    print("🔄 Exchanging code for tokens...")
    try:
        from google.auth.transport.requests import Request
        from google_auth_oauthlib import helpers

        # Build token request
        token_url = client_config['installed']['token_uri']
        data = {
            'code': auth_code,
            'client_id': client_config['installed']['client_id'],
            'client_secret': client_config['installed']['client_secret'],
            'redirect_uri': 'http://localhost:8080',
            'grant_type': 'authorization_code',
            'code_verifier': state_data['code_verifier']
        }

        import requests
        response = requests.post(token_url, data=data)
        response.raise_for_status()
        token_data = response.json()

        # Create credentials
        creds = Credentials(
            token=token_data.get('access_token'),
            refresh_token=token_data.get('refresh_token'),
            token_uri=client_config['installed']['token_uri'],
            client_id=client_config['installed']['client_id'],
            client_secret=client_config['installed']['client_secret'],
            scopes=SCOPES
        )

        # Save credentials
        with open(token_path, 'w') as f:
            f.write(creds.to_json())

        print()
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
        print("🚀 You can now use Google APIs!")
        print("=" * 70)

        # Clean up state file
        os.remove(state_file)

    except Exception as e:
        print(f"❌ Error exchanging token: {e}")
        import traceback
        traceback.print_exc()
        return

if __name__ == '__main__':
    main()