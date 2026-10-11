import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { clipArgs, consoleAudit, type AuditSink } from "./audit";
import { logger } from "./logger";

/** Persists every tool call; also logs it. An audit failure must never break the tool call itself. */
export const prismaAudit: AuditSink = {
  async record(e) {
    await consoleAudit.record(e);
    try {
      const args = clipArgs(e.args);
      await prisma.toolCallLog.create({
        data: {
          tool: e.tool,
          actor: e.actor,
          args: args === null ? Prisma.JsonNull : (args as Prisma.InputJsonValue),
          ok: e.ok,
          error: e.error,
          latencyMs: e.latencyMs,
        },
      });
    } catch (err) {
      logger.error("audit_write_failed", { error: String(err) });
    }
  },
};
