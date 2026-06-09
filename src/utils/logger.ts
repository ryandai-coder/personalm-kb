import { createLogger, format, transports } from "winston";
import { config } from "../config";

export const logger = createLogger({
  level: config.logging.level,
  format: format.combine(
    format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    format.errors({ stack: true }),
    format.printf(({ timestamp, level, message, ...rest }) => {
      const extra = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
      return `${timestamp} [${level.toUpperCase()}] ${message}${extra}`;
    })
  ),
  transports: [new transports.Console()],
});
