# AI Customer Service Workbench - Requirements

## Project Overview

Build a full-stack AI-powered customer service workbench that integrates with AIHelp customer service platform and Amazon Bedrock Knowledge Base. The system receives customer tickets via webhook, automatically generates AI-suggested answers, and allows human agents to review/edit/approve answers before sending them back to customers.

## Architecture

```
AIHelp (Customer Service Platform)
    │
    │ Webhook (ticketCreate/ticketNewMessage)
    ▼
API Gateway → Lambda (Python 3.11)
    ├── Webhook Handler (no auth, verify signature)
    ├── Bedrock KB Query (reuse existing pattern)
    ├── AIHelp API Client (HMAC_SHA256 signing)
    ├── Review CRUD API (Cognito auth)
    └── Config API (Cognito auth)
    │
    ├── DynamoDB (conversations + config)
    └── Bedrock Knowledge Base
    │
React Frontend (TypeScript)
    ├── Agent Workbench (ticket queue + AI review)
    ├── Conversation Timeline
    ├── Dashboard (stats)
    └── Settings Page
    │
Infrastructure: AWS CDK (TypeScript)
Hosting: S3 + CloudFront
Auth: Amazon Cognito
```

## Backend (Lambda - Python 3.11)

### 1. Webhook Handler
- Endpoint: POST /webhook/aihelp (NO Cognito auth)
- Receives AIHelp webhook events
- Events to handle:
  - `ticketCreate` - New ticket created
  - `ticketNewMessage` - Player replied
  - `ticketReply` - Agent replied (for tracking)
  - `ticketClose` - Ticket closed
  - `ticketEvaluate` - Player rated
- On ticketCreate/ticketNewMessage:
  1. Extract player message from webhook payload
  2. Query Bedrock KB for AI answer
  3. Save to DynamoDB with status "pending_review"

### 2. AIHelp API Client (aihelp_client.py)
- HMAC_SHA256 signature generation per AIHelp docs:
  ```
  HashedRequestPayload = Lowercase(HexEncode(Hash.SHA256(RequestPayload)))
  CanonicalRequest = Method + "\n" + URI + "\n" + QueryString + "\n" + HashedRequestPayload
  StringToSign = timestamp + "\n" + Lowercase(HexEncode(Hash.SHA256(CanonicalRequest)))
  Signature = HexEncode(HMAC_SHA256(SecretKey, StringToSign))
  ```
- Headers: Content-Type, appKey, timestamp (ms), sign
- Methods:
  - reply_ticket(ticketId, messageList, customerLoginName)
  - get_ticket_list(params)
  - get_ticket_details(ticketId)

### 3. Review API (Cognito auth required)
- GET /reviews - List reviews with filters (status, date range, pagination)
- GET /reviews/{ticketId} - Get all conversation records for a ticket
- PATCH /reviews/{ticketId}/{timestamp} - Update review (approve/reject/edit)
- POST /reviews/{ticketId}/send - Confirm and send reply to AIHelp
- POST /reviews/{ticketId}/regenerate - Re-query Bedrock KB

### 4. Config API (Cognito auth required)
- GET /config - Get current configuration
- PUT /config - Update configuration
- Config items:
  - aihelp_app_key, aihelp_secret_key, aihelp_app_domain
  - aihelp_customer_login_name (default reply account)
  - bedrock_kb_id, bedrock_model_id
  - system_prompt, temperature, max_tokens
  - auto_generate_enabled (bool)
  - auto_generate_tags (list of tags to auto-generate for)

