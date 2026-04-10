"""Utility functions."""

import json
import decimal
import time
from typing import Any


class DecimalEncoder(json.JSONEncoder):
    """JSON encoder that handles Decimal types from DynamoDB."""
    def default(self, obj: Any) -> Any:
        if isinstance(obj, decimal.Decimal):
            if obj % 1 == 0:
                return int(obj)
            return float(obj)
        return super().default(obj)


def json_dumps(obj: Any) -> str:
    """JSON serialize with Decimal support."""
    return json.dumps(obj, cls=DecimalEncoder, ensure_ascii=False)


def now_ms() -> int:
    """Current UTC timestamp in milliseconds."""
    return int(time.time() * 1000)


def api_response(status_code: int, body: Any, headers: dict | None = None) -> dict:
    """Build API Gateway HTTP API response."""
    resp_headers = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type,Authorization",
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    }
    if headers:
        resp_headers.update(headers)
    return {
        "statusCode": status_code,
        "headers": resp_headers,
        "body": json_dumps(body),
    }


def success(data: Any = None, message: str = "ok") -> dict:
    """200 success response."""
    return api_response(200, {"code": 200, "message": message, "data": data})


def error(status_code: int, message: str) -> dict:
    """Error response."""
    return api_response(status_code, {"code": status_code, "message": message, "data": None})


def extract_username(event: dict) -> str:
    """Extract username from Cognito JWT claims in API Gateway event."""
    try:
        claims = event.get("requestContext", {}).get("authorizer", {}).get("jwt", {}).get("claims", {})
        return claims.get("cognito:username", claims.get("sub", "unknown"))
    except Exception:
        return "unknown"
