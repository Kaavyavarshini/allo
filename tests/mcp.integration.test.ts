/**
 * Integration: MCP server + real Postgres (Prisma inventory, audit log, policy store).
 * Needs the test DB (npm run test:db). Proves the agent-facing layer inherits
 * the core guarantee: concurrent tool calls never oversell.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "../lib/prisma";
import { prismaInventory } from "../lib/inventory.prisma";
import { prismaAudit } from "../lib/audit.prisma";
import { prismaPolicyStore } from "../lib/rag/policies.prisma";
import { HashEmbedder } from "../lib/rag/embed";
import { ingest, search } from "../lib/rag/policies";
import { createAlloServer } from "../mcp/server";
import { POLICY_DOCS } from "./helpers/fakes";

const embedder = new HashEmbedder();

async function connect() {
  const server = createAlloServer(
    { inventory: prismaInventory, audit: prismaAudit, policies: { search: (q, k) => search(q, { embedder, store: prismaPolicyStore }, k) } },
    "integration-test"
  );
  const [c, s] = InMemoryTransport.createLinkedPair();
  await server.connect(s);
  const client = new Client({ name: "t", version: "1" });
  await client.connect(c);
  return client;
}
const textOf = (r: object) => (r as { content: { text: string }[] }).content[0].text;

beforeEach(async () => {
  await prisma.toolCallLog.deleteMany();
  await prisma.policyChunk.deleteMany();
  await prisma.reservationItem.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.product.deleteMany();
  const w = await prisma.warehouse.create({ data: { code: "W1", name: "Main" } });
  const p = await prisma.product.create({ data: { sku: "SKU-1", name: "Widget" } });
  await prisma.stock.create({ data: { warehouseId: w.id, productId: p.id, onHand: 10 } });
});

afterAll(() => prisma.$disconnect());

describe("MCP + Postgres", () => {
  it("30 parallel reserve_stock tool calls on stock of 10: exactly 10 succeed, no oversell", async () => {
    const client = await connect();
    const results = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        client.callTool({ name: "reserve_stock", arguments: { sku: "SKU-1", warehouseCode: "W1", quantity: 1, idempotencyKey: `mcp-race-${i}-xx` } })
      )
    );
    expect(results.filter((r) => !r.isError)).toHaveLength(10);
    const failed = results.filter((r) => r.isError);
    expect(failed).toHaveLength(20);
    expect(textOf(failed[0])).toContain("INSUFFICIENT_STOCK");
    const [row] = await prismaInventory.getStock({ sku: "SKU-1" });
    expect(row).toMatchObject({ onHand: 10, reserved: 10, available: 0 });
  });

  it("reserve -> confirm through MCP updates real stock, and every call lands in ToolCallLog", async () => {
    const client = await connect();
    const res = JSON.parse(textOf(await client.callTool({ name: "reserve_stock", arguments: { sku: "SKU-1", warehouseCode: "W1", quantity: 4, idempotencyKey: "order-int-1-w" } })));
    await client.callTool({ name: "confirm_reservation", arguments: { reservationId: res.id } });
    const [row] = await prismaInventory.getStock({ sku: "SKU-1" });
    expect(row).toMatchObject({ onHand: 6, reserved: 0 });
    const logs = await prisma.toolCallLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.tool)).toEqual(["reserve_stock", "confirm_reservation"]);
    expect(logs.every((l) => l.ok && l.actor === "integration-test")).toBe(true);
  });

  it("policy chunks survive a Postgres round trip (Float[] embeddings) and are searchable", async () => {
    expect(await ingest(POLICY_DOCS, { embedder, store: prismaPolicyStore })).toBe(4);
    expect(await ingest(POLICY_DOCS, { embedder, store: prismaPolicyStore })).toBe(4); // idempotent
    expect(await prisma.policyChunk.count()).toBe(4);
    const [top] = await search("how many days to return a product", { embedder, store: prismaPolicyStore });
    expect(top).toMatchObject({ source: "supplier-returns.md", heading: "Return window" });
  });
});
