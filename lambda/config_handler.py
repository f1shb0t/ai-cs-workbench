"""Config management handler (multi-app aware)."""

import json
import logging

import db
import apps as apps_mod
from utils import success, error

logger = logging.getLogger(__name__)

ADMIN_GROUP = "admins"


def _extract_groups(event: dict) -> list[str]:
    """Extract cognito:groups claim from the API Gateway JWT authorizer.

    HTTP API (v2) exposes claims under requestContext.authorizer.jwt.claims.
    """
    authorizer = event.get("requestContext", {}).get("authorizer", {}) or {}
    jwt = authorizer.get("jwt", {}) or {}
    claims = jwt.get("claims", {}) or {}
    raw = claims.get("cognito:groups", "")
    if isinstance(raw, list):
        return [str(g) for g in raw]
    if isinstance(raw, str):
        # Can be JSON-serialized list string or comma/space separated string
        s = raw.strip()
        if s.startswith("[") and s.endswith("]"):
            try:
                parsed = json.loads(s)
                if isinstance(parsed, list):
                    return [str(g) for g in parsed]
            except json.JSONDecodeError:
                pass
            s = s[1:-1]
        return [g.strip() for g in s.replace(",", " ").split() if g.strip()]
    return []


def _is_admin(event: dict) -> bool:
    return ADMIN_GROUP in _extract_groups(event)

# Global (cross-app) configuration keys
GLOBAL_CONFIG_KEYS = {
    "model_id": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
    "system_prompt": "You are a professional game customer service assistant. Answer questions accurately and politely.",
    "temperature": 0.2,
    "max_tokens": 1024,
    "auto_generate_enabled": True,
    "auto_generate_tags": [],
    "default_app_id": "",  # fallback when webhook does not specify app
}


def get_config(event: dict) -> dict:
    """Get all configuration values (globals + apps list)."""
    all_config = db.get_all_config()

    # Globals with defaults
    globals_out = {}
    for key, default in GLOBAL_CONFIG_KEYS.items():
        globals_out[key] = all_config.get(key, default)

    # Apps (auto-migrates legacy single-app format)
    apps_list = apps_mod.load_apps()

    # Backward-compat: expose legacy top-level aihelp_* fields from first app,
    # so older frontend builds continue to render (they will be ignored on save).
    legacy_shim = {}
    if apps_list:
        first = apps_list[0]
        for k in apps_mod.LEGACY_APP_FIELDS:
            legacy_shim[k] = first.get(k, "")

    return success({
        **globals_out,
        **legacy_shim,
        "apps": apps_list,
    })


def update_config(event: dict) -> dict:
    """Update configuration values.

    Request body may contain:
    - Global fields (model_id / temperature / ...)
    - apps: full replacement list of apps
    - Legacy per-app fields at top level (ignored; log warning)

    Only users in the `admins` Cognito group may perform this action.
    """
    if not _is_admin(event):
        logger.warning("Non-admin attempted to update config: groups=%s", _extract_groups(event))
        return error(403, "Only admins can modify system configuration")

    try:
        body = json.loads(event.get("body", "{}"))
    except json.JSONDecodeError:
        return error(400, "Invalid JSON body")

    if not isinstance(body, dict):
        return error(400, "Body must be an object")

    updated_keys: list[str] = []

    # Globals
    for key, value in body.items():
        if key in GLOBAL_CONFIG_KEYS:
            db.put_config(key, value)
            updated_keys.append(key)

    # Apps list
    if "apps" in body:
        try:
            normalized = apps_mod.save_apps(body["apps"])
            updated_keys.append("apps")
            logger.info(f"Saved {len(normalized)} apps")
        except ValueError as e:
            return error(400, f"Invalid apps payload: {e}")

    # Warn about any legacy top-level per-app keys in the request (ignored)
    for legacy_key in apps_mod.LEGACY_APP_FIELDS:
        if legacy_key in body and "apps" not in body:
            logger.warning(
                f"Ignoring legacy top-level config key '{legacy_key}' — please send it inside the apps array"
            )

    return success({"updated": updated_keys})
