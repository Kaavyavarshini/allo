export interface Embedder {
  /** Identifies the vector space. Stored with each chunk; never compare across names. */
  name: string;
  embed(texts: string[]): Promise<number[][]>;
}

const STOP = new Set(
  "a an the and or of to in on for with is are was were be by at as it this that from can do does not if then than".split(" ")
);

function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, (m, _g, off) => (off >= 3 ? "" : m));
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic, dependency-free embedder (hashed unigrams + bigrams, L2-normalised).
 * Purely lexical, so weaker than a neural model, but it needs no download or API key.
 * Used in tests and as an offline fallback.
 */
export class HashEmbedder implements Embedder {
  name = "hash-v1-512";
  constructor(private dim = 512) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t));
  }

  private one(text: string): number[] {
    const toks = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w)).map(stem);
    const v = new Array<number>(this.dim).fill(0);
    const add = (f: string, wgt: number) => {
      const h = fnv1a(f);
      v[h % this.dim] += (h & 0x80000000 ? -1 : 1) * wgt;
    };
    toks.forEach((t, i) => {
      add(t, 1);
      if (i > 0) add(toks[i - 1] + "_" + t, 0.5);
    });
    return normalise(v);
  }
}

/** Neural sentence embeddings, run locally via Hugging Face transformers.js (no API key). */
export class LocalEmbedder implements Embedder {
  name = "local:Xenova/all-MiniLM-L6-v2";
  private extractor?: Promise<(t: string[], o: object) => Promise<{ tolist(): number[][] }>>;

  async embed(texts: string[]): Promise<number[][]> {
    // Variable specifier: keeps the native onnxruntime dependency out of the Next.js bundle.
    const mod = "@huggingface/transformers";
    this.extractor ??= import(mod).then((m) => m.pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2"));
    const ex = await this.extractor;
    return (await ex(texts, { pooling: "mean", normalize: true })).tolist();
  }
}

export function getEmbedder(): Embedder {
  return process.env.EMBEDDINGS === "hash" ? new HashEmbedder() : new LocalEmbedder();
}

export function normalise(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
  return v.map((x) => x / n);
}

export function cosine(a: number[], b: number[]): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s; // vectors are L2-normalised, so the dot product is the cosine
}
