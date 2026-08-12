#!/usr/bin/env python3
"""
Simple tool to add calendar events using Google Calendar API.
"""

import sys
import json
from datetime import datetime, timedelta
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from google.auth.transport.requests import Request

def load_credentials():
    """Load credentials from token.json"""
    try:
        with open('/home/clawd/.openclaw/workspace/google-creds/token.json', 'r') as f:
            creds_data = json.load(f)

        # Create Credentials object
        creds = Credentials(
            token=creds_data.get('token'),
            refresh_token=creds_data.get('refresh_token'),
            token_uri=creds_data.get('token_uri'),
            client_id=creds_data.get('client_id'),
            client_secret=creds_data.get('client_secret'),
            scopes=creds_data.get('scopes', [])
        )

        # Refresh if expired
        if creds.expired:
            creds.refresh(Request())
            # Save refreshed token
            creds_data['token'] = creds.token
            creds_data['expiry'] = creds.expiry.isoformat() if creds.expiry else None
            with open('/home/clawd/.openclaw/workspace/google-creds/token.json', 'w') as f:
                json.dump(creds_data, f, indent=2)

        return creds
    except Exception as e:
        print(f"Error loading credentials: {e}", file=sys.stderr)
        sys.exit(1)

def add_event(summary, start_time, end_time=None, description="", location="", timezone="Asia/Yekaterinburg"):
    """
    Add an event to Google Calendar.

    Args:
        summary: Event title
        start_time: datetime object
        end_time: datetime object (optional)
        description: Event description
        location: Event location
        timezone: Timezone for the event
    """
    creds = load_credentials()
    service = build('calendar', 'v3', credentials=creds)

    if end_time is None:
        end_time = start_time + timedelta(minutes=60)

    # Format times for Google Calendar API
    event = {
        'summary': summary,
        'start': {
            'dateTime': start_time.isoformat(),
            'timeZone': timezone,
        },
        'end': {
            'dateTime': end_time.isoformat(),
            'timeZone': timezone,
        },
    }

    if description:
        event['description'] = description
    if location:
        event['location'] = location

    try:
        event_result = service.events().insert(calendarId='primary', body=event).execute()
        print(f"✅ Event created: {event_result.get('htmlLink')}")
        return event_result
    except Exception as e:
        print(f"Error creating event: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Usage: python3 add_calendar.py <summary> [<end_time_minutes>]")
        print("Example: python3 add_calendar.py 'Meeting' 60")
        print("Time format: YYYY-MM-DD HH:MM (read from stdin)")
        sys.exit(1)

    summary = sys.argv[1]
    duration_minutes = int(sys.argv[2]) if len(sys.argv) > 2 else 60

    # Read time from stdin (format: YYYY-MM-DD HH:MM)
    import subprocess
    result = subprocess.run(['date', '+%Y-%m-%d %H:%M'], capture_output=True, text=True)
    current_time_str = result.stdout.strip()

    # If time is provided via stdin, use that
    import select
    if select.select([sys.stdin], [], [], 0.0)[0]:
        time_input = sys.stdin.read().strip()
        if time_input:
            current_time_str = time_input

    start_time = datetime.strptime(current_time_str, "%Y-%m-%d %H:%M")
    end_time = start_time + timedelta(minutes=duration_minutes)

    add_event(summary, start_time, end_time)