# Allo

Multi-warehouse inventory reservation system. Holds stock for a limited time, then either
confirms (stock leaves) or releases/expires it (stock returns), without ever overselling,
even under heavy concurrent load.

**Stack:** Next.js 15, TypeScript, Prisma, PostgreSQL, Zod, Vitest

## Why it's concurrency-safe
- **Atomic reserve:** availability check and increment happen in one SQL `UPDATE ... WHERE onHand - reserved >= qty`. No read-then-write race.
- **Guarded state transitions:** confirm / release / expire first claim the reservation with `UPDATE ... WHERE status = 'PENDING'`, so racing calls cannot both apply.
- **Idempotency keys:** retries return the same reservation instead of double-reserving.
- **Deadlock avoidance:** rows are always locked in a consistent order.
- **DB constraints:** `CHECK` constraints make negative or over-reserved stock impossible even if app code has a bug.

## Run locally
```bash
npm install
docker compose up -d                        # PostgreSQL
npx prisma migrate dev --name init          # create tables
npx prisma migrate dev --create-only --name add_constraints
# paste the contents of prisma/constraints.sql into the new migration.sql, then:
npx prisma migrate dev
npm run db:seed                             # sample warehouses, products, stock
npm run dev                                 # http://localhost:3000
```

## Test
```bash
docker compose exec db createdb -U allo allo_test
npm run test:db
npm test
```

## API
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/reservations` | Reserve stock (`idempotencyKey`, `items[]`, optional `ttlMinutes`) |
| POST | `/api/reservations/:id/confirm` | Confirm a pending hold |
| POST | `/api/reservations/:id/release` | Release a pending hold |
| GET | `/api/stock` | On hand / reserved / available per warehouse and SKU |
| GET | `/api/cron/expire` | Expire stale holds (`Authorization: Bearer $CRON_SECRET`) |

## Schema
`Warehouse`, `Product`, `Stock (warehouse x product)`, `Reservation`, `ReservationItem`.
