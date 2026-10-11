import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAlloServer } from "../mcp/server";
import { handleMcpRequest } from "../mcp/http";
import { makeDeps } from "./helpers/fakes";

async function connect() {
  const ctx = await makeDeps();
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createAlloServer(ctx.deps, "test").connect(s);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(c);
  const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    const text = (r.content as { text: string }[])[0].text;
    return { isError: r.isError === true, text, json: r.isError ? null : JSON.parse(text) };
  };
  return { ...ctx, client, call };
}

describe("MCP server", () => {
  let t: Awaited<ReturnType<typeof connect>>;
  beforeEach(async () => (t = await connect()));

  it("exposes 8 tools with correct safety annotations", async () => {
    const tools = (await t.client.listTools()).tools;
    expect(tools.map((x) => x.name).sort()).toEqual(
      ["check_stock", "confirm_reservation", "find_availability", "get_reservation", "low_stock_report", "release_reservation", "reserve_stock", "search_policies"]
    );
    const by = Object.fromEntries(tools.map((x) => [x.name, x.annotations]));
    expect(by.check_stock?.readOnlyHint).toBe(true);
    expect(by.reserve_stock?.readOnlyHint).toBe(false);
    expect(by.confirm_reservation?.destructiveHint).toBe(true);
  });

  it("find_availability returns only warehouses that can fulfil, most stock first", async () => {
    const r = await t.call("find_availability", { sku: "SKU-1001", quantity: 10 });
    expect(r.json.map((x: { warehouse: string }) => x.warehouse)).toEqual(["CHN", "BLR"]);
  });

  it("full lifecycle: reserve -> get -> confirm updates stock", async () => {
    const res = await t.call("reserve_stock", { sku: "SKU-1001", warehouseCode: "CHN", quantity: 5, idempotencyKey: "order-1-mouse" });
    expect(res.json.status).toBe("PENDING");
    expect((await t.call("get_reservation", { reservationId: res.json.id })).json.items[0].quantity).toBe(5);
    expect((await t.call("confirm_reservation", { reservationId: res.json.id })).json.status).toBe("CONFIRMED");
    const stock = (await t.call("check_stock", { sku: "SKU-1001", warehouseCode: "CHN" })).json[0];
    expect(stock).toMatchObject({ onHand: 25, reserved: 0, available: 25 });
  });

  it("reserve_stock is idempotent on retry with the same key", async () => {
    const a = await t.call("reserve_stock", { sku: "SKU-1001", warehouseCode: "CHN", quantity: 5, idempotencyKey: "order-2-mouse" });
    const b = await t.call("reserve_stock", { sku: "SKU-1001", warehouseCode: "CHN", quantity: 5, idempotencyKey: "order-2-mouse" });
    expect(a.json.id).toBe(b.json.id);
    expect((await t.call("check_stock", { sku: "SKU-1001", warehouseCode: "CHN" })).json[0].reserved).toBe(5);
  });

  it("domain failures come back as readable tool errors, not exceptions", async () => {
    const r = await t.call("reserve_stock", { sku: "SKU-1001", warehouseCode: "HYD", quantity: 9, idempotencyKey: "order-3-mouse" });
    expect(r.isError).toBe(true);
    expect(r.text).toContain("INSUFFICIENT_STOCK");
    expect(r.text).toContain("Only 4");
    expect((await t.call("reserve_stock", { sku: "NOPE", warehouseCode: "CHN", quantity: 1, idempotencyKey: "order-4-nope" })).text).toContain("UNKNOWN_SKU");
    expect((await t.call("confirm_reservation", { reservationId: "missing" })).isError).toBe(true);
  });

  it("input validation rejects bad arguments before touching inventory", async () => {
    const r = await t.client.callTool({ name: "reserve_stock", arguments: { sku: "SKU-1001", warehouseCode: "CHN", quantity: -2, idempotencyKey: "order-5-mouse" } });
    expect(r.isError).toBe(true);
    expect(t.inventory.reservations.size).toBe(0);
    const short = await t.client.callTool({ name: "reserve_stock", arguments: { sku: "SKU-1001", warehouseCode: "CHN", quantity: 1, idempotencyKey: "x" } });
    expect(short.isError).toBe(true);
  });

  it("unexpected errors are masked from the caller but audited", async () => {
    t.inventory.getStock = async () => {
      throw new Error("connection string postgres://user:pw@host leaked");
    };
    const r = await t.call("check_stock", {});
    expect(r.isError).toBe(true);
    expect(r.text).not.toContain("postgres://");
    expect(t.audit.entries.at(-1)).toMatchObject({ tool: "check_stock", ok: false, error: "internal" });
  });

  it("search_policies cites sources, and says so when nothing matches", async () => {
    const hit = await t.call("search_policies", { query: "approval needed for orders above 50 units" });
    expect(hit.json[0]).toMatchObject({ source: "reservation-policy.md", section: "Large orders" });
    const miss = await t.call("search_policies", { query: "quantum chromodynamics lattice gauge" });
    expect(miss.json.result).toMatch(/No relevant policy/);
  });

  it("audits every call with actor, args and latency", async () => {
    await t.call("check_stock", { sku: "SKU-1002" });
    await t.call("reserve_stock", { sku: "SKU-1002", warehouseCode: "CHN", quantity: 99, idempotencyKey: "order-6-keyb" });
    const [ok, fail] = t.audit.entries;
    expect(ok).toMatchObject({ tool: "check_stock", actor: "test", ok: true, args: { sku: "SKU-1002" } });
    expect(ok.latencyMs).toBeGreaterThanOrEqual(0);
    expect(fail).toMatchObject({ tool: "reserve_stock", ok: false });
  });
});

describe("MCP over Streamable HTTP", () => {
  const post = (body: unknown) =>
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify(body),
    });

  it("answers initialize and tools/list statelessly", async () => {
    const { deps } = await makeDeps();
    const init = await handleMcpRequest(
      post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "1" } } }),
      deps
    );
    expect(init.status).toBe(200);
    expect((await init.json()).result.serverInfo.name).toBe("allo-inventory");

    const list = await handleMcpRequest(post({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }), deps);
    expect((await list.json()).result.tools).toHaveLength(8);
  });

  it("can call a tool over HTTP and is audited under the http actor", async () => {
    const { deps, audit } = await makeDeps();
    const res = await handleMcpRequest(
      post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "check_stock", arguments: { sku: "SKU-1002" } } }),
      deps
    );
    const body = await res.json();
    expect(JSON.parse(body.result.content[0].text)[0].sku).toBe("SKU-1002");
    expect(audit.entries[0].actor).toBe("http");
  });
});
