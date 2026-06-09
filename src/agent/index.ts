import { buildSystemPrompt, type PersonaName } from "./prompt";
import { TOOL_DEFINITIONS, createToolExecutors, type ToolDeps } from "./tools";
import { agentLoop } from "../llm/deepseek";
import type { ChatCompletionTool } from "openai/resources/chat/completions";
import * as vault from "../vault/index";
import * as index from "../index/store";
import { logger } from "../utils/logger";

class AuditAdapter {
  async logWrite({ filePath, action, detail }: {
    filePath: string;
    action: string;
    detail: Record<string, unknown>;
  }): Promise<void> {
    const id = `write-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await index.logAuditEntry({
      id,
      action,
      filePath,
      detail: { ...detail, auditId: id },
      timestamp: new Date().toISOString(),
    });
    (detail as Record<string, unknown>).auditId = id;
  }
}

const audit = new AuditAdapter();
const toolExecutors = createToolExecutors({ vault, index, audit } as ToolDeps);

export interface ProcessMessageParams {
  text: string;
  mode?: "default" | "think" | "search" | "recap";
  persona?: PersonaName;
}

export async function processMessage({ text, mode = "default", persona = "default" }: ProcessMessageParams): Promise<{ reply: string }> {
  const systemPrompt = buildSystemPrompt(persona as PersonaName);

  let userMessage = text;
  const tools: ChatCompletionTool[] = [...TOOL_DEFINITIONS];

  switch (mode) {
    case "think":
      userMessage = `/think 模式 — 深度对话\n\n用户说：${text}\n\n请进入教练或倾听者模式。先理解他的完整处境，可以参考过往记录（用 read_note 或 search_vault）。不要急着归档，先帮助他理清思路。`;
      break;
    case "search":
      userMessage = `用户搜索了："${text}"\n\n请使用 search_vault 工具搜索相关内容，然后根据搜索结果回答。必须引用文件路径 [[路径]]。如果搜不到相关内容，诚实告知。`;
      break;
    case "recap":
      userMessage = `用户触发了复盘。最近日期：${new Date().toISOString().slice(0, 10)}。\n\n请搜索最近的笔记（特别是情绪日记 §9 和决策档案 §14），生成一份本周复盘摘要。包括：情绪趋势、关键事件、与价值观的一致性、值得注意的模式。`;
      break;
  }

  const result = await agentLoop(systemPrompt, userMessage, tools, toolExecutors, {
    maxIterations: 5,
    temperature: mode === "think" ? 0.8 : 0.6,
  });

  return { reply: result.reply };
}

export async function handleCommand(command: string, _args?: string): Promise<{ reply: string }> {
  switch (command) {
    case "undo": {
      const lastEntry = await index.getLatestAuditEntry("write");
      if (!lastEntry) {
        return { reply: "没有可回滚的操作。" };
      }
      const detail = typeof lastEntry.detail === "string"
        ? JSON.parse(lastEntry.detail)
        : (lastEntry.detail as Record<string, unknown>);
      const filePath = lastEntry.file_path as string;

      const currentContent = await vault.readRaw(filePath);
      if (currentContent === null) {
        return { reply: `文件 ${filePath} 已不存在，无法回滚。` };
      }

      try {
        await index.logAuditEntry({
          action: "undo",
          filePath,
          detail: { undoneEntry: (lastEntry as unknown as Record<string, unknown>).id },
        });
        return {
          reply: `已记录回滚请求。目标文件: ${filePath}\n由于文件可能被手动编辑，请手动检查：\n• 打开 ${filePath}\n• 删除 AI 最后一次写入的内容\n\n(完整的自动回滚需要文件快照支持，将在后续版本实现)`,
        };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { reply: `回滚失败: ${message}` };
      }
    }

    case "log": {
      const entries = await index.getRecentAuditEntries(10);
      if (!entries.length) return { reply: "暂无写入记录。" };

      const lines = entries.map(
        (e) =>
          `[${(e.timestamp as string).slice(0, 16)}] ${e.action === "write" ? "📝" : e.action === "undo" ? "↩️" : "📌"} ${e.file_path}`
      );
      return { reply: `最近写入:\n${lines.join("\n")}` };
    }

    case "private":
      return { reply: "已进入隐私模式。本次对话不会记录到知识库。退出隐私模式请再次发送 /private。" };

    default:
      return { reply: `未知命令: /${command}` };
  }
}
