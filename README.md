# AI Customer Service Workbench

AI 智能客服工作台 — 基于 Amazon Bedrock Knowledge Base + AIHelp 的 Human-in-the-loop 客服辅助系统。

## 系统架构

```
AIHelp (客服系统)                     React 前端 (客服工作台)
    │                                      │
    │ Webhook                              │ REST API
    ▼                                      ▼
┌──────────────────────────────────────────────┐
│              API Gateway (HTTP API)          │
│  POST /webhook/aihelp (无认证)               │
│  GET/PATCH/POST /reviews/* (Cognito 认证)    │
│  GET/PUT /config (Cognito 认证)              │
│  GET /dashboard/stats (Cognito 认证)         │
└─────────────────────┬────────────────────────┘
                      │
              ┌───────▼────────┐
              │  Lambda (Py3.11)│
              └───┬───┬───┬────┘
                  │   │   │
    ┌─────────────┤   │   ├──────────────┐
    ▼             ▼   │   ▼              ▼
DynamoDB     Bedrock  │  AIHelp API   Cognito
(3 tables)    KB      │  (签名回复)   (用户认证)
                      │
              S3 + CloudFront
              (前端托管)
```

## 核心功能

- **Webhook 自动接收** — AIHelp 客诉自动推送到工作台
- **AI 自动生成回答** — 基于 Bedrock Knowledge Base 的 RAG 问答
- **知识库召回片段** — 展示每次检索的匹配问题、知识片段及置信度分数
- **Human-in-the-loop 审核** — 客服可确认/编辑/拒绝/重新生成 AI 答案
- **一键回复** — 审核通过后直接通过 AIHelp API 回复玩家
- **数据看板** — 处理量、AI 采纳率、响应时间等统计
- **首次登录引导** — 自动检测临时密码并引导设置新密码

## 工作流程

1. **玩家提问** → AIHelp 收到客诉
2. **Webhook 推送** → Lambda 接收，自动调用 Bedrock Knowledge Base 检索知识并生成 AI 答案
3. **客服审核** → 在工作台查看 AI 建议回答 + 召回的知识片段（含置信度）
4. **确认发送** → Lambda 调用 AIHelp API 回复玩家
5. **数据追踪** → 所有交互记录存入 DynamoDB

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + Ant Design 5 |
| 后端 | Python 3.11 + Lambda |
| AI | Amazon Bedrock Knowledge Base (Retrieve + RetrieveAndGenerate) |
| 数据库 | Amazon DynamoDB |
| 认证 | Amazon Cognito (User Pool + SRP Auth) |
| 基础设施 | AWS CDK (TypeScript) |
| 托管 | S3 + CloudFront |

## 前置条件

- Node.js 18+
- Python 3.11+
- Docker（CDK 打包 Lambda 依赖需要）
- AWS CLI（已配置凭证，需有 Bedrock、DynamoDB、Cognito、S3、CloudFront、Lambda 等权限）
- AWS CDK CLI（`npm install -g aws-cdk`）
- 已创建的 Amazon Bedrock Knowledge Base
- AIHelp 后台的 appKey 和 secretKey（正式环境）或 AIHelp Simulator（测试环境）

## 部署步骤

### 1. 克隆项目

```bash
git clone https://github.com/f1shb0t/ai-cs-workbench.git
cd ai-cs-workbench
```

### 2. 配置 CDK

```bash
cd cdk
cp config.example.json config.json
```

编辑 `config.json`：

```json
{
  "knowledgeBaseId": "你的 Bedrock Knowledge Base ID",
  "modelId": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
  "systemPrompt": "你是一个专业的游戏客服助手，请根据知识库内容准确回答玩家问题。",
  "awsRegion": "us-west-2",
  "stackName": "",
  "resourcePrefix": ""
}
```

| 字段 | 说明 | 必填 |
|------|------|------|
| knowledgeBaseId | Bedrock 知识库 ID | ✅ |
| modelId | Bedrock 模型 ID，支持 `global.*` 跨区模型 | 否，默认 Claude 4.5 Haiku |
| systemPrompt | 系统提示词 | 否，有默认值 |
| awsRegion | 部署区域 | 否，默认 us-west-2 |
| stackName | CloudFormation Stack 名称 | 否，首次自动生成，**首次部署后务必回填** |
| resourcePrefix | 资源名称前缀（多环境部署用） | 否 |

> **模型 ID 说明：** 支持标准模型（如 `anthropic.claude-3-5-sonnet-20241022-v2:0`）和跨区推理模型（如 `global.anthropic.claude-haiku-4-5-20251001-v1:0`），系统会自动生成正确的 ARN 格式。

