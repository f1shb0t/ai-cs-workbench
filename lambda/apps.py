"""
App configuration management — support multiple AIHelp apps.

Each app has its own:
- app_id / app_name / enabled
- aihelp_app_key / aihelp_secret_key / aihelp_app_domain / aihelp_customer_login_name
- knowledge_base_id

Global (cross-app) config kept as-is:
- model_id, system_prompt, temperature, max_tokens, auto_generate_enabled, auto_generate_tags
"""

import logging
from typing import Any

import db

logger = logging.getLogger(__name__)

# Per-app config fields
APP_FIELDS = [
    "app_id",
    "app_name",
    "aihelp_app_key",
    "aihelp_secret_key",
    "aihelp_app_domain",
    "aihelp_customer_login_name",
    "knowledge_base_id",
    "enabled",
]

# Legacy single-app field names (used for migration from old format)
LEGACY_APP_FIELDS = [
    "aihelp_app_key",
    "aihelp_secret_key",
    "aihelp_app_domain",
    "aihelp_customer_login_name",
    "knowledge_base_id",
]


def _default_app() -> dict:
    return {
        "app_id": "default",
        "app_name": "默认 App",
        "aihelp_app_key": "",
        "aihelp_secret_key": "",
        "aihelp_app_domain": "",
        "aihelp_customer_login_name": "ai-assistant",
        "knowledge_base_id": "",
        "enabled": True,
    }


def load_apps() -> list[dict]:
    """
    Load the apps list from config table.

    If new-format `apps` key exists, return it.
    Otherwise, migrate from legacy single-app fields (preserves existing config).
    """
    apps_raw = db.get_config("apps")
    if apps_raw and isinstance(apps_raw, list):
        # Normalize: ensure all fields present
        normalized = []
        for app in apps_raw:
            if not isinstance(app, dict):
                continue
            merged = {**_default_app(), **{k: v for k, v in app.items() if k in APP_FIELDS}}
            # Coerce enabled to bool
            merged["enabled"] = bool(merged.get("enabled", True))
            if merged.get("app_id"):
                normalized.append(merged)
        return normalized

    # Migration: build a single app from legacy fields
    legacy = {}
    for k in LEGACY_APP_FIELDS:
        val = db.get_config(k)
        if val is not None:
            legacy[k] = val

    if any(legacy.get(k) for k in ("aihelp_app_key", "knowledge_base_id")):
        migrated = _default_app()
        migrated.update({k: legacy[k] for k in legacy if k in APP_FIELDS})
        migrated["app_id"] = "default"
        migrated["app_name"] = "默认 App（从旧配置迁移）"
        logger.info("Migrated legacy single-app config to apps list")
        return [migrated]

    return []


def save_apps(apps: list[dict]) -> list[dict]:
    """
    Persist apps list. Returns the normalized list written.

    Validations:
    - app_id required, unique, [a-zA-Z0-9_-]
    - No empty app_id
    """
    if not isinstance(apps, list):
        raise ValueError("apps must be a list")

    seen_ids = set()
    normalized = []
    for idx, app in enumerate(apps):
        if not isinstance(app, dict):
            raise ValueError(f"apps[{idx}] is not an object")
        app_id = (app.get("app_id") or "").strip()
        if not app_id:
            raise ValueError(f"apps[{idx}]: app_id is required")
        if app_id in seen_ids:
            raise ValueError(f"Duplicate app_id: {app_id}")
        seen_ids.add(app_id)

        merged = {**_default_app(), **{k: v for k, v in app.items() if k in APP_FIELDS}}
        merged["app_id"] = app_id
        merged["enabled"] = bool(merged.get("enabled", True))
        if not merged.get("app_name"):
            merged["app_name"] = app_id
        normalized.append(merged)

    db.put_config("apps", normalized)
    return normalized


def find_app_by_id(app_id: str, apps: list[dict] | None = None) -> dict | None:
    apps = apps if apps is not None else load_apps()
    for app in apps:
        if app.get("app_id") == app_id:
            return app
    return None


def find_app_by_key(app_key: str, apps: list[dict] | None = None) -> dict | None:
    if not app_key:
        return None
    apps = apps if apps is not None else load_apps()
    for app in apps:
        if app.get("aihelp_app_key") == app_key:
            return app
    return None


def resolve_app_for_webhook(
    data: dict,
    body: dict | None = None,
    default_app_id: str | None = None,
) -> dict | None:
    """
    Decide which app an incoming webhook belongs to.

    Priority:
    1. data.appId or body.appId
    2. data.appKey or body.appKey  → match by aihelp_app_key
    3. default_app_id (if configured)
    4. First enabled app (fallback with warning)

    Returns the app dict, or None if no apps configured.
    """
    apps = load_apps()
    if not apps:
        return None

    body = body or {}

    # 1. explicit appId
    app_id = data.get("appId") or body.get("appId")
    if app_id:
        app = find_app_by_id(app_id, apps)
        if app:
            return app
        logger.warning(f"Webhook appId={app_id} not found in apps list")

    # 2. appKey (AIHelp webhook may carry it for signature context)
    app_key = data.get("appKey") or body.get("appKey")
    if app_key:
        app = find_app_by_key(app_key, apps)
        if app:
            return app

    # 3. default
    if default_app_id:
        app = find_app_by_id(default_app_id, apps)
        if app:
            logger.info(f"Using default_app_id={default_app_id} for webhook")
            return app

    # 4. first enabled
    for app in apps:
        if app.get("enabled", True):
            logger.warning(
                f"Webhook did not specify app; falling back to first enabled app: {app.get('app_id')}"
            )
            return app

    return None
