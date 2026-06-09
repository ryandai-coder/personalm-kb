# personalm-kb 实现与 personal-kb-design.md 对比审查

> 审查日期：2026-06-09
> 设计文档版本：v1.0

## 概要

实现为 **TypeScript/Node.js** 项目，而设计文档指定 **Python 3.12 / FastAPI / Anthropic SDK / Khoj**。两者在几乎所有重大架构决策上均存在分歧。

---

## 一、关键偏离（阻塞 M1 目标）

| # | 设计预期 | 实际情况 | 严重程度 |
|---|----------|----------|----------|
| 1 | **Khoj 作为 RAG 后端** — F4 要求调用 Khoj API 进行语义搜索（Qdrant 向量检索） | 无 Khoj 集成。`search.ts` 仅做简单关键词匹配，无向量/语义搜索 | **严重** — F4 是 M1 P0 需求 |
| 2 | **Claude (Anthropic SDK) 为主模型** — DeepSeek 仅作备份/批量任务 | 仅 DeepSeek。零 Anthropic SDK 集成，无多模型路由 | **严重** — 设计明确指定心理疏导场景必须用 Claude |
| 3 | **OpenAI Whisper API 语音转写** — F1 要求支持语音输入 | `handlers.ts:48` 返回"语音消息暂不支持自动转写" | **严重** — F1 语音输入未实现 |
| 4 | **SQLite + Qdrant 旁路索引** — 完整 DDL schema，字段级精确查询 + 语义搜索 | `store.ts` 使用 JSON 文件（`_system/index.json`），无 SQLite，无向量存储 | **严重** — 无法支持聚合查询 |

---

## 二、中等偏离

| # | 设计预期 | 实际情况 | 严重程度 |
|---|----------|----------|----------|
| 5 | **`/correct` 命令 + Correction 闭环** (§5.4.2) — AI 更新自我认知，修改行为翻译表 | 无 `/correct` 命令。`store.ts` 有 `recordCorrection()` 但从未被调用 | **中** — 设计将此列为核心差异化优势 |
| 6 | **行为翻译表** (§2.4) — SQLite `behavior_rules` 表，`query_behavior_rules` 工具 | 无行为翻译表。无对应工具 | **中** — 核心差异化优势 |
| 7 | **`/undo` 自动回滚** (§5.4.3) — 内容哈希检查，三情况判断，自动行删除 | `agent/index.ts:86` 返回手动说明："请手动检查：打开文件，删除 AI 最后一次写入的内容" | **中** — `/undo` 实际不可用 |
| 8 | **写入时冲突检测** — 新旧信息矛盾 → 标记 `[⚠️ 冲突]`，加入冲突队列 | 无冲突检测。Writer 单纯追加内容 | **中** |
| 9 | **证据级别 L0** — "已否定，永不使用" | `tools.ts:41` 的 `evidence_level` 枚举只有 `["L1","L2","L3"]`，缺少 L0 | **中** |

---

## 三、低严重度差距

| # | 问题 |
|---|------|
| 10 | `agent/prompt.ts` 缺少 L0 规则 0.2："不突然变得完美、温柔、无条件包容。保持适度的克制和中立。" |
| 11 | System prompt 缺少："高敏感（sensitivity≥high）的语料，在内部推理后只在最终输出中保留必要信息" |
| 12 | System prompt 缺少："行为翻译表（L3 注入）中与当前话题相关的规则，优先于通用推理" |
| 13 | 无 `vault/linker.ts` — wikilink 创建与校验 |
| 14 | 无 `vault/templates.ts` — `writeTemplatedNote` 存在但未集成分类→模板映射 |
| 15 | 无 `rebuild-index` 功能 — JSON 索引无法从 Markdown 重建 |
| 16 | 无 `index/watcher.ts` — `chokidar` 在 package.json 但未使用 |
| 17 | `config.yaml`（业务配置）+ `.env`（密钥）合并为仅 `.env` |
| 18 | 缺少工具定义：`query_index`、`extract_entities`、`query_behavior_rules`、`switch_persona`、`record_correction` |
| 19 | 仅有一个 `test.ts` 冒烟测试。设计期望 ~60 单元测试 + ~20 集成测试 |
| 20 | 图片处理器为占位实现，无 OCR 或图片分析 |

---

## 四、符合设计的内容

- ✅ M1 范围内所有 Telegram 命令：`/start` `/think` `/search` `/log` `/undo` `/persona` `/private` `/recap` `/model`
- ✅ 5 种 Persona：隐（默认）、倾听者、教练、分析师、损友 — 与 §6.2 一致
- ✅ 分层 system prompt：L0 硬规则 + Persona + 操作规则（概念匹配 §6.1）
- ✅ 5 个 Tool 定义：`classify` `write_note` `read_note` `search_vault` `schedule_followup`
- ✅ Vault 目录结构匹配 §5.2（`00_inbox/` ~ `07_lifestory/` + `_system/`）
- ✅ 20 个分类 ID + 路径映射（§2.1）
- ✅ Markdown + YAML frontmatter，含 evidence 和 sensitivity 字段（§5.3.1）
- ✅ 审计日志（JSONL）、Correction 日志、Followup 追踪
- ✅ Webhook + Polling 双模式，Express `/health` 端点
- ✅ 隐私模式（`/private`）
- ✅ Frontmatter 构建器（`id`, `type`, `created_at`, `tags`, `evidence`, `sensitivity`, `source`）
- ✅ 带 recency 衰减的全文搜索

---

## 五、M1 MVP 验收标准对照（§15.3）

| 验收标准 | 状态 |
|-----------|--------|
| F1 文字记录 → 3s 内回执 → 分类标签 | ⚠️ 取决于 DeepSeek 延迟 |
| F1 语音 → Whisper 转写准确率 ≥90% | ❌ 未实现 |
| F2 10条输入中 ≥8 条分类正确 | ⚠️ 未测试；DeepSeek 分类质量与 Claude 不同 |
| F4 `/search` → 返回相关结果 → `[[路径]]` 真实存在 | ⚠️ 仅关键词搜索，无语义召回 |
| F10 Obsidian 同步编辑可见 | ⚠️ 无 fswatch 检测外部编辑 |
| `/undo` → 文件恢复 | ❌ 仅建议手动操作 |
| 7×24 在线运行 | ✅ 可实现（systemd + Express） |

---

## 六、根因分析

技术栈选择与设计完全不同（**TypeScript/Express/DeepSeek** vs **Python/FastAPI/Claude/Khoj**），导致级联差异：

1. **无 Khoj** → 无向量搜索 → F4 降级为关键词匹配
2. **无 Claude** → 无 Anthropic Prompt Caching → 成本优化策略失效；心理疏导质量取决于 DeepSeek
3. **JSON 文件替代 SQLite** → 无字段级查询 → 无法做聚合（如"过去30天 §9 情绪日记"）
4. **无 fswatch** → 无增量索引重建 → Obsidian 编辑在重启前不可见

---

## 七、M1 修复优先级建议

如需对齐设计，M1 最关键的三个修复项：

1. **Khoj 集成** — 恢复 F4 语义搜索能力
2. **Claude 集成** — 恢复核心模型的共情质量和 Prompt Caching
3. **Whisper 集成** — 恢复 F1 语音输入
