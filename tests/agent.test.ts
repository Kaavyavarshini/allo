import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAlloServer } from "../mcp/server";
import { runAgent, type ContentBlock, type Llm, type Message } from "../lib/agent/run";
import { makeDeps } from "./helpers/fakes";

/** Scripted LLM: replays pre-written assistant turns and records what it was sent. */
function scripted(turns: { stop: string; content: ContentBlock[] }[]) {
  const seen: Message[][] = [];
  let i = 0;
  const llm: Llm = {
    async create(p) {
      seen.push(structuredClone(p.messages));
      const t = turns[Math.min(i++, turns.length - 1)];
      return { stop_reason: t.stop, content: t.content };
    },
  };
  return { llm, seen };
}
const use = (id: string, name: string, input: Record<string, unknown>): ContentBlock => ({ type: "tool_use", id, name, input });
const text = (t: string): ContentBlock => ({ type: "text", text: t });

async function setup() {
  const ctx = await makeDeps();
  const [c, s] = InMemoryTransport.createLinkedPair();
  await createAlloServer(ctx.deps, "agent").connect(s);
  const mcp = new Client({ name: "a", version: "1" });
  await mcp.connect(c);
  return { ...ctx, mcp };
}

describe("agent loop", () => {
  it("chains read -> write tools, feeds results back, and returns the final answer", async () => {
    const { mcp, inventory } = await setup();
    const { llm, seen } = scripted([
      { stop: "tool_use", content: [use("t1", "find_availability", { sku: "SKU-1001", quantity: 10 })] },
      { stop: "tool_use", content: [use("t2", "reserve_stock", { sku: "SKU-1001", warehouseCode: "CHN", quantity: 10, idempotencyKey: "ORD-9-SKU-1001-CHN" })] },
      { stop: "end_turn", content: [text("Reserved 10 mice at CHN.")] },
    ]);
    const r = await runAgent({ llm, mcp, task: "reserve 10 mice", model: "m", approve: async () => true });
    expect(r.answer).toBe("Reserved 10 mice at CHN.");
    expect(r.turns).toBe(3);
    expect(r.toolCalls.map((t) => t.name)).toEqual(["find_availability", "reserve_stock"]);
    expect(inventory.reservations.size).toBe(1);
    // the tool result from turn 1 reached the model on turn 2
    const last = seen[1].at(-1) as { role: string; content: { tool_use_id: string; content: string }[] };
    expect(last.role).toBe("user");
    expect(last.content[0].tool_use_id).toBe("t1");
    expect(JSON.parse(last.content[0].content).map((r: { warehouse: string }) => r.warehouse)).toEqual(["CHN", "BLR"]);
  });

  it("read-only tools never ask for approval; write tools always do", async () => {
    const { mcp } = await setup();
    const asked: string[] = [];
    const { llm } = scripted([
      { stop: "tool_use", content: [use("a", "check_stock", {}), use("b", "reserve_stock", { sku: "SKU-1002", warehouseCode: "CHN", quantity: 1, idempotencyKey: "ORD-1-SKU-1002" })] },
      { stop: "end_turn", content: [text("done")] },
    ]);
    await runAgent({ llm, mcp, task: "x", model: "m", approve: async (c) => (asked.push(c.name), true) });
    expect(asked).toEqual(["reserve_stock"]);
  });

  it("a rejected write is NOT executed and the model is told not to retry", async () => {
    const { mcp, inventory } = await setup();
    const { llm, seen } = scripted([
      { stop: "tool_use", content: [use("a", "reserve_stock", { sku: "SKU-1001", warehouseCode: "CHN", quantity: 5, idempotencyKey: "ORD-2-SKU-1001" })] },
      { stop: "end_turn", content: [text("Understood, nothing reserved.")] },
    ]);
    const r = await runAgent({ llm, mcp, task: "x", model: "m", approve: async () => false });
    expect(inventory.reservations.size).toBe(0);
    expect(r.toolCalls[0]).toMatchObject({ rejected: true });
    expect(JSON.stringify(seen[1].at(-1))).toContain("rejected");
  });

  it("flags destructive tools to the approver", async () => {
    const { mcp, inventory } = await setup();
    const res = await inventory.reserve({ sku: "SKU-1001", warehouseCode: "CHN", quantity: 2, idempotencyKey: "ORD-3-SKU-1001" });
    let flagged = false;
    const { llm } = scripted([
      { stop: "tool_use", content: [use("a", "confirm_reservation", { reservationId: res.id })] },
      { stop: "end_turn", content: [text("ok")] },
    ]);
    await runAgent({ llm, mcp, task: "x", model: "m", approve: async (c) => ((flagged = c.destructive), true) });
    expect(flagged).toBe(true);
  });

  it("tool errors are returned to the model with is_error so it can recover", async () => {
    const { mcp } = await setup();
    const { llm, seen } = scripted([
      { stop: "tool_use", content: [use("a", "reserve_stock", { sku: "SKU-1001", warehouseCode: "HYD", quantity: 50, idempotencyKey: "ORD-4-SKU-1001" })] },
      { stop: "end_turn", content: [text("HYD is short; suggest CHN.")] },
    ]);
    const r = await runAgent({ llm, mcp, task: "x", model: "m", approve: async () => true });
    expect(r.toolCalls[0].isError).toBe(true);
    const fed = (seen[1].at(-1) as { content: { is_error?: boolean; content: string }[] }).content[0];
    expect(fed.is_error).toBe(true);
    expect(fed.content).toContain("INSUFFICIENT_STOCK");
  });

  it("stops at the turn limit instead of looping forever", async () => {
    const { mcp } = await setup();
    const { llm } = scripted([{ stop: "tool_use", content: [use("a", "check_stock", {})] }]);
    const r = await runAgent({ llm, mcp, task: "x", model: "m", approve: async () => true, maxTurns: 3 });
    expect(r.hitTurnLimit).toBe(true);
    expect(r.turns).toBe(3);
  });

  it("an unknown tool name from the model is reported as an error, not executed", async () => {
    const { mcp } = await setup();
    const { llm } = scripted([
      { stop: "tool_use", content: [use("a", "drop_database", {})] },
      { stop: "end_turn", content: [text("ok")] },
    ]);
    const r = await runAgent({ llm, mcp, task: "x", model: "m", approve: async () => true });
    expect(r.toolCalls[0]).toMatchObject({ name: "drop_database", isError: true });
  });
});
