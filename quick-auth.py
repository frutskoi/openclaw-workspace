#!/usr/bin/env python3
"""
Quick OAuth token exchange using the provided code
"""
import json
import os
import requests
import hashlib
import base64
import secrets

def generate_code_verifier():
    return secrets.token_urlsafe(43)

def generate_code_challenge(verifier):
    digest = hashlib.sha256(verifier.encode('utf-8')).digest()
    return base64.urlsafe_b64encode(digest).decode('utf-8').replace('=', '')

def main():
    creds_dir = os.path.expanduser('~/.openclaw/workspace/google-creds')
    client_secret_file = os.path.join(creds_dir, 'client_secret.json')
    token_path = os.path.join(creds_dir, 'token.json')

    # Load client secrets
    with open(client_secret_file, 'r') as f:
        client_config = json.load(f)

    # The code you provided
    auth_code = "4/0AeoWuM8N1F-oor2stQ5UYmnqzO2Pq41ha22emkE7KZ5eWEpYzjxj_DAZrpVe5fP7exEMMg"

    # Generate PKCE (this needs to match what was used)
    code_verifier = generate_code_verifier()
    code_challenge = generate_code_challenge(code_verifier)

    print("🔄 Trying to exchange token...")

    # Try direct exchange first
    token_url = client_config['installed']['token_uri']
    data = {
        'code': auth_code,
        'client_id': client_config['installed']['client_id'],
        'client_secret': client_config['installed']['client_secret'],
        'redirect_uri': 'http://localhost:8080',
        'grant_type': 'authorization_code',
    }

    # Try with PKCE
    data_with_pkce = data.copy()
    data_with_pkce['code_verifier'] = code_verifier

    try:
        # Try without PKCE first
        response = requests.post(token_url, data=data)
        print(f"Response (no PKCE): {response.status_code}")

        if response.status_code == 400:
            print("Trying with PKCE...")
            response = requests.post(token_url, data=data_with_pkce)
            print(f"Response (with PKCE): {response.status_code}")

        response.raise_for_status()
        token_data = response.json()

        print("✅ Token exchange successful!")

        # Save token
        with open(token_path, 'w') as f:
            json.dump(token_data, f, indent=2)

        print(f"📍 Token saved to: {token_path}")
        print(f"📊 Access token: {token_data.get('access_token', '')[:20]}...")
        print(f"🔄 Refresh token: {'✅ Present' if token_data.get('refresh_token') else '❌ Missing'}")

        return True

    except Exception as e:
        print(f"❌ Error: {e}")
        print(f"Response: {response.text if 'response' in locals() else 'N/A'}")
        return False

if __name__ == '__main__':
    main()