"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

import { matchFigures } from "@/lib/figures";

type Jenjang = "SD" | "SMP" | "SMA";
type Mode = "tanya" | "belajar" | "latihan";
type ChatMsg = { role: "user" | "assistant"; content: string };
type Source = { n: number; kind: "text" | "figure"; title: string; section: string; id?: string };
type FigureRef = { n: number; id: string; src: string; caption: string };
type ApiResult = {
  mode: Mode;
  model?: string;
  answer?: string;
  /** exactly what the model emitted, before the server's figure guards. */
  raw?: string;
  /** kalimat yang BENAR-BENAR dikirim ke model; gelembung siswa menampilkan ini. */
  userMsg?: string;
  sources?: Source[];
  /** kutipan yang melahirkan soal giliran ini; diteruskan apa adanya ke /api/grading. */
  excerpts?: { title: string; section: string; text: string }[];
  figures?: FigureRef[];
  turns?: number;
  system?: string;
  guardrail?: { blocked: boolean; topScore: number; threshold: number };
  error?: string;
};

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "tanya", label: "Tanya", hint: "Satu pertanyaan → jawaban langsung 3–6 kalimat." },
  { id: "belajar", label: "Belajar", hint: "Tutor sokratik — satu langkah per giliran, balik bertanya." },
  { id: "latihan", label: "Latihan", hint: "Bikin soal → kamu jawab → dinilai → rekap skor (4 tahap)." },
];

// Kelas offered per jenjang follow the books actually in the corpus: SD is Tema
// kelas I–II, SMP is Agama VII / Informatika + Pancasila VIII / IPA IX, SMA is
// Seni Musik + Teknik Mesin X / Sosiologi XI / Bahasa Indonesia XII.
const GRADES: { label: string; jenjang: Jenjang; kelas: string }[] = [
  { label: "SD Kelas 1", jenjang: "SD", kelas: "Kelas 1" },
  { label: "SD Kelas 2", jenjang: "SD", kelas: "Kelas 2" },
  { label: "SMP Kelas 7", jenjang: "SMP", kelas: "Kelas 7" },
  { label: "SMP Kelas 8", jenjang: "SMP", kelas: "Kelas 8" },
  { label: "SMP Kelas 9", jenjang: "SMP", kelas: "Kelas 9" },
  { label: "SMA Kelas 10", jenjang: "SMA", kelas: "Kelas 10" },
  { label: "SMA Kelas 11", jenjang: "SMA", kelas: "Kelas 11" },
  { label: "SMA Kelas 12", jenjang: "SMA", kelas: "Kelas 12" },
];

