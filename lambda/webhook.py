"""Webhook handler for AIHelp events."""

import json
import logging
from typing import Any

import db
import models
from bedrock_client import query_knowledge_base
from utils import now_ms, success, error

logger = logging.getLogger(__name__)


def handle_webhook(event: dict) -> dict:
    """Process incoming AIHelp webhook events."""
    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return error(400, "Invalid JSON body")

    webhook_event = body.get("event", "")
    data = body.get("data", {})
    event_time = body.get("eventTime", now_ms())

    logger.info(f"Received webhook: {webhook_event}, ticketId: {data.get('ticketId', 'N/A')}")

    if webhook_event == models.EVENT_TICKET_CREATE:
        return _handle_ticket_create(data, event_time)
    elif webhook_event == models.EVENT_TICKET_NEW_MESSAGE:
        return _handle_new_message(data, event_time)
    elif webhook_event == models.EVENT_TICKET_REPLY:
        return _handle_ticket_reply(data, event_time)
    elif webhook_event == models.EVENT_TICKET_CLOSE:
        return _handle_ticket_close(data, event_time)
    elif webhook_event == models.EVENT_TICKET_EVALUATE:
        return _handle_ticket_evaluate(data, event_time)
    else:
        logger.info(f"Unhandled webhook event: {webhook_event}")
        return success({"received": True})


def _extract_player_message(data: dict) -> str:
    """Extract player message text from webhook data."""
    messages = data.get("messages", [])
    if not messages:
        # ticketNewMessage uses singular 'message'
        message = data.get("message", {})
        if isinstance(message, dict):
            msg_data = message.get("data", "")
            return msg_data if isinstance(msg_data, str) else str(msg_data)
        return ""

    # ticketCreate uses 'messages' array
    text_parts = []
    for msg in messages:
        if isinstance(msg, dict):
            msg_type = msg.get("type", "content")
            msg_data = msg.get("data", "")
            if msg_type == "content" and isinstance(msg_data, str):
                text_parts.append(msg_data.strip())
            elif msg_type == "form":
                text_parts.append(f"{msg.get('field', '')}: {msg_data}")

    return "\n".join(text_parts) if text_parts else ""


def _handle_ticket_create(data: dict, event_time: int) -> dict:
    """Handle new ticket creation."""
    ticket_id = data.get("ticketId", "")
    if not ticket_id:
        return error(400, "Missing ticketId")

    player_message = _extract_player_message(data)
    if not player_message:
        logger.warning(f"No player message in ticketCreate for {ticket_id}")
        return success({"received": True, "skipped": "no_message"})

    # Get config for auto-generate
    config = db.get_all_config()
    auto_generate = config.get("auto_generate_enabled", True)

    # Save ticket info
    ticket_info = {
        "ticketId": ticket_id,
        "userId": data.get("userId", ""),
        "userDisplayName": data.get("userDisplayName", ""),
        "platform": data.get("source", ""),
        "language": "",
        "tags": data.get("tags", []),
        "status": data.get("status", models.AIHELP_STATUS_NEW),
        "birthTime": data.get("createTime", event_time),
        "latestPlayerMessage": player_message[:500],
        "reviewStatus": models.PENDING_REVIEW if auto_generate else "awaiting",
        "conversationCount": 1,
    }
    db.put_ticket(ticket_info)

    # Generate AI answer if auto-generate is enabled
    ai_result = {"answer": "", "sources": [], "latency_ms": 0}
    if auto_generate:
        ai_result = query_knowledge_base(
            question=player_message,
            kb_id=config.get("bedrock_kb_id"),
            model_id=config.get("bedrock_model_id"),
            system_prompt=config.get("system_prompt"),
        )

    # Save conversation record
    conversation = {
        "ticketId": ticket_id,
        "timestamp": now_ms(),
        "source": "webhook",
        "webhookEvent": models.EVENT_TICKET_CREATE,
        "playerMessage": player_message,
        "playerUserId": data.get("userId", ""),
        "playerName": data.get("userDisplayName", ""),
        "platform": data.get("source", ""),
        "tags": data.get("tags", []),
        "aiAnswer": ai_result["answer"],
        "aiSources": ai_result["sources"],
        "aiLatencyMs": ai_result["latency_ms"],
        "aiModel": config.get("bedrock_model_id", ""),
        "aiKbId": config.get("bedrock_kb_id", ""),
        "reviewStatus": models.PENDING_REVIEW if auto_generate and ai_result["answer"] else "no_answer",
    }
    db.put_conversation(conversation)

    # Update ticket with latest AI answer
    if ai_result["answer"]:
        db.update_ticket(ticket_id, {"latestAiAnswer": ai_result["answer"][:500]})

    logger.info(f"Processed ticketCreate: {ticket_id}, AI answer: {len(ai_result['answer'])} chars")
    return success({"received": True, "ticketId": ticket_id, "aiGenerated": bool(ai_result["answer"])})


