import requests
import json
import time
from typing import List, Dict, Optional
from pathlib import Path

class OzonAPI:
    """Ozon Seller API client for product and pricing operations."""
    
    def __init__(self, client_id: str, api_key: str, sandbox: bool = False, 
                 rate_limit_buffer: float = 0.8):
        """
        Initialize Ozon API client.
        
        Args:
            client_id: Client ID from Ozon Seller Cabinet
            api_key: API Key from Ozon Seller Cabinet
            sandbox: Use sandbox environment for testing
            rate_limit_buffer: Buffer for rate limiting (0-1, 0.8 = 80% of limit)
        """
        self.client_id = client_id
        self.api_key = api_key
        self.sandbox = sandbox
        self.rate_limit_buffer = rate_limit_buffer
        
        if sandbox:
            self.base_url = "https://api-seller-portal.ozon.ru"
        else:
            self.base_url = "https://api-seller.ozon.ru"
        
        self.session = requests.Session()
        self._last_request_time = 0
        self._min_request_interval = 0.06  # ~1000 req/min * 0.8 buffer
    
    def _headers(self) -> Dict[str, str]:
        """Get standard headers for API requests."""
        return {
            "Client-Id": self.client_id,
            "Api-Key": self.api_key,
            "Content-Type": "application/json"
        }
    
    def _wait_for_rate_limit(self):
        """Wait to respect rate limits."""
        now = time.time()
        elapsed = now - self._last_request_time
        if elapsed < self._min_request_interval:
            time.sleep(self._min_request_interval - elapsed)
        self._last_request_time = time.time()
    
    def _request(self, method: str, endpoint: str, **kwargs) -> Dict:
        """
        Make API request with error handling and retries.
        
        Args:
            method: HTTP method (GET, POST, etc.)
            endpoint: API endpoint (without base URL)
            **kwargs: Additional arguments for requests
            
        Returns:
            Response JSON data
        """
        url = f"{self.base_url}{endpoint}"
        max_retries = kwargs.pop('max_retries', 3)
        
        for attempt in range(max_retries):
            try:
                self._wait_for_rate_limit()
                response = self.session.request(method, url, headers=self._headers(), **kwargs)
                
                if response.status_code == 200:
                    return response.json()
                elif response.status_code == 429:
                    retry_after = int(response.headers.get('Retry-After', 5))
                    time.sleep(retry_after)
                else:
                    error_data = response.json() if response.headers.get('Content-Type') == 'application/json' else {}
                    raise Exception(f"API Error {response.status_code}: {error_data.get('message', response.text)}")
                    
            except requests.exceptions.RequestException as e:
                if attempt == max_retries - 1:
                    raise Exception(f"Request failed after {max_retries} attempts: {str(e)}")
                time.sleep(2 ** attempt)
    
    def get_product_prices(self, offer_ids: List[str] = None, 
                          product_ids: List[int] = None,
                          limit: int = 1000) -> Dict:
        """
        Get current prices for products.
        
        ⚠ WARNING: Endpoint not verified - returns 404
        May need alternative endpoint or version.
        
        Args:
            offer_ids: List of offer IDs to filter
            product_ids: List of product IDs to filter
            limit: Maximum number of items to return
            
        Returns:
            Dictionary with product price data
        """
        endpoint = "/v2/product/info/prices"
        body = {
            "filter": {},
            "limit": limit
        }
        if offer_ids:
            body["filter"]["offer_id"] = offer_ids
        if product_ids:
            body["filter"]["product_id"] = product_ids
        
        return self._request("POST", endpoint, json=body)
    
    def update_prices(self, prices: List[Dict]) -> Dict:
        """
        Update prices for products.
        
        Args:
            prices: List of price update objects with structure:
                - offer_id: Product offer ID
                - price: New price (string, e.g., "900.00")
                - old_price: Original price for discount display (optional)
                - currency_code: Currency (default "RUB")
                - auto_action_enabled: Enable auto-pricing (string "true"/"false")
                
        Returns:
            Update response data
        """
        endpoint = "/v1/product/import/prices"
        body = {"prices": prices}
        
        # Validate and format prices
        for price in prices:
            if "currency_code" not in price:
                price["currency_code"] = "RUB"
            if "auto_action_enabled" not in price:
                price["auto_action_enabled"] = "false"
            if "price_strategy_enabled" not in price:
                price["price_strategy_enabled"] = "false"
        
        return self._request("POST", endpoint, json=body)
    
    def get_products(self, visibility: str = "ALL", limit: int = 1000, 
                     last_id: str = None) -> Dict:
        """
        Get list of products.
        
        ⚠ WARNING: Endpoint not verified - returns 404
        May need alternative endpoint or version.
        
        Args:
            visibility: Filter by visibility (ALL, VISIBLE, HIDDEN, EMPTY_STATE)
            limit: Maximum number of items to return
            last_id: Pagination token
            
        Returns:
            Dictionary with product list
        """
        endpoint = "/v2/product/list"
        body = {
            "filter": {"visibility": visibility},
            "limit": limit
        }
        if last_id:
            body["last_id"] = last_id
        
        return self._request("POST", endpoint, json=body)
    
    def get_product_info(self, offer_id: str = None, product_id: int = None) -> Dict:
        """
        Get detailed information about a specific product.
        
        Args:
            offer_id: Product offer ID
            product_id: Product ID
            
        Returns:
            Product details
        """
        endpoint = "/v2/product/info"
        body = {}
        if offer_id:
            body["offer_id"] = offer_id
        if product_id:
            body["product_id"] = product_id
        
        return self._request("POST", endpoint, json=body)
    
    def get_auto_action_settings(self) -> Dict:
        """Get current auto-pricing settings.
        
        ⚠ WARNING: Endpoint not verified - returns 404
        May need alternative endpoint or version.
        """
        endpoint = "/v2/auto-action/settings"
        return self._request("GET", endpoint)
    
    def set_auto_action_settings(self, settings: List[Dict]) -> Dict:
        """
        Update auto-pricing settings.
        
        ⚠ WARNING: Endpoint not verified - returns 404
        May need alternative endpoint or version.
        
        Args:
            settings: List of setting objects with structure:
                - offer_id: Product offer ID
                - auto_action_enabled: Enable auto-pricing
                - min_price: Minimum price
                - max_price: Maximum price
                - currency_code: Currency
                - price_strategy_enabled: Enable price strategy
                
        Returns:
            Update response data
        """
        endpoint = "/v2/auto-action/settings"
        body = {"setting_items": settings}
        
        # Validate settings
        for setting in settings:
            if "currency_code" not in setting:
                setting["currency_code"] = "RUB"
        
        return self._request("POST", endpoint, json=body)
    
    def get_analytics_data(self, date_from: str, date_to: str,
                          dimension: str = "day",
                          metrics: List[str] = None) -> Dict:
        """
        Get analytics/sales data.
        
        Args:
            date_from: Start date (YYYY-MM-DD)
            date_to: End date (YYYY-MM-DD)
            dimension: Time dimension (day, week, month)
            metrics: List of metrics (revenue, ordered_units, etc.)
            
        Returns:
            Analytics data
        """
        endpoint = "/v1/analytics/data"
        if metrics is None:
            metrics = ["revenue", "ordered_units", "delivered_units"]
        
        body = {
            "date_from": date_from,
            "date_to": date_to,
            "dimension": dimension,
            "metrics": metrics
        }
        
        return self._request("POST", endpoint, json=body)