// Example prompts per jenjang × mode. Every topic here was checked against
// data/chunks.json for that jenjang, so a suggested question always has material
// to ground on — no chip leads to "tidak tahu berdasarkan buku".
const EXAMPLES: Record<Jenjang, Record<Mode, string[]>> = {
  SD: {
    tanya: [
      "Apa saja tugasku di rumah?",
      "Siapa saja anggota keluarga di rumah?",
      "Mengapa kita harus hidup rukun?",
      "Apa yang dilakukan sebelum berangkat sekolah?",
    ],
    belajar: [
      "Ajari aku tentang tugasku di sekolah",
      "Aku mau belajar hidup rukun dengan teman",
      "Ajari aku berdoa sebelum belajar",
      "Aku mau belajar bermain bersama teman",
    ],
    // Chip Latihan berisi TOPIK saja: jenis dan jumlah soal datang dari dropdown, persis
    // seperti produk aslinya. Chip berbunyi "Buatkan 3 soal ..." membuat penguji mengetik
    // perintah yang lalu bertabrakan dengan dropdown -- itu yang dulu menghasilkan
    // dropdown "4 soal" tetapi jawabannya 5 soal.
    latihan: ["tugasku di rumah", "hidup rukun", "anggota keluarga", "pengalaman di sekolah"],
  },
  SMP: {
    tanya: [
      "Apa itu kemagnetan dan bagaimana medan magnet terbentuk?",
      "Apa itu teknologi ramah lingkungan?",
      "Apa itu algoritma dalam pemrograman?", // verified: gambar tersisip inline
      "Bagaimana klien terhubung ke server dalam jaringan?", // verified: gambar tersisip inline
      "Apa saja lapisan tanah dan fungsinya?",
      "Apa itu bioteknologi pangan?",
      "Apa fungsi dan kedudukan UUD NRI Tahun 1945?", // sengaja tanpa gambar
    ],
    belajar: [
      "Ajari aku cara kerja jaringan komputer",
      "Aku mau paham partikel penyusun benda",
      "Jelaskan Pancasila sebagai dasar negara",
      "Ajari aku tentang perubahan bentuk energi",
      "Aku mau belajar fungsi UUD NRI Tahun 1945",
    ],
    latihan: ["kemagnetan", "algoritma dan pemrograman", "pengamalan Pancasila",
              "bioteknologi pangan", "teknologi ramah lingkungan", "salat berjamaah"],
  },
  SMA: {
    tanya: [
      "Apa saja unsur pembangun puisi?",
      "Apa itu teks editorial?",
      "Bagaimana alat musik dikelompokkan?",
      "Apa saja alat pelindung diri di bengkel?",
      "Apa yang dimaksud kelompok sosial?",
    ],
    belajar: [
      "Ajari aku menganalisis unsur novel",
      "Aku mau belajar membaca notasi musik",
      "Jelaskan kelompok sosial di masyarakat",
      "Ajari aku keselamatan kerja saat pengelasan",
      "Aku mau belajar rima dalam puisi",
    ],
    latihan: ["unsur puisi", "teks editorial", "pengelompokan alat musik",
              "kelompok sosial", "K3 dan perkakas bengkel"],
  },
};

function toDollars(s: string): string {
  return s
    .replace(/\\\[/g, "$$$$").replace(/\\\]/g, "$$$$")
    .replace(/\\\(/g, "$$").replace(/\\\)/g, "$$")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Replace [figure:N] tokens with a markdown image so figures render inline. */
function withFigures(text: string, figures: FigureRef[]): string {
  let out = text;
  for (const f of figures) {
    const re = new RegExp(`\\[figure:\\s*${f.n}\\]`, "gi");
    out = out.replace(re, `\n\n![${f.caption}](${f.src})\n\n`);
  }
  // Anything still matching [figure:N] points at a source that was never attached.
  // learn v7 once ran away emitting [figure:5] through [figure:112]; the loop above
  // leaves those untouched, so the student would read raw markup. Drop them, then
  // collapse the gap they leave behind.
  out = out.replace(/\[figure:\s*\d+\]/gi, "");
  out = out.replace(/\n{3,}/g, "\n\n");
  return out;
}

/** Latihan mode: the practice adapter emits STRUCTURED output the real app consumes
 *  ({soal:[{pertanyaan,opsi,kunci,level}]}) — the answer key is stored by RantAI
 *  Agents for grading, never shown to the student. The mockup used to dump that JSON
 *  on screen; parse it and render what a student would actually see, with the key
 *  tucked behind a toggle so we can still verify it came through. */
type Soal = { pertanyaan?: string; opsi?: Record<string, string>; kunci?: string; level?: string };

function parseSoal(text: string): Soal[] | null {
  const t = text.trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const o = JSON.parse(t.slice(start, end + 1)) as { soal?: unknown };
    if (Array.isArray(o.soal) && o.soal.length) return o.soal as Soal[];
  } catch {
    return null;
  }
  return null;
}

/** Balasan /api/grading. Bentuknya sengaja memisahkan yang ANDAL dari yang sekadar
 *  membantu -- diukur pada 99 kasus berlabel lewat endpoint ini: `keliru` benar 97%,
 *  `nilai_rinci` 91%. Yang 97% jadi kepala tampilan; yang 91% ditaruh di bawah dan
 *  diberi label untuk guru, bukan sebagai nilai siswa. */
type GradeResult = {
  dinilai?: boolean;
  alasan_tidak_dinilai?: string;
  keliru?: boolean;
  umpan_balik?: string;
  jawaban_benar?: string;
  sumber?: { n: number; judul: string; bagian: string }[];
  /** kalimat ASLI dari buku, dipilih kode -- ini yang dipegang siswa, bukan tulisan model */
  kutipan_buku?: { kalimat: string; n: number; judul: string; bagian: string; skor: number }[];
  /** true bila jawaban soal tidak ditemukan di bacaan buku -- diserahkan ke guru */
  perlu_guru?: boolean;
  dasar_soal?: string;
  nilai_rinci?: string;
  skor_grounding?: number;
  model?: string;
  error?: string;
};