### 3. 部署 CDK Stack

```bash
cd cdk
npm install

# 首次部署需要 bootstrap（每个 Region 只需一次）
npx cdk bootstrap

# 部署
npx cdk deploy --require-approval never
```

> ⚠️ Docker 必须运行 — CDK 用 Docker 打包 Python 依赖。

部署完成后记录输出值：

```
Outputs:
  ApiUrl = https://xxxxxx.execute-api.us-west-2.amazonaws.com/
  UserPoolId = us-west-2_xxxxxxxx
  UserPoolClientId = xxxxxxxxxxxxxxxxxxxxxxxxxx
  CloudFrontUrl = https://dxxxxxxxxxx.cloudfront.net
  DistributionId = E1XXXXXXXXXX
  WebsiteBucketName = ai-cs-workbench-frontend-xxxx
  WebhookUrl = https://xxxxxx.execute-api.us-west-2.amazonaws.com/webhook/aihelp
```

**⚠️ 首次部署后，将 Stack 名称写入 `config.json` 的 `stackName` 字段，后续部署会更新同一个 Stack 而不是创建新的。**

### 4. 创建 Cognito 用户

```bash
aws cognito-idp admin-create-user \
  --user-pool-id <UserPoolId> \
  --username admin \
  --temporary-password 'TempPass123!' \
  --user-attributes Name=email,Value=admin@example.com
```

> 💡 首次登录时，前端会自动检测临时密码状态并引导设置新密码，无需额外操作。
>
> 如需跳过首次改密流程（例如批量创建用户），可使用：
> ```bash
> aws cognito-idp admin-set-user-password \
>   --user-pool-id <UserPoolId> \
>   --username admin \
>   --password 'YourPassword123!' \
>   --permanent
> ```

### 5. 构建并部署前端

```bash
cd frontend
npm install

# 创建 .env 文件（用步骤 3 的 CDK 输出值填写）
cat > .env << EOF
VITE_API_URL=https://xxxxxx.execute-api.us-west-2.amazonaws.com
VITE_USER_POOL_ID=us-west-2_xxxxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-west-2
EOF

# 构建
npm run build

# 上传到 S3
aws s3 sync dist/ s3://<WebsiteBucketName> --delete

# 刷新 CloudFront 缓存
aws cloudfront create-invalidation \
  --distribution-id <DistributionId> \
  --paths "/*"
```

> 💡 快速查看 CDK 输出值：
> ```bash
> aws cloudformation describe-stacks --stack-name <你的StackName> \
>   --query 'Stacks[0].Outputs' --output table
> ```

### 6. 配置 AIHelp Webhook

**正式环境（AIHelp 后台）：**

1. 登录 AIHelp 智能客服后台
2. 进入 **设置** → **Webhook**
3. 填入 Webhook URL（CDK 输出的 `WebhookUrl`）
4. 勾选需要接收的事件：
   - ✅ ticketCreate（新客诉）
   - ✅ ticketNewMessage（玩家回复）
   - ✅ ticketReply（客服回复）
   - ✅ ticketClose（客诉完结）
   - ✅ ticketEvaluate（玩家评价）

**测试环境（AIHelp Simulator）：**

启动模拟平台时设置 Webhook URL 指向你的 API Gateway：

```bash
WEBHOOK_URL=https://xxxxxx.execute-api.us-west-2.amazonaws.com/webhook/aihelp \
APP_KEY=你的AppKey \
SECRET_KEY=你的SecretKey \
python app.py
```

### 7. 在工作台中配置连接

1. 打开 CloudFront URL，使用步骤 4 创建的用户登录
2. 进入 **系统设置**
3. 填写 AIHelp 连接配置：
   - **App Key** — AIHelp 的 appKey（或模拟平台的 APP_KEY）
   - **Secret Key** — AIHelp 的 secretKey（或模拟平台的 SECRET_KEY）
   - **App Domain** — AIHelp 服务地址，需要填完整 URL（如 `https://your-game.aihelp.net` 或测试用 `http://your-server:8888`）
   - **默认客服账号** — 回复时显示的客服名称
4. 填写 AI 配置：
   - **Knowledge Base ID** — Bedrock 知识库 ID
   - **模型 ID** — 可从建议列表选择，也可手动输入任意 Bedrock 模型 ID
   - **系统提示词** / 温度 / 最大回复长度
5. 点击 **保存配置**

> 💡 Settings 页面的配置保存在 DynamoDB 中，会覆盖 CDK config.json 中的初始值。

## 使用说明

### 工作台

