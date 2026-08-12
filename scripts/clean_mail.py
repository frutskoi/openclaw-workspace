#!/usr/bin/env python3
from googleapiclient.discovery import build
from google.oauth2.credentials import Credentials
import json
import os

creds_path = '/home/clawd/.openclaw/workspace/google-creds/token.json'

with open(creds_path) as f:
    creds_data = json.load(f)
    creds = Credentials.from_authorized_user_info(creds_data, ['https://www.googleapis.com/auth/gmail.modify'])

service = build('gmail', 'v1', credentials=creds)

# Search for emails from ozon and wb
results = service.users().messages().list(
    userId='me',
    q='from:ozon.ru OR from:wb.ru OR from:wbmail.ru',
    maxResults=500
).execute()

messages = results.get('messages', [])
print(f'Found {len(messages)} emails from Ozon/WB')

ozon_ids = []
wb_ids = []

for msg in messages:
    msg_data = service.users().messages().get(
        userId='me',
        id=msg['id'],
        format='metadata',
        metadataHeaders=['From']
    ).execute()
    
    headers = {h['name']: h['value'] for h in msg_data['payload'].get('headers', [])}
    from_addr = headers.get('From', '').lower()
    
    if 'ozon' in from_addr:
        ozon_ids.append(msg['id'])
    elif 'wb' in from_addr or 'wildberries' in from_addr:
        wb_ids.append(msg['id'])

print(f'Ozon: {len(ozon_ids)}, WB: {len(wb_ids)}')

# Delete all
for msg_id in ozon_ids + wb_ids:
    service.users().messages().trash(userId='me', id=msg_id).execute()

print(f'Deleted {len(ozon_ids)} Ozon and {len(wb_ids)} WB emails')