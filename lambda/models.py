"""Review status and webhook event constants."""

# Review statuses
PENDING_REVIEW = "pending_review"
APPROVED = "approved"
EDITED = "edited"
REJECTED = "rejected"
SENT = "sent"
SEND_FAILED = "send_failed"

# Webhook events
EVENT_TICKET_CREATE = "ticketCreate"
EVENT_TICKET_NEW_MESSAGE = "ticketNewMessage"
EVENT_TICKET_REPLY = "ticketReply"
EVENT_TICKET_CLOSE = "ticketClose"
EVENT_TICKET_EVALUATE = "ticketEvaluate"
EVENT_TICKET_TAG = "ticketTag"
EVENT_TICKET_NOTE = "ticketNote"
EVENT_TICKET_BOT_REPLY = "ticketBotReply"

# AIHelp ticket statuses
AIHELP_STATUS_REPLIED = 4
AIHELP_STATUS_PENDING = 5
AIHELP_STATUS_COMPLETED = 6
AIHELP_STATUS_NEW = 7
AIHELP_STATUS_RESOLVED = 8
AIHELP_STATUS_REJECTED = 9

# Message types
MSG_TYPE_TEXT = 0
MSG_TYPE_FORM = 1
MSG_TYPE_ATTACHMENT = 2
MSG_TYPE_URL = 3
MSG_TYPE_FAQ = 4
MSG_TYPE_TABLE = 5
MSG_TYPE_FORM_LINK = 6
MSG_TYPE_BOT = 7
