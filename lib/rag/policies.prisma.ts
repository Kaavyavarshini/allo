import { prisma } from "../prisma";
import type { PolicyStore } from "./policies";

export const prismaPolicyStore: PolicyStore = {
  async replaceAll(embedder, chunks) {
    await prisma.$transaction([
      prisma.policyChunk.deleteMany({ where: { embedder } }),
      prisma.policyChunk.createMany({
        data: chunks.map((c) => ({
          source: c.source,
          heading: c.heading,
          text: c.text,
          embedder: c.embedder,
          embedding: c.embedding,
        })),
      }),
    ]);
  },
  async load(embedder) {
    const rows = await prisma.policyChunk.findMany({ where: { embedder } });
    return rows.map((r) => ({
      source: r.source,
      heading: r.heading,
      text: r.text,
      embedder: r.embedder,
      embedding: r.embedding,
    }));
  },
};
