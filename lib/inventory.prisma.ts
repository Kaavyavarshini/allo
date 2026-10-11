import { prisma } from "./prisma";
import { reserve } from "./reserve";
import { confirm, release } from "./lifecycle";
import { InventoryError, type Inventory, type ReservationView, type StockRow } from "./inventory";

const toRow = (s: {
  onHand: number;
  reserved: number;
  warehouse: { code: string };
  product: { sku: string; name: string };
}): StockRow => ({
  warehouse: s.warehouse.code,
  sku: s.product.sku,
  name: s.product.name,
  onHand: s.onHand,
  reserved: s.reserved,
  available: s.onHand - s.reserved,
});

async function stockRows(where: { sku?: string; warehouseCode?: string } = {}) {
  const rows = await prisma.stock.findMany({
    where: {
      ...(where.sku ? { product: { sku: where.sku } } : {}),
      ...(where.warehouseCode ? { warehouse: { code: where.warehouseCode } } : {}),
    },
    include: { warehouse: true, product: true },
    orderBy: [{ warehouse: { code: "asc" } }, { product: { sku: "asc" } }],
  });
  return rows.map(toRow);
}

async function view(id: string): Promise<ReservationView | null> {
  const r = await prisma.reservation.findUnique({
    where: { id },
    include: { items: { include: { product: true, warehouse: true } } },
  });
  if (!r) return null;
  return {
    id: r.id,
    status: r.status,
    expiresAt: r.expiresAt.toISOString(),
    items: r.items.map((i) => ({ sku: i.product.sku, warehouse: i.warehouse.code, quantity: i.quantity })),
  };
}

export const prismaInventory: Inventory = {
  getStock: (f) => stockRows(f),

  async findAvailability(sku, quantity) {
    const rows = await stockRows({ sku });
    if (rows.length === 0) throw new InventoryError("UNKNOWN_SKU", `No such SKU: ${sku}`);
    return rows.filter((r) => r.available >= quantity).sort((a, b) => b.available - a.available);
  },

  async lowStock(threshold) {
    return (await stockRows()).filter((r) => r.available < threshold).sort((a, b) => a.available - b.available);
  },

  getReservation: view,

  async reserve({ sku, warehouseCode, quantity, idempotencyKey, ttlMinutes }) {
    const [product, warehouse] = await Promise.all([
      prisma.product.findUnique({ where: { sku } }),
      prisma.warehouse.findUnique({ where: { code: warehouseCode } }),
    ]);
    if (!product) throw new InventoryError("UNKNOWN_SKU", `No such SKU: ${sku}`);
    if (!warehouse) throw new InventoryError("UNKNOWN_WAREHOUSE", `No such warehouse: ${warehouseCode}`);
    try {
      const r = await reserve(
        idempotencyKey,
        [{ productId: product.id, warehouseId: warehouse.id, quantity }],
        ttlMinutes
      );
      return (await view(r.id))!;
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("INSUFFICIENT_STOCK")) {
        const [row] = await stockRows({ sku, warehouseCode });
        throw new InventoryError(
          "INSUFFICIENT_STOCK",
          `Only ${row?.available ?? 0} unit(s) of ${sku} available at ${warehouseCode}, requested ${quantity}.`
        );
      }
      throw e;
    }
  },

  confirm,
  release: (id) => release(id),
};