### 5. Dashboard API
- GET /dashboard/stats - Get statistics (today's count, adoption rate, avg response time)

### 6. Bedrock KB Integration
- Use boto3 bedrock-agent-runtime client
- retrieve_and_generate API
- Pass system prompt from config
- Return answer + citations/sources

## DynamoDB Tables

### Table: conversations
- PK: ticketId (String)
- SK: timestamp (Number, milliseconds)
- Fields:
  - source: "webhook" | "manual"
  - webhookEvent: event type
  - playerMessage: player's message text
  - playerUserId, playerName
  - platform, language, tags
  - aiAnswer: AI generated answer
  - aiModel, aiKbId, aiSources (list)
  - aiLatencyMs, aiTokensIn, aiTokensOut
  - reviewStatus: "pending_review" | "approved" | "edited" | "rejected"
  - reviewedBy, reviewedAt
  - editedAnswer: edited version (nullable)
  - sentAnswer: final sent content
  - sentAt, sendStatus: "success" | "failed"
- GSI: status-index (PK: reviewStatus, SK: timestamp)
- GSI: reviewer-index (PK: reviewedBy, SK: timestamp)

### Table: config
- PK: configKey (String)
- Value stored as JSON

### Table: tickets (denormalized ticket info)
- PK: ticketId (String)
- Fields: userId, userDisplayName, platform, language, tags, status, birthTime, latestPlayerMessage, latestAiAnswer, reviewStatus, conversationCount

## Frontend (React 19 + TypeScript)

### Tech Stack
- React 19 + TypeScript
- Vite (build tool)
- React Router v7
- Ant Design 5 (UI framework - good for admin panels)
- AWS Amplify Auth (Cognito integration)
- Axios (HTTP client)
- Recharts (dashboard charts)

### Pages

#### 1. Ticket Queue (/workbench) - Main page
- Left sidebar: ticket list with filters
  - Filter by status: pending_review, approved, sent, rejected
  - Filter by tags, language, platform
  - Search by ticket ID or player name
  - Sort by time (newest first)
  - Badge showing pending count
- Right panel: ticket detail + AI review
  - Player info (name, platform, language, tags)
  - Player's message
  - AI suggested answer (editable text area)
  - Source citations from KB
  - Action buttons: [Approve & Send] [Edit] [Regenerate] [Reject]
  - Conversation timeline (all interactions for this ticket)

#### 2. Dashboard (/dashboard)
- Today's stats cards: total processed, AI adoption rate, avg response time
- Charts: daily trend, adoption rate by tag, by agent
- Top rejected answers (KB improvement hints)

#### 3. Settings (/settings)
- AIHelp connection config
- AI config (KB, model, prompt, temperature)
- Business rules (auto-generate toggle, tag filters)
- Test connection button

#### 4. Login
- Cognito hosted UI or custom login form

### Key UI Features
- Real-time updates: polling every 10s for new pending reviews (WebSocket can be added later)
- Toast notifications for new tickets
- Keyboard shortcuts: Enter to approve, Esc to skip
- Responsive layout

## CDK Infrastructure (TypeScript)

### Stack Components
- API Gateway (HTTP API)
- Lambda function (Python 3.11, with layer for dependencies)
- DynamoDB tables (conversations, config, tickets)
- Cognito User Pool + Client
- S3 bucket for frontend
- CloudFront distribution
- IAM roles with least privilege

### Config File (cdk/config.json)
```json
{
  "bedrockKnowledgeBaseId": "YOUR_KB_ID",
  "bedrockModelId": "anthropic.claude-3-haiku-20240307-v1:0",
  "systemPrompt": "You are a professional game customer service assistant...",
  "awsRegion": "us-west-2",
  "stackName": "",
  "resourcePrefix": ""
}
```

## Project Structure

```
ai-cs-workbench/
├── README.md                    # Full documentation
├── architecture.md              # Architecture document
├── cdk/                         # CDK infrastructure
│   ├── bin/cdk.ts
│   ├── lib/
│   │   └── ai-cs-workbench-stack.ts
│   ├── config.json
│   ├── config.example.json
│   ├── package.json
│   └── tsconfig.json
├── lambda/                      # Backend
│   ├── handler.py               # API router
│   ├── webhook.py               # Webhook handler
│   ├── aihelp_client.py         # AIHelp API client with signing
│   ├── bedrock_client.py        # Bedrock KB client
│   ├── review.py                # Review CRUD
│   ├── config_handler.py        # Config management
│   ├── dashboard.py             # Stats
│   ├── db.py                    # DynamoDB operations
│   ├── models.py                # Data models
│   ├── utils.py                 # Utilities
│   └── requirements.txt
├── frontend/                    # React frontend
│   ├── src/
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── pages/
│   │   │   ├── Workbench/
│   │   │   ├── Dashboard/
│   │   │   ├── Settings/
│   │   │   └── Login/
│   │   ├── components/
│   │   │   ├── TicketList/
│   │   │   ├── TicketDetail/
│   │   │   ├── AIReview/
│   │   │   ├── ConversationTimeline/
│   │   │   └── Layout/
│   │   ├── services/
│   │   │   ├── api.ts
│   │   │   └── auth.ts
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
└── docs/
    └── aihelp-api-reference.md
```

## AIHelp API Reference (from docs)

### Signing
- HMAC_SHA256 based
- Headers: appKey, timestamp (ms UTC), sign, Content-Type
- Timestamp must be within 5 minutes of server time
- Sign = HexEncode(HMAC_SHA256(secretKey, timestamp + "\n" + hash(canonicalRequest)))

### Reply Ticket
- POST https://{appDomain}/open/api/v3/ticket/reply
- Rate limit: 15/sec
- Body: { ticketId, messageList: [{type: "content", content: "..."}], customerLoginName, extendField? }

### Get Ticket List
- GET https://{appDomain}/open/api/v3.0/ticket/list
- Params: currentPage, pageSize (max 100), birthTimeStart, birthTimeEnd, languageAlias, platform
- Returns paginated list with messageList included

### Get Ticket Details
- GET https://{appDomain}/open/api/v3.0/ticket/details
- Params: ticketId
- Returns full ticket with messageList, evaluaterInfo, deviceInfo

### Webhook Events
- ticketCreate: new ticket with messages[]
- ticketNewMessage: player reply with message{}
- ticketReply: agent reply
- ticketClose: ticket closed (closeType: 1=resolved, 2=rejected, 3=deleted)
- ticketEvaluate: player rating (evaluateStar: 1-5)
- ticketTag: tag added/removed
- ticketNote: note added
- ticketBotReply: bot reply

### Ticket Status Codes
- 4: replied
- 5: pending reply
- 6: completed
- 7: new ticket
- 8: resolved
- 9: rejected

## Deployment Steps (document in README)
1. Prerequisites (Node.js, Python, Docker, AWS CLI, CDK)
2. Configure cdk/config.json
3. Deploy CDK stack
4. Create Cognito user
5. Build and deploy frontend
6. Configure AIHelp webhook URL
7. Configure settings in the app

## Important Notes
- Webhook endpoint must NOT require Cognito auth (called by AIHelp servers)
- All other API endpoints require Cognito auth
- AIHelp signing must be implemented exactly per their docs
- Use Strands Agent SDK for Bedrock KB integration (same as existing project)
- Frontend should be in Chinese (UI labels), code in English
