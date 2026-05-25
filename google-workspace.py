#!/usr/bin/env python3
"""
Google Workspace tool for OpenClaw
Supports: Gmail, Calendar, Drive, Sheets, Docs, Apps Script
"""
import sys
import json
import os
import argparse
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

# Paths
CREDS_DIR = os.path.expanduser('~/.openclaw/workspace/google-creds')
TOKEN_PATH = os.path.join(CREDS_DIR, 'token.json')
CLIENT_SECRET_PATH = os.path.join(CREDS_DIR, 'client_secret.json')

# Scopes
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

def load_credentials():
    """Load and refresh credentials"""
    if not os.path.exists(TOKEN_PATH):
        return None

    creds = Credentials.from_authorized_user_file(TOKEN_PATH, SCOPES)

    # Refresh if expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        with open(TOKEN_PATH, 'w') as f:
            f.write(creds.to_json())

    return creds

def get_service(service_name, version, credentials):
    """Get Google API service"""
    return build(service_name, version, credentials=credentials)

# Gmail functions
def gmail_list_unread(limit=10):
    """List unread Gmail messages"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('gmail', 'v1', creds)
    results = service.users().messages().list(
        userId='me',
        q='is:unread',
        maxResults=limit
    ).execute()

    messages = results.get('messages', [])
    output = []

    for msg in messages[:limit]:
        msg_data = service.users().messages().get(
            userId='me',
            id=msg['id'],
            format='metadata',
            metadataHeaders=['From', 'Subject', 'Date']
        ).execute()

        headers = {h['name']: h['value'] for h in msg_data['payload'].get('headers', [])}
        output.append({
            'id': msg['id'],
            'from': headers.get('From', 'Unknown'),
            'subject': headers.get('Subject', 'No Subject'),
            'date': headers.get('Date', ''),
            'snippet': msg_data.get('snippet', '')[:100]
        })

    return {"unread": len(messages), "messages": output}

def gmail_send(to, subject, body):
    """Send Gmail message"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('gmail', 'v1', creds)

    import base64
    from email.mime.text import MIMEText
    from email.mime.multipart import MIMEMultipart

    message = MIMEMultipart()
    message['to'] = to
    message['subject'] = subject
    message.attach(MIMEText(body, 'plain'))

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    sent = service.users().messages().send(
        userId='me',
        body={'raw': raw}
    ).execute()

    return {"success": True, "id": sent['id'], "to": to}

# Calendar functions
def calendar_list_events(days=7):
    """List calendar events"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('calendar', 'v3', creds)

    now = datetime.utcnow().isoformat() + 'Z'
    time_max = (datetime.utcnow() + timedelta(days=days)).isoformat() + 'Z'

    events_result = service.events().list(
        calendarId='primary',
        timeMin=now,
        timeMax=time_max,
        singleEvents=True,
        orderBy='startTime'
    ).execute()

    events = events_result.get('items', [])
    output = []

    for event in events:
        start = event.get('start', {}).get('dateTime', event.get('start', {}).get('date', ''))
        end = event.get('end', {}).get('dateTime', event.get('end', {}).get('date', ''))
        output.append({
            'id': event['id'],
            'summary': event.get('summary', 'No title'),
            'start': start,
            'end': end,
            'location': event.get('location', ''),
            'description': event.get('description', '')[:100] if event.get('description') else ''
        })

    return {"count": len(events), "events": output}

def calendar_create_event(summary, start, end=None, description=None, location=None):
    """Create calendar event"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('calendar', 'v3', creds)

    if not end:
        # Default 1 hour duration
        if 'T' in start:
            end = (datetime.fromisoformat(start.replace('Z', '')) + timedelta(hours=1)).isoformat() + 'Z'
        else:
            # All-day event
            end = start

    event = {
        'summary': summary,
        'start': {'dateTime': start} if 'T' in start else {'date': start},
        'end': {'dateTime': end} if 'T' in end else {'date': end}
    }

    if description:
        event['description'] = description
    if location:
        event['location'] = location

    created = service.events().insert(calendarId='primary', body=event).execute()

    return {"success": True, "id": created['id'], "summary": summary, "link": created.get('htmlLink')}

# Drive functions
def drive_list_files(limit=20, query=None):
    """List Drive files"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('drive', 'v3', creds)

    if not query:
        query = "trashed=false"

    results = service.files().list(
        q=query,
        pageSize=limit,
        fields="nextPageToken, files(id, name, mimeType, createdTime, modifiedTime, size, webViewLink)"
    ).execute()

    files = results.get('files', [])
    return {"count": len(files), "files": files}

def drive_search(query, limit=10):
    """Search Drive files"""
    return drive_list_files(limit, f"name contains '{query}' and trashed=false")

# Sheets functions
def sheets_read(spreadsheet_id, range_name):
    """Read spreadsheet data"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('sheets', 'v4', creds)

    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=range_name
    ).execute()

    values = result.get('values', [])
    return {"range": range_name, "rows": len(values), "data": values}

def sheets_write(spreadsheet_id, range_name, values):
    """Write to spreadsheet"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('sheets', 'v4', creds)

    body = {
        'values': values
    }

    result = service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption='RAW',
        body=body
    ).execute()

    return {"success": True, "updatedRows": result.get('updatedRows')}

def sheets_append(spreadsheet_id, range_name, values):
    """Append to spreadsheet"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('sheets', 'v4', creds)

    body = {
        'values': values
    }

    result = service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=range_name,
        valueInputOption='RAW',
        insertDataOption='INSERT_ROWS',
        body=body
    ).execute()

    return {"success": True, "updates": result.get('updates', {})}

