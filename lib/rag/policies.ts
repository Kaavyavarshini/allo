import { chunkMarkdown, type Chunk } from "./chunk";
import { cosine, type Embedder } from "./embed";

export type StoredChunk = Chunk & { embedder: string; embedding: number[] };
export type PolicyHit = Chunk & { score: number };

export interface PolicyStore {
  /** Replace everything produced by this embedder (re-ingest is idempotent). */
  replaceAll(embedder: string, chunks: StoredChunk[]): Promise<void>;
  load(embedder: string): Promise<StoredChunk[]>;
}

export async function ingest(
  docs: { source: string; markdown: string }[],
  deps: { embedder: Embedder; store: PolicyStore }
): Promise<number> {
  const chunks = docs.flatMap((d) => chunkMarkdown(d.source, d.markdown));
  if (chunks.length === 0) return 0;
  // embed the heading with the text: "Returns > Time limit" matters for matching
  const vecs = await deps.embedder.embed(chunks.map((c) => `${c.heading}\n${c.text}`));
  await deps.store.replaceAll(
    deps.embedder.name,
    chunks.map((c, i) => ({ ...c, embedder: deps.embedder.name, embedding: vecs[i] }))
  );
  return chunks.length;
}

/**
 * Top-k semantic search. `minScore` filters weak matches so the agent gets
 * "nothing relevant" instead of confidently quoting an unrelated paragraph.
 */
export async function search(
  query: string,
  deps: { embedder: Embedder; store: PolicyStore },
  topK = 3,
  minScore = 0.15
): Promise<PolicyHit[]> {
  const [q] = await deps.embedder.embed([query]);
  const stored = await deps.store.load(deps.embedder.name);
  return stored
    .map((c) => ({ source: c.source, heading: c.heading, text: c.text, score: cosine(q, c.embedding) }))
    .filter((h) => h.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
