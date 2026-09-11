import type { NextRequest } from "next/server";

import { retrieve } from "@/lib/retrieve";
import { hitsToExcerpts } from "@/lib/excerpts";
import { vllmChat } from "@/lib/llm";
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
 * BENTUK KELUARAN MENGIKUTI APA YANG MODEL KUASAI, bukan apa yang enak dibayangkan.
 * Diukur pada 99 kasus berlabel yang tidak sekalipun ikut melatih adapter:
 *
 *     label tiga tingkat (BENAR / BENAR SEBAGIAN / SALAH)   66%
 *     "ada yang keliru atau tidak"                          91%
 *     alasan yang menyitasi kutipan                         98/99
 *
 * Karena itu `keliru` dan `umpan_balik` adalah permukaan utamanya, dan `nilai_rinci`
 * ikut dikirim sebagai bahan pertimbangan, bukan sebagai nilai final. 73% kesalahan
 * yang tersisa ada di perbatasan BENAR <-> BENAR SEBAGIAN; di luar itu modelnya andal
 * (jawaban salah yang dinilai BENAR: 1 dari 33).
 *
 * Jangan tampilkan `nilai_rinci` sebagai nilai siswa tanpa guru yang memeriksanya.
 */

const MODEL = process.env.GRADING_MODEL ?? "grading";
const K = 4;

/** Ambang grounding, sama dengan /api/chat: top-1 bge-m3 di bawah ini berarti
 *  soalnya di luar korpus, dan menilai jawabannya berarti menilai dari ingatan model. */
const AMBANG = 0.55;

type Nilai = "BENAR" | "BENAR SEBAGIAN" | "SALAH";

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

  return Response.json({
    dinilai: true,

    // ── Yang andal (91%): dipakai untuk memutuskan apakah siswa perlu memperbaiki ──
    keliru: nilai === "SALAH",
    umpan_balik: out.alasan ?? "",
    jawaban_benar: out.jawaban_benar ?? "",
    sumber: kutipan.map((e, i) => ({ n: i + 1, judul: e.title, bagian: e.section })),

    // ── Bahan pertimbangan (66%): JANGAN ditampilkan sebagai nilai final ──
    nilai_rinci: nilai,
    catatan_keandalan:
      "keliru & umpan_balik terukur 91% pada 99 kasus held-out; nilai_rinci 66%. " +
      "Tampilkan nilai_rinci hanya kepada guru, bukan sebagai nilai siswa.",

    skor_grounding: skorTop1 === null ? null : Number(skorTop1.toFixed(3)),
    sumber_kutipan: dikirim.length ? "dikirim pemanggil" : "retrieval",
    topik_dipakai: topik || null,
    model: MODEL,
  });
}
