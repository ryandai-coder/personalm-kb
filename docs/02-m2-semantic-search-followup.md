# M2：语义搜索 + 主动追问

> 状态：已完成 ｜ 日期：2026-06-10

---

## 一、做了什么

M1 的搜索是关键词匹配，中文同义词、改写、近义表达都搜不到。追问工具定义了但没接上线。

M2 两件事：

1. **语义搜索**：本地 embedding 模型，按含义搜索而非关键词
2. **主动追问**：followup 生命周期闭环，AI 在合适时机自然提起

---

## 二、语义搜索

### 模型

`paraphrase-multilingual-MiniLM-L12-v2`，通过 `@xenova/transformers` 本地运行。

- 384 维向量，支持 50+ 语言包括中文
- 模型约 120MB，首次下载后缓存在本地
- 首次加载 ~4-5 分钟（下载），后续秒级

### 搜索模式

```
用户 query → 生成 query embedding
  → 对所有缓存的 note embeddings 计算 cosine similarity
  → 与 keyword search 结果合并去重（hybrid）
  → 返回 top-N
```

三种模式：

| 模式 | 权重 | 适用场景 |
|------|------|---------|
| `hybrid`（默认） | 语义 0.6 + 关键词 0.4 | 通用 |
| `semantic` | 纯语义 | 自然语言查询 |
| `keyword` | 纯关键词 | 精确匹配 |

### 向量存储

`_system/embeddings.json`：

```json
{
  "model": "Xenova/paraphrase-multilingual-MiniLM-L12-v2",
  "entries": {
    "05_journal/emotion/2026-06-10.md": {
      "hash": "abc123",
      "embedding": [0.1, 0.2, ...]
    }
  }
}
```

- 带 model 版本号，换模型自动清空重建
- content hash 校验，内容没变就跳过重新 embedding

### 触发时机

- **写入时**：`write_note()` 完成后后台生成 embedding，不阻塞用户
- **启动时**：`syncEmbeddings()` 扫描 vault，补漏新增/变更的笔记
- **手动**：`reindexAll()` 全部重建

### 新增/改动文件

| 文件 | 改动 |
|------|------|
| `src/vault/embeddings.ts` | **新增** — 模型加载、embed()、缓存管理、syncEmbeddings()、reindexAll() |
| `src/vault/search.ts` | 新增 semanticSearch()；searchVault() 改为 hybrid 模式 |
| `src/vault/writer.ts` | writeNote() 末尾触发背景 embedding |
| `src/vault/index.ts` | 导出 embedding 相关函数 |
| `src/agent/tools.ts` | search_vault 定义和 executor 支持 mode 参数 |
| `src/cli.ts` | 启动时调用 syncEmbeddings() |
| `package.json` | 新增 `@xenova/transformers` 依赖 |

---

## 三、主动追问

### 生命周期

```
schedule_followup → status: "pending"
  ↓
CLI 启动 / 每条消息前 → getPendingFollowups()
  ↓
注入 prompt → AI 在合适时机自然提起
  ↓
resolve_followup(id, "asked")
  ↓
用户回应 → resolve_followup(id, "completed")
```

状态：`pending` → `asked` → `completed` / `dismissed` / `deferred`

### 新增工具

`resolve_followup`：
- 参数：`followup_id` + `status`（asked | completed | dismissed | deferred）
- AI 自主决定何时提起、何时完成

### Prompt 规则

操作规则第 8 条：

> 如果系统提供了待追问列表，在合适时机自然地提起（不要生硬切换话题）。提起后标记为 asked，用户回应后标记为 completed。不要一次性抛出所有追问。

### 改动文件

| 文件 | 改动 |
|------|------|
| `src/agent/tools.ts` | 新增 `resolve_followup` 工具定义和 executor；schedule_followup 返回 followup_id |
| `src/index/store.ts` | 新增 `resolveFollowup()` 便捷方法 |
| `src/agent/prompt.ts` | 新增第 8 条操作规则（followup 处理） |
| `src/agent/index.ts` | processMessage 新增 followups 参数，注入追问上下文 |
| `src/cli.ts` | 每条消息前检查 pending followups 并传入 |

---

## 四、验证结果

```
写笔记 → 自动 embedding:              ✅
语义搜索 "面试失败很难过" 找到 "面试挂了": ✅ (cosine 0.67)
followup create → pending → resolve:  ✅
TypeScript 编译:                      ✅
```

---

## 五、与 M1 的关系

M1 架构预留的注入点全部用上：

```
┌────────────────────────────────┐
│ L0  硬规则                       │  M1 ✅  已有
│     不评判、先共情、不模仿用户     │
├────────────────────────────────┤
│ L1  Self Memory（用户画像）       │  M2 后  用对话积累
│     价值观、核心矛盾、关键模式     │
├────────────────────────────────┤
│ L2  RAG 上下文                   │  M2 ✅  语义搜索做实
│     从 vault 检索相关历史笔记     │
├────────────────────────────────┤
│ L3  行为翻译表                    │  后续
│     "他说算了不一定真算了"         │
└────────────────────────────────┘
```

M2 之后，L2 RAG 从"形式上有"变成了"真正能召回相关上下文"。每次对话 AI 都能查到历史相关笔记，对话深度和个性化程度有感知提升。

---

## 六、M2 不要的

- 不要向量数据库（Pinecone、Chroma）—— JSON 文件够用
- 不要 RAG chunking 策略 —— 笔记粒度已足够
- 不要 followup 时间调度（cron 提醒）—— 只在 CLI 启动时检查
- 不要多端接入 / Vault 可视化 —— 不是 M2 范围
