# 隐 (Yin) — 个人 AI 知识库

一个基于 Telegram + DeepSeek 的个人 AI 陪伴系统。对话即记录，AI 自动分类归档到 Markdown 知识库，越用越懂你。

## 架构

```
Telegram Bot (Telegraf)
    │
    ▼
Agent 编排层 (DeepSeek 4-pro + function calling)
    │
    ├─ classify  → 自动判断分类标签
    ├─ write_note → 写入 Markdown + YAML frontmatter
    ├─ search_vault → 全文检索
    └─ schedule_followup → 后续追问
    │
    ▼
Vault (Obsidian 兼容的 Markdown 文件树)
    │
    ▼
JSON 旁路索引 (audit log / notes / followups)
```

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置

```bash
cp .env.example .env
```

编辑 `.env`：

```env
DEEPSEEK_API_KEY=sk-xxx          # DeepSeek API key（已预填）
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

TELEGRAM_BOT_TOKEN=your_token    # 从 @BotFather 获取

PORT=3000                        # webhook 模式端口
WEBHOOK_URL=                     # 留空 = polling 模式
VAULT_PATH=./vault               # 知识库路径
```

### 3. 获取 Telegram Bot Token

1. 在 Telegram 搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot`，按提示设置名称
3. 将获得的 token 填入 `.env` 的 `TELEGRAM_BOT_TOKEN`

### 4. 启动

```bash
npm run dev     # 开发模式（tsx watch 热重载）
npm start       # 生产模式（需先 npm run build）
```

启动后在 Telegram 给你的 bot 发消息即可开始使用。

## 命令

| 命令 | 说明 |
|------|------|
| `/start` | 初始化，显示帮助 |
| 直接发消息 | 自动分类归档，返回一行回执 |
| `/search <关键词>` | 搜索知识库 |
| `/think <问题>` | 深度对话（教练模式） |
| `/log` | 查看最近 10 条写入 |
| `/undo` | 回滚最近一次写入 |
| `/persona <名称>` | 切换人格：`listener` / `coach` / `analyst` / `buddy` |
| `/private` | 切换隐私模式（不记录） |
| `/recap` | 生成周复盘草稿 |
| `/model` | 查看当前模型 |

## 人格

| 人格 | 触发 | 风格 |
|------|------|------|
| `default` 隐 | 默认 | 中性、克制、温和 |
| `listener` 倾听者 | 心情低落时 | 只共情和镜映，不分析不给建议 |
| `coach` 教练 | `/think` 决策时 | 苏格拉底式提问 |
| `analyst` 分析师 | 技术/职业场景 | 结构化、列表化 |
| `buddy` 损友 | 降压 | 调侃、不正经 |

## 知识库结构

```
vault/
├── 00_inbox/          # 未归类临时区
├── 01_people/         # 人：家人/伴侣/朋友/职场
├── 02_career/         # 事业：岗位/技能/规划
├── 03_self/           # 自己：健康/价值观/兴趣
├── 04_resources/      # 资源：财务/时间
├── 05_journal/        # 日志：情绪/决策/复盘
├── 06_notes/          # 笔记：灵感/阅读/通讯
├── 07_lifestory/      # 历程：时间线/模式
└── _system/           # 系统：索引/审计/模板
```

所有文件为 Markdown + YAML frontmatter，可用 Obsidian 直接打开编辑。

## 开发

```bash
npm run dev         # tsx watch 热重载
npm run build       # tsc 编译到 dist/
npm run typecheck   # 纯类型检查（tsc --noEmit）
npm test            # 冒烟测试
```

### 项目结构

```
src/
├── index.ts            # 入口（Express + Bot）
├── config.ts           # 配置加载与校验
├── llm/deepseek.ts     # DeepSeek API 客户端 + agent loop
├── agent/
│   ├── index.ts        # 主 Agent 编排器 + 命令处理
│   ├── prompt.ts       # 分层 system prompt（5 种人格）
│   └── tools.ts        # Tool definitions + executors
├── vault/
│   ├── index.ts        # Facade
│   ├── reader.ts       # Markdown 读取 + frontmatter 解析
│   ├── writer.ts       # Markdown 写入 + audit log
│   └── search.ts       # 全文搜索 + 关键词评分
├── index/store.ts      # JSON 文件索引
├── bot/
│   ├── index.ts        # Telegraf bot 创建
│   ├── commands.ts     # 8 个命令处理器
│   └── handlers.ts     # 文字/语音/图片处理
└── utils/logger.ts     # Winston 日志
```

### 技术栈

- **运行时**: Node.js ≥20, TypeScript 5.7
- **Bot 框架**: Telegraf 4
- **LLM**: DeepSeek API（OpenAI 兼容，function calling）
- **存储**: Markdown + YAML frontmatter（Obsidian 兼容）
- **索引**: JSON 文件（`_system/` 目录下）
- **Web 服务**: Express 4（webhook 模式）

## 部署

### 本地开发（polling）

不设 `WEBHOOK_URL`，自动使用 polling 模式。

### 生产环境（webhook）

1. 准备一台有公网 IP 的服务器（或有 Tailscale Funnel）
2. 设置 `.env` 中 `WEBHOOK_URL=https://your-domain.com`
3. 用 nginx/Caddy 反代到 `localhost:3000`
4. `npm run build && npm start`

```nginx
# nginx 示例
location /webhook {
    proxy_pass http://127.0.0.1:3000/webhook;
}
```

### systemd 自启

```ini
[Unit]
Description=Personal KB Bot
After=network.target

[Service]
Type=simple
User=youruser
WorkingDirectory=/path/to/personalm-kb
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

## 隐私

- 所有数据存储为本地 Markdown 文件，不锁定于任何平台
- API 调用走 DeepSeek，敏感信息需先手动脱敏
- 隐私模式（`/private`）暂停记录
- `sensitivity: top` 的内容仅为本地存储
- `/undo` 可回滚 AI 写入
- 数据格式纯 Markdown，随时可打包带走或迁移到 Obsidian/其他工具
