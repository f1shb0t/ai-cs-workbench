"""Review CRUD handlers."""

import json
import logging

import db
import models
from aihelp_client import AIHelpClient
from bedrock_client import query_knowledge_base
from utils import now_ms, success, error, extract_username

logger = logging.getLogger(__name__)


def list_reviews(event: dict) -> dict:
    """List reviews with optional status filter."""
    params = event.get("queryStringParameters") or {}
    status = params.get("status", "")
    page_size = int(params.get("pageSize", "50"))

    if status and status != "all":
        items, last_key = db.query_tickets_by_status(status, limit=page_size)
    else:
        items, last_key = db.scan_tickets(limit=page_size)

    return success({
        "items": items,
        "hasMore": last_key is not None,
    })


def get_ticket_reviews(event: dict) -> dict:
    """Get all conversation records for a ticket."""
    ticket_id = event.get("pathParameters", {}).get("ticketId", "")
    if not ticket_id:
        return error(400, "Missing ticketId")

    conversations = db.get_ticket_conversations(ticket_id)
    ticket = db.get_ticket(ticket_id)

    return success({
        "ticket": ticket,
        "conversations": conversations,
    })


def update_review(event: dict) -> dict:
    """Update a review (approve/reject/edit)."""
    ticket_id = event.get("pathParameters", {}).get("ticketId", "")
    timestamp_str = event.get("pathParameters", {}).get("timestamp", "")
    if not ticket_id or not timestamp_str:
        return error(400, "Missing ticketId or timestamp")

    try:
        timestamp = int(timestamp_str)
    except ValueError:
        return error(400, "Invalid timestamp")

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return error(400, "Invalid JSON body")

    username = extract_username(event)
    review_status = body.get("reviewStatus", "")
    edited_answer = body.get("editedAnswer")

    if review_status not in (models.APPROVED, models.EDITED, models.REJECTED):
        return error(400, f"Invalid reviewStatus: {review_status}")

    updates = {
        "reviewStatus": review_status,
        "reviewedBy": username,
        "reviewedAt": now_ms(),
    }
    if edited_answer is not None:
        updates["editedAnswer"] = edited_answer

    updated = db.update_conversation(ticket_id, timestamp, updates)

    # Update ticket status
    db.update_ticket(ticket_id, {"reviewStatus": review_status})

    return success(updated)


def send_reply(event: dict) -> dict:
    """Send approved reply to AIHelp."""
    ticket_id = event.get("pathParameters", {}).get("ticketId", "")
    if not ticket_id:
        return error(400, "Missing ticketId")

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        body = {}

    username = extract_username(event)
    timestamp = body.get("timestamp")

    # Get the conversation record
    if timestamp:
        conversation = db.get_conversation(ticket_id, int(timestamp))
    else:
        # Get the latest pending_review conversation
        conversations = db.get_ticket_conversations(ticket_id)
        conversation = None
        for c in reversed(conversations):
            if c.get("reviewStatus") in (models.PENDING_REVIEW, models.APPROVED, models.EDITED):
                conversation = c
                break

    if not conversation:
        return error(404, "No pending conversation found")

    # Determine the answer to send
    final_answer = conversation.get("editedAnswer") or conversation.get("aiAnswer", "")
    if not final_answer:
        return error(400, "No answer to send")

    # Get AIHelp config
    config = db.get_all_config()
    app_key = config.get("aihelp_app_key", "")
    secret_key = config.get("aihelp_secret_key", "")
    app_domain = config.get("aihelp_app_domain", "")
    customer_login_name = config.get("aihelp_customer_login_name", "ai-assistant")

    if not all([app_key, secret_key, app_domain]):
        return error(400, "AIHelp not configured. Please set appKey, secretKey, and appDomain in settings.")

    # Send via AIHelp API
    client = AIHelpClient(app_key, secret_key, app_domain)
    try:
        result = client.reply_ticket(ticket_id, final_answer, customer_login_name)
        if result.get("flag") and result.get("code") == 200:
            # Update conversation
            conv_timestamp = int(conversation["timestamp"])
            db.update_conversation(ticket_id, conv_timestamp, {
                "reviewStatus": models.SENT,
                "sentAnswer": final_answer,
                "sentAt": now_ms(),
                "sendStatus": "success",
                "reviewedBy": username,
                "reviewedAt": now_ms(),
            })
            db.update_ticket(ticket_id, {"reviewStatus": models.SENT})
            return success({"sent": True, "ticketId": ticket_id})
        else:
            error_msg = result.get("message", "Unknown error")
            db.update_conversation(ticket_id, int(conversation["timestamp"]), {
                "reviewStatus": models.SEND_FAILED,
                "sendStatus": "failed",
                "sendError": error_msg,
            })
            return error(500, f"AIHelp reply failed: {error_msg}")

    except Exception as e:
        logger.error(f"Failed to send reply: {e}")
        db.update_conversation(ticket_id, int(conversation["timestamp"]), {
            "sendStatus": "failed",
            "sendError": str(e),
        })
        return error(500, f"Failed to send reply: {str(e)}")


def regenerate_answer(event: dict) -> dict:
    """Re-generate AI answer for a ticket."""
    ticket_id = event.get("pathParameters", {}).get("ticketId", "")
    if not ticket_id:
        return error(400, "Missing ticketId")

    # Get the latest player message
    conversations = db.get_ticket_conversations(ticket_id)
    player_message = ""
    for c in reversed(conversations):
        if c.get("playerMessage"):
            player_message = c["playerMessage"]
            break

    if not player_message:
        return error(400, "No player message found to regenerate from")

    config = db.get_all_config()
    ai_result = query_knowledge_base(
        question=player_message,
        kb_id=config.get("knowledge_base_id"),
        model_id=config.get("model_id"),
        system_prompt=config.get("system_prompt"),
    )

    # Save as new conversation record
    conversation = {
        "ticketId": ticket_id,
        "timestamp": now_ms(),
        "source": "manual",
        "webhookEvent": "regenerate",
        "playerMessage": player_message,
        "aiAnswer": ai_result["answer"],
        "aiSources": ai_result["sources"],
        "retrievedChunks": ai_result["retrieved_chunks"],
        "aiLatencyMs": ai_result["latency_ms"],
        "aiModel": config.get("model_id", ""),
        "aiKbId": config.get("knowledge_base_id", ""),
        "reviewStatus": models.PENDING_REVIEW,
    }
    db.put_conversation(conversation)
    db.update_ticket(ticket_id, {
        "latestAiAnswer": ai_result["answer"][:500],
        "reviewStatus": models.PENDING_REVIEW,
    })

    return success(conversation)
