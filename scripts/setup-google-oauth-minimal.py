#!/usr/bin/env python3
"""
Minimal OAuth 2.0 authorization for Google APIs using desktop client_secret
No external dependencies needed - pure Python + requests
"""

import os
import json
import urllib.parse
import urllib.request
import urllib.error
import http.server
import socketserver
import webbrowser
from pathlib import Path

WORKSPACE = Path.home() / '.openclaw' / 'workspace'
CREDS_DIR = WORKSPACE / 'google-creds'
CLIENT_SECRET_FILE = CREDS_DIR / 'client_secret.json'
TOKEN_FILE = CREDS_DIR / 'token.json'

SCOPES = [
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/aiplatform'
]

class AuthHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path.startswith('/?'):
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)

            if 'code' in params:
                self.server.auth_code = params['code'][0]
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                self.wfile.write(b"""
                <html><body>
                <h1>Authorization successful!</h1>
                <p>You can close this window now.</p>
                </body></html>
                """)
            else:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b'No authorization code found')

def load_client_secret():
    with open(CLIENT_SECRET_FILE) as f:
        return json.load(f)

def save_token(token_data):
    with open(TOKEN_FILE, 'w') as f:
        json.dump(token_data, f, indent=2)

def load_token():
    if TOKEN_FILE.exists():
        with open(TOKEN_FILE) as f:
            return json.load(f)
    return None

def exchange_code_for_token(client_secret, auth_code):
    client_id = client_secret['installed']['client_id']
    client_secret_val = client_secret['installed']['client_secret']
    token_uri = client_secret['installed']['token_uri']

    data = {
        'code': auth_code,
        'client_id': client_id,
        'client_secret': client_secret_val,
        'grant_type': 'authorization_code',
        'redirect_uri': 'http://localhost:8080'
    }

    req = urllib.request.Request(
        token_uri,
        data=urllib.parse.urlencode(data).encode(),
        headers={'Content-Type': 'application/x-www-form-urlencoded'}
    )

    try:
        with urllib.request.urlopen(req) as response:
            return json.loads(response.read().decode())
    except urllib.error.URLError as e:
        print(f"Error exchanging code: {e}")
        print(f"Response: {e.read().decode() if hasattr(e, 'read') else 'No response'}")
        return None

def get_auth_url(client_secret):
    client_id = client_secret['installed']['client_id']
    auth_uri = client_secret['installed']['auth_uri']

    params = {
        'response_type': 'code',
        'client_id': client_id,
        'redirect_uri': 'http://localhost:8080',
        'scope': ' '.join(SCOPES),
        'access_type': 'offline',
        'prompt': 'consent'
    }

    return f"{auth_uri}?{urllib.parse.urlencode(params)}"

def main():
    print("🔐 Google OAuth 2.0 Authorization Flow")
    print(f"📁 Workspace: {WORKSPACE}")
    print(f"📄 Client secret: {CLIENT_SECRET_FILE}")
    print(f"💾 Token file: {TOKEN_FILE}")
    print()

    if not CLIENT_SECRET_FILE.exists():
        print(f"❌ client_secret.json not found")
        return 1

    # Load client secret
    try:
        client_secret = load_client_secret()
        print("✅ Loaded client_secret.json")
        print(f"   Client ID: {client_secret['installed']['client_id']}")
        print(f"   Project: {client_secret['installed']['project_id']}")
    except Exception as e:
        print(f"❌ Error loading client_secret: {e}")
        return 1

    print()

    # Check existing token
    existing_token = load_token()
    if existing_token:
        print("📜 Found existing token.json")
        if 'access_token' in existing_token:
            print("✅ Access token exists")
            if 'expires_at' in existing_token:
                import time
                if existing_token['expires_at'] > time.time() + 60:
                    print("✅ Token is still valid")
                    return 0
                else:
                    print("⚠️  Token expired")
                    if 'refresh_token' in existing_token:
                        print("🔄 Has refresh token - will try to refresh")
                        # Could implement refresh here
        print("🔄 Will re-authorize for fresh token")

    print()
    print("🌐 Starting local server on port 8080...")

    # Start local server
    with socketserver.TCPServer(("localhost", 8080), AuthHandler) as httpd:
        httpd.auth_code = None

        # Generate auth URL
        auth_url = get_auth_url(client_secret)
        print()
        print("=" * 60)
        print("📋 AUTHORIZATION REQUIRED")
        print("=" * 60)
        print()
        print("Please open this URL in your browser:")
        print()
        print(f"  {auth_url}")
        print()
        print("Or copy this code if the browser doesn't open:")
        print()
        print("  Open: https://accounts.google.com/o/oauth2/auth")
        print("  Add params:")
        print(f"    client_id={client_secret['installed']['client_id']}")
        print("    redirect_uri=http://localhost:8080")
        print(f"    scope={' '.join(SCOPES)}")
        print("    response_type=code")
        print("    access_type=offline")
        print("    prompt=consent")
        print()
        print("After authorization, the code will be automatically captured.")
        print("=" * 60)
        print()

        # Try to open browser
        try:
            webbrowser.open(auth_url)
            print("🌍 Browser opened automatically")
        except:
            print("⚠️  Could not open browser automatically")

        print()
        print("⏳ Waiting for authorization...")

        # Wait for auth code (timeout 5 minutes)
        httpd.timeout = 300
        httpd.handle_request()

        if not httpd.auth_code:
            print("❌ No authorization code received (timeout)")
            return 1

        print()
        print("✅ Authorization code received!")
        print(f"   Code: {httpd.auth_code[:20]}...")

        # Exchange code for token
        print()
        print("🔄 Exchanging code for access token...")

        token_data = exchange_code_for_token(client_secret, httpd.auth_code)

        if not token_data:
            print("❌ Failed to exchange code for token")
            return 1

        print("✅ Token received!")
        print(f"   Access token: {token_data.get('access_token', 'N/A')[:20]}...")
        print(f"   Refresh token: {token_data.get('refresh_token', 'N/A')[:20]}...")

        # Add expiry time
        import time
        token_data['expires_at'] = time.time() + token_data.get('expires_in', 3600)

        # Save token
        save_token(token_data)
        print()
        print(f"💾 Token saved to: {TOKEN_FILE}")
        print(f"   Expires at: {token_data['expires_at']}")

        print()
        print("=" * 60)
        print("✅ AUTHORIZATION COMPLETE!")
        print("=" * 60)
        print()
        print(f"Set environment variable to use this token:")
        print(f"  export GOOGLE_APPLICATION_CREDENTIALS=\"{TOKEN_FILE}\"")
        print()

    return 0

if __name__ == '__main__':
    exit(main())