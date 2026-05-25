#!/usr/bin/env python3
"""
Google OAuth with external redirect support
"""
from google_auth_oauthlib.flow import InstalledAppFlow
from google.oauth2.credentials import Credentials
import json
import os
import urllib.parse
import http.server
import socketserver
import threading

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

class CallbackHandler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        query = urllib.parse.urlparse(self.path).query
        params = urllib.parse.parse_qs(query)

        if 'code' in params:
            self.server.auth_code = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b'<h1>Authorization successful! You can close this window.</h1>')
            self.server.shutdown_event.set()
        else:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'Authorization failed!')

    def log_message(self, format, *args):
        pass  # Suppress log messages

def main():
    creds_dir = os.path.expanduser('~/.openclaw/workspace/google-creds')
    client_secret = os.path.join(creds_dir, 'client_secret.json')
    token_path = os.path.join(creds_dir, 'token.json')

    if not os.path.exists(client_secret):
        print(f"❌ client_secret.json not found at {client_secret}")
        return

    # Load client secrets
    with open(client_secret, 'r') as f:
        client_config = json.load(f)

    # Start local server
    port = 8080
    server = socketserver.TCPServer(('0.0.0.0', port), CallbackHandler)
    server.auth_code = None
    server.shutdown_event = threading.Event()
    server.timeout = 300  # 5 minutes

    server_thread = threading.Thread(target=server.handle_request)
    server_thread.daemon = True
    server_thread.start()

    print()
    print("=" * 70)
    print("🔐 GOOGLE OAUTH2 AUTHORIZATION (LOCAL SERVER)")
    print("=" * 70)
    print()
    print("📡 Local server running on http://localhost:8080")
    print()
    print("1️⃣  Open this URL in your browser:")
    print()

    # Build auth URL
    auth_url = (
        f"https://accounts.google.com/o/oauth2/auth"
        f"?response_type=code"
        f"&client_id={client_config['installed']['client_id']}"
        f"&redirect_uri=http://localhost:8080"
        f"&scope={' '.join(SCOPES)}"
        f"&prompt=consent"
        f"&access_type=offline"
    )

    print(f"   {auth_url}")
    print()
    print("2️⃣  Authorize the application with your Google account")
    print("3️⃣  After authorization, the token will be saved automatically")
    print()
    print("=" * 70)
    print()
    print("⏳ Waiting for authorization... (5 minute timeout)")

    # Wait for callback
    server.shutdown_event.wait(timeout=300)

    if server.auth_code:
        print()
        print("🔄 Received authorization code! Exchanging for token...")

        # Exchange code for token
        token_url = client_config['installed']['token_uri']
        data = {
            'code': server.auth_code,
            'client_id': client_config['installed']['client_id'],
            'client_secret': client_config['installed']['client_secret'],
            'redirect_uri': 'http://localhost:8080',
            'grant_type': 'authorization_code',
        }

        import requests
        response = requests.post(token_url, data=data)

        if response.status_code == 200:
            token_data = response.json()

            # Save token
            with open(token_path, 'w') as f:
                json.dump(token_data, f, indent=2)

            print()
            print("✅ SUCCESS! Token saved")
            print("=" * 70)
            print(f"📍 Token file: {token_path}")
            print()
            print("📊 Token info:")
            print(f"  - Access token: {token_data.get('access_token', '')[:20]}...")
            print(f"  - Refresh token: {'✅ Present' if token_data.get('refresh_token') else '❌ Missing'}")
            print()
            print("🚀 You can now use Google APIs!")
            print("=" * 70)
        else:
            print(f"❌ Token exchange failed: {response.text}")
    else:
        print("❌ Timeout: No authorization received")

    server.shutdown()

if __name__ == '__main__':
    main()