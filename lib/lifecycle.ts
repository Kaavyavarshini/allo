import { Prisma, ReservationStatus } from "@prisma/client";
import { prisma } from "./prisma";

type Tx = Prisma.TransactionClient;

/**
 * Atomically claim a reservation: flips status only if it is still in an allowed
 * state. Two racing callers (confirm vs expire, double release) cannot both win,
 * because the second UPDATE waits on the row lock and then matches 0 rows.
 */
async function claim(
  tx: Tx,
  id: string,
  from: ReservationStatus[],
  to: ReservationStatus,
  extra: Prisma.ReservationWhereInput = {}
) {
  const { count } = await tx.reservation.updateMany({
    where: { id, status: { in: from }, ...extra },
    data: { status: to },
  });
  return count === 1;
}

async function itemsOf(tx: Tx, reservationId: string) {
  const items = await tx.reservationItem.findMany({ where: { reservationId } });
  // consistent lock order across transactions -> no deadlocks
  return items.sort((a, b) =>
    (a.warehouseId + a.productId).localeCompare(b.warehouseId + b.productId)
  );
}

/** PENDING -> CONFIRMED: stock physically leaves (onHand and reserved both drop). */
export async function confirm(reservationId: string) {
  return prisma.$transaction(async (tx) => {
    const won = await claim(tx, reservationId, ["PENDING"], "CONFIRMED", {
      expiresAt: { gt: new Date() }, // can't confirm an expired hold
    });
    if (!won) return false;

    for (const it of await itemsOf(tx, reservationId)) {
      const n = await tx.$executeRaw`
        UPDATE "Stock"
        SET "onHand"   = "onHand"   - ${it.quantity},
            "reserved" = "reserved" - ${it.quantity},
            "version"  = "version" + 1
        WHERE "warehouseId" = ${it.warehouseId}
          AND "productId"   = ${it.productId}
          AND "reserved" >= ${it.quantity}`;
      if (n === 0) throw new Error("INVARIANT_VIOLATION: reserved < quantity");
    }
    return true;
  });
}

/** PENDING -> RELEASED (or EXPIRED): hold is returned to available stock. */
export async function release(
  reservationId: string,
  to: Extract<ReservationStatus, "RELEASED" | "EXPIRED"> = "RELEASED"
) {
  return prisma.$transaction(async (tx) => {
    const won = await claim(tx, reservationId, ["PENDING"], to);
    if (!won) return false;

    for (const it of await itemsOf(tx, reservationId)) {
      const n = await tx.$executeRaw`
        UPDATE "Stock"
        SET "reserved" = "reserved" - ${it.quantity},
            "version"  = "version" + 1
        WHERE "warehouseId" = ${it.warehouseId}
          AND "productId"   = ${it.productId}
          AND "reserved" >= ${it.quantity}`;
      if (n === 0) throw new Error("INVARIANT_VIOLATION: reserved < quantity");
    }
    return true;
  });
}

/** Sweep stale holds. Safe to run from cron / a route handler, concurrently or repeatedly. */
export async function expireStale(batch = 100) {
  const stale = await prisma.reservation.findMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    select: { id: true },
    take: batch,
  });
  // Sequential on purpose: 100 parallel transactions would exhaust the Prisma connection pool.
  // Concurrent sweeps stay safe because release() claims each row atomically.
  let expired = 0;
  for (const r of stale) if (await release(r.id, "EXPIRED")) expired++;
  return expired;
}
