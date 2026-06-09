import express from "express";
import { validateConfig, config } from "./config";
import { startPollingBot, startWebhookBot } from "./bot/index";
import { initStore, closeStore, startAutoFlush } from "./index/store";
import { logger } from "./utils/logger";

async function main(): Promise<void> {
  logger.info("=".repeat(50));
  logger.info("个人 AI 知识库 (Personal KB) 启动中...");
  logger.info("=".repeat(50));

  try {
    validateConfig();
    logger.info("配置验证通过");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(msg);
    logger.error("请检查 .env 文件，确保 DEEPSEEK_API_KEY 和 TELEGRAM_BOT_TOKEN 已设置");
    process.exit(1);
  }

  try {
    await initStore();
    startAutoFlush();
    logger.info("索引存储已就绪");
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("索引初始化失败:", msg);
    process.exit(1);
  }

  logger.info(`Vault 路径: ${config.vault.path}`);
  logger.info(`模型: ${config.deepseek.model}`);

  const useWebhook = config.server.webhookUrl;

  if (useWebhook) {
    const app = express();
    app.use(express.json());

    app.get("/health", (_req, res) => {
      res.json({ status: "ok", timestamp: new Date().toISOString() });
    });

    app.listen(config.server.port, () => {
      logger.info(`Webhook 服务器运行在端口 ${config.server.port}`);
    });

    await startWebhookBot(app);
  } else {
    logger.info("未设置 WEBHOOK_URL，使用 polling 模式");
    await startPollingBot();
  }
}

process.on("exit", () => {
  closeStore();
  logger.info("个人 AI 知识库已关闭");
});

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  logger.error("启动失败:", msg);
  process.exit(1);
});