/** Kotak jawab + hasil penilaian untuk SATU soal isian/uraian. */
function GradingBox({ pertanyaan, jenjang, kelas, topik, excerpts, level }:
  { pertanyaan: string; jenjang: Jenjang; kelas: string; topik?: string; level?: string;
    excerpts?: { title: string; section: string; text: string }[] }) {
  const [jawab, setJawab] = useState("");
  const [sedang, setSedang] = useState(false);
  const [hasil, setHasil] = useState<GradeResult | null>(null);

  async function nilai() {
    if (!jawab.trim() || sedang) return;
    setSedang(true);
    setHasil(null);
    try {
      const r = await fetch("/api/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soal: pertanyaan, jawaban_siswa: jawab.trim(), jenjang, kelas, topik, excerpts, level }),
      });
      setHasil((await r.json()) as GradeResult);
    } catch (e) {
      setHasil({ error: (e as Error).message });
    } finally {
      setSedang(false);
    }
  }

  return (
    <div style={{ marginTop: 9 }}>
      <textarea
        placeholder="Tulis jawabanmu di sini…"
        value={jawab}
        onChange={(e) => setJawab(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) nilai(); }}
        style={{ minHeight: 56 }}
      />
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn" onClick={nilai} disabled={sedang || !jawab.trim()}>
          {sedang ? (<><span className="spin" /> Menilai…</>) : "Nilai jawabanku"}
        </button>
        {hasil?.model && <span className="hint">model: {hasil.model}</span>}
      </div>
      {hasil && <HasilNilai hasil={hasil} />}
    </div>
  );
}

function HasilNilai({ hasil }: { hasil: GradeResult }) {
  if (hasil.error) return <div className="bubble err" style={{ marginTop: 8 }}>⚠️ {hasil.error}</div>;
  if (hasil.dinilai === false) {
    return (
      <div className="q-exp" style={{ marginTop: 8 }}>
        {hasil.perlu_guru ? "🧑‍🏫 " : "🛡 "}
        <b>{hasil.perlu_guru ? "Perlu diperiksa guru." : "Tidak dinilai."}</b> {hasil.alasan_tidak_dinilai}
        {typeof hasil.skor_grounding === "number" ? ` (skor ${hasil.skor_grounding.toFixed(3)})` : ""}
      </div>
    );
  }
  const keliru = hasil.keliru === true;
  return (
    <div
      style={{
        marginTop: 9, padding: "11px 13px", borderRadius: 10,
        border: "1px solid " + (keliru ? "var(--danger)" : "var(--ok)"),
        background: "var(--panel-2)",
      }}
    >
      <div style={{ fontWeight: 700, color: keliru ? "var(--danger)" : "var(--ok)" }}>
        {keliru ? "✗ Masih ada yang keliru" : "✓ Tidak ada yang keliru"}
      </div>
      {/* Yang dipegang siswa: kalimat ASLI dari buku, dipilih kode. Label "Menurut buku" dulu
          menempel pada `jawaban_benar` -- padahal itu tulisan model, dan uji tangan menemukannya
          mengarang fisika ("jarum kompas menunjuk ke kutub utara magnet"). */}
      {(hasil.kutipan_buku ?? []).length > 0 && (
        <div style={{ marginTop: 8 }}>
          <div className="meta" style={{ marginTop: 0 }}>
            📖 <b>Kalimat terkait dari buku</b> — kutipan asli, bukan tulisan AI; pilihannya bisa kurang tepat sasaran
          </div>
          {hasil.kutipan_buku!.map((k, i) => (
            <div key={i} className="q-exp" style={{ marginTop: 6 }}>
              “{k.kalimat}” <span style={{ opacity: 0.65 }}>[{k.n}]</span>
            </div>
          ))}
        </div>
      )}
      {(hasil.umpan_balik || hasil.jawaban_benar) && (
        <details style={{ marginTop: 8 }}>
          <summary className="meta" style={{ cursor: "pointer" }}>
            🤖 Penjelasan AI — bisa keliru; pegangan utamanya kalimat buku di atas
          </summary>
          {hasil.umpan_balik && (
            <div style={{ marginTop: 6, lineHeight: 1.5, opacity: 0.9 }}>{hasil.umpan_balik}</div>
          )}
          {hasil.jawaban_benar && (
            <div className="q-exp">
              <b>Jawaban versi AI:</b> {hasil.jawaban_benar}
            </div>
          )}
        </details>
      )}
      {(hasil.sumber ?? []).length > 0 && (
        <div className="meta">
          📚 {hasil.sumber!.map((x) => `[${x.n}] ${x.judul} — ${x.bagian}`).join(" · ")}
        </div>
      )}
      {/* Dipisahkan dan diberi peringatan DENGAN SENGAJA. Pada 99 kasus berlabel,
          "ada yang keliru / tidak" benar 97% sedangkan label tiga tingkat 91%; sisa
          kesalahannya hampir seluruhnya di perbatasan BENAR <-> BENAR SEBAGIAN. */}
      <div className="meta">
        📋 penilaian rinci: <b>{hasil.nilai_rinci}</b>
        <span style={{ opacity: 0.75 }}>
          {" "}— untuk guru, bukan nilai siswa (terukur 91%; benar/keliru 96%)
        </span>
        {typeof hasil.skor_grounding === "number" ? ` · grounding ${hasil.skor_grounding.toFixed(3)}` : ""}
      </div>
    </div>
  );
}

