import type { NextRequest } from "next/server";

import { retrieve } from "@/lib/retrieve";
import { hitsToExcerpts } from "@/lib/excerpts";
import { vllmChat } from "@/lib/llm";
import { ollamaEmbed } from "@/lib/ollama";
import { kataPenting, layakDitampilkan, pecahKalimat, verifikasiSalinanModel } from "@/lib/bacaan";
import type { Jenjang } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * API penilaian jawaban siswa.
 *
 * Dipanggil RantAI Agents SETELAH siswa menjawab soal isian/uraian dari mode Latihan.
 * Pilihan ganda TIDAK lewat sini -- kuncinya sudah ada di soal dan dicocokkan kode.
 *
 * BENTUK KELUARAN MENGIKUTI APA YANG TERUKUR, bukan apa yang enak dibayangkan.
 * Adapter grading v2, 99 kasus berlabel yang tidak sekalipun ikut melatihnya:
 *
 *     "ada yang keliru atau tidak"   (`keliru`)        96%
 *     label tiga tingkat             (`nilai_rinci`)   91%
 *
 * YANG TAMPIL KE SISWA: `keliru` + `kutipan_buku`. Kutipan buku adalah kalimat ASLI dari
 * excerpts, dipilih KODE -- bukan ditulis model -- jadi mustahil berisi karangan.
 *
 * `umpan_balik` dan `jawaban_benar` adalah TULISAN MODEL. Uji tangan menemukan keduanya bisa
 * mengarang fisika sambil memasang sitasi [1]: "kutub utara dan selatan saling berhadiran,
 * jadi saling menolak" -- kata "berhadiran" muncul 0 kali di seluruh korpus, dan kutub
 * berbeda nama menurut buku justru tarik-menarik. Sitasi bukan bukti kebenaran. Tampilkan
 * keduanya hanya dengan label penjelasan AI.
 *
 * GERBANG DASAR SOAL. Sebelum menilai, model dasar diminta MENYALIN kalimat buku yang memuat
 * jawaban soal (untuk soal penerapan: prinsip yang dipakai menjawabnya). Salinannya dicocokkan KODE
 * ke kalimat buku yang sebenarnya. Kalau tidak ada yang cocok, jawaban TIDAK dinilai dan diserahkan
 * ke guru -- sesuai PRD: bila informasi tidak cukup, nyatakan bahwa jawabannya tidak dapat
 * ditentukan dari buku. Menilai soal yang jawabannya tidak ada di bacaan berarti menilai dari
 * ingatan model; uji tangan menemukan soal semacam itu, dibangun dari soal latihan buku.
 * Kalimat buku hasil gerbang ini juga yang ditampilkan ke siswa.
 *
 * Jangan tampilkan `nilai_rinci` sebagai nilai siswa tanpa guru yang memeriksanya.
 */

const MODEL = process.env.GRADING_MODEL ?? "grading";
const K = 4;

/** Ambang grounding, sama dengan /api/chat: top-1 bge-m3 di bawah ini berarti
 *  soalnya di luar korpus, dan menilai jawabannya berarti menilai dari ingatan model. */
const AMBANG = 0.55;

type Nilai = "BENAR" | "BENAR SEBAGIAN" | "SALAH";

type KalimatBuku = { kalimat: string; n: number; judul: string; bagian: string; skor: number };

