import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export type Line = { productId: string; warehouseId: string; quantity: number };

/**
 * Place a hold on stock. The availability check and the increment happen in a
 * single atomic UPDATE, so two concurrent requests can never both take the last unit.
 */
export async function reserve(idempotencyKey: string, lines: Line[], ttlMin = 15) {
  const existing = await prisma.reservation.findUnique({
    where: { idempotencyKey },
    include: { items: true },
  });
  if (existing) return existing; // idempotent retry

  // consistent lock order across transactions -> no deadlocks
  const sorted = [...lines].sort((a, b) =>
    (a.warehouseId + a.productId).localeCompare(b.warehouseId + b.productId)
  );

  try {
    return await prisma.$transaction(
      async (tx) => {
        for (const l of sorted) {
          const updated = await tx.$executeRaw`
            UPDATE "Stock"
            SET "reserved" = "reserved" + ${l.quantity}, "version" = "version" + 1
            WHERE "warehouseId" = ${l.warehouseId}
              AND "productId"   = ${l.productId}
              AND "onHand" - "reserved" >= ${l.quantity}`;
          if (updated === 0) {
            throw new Error(`INSUFFICIENT_STOCK:${l.productId}@${l.warehouseId}`);
          }
        }
        return tx.reservation.create({
          data: {
            idempotencyKey,
            expiresAt: new Date(Date.now() + ttlMin * 60_000),
            items: { create: sorted },
          },
          include: { items: true },
        });
      },
      { maxWait: 15000, timeout: 15000 }
    );
  } catch (e) {
    // two requests with the same key raced: the loser rolls back, return the winner's row
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const r = await prisma.reservation.findUnique({
        where: { idempotencyKey },
        include: { items: true },
      });
      if (r) return r;
    }
    throw e;
  }
}