/** Pilihan ganda TIDAK lewat /api/grading. Kuncinya sudah ada di soal dan dicocokkan
 *  KODE -- itu kontrak yang disepakati dengan tim UGM, dan menirunya di sini menjaga
 *  mockup tetap jujur terhadap alur sebenarnya. */
function PilihanGanda({ opsi, kunci }: { opsi: Record<string, string>; kunci?: string }) {
  const [pilih, setPilih] = useState<string | null>(null);
  const [cek, setCek] = useState(false);
  const benar = pilih !== null && kunci !== undefined && pilih === kunci;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "grid", gap: 2 }}>
        {Object.entries(opsi).map(([k, v]) => (
          <label
            key={k}
            className="opt"
            style={{ cursor: "pointer", display: "flex", gap: 8, alignItems: "baseline",
                     color: cek && k === kunci ? "var(--ok)" : undefined }}
          >
            <input type="radio" checked={pilih === k} onChange={() => { setPilih(k); setCek(false); }} />
            <span><b>{k}.</b> {v}</span>
          </label>
        ))}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="chip" onClick={() => setCek(true)} disabled={pilih === null}>
          Periksa jawabanku
        </button>
        {cek && (
          <span style={{ color: benar ? "var(--ok)" : "var(--danger)", fontWeight: 600, fontSize: 13 }}>
            {benar ? "✓ Benar" : `✗ Kurang tepat — kuncinya ${kunci}`}
          </span>
        )}
      </div>
      {cek && <div className="meta">dicocokkan oleh KODE dengan kunci, bukan oleh model</div>}
    </div>
  );
}

/** Uji /api/grading tanpa harus membuat soal dulu: ketik soal dan jawaban apa saja.
 *  Berguna untuk memeriksa kasus tertentu -- misalnya jawaban yang MENUKAR dua hal
 *  berpasangan, yang masih jadi cacat sisa adapter v2 (2 dari 33 pada set uji). */