function satuan(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

/** Pilih dua kalimat ASLI dari kutipan yang paling relevan dengan soal ini.
 *  Dua tahap: saringan kata kunci ke 24 kandidat, baru diperingkat embedding bge-m3. bge-m3
 *  berjalan di CPU di box ini, jadi meng-embed seluruh kalimat kutipan tiap penilaian terlalu
 *  lambat.
 *  Kueri = soal + `jawaban_benar` model. Karangan model tidak bisa tampil ke layar karena yang
 *  ditampilkan selalu kalimat buku, tetapi ia bisa ikut MENYETIR kalimat mana yang dipilih.
 *  Versi "soal saja" sudah dicoba untuk menutup risiko itu, dan HASILNYA LEBIH BURUK pada 4 dari
 *  5 kasus kemagnetan: definisi diamagnetik hilang, kalimat "apungkan magnet di atas gabus" untuk
 *  menentukan kutub hilang, dan potongan pertanyaan buku ikut naik. Soal berisi kata tanya,
 *  kalimat buku berisi kata jawaban; jawaban_benar lebih sering menjembatani keduanya daripada
 *  menyesatkannya. Relevansi pada skala 99 kasus BELUM diukur -- pilihan ini baru didukung 5 kasus.
 *  Kalau embedding gagal, peringkat jatuh ke skor kata kunci -- penilaian tidak ikut gagal. */
async function pilihKalimatBuku(
  kutipan: { title: string; section: string; text: string }[],
  soal: string,
  jawabanBenar: string,
): Promise<KalimatBuku[]> {
  const kandidat: { kalimat: string; n: number; judul: string; bagian: string; lex: number }[] = [];
  const sudah = new Set<string>();
  kutipan.forEach((e, i) => {
    for (const k of pecahKalimat(e.text)) {
      // Chunk korpus saling bertumpang tindih; kalimat yang sama jangan muncul dua kali.
      if (!layakDitampilkan(k) || sudah.has(k)) continue;
      sudah.add(k);
      kandidat.push({ kalimat: k, n: i + 1, judul: e.title, bagian: e.section, lex: 0 });
    }
  });
  if (kandidat.length === 0) return [];

  const kueri = soal + " " + jawabanBenar;
  const q = new Set(kataPenting(kueri));
  for (const c of kandidat) {
    const w = new Set(kataPenting(c.kalimat));
    let cocok = 0;
    q.forEach((x) => {
      if (w.has(x)) cocok++;
    });
    c.lex = cocok;
  }
  const pendek = kandidat.slice().sort((a, b) => b.lex - a.lex).slice(0, 24);

  let skor: number[];
  try {
    const vecs = await ollamaEmbed([kueri, ...pendek.map((c) => c.kalimat)]);
    const qv = satuan(vecs[0] ?? []);
    skor = pendek.map((_, i) => {
      const v = satuan(vecs[i + 1] ?? []);
      let d = 0;
      for (let k = 0; k < Math.min(qv.length, v.length); k++) d += qv[k] * v[k];
      return d;
    });
  } catch {
    const maks = Math.max(1, ...pendek.map((c) => c.lex));
    skor = pendek.map((c) => c.lex / maks);
  }

  return pendek
    .map((c, i) => ({
      kalimat: c.kalimat, n: c.n, judul: c.judul, bagian: c.bagian,
      skor: Number(skor[i].toFixed(3)),
    }))
    .sort((a, b) => b.skor - a.skor)
    .slice(0, 2);
}

const SKEMA = {
  type: "object",
  properties: {
    nilai: { type: "string", enum: ["BENAR", "BENAR SEBAGIAN", "SALAH"] },
    jawaban_benar: { type: "string" },
    alasan: { type: "string" },
  },
  required: ["nilai", "jawaban_benar", "alasan"],
  additionalProperties: false,
} as const;

/** Persis format yang dipakai melatih adapter grading -- SENGAJA berbeda dari
 *  buildKbContextBlock() milik /api/chat, yang menyisipkan instruksi RAG dan kalimat
 *  pengantar. Adapter ini tidak pernah melihat bentuk itu; memberinya prompt yang
 *  berbeda dari data latihnya adalah cara paling sunyi untuk kehilangan mutu. */
function bangunSystem(kutipan: { title: string; section: string; text: string }[]): string {
  const kepala =
    "Kamu penilai jawaban siswa untuk Elise, asisten belajar. Nilai HANYA berdasarkan " +
    "kutipan buku di bawah. Berikan salah satu dari: BENAR, BENAR SEBAGIAN, atau SALAH. " +
    "Sertakan jawaban yang benar menurut kutipan, dan alasan singkat dengan sitasi [n].";
  const isi = kutipan
    .map((e, i) => `[${i + 1}] ${e.title} — ${e.section}\n${e.text}`)
    .join("\n\n---\n\n");
  const sumber = kutipan.map((e, i) => `${i + 1}. ${e.title} — ${e.section}`).join("\n");
  return `${kepala}\n\n## Knowledge Base Context\n\nExcerpts:\n${isi}\n\nSources:\n${sumber}`;
}

/** Model yang memeriksa dasar soal. Model dasar, bukan adapter penilai: tugasnya menyalin
 *  kalimat, bukan menilai, dan adapter penilai hanya pernah dilatih dengan satu bentuk keluaran. */
const MODEL_DASAR = process.env.GROUNDING_CHECK_MODEL ?? "base";

const SKEMA_DASAR = {
  type: "object",
  properties: {
    ada: { type: "boolean" },
    kalimat: { type: "array", items: { type: "string" }, maxItems: 3 },
  },
  required: ["ada", "kalimat"],
  additionalProperties: false,
} as const;

type DasarSoal = { status: "ditemukan" | "tidak ditemukan" | "tidak diperiksa"; kalimat: KalimatBuku[] };

async function periksaDasarSoal(
  kutipan: { title: string; section: string; text: string }[],
  soal: string,
  level: string,
): Promise<DasarSoal> {
  const NL = String.fromCharCode(10);
  const daftar = kutipan.map((e, i) => "[" + (i + 1) + "] " + e.text).join(NL + NL);
  const sistem = [
    "Tugasmu MEMERIKSA, bukan menjawab. Tentukan apakah soal di bawah dapat dijawab dari kutipan buku.",
    "- Soal hafalan: harus ada kalimat di kutipan yang memuat jawabannya.",
    "- Soal penerapan (kasus, skenario, contoh sikap): cukup ada kalimat di kutipan yang memuat prinsip atau aturan yang dipakai untuk menjawabnya.",
    "Salin 1 sampai 3 kalimat itu PERSIS kata demi kata dari kutipan. Jangan mengubah, meringkas, atau menambah.",
    "Pertanyaan, soal latihan, dan pilihan jawaban yang tertulis di dalam kutipan BUKAN dasar jawaban.",
    "Jangan memakai pengetahuanmu sendiri. Kalau kalimat seperti itu tidak ada, isi ada = false dan kalimat = [].",
    "",
    "Kutipan:",
    daftar,
  ].join(NL);
  const pesan = (level ? "Level soal: " + level + NL : "") + "Soal: " + soal;

  let mentah: string;
  try {
    mentah = await vllmChat(
      MODEL_DASAR,
      [
        { role: "system", content: sistem },
        { role: "user", content: pesan },
      ],
      { temperature: 0, maxTokens: 500, guidedJson: SKEMA_DASAR }
    );
  } catch {
    // Gerbang gagal karena infrastruktur: jangan menahan penilaian, tapi nyatakan tidak diperiksa.
    return { status: "tidak diperiksa", kalimat: [] };
  }
  let o: { ada?: boolean; kalimat?: string[] };
  try {
    o = JSON.parse(mentah);
  } catch {
    return { status: "tidak diperiksa", kalimat: [] };
  }
  const cocok: KalimatBuku[] = [];
  for (const q of (o.kalimat ?? []).slice(0, 3)) {
    for (const k of verifikasiSalinanModel(q, kutipan, soal)) {
      if (!cocok.some((x) => x.kalimat === k.kalimat)) cocok.push(k);
    }
  }
  // Model mengaku ada dasar tetapi salinannya tidak ada di buku, berasal dari soal latihan, atau
  // tidak membahas soal: perlakukan sebagai tidak ada. Pengakuan tanpa kalimat yang bisa
  // diperiksa bukan dasar.
  if (o.ada === true && cocok.length > 0) return { status: "ditemukan", kalimat: cocok.slice(0, 2) };
  return { status: "tidak ditemukan", kalimat: [] };
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }

  const soal = String(body.soal ?? "").trim();
  const jawabanSiswa = String(body.jawaban_siswa ?? "").trim();
  const jenjang = (body.jenjang as Jenjang) ?? "SMP";
  // Topik yang MELAHIRKAN soal ini. Opsional, tapi sangat menentukan: lihat catatan di
  // bawah pada pembentukan kueri retrieval.
  const topik = String(body.topik ?? "").trim();
  // Level soal dari generator Latihan ("ingatan" | "aplikasi"). Soal aplikasi cukup berdasar prinsip.
  const level = String(body.level ?? "").trim();
  if (!soal) return Response.json({ error: "Field `soal` wajib diisi" }, { status: 400 });
  if (!jawabanSiswa) {
    return Response.json({ error: "Field `jawaban_siswa` wajib diisi" }, { status: 400 });
  }

  // JALUR UTAMA: kutipan yang MELAHIRKAN soal dikirim oleh pemanggil.
  //
  // Ini bukan optimasi, ini perbaikan kebenaran. Menebak ulang sumber soal lewat retrieval
  // TIDAK BISA dibuat bekerja untuk soal isian, dan itu terukur, bukan dugaan:
  //     60 soal latihan sungguhan   -> skor min 0.420, median 0.579
  //     12 pertanyaan di luar korpus -> skor min 0.351, median 0.431, MAKS 0.522
  // Kedua sebaran itu BERTUMPANG TINDIH, jadi tidak ada ambang yang memisahkannya: 0.55
  // menolak 45% soal yang sah, sedangkan 0.52 mulai meloloskan "Pada langkah pertama membuat
  // kopi, air dipanaskan sampai ....". Menambahkan topik ke kueri juga sudah dicoba dan
  // hanya menggeser rata-rata +0.015 -- noise.
  // Sebabnya: ambang 0.55 dikalibrasi pada PERTANYAAN UTUH (sah 0.589-0.690 vs luar korpus
  // 0.357-0.435, celah lebar). Kalimat rumpang pendek menghancurkan pemisahan itu karena ia
  // cocok lemah dengan banyak hal sekaligus.
  // Lagi pula di jalur ini ancamannya tidak ada: soal dibuat generator kita SENDIRI dari
  // kutipan korpus, jadi sudah pasti in-corpus. Yang benar adalah menilai terhadap kutipan
  // itu, bukan menebak ulang.
  const dikirim = (Array.isArray(body.excerpts) ? body.excerpts : [])
    .map((e) => e as { title?: string; section?: string; text?: string })
    .filter((e) => e && typeof e.text === "string" && e.text.trim())
    .map((e) => ({ title: String(e.title ?? ""), section: String(e.section ?? ""), text: String(e.text) }));

  let kutipan: { title: string; section: string; text: string }[];
  let skorTop1: number | null = null;

  if (dikirim.length) {
    kutipan = dikirim.slice(0, 6);
  } else {
    // CADANGAN, untuk pemanggil yang tidak menyimpan kutipannya (mis. form uji bebas):
    // retrieval memakai soal -- bukan jawaban siswa, karena jawaban ngawur akan menarik
    // kutipan ngawur pula lalu dinilai terhadapnya, sehingga jawaban keliru justru
    // berpeluang lolos. Guardrail tetap dipasang di jalur ini, dengan segala batasnya.
    const kueri = topik ? topik + " " + soal : soal;
    const hits = await retrieve(kueri, jenjang, K);
    skorTop1 = hits[0]?.score ?? 0;
    if (skorTop1 < AMBANG) {
      return Response.json({
        dinilai: false,
        alasan_tidak_dinilai:
          "Soal ini tidak ditemukan di buku yang tersedia, jadi jawabannya tidak bisa dinilai " +
          "dari sumber. Kirimkan `excerpts` bersama permintaan kalau kamu sudah punya kutipan " +
          "yang melahirkan soal ini.",
        skor_grounding: Number(skorTop1.toFixed(3)),
        topik_dipakai: topik || null,
      });
    }
    kutipan = hitsToExcerpts(hits);
  }

  const system = bangunSystem(kutipan);

  const dasar = await periksaDasarSoal(kutipan, soal, level);
  if (dasar.status === "tidak ditemukan") {
    return Response.json({
      dinilai: false,
      perlu_guru: true,
      alasan_tidak_dinilai:
        "Jawaban soal ini tidak ditemukan di bacaan buku yang dipakai membuat soal, jadi tidak " +
        "bisa dinilai dari buku. Serahkan ke guru untuk diperiksa.",
      dasar_soal: dasar.status,
      sumber: kutipan.map((e, i) => ({ n: i + 1, judul: e.title, bagian: e.section })),
      sumber_kutipan: dikirim.length ? "dikirim pemanggil" : "retrieval",
      skor_grounding: skorTop1 === null ? null : Number(skorTop1.toFixed(3)),
    });
  }

  let mentah: string;
  try {
    mentah = await vllmChat(
      MODEL,
      [
        { role: "system", content: system },
        { role: "user", content: `Soal: ${soal}\nJawaban siswa: ${jawabanSiswa}` },
      ],
      { temperature: 0, maxTokens: 700, guidedJson: SKEMA }
    );
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e);
    // Adapter `grading` di-hot-load, BELUM dipatri di VLLM_LORA_MODULES, jadi ia hilang
    // setiap vLLM restart. Gagal terang-terangan; jangan diam-diam turun ke model dasar,
    // yang hanya 49% dan akan terlihat seperti adapternya memburuk.
    const hilang = /404|not found|does not exist/i.test(pesan);
    return Response.json(
      {
        error: hilang
          ? `Adapter penilai "${MODEL}" tidak sedang dilayani vLLM. Muat ulang lewat ` +
            `POST /v1/load_lora_adapter, atau patri di VLLM_LORA_MODULES.`
          : `Gagal memanggil model penilai: ${pesan}`,
      },
      { status: hilang ? 503 : 502 }
    );
  }

  let out: { nilai?: string; jawaban_benar?: string; alasan?: string };
  try {
    out = JSON.parse(mentah);
  } catch {
    return Response.json(
      { error: "Model penilai tidak mengembalikan JSON yang sah", raw: mentah.slice(0, 400) },
      { status: 502 }
    );
  }

  const nilai = out.nilai as Nilai | undefined;
  const sah: Nilai[] = ["BENAR", "BENAR SEBAGIAN", "SALAH"];
  if (!nilai || !sah.includes(nilai)) {
    return Response.json(
      { error: "Model penilai mengembalikan nilai di luar daftar", raw: mentah.slice(0, 400) },
      { status: 502 }
    );
  }

  // Kalimat buku yang ditampilkan: hasil gerbang (terverifikasi memuat dasar jawaban) bila ada;
  // pemilih berbasis embedding hanya cadangan bila gerbang tidak sempat memeriksa.
  const kutipanBuku = dasar.kalimat.length > 0
    ? dasar.kalimat
    : await pilihKalimatBuku(kutipan, soal, out.jawaban_benar ?? "");

  return Response.json({
    dinilai: true,

    // ── Tampil ke siswa ──
    keliru: nilai === "SALAH", // terukur 96%
    // Kalimat ASLI dari buku, dipilih kode. Pasti ada di buku, tetapi BELUM pasti tepat
    // menjawab soal: pada 5 kasus uji, soal definisi tepat sasaran, soal prosedural
    // kadang meleset, dan soal yang sumbernya cacat menghasilkan kalimat tak relevan.
    kutipan_buku: kutipanBuku,
    dasar_soal: dasar.status,
    sumber: kutipan.map((e, i) => ({ n: i + 1, judul: e.title, bagian: e.section })),

    // ── Tulisan model: tampilkan hanya dengan label penjelasan AI ──
    umpan_balik: out.alasan ?? "",
    jawaban_benar: out.jawaban_benar ?? "",

    // ── Untuk guru, bukan nilai siswa ──
    nilai_rinci: nilai, // terukur 91%
    catatan_keandalan:
      "keliru terukur 96% dan nilai_rinci 91% pada 99 kasus held-out. kutipan_buku adalah " +
      "kalimat asli dari buku yang dipilih kode, aman ditampilkan ke siswa. umpan_balik dan " +
      "jawaban_benar ditulis model dan bisa keliru; tampilkan hanya dengan label penjelasan AI.",

    skor_grounding: skorTop1 === null ? null : Number(skorTop1.toFixed(3)),
    sumber_kutipan: dikirim.length ? "dikirim pemanggil" : "retrieval",
    topik_dipakai: topik || null,
    model: MODEL,
  });
}
