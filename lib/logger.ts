/** Minimal structured JSON logger. One line per event, easy to ship to any log pipeline. */
type Level = "debug" | "info" | "warn" | "error";
const order: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  return order[(process.env.LOG_LEVEL as Level) ?? "info"] ?? order.info;
}

export function log(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (order[level] < threshold()) return;
  // stderr, never stdout: the stdio MCP transport uses stdout for protocol messages
  process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + "\n");
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => log("debug", m, f),
  info: (m: string, f?: Record<string, unknown>) => log("info", m, f),
  warn: (m: string, f?: Record<string, unknown>) => log("warn", m, f),
  error: (m: string, f?: Record<string, unknown>) => log("error", m, f),
};