function UjiPenilaian({ jenjang, kelas }: { jenjang: Jenjang; kelas: string }) {
  const [soal, setSoal] = useState("");
  const [topik, setTopik] = useState("");
  const [jawab, setJawab] = useState("");
  const [sedang, setSedang] = useState(false);
  const [hasil, setHasil] = useState<GradeResult | null>(null);

  async function kirim() {
    if (!soal.trim() || !jawab.trim() || sedang) return;
    setSedang(true);
    setHasil(null);
    try {
      const r = await fetch("/api/grading", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ soal: soal.trim(), jawaban_siswa: jawab.trim(), jenjang, kelas,
                               topik: topik.trim() || undefined }),
      });
      setHasil((await r.json()) as GradeResult);
    } catch (e) {
      setHasil({ error: (e as Error).message });
    } finally {
      setSedang(false);
    }
  }

  return (
    <details style={{ marginTop: 14 }}>
      <summary>🧪 Uji API penilaian langsung (soal &amp; jawaban bebas)</summary>
      <div style={{ marginTop: 10 }}>
        <div className="meta" style={{ marginTop: 0 }}>
          Memanggil <code>POST /api/grading</code> — jalur yang sama yang dipakai RantAI Agents
          untuk menilai isian &amp; uraian. Retrieval memakai SOAL, jadi soalnya harus ada di buku
          jenjang <b>{jenjang}</b>; kalau tidak, guardrail menolak menilai.
        </div>
        <input placeholder="Topik (opsional, tapi sangat membantu retrieval) — misal: kemagnetan"
               value={topik} onChange={(e) => setTopik(e.target.value)}
               style={{ width: "100%", marginBottom: 8 }} />
        <textarea placeholder="Soal, misal: Sebutkan dua kutub yang dimiliki setiap magnet."
                  value={soal} onChange={(e) => setSoal(e.target.value)} style={{ minHeight: 52 }} />
        <textarea placeholder="Jawaban siswa…" value={jawab}
                  onChange={(e) => setJawab(e.target.value)} style={{ minHeight: 52, marginTop: 8 }} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" onClick={kirim} disabled={sedang || !soal.trim() || !jawab.trim()}>
            {sedang ? (<><span className="spin" /> Menilai…</>) : "Nilai"}
          </button>
          {hasil?.model && <span className="hint">model: {hasil.model}</span>}
        </div>
        {hasil && <HasilNilai hasil={hasil} />}
      </div>
    </details>
  );
}

function SoalList({ soal, jenjang, kelas, topik, excerpts }:
  { soal: Soal[]; jenjang: Jenjang; kelas: string; topik?: string;
    excerpts?: { title: string; section: string; text: string }[] }) {
  const [showKey, setShowKey] = useState(false);
  const adaKunci = soal.some((s) => s.kunci !== undefined);
  return (
    <div className="rich">
      <ol style={{ paddingLeft: 20, margin: 0 }}>
        {soal.map((s, i) => (
          <li key={i} style={{ marginBottom: 18 }}>
            <div>{s.pertanyaan}</div>
            {s.opsi ? (
              <PilihanGanda opsi={s.opsi} kunci={s.kunci} />
            ) : (
              s.pertanyaan && <GradingBox pertanyaan={s.pertanyaan} jenjang={jenjang} kelas={kelas} topik={topik} excerpts={excerpts} level={s.level} />
            )}
            {showKey && s.kunci !== undefined && (
              <div style={{ marginTop: 6, fontSize: 13, opacity: 0.85 }}>
                Kunci: <b>{s.kunci}</b>
                {s.level ? ` · level: ${s.level}` : ""}
              </div>
            )}
          </li>
        ))}
      </ol>
      {adaKunci ? (
        <button className="chip" style={{ marginTop: 10 }} onClick={() => setShowKey((v) => !v)}>
          {showKey ? "Sembunyikan kunci" : `Lihat kunci (${soal.length}) — disimpan aplikasi, tidak tampil ke siswa`}
        </button>
      ) : (
        <div className="meta">
          ℹ️ Isian dan uraian <b>tidak punya kunci</b> (disepakati dengan tim UGM) — jawabanmu dinilai
          lewat <code>/api/grading</code> oleh adapter penilai terpisah.
        </div>
      )}
    </div>
  );
}

/** Nomor yang BENAR-BENAR ditulis model sebagai [figure:N].
 *  Regex LITERAL, bukan yang dirakit dari template string: build sebelumnya memakai
 *  `\[figure:\s*N\]` di dalam template literal, tempat escape-nya luruh jadi kelas
 *  karakter [figures*N] yang cocok dengan hampir semua kalimat -- sehingga tiap giliran
 *  dilaporkan menyisipkan gambar padahal tidak. */
