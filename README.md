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

- **多 App 配置** — 支持多个游戏/产品来源，每个来源独立配置 AppKey / SecretKey / AppDomain / Knowledge Base
- **Webhook 自动接收** — AIHelp 客诉自动推送到工作台，按 `appId` 路由到对应配置
- **AI 自动生成回答** — 基于 Bedrock Knowledge Base 的 RAG 问答
- **知识库召回片段** — 展示每次检索的匹配问题、知识片段及置信度分数
- **Human-in-the-loop 审核** — 客服可确认/编辑/拒绝/重新生成 AI 答案
- **一键回复** — 审核通过后直接通过 AIHelp API 回复玩家
- **权限管理** — 基于 Cognito Groups，只有 `admins` 组成员可以修改系统配置
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
python app.py
```

Simulator 内置 3 个示例 App（`game_a` / `game_b` / `game_c`），用于多游戏场景验证。也可以用 `APPS` / `APPS_FILE` 环境变量自定义。详见 [aihelp-simulator/README.md](https://github.com/f1shb0t/aihelp-simulator)。

### 7. 在工作台中配置连接

1. 打开 CloudFront URL，使用步骤 4 创建的用户登录
2. 进入 **系统设置**
3. **新增 App**（点击「🎮 AIHelp Apps」卡右上角按钮）。每个 App 代表一个游戏/产品来源：
   - **App ID** — 唯一标识，只允许字母/数字/下划线/连字符（如 `gameA_cn`）
   - **App 名称** — 显示名
   - **AIHelp App Key / Secret Key** — AIHelp 后台的 AppKey / SecretKey（或 Simulator 里的对应值）
   - **App Domain** — 完整 URL（如 `https://your-game.aihelp.net` 或 `http://localhost:8888`）
   - **默认客服账号** — 回复时显示的客服名称
   - **Knowledge Base ID** — 这个 App 对应的 Bedrock 知识库 ID
   - **启用** — 关闭后此 App 不再接受 webhook 路由
4. **全局 AI 配置**：模型 ID / 系统提示词 / 温度 / 最大回复长度（跨 App 共享）
5. **业务规则**：
   - 默认 App — webhook 未指定 appId 时的兜底
   - Webhook 自动生成 AI 答案开关
6. 点击 **保存配置**

> 💡 只有 Cognito `admins` 组的用户才能修改配置（详见下文「权限管理」）。

> 💡 Settings 页面的配置保存在 DynamoDB 中，会覆盖 CDK config.json 中的初始值。

## 多 App 配置

同一个 workbench 可同时接入多个 AIHelp App（对应不同游戏/产品的客诉来源），每个 App 独立绑定一套 AppKey / SecretKey / AppDomain / Knowledge Base。

### 路由规则

Webhook 进来后按下面的优先级匹配对应 App：
1. `data.appId` 或 body 顶层的 `appId`
2. `data.appKey` 或 body 顶层的 `appKey`（按 `aihelp_app_key` 查找）
3. Settings 中配置的「默认 App」
4. 第一个启用的 App（兜底，会记 warning）

工单记录中会持久化 `appId`，后续回复都走该 App 的配置。

### 升级兼容

如果你之前用的是单 App 版本（v1），升级后：
- 首次读取配置时，旧的顶层 `aihelp_app_key` / `secret_key` / `app_domain` / `knowledge_base_id` 会**自动迁移**为一个 `app_id=default` 的 App
- 你可以在 Settings 页把它改名、改 ID，然后继续新增其他 App
- 已有工单没有 `appId`，发送时会按「默认 App」兜底，不影响使用

### 用 Simulator 多 App 联调

