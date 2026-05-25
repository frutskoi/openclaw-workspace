# Google Workspace Skill

Full Google Workspace integration for OpenClaw with OAuth2 authorization.

## Services

- **Gmail**: Read unread emails, send emails
- **Calendar**: List events, create events
- **Drive**: List files, search files
- **Sheets**: Read, write, append data
- **Docs**: Read document content
- **Apps Script**: Full project access

## Setup

### 1. First-time Authorization

The skill uses OAuth2 with PKCE. Token is stored in `~/.openclaw/workspace/google-creds/token.json`.

Check if token exists:

```bash
test -f ~/.openclaw/workspace/google-creds/token.json && echo "✅ Authorized" || echo "❌ Need authorization"
```

If not authorized, start the OAuth flow:

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-oauth-server.py
```

This will:
1. Print an authorization URL
2. Start a local server on port 8080
3. Wait for the callback
4. Save the token automatically

### 2. Token Refresh

The token refreshes automatically when expired. Check token status:

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python -c "
import json, os
token_path = os.path.expanduser('~/.openclaw/workspace/google-creds/token.json')
if os.path.exists(token_path):
    with open(token_path) as f:
        data = json.load(f)
    print('Access token:', data.get('access_token', '')[:20] + '...')
    print('Refresh token:', '✅ Present' if data.get('refresh_token') else '❌ Missing')
    print('Expires in:', data.get('expires_in', 'unknown'))
else:
    print('❌ No token file')
"
```

## Usage

### Gmail

**List unread emails:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py gmail list --limit 10
```

**Send email:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py gmail send \
  --to "recipient@example.com" \
  --subject "Test Subject" \
  --body "Email body text"
```

### Calendar

**List upcoming events:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py calendar list --days 7
```

**Create event:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py calendar create \
  --summary "Meeting with Team" \
  --start "2026-05-26T10:00:00Z" \
  --end "2026-05-26T11:00:00Z" \
  --location "Google Meet" \
  --description "Weekly sync"
```

### Drive

**List files:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py drive list --limit 20
```

**Search files:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py drive search --query "project report" --limit 10
```

### Sheets

**Read spreadsheet:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py sheets read \
  --id "1BxiMvs0XRA5nFMdKvBdBZjGMUUqpt35" \
  --range "Sheet1!A1:D10"
```

**Write to spreadsheet:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py sheets write \
  --id "1BxiMvs0XRA5nFMdKvBdBZjGMUUqpt35" \
  --range "Sheet1!A1:B2" \
  --data '[["Name", "Age"], ["Alice", "30"]]'
```

**Append to spreadsheet:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py sheets append \
  --id "1BxiMvs0XRA5nFMdKvBdBZjGMUUqpt35" \
  --range "Sheet1!A:B" \
  --data '[["Bob", "25"]]'
```

### Docs

**Read document:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py docs read \
  --id "1BxiMvs0XRA5nFMdKvBdBZjGMUUqpt35"
```

## Scopes

The following Google API scopes are configured:

- `gmail.readonly` - Read Gmail messages
- `gmail.send` - Send Gmail messages
- `calendar` - Full calendar access
- `drive` - Full Drive access
- `spreadsheets` - Full Sheets access
- `documents` - Full Docs access
- `script.projects` - Apps Script project access

## Troubleshooting

**Token expired/invalid:**

```bash
rm ~/.openclaw/workspace/google-creds/token.json
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-oauth-server.py
```

**Python not found:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python --version
```

If venv doesn't exist:

```bash
python3 -m venv ~/.openclaw/venv
~/.openclaw/venv/bin/pip install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client requests
```

**Missing dependencies:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/pip install \
  google-auth \
  google-auth-oauthlib \
  google-auth-httplib2 \
  google-api-python-client \
  requests
```

## Integration Patterns

**Check authorization status:**

```bash
test -f ~/.openclaw/workspace/google-creds/token.json && echo "✅ Google Workspace: Authorized" || echo "❌ Google Workspace: Not authorized"
```

**Quick email check:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py gmail list --limit 5 | jq '.unread, .messages[] | select(.) | "\(.from): \(.subject)"' 2>/dev/null || echo "No unread emails"
```

**Today's calendar:**

```bash
cd ~/.openclaw/workspace && ~/.openclaw/venv/bin/python google-workspace.py calendar list --days 1 | jq '.events[] | "\(.start): \(.summary)"' 2>/dev/null || echo "No events today"
```

## File Locations

- Scripts: `~/.openclaw/workspace/google-workspace.py`, `google-oauth-server.py`
- Credentials: `~/.openclaw/workspace/google-creds/`
- Token: `~/.openclaw/workspace/google-creds/token.json`
- Client secret: `~/.openclaw/workspace/google-creds/client_secret.json`

## Security

- Token file contains refresh token - keep it private
- Client secret is specific to this project
- OAuth flow uses PKCE for security
- All API calls use HTTPS