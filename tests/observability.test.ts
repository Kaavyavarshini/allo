import { describe, it, expect } from "vitest";
import { summarise } from "../lib/observability";

describe("summarise", () => {
  it("computes counts, error rate and nearest-rank percentiles per tool", () => {
    const rows = [
      ...Array.from({ length: 20 }, (_, i) => ({ tool: "check_stock", ok: true, latencyMs: i + 1 })),
      { tool: "reserve_stock", ok: false, latencyMs: 50 },
      { tool: "reserve_stock", ok: true, latencyMs: 70 },
    ];
    const [a, b] = summarise(rows);
    expect(a).toMatchObject({ tool: "check_stock", calls: 20, errors: 0, errorRate: 0, p50Ms: 10, p95Ms: 19 });
    expect(b).toMatchObject({ tool: "reserve_stock", calls: 2, errors: 1, errorRate: 0.5, p50Ms: 50, p95Ms: 70 });
  });
  it("handles no data", () => expect(summarise([])).toEqual([]));
});
