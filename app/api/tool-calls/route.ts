import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { summarise } from "@/lib/observability";

export const dynamic = "force-dynamic";

/** GET /api/tool-calls?hours=24 -> per-tool volume, error rate, p50/p95 latency, plus the latest calls. */
export async function GET(req: Request) {
  const hours = Math.min(168, Math.max(1, Number(new URL(req.url).searchParams.get("hours")) || 24));
  const since = new Date(Date.now() - hours * 3600_000);
  const rows = await prisma.toolCallLog.findMany({
    where: { createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 5000,
  });
  return NextResponse.json({
    windowHours: hours,
    totalCalls: rows.length,
    byTool: summarise(rows),
    recent: rows.slice(0, 20).map((r) => ({
      at: r.createdAt, tool: r.tool, actor: r.actor, ok: r.ok, error: r.error, latencyMs: r.latencyMs,
    })),
  });
}
