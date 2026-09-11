import { readFileSync } from "fs";
import { join } from "path";
import type { Chunk } from "./types";

// The mockup corpus: a small subset of REAL curriculum chunks (source + jenjang
// + text) extracted from the UGM corpus. Loaded once and cached — it is small
// enough to keep in memory (no vector DB needed for a mockup).
let cache: Chunk[] | null = null;

export function loadChunks(): Chunk[] {
  if (cache) return cache;
  const path = join(process.cwd(), "data", "chunks.json");
  cache = JSON.parse(readFileSync(path, "utf-8")) as Chunk[];
  return cache;
}
