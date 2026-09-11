# SEA-LION RAG Mockup

RAG mini buatan sendiri untuk **menguji model end-to-end** (grounding, refusal, citation, practice) dengan **retrieval + data kurikulum asli** — tanpa bergantung pada RantAI-Agents.

- **Ask / Learn** → model grounded (`rantai-sealion-v3`): jawab dari konteks, tolak kalau tidak ada, sebut sumber.
- **Practice** → base model (Apertus-SEA-LION) + JSON terstruktur: bikin soal dari materi.
- **Retrieval**: lexical (BM25-lite) atas 270 chunk asli (`data/chunks.json`), in-memory, per jenjang.

## Arsitektur

```
data/chunks.json ──► retrieve (top-k, per jenjang) ──► rakit "[Sumber]…" ──► Ollama
   (chunk asli)                                                                │
                                                          Ask/Learn → rantai-sealion-v3
                                                          Practice  → Apertus base + JSON schema
UI menampilkan jawaban + chunk sumber yang dipakai + prompt final.
```

## Jalankan lokal (dev)

> Butuh akses ke Ollama. Ollama di box **tidak** punya host port, jadi lokal set `OLLAMA_URL`
> ke endpoint yang bisa kamu jangkau (mis. tunnel), atau langsung deploy di box (di bawah).

```bash
npm install
OLLAMA_URL=http://localhost:11434 npm run dev
# buka http://localhost:3080
```

## Deploy di box GB10 (Portainer)

1. Cari nama network `llmops` asli: `docker network ls | grep llmops`
2. Isi `name:` di `stack.yml` (bagian `networks.llmops.external.name`).
3. Di Portainer → Stacks → Add stack → upload folder ini / build dari git → Deploy.
4. Buka **http://10.17.254.27:3080**

Env yang bisa diubah: `OLLAMA_URL`, `MODEL_GROUNDED`, `MODEL_BASE`.

## Ganti/isi ulang data

`data/chunks.json` = array `{ id, source, jenjang, text }`. Ganti dengan chunk lain
kapan saja (format sama), tidak perlu ubah kode.
