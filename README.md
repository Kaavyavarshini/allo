# Allo

Multi-warehouse inventory reservation system. Holds stock for a limited time, then either
confirms (stock leaves) or releases/expires it (stock returns), without ever overselling,
even under heavy concurrent load. Exposed to LLM agents through an **MCP server** with
policy **RAG**, an audit log, and a human-approval agent loop.

**Stack:** Next.js 15, TypeScript, Prisma, PostgreSQL, Zod, Vitest, Model Context Protocol, Anthropic SDK

## Why it's concurrency-safe
- **Atomic reserve:** availability check and increment happen in one SQL `UPDATE ... WHERE onHand - reserved >= qty`. No read-then-write race.
- **Guarded state transitions:** confirm / release / expire first claim the reservation with `UPDATE ... WHERE status = 'PENDING'`, so racing calls cannot both apply.
- **Idempotency keys:** retries return the same reservation instead of double-reserving.
- **Deadlock avoidance:** rows are always locked in a consistent order.
- **DB constraints:** `CHECK` constraints make negative or over-reserved stock impossible even if app code has a bug.

## Run locally
```bash
npm install
cp .env.example .env                        # then set CRON_SECRET and ALLO_API_KEY
docker compose up -d                        # PostgreSQL
npx prisma migrate dev --name init          # create tables (first time only)
npx prisma migrate dev --create-only --name add_constraints
# paste the contents of prisma/constraints.sql into the new migration.sql, then:
npx prisma migrate dev
# if you already had migrations from before the AI layer, just run:
#   npx prisma migrate dev --name add_agent_tables      (adds ToolCallLog + PolicyChunk)
npm run db:seed                             # sample warehouses, products, stock
npm run ingest                              # embed docs/policies/*.md for RAG
npm run dev                                 # http://localhost:3000
```

## AI layer

### Architecture
```
 Claude Desktop / Cursor / Claude Code ──stdio──┐
 Remote clients (Copilot, custom connectors) ─HTTP + API key─┤
 Built-in agent (npm run agent) ──in-memory MCP client──────┤
                                                             ▼
                                         mcp/server.ts  (8 tools, zod-validated, audited)
                                           │        │            │
                                  lib/inventory   RAG search   ToolCallLog
                                  (reserve/confirm  (policy      (latency, errors,
                                   atomic SQL)       chunks)       actor, args)
```

### MCP tools
| Tool | Kind | Purpose |
|---|---|---|
| `check_stock` | read | On hand / reserved / available, filter by SKU / warehouse |
| `find_availability` | read | Which warehouses can fulfil N units now |
| `low_stock_report` | read | SKU/warehouse pairs under a threshold |
| `get_reservation` | read | Status, expiry, items |
| `search_policies` | read | Semantic search over policy docs (returns sources) |
| `reserve_stock` | write | Temporary hold; requires an idempotency key |
| `confirm_reservation` | write, **destructive** | Stock permanently leaves |
| `release_reservation` | write | Return a hold to available stock |

Tools carry MCP `readOnlyHint` / `destructiveHint` annotations. Domain errors come back as readable tool
errors the model can recover from; unexpected errors are masked and logged.

### Use from Claude Desktop / Cursor (stdio)
```json
{
  "mcpServers": {
    "allo": {
      "command": "npx",
      "args": ["tsx", "/ABSOLUTE/PATH/TO/allo/mcp/stdio.ts"],
      "env": { "DATABASE_URL": "postgresql://allo:allo@localhost:5432/allo", "EMBEDDINGS": "local" }
    }
  }
}
```
stdout is the protocol channel, so all logging goes to stderr as JSON.

### Remote MCP (Streamable HTTP)
`POST /api/mcp` with `Authorization: Bearer $ALLO_API_KEY` (stateless; one server per request).
```bash
curl -s localhost:3000/api/mcp -H "Authorization: Bearer $ALLO_API_KEY" \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

### Agent with human approval
```bash
export ANTHROPIC_API_KEY=...
npm run agent -- "Reserve 12 Wireless Mouse for order ORD-77 from the best warehouse and check the policy first"
```
The agent discovers tools from the MCP server, chains them, and **asks before every write action**
(`--yes` to auto-approve). Capped at 8 turns. System prompt forbids inventing ids and confirming
without an explicit instruction.

### RAG over policies
`docs/policies/*.md` are split by heading, embedded, and stored in Postgres (`PolicyChunk`).
Search is cosine similarity with a minimum score, so an unrelated question returns "no relevant
policy" instead of a misleading paragraph. Embedders are pluggable (`EMBEDDINGS=local|hash`);
each chunk records which model produced its vector. The shipped docs are **samples**: replace them.

### Observability
Every tool call is logged as JSON (stderr) and persisted to `ToolCallLog` (tool, actor, args, ok,
error, latency). `GET /api/tool-calls?hours=24` (API key) returns per-tool volume, error rate, p50/p95.

### Security
- `/api/stock`, `/api/reservations/*`, `/api/mcp`, `/api/tool-calls` require `Authorization: Bearer $ALLO_API_KEY`. Unset key = locked (fail closed).
- Cron secret compared in constant time; unset secret no longer matches `Bearer undefined`.
- Arguments validated with Zod before any DB access; quantity caps on write tools.

## Test
```bash
npm run test:unit            # no database needed: auth, RAG, MCP server, agent loop, observability
docker compose exec db createdb -U allo allo_test
npm run test:db              # apply migrations to the test DB
npm test                     # everything, including the concurrency + MCP-over-Postgres tests
```

## API
| Method | Route | Purpose |
|---|---|---|
| POST | `/api/reservations` | Reserve stock (`idempotencyKey`, `items[]`, optional `ttlMinutes`) |
| POST | `/api/reservations/:id/confirm` | Confirm a pending hold |
| POST | `/api/reservations/:id/release` | Release a pending hold |
| GET | `/api/stock` | On hand / reserved / available per warehouse and SKU |
| GET | `/api/cron/expire` | Expire stale holds (`Authorization: Bearer $CRON_SECRET`) |
| POST | `/api/mcp` | Remote MCP endpoint |
| GET | `/api/tool-calls` | Tool-call metrics |

(All except cron require `Authorization: Bearer $ALLO_API_KEY`.)

## Schema
`Warehouse`, `Product`, `Stock (warehouse x product)`, `Reservation`, `ReservationItem`, `ToolCallLog`, `PolicyChunk`.
