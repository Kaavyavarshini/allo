import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../lib/prisma";
import { reserve } from "../lib/reserve";
import { confirm, release, expireStale } from "../lib/lifecycle";

let warehouseId: string, productId: string;

const stock = () =>
  prisma.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } });

beforeEach(async () => {
  await prisma.reservationItem.deleteMany();
  await prisma.reservation.deleteMany();
  await prisma.stock.deleteMany();
  await prisma.warehouse.deleteMany();
  await prisma.product.deleteMany();
  warehouseId = (await prisma.warehouse.create({ data: { code: "W1", name: "Main" } })).id;
  productId = (await prisma.product.create({ data: { sku: "SKU-1", name: "Widget" } })).id;
  await prisma.stock.create({ data: { warehouseId, productId, onHand: 10 } });
});

afterAll(() => prisma.$disconnect());

describe("reservation concurrency", () => {
  it("50 parallel reserves on stock of 10: exactly 10 succeed, never oversells", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 50 }, (_, i) =>
        reserve(`key-${i}-xxxxxxxx`, [{ warehouseId, productId, quantity: 1 }])
      )
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(10);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(40);
    const s = await stock();
    expect(s.reserved).toBe(10);
    expect(s.onHand - s.reserved).toBe(0);
  });

  it("same idempotency key (even concurrent) returns one reservation and reserves once", async () => {
    const line = [{ warehouseId, productId, quantity: 3 }];
    const [a, b] = await Promise.all([reserve("dup-key-1", line), reserve("dup-key-1", line)]);
    expect(a.id).toBe(b.id);
    expect((await stock()).reserved).toBe(3);
  });

  it("confirm vs release race: exactly one wins, stock stays consistent", async () => {
    const r = await reserve("race-key-1", [{ warehouseId, productId, quantity: 4 }]);
    await Promise.allSettled([confirm(r.id), release(r.id)]);
    const s = await stock();
    const final = await prisma.reservation.findUniqueOrThrow({ where: { id: r.id } });
    if (final.status === "CONFIRMED") expect(s).toMatchObject({ onHand: 6, reserved: 0 });
    else expect(s).toMatchObject({ onHand: 10, reserved: 0 });
  });

  it("expireStale releases lapsed holds and is safe to run in parallel", async () => {
    const r = await reserve("old-key-12", [{ warehouseId, productId, quantity: 5 }]);
    await prisma.reservation.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const counts = await Promise.all([expireStale(), expireStale()]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await stock()).toMatchObject({ onHand: 10, reserved: 0 });
  });

  it("confirm is rejected after the hold has expired", async () => {
    const r = await reserve("exp-key-12", [{ warehouseId, productId, quantity: 2 }]);
    await prisma.reservation.update({ where: { id: r.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await confirm(r.id)).toBe(false);
  });
});
