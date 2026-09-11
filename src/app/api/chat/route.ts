import type { NextRequest } from "next/server";

import { retrieve } from "@/lib/retrieve";
import { buildSystemPrompt, servedModel, type Kelas, type Mode } from "@/lib/contract";
import { hitsToExcerpts, attachFigures } from "@/lib/excerpts";
import { vllmChat, type ChatMsg } from "@/lib/llm";
import type { Jenjang } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * RantAI Agents faithful chat. Every mode is a multi-turn chat with the mode's
 * Elise persona (the persona itself drives Latihan's 4 stages). The prompt is
 * assembled per the handover contract:
 *   system = persona + platform instructions + KB context block (with [FIGURE])
 *   messages = [system, ...history, user]
 * served by vLLM: model `base` (Tanya/Belajar) or `practice` (Latihan).
 */
/** GROUNDING GUARDRAIL.
 *  Both the base model and every ask adapter answer famous world facts from
 *  pretraining and then attach a citation to a book that never mentions them
 *  ("Piala Dunia 2022 -> Argentina [1]"). Retraining does not fix it: that exact
 *  question sat in the ask/v4 training set as a refusal target and the model still
 *  answered. So the check happens BEFORE the model is called, in code.
 *
 *  Signal: the top-1 bge-m3 cosine score from retrieval. Measured separation on the
 *  live corpus — out-of-corpus questions 0.357-0.435, genuine questions 0.589-0.690
 *  across every mode and jenjang. 0.55 sits in that gap with headroom on both sides,
 *  and still lets through borderline-but-grounded cases (e.g. "orang terkaya di
 *  dunia" scores 0.542 and IS discussed in the Sosiologi book).
 */
/** Words that carry no topic of their own — question words and discourse fillers.
 *  A turn made only of these ("Kenapa begitu?", "Contohnya apa?") is anaphoric: it
 *  refers back to the conversation and cannot be judged for grounding on its own. */
const DISCOURSE = new Set([
  "apa", "apakah", "siapa", "kenapa", "mengapa", "bagaimana", "gimana", "kapan", "mana", "berapa",
  "kok", "bisa", "begitu", "gitu", "contoh", "contohnya", "misal", "misalnya", "jelaskan", "jelasin",
  "lagi", "dong", "sih", "tuh", "nya", "itu", "ini", "yang", "dan", "atau", "dari", "pada", "untuk",
  "dengan", "dalam", "adalah", "juga", "saja", "aku", "kamu", "maksudnya", "terus", "lalu", "kalau",
  "coba", "tolong", "ya", "yaa", "hmm", "oke", "iya", "sekarang", "tadi",
]);
function contentWords(q: string): string[] {
  return (q.toLowerCase().match(/[a-zà-ÿ0-9]{3,}/g) ?? []).filter((w) => !DISCOURSE.has(w));
}

const GROUNDING_MIN_SCORE = Number(process.env.GROUNDING_MIN_SCORE ?? "0.55");
const GROUNDING_REFUSAL =
  "Saya tidak tahu berdasarkan buku yang tersedia. Kalau mau, kita bisa bahas topik terdekat yang memang ada di materi.";

/** Schema for Latihan's TAHAP 2 output, the shape RantAI Agents parses.
 *  `opsi` stays optional rather than forbidden: the app cannot always tell which type the
 *  student asked for, and forcing its absence would be a contract change to make with the
 *  RantAI Agents team, not a guess made here. What this DOES remove is the failure mode
 *  measured on both practice v1 and v2 -- a token loop emitting `level_level_level...`
 *  until max_tokens, leaving the JSON unclosed. With `level` constrained to two values
 *  that loop cannot be generated at all. */
type Tipe = "mcq" | "uraian" | "isian";

function soalSchema(tipe?: Tipe, jumlah?: number) {
  // `opsi` diwajibkan untuk mcq dan DILARANG untuk uraian/isian. Sebelumnya ia opsional
  // karena route tidak tahu tipe yang diminta; sekarang UI mengirimkannya, jadi cacat
  // "minta isian singkat, keluar pilihan ganda" -- 0 dari 4395 soal practice/v1 tanpa opsi --
  // menjadi mustahil dibangkitkan, bukan sekadar diperbaiki lewat data latih.
  // `kunci` HANYA untuk pilihan ganda. Dikonfirmasi tim UGM (frontend/UIUX): isian dan uraian
  // cukup soalnya saja, karena penilaian dikerjakan lewat API grading terpisah yang
  // mengembalikan soal + jawaban siswa ke model. Sebelumnya isian ikut berkunci dengan asumsi
  // kode yang mencocokkan -- asumsi itu gugur begitu ada endpoint grading.
  // Dihapus dari properties, bukan sekadar dari required, supaya additionalProperties:false
  // membuatnya mustahil muncul.
  const soalProps: Record<string, unknown> = {
    pertanyaan: { type: "string" },
    level: { type: "string", enum: ["ingatan", "aplikasi"] },
  };
  const wajib = ["pertanyaan", "level"];
  if (tipe === "mcq") {
    soalProps.kunci = { type: "string" };
    wajib.push("kunci");
  }
  if (tipe !== "uraian" && tipe !== "isian") {
    soalProps.opsi = {
      type: "object",
      properties: { A: { type: "string" }, B: { type: "string" },
                    C: { type: "string" }, D: { type: "string" } },
      required: ["A", "B", "C", "D"], additionalProperties: false,
    };
    if (tipe === "mcq") wajib.push("opsi");
  }
  return {
    type: "object",
    properties: {
      // Panjang array DIIKAT ke jumlah yang diminta, bukan dibiarkan 1-10. Diukur di box:
      // begitu skema benar-benar ditegakkan lewat response_format, MCQ meluber sampai
      // maxItems -- 4 dari 4 kasus mcq, keluar 10 soal padahal diminta 4-5, sementara
      // isian dan uraian tetap tepat. Dengan minItems=maxItems=jumlah, jumlah yang salah
      // menjadi mustahil dibangkitkan, bukan sekadar dipangkas belakangan oleh slice().
      soal: {
        type: "array",
        minItems: jumlah ?? 1,
        maxItems: jumlah ?? 10,
        items: { type: "object", properties: soalProps,
                 required: wajib, additionalProperties: false },
      },
    },
    required: ["soal"], additionalProperties: false,
  };
}


/** TAHAP 1 answers in PROSE -- it asks which topic, type and how many. Constraining that
 *  turn to the schema would force Elise to emit questions before she has been told what to
 *  make. So the schema applies only once the turn is actually a question-making turn:
 *  either the student named a quantity outright, or TAHAP 1 already happened (history). */
function mintaSoal(query: string, history: ChatMsg[]): boolean {
  const adaJumlah = /(?:^|[^0-9])[0-9]+[ ]*(soal|butir|nomor|pertanyaan)/i.test(query);
  return adaJumlah || history.some((m) => m.role === "assistant");
}
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid" }, { status: 400 });
  }

  const mode = ((body.mode as Mode) ?? "tanya") as Mode;
  // Dikirim UI RantAI Agents saat siswa memilih jenis latihan. Dibaca DUA kali: oleh kode
  // untuk memilih skema, dan oleh model lewat pesan siswa -- bentuk kalimatnya sengaja sama
  // dengan data latih practice v2, supaya prompt yang dilihat model tidak berubah.
  const tipe = (["mcq", "uraian", "isian"] as const).find((t) => t === body.tipe);
  const jumlah = Number.isFinite(Number(body.jumlah)) ? Number(body.jumlah) : undefined;
  const jenjang = (body.jenjang as Jenjang) ?? "SMP";
  const kelasLabel = String(body.kelas ?? "Kelas 8");
  const kelas: Kelas = { jenjang, kelas: kelasLabel };
  const query = String(body.query ?? "").trim();
  const history: ChatMsg[] = Array.isArray(body.history)
    ? (body.history as ChatMsg[]).filter((m) => m && m.role && m.content).slice(-10)
    : [];
  if (!query) return Response.json({ error: "Pesan kosong" }, { status: 400 });

  // Dirakit SEBELUM retrieval, karena kalimat inilah yang dipakai untuk dua hal: dikirim ke
  // model, DAN dijadikan kueri retrieval. Memakai topik telanjang memblokir permintaan yang
  // sah -- diukur, "kemagnetan" skor 0.525 (di bawah ambang 0.55) sedangkan "Buatkan 3 soal
  // uraian tentang kemagnetan" skor 0.637. Frasanya sama persis dengan pesan siswa di data
  // latih practice v2, jadi prompt yang dilihat model tidak berubah.
  const LABEL: Record<Tipe, string> = { mcq: "pilihan ganda", uraian: "uraian", isian: "isian singkat" };
  // Siswa mestinya hanya mengetik topik, tapi kalau ia terlanjur menulis kalimat perintah
  // penuh, merakit di atasnya membuat permintaan BERTUMPUK: "Buatkan 4 soal pilihan ganda
  // tentang Buatkan 5 soal pilihan ganda tentang kemagnetan". Model menuruti yang di dalam,
  // jadi jumlahnya ikut yang diketik dan dropdown tampak diabaikan. Ambil topiknya saja.
  function topikSaja(q: string): string {
    const i = q.toLowerCase().indexOf("tentang ");
    if (i < 0) return q.trim();
    const depan = q.slice(0, i).toLowerCase();
    const perintah = ["soal", "buatkan", "buat ", "kasih", "tolong", "latihan", "butir", "nomor"];
    return perintah.some((w) => depan.includes(w)) ? q.slice(i + 8).trim() || q.trim() : q.trim();
  }
  const topik = mode === "latihan" ? topikSaja(query) : query;
  const userMsg = tipe && jumlah ? `Buatkan ${jumlah} soal ${LABEL[tipe]} tentang ${topik}` : query;

  try {
    // Retrieval anchor: Belajar/Latihan stay on the FIRST topic across turns; Tanya
    // retrieves on the current question. (A short follow-up shouldn't derail context.)
    const firstUserTopic = history.find((m) => m.role === "user")?.content;
    const topic = mode === "tanya" ? query : firstUserTopic || userMsg;

    // Retrieve wider than we show: chunks now collapse per document+section, so 4
    // raw hits could dedupe down to a single source. Pull 8, keep 4 DISTINCT ones.
    const hits = await retrieve(topic, jenjang, 8);

    // Guardrail: nothing retrieved is close enough to the question, so the book has
    // no answer. Refuse here rather than let the model invent one with a citation.
    // A short follow-up ("Kenapa begitu?") scores low on its own — measured 0.497,
    // just under the gate — because it carries no topic words. Judge it together
    // with the conversation's opening topic before refusing. A follow-up that
    // genuinely changes subject to something off-corpus still scores low both ways.
    let topScore = hits[0]?.score ?? 0;
    // Rescue ONLY anaphoric turns. Concatenating the conversation topic onto ANY
    // low-scoring follow-up opened a bypass: "Siapa yang memenangkan Piala Dunia
    // 2022?" asked as a follow-up rose to 0.625 and sailed through. A turn that
    // carries its own topic words is a new question and is judged on its own.
    if (
      topScore < GROUNDING_MIN_SCORE &&
      firstUserTopic &&
      mode === "tanya" &&
      contentWords(query).length <= 1
    ) {
      const ctxHits = await retrieve(`${firstUserTopic} ${query}`, jenjang, 1);
      topScore = Math.max(topScore, ctxHits[0]?.score ?? 0);
    }
    // TAHAP 1 Latihan belum menjawab apa pun -- Elise baru menanyakan topik, jenis dan jumlah,
    // jadi tidak ada klaim yang perlu di-grounding. Diukur: "Aku mau latihan soal" dan "Latihan
    // dong" DIBLOKIR guardrail karena tidak memuat kata topik, sehingga TAHAP 1 tidak pernah
    // bisa terjadi; "Bisa kasih latihan?" kebetulan lolos -- gagal yang tidak konsisten, yang
    // lebih membingungkan siswa daripada gagal yang konsisten. Guardrail tetap penuh di TAHAP 2.
    const tahap1 = mode === "latihan" && !tipe && !mintaSoal(query, history);
    if (topScore < GROUNDING_MIN_SCORE && !tahap1) {
      return Response.json({
        mode,
        model: "guardrail",
        answer: GROUNDING_REFUSAL,
        sources: [],
        figures: [],
        turns: history.length + 1,
        guardrail: { blocked: true, topScore, threshold: GROUNDING_MIN_SCORE },
      });
    }

    const texts = hitsToExcerpts(hits).slice(0, 4);
    // Up to 2 figures: with a broader figure set a question can legitimately have
    // two illustrations, and the model still embeds only the ones it judges relevant.
    const { figureExcerpts, figureSources } = attachFigures(topic, jenjang, texts.length, 2);

    // TAHAP 1 tidak diberi kutipan sama sekali. Elise belum tahu topiknya, jadi tidak ada
    // yang perlu di-grounding -- dan kalau materi acak tetap dilampirkan, model membuat soal
    // darinya alih-alih bertanya. Terukur: "Latihan dong" tidak memuat kata topik, retrieval
    // mengambil materi spreadsheet, dan jawabannya berupa JSON soal tentang fungsi MATCH.
    // Tanpa kutipan di depan mata, satu-satunya langkah yang tersisa adalah bertanya.
    const system = buildSystemPrompt({
      mode, kelas,
      texts: tahap1 ? [] : texts,
      figures: tahap1 ? [] : figureExcerpts,
    });
    const messages: ChatMsg[] = [{ role: "system", content: system }, ...history, { role: "user", content: userMsg }];

    const model = servedModel(mode);
    const pakaiSkema = mode === "latihan" && (Boolean(tipe) || mintaSoal(query, history));
    // Anggaran token diskalakan ke jumlah soal. Batas tetap 800 memotong 10 soal pilihan
    // ganda di tengah JSON (terukur: berhenti di 2739 char, kurung tidak tertutup) -- dan
    // itu terbaca seperti degenerasi padahal cuma kehabisan ruang. Guided JSON menjamin
    // bentuk, bukan panjang; keduanya harus diurus terpisah.
    const maxTokens = pakaiSkema
      ? Math.min(3200, 400 + (jumlah ?? 5) * (tipe === "mcq" ? 240 : 160))
      : undefined;
    const rawAnswer = await vllmChat(model, messages, {
      temperature: mode === "latihan" ? 0.35 : 0.2,
      ...(maxTokens ? { maxTokens } : {}),
      ...(pakaiSkema ? { guidedJson: soalSchema(tipe, jumlah) } : {}),
    });

    // Drop [figure:N] tags pointing at a source that was never attached. learn v7 ran
    // away here, emitting [figure:5] then [figure:10] through [figure:112] in one reply.
    // This has to sit server-side, not in the renderer: RantAI Agents consumes this JSON
    // directly, so a display-only guard would leave the real app showing raw markup.
    const validFigureNums = new Set(figureSources.map((_, i) => texts.length + i + 1));
    const deTagged = rawAnswer
      .replace(/\[figure:\s*(\d+)\]/gi, (m, n) =>
        validFigureNums.has(Number(n)) ? m : "")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Collapse runaway tag loops. learn v7 emitted [figure:5] then [figure:10] through
    // [figure:112]; learn v8 emitted [2][1][3] repeated dozens of times. Nothing stops a
    // loop once it starts: llm.ts sends no repetition penalty, so it runs to max_tokens.
    // A real answer never chains four bracket tags with only whitespace between them.
    const answer = deTagged.replace(
      /((?:\[(?:figure:\s*)?\d+\]\s*){4,})/gi,
      (run) => (run.match(/\[[^\]]*\]/) || [""])[0] + " ",
    );

    // Skema menjamin BENTUK tiap soal, bukan CACAH-nya: guided decoding vLLM tidak
    // menegakkan minItems/maxItems -- terukur, model mengeluarkan 7 soal saat diminta 5
    // meski batasnya dipasang tepat. Jadi jumlah ditegakkan di sini. Sekalian membuang
    // `kunci` dari uraian kalau model terlanjur menulisnya.
    let answerFinal = answer;
    if (pakaiSkema) {
      const a = answer.indexOf("{");
      const b = answer.lastIndexOf("}");
      if (a >= 0 && b > a) {
        try {
          const o = JSON.parse(answer.slice(a, b + 1)) as { soal?: Array<Record<string, unknown>> };
          if (Array.isArray(o.soal)) {
            let list = o.soal;
            // Penghapus duplikat sengaja TIDAK dipasang. Ia memang menghilangkan soal kembar,
            // tetapi yang dibuang tidak diisi ulang sehingga jumlah soal jadi kurang dari yang
            // diminta -- terukur: 3 dari 12 kasus keluar 3-4 soal dari 5. Kontrak meminta jumlah
            // tepat, jadi menukar cacat mutu dengan cacat jumlah bukan perbaikan bersih.
            if (jumlah && list.length > jumlah) list = list.slice(0, jumlah);
            if (tipe !== "mcq") {
              list = list.map(({ kunci: _buang, ...sisa }) => sisa);
            }
            answerFinal = JSON.stringify({ soal: list });
          }
        } catch {
          // biarkan apa adanya; renderer sudah menangani JSON yang tidak terparse
        }
      }
    }

    // Sources panel: text excerpts [1..M] + figures [M+1..K] (one shared numbering).
    const sources = [
      ...texts.map((t, i) => ({ n: i + 1, kind: "text" as const, title: t.title, section: t.section })),
      ...figureSources.map((f) => ({ n: f.n, kind: "figure" as const, title: f.title, section: f.section, id: f.id })),
    ];
    const figures = figureSources.map((f) => ({ n: f.n, id: f.id, src: f.src, caption: f.caption }));

    // `raw` is what the model literally emitted, before the two guards above touched
    // it. RantAI Agents consumes `answer`; `raw` exists so the mockup can show whether
    // the model wrote [figure:N] itself or the panel merely attached the image, and
    // whether sanitising had to step in. Diagnostic only — the real app ignores it.
    // `excerpts` disertakan supaya penilaian bisa dikerjakan terhadap kutipan yang BENAR-BENAR
    // melahirkan soal ini, bukan hasil menebak ulang sumbernya lewat retrieval. Soal isian
    // berupa kalimat rumpang dan meretrieve buruk: 45% di antaranya ditolak guardrail padahal
    // materinya ada. Lihat catatan panjang di src/app/api/grading/route.ts.
    return Response.json({ mode, model, answer: answerFinal, raw: rawAnswer, userMsg, sources, figures,
      excerpts: tahap1 ? [] : texts, turns: history.length + 1, system,
      guardrail: { blocked: false, topScore, threshold: GROUNDING_MIN_SCORE } });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
