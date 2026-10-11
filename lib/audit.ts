import { logger } from "./logger";

export type AuditEntry = {
  tool: string;
  actor: string; // "stdio" | "http" | "agent" | ...
  args: unknown;
  ok: boolean;
  error?: string;
  latencyMs: number;
};

export interface AuditSink {
  record(entry: AuditEntry): Promise<void>;
}

/** Truncate large argument payloads so the audit table stays small. */
export function clipArgs(args: unknown, max = 2000): unknown {
  const s = JSON.stringify(args ?? null);
  return s.length <= max ? args ?? null : { truncated: true, preview: s.slice(0, max) };
}

export const consoleAudit: AuditSink = {
  async record(e) {
    logger.info("tool_call", { ...e, args: clipArgs(e.args, 300) });
  },
};
