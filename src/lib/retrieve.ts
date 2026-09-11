import { loadChunks } from "./chunks";
import { ollamaEmbed } from "./ollama";
import type { Chunk, Hit, Jenjang } from "./types";

// Semantic retrieval with bge-m3 embeddings + cosine similarity. Chunk embeddings
// are PRECOMPUTED and baked into data/chunks.json (so we never embed the whole
// corpus at runtime — bge-m3 runs on CPU on this box and that would be slow). At
// query time we embed only the single query, then cosine against the baked vectors.

type Indexed = { chunk: Chunk; vec: number[] };
let index: Indexed[] | null = null;

function normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}

function getIndex(): Indexed[] {
  if (!index) {
    index = loadChunks()
      .filter((c) => Array.isArray(c.embedding) && c.embedding.length > 0)
      .map((c) => ({ chunk: c, vec: normalize(c.embedding as number[]) }));
  }
  return index;
}

/** Top-k chunks for a query within the student's grade, by cosine similarity. */
export async function retrieve(query: string, jenjang: Jenjang, k = 3): Promise<Hit[]> {
  const idx = getIndex();
  const [qv] = await ollamaEmbed([query]);
  const q = normalize(qv ?? []);
  const scored: Hit[] = idx
    .filter((x) => x.chunk.jenjang === jenjang)
    .map((x) => ({
      id: x.chunk.id,
      source: x.chunk.source,
      jenjang: x.chunk.jenjang,
      text: x.chunk.text, // embedding intentionally omitted from the response
      score: Number(dot(q, x.vec).toFixed(3)),
    }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}
