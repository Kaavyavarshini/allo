import { describe, it, expect } from "vitest";
import { chunkMarkdown } from "../lib/rag/chunk";
import { HashEmbedder, cosine } from "../lib/rag/embed";
import { search } from "../lib/rag/policies";
import { POLICY_DOCS, MemoryPolicyStore } from "./helpers/fakes";
import { ingest } from "../lib/rag/policies";

describe("chunkMarkdown", () => {
  it("splits on headings and keeps the heading as metadata", () => {
    const c = chunkMarkdown("a.md", "# T\n\n## One\nfoo\n\n## Two\nbar");
    expect(c.map((x) => x.heading)).toEqual(["One", "Two"]);
    expect(c[0]).toMatchObject({ source: "a.md", text: "foo" });
  });
  it("packs paragraphs up to maxChars and never emits empty chunks", () => {
    const body = Array.from({ length: 6 }, (_, i) => `para ${i} ${"x".repeat(100)}`).join("\n\n");
    const c = chunkMarkdown("a.md", `## S\n${body}`, 250);
    expect(c.length).toBeGreaterThan(1);
    expect(c.every((x) => x.text.length > 0 && x.heading === "S")).toBe(true);
  });
});

describe("HashEmbedder", () => {
  it("is deterministic and L2-normalised", async () => {
    const e = new HashEmbedder();
    const [a, b] = await e.embed(["hold duration", "hold duration"]);
    expect(a).toEqual(b);
    expect(cosine(a, a)).toBeCloseTo(1, 5);
  });
});

describe("policy search", () => {
  const embedder = new HashEmbedder();
  const setup = async () => {
    const store = new MemoryPolicyStore();
    const n = await ingest(POLICY_DOCS, { embedder, store });
    return { store, n };
  };

  it("ingests every chunk", async () => expect((await setup()).n).toBe(4));

  it.each([
    ["how long does a reservation hold stock", "reservation-policy.md", "Hold duration"],
    ["what approval is needed for orders above 50 units", "reservation-policy.md", "Large orders"],
    ["how many days do customers have to return a product", "supplier-returns.md", "Return window"],
    ["how long does supplier replenishment take", "supplier-returns.md", "Replenishment lead time"],
  ])("ranks the right section first for %j", async (q, source, heading) => {
    const { store } = await setup();
    const [top] = await search(q, { embedder, store }, 3);
    expect(top).toMatchObject({ source, heading });
  });

  it("returns nothing for an unrelated query instead of a weak match", async () => {
    const { store } = await setup();
    expect(await search("quantum chromodynamics lattice gauge", { embedder, store })).toEqual([]);
  });

  it("re-ingesting replaces rather than duplicates", async () => {
    const { store } = await setup();
    await ingest(POLICY_DOCS, { embedder, store });
    expect((await store.load(embedder.name)).length).toBe(4);
  });
});
