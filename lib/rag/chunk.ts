export type Chunk = { source: string; heading: string; text: string };

/**
 * Split a markdown document into retrieval chunks. Splits on headings first
 * (so each chunk is about one topic), then packs paragraphs up to `maxChars`.
 * The heading is kept as metadata so answers can cite "file > section".
 */
export function chunkMarkdown(source: string, markdown: string, maxChars = 700): Chunk[] {
  const chunks: Chunk[] = [];
  let heading = "(intro)";
  let buf: string[] = [];

  const flush = () => {
    const text = buf.join("\n\n").trim();
    if (text) chunks.push({ source, heading, text });
    buf = [];
  };

  const sections: { heading: string; body: string }[] = [];
  let cur = { heading, lines: [] as string[] };
  for (const line of markdown.split("\n")) {
    const m = /^#{1,4}\s+(.*)$/.exec(line);
    if (m) {
      sections.push({ heading: cur.heading, body: cur.lines.join("\n") });
      cur = { heading: m[1].trim(), lines: [] };
    } else cur.lines.push(line);
  }
  sections.push({ heading: cur.heading, body: cur.lines.join("\n") });

  for (const sec of sections) {
    heading = sec.heading;
    let size = 0;
    for (const para of sec.body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)) {
      if (size + para.length > maxChars && buf.length) {
        flush();
        size = 0;
      }
      buf.push(para);
      size += para.length;
    }
    flush();
  }
  return chunks;
}
