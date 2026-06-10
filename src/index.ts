import { logger } from "./utils/logger";

logger.info("=".repeat(50));
logger.info("个人 AI 知识库 (Personal KB) 启动中...");
logger.info("=".repeat(50));

// CLI 入口 —— M1 唯一入口
import "./cli";
