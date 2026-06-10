import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "..", ".env") });

export const config = {
  llm: {
    apiKey: process.env.LLM_API_KEY || "",
    baseURL: process.env.LLM_BASE_URL || "https://api.deepseek.com",
    model: process.env.LLM_MODEL || "deepseek-chat",
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
  if (!config.llm.apiKey) errors.push("LLM_API_KEY is required");
  if (errors.length) {
    throw new Error(`Configuration errors:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
  }
}
