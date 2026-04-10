"""Lambda handler - API router for AI CS Workbench."""

import json
import logging

from utils import error

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def lambda_handler(event: dict, context) -> dict:
    """Route API Gateway HTTP API requests to appropriate handlers."""
    route_key = event.get("routeKey", "")
    raw_path = event.get("rawPath", "")
    method = event.get("requestContext", {}).get("http", {}).get("method", "")

    logger.info(f"Request: {method} {raw_path} (routeKey: {route_key})")

    try:
        # Webhook (no auth)
        if raw_path == "/webhook/aihelp" and method == "POST":
            from webhook import handle_webhook
            return handle_webhook(event)

        # Reviews
        if raw_path == "/reviews" and method == "GET":
            from review import list_reviews
            return list_reviews(event)

        if raw_path.startswith("/reviews/") and method == "GET":
            parts = raw_path.split("/")
            if len(parts) == 3:  # /reviews/{ticketId}
                from review import get_ticket_reviews
                return get_ticket_reviews(event)

        if raw_path.startswith("/reviews/") and method == "PATCH":
            from review import update_review
            return update_review(event)

        if raw_path.endswith("/send") and method == "POST":
            from review import send_reply
            return send_reply(event)

        if raw_path.endswith("/regenerate") and method == "POST":
            from review import regenerate_answer
            return regenerate_answer(event)

        # Config
        if raw_path == "/config" and method == "GET":
            from config_handler import get_config
            return get_config(event)

        if raw_path == "/config" and method == "PUT":
            from config_handler import update_config
            return update_config(event)

        # Dashboard
        if raw_path == "/dashboard/stats" and method == "GET":
            from dashboard import get_stats
            return get_stats(event)

        return error(404, f"Not found: {method} {raw_path}")

    except Exception as e:
        logger.exception(f"Unhandled error: {e}")
        return error(500, f"Internal server error: {str(e)}")
