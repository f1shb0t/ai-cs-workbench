"""Config management handler."""

import json
import logging

import db
from utils import success, error

logger = logging.getLogger(__name__)

# Config keys and their defaults
CONFIG_KEYS = {
    "aihelp_app_key": "",
    "aihelp_secret_key": "",
    "aihelp_app_domain": "",
    "aihelp_customer_login_name": "ai-assistant",
    "bedrock_kb_id": "",
    "bedrock_model_id": "anthropic.claude-3-haiku-20240307-v1:0",
    "system_prompt": "You are a professional game customer service assistant. Answer questions accurately and politely.",
    "temperature": 0.2,
    "max_tokens": 1024,
    "auto_generate_enabled": True,
    "auto_generate_tags": [],
}


def get_config(event: dict) -> dict:
    """Get all configuration values."""
    all_config = db.get_all_config()
    # Fill in defaults for missing keys
    result = {}
    for key, default in CONFIG_KEYS.items():
        result[key] = all_config.get(key, default)
    return success(result)


def update_config(event: dict) -> dict:
    """Update configuration values."""
    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return error(400, "Invalid JSON body")

    updated_keys = []
    for key, value in body.items():
        if key in CONFIG_KEYS:
            db.put_config(key, value)
            updated_keys.append(key)
        else:
            logger.warning(f"Unknown config key: {key}")

    return success({"updated": updated_keys})
