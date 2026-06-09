import type { ChatCompletionTool } from "openai/resources/chat/completions";
import type { ToolExecutorFn } from "../llm/deepseek";
import type { AuditAdapter } from "../vault/writer";
import type * as VaultNS from "../vault/index";
import type * as IndexNS from "../index/store";

export const TOOL_DEFINITIONS: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "classify",
      description:
        "判断用户输入应归属哪个或哪几个分类。返回分类ID列表和置信度。可以同时归入多个分类。如果无法确定，标记置信度 < 0.7 并归入 inbox。",
      parameters: {
        type: "object",
        properties: {
          tags: {
            type: "array",
            items: { type: "string" },
            description: "分类ID列表，如 ['§9','§1']",
          },
          confidence: { type: "number", description: "整体置信度 0-1" },
          rationale: { type: "string", description: "一句话解释分类依据" },
        },
        required: ["tags", "confidence"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_note",
      description:
        "写入一条笔记到知识库 Vault。会根据分类自动选择目录和文件名。如不确定路径，可传入建议标签，系统会自动确定路径。",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "相对 Vault 根目录的文件路径。不知道路径时可传空字符串。" },
          section: { type: "string", description: "Markdown 二级标题，如 '## 事件'。" },
          content: { type: "string", description: "要写入的正文内容（Markdown 格式）" },
          evidence_level: { type: "string", enum: ["L1", "L2", "L3"], description: "证据等级" },
          sensitivity: { type: "string", enum: ["low", "mid", "high", "top"], description: "隐私敏感度" },
          tags: { type: "array", items: { type: "string" }, description: "分类标签" },
          linked: { type: "array", items: { type: "string" }, description: "关联的 wikilink" },
        },
        required: ["content", "tags"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description: "读取 Vault 中的笔记文件。用于在回答前查阅过往记录。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "文件路径" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_vault",
      description: "在知识库中语义搜索相关内容。",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "搜索关键词" },
          max_results: { type: "number", description: "最大返回条数" },
          filter_tags: { type: "array", items: { type: "string" }, description: "按分类标签过滤" },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "schedule_followup",
      description: "安排在后续对话中追问用户某个问题。",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string", description: "要追问的问题" },
          context: { type: "string", description: "为什么需要追问的背景说明" },
        },
        required: ["question"],
      },
    },
  },
];

export interface ToolDeps {
  vault: typeof VaultNS;
  index: typeof IndexNS;
  audit: AuditAdapter;
}

export function createToolExecutors(deps: ToolDeps): Record<string, ToolExecutorFn> {
  const { vault, index, audit } = deps;

  return {
    async classify(args: Record<string, unknown>) {
      return {
        tags: (args.tags as string[]) || ["§16"],
        confidence: (args.confidence as number) || 0.7,
        rationale: (args.rationale as string) || "",
      };
    },

    async write_note(args: Record<string, unknown>) {
      let filePath = (args.path as string) || "";

      if (!filePath) {
        const tags = (args.tags as string[]) || ["§16"];
        filePath = determinePath(tags[0]);
      }

      const result = await vault.writeNote({
        path: filePath,
        section: (args.section as string) || null,
        content: args.content as string,
        frontmatter: {
          tags: (args.tags as string[]) || [],
          linked: (args.linked as string[]) || [],
          sensitivity: (args.sensitivity as string) || "low",
          evidence: (args.evidence_level as string) || "L1",
          source: "telegram",
        },
        audit,
      });

      if (index) {
        const tags = (args.tags as string[]) || [];
        index.upsertNote({
          id: result.auditId,
          file_path: filePath,
          type: tags[0]?.replace(/^§\d+\s*/, "") || "note",
          tags,
          linked: (args.linked as string[]) || [],
          sensitivity: (args.sensitivity as string) || "low",
          evidence: (args.evidence_level as string) || "L1",
        });
      }

      return {
        file_path: filePath,
        audit_id: result.auditId,
        status: "ok",
      };
    },

    async read_note(args: Record<string, unknown>) {
      const path = args.path as string;
      const note = await vault.readNote(path);
      if (!note) {
        const allFiles = await vault.listNotes();
        const match = allFiles.find((f: string) => f.endsWith(path));
        if (match) {
          const found = await vault.readNote(match);
          if (found) {
            return {
              path: match,
              frontmatter: found.frontmatter,
              content: found.content.slice(0, 2000),
              excerpt: true,
            };
          }
        }
        return { error: `未找到文件: ${path}` };
      }
      return { path, frontmatter: note.frontmatter, content: note.content };
    },

    async search_vault(args: Record<string, unknown>) {
      const results = await vault.searchVault(args.query as string, {
        maxResults: (args.max_results as number) || 5,
        filterTags: args.filter_tags as string[] | undefined,
      });
      return {
        query: args.query,
        count: results.length,
        results: results.map((r) => ({
          file: r.filePath,
          score: r.score.toFixed(2),
          excerpt: r.excerpt?.slice(0, 400),
        })),
      };
    },

    async schedule_followup(args: Record<string, unknown>) {
      if (index) {
        await index.createFollowup({
          triggerNoteId: "manual",
          question: args.question as string,
          status: "pending",
        });
      }
      return { question: args.question, status: "scheduled" };
    },
  };
}

const PATH_MAP: Record<string, string> = {
  "§1": "01_people/family",
  "§2": "01_people/partner",
  "§3": "01_people/friends",
  "§4": "01_people/work",
  "§5": "02_career/current_role",
  "§6": "02_career/skills",
  "§7": "02_career/plan",
  "§8": "03_self/health",
  "§9": "05_journal/emotion",
  "§10": "03_self/values",
  "§11": "03_self/interests",
  "§12": "04_resources/finance",
  "§13": "04_resources/time",
  "§14": "05_journal/decisions",
  "§15": "05_journal/reviews",
  "§16": "06_notes/inspirations",
  "§17": "06_notes/reading",
  "§18": "06_notes/messages",
  "§19": "07_lifestory/timeline",
  "§20": "07_lifestory/patterns",
};

function determinePath(tag: string): string {
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10);
  const dir = PATH_MAP[tag] || "00_inbox";
  const fileName = dir.endsWith(".md") ? dir : `${dir}/${dateStr}.md`;
  return fileName;
}
