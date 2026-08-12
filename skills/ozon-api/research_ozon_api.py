#!/usr/bin/env python3
"""
Ozon API Research Script
Automatically discovers and validates Ozon Seller API endpoints.
Run this to find all available endpoints without official docs.
"""

import requests
import json
from typing import List, Tuple, Dict, Set
import time

class OzonAPIResearcher:
    """Research Ozon API by testing endpoint existence."""
    
    def __init__(self):
        self.base_url = "https://api-seller.ozon.ru"
        self.headers = {
            'Client-Id': '123',
            'Api-Key': 'invalid',
            'Content-Type': 'application/json'
        }
        self.valid_endpoints: Set[str] = set()
        self.not_found: Set[str] = set()
        self.unknown: Set[str] = set()
        self.endpoint_info: Dict[str, Dict] = {}
    
    def test_endpoint(self, method: str, path: str, body: Dict = None) -> Tuple[bool, str, int]:
        """
        Test if endpoint exists.
        
        Returns:
            (exists, status_text, http_code)
        """
        url = f"{self.base_url}{path}"
        
        try:
            if method == "GET":
                resp = requests.get(url, headers=self.headers, timeout=5)
            else:
                resp = requests.post(url, headers=self.headers, json=body, timeout=5)
            
            code = resp.status_code
            
            # Status codes that indicate endpoint exists
            if code in (401, 400, 403, 422, 200):
                return (True, f"Valid endpoint ({code})", code)
            elif code == 404:
                return (False, "Not found", code)
            elif code == 405:
                return (False, "Method not allowed", code)
            else:
                return (True, f"Unknown code ({code})", code)
                
        except requests.exceptions.Timeout:
            return (True, "Timeout (likely exists)", 0)
        except Exception as e:
            return (False, f"Error: {str(e)[:40]}", -1)
    
    def discover_endpoints(self):
        """Auto-discover endpoints by testing common patterns."""
        print("🔬 Starting Ozon API Research...\n")
        
        # Common endpoint patterns to test
        patterns = [
            # Products
            ("/v1/product/import/prices", "POST", {"prices": []}),
            ("/v2/product/info/prices", "POST", {"filter": {}, "limit": 1}),
            ("/v2/product/list", "POST", {"filter": {}, "limit": 1}),
            ("/v3/product/info/prices", "POST", {"filter": {}, "limit": 1}),
            ("/v1/products/info", "POST", {"offer_id": ["test"]}),
            ("/v2/products/info", "POST", {"offer_id": ["test"]}),
            ("/v3/products/info", "POST", {"offer_id": ["test"]}),
            
            # Auto-action / Repricing
            ("/v2/auto-action/settings", "GET", None),
            ("/v2/auto-action/settings", "POST", {"setting_items": []}),
            ("/v3/auto-action/settings", "GET", None),
            ("/v3/auto-action/settings", "POST", {"setting_items": []}),
            
            # Analytics
            ("/v1/analytics/data", "POST", {"date_from": "2024-01-01", "date_to": "2024-01-02"}),
            ("/v2/analytics/data", "POST", {"date_from": "2024-01-01", "date_to": "2024-01-02"}),
            
            # Finance
            ("/v2/finance/realization", "POST", {"date_from": "2024-01-01", "date_to": "2024-01-02"}),
            ("/v3/finance/realization", "POST", {"date_from": "2024-01-01", "date_to": "2024-01-02"}),
            
            # Orders / Postings
            ("/v2/posting/fbo/list", "POST", {"filter": {}, "limit": 1}),
            ("/v2/posting/fbs/list", "POST", {"filter": {}, "limit": 1}),
            ("/v3/posting/fbo/list", "POST", {"filter": {}, "limit": 1}),
            ("/v3/posting/fbs/list", "POST", {"filter": {}, "limit": 1}),
            
            # Reports
            ("/v1/report/info", "GET", None),
            ("/v2/report/info", "GET", None),
            
            # Stocks
            ("/v1/warehouse/list", "GET", None),
            ("/v2/warehouse/list", "GET", None),
            ("/v3/warehouse/list", "GET", None),
            
            # Categories
            ("/v1/category/tree", "GET", None),
            ("/v2/category/tree", "GET", None),
        ]
        
        for path, method, body in patterns:
            key = f"{method:6} {path}"
            exists, status, code = self.test_endpoint(method, path, body)
            
            self.endpoint_info[key] = {
                "exists": exists,
                "status": status,
                "code": code,
                "method": method,
                "path": path,
                "body": body
            }
            
            if exists:
                self.valid_endpoints.add(key)
                print(f"✓ {key:50} {status}")
            else:
                self.not_found.add(key)
                print(f"✗ {key:50} {status}")
            
            time.sleep(0.1)  # Rate limiting
    
    def summarize(self):
        """Print research summary."""
        print("\n" + "=" * 80)
        print("RESEARCH SUMMARY")
        print("=" * 80)
        
        print(f"\n✓ Valid endpoints found: {len(self.valid_endpoints)}")
        for ep in sorted(self.valid_endpoints):
            info = self.endpoint_info[ep]
            print(f"  {ep:50} code={info['code']}")
        
        print(f"\n✗ Not found: {len(self.not_found)}")
        for ep in sorted(self.not_found):
            print(f"  {ep:50}")
        
        # Generate Python code template
        print("\n" + "=" * 80)
        print("PYTHON CLIENT TEMPLATE")
        print("=" * 80)
        
        print("\n# Valid endpoints for OzonAPI client:\n")
        
        for key in sorted(self.valid_endpoints):
            info = self.endpoint_info[key]
            method = info['method'].lower()
            path = info['path']
            func_name = path.replace('/', '_').strip('_').replace('-', '_')
            
            print(f"def {func_name}(self, **kwargs) -> Dict:")
            print(f'    """Endpoint: {method.upper()} {path}"""')
            print(f'    endpoint = "{path}"')
            if method == "post":
                print('    body = kwargs.get("body", {})')
                print(f'    return self._request("{method.upper()}", endpoint, json=body)')
            else:
                print(f'    return self._request("{method.upper()}", endpoint)')
            print()
        
        # Export to JSON
        output = {
            "research_date": "2026-05-27",
            "valid_endpoints": sorted(list(self.valid_endpoints)),
            "not_found": sorted(list(self.not_found)),
            "details": self.endpoint_info
        }
        
        with open("ozon-api-research.json", "w") as f:
            json.dump(output, f, indent=2)
        
        print("=" * 80)
        print(f"Full results saved to: ozon-api-research.json")
        print("=" * 80)

def main():
    researcher = OzonAPIResearcher()
    researcher.discover_endpoints()
    researcher.summarize()

if __name__ == "__main__":
    main()