# Docs functions
def docs_read(document_id):
    """Read document content"""
    creds = load_credentials()
    if not creds:
        return {"error": "Not authorized"}

    service = get_service('docs', 'v1', creds)

    doc = service.documents().get(documentId=document_id).execute()

    # Extract text from document
    text_content = []
    for element in doc.get('body', {}).get('content', []):
        if 'paragraph' in element:
            for run in element['paragraph'].get('elements', []):
                if 'textRun' in run:
                    text_content.append(run['textRun']['content'])

    return {"id": document_id, "title": doc.get('title', ''), "content": ''.join(text_content)}

# Main CLI
def main():
    parser = argparse.ArgumentParser(description='Google Workspace Tool')
    subparsers = parser.add_subparsers(dest='service', help='Service to use')

    # Gmail
    gmail_parser = subparsers.add_parser('gmail', help='Gmail operations')
    gmail_subparsers = gmail_parser.add_subparsers(dest='action')

    gmail_list = gmail_subparsers.add_parser('list', help='List unread emails')
    gmail_list.add_argument('--limit', type=int, default=10, help='Number of emails')

    gmail_send_parser = gmail_subparsers.add_parser('send', help='Send email')
    gmail_send_parser.add_argument('--to', required=True, help='Recipient email')
    gmail_send_parser.add_argument('--subject', required=True, help='Email subject')
    gmail_send_parser.add_argument('--body', required=True, help='Email body')

    # Calendar
    cal_parser = subparsers.add_parser('calendar', help='Calendar operations')
    cal_subparsers = cal_parser.add_subparsers(dest='action')

    cal_list = cal_subparsers.add_parser('list', help='List calendar events')
    cal_list.add_argument('--days', type=int, default=7, help='Number of days')

    cal_create = cal_subparsers.add_parser('create', help='Create event')
    cal_create.add_argument('--summary', required=True, help='Event title')
    cal_create.add_argument('--start', required=True, help='Start time (ISO format)')
    cal_create.add_argument('--end', help='End time (ISO format)')
    cal_create.add_argument('--description', help='Event description')
    cal_create.add_argument('--location', help='Event location')

    # Drive
    drive_parser = subparsers.add_parser('drive', help='Drive operations')
    drive_subparsers = drive_parser.add_subparsers(dest='action')

    drive_list_cmd = drive_subparsers.add_parser('list', help='List files')
    drive_list_cmd.add_argument('--limit', type=int, default=20)

    drive_search_cmd = drive_subparsers.add_parser('search', help='Search files')
    drive_search_cmd.add_argument('--query', required=True, help='Search query')
    drive_search_cmd.add_argument('--limit', type=int, default=10)

    # Sheets
    sheets_parser = subparsers.add_parser('sheets', help='Sheets operations')
    sheets_subparsers = sheets_parser.add_subparsers(dest='action')

    sheets_read_cmd = sheets_subparsers.add_parser('read', help='Read spreadsheet')
    sheets_read_cmd.add_argument('--id', required=True, help='Spreadsheet ID')
    sheets_read_cmd.add_argument('--range', required=True, help='Range (e.g., Sheet1!A1:B10)')

    sheets_write_cmd = sheets_subparsers.add_parser('write', help='Write to spreadsheet')
    sheets_write_cmd.add_argument('--id', required=True, help='Spreadsheet ID')
    sheets_write_cmd.add_argument('--range', required=True, help='Range')
    sheets_write_cmd.add_argument('--data', required=True, help='JSON data array')

    sheets_append_cmd = sheets_subparsers.add_parser('append', help='Append to spreadsheet')
    sheets_append_cmd.add_argument('--id', required=True, help='Spreadsheet ID')
    sheets_append_cmd.add_argument('--range', required=True, help='Range')
    sheets_append_cmd.add_argument('--data', required=True, help='JSON data array')

    # Docs
    docs_parser = subparsers.add_parser('docs', help='Docs operations')
    docs_subparsers = docs_parser.add_subparsers(dest='action')

    docs_read_cmd = docs_subparsers.add_parser('read', help='Read document')
    docs_read_cmd.add_argument('--id', required=True, help='Document ID')

    args = parser.parse_args()

    if not args.service:
        parser.print_help()
        return

    result = {}

    # Execute commands
    if args.service == 'gmail':
        if args.action == 'list':
            result = gmail_list_unread(args.limit)
        elif args.action == 'send':
            result = gmail_send(args.to, args.subject, args.body)

    elif args.service == 'calendar':
        if args.action == 'list':
            result = calendar_list_events(args.days)
        elif args.action == 'create':
            result = calendar_create_event(args.summary, args.start, args.end, args.description, args.location)

    elif args.service == 'drive':
        if args.action == 'list':
            result = drive_list_files(args.limit)
        elif args.action == 'search':
            result = drive_search(args.query, args.limit)

    elif args.service == 'sheets':
        if args.action == 'read':
            result = sheets_read(args.id, args.range)
        elif args.action == 'write':
            data = json.loads(args.data)
            result = sheets_write(args.id, args.range, data)
        elif args.action == 'append':
            data = json.loads(args.data)
            result = sheets_append(args.id, args.range, data)

    elif args.service == 'docs':
        if args.action == 'read':
            result = docs_read(args.id)

    print(json.dumps(result, indent=2, ensure_ascii=False))

if __name__ == '__main__':
    main()