"""Webhook handler for AIHelp events."""

import json
import logging
from typing import Any

import db
import apps as apps_mod
import models
from bedrock_client import query_knowledge_base
from utils import now_ms, success, error

logger = logging.getLogger(__name__)


def _resolve_app(data: dict, body: dict) -> dict | None:
    """Resolve the target app for this webhook.

    Uses apps.resolve_app_for_webhook with default_app_id from global config.
    """
    default_app_id = db.get_config("default_app_id") or None
    return apps_mod.resolve_app_for_webhook(data, body=body, default_app_id=default_app_id)


def handle_webhook(event: dict) -> dict:
    """Process incoming AIHelp webhook events."""
    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return error(400, "Invalid JSON body")

    webhook_event = body.get("event", "")
    data = body.get("data", {})
    event_time = body.get("eventTime", now_ms())

    # Resolve app once per webhook invocation
    app = _resolve_app(data, body)
    app_id = app.get("app_id") if app else ""

    logger.info(
        f"Received webhook: {webhook_event}, ticketId: {data.get('ticketId', 'N/A')}, appId: {app_id or 'UNRESOLVED'}"
    )

    if webhook_event == models.EVENT_TICKET_CREATE:
        return _handle_ticket_create(data, event_time, app)
    elif webhook_event == models.EVENT_TICKET_NEW_MESSAGE:
        return _handle_new_message(data, event_time, app)
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


def _load_global_ai_config() -> dict:
    """Load globals (model, prompt, auto_generate_enabled) from config table."""
    cfg = db.get_all_config()
    return {
        "model_id": cfg.get("model_id"),
        "system_prompt": cfg.get("system_prompt"),
        "auto_generate_enabled": cfg.get("auto_generate_enabled", True),
    }


