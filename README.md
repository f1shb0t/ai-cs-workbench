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

## 工作流程

1. **玩家提问** → AIHelp 收到客诉
2. **Webhook 推送** → Lambda 接收，自动调用 Bedrock KB 生成 AI 答案
3. **客服审核** → 在工作台查看 AI 建议，可编辑/确认/拒绝
4. **确认发送** → Lambda 调用 AIHelp API 回复玩家
5. **数据追踪** → 所有交互记录存入 DynamoDB

## 技术栈

| 组件 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript + Vite + Ant Design 5 |
| 后端 | Python 3.11 + Lambda |
| AI | Amazon Bedrock Knowledge Base |
| 数据库 | Amazon DynamoDB |
| 认证 | Amazon Cognito |
| 基础设施 | AWS CDK (TypeScript) |
| 托管 | S3 + CloudFront |

## 前置条件

- Node.js 18+
- Python 3.11+
- Docker（CDK 打包 Lambda 依赖需要）
- AWS CLI（已配置凭证）
- AWS CDK CLI（`npm install -g aws-cdk`）
- 已创建的 Amazon Bedrock Knowledge Base
- AIHelp 后台的 appKey 和 secretKey

## 部署步骤

### 1. 配置

```bash
cd cdk
cp config.example.json config.json
# 编辑 config.json，填入你的配置
```

config.json 配置项：

| 字段 | 说明 | 必填 |
|------|------|------|
| bedrockKnowledgeBaseId | Bedrock 知识库 ID | ✅ |
| bedrockModelId | Bedrock 模型 ID | 否，默认 Claude 3 Haiku |
| systemPrompt | 系统提示词 | 否 |
| awsRegion | 部署区域 | 否，默认 us-west-2 |
| stackName | CloudFormation Stack 名称 | 否，自动生成 |
| resourcePrefix | 资源名称前缀（多环境部署用） | 否 |

### 2. 部署 CDK Stack

```bash
cd cdk
npm install

# 首次部署需要 bootstrap
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

**⚠️ 首次部署后，将 stackName 写入 config.json，后续部署会更新同一个 Stack。**

### 3. 创建 Cognito 用户

```bash
# 通过 AWS CLI 创建用户
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username admin \
  --temporary-password 'TempPass123!' \
  --user-attributes Name=email,Value=admin@example.com

# 或者通过 AWS Console：
# Cognito → User Pools → 选择用户池 → Users → Create user
```

### 4. 构建并部署前端

```bash
cd frontend
npm install

# 创建 .env 文件（用 CDK 输出值填写）
cat > .env << EOF
VITE_API_URL=https://xxxxxx.execute-api.us-west-2.amazonaws.com
VITE_USER_POOL_ID=us-west-2_xxxxxxxx
VITE_USER_POOL_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx
VITE_AWS_REGION=us-west-2
EOF

# 构建
npm run build

# 上传到 S3
aws s3 sync dist/ s3://YOUR_BUCKET_NAME --delete

# 刷新 CloudFront 缓存
aws cloudfront create-invalidation \
  --distribution-id YOUR_DISTRIBUTION_ID \
  --paths "/*"
```

### 5. 配置 AIHelp Webhook

1. 登录 AIHelp 智能客服后台
2. 进入 **设置** → **Webhook**
3. 填入 Webhook URL（CDK 输出的 `WebhookUrl`）
4. 勾选需要接收的事件：
   - ✅ ticketCreate（新客诉）
   - ✅ ticketNewMessage（玩家回复）
   - ✅ ticketReply（客服回复）
   - ✅ ticketClose（客诉完结）
   - ✅ ticketEvaluate（玩家评价）

### 6. 在工作台中配置 AIHelp 连接

1. 打开 CloudFront URL，登录
2. 进入 **系统设置**
3. 填写：
   - AIHelp App Key
   - AIHelp Secret Key
   - AIHelp App Domain
   - 默认客服账号名
4. 配置 AI 参数（Knowledge Base ID、模型、提示词等）
5. 保存

## 使用说明

### 工作台

- 左侧显示工单列表，按状态分 Tab（待审核/已发送/已拒绝/全部）
- 点击工单查看详情：玩家消息 + AI 建议回答
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

- AIHelp 连接配置
- AI 模型和提示词配置
- 自动生成开关和标签过滤

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
│   ├── handler.py               # API 路由
│   ├── webhook.py               # Webhook 处理
│   ├── aihelp_client.py         # AIHelp API 客户端（含签名）
│   ├── bedrock_client.py        # Bedrock KB 客户端
│   ├── review.py                # 审核 CRUD
│   ├── config_handler.py        # 配置管理
│   ├── dashboard.py             # 统计
│   ├── db.py                    # DynamoDB 操作
│   ├── models.py                # 常量定义
│   └── utils.py                 # 工具函数
├── frontend/                    # React 前端
│   ├── src/
│   │   ├── App.tsx              # 路由和认证
│   │   ├── pages/
│   │   │   ├── Workbench/       # 客服工作台（核心）
│   │   │   ├── Dashboard/       # 数据看板
│   │   │   ├── Settings/        # 系统设置
│   │   │   └── Login/           # 登录页
│   │   ├── components/Layout/   # 布局组件
│   │   ├── services/            # API 和认证
│   │   ├── types/               # TypeScript 类型
│   │   └── utils/               # 工具函数
│   └── .env.example             # 环境变量模板
└── README.md
```

## API 端点

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| POST | /webhook/aihelp | ❌ | AIHelp Webhook 接收 |
| GET | /reviews | ✅ | 获取工单列表 |
| GET | /reviews/{ticketId} | ✅ | 获取工单详情和对话记录 |
| PATCH | /reviews/{ticketId}/{timestamp} | ✅ | 更新审核状态 |
| POST | /reviews/{ticketId}/send | ✅ | 确认发送回复 |
| POST | /reviews/{ticketId}/regenerate | ✅ | 重新生成 AI 答案 |
| GET | /config | ✅ | 获取配置 |
| PUT | /config | ✅ | 更新配置 |
| GET | /dashboard/stats | ✅ | 获取统计数据 |

## 注意事项

- Webhook 端点不需要 Cognito 认证（由 AIHelp 服务器调用）
- AIHelp 签名的 timestamp 与服务器时间差超过 5 分钟会失效
- AIHelp API 频率限制：回复 15次/秒，列表/详情 15次/秒
- DynamoDB 使用按需计费，无需预置容量
- 首次登录使用临时密码，前端会自动引导设置新密码

## License

MIT
