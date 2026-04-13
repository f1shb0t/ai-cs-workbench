"""AIHelp API client with HMAC_SHA256 signature."""

import hashlib
import hmac
import json
import time
import logging
from typing import Any
from urllib.parse import urlencode

import requests

logger = logging.getLogger(__name__)


class AIHelpClient:
    """Client for AIHelp OpenAPI with signature authentication."""

    def __init__(self, app_key: str, secret_key: str, app_domain: str):
        self.app_key = app_key
        self.secret_key = secret_key
        # Support full URL (http://... or https://...) or bare domain (legacy)
        if app_domain.startswith("http://") or app_domain.startswith("https://"):
            self.base_url = app_domain.rstrip("/")
        else:
            self.base_url = f"https://{app_domain}"

    def _sign(self, method: str, uri: str, query_string: str = "", payload: str = "") -> dict:
        """
        Generate signed headers per AIHelp OpenAPI signing docs.
        
        Algorithm:
        1. HashedRequestPayload = Lowercase(HexEncode(Hash.SHA256(RequestPayload)))
        2. CanonicalRequest = Method + "\n" + URI + "\n" + QueryString + "\n" + HashedRequestPayload
        3. StringToSign = timestamp + "\n" + Lowercase(HexEncode(Hash.SHA256(CanonicalRequest)))
        4. Signature = HexEncode(HMAC_SHA256(SecretKey, StringToSign))
        """
        timestamp = str(int(time.time() * 1000))

        # Step 1: Hash the request payload
        hashed_payload = hashlib.sha256(payload.encode("utf-8")).hexdigest().lower()

        # Step 2: Build canonical request
        canonical_request = f"{method}\n{uri}\n{query_string}\n{hashed_payload}"

        # Step 3: Build string to sign
        hashed_canonical = hashlib.sha256(canonical_request.encode("utf-8")).hexdigest().lower()
        string_to_sign = f"{timestamp}\n{hashed_canonical}"

        # Step 4: Calculate signature
        signature = hmac.new(
            self.secret_key.encode("utf-8"),
            string_to_sign.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        return {
            "Content-Type": "application/json; charset=utf-8",
            "appKey": self.app_key,
            "timestamp": timestamp,
            "sign": signature,
        }

    def _get(self, uri: str, params: dict | None = None) -> dict:
        """Make a signed GET request."""
        query_string = ""
        if params:
            # Sort by key for consistent signing
            sorted_params = sorted(params.items())
            query_string = "&".join(f"{k}={v}" for k, v in sorted_params)

        headers = self._sign("GET", uri, query_string=query_string, payload="")
        url = f"{self.base_url}{uri}"
        if query_string:
            url += f"?{query_string}"

        logger.info(f"AIHelp GET {url}")
        resp = requests.get(url, headers=headers, timeout=10)
        resp.raise_for_status()
        return resp.json()

    def _post(self, uri: str, body: dict) -> dict:
        """Make a signed POST request."""
        payload = json.dumps(body, ensure_ascii=False)
        headers = self._sign("POST", uri, query_string="", payload=payload)

        url = f"{self.base_url}{uri}"
        logger.info(f"AIHelp POST {url}")
        resp = requests.post(url, headers=headers, data=payload.encode("utf-8"), timeout=10)
        resp.raise_for_status()
        return resp.json()

    def reply_ticket(
        self,
        ticket_id: str,
        message: str,
        customer_login_name: str,
        extend_field: dict | None = None,
    ) -> dict:
        """Reply to a ticket via AIHelp API."""
        body: dict[str, Any] = {
            "ticketId": ticket_id,
            "messageList": [{"type": "content", "content": message}],
            "customerLoginName": customer_login_name,
        }
        if extend_field:
            body["extendField"] = extend_field

        return self._post("/open/api/v3/ticket/reply", body)

    def get_ticket_list(
        self,
        current_page: int = 1,
        page_size: int = 20,
        birth_time_start: int | None = None,
        birth_time_end: int | None = None,
        language_alias: str | None = None,
        platform: str | None = None,
    ) -> dict:
        """Get ticket list from AIHelp."""
        params: dict[str, Any] = {
            "currentPage": current_page,
            "pageSize": page_size,
        }
        if birth_time_start:
            params["birthTimeStart"] = birth_time_start
        if birth_time_end:
            params["birthTimeEnd"] = birth_time_end
        if language_alias:
            params["languageAlias"] = language_alias
        if platform:
            params["platform"] = platform

        return self._get("/open/api/v3.0/ticket/list", params)

    def get_ticket_details(self, ticket_id: str) -> dict:
        """Get ticket details from AIHelp."""
        return self._get("/open/api/v3.0/ticket/details", {"ticketId": ticket_id})
