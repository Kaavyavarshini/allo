import { InventoryError, type Inventory, type ReservationView, type StockRow } from "../../lib/inventory";
import type { AuditEntry, AuditSink } from "../../lib/audit";
import { HashEmbedder } from "../../lib/rag/embed";
import { ingest, search, type PolicyStore, type StoredChunk } from "../../lib/rag/policies";
import type { Deps } from "../../mcp/server";

/** In-memory Inventory with the same observable rules as the real one (availability, idempotency, states). */
export class FakeInventory implements Inventory {
  stock: StockRow[] = [
    { warehouse: "CHN", sku: "SKU-1001", name: "Wireless Mouse", onHand: 30, reserved: 0, available: 30 },
    { warehouse: "BLR", sku: "SKU-1001", name: "Wireless Mouse", onHand: 12, reserved: 0, available: 12 },
    { warehouse: "HYD", sku: "SKU-1001", name: "Wireless Mouse", onHand: 4, reserved: 0, available: 4 },
    { warehouse: "CHN", sku: "SKU-1002", name: "Mechanical Keyboard", onHand: 3, reserved: 0, available: 3 },
  ];
  reservations = new Map<string, ReservationView & { key: string }>();
  private n = 0;

  private find(sku: string, wh: string) {
    return this.stock.find((s) => s.sku === sku && s.warehouse === wh);
  }
  async getStock(f: { sku?: string; warehouseCode?: string }) {
    return this.stock.filter((s) => (!f.sku || s.sku === f.sku) && (!f.warehouseCode || s.warehouse === f.warehouseCode));
  }
  async findAvailability(sku: string, q: number) {
    const rows = this.stock.filter((s) => s.sku === sku);
    if (!rows.length) throw new InventoryError("UNKNOWN_SKU", `No such SKU: ${sku}`);
    return rows.filter((r) => r.available >= q).sort((a, b) => b.available - a.available);
  }
  async lowStock(t: number) {
    return this.stock.filter((s) => s.available < t).sort((a, b) => a.available - b.available);
  }
  async getReservation(id: string) {
    return this.reservations.get(id) ?? null;
  }
  async reserve(i: { sku: string; warehouseCode: string; quantity: number; idempotencyKey: string }) {
    for (const r of this.reservations.values()) if (r.key === i.idempotencyKey) return r;
    const row = this.find(i.sku, i.warehouseCode);
    if (!row) {
      if (!this.stock.some((s) => s.sku === i.sku)) throw new InventoryError("UNKNOWN_SKU", `No such SKU: ${i.sku}`);
      throw new InventoryError("UNKNOWN_WAREHOUSE", `No such warehouse: ${i.warehouseCode}`);
    }
    if (row.available < i.quantity)
      throw new InventoryError("INSUFFICIENT_STOCK", `Only ${row.available} unit(s) of ${i.sku} available at ${i.warehouseCode}, requested ${i.quantity}.`);
    row.reserved += i.quantity;
    row.available -= i.quantity;
    const r = {
      id: `res_${++this.n}`,
      key: i.idempotencyKey,
      status: "PENDING" as const,
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      items: [{ sku: i.sku, warehouse: i.warehouseCode, quantity: i.quantity }],
    };
    this.reservations.set(r.id, r);
    return r;
  }
  async confirm(id: string) {
    const r = this.reservations.get(id);
    if (!r || r.status !== "PENDING") return false;
    r.status = "CONFIRMED";
    for (const it of r.items) {
      const row = this.find(it.sku, it.warehouse)!;
      row.onHand -= it.quantity;
      row.reserved -= it.quantity;
    }
    return true;
  }
  async release(id: string) {
    const r = this.reservations.get(id);
    if (!r || r.status !== "PENDING") return false;
    r.status = "RELEASED";
    for (const it of r.items) {
      const row = this.find(it.sku, it.warehouse)!;
      row.reserved -= it.quantity;
      row.available += it.quantity;
    }
    return true;
  }
}

export class MemoryAudit implements AuditSink {
  entries: AuditEntry[] = [];
  async record(e: AuditEntry) {
    this.entries.push(e);
  }
}

export class MemoryPolicyStore implements PolicyStore {
  private data = new Map<string, StoredChunk[]>();
  async replaceAll(embedder: string, chunks: StoredChunk[]) {
    this.data.set(embedder, chunks);
  }
  async load(embedder: string) {
    return this.data.get(embedder) ?? [];
  }
}

export const POLICY_DOCS = [
  {
    source: "reservation-policy.md",
    markdown: `# Reservation Policy\n\n## Hold duration\nA reservation holds stock for 15 minutes by default. Longer holds up to 120 minutes are allowed.\n\n## Large orders\nAny single reservation above 50 units requires approval from the regional operations manager.`,
  },
  {
    source: "supplier-returns.md",
    markdown: `# Supplier Returns\n\n## Return window\nCustomer returns are accepted within 30 days of delivery if the product is unopened.\n\n## Replenishment lead time\nStandard supplier lead time is 7 working days. Expedited replenishment arrives in 3 working days.`,
  },
];

export async function makeDeps(inventory = new FakeInventory()) {
  const embedder = new HashEmbedder();
  const store = new MemoryPolicyStore();
  await ingest(POLICY_DOCS, { embedder, store });
  const audit = new MemoryAudit();
  const deps: Deps = { inventory, audit, policies: { search: (q, k) => search(q, { embedder, store }, k) } };
  return { deps, inventory, audit };
}
