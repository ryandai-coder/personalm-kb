import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

export const config = {
  deepseek: {
    apiKey: process.env.DEEPSEEK_API_KEY || "",
    baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
    model: process.env.DEEPSEEK_MODEL || "deepseek-chat",
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || "",
  },
  server: {
    port: parseInt(process.env.PORT || "3000", 10),
    webhookUrl: process.env.WEBHOOK_URL || "",
  },
  vault: {
    path: resolve(process.env.VAULT_PATH || "./vault"),
  },
  logging: {
    level: process.env.LOG_LEVEL || "info",
  },
};

export function validateConfig() {
  const errors = [];
  if (!config.deepseek.apiKey) errors.push("DEEPSEEK_API_KEY is required");
  if (!config.telegram.botToken) errors.push("TELEGRAM_BOT_TOKEN is required");
  if (errors.length) {
    throw new Error(`Configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}
