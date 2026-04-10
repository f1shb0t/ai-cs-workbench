"""DynamoDB operations for conversations, tickets, and config tables."""

import os
import logging
from typing import Any
from decimal import Decimal

import boto3
from boto3.dynamodb.conditions import Key, Attr

logger = logging.getLogger(__name__)

dynamodb = boto3.resource("dynamodb")

CONVERSATIONS_TABLE = os.environ.get("CONVERSATIONS_TABLE", "ai-cs-conversations")
CONFIG_TABLE = os.environ.get("CONFIG_TABLE", "ai-cs-config")
TICKETS_TABLE = os.environ.get("TICKETS_TABLE", "ai-cs-tickets")

conversations_table = dynamodb.Table(CONVERSATIONS_TABLE)
config_table = dynamodb.Table(CONFIG_TABLE)
tickets_table = dynamodb.Table(TICKETS_TABLE)


def _sanitize(obj: Any) -> Any:
    """Convert floats to Decimal for DynamoDB, remove None values."""
    if isinstance(obj, float):
        return Decimal(str(obj))
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items() if v is not None}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj


# ==================== Conversations ====================

def put_conversation(item: dict) -> None:
    """Insert a conversation record."""
    conversations_table.put_item(Item=_sanitize(item))


def get_conversation(ticket_id: str, timestamp: int) -> dict | None:
    """Get a single conversation record."""
    resp = conversations_table.get_item(Key={"ticketId": ticket_id, "timestamp": timestamp})
    return resp.get("Item")


def get_ticket_conversations(ticket_id: str) -> list[dict]:
    """Get all conversation records for a ticket, sorted by time."""
    resp = conversations_table.query(
        KeyConditionExpression=Key("ticketId").eq(ticket_id),
        ScanIndexForward=True,
    )
    return resp.get("Items", [])


def query_conversations_by_status(
    status: str,
    limit: int = 50,
    last_key: dict | None = None,
) -> tuple[list[dict], dict | None]:
    """Query conversations by review status using GSI."""
    kwargs: dict[str, Any] = {
        "IndexName": "status-index",
        "KeyConditionExpression": Key("reviewStatus").eq(status),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if last_key:
        kwargs["ExclusiveStartKey"] = last_key
    resp = conversations_table.query(**kwargs)
    return resp.get("Items", []), resp.get("LastEvaluatedKey")


def update_conversation(ticket_id: str, timestamp: int, updates: dict) -> dict:
    """Update specific fields on a conversation record."""
    expr_parts = []
    expr_names = {}
    expr_values = {}
    for key, value in updates.items():
        safe_key = f"#{key}"
        expr_parts.append(f"{safe_key} = :{key}")
        expr_names[safe_key] = key
        expr_values[f":{key}"] = _sanitize(value)

    resp = conversations_table.update_item(
        Key={"ticketId": ticket_id, "timestamp": timestamp},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes", {})


# ==================== Tickets (denormalized) ====================

def put_ticket(item: dict) -> None:
    """Insert or update a ticket record."""
    tickets_table.put_item(Item=_sanitize(item))


def get_ticket(ticket_id: str) -> dict | None:
    """Get a ticket record."""
    resp = tickets_table.get_item(Key={"ticketId": ticket_id})
    return resp.get("Item")


def update_ticket(ticket_id: str, updates: dict) -> dict:
    """Update specific fields on a ticket."""
    expr_parts = []
    expr_names = {}
    expr_values = {}
    for key, value in updates.items():
        safe_key = f"#{key}"
        expr_parts.append(f"{safe_key} = :{key}")
        expr_names[safe_key] = key
        expr_values[f":{key}"] = _sanitize(value)

    resp = tickets_table.update_item(
        Key={"ticketId": ticket_id},
        UpdateExpression="SET " + ", ".join(expr_parts),
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
        ReturnValues="ALL_NEW",
    )
    return resp.get("Attributes", {})


def query_tickets_by_status(
    status: str,
    limit: int = 50,
    last_key: dict | None = None,
) -> tuple[list[dict], dict | None]:
    """Query tickets by review status."""
    kwargs: dict[str, Any] = {
        "IndexName": "status-birthTime-index",
        "KeyConditionExpression": Key("reviewStatus").eq(status),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if last_key:
        kwargs["ExclusiveStartKey"] = last_key
    resp = tickets_table.query(**kwargs)
    return resp.get("Items", []), resp.get("LastEvaluatedKey")


def scan_tickets(limit: int = 50, last_key: dict | None = None) -> tuple[list[dict], dict | None]:
    """Scan all tickets (for 'all' tab)."""
    kwargs: dict[str, Any] = {"Limit": limit}
    if last_key:
        kwargs["ExclusiveStartKey"] = last_key
    resp = tickets_table.scan(**kwargs)
    items = sorted(resp.get("Items", []), key=lambda x: x.get("birthTime", 0), reverse=True)
    return items, resp.get("LastEvaluatedKey")


# ==================== Config ====================

def get_config(key: str) -> Any:
    """Get a config value."""
    resp = config_table.get_item(Key={"configKey": key})
    item = resp.get("Item")
    return item.get("value") if item else None


def put_config(key: str, value: Any) -> None:
    """Set a config value."""
    config_table.put_item(Item=_sanitize({"configKey": key, "value": value}))


def get_all_config() -> dict:
    """Get all config values as a dict."""
    resp = config_table.scan()
    result = {}
    for item in resp.get("Items", []):
        result[item["configKey"]] = item.get("value")
    return result


# ==================== Stats ====================

def count_conversations_today() -> dict:
    """Count today's conversations by status. Uses scan (ok for moderate volume)."""
    import time
    from datetime import datetime, timezone

    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_start_ms = int(today_start.timestamp() * 1000)

    resp = conversations_table.scan(
        FilterExpression=Attr("timestamp").gte(today_start_ms),
    )
    items = resp.get("Items", [])

    stats = {"total": 0, "approved": 0, "edited": 0, "rejected": 0, "pending": 0}
    total_latency = 0
    latency_count = 0

    for item in items:
        stats["total"] += 1
        status = item.get("reviewStatus", "")
        if status in ("approved", "sent"):
            stats["approved"] += 1
        elif status == "edited":
            stats["edited"] += 1
        elif status == "rejected":
            stats["rejected"] += 1
        elif status == "pending_review":
            stats["pending"] += 1

        if item.get("aiLatencyMs"):
            total_latency += int(item["aiLatencyMs"])
            latency_count += 1

    stats["adoption_rate"] = round(
        (stats["approved"] + stats["edited"]) / stats["total"] * 100, 1
    ) if stats["total"] > 0 else 0
    stats["avg_latency_ms"] = round(total_latency / latency_count) if latency_count > 0 else 0

    return stats
