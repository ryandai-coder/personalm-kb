import { Telegraf, session } from "telegraf";
import type { Express } from "express";
import { config } from "../config";
import { logger } from "../utils/logger";
import { commands } from "./commands";
import { handlers } from "./handlers";

export function createBot(): Telegraf {
  const bot = new Telegraf(config.telegram.botToken);

  bot.use(session());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot.use(commands as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bot.use(handlers as any);

  bot.catch((err: unknown, ctx) => {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`Bot error for ${String(ctx?.update?.update_id)}:`, msg);
    ctx?.reply?.("内部错误，请稍后再试。").catch(() => {});
  });

  return bot;
}

export async function startPollingBot(): Promise<void> {
  const bot = createBot();

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`);
    await bot.stop(signal);
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  logger.info("Starting Telegram bot in polling mode...");
  await bot.launch();
  logger.info("Bot is running. Press Ctrl+C to stop.");
}

export async function startWebhookBot(app: Express): Promise<Telegraf> {
  const bot = createBot();

  const webhookPath = "/webhook";
  app.use(bot.webhookCallback(webhookPath));

  const webhookUrl = config.server.webhookUrl;
  if (webhookUrl) {
    await bot.telegram.setWebhook(`${webhookUrl}${webhookPath}`);
    logger.info(`Webhook set to ${webhookUrl}${webhookPath}`);
  }

  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}. Shutting down...`);
    await bot.stop(signal);
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

  return bot;
}
