import { config } from "./src/config";
import { initStore, closeStore } from "./src/index/store";
import * as vault from "./src/vault/index";
import { chat } from "./src/llm/deepseek";
import type { AuditAdapter } from "./src/vault/writer";

const results = { pass: 0, fail: 0 };

function check(name: string, ok: boolean): void {
  if (ok) { results.pass++; console.log(`  ✅ ${name}`); }
  else    { results.fail++; console.log(`  ❌ ${name}`); }
}

async function main(): Promise<void> {
  console.log("=== Personal KB Smoke Test ===\n");

  console.log("1. Configuration");
  check("DEEPSEEK_API_KEY set", !!config.deepseek.apiKey);
  check("DEEPSEEK_BASE_URL", config.deepseek.baseURL === "https://api.deepseek.com");
  check("Vault path exists", !!config.vault.path);
  console.log(`   Model: ${config.deepseek.model}`);
  console.log(`   Vault: ${config.vault.path}\n`);

  console.log("2. Vault layer");
  await initStore();

  const audit: AuditAdapter = {
    async logWrite({ filePath, action, detail }) {
      const { logAuditEntry } = await import("./src/index/store");
      await logAuditEntry({ action, filePath, detail, timestamp: new Date().toISOString() });
    },
  };

  const writeResult = await vault.writeNote({
    path: "00_inbox/test-smoke.md",
    section: "## 测试",
    content: "这是一条自动测试笔记。",
    frontmatter: { tags: ["§16"], evidence: "L1", source: "test" },
    audit,
  });
  check("Write note → returns file path", !!writeResult.filePath);

  const readResult = await vault.readNote("00_inbox/test-smoke.md");
  check("Read note → finds content", !!readResult?.content.includes("自动测试笔记"));
  check("Read note → has frontmatter", Array.isArray(readResult?.frontmatter?.tags));

  const searchResults = await vault.searchVault("测试笔记");
  check("Search vault → finds test note", searchResults.length > 0);
  console.log();

  console.log("3. DeepSeek API");
  try {
    const response = await chat([
      { role: "system", content: "用中文回答，一句话。" },
      { role: "user", content: "你好，请用一句话介绍你自己。" },
    ], { temperature: 0.3, max_tokens: 200 });

    const reply = response.choices[0].message.content;
    check("DeepSeek chat → returns response", !!reply && reply.length > 0);
    console.log(`   Reply: ${reply?.slice(0, 80)}...\n`);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    check(`DeepSeek API call (${msg.slice(0, 80)})`, false);
    console.log();
  }

  console.log("4. Agent tool loop");
  try {
    const { agentLoop } = await import("./src/llm/deepseek");
    const { TOOL_DEFINITIONS } = await import("./src/agent/tools");
    const { buildSystemPrompt } = await import("./src/agent/prompt");

    const sysPrompt = buildSystemPrompt("default");
    check("System prompt → non-empty", sysPrompt.length > 500);

    const toolExecs: Record<string, (args: Record<string, unknown>) => Promise<Record<string, unknown>>> = {
      async classify(args) {
        return { tags: (args.tags as string[]) || ["§16"], confidence: 0.9, rationale: "test" };
      },
      async write_note(args) {
        return { file_path: args.path as string || "test.md", status: "ok" };
      },
      async read_note() {
        return { content: "(test content)" };
      },
      async search_vault(args) {
        return { query: args.query as string, count: 0, results: [] };
      },
      async schedule_followup(args) {
        return { question: args.question as string, status: "scheduled" };
      },
    };

    const result = await agentLoop(
      sysPrompt,
      "今天工作很累，和同事有分歧。",
      TOOL_DEFINITIONS,
      toolExecs,
      { maxIterations: 3 }
    );

    check("Agent loop → returns reply", result.reply?.length > 0);
    if (result.reply) {
      console.log(`   Reply: ${result.reply.slice(0, 100)}...`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    check(`Agent loop (${msg.slice(0, 80)})`, false);
  }

  console.log(`\n=== Results: ${results.pass} passed, ${results.fail} failed ===`);

  await closeStore();
  process.exit(results.fail > 0 ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error("Test error:", err);
  process.exit(1);
});