- 左侧显示工单列表，按状态分 Tab（待审核 / 已发送 / 已拒绝 / 全部）
- 点击工单查看详情：
  - **玩家消息** — 原始客诉内容
  - **AI 建议回答** — Bedrock KB 自动生成的回答
  - **召回片段** — 知识库检索到的相关内容，包含匹配问题、知识片段和置信度分数
  - **引用来源** — AI 生成答案时引用的文档来源
- 操作按钮：
  - **确认发送** — 直接将 AI 答案发送给玩家
  - **编辑** — 修改 AI 答案后发送
  - **重新生成** — 重新调用 Bedrock KB 生成答案
  - **拒绝** — 拒绝 AI 答案（需在 AIHelp 后台手动回复）
- 自动每 10 秒刷新待处理列表

### 数据看板

- 今日处理量、AI 采纳率、平均响应时间、待处理数
- 按状态分类的处理统计

### 系统设置

- AIHelp 连接配置（App Key / Secret Key / Domain）
- AI 模型和提示词配置（支持自定义模型 ID）
- 自动生成开关和标签过滤

## 更新部署

代码更新后，根据改动范围选择部署方式：

```bash
git pull

# 仅前端改动
cd frontend && npm run build
aws s3 sync dist/ s3://<WebsiteBucketName> --delete
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*"

# 仅后端改动（Lambda / IAM / DynamoDB 等）
cd cdk && npx cdk deploy --require-approval never

# 前后端都改了 — 两步都要做
```

## 项目结构

```
ai-cs-workbench/
├── cdk/                         # CDK 基础设施
│   ├── bin/cdk.ts               # CDK 入口
│   ├── lib/
│   │   └── ai-cs-workbench-stack.ts  # 完整 Stack 定义
│   ├── config.json              # 部署配置（需自行创建）
│   └── config.example.json      # 配置模板
├── lambda/                      # Lambda 后端
│   ├── handler.py               # API 路由入口
│   ├── webhook.py               # Webhook 处理 + AI 自动生成
│   ├── bedrock_client.py        # Bedrock KB 客户端（Retrieve + RetrieveAndGenerate）
│   ├── aihelp_client.py         # AIHelp API 客户端（含 HMAC 签名）
│   ├── review.py                # 审核 CRUD + 发送回复
│   ├── config_handler.py        # 配置管理
│   ├── dashboard.py             # 统计数据
│   ├── db.py                    # DynamoDB 操作
│   ├── models.py                # 常量定义
│   └── utils.py                 # 工具函数
├── frontend/                    # React 前端
│   ├── src/
│   │   ├── App.tsx              # 路由和 Cognito 认证
│   │   ├── pages/
│   │   │   ├── Login/           # 登录页（含首次改密引导）
│   │   │   ├── Workbench/       # 客服工作台（核心）
│   │   │   ├── Dashboard/       # 数据看板
│   │   │   └── Settings/        # 系统设置
│   │   ├── components/Layout/   # 布局组件
│   │   ├── services/            # API 和认证服务
│   │   ├── types/               # TypeScript 类型定义
│   │   └── utils/               # 工具函数
│   ├── .env.example             # 环境变量模板
│   └── vite.config.ts           # Vite 构建配置
└── README.md
```

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /webhook/aihelp | ❌ | AIHelp Webhook 接收 |
| GET | /reviews | ✅ | 获取工单列表（支持 status 过滤） |
| GET | /reviews/{ticketId} | ✅ | 获取工单详情和对话记录 |
| PATCH | /reviews/{ticketId}/{timestamp} | ✅ | 更新审核状态（approved/edited/rejected） |
| POST | /reviews/{ticketId}/send | ✅ | 确认发送回复到 AIHelp |
| POST | /reviews/{ticketId}/regenerate | ✅ | 重新生成 AI 答案 |
| GET | /config | ✅ | 获取系统配置 |
| PUT | /config | ✅ | 更新系统配置 |
| GET | /dashboard/stats | ✅ | 获取今日统计数据 |

## 注意事项

- Webhook 端点不需要 Cognito 认证（由 AIHelp 服务器直接调用）
- AIHelp 签名的 timestamp 与服务器时间差超过 5 分钟会验签失败
- AIHelp API 频率限制：回复 15 次/秒，列表/详情 15 次/秒
- DynamoDB 使用按需计费（PAY_PER_REQUEST），无需预置容量
- 首次登录使用临时密码，前端会自动引导设置新密码
- 跨区推理模型（`global.*` / `us.*` / `eu.*`）会自动使用 inference-profile ARN 格式
- App Domain 支持 `http://` 和 `https://`，请填写完整 URL

## License

MIT