def _handle_new_message(data: dict, event_time: int) -> dict:
    """Handle new player message on existing ticket."""
    ticket_id = data.get("ticketId", "")
    if not ticket_id:
        return error(400, "Missing ticketId")

    player_message = _extract_player_message(data)
    if not player_message:
        return success({"received": True, "skipped": "no_message"})

    config = db.get_all_config()
    auto_generate = config.get("auto_generate_enabled", True)

    ai_result = {"answer": "", "sources": [], "latency_ms": 0}
    if auto_generate:
        ai_result = query_knowledge_base(
            question=player_message,
            kb_id=config.get("bedrock_kb_id"),
            model_id=config.get("bedrock_model_id"),
            system_prompt=config.get("system_prompt"),
        )

    conversation = {
        "ticketId": ticket_id,
        "timestamp": now_ms(),
        "source": "webhook",
        "webhookEvent": models.EVENT_TICKET_NEW_MESSAGE,
        "playerMessage": player_message,
        "playerUserId": data.get("userId", ""),
        "playerName": data.get("userDisplayName", ""),
        "aiAnswer": ai_result["answer"],
        "aiSources": ai_result["sources"],
        "aiLatencyMs": ai_result["latency_ms"],
        "aiModel": config.get("bedrock_model_id", ""),
        "aiKbId": config.get("bedrock_kb_id", ""),
        "reviewStatus": models.PENDING_REVIEW if auto_generate and ai_result["answer"] else "no_answer",
    }
    db.put_conversation(conversation)

    # Update ticket
    updates = {
        "latestPlayerMessage": player_message[:500],
        "reviewStatus": models.PENDING_REVIEW,
        "status": data.get("status", models.AIHELP_STATUS_PENDING),
    }
    if ai_result["answer"]:
        updates["latestAiAnswer"] = ai_result["answer"][:500]

    existing = db.get_ticket(ticket_id)
    if existing:
        updates["conversationCount"] = int(existing.get("conversationCount", 0)) + 1
        db.update_ticket(ticket_id, updates)
    else:
        updates.update({"ticketId": ticket_id, "birthTime": event_time, "conversationCount": 1})
        db.put_ticket(updates)

    return success({"received": True, "ticketId": ticket_id})


def _handle_ticket_reply(data: dict, event_time: int) -> dict:
    """Track agent replies (for stats)."""
    ticket_id = data.get("ticketId", "")
    if ticket_id:
        db.update_ticket(ticket_id, {"status": data.get("status", models.AIHELP_STATUS_REPLIED)})
    return success({"received": True})


def _handle_ticket_close(data: dict, event_time: int) -> dict:
    """Handle ticket close."""
    ticket_id = data.get("ticketId", "")
    if ticket_id:
        db.update_ticket(ticket_id, {
            "status": data.get("status", models.AIHELP_STATUS_RESOLVED),
            "closeTime": data.get("closeTime", event_time),
        })
    return success({"received": True})


def _handle_ticket_evaluate(data: dict, event_time: int) -> dict:
    """Handle player evaluation."""
    ticket_id = data.get("ticketId", "")
    if ticket_id:
        db.update_ticket(ticket_id, {
            "playerRating": data.get("evaluateStar", 0),
            "playerFeedback": data.get("evaluate", ""),
        })
    return success({"received": True})
