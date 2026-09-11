export type Jenjang = "SD" | "SMP" | "SMA";

export type Chunk = {
  id: number;
  source: string;
  jenjang: Jenjang;
  text: string;
  /** Precomputed bge-m3 embedding, baked into data/chunks.json at build-prep time
   *  so retrieval never has to embed the whole corpus at runtime. */
  embedding?: number[];
};

/** A retrieved chunk plus the lexical score it matched the query with. */
export type Hit = Chunk & { score: number };

export type Mode = "ask" | "learn" | "practice" | "stem";

export type Mcq = {
  pertanyaan: string;
  opsi: { A: string; B: string; C: string; D: string };
  kunci: "A" | "B" | "C" | "D";
  penjelasan?: string;
};