def load_config(config_path: str = None) -> Dict:
    """
    Load Ozon API configuration.
    
    Args:
        config_path: Path to config file (default: workspace/ozon-creds/config.json)
        
    Returns:
        Configuration dictionary
    """
    if config_path is None:
        config_path = Path.home() / ".openclaw/workspace/ozon-creds/config.json"
    
    with open(config_path) as f:
        return json.load(f)

def load_strategy(strategy_path: str = None) -> Dict:
    """
    Load repricing strategy.
    
    Args:
        strategy_path: Path to strategy file (default: workspace/ozon-creds/strategy.json)
        
    Returns:
        Strategy dictionary
    """
    if strategy_path is None:
        strategy_path = Path.home() / ".openclaw/workspace/ozon-creds/strategy.json"
    
    with open(strategy_path) as f:
        return json.load(f)

# Convenience function to create API client
def create_api_client(config_path: str = None) -> OzonAPI:
    """
    Create Ozon API client from config file.
    
    Args:
        config_path: Path to config file
        
    Returns:
        Configured OzonAPI instance
    """
    config = load_config(config_path)
    return OzonAPI(
        client_id=config['client_id'],
        api_key=config['api_key'],
        sandbox=config.get('sandbox', False),
        rate_limit_buffer=config.get('rate_limit_buffer', 0.8)
    )