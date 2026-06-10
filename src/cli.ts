import * as readline from "readline";
import { validateConfig, config } from "./config";
import { initStore, closeStore, getPendingFollowups } from "./index/store";
import { processMessage } from "./agent/index";
import { logger } from "./utils/logger";
import { listNotes, readNote, syncEmbeddings } from "./vault/index";

function printBanner() {
  console.log("\n╔══════════════════════════════════╗");
  console.log("║     贾维斯 (Jarvis) — 个人 AI 陪伴  ║");
  console.log("╚══════════════════════════════════╝");
  console.log(`模型: ${config.llm.model}`);
  console.log(`Vault: ${config.vault.path}`);
  console.log("输入文字开始对话，Ctrl+C 或输入 /exit 退出\n");
}

async function syncEmbeddingsForVault() {
  try {
    const files = await listNotes();
    const fileContents = (
      await Promise.all(
        files.map(async (fp) => {
          const note = await readNote(fp);
          return note ? { filePath: fp, content: note.raw } : null;
        })
      )
    ).filter((x): x is { filePath: string; content: string } => x !== null);

    if (fileContents.length > 0) {
      await syncEmbeddings(fileContents);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`Embedding sync skipped (will retry on next write): ${msg}`);
  }
}

async function main() {
  validateConfig();
  await initStore();

  // Sync embeddings in background (don't block startup)
  syncEmbeddingsForVault();

  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "\x1b[36m>\x1b[0m ",
  });

  rl.prompt();

  // Check for pending followups on startup
  const initialFollowups = await getPendingFollowups();
  if (initialFollowups.length > 0) {
    console.log(
      `\x1b[33m📋 有 ${initialFollowups.length} 条待追问事项\x1b[0m`
    );
  }

  rl.on("line", async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }

    if (input === "/exit") {
      rl.close();
      return;
    }

    process.stdout.write("\x1b[33m贾维斯思考中...\x1b[0m");

    try {
      // Fetch current pending followups for each message
      const pendingFollowups = await getPendingFollowups();
      const followups = pendingFollowups.map((f) => ({
        id: f.id as string,
        question: f.question as string,
      }));

      const { reply } = await processMessage({
        text: input,
        mode: "default",
        followups: followups.length > 0 ? followups : undefined,
      });

      // Clear the "thinking" line and print reply
      process.stdout.write("\r\x1b[K");
      console.log(`\n\x1b[35m贾维斯\x1b[0m：${reply}\n`);
    } catch (err) {
      process.stdout.write("\r\x1b[K");
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("处理消息失败:", msg);
      console.log(`\n\x1b[31m出错了：${msg}\x1b[0m\n`);
    }

    rl.prompt();
  });

  rl.on("close", async () => {
    console.log("\n再见。");
    await closeStore();
    process.exit(0);
  });
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error("启动失败:", msg);
  console.error("启动失败:", msg);
  process.exit(1);
});
