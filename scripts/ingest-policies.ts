/** Chunk + embed docs/policies/*.md into Postgres. Safe to re-run. npm run ingest */
import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getEmbedder } from "../lib/rag/embed";
import { ingest } from "../lib/rag/policies";
import { prismaPolicyStore } from "../lib/rag/policies.prisma";
import { prisma } from "../lib/prisma";

async function main() {
  const dir = path.join(process.cwd(), "docs", "policies");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  const docs = await Promise.all(files.map(async (f) => ({ source: f, markdown: await readFile(path.join(dir, f), "utf8") })));
  const embedder = getEmbedder();
  const n = await ingest(docs, { embedder, store: prismaPolicyStore });
  console.log(`Ingested ${n} chunks from ${files.length} files using ${embedder.name}`);
}

main().finally(() => prisma.$disconnect());
