import { prismaInventory } from "../lib/inventory.prisma";
import { prismaAudit } from "../lib/audit.prisma";
import { prismaPolicyStore } from "../lib/rag/policies.prisma";
import { getEmbedder } from "../lib/rag/embed";
import { search } from "../lib/rag/policies";
import type { Deps } from "./server";

/** Production wiring: real Postgres, real embedder, persistent audit log. */
export function prismaDeps(): Deps {
  const embedder = getEmbedder();
  return {
    inventory: prismaInventory,
    audit: prismaAudit,
    policies: { search: (q, k) => search(q, { embedder, store: prismaPolicyStore }, k) },
  };
}