const writtenFigures = (text: string): Set<number> =>
  new Set((text.match(/\[figure:\s*\d+\]/gi) ?? [])
    .map((t) => Number(t.replace(/\D+/g, ""))));

/** One Elise turn, rendered with the result that produced IT.
 *  Figures, the gate-2 notice and the raw output are per-turn: the page used to hold
 *  only the latest result, so scrolling up showed earlier turns stripped of their
 *  images and the "not inserted" notice sat at the bottom describing the last turn
 *  while appearing to belong to the whole conversation. */
function AssistantTurn({ text, result, mode, jenjang, kelas, topik }:
  { text: string; result: ApiResult | null; mode: Mode; jenjang: Jenjang; kelas: string; topik?: string }) {
  const [showRaw, setShowRaw] = useState(false);
  const figures = result?.figures ?? [];
  const soal = mode === "latihan" ? parseSoal(text) : null;
  const written = writtenFigures(text);
  const unused = figures.filter((f) => !written.has(f.n));
  const inserted = figures.filter((f) => written.has(f.n));
  const raw = result?.raw;
  const dibersihkan = typeof raw === "string" && raw !== text;

  return (
    <div style={{ marginTop: 4 }}>
      {soal ? <SoalList soal={soal} jenjang={jenjang} kelas={kelas} topik={topik} excerpts={result?.excerpts} /> : <Rich text={text} figures={figures} />}

      {/* Gate 2 made visible: figures gate 1 attached that the model chose NOT to
          reference. Dimmed and labelled, never silently inlined as if it had. */}
      {unused.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="meta">
            🖼 <b>{unused.length} gambar tersedia, tidak disisipkan</b> — gerbang 1 (kode retrieval)
            melampirkannya ke Sources, tapi model tidak menulis <code>[figure:N]</code>.
          </div>
          {unused.map((f) => (
            <figure key={f.n} style={{ margin: "8px 0 0" }}>
              <img
                src={f.src}
                alt={f.caption}
                style={{ maxWidth: "100%", borderRadius: 8, opacity: 0.6, border: "1px dashed var(--border)" }}
              />
              <figcaption className="meta">[{f.n}] {f.caption}</figcaption>
            </figure>
          ))}
        </div>
      )}

      {typeof raw === "string" && (
        <>
          <button className="chip" style={{ marginTop: 10 }} onClick={() => setShowRaw((v) => !v)}>
            {showRaw ? "Sembunyikan raw output" : "⟨⟩ Lihat raw output model"}
          </button>
          {showRaw && (
            <div style={{ marginTop: 8 }}>
              <div className="meta" style={{ marginTop: 0 }}>
                Teks mentah dari <b>{result?.model}</b>, sebelum gerbang pembersih server.{" "}
                {inserted.length > 0
                  ? `Model MENULIS ${inserted.map((f) => `[figure:${f.n}]`).join(" ")} sendiri.`
                  : figures.length
                    ? "Model TIDAK menulis satu pun [figure:N] — gambar di atas dilampirkan kode, bukan dipilih model."
                    : "Tidak ada gambar dilampirkan untuk giliran ini."}
                {dibersihkan && " ⚠️ Berbeda dari yang tampil: server membuang tag tak valid / mengempaskan loop."}
              </div>
              <pre>{raw}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Rich({ text, figures }: { text: string; figures: FigureRef[] }) {
  return (
    <div className="rich">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {withFigures(toDollars(text), figures)}
      </ReactMarkdown>
    </div>
  );
}

export default function Page() {
  const [mode, setMode] = useState<Mode>("tanya");
  const [gradeIdx, setGradeIdx] = useState(2); // SMP Kelas 8
  const [query, setQuery] = useState("");
  // Di produk asli, siswa memilih jenis dan jumlah soal lewat UI lalu hanya mengetik
  // topiknya. Mockup dulu chat teks bebas, jadi ia selalu melewati TAHAP 1 -- jalur yang
  // TIDAK ADA di produk. Itu sumber beberapa salah paham: menguji di sini berarti menguji
  // alur yang berbeda dari yang dialami siswa.
  const [tipe, setTipe] = useState<"mcq" | "uraian" | "isian">("mcq");
  const [jumlah, setJumlah] = useState(5);
  const [loading, setLoading] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  // one slot per chat message (null for the student's own turns) so every Elise turn
  // keeps the figures, model and raw output that actually produced it
  const [meta, setMeta] = useState<(ApiResult | null)[]>([]);
  const [last, setLast] = useState<ApiResult | null>(null);
  // Topik yang dipakai membuat soal Latihan. Dikirim ke /api/grading supaya retrieval
  // tidak hanya bersandar pada kalimat rumpang soal isian, yang meretrieve buruk.
  const [topikSesi, setTopikSesi] = useState("");

  const grade = GRADES[gradeIdx];

  function reset() {
    setChat([]);
    setMeta([]);
    setLast(null);
    setTopikSesi("");
  }

  function switchMode(m: Mode) {
    setMode(m);
    reset();
    setQuery("");
  }

  async function send() {
    if (!query.trim() || loading) return;
    const q = query.trim();
    setLoading(true);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode, jenjang: grade.jenjang, kelas: grade.kelas, query: q, history: chat,
          ...(mode === "latihan" ? { tipe, jumlah } : {}),
        }),
      });
      const result = (await r.json()) as ApiResult;
      setLast(result);
      if (mode === "latihan") setTopikSesi(q);
      if (result.answer) {
        // Tampilkan kalimat yang dikirim, bukan yang diketik. Gelembung yang menampilkan
        // ketikan mentah pernah menyesatkan: dropdown "4 soal" sementara gelembungnya
        // berbunyi "Buatkan 5 soal", dan sumber selisihnya tidak terlihat sama sekali.
        setChat((c) => [...c, { role: "user", content: result.userMsg ?? q },
                              { role: "assistant", content: result.answer! }]);
        setMeta((m) => [...m, null, result]);
        setQuery("");
      }
    } catch (e) {
      setLast({ mode, error: (e as Error).message });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="wrap">
      <h1 className="title">🤖 RantAI Agents — Mockup</h1>
      <p className="subtitle">
        Faithful ke kontrak fine-tuning tim RantAI Agents: persona <b>Elise</b> verbatim + instruksi
        platform + blok <code>## Knowledge Base Context</code> (Excerpts / Sources / [FIGURE]), disajikan
        via vLLM — satu adapter LoRA per mode (nama adapter yang benar-benar melayani ditampilkan di
        bawah tiap jawaban). Gambar &amp; sitasi <code>[n]</code>/<code>[figure:N]</code> dirender
        end-to-end.
      </p>

      <div className="card">
        <div className="row">
          <div className="tabs">
            {MODES.map((m) => (
              <button key={m.id} className={`tab${mode === m.id ? " active" : ""}`} onClick={() => switchMode(m.id)}>
                {m.label}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <label>Jenjang</label>
          <select value={gradeIdx} onChange={(e) => { setGradeIdx(Number(e.target.value)); reset(); }}>
            {GRADES.map((g, i) => (
              <option key={g.label} value={i}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        <div className="meta" style={{ marginBottom: 10 }}>
          💬 {MODES.find((m) => m.id === mode)!.hint}
          {chat.length > 0 && (
            <span className="chip" style={{ marginLeft: 8 }} onClick={reset}>
              ↺ Mulai ulang
            </span>
          )}
        </div>

        {mode === "latihan" && (
          <div className="row" style={{ marginBottom: 10 }}>
            <label>Jenis soal</label>
            <select value={tipe} onChange={(e) => setTipe(e.target.value as typeof tipe)}>
              <option value="mcq">Pilihan ganda</option>
              <option value="uraian">Uraian</option>
              <option value="isian">Isian singkat</option>
            </select>
            <label>Jumlah</label>
            <select value={jumlah} onChange={(e) => setJumlah(Number(e.target.value))}>
              {[3, 4, 5, 10].map((n) => (
                <option key={n} value={n}>{n} soal</option>
              ))}
            </select>
            <span className="hint">Kamu cukup mengetik topiknya.</span>
          </div>
        )}
        <textarea
          placeholder={mode === "latihan" ? "Ketik topiknya saja, misal: kemagnetan" : chat.length ? "Balas / tanya lanjut… (konteks diingat)" : "Ketik pesan siswa…"}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }}
        />
        {/* Each chip is tagged with whether a [FIGURE] source will be attached for
            this question — computed from the same matchFigures() the API uses, so
            the badge can't drift from actual behaviour. Handy for testing figures. */}
        <div className="chips">
          {(chat.length ? [] : EXAMPLES[grade.jenjang][mode]).map((ex) => {
            const figs = matchFigures(ex, grade.jenjang, 2);
            return (
              <span
                key={ex}
                className="chip"
                onClick={() => setQuery(ex)}
                title={
                  figs.length
                    ? `Gambar dilampirkan ke Sources: ${figs.map((f) => f.caption).join(" • ")}`
                    : "Tidak ada gambar untuk topik ini — jawaban seharusnya teks saja"
                }
                style={figs.length ? { borderColor: "var(--accent)" } : undefined}
              >
                {figs.length ? "🖼 " : "○ "}
                {ex}
              </span>
            );
          })}
        </div>
        {chat.length === 0 && (
          <div className="meta" style={{ marginTop: 6 }}>
            🖼 = <b>gambar disediakan</b> — kode melampirkannya ke Sources. Yang memutuskan gambar itu{" "}
            <i>tampil</i> adalah modelnya (harus menulis <code>[figure:N]</code>); kalau tidak, gambarnya
            tetap ditampilkan di bagian &quot;tidak disisipkan model&quot; supaya terlihat. · ○ = tidak ada
            gambar untuk topik ini.
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={send} disabled={loading || !query.trim()}>
            {loading ? (<><span className="spin" /> Menjawab…</>) : "Kirim"}
          </button>
          <span className="hint">
            Ctrl/Cmd + Enter{last?.model ? ` · model: ${last.model}` : ""}
          </span>
        </div>
      </div>

      <UjiPenilaian jenjang={grade.jenjang} kelas={grade.kelas} />

      {(chat.length > 0 || loading || last?.error) && (
        <div className="answer">
          {chat.map((m, i) => (
            <div key={i} className="bubble" style={m.role === "user" ? { marginLeft: "auto", maxWidth: "85%", borderColor: "var(--accent)" } : { maxWidth: "85%" }}>
              <b style={{ opacity: 0.7, fontSize: ".85em" }}>{m.role === "user" ? "🧑‍🎓 Siswa" : "🤖 Elise"}</b>
              {m.role === "assistant" ? (
                <AssistantTurn text={m.content} result={meta[i] ?? null} mode={mode}
                               jenjang={grade.jenjang} kelas={grade.kelas} topik={topikSesi} />
              ) : (
                <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{m.content}</div>
              )}
            </div>
          ))}
          {loading && (<div className="bubble" style={{ maxWidth: "85%" }}><span className="spin" /> Elise sedang mengetik…</div>)}
          {last?.error && <div className="bubble err">⚠️ {last.error}</div>}

          {last?.model && (
            <div className="meta">
              🧠 model: <b style={{ color: "var(--accent)" }}>{last.model}</b>
              {last.turns ? ` · giliran ke-${last.turns}` : ""}
              {last.guardrail && (
                <span style={{ marginLeft: 8 }}>
                  · 🛡 {last.guardrail.blocked ? "guardrail MEMBLOKIR" : "grounding lolos"}{" "}
                  <span style={{ opacity: 0.75 }}>
                    (skor {last.guardrail.topScore.toFixed(3)} vs ambang{" "}
                    {last.guardrail.threshold.toFixed(2)})
                  </span>
                </span>
              )}
            </div>
          )}

          {(last?.sources ?? []).length > 0 && (
            <>
              <div className="section-label">Sources · {last!.sources!.length}</div>
              {last!.sources!.map((s) => (
                <div className="src" key={s.n}>
                  <div className="src-head">
                    <span className="src-name">
                      [{s.n}] {s.kind === "figure" ? "🖼️ [FIGURE] " : ""}
                      {s.title} — {s.section}
                    </span>
                  </div>
                </div>
              ))}
            </>
          )}

          {last?.system && (
            <details style={{ marginTop: 14 }}>
              <summary>Lihat prompt kontrak (system) yang dikirim ke model</summary>
              <pre>{last.system}</pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
