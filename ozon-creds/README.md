# Ozon Credentials Setup

**IMPORTANT:** This file should NEVER be committed to git or shared publicly.

## How to Get Credentials

1. Go to [Ozon Seller Cabinet](https://seller-edu.ozon.ru/)
2. Navigate to **Settings** → **API keys**
3. Click **Generate new key**
4. Copy:
   - **Client ID** (длинный ID)
   - **API Key** (секретный ключ)

## Store Credentials

Add them to `~/.openclaw/workspace/ozon-creds/config.json`:

```json
{
  "client_id": "YOUR_CLIENT_ID_HERE",
  "api_key": "YOUR_API_KEY_HERE",
  "sandbox": false
}
```

## Security

- ✅ This file is in .gitignore (we'll add it)
- ✅ Never share credentials
- ✅ Rotate keys periodically
- ✅ Use separate keys for different environments

## Required Scopes

Make sure your API key has permissions for:
- `read_all` - Read products, prices, orders
- `write_all` - Update prices, settings
- `analytics` - Access reports (optional)

## Testing

Test credentials with:

```bash
python3 -c "
from skills.ozon_api import OzonAPI
import json

# Load credentials
with open('/home/clawd/.openclaw/workspace/ozon-creds/config.json') as f:
    creds = json.load(f)

# Test connection
api = OzonAPI(creds['client_id'], creds['api_key'])
products = api.get_products(limit=1)
print('✓ API connection successful')
print(f'Products found: {len(products.get(\"result\", {}).get(\"items\", []))}')
"
```