def _handle_ticket_create(data: dict, event_time: int, app: dict | None) -> dict:
    """Handle new ticket creation."""
    ticket_id = data.get("ticketId", "")
    if not ticket_id:
        return error(400, "Missing ticketId")

    player_message = _extract_player_message(data)
    if not player_message:
        logger.warning(f"No player message in ticketCreate for {ticket_id}")
        return success({"received": True, "skipped": "no_message"})

    globals_cfg = _load_global_ai_config()
    auto_generate = bool(globals_cfg.get("auto_generate_enabled", True))
    kb_id = (app or {}).get("knowledge_base_id", "")
    app_id = (app or {}).get("app_id", "")
    app_name = (app or {}).get("app_name", "")

    ticket_info = {
        "ticketId": ticket_id,
        "appId": app_id,
        "appName": app_name,
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

    ai_result = {"answer": "", "sources": [], "retrieved_chunks": [], "latency_ms": 0, "session_id": ""}
    if auto_generate and kb_id:
        ai_result = query_knowledge_base(
            question=player_message,
            kb_id=kb_id,
            model_id=globals_cfg.get("model_id"),
            system_prompt=globals_cfg.get("system_prompt"),
        )
    elif auto_generate and not kb_id:
        logger.warning(f"No KB configured for app={app_id}; skipping AI generation")

    conversation = {
        "ticketId": ticket_id,
        "appId": app_id,
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
        "retrievedChunks": ai_result["retrieved_chunks"],
        "aiLatencyMs": ai_result["latency_ms"],
        "aiModel": globals_cfg.get("model_id", ""),
        "aiKbId": kb_id,
        "reviewStatus": models.PENDING_REVIEW if auto_generate and ai_result["answer"] else "no_answer",
    }
    db.put_conversation(conversation)

    ticket_updates: dict[str, Any] = {}
    if ai_result["answer"]:
        ticket_updates["latestAiAnswer"] = ai_result["answer"][:500]
    if ai_result.get("session_id"):
        ticket_updates["bedrockSessionId"] = ai_result["session_id"]
    if ticket_updates:
        db.update_ticket(ticket_id, ticket_updates)

    logger.info(f"Processed ticketCreate: {ticket_id}, app={app_id}, AI answer: {len(ai_result['answer'])} chars")
    return success({"received": True, "ticketId": ticket_id, "appId": app_id, "aiGenerated": bool(ai_result["answer"])})


def _handle_new_message(data: dict, event_time: int, app: dict | None) -> dict:
    """Handle new player message on existing ticket."""
    ticket_id = data.get("ticketId", "")
    if not ticket_id:
        return error(400, "Missing ticketId")

    player_message = _extract_player_message(data)
    if not player_message:
        return success({"received": True, "skipped": "no_message"})

    # Prefer the app stored on the existing ticket (keeps routing stable)
    existing = db.get_ticket(ticket_id)
    if existing and existing.get("appId"):
        ticket_app_id = existing.get("appId")
        ticket_app = apps_mod.find_app_by_id(ticket_app_id)
        if ticket_app:
            app = ticket_app

    globals_cfg = _load_global_ai_config()
    auto_generate = bool(globals_cfg.get("auto_generate_enabled", True))
    kb_id = (app or {}).get("knowledge_base_id", "")
    app_id = (app or {}).get("app_id", "")

    # Reuse Bedrock session for multi-turn context; fall back to local history
    session_id = (existing or {}).get("bedrockSessionId") or None
    history: list[dict] = []
    if not session_id:
        # First multi-turn call without a live session -> seed with local history
        prior = db.get_ticket_conversations(ticket_id)
        for conv in prior:
            pm = conv.get("playerMessage")
            if pm:
                history.append({"role": "user", "content": pm})
            reply = conv.get("sentAnswer") or conv.get("editedAnswer") or conv.get("aiAnswer")
            if reply and conv.get("reviewStatus") == models.SENT:
                history.append({"role": "assistant", "content": reply})

    ai_result = {"answer": "", "sources": [], "retrieved_chunks": [], "latency_ms": 0, "session_id": ""}
    if auto_generate and kb_id:
        ai_result = query_knowledge_base(
            question=player_message,
            kb_id=kb_id,
            model_id=globals_cfg.get("model_id"),
            system_prompt=globals_cfg.get("system_prompt"),
            session_id=session_id,
            conversation_history=history if history else None,
        )

    conversation = {
        "ticketId": ticket_id,
        "appId": app_id,
        "timestamp": now_ms(),
        "source": "webhook",
        "webhookEvent": models.EVENT_TICKET_NEW_MESSAGE,
        "playerMessage": player_message,
        "playerUserId": data.get("userId", ""),
        "playerName": data.get("userDisplayName", ""),
        "aiAnswer": ai_result["answer"],
        "aiSources": ai_result["sources"],
        "retrievedChunks": ai_result["retrieved_chunks"],
        "aiLatencyMs": ai_result["latency_ms"],
        "aiModel": globals_cfg.get("model_id", ""),
        "aiKbId": kb_id,
        "reviewStatus": models.PENDING_REVIEW if auto_generate and ai_result["answer"] else "no_answer",
    }
    db.put_conversation(conversation)

    updates = {
        "latestPlayerMessage": player_message[:500],
        "reviewStatus": models.PENDING_REVIEW,
        "status": data.get("status", models.AIHELP_STATUS_PENDING),
    }
    if ai_result["answer"]:
        updates["latestAiAnswer"] = ai_result["answer"][:500]
    if ai_result.get("session_id"):
        updates["bedrockSessionId"] = ai_result["session_id"]

    if existing:
        updates["conversationCount"] = int(existing.get("conversationCount", 0)) + 1
        db.update_ticket(ticket_id, updates)
    else:
        updates.update({
            "ticketId": ticket_id,
            "appId": app_id,
            "appName": (app or {}).get("app_name", ""),
            "birthTime": event_time,
            "conversationCount": 1,
        })
        db.put_ticket(updates)

    return success({"received": True, "ticketId": ticket_id, "appId": app_id})


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