见 [aihelp-simulator README](https://github.com/f1shb0t/aihelp-simulator)。本地启动 Simulator，进 `/apps` 页把每个 App 的 AppKey/SecretKey 复制到 workbench Settings，就可以模拟多来源客诉。

## 权限管理

系统配置（Settings 页）的写入权限通过 Cognito 用户组（`admins`）控制。

### 基本规则

| 用户 | GET /config | PUT /config（保存配置）| Settings 页行为 |
|------|:---:|:---:|------|
| 任何登录用户 | ✅ | ❌ | 只读（表单禁用，保存按钮隐藏，显示"只读模式"提示）|
| `admins` 组成员 | ✅ | ✅ | 完整编辑权限 |

后端 Lambda 和前端 UI 双端校验，非 admin 用户直接调 API 也会返回 403。

### 把自己加为 admin

```bash
# 替换变量
USER_POOL_ID=us-west-2_XXXXXXXXX   # CDK 输出的 UserPoolId
USERNAME=your-cognito-username

aws cognito-idp admin-add-user-to-group \
  --user-pool-id $USER_POOL_ID \
  --username $USERNAME \
  --group-name admins \
  --region us-west-2
```

添加后，**用户需要重新登录**（重新签发 ID token 以携带 `cognito:groups` claim）。

### 列出 admins 组成员

```bash
aws cognito-idp list-users-in-group \
  --user-pool-id $USER_POOL_ID \
  --group-name admins \
  --region us-west-2
```

### 移除 admin 权限

```bash
aws cognito-idp admin-remove-user-from-group \
  --user-pool-id $USER_POOL_ID \
  --username $USERNAME \
  --group-name admins \
  --region us-west-2
```

> ⚠️ **首次部署提醒**：`cdk deploy` 之后，admins 组是空的。你至少需要手动把自己加进去，否则谁都改不了系统配置。

## 使用说明

### 工作台（对话气泡式 UI）

工单详情页采用**聊天气泡**形式展示完整对话流（v2 改造）：

- 左侧工单列表，按状态分 Tab（待审核 / 已发送 / 已拒绝 / 全部），支持 App 筛选
- 点击工单进入气泡式对话视图：
  - **玩家消息**：靠左白色气泡，头像显示玩家名首字母
  - **AI 回复**：靠右蓝色气泡，机器人头像；每条独立审核
  - **已发送回复**：靠右绿色气泡 + `✓ 已发送 by {审核人} · {时间}`
  - **已拒绝回复**：灰色半透明 + 删除线
  - **发送失败**：红色气泡 + 重试按钮
  - 消息流按时间顺序纵向排列，自动滚动到最新

- **气泡行内操作条**（点击气泡显示）：
  - ✏️ **编辑** — 在气泡内直接编辑（无需打开弹窗）
  - 🔄 **重新生成** — 调用 Bedrock KB 重新生成，注入完整对话历史
  - ✅ **发送** — 发送当前气泡内容给玩家
  - ❌ **拒绝** — 拒绝此条回复
  - 编辑中：**保存** / **取消** / **保存并发送**

- **KB 召回折叠块**：每条 AI 气泡下方 `📚 引用了 N 条知识` 可展开查看

- **多消息独立处理**：如果玩家连续发了 3 条消息，就会有 3 组气泡对（player+AI），每条独立编辑/发送，**不会互相覆盖**

### 对话记忆（v2 新增）

AI 现在具备多轮对话上下文感知能力，适用于玩家连续追问场景：

- 使用 **Bedrock RetrieveAndGenerate 原生 sessionId** 维持服务端会话
- 工单首条消息开启新 session，后续消息携带 sessionId 调用
- sessionId 存储在 ticket 表的 `bedrockSessionId` 字段（DynamoDB schemaless，无需 schema 迁移）
- sessionId 过期时（Bedrock 限制一定时间）自动降级新开 session
- 无 session 时，后端把已发送的历史对话注入 prompt 作为兜底上下文

**效果示例**：
```
玩家: 账号被封了怎么办？
AI:   你可以通过 X 渠道提交申诉...
玩家: 那申诉通过率高吗？     ← AI 能理解"申诉"指的是账号解封
AI:   通常在 48 小时内...
```

重新生成（regenerate）会**开启新 session** 但**注入本地历史**，避免受旧上下文干扰同时保留对话连续性。

### 数据看板

- 今日处理量、AI 采纳率、平均响应时间、待处理数
- 按状态分类的处理统计

### 系统设置

- **全局配置**（所有 App 共用）：模型、System Prompt、自动生成开关
- **Apps 表格**（admin 可编辑）：每个 App 独立配置 AIHelp + KB，**可选独立 System Prompt**
  - 每个 App 有一个可选的"系统提示词"字段
  - 留空 → 沿用全局提示词
  - 填写 → 仅对此 App 生效（典型场景：不同游戏不同语气，例如萌系游戏用活泼语气、硬核游戏用严肃语气）
  - 表格"提示词"列显示 `自定义` / `沿用全局` 标签，一眼可辨
- 仅 admins 组用户可修改配置，非 admin 显示只读视图

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
