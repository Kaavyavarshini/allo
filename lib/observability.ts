export type CallRow = { tool: string; ok: boolean; latencyMs: number };
export type ToolStats = { tool: string; calls: number; errors: number; errorRate: number; p50Ms: number; p95Ms: number };

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/** Per-tool call count, error rate and latency percentiles (nearest-rank). */
export function summarise(rows: CallRow[]): ToolStats[] {
  const by = new Map<string, CallRow[]>();
  for (const r of rows) by.set(r.tool, [...(by.get(r.tool) ?? []), r]);
  return [...by.entries()]
    .map(([tool, rs]) => {
      const lat = rs.map((r) => r.latencyMs).sort((a, b) => a - b);
      const errors = rs.filter((r) => !r.ok).length;
      return {
        tool,
        calls: rs.length,
        errors,
        errorRate: +(errors / rs.length).toFixed(3),
        p50Ms: percentile(lat, 50),
        p95Ms: percentile(lat, 95),
      };
    })
    .sort((a, b) => b.calls - a.calls);
}
