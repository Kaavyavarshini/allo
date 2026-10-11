import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { InventoryError, type Inventory } from "../lib/inventory";
import type { AuditSink } from "../lib/audit";
import type { PolicyHit } from "../lib/rag/policies";
import { logger } from "../lib/logger";

export type Deps = {
  inventory: Inventory;
  policies: { search(query: string, topK: number): Promise<PolicyHit[]> };
  audit: AuditSink;
};

const sku = z.string().min(1).max(40).describe("Product SKU, e.g. SKU-1001");
const warehouse = z.string().min(1).max(10).describe("Warehouse code, e.g. CHN, BLR, HYD");

/**
 * Build an MCP server exposing Allo's inventory operations as tools.
 * Every call is timed, audited, and failures are returned as tool errors
 * (isError) so the model can read them and recover, instead of crashing the session.
 */
export function createAlloServer(deps: Deps, actor: string): McpServer {
  const server = new McpServer({ name: "allo-inventory", version: "1.0.0" });

  type Content = { content: { type: "text"; text: string }[]; isError?: boolean };

  async function run<A>(tool: string, args: A, fn: () => Promise<unknown>): Promise<Content> {
    const t0 = performance.now();
    const done = (ok: boolean, error?: string) =>
      deps.audit
        .record({ tool, actor, args, ok, error, latencyMs: Math.round(performance.now() - t0) })
        .catch((e) => logger.error("audit_failed", { error: String(e) }));
    try {
      const result = await fn();
      await done(true);
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      // Only domain errors are shown verbatim; anything else could leak internals.
      const known = e instanceof InventoryError;
      const message = known ? `${e.code}: ${e.message}` : "Internal error. The failure has been logged.";
      if (!known) logger.error("tool_failed", { tool, error: String(e) });
      await done(false, known ? message : "internal");
      return { content: [{ type: "text", text: message }], isError: true };
    }
  }

  const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

  server.registerTool(
    "check_stock",
    {
      description:
        "List on-hand, reserved and available units. Optionally filter by SKU and/or warehouse code. Use this before reserving.",
      inputSchema: { sku: sku.optional(), warehouseCode: warehouse.optional() },
      annotations: READ,
    },
    (a) => run("check_stock", a, () => deps.inventory.getStock(a))
  );

  server.registerTool(
    "find_availability",
    {
      description:
        "Find which warehouses can fulfil a given quantity of a SKU right now, most available first. Returns an empty list if no single warehouse can.",
      inputSchema: { sku, quantity: z.number().int().positive().max(10000) },
      annotations: READ,
    },
    (a) => run("find_availability", a, () => deps.inventory.findAvailability(a.sku, a.quantity))
  );

  server.registerTool(
    "low_stock_report",
    {
      description: "List SKU/warehouse pairs whose available units are below a threshold, lowest first.",
      inputSchema: { threshold: z.number().int().min(1).max(1000).default(10) },
      annotations: READ,
    },
    (a) => run("low_stock_report", a, () => deps.inventory.lowStock(a.threshold))
  );

  server.registerTool(
    "get_reservation",
    {
      description: "Look up a reservation by id: status, expiry time and items.",
      inputSchema: { reservationId: z.string().min(1) },
      annotations: READ,
    },
    (a) =>
      run("get_reservation", a, async () => {
        const r = await deps.inventory.getReservation(a.reservationId);
        if (!r) throw new InventoryError("NOT_FOUND", `No reservation with id ${a.reservationId}`);
        return r;
      })
  );

  server.registerTool(
    "search_policies",
    {
      description:
        "Semantic search over company policy documents (reservation rules, warehouse routing, returns, replenishment). Use it to check rules before acting, and cite the source in your answer.",
      inputSchema: { query: z.string().min(3).max(300), topK: z.number().int().min(1).max(5).default(3) },
      annotations: { ...READ, openWorldHint: false },
    },
    (a) =>
      run("search_policies", a, async () => {
        const hits = await deps.policies.search(a.query, a.topK);
        return hits.length
          ? hits.map((h) => ({ source: h.source, section: h.heading, text: h.text, score: +h.score.toFixed(3) }))
          : { result: "No relevant policy found. Do not assume a rule exists." };
      })
  );

  server.registerTool(
    "reserve_stock",
    {
      description:
        "Place a temporary hold on stock at one warehouse. Holds expire automatically (default 15 min). The idempotencyKey must be unique per intended order line and REUSED when retrying, so the same order is never reserved twice. Does not remove stock; use confirm_reservation for that.",
      inputSchema: {
        sku,
        warehouseCode: warehouse,
        quantity: z.number().int().positive().max(1000),
        idempotencyKey: z.string().min(8).max(100).describe("Unique per order line; reuse on retry"),
        ttlMinutes: z.number().int().min(1).max(120).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) => run("reserve_stock", a, () => deps.inventory.reserve(a))
  );

  server.registerTool(
    "confirm_reservation",
    {
      description:
        "Confirm a PENDING hold: the units permanently leave stock. IRREVERSIBLE. Only call when the user has explicitly asked to confirm. Fails if the hold expired.",
      inputSchema: { reservationId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    (a) =>
      run("confirm_reservation", a, async () => {
        const ok = await deps.inventory.confirm(a.reservationId);
        if (!ok) throw new InventoryError("NOT_FOUND", "Reservation is not pending (already handled or expired) or does not exist.");
        return { id: a.reservationId, status: "CONFIRMED" };
      })
  );

  server.registerTool(
    "release_reservation",
    {
      description: "Release a PENDING hold so its units become available again.",
      inputSchema: { reservationId: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    (a) =>
      run("release_reservation", a, async () => {
        const ok = await deps.inventory.release(a.reservationId);
        if (!ok) throw new InventoryError("NOT_FOUND", "Reservation is not pending (already handled) or does not exist.");
        return { id: a.reservationId, status: "RELEASED" };
      })
  );

  return server;
}
