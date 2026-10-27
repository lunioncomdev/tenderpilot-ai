import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "web" },
  redact: {
    paths: ["*.password", "*.passwordHash", "*.apiKey", "*.token", "headers.authorization", "headers.cookie"],
    censor: "[masqué]",
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});
