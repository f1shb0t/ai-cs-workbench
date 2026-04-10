"""Dashboard statistics handler."""

import db
from utils import success


def get_stats(event: dict) -> dict:
    """Get dashboard statistics."""
    stats = db.count_conversations_today()
    return success(stats)
