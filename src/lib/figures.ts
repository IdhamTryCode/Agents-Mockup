/**
 * DUMMY figures for the mockup. Production RantAI Agents surfaces [FIGURE] excerpts
 * from its retrieval pipeline (MinerU-extracted crops); here we fake a set so the
 * figure-insertion behavior ([figure:N] → rendered image) can be demonstrated
 * end-to-end. Swap this for a real figure dump when integrating the actual pipeline.
 *
 * Titles mirror real books in the corpus so the Sources panel reads coherently, and
 * keywords target topics the corpus actually covers densely (energi, gaya, listrik,
 * kemagnetan, tanah, jaringan, algoritma, musik, sosiologi, puisi, Pancasila, K3).
 * Each figure carries the `jenjang` of its book: text retrieval is filtered by
 * jenjang, so an SMA figure offered to an SMP student could never have supporting
 * excerpts — matchFigures filters the same way to keep Sources honest.
 */
import type { Jenjang } from "./types";

export type Figure = {
  id: string;
  title: string; // document title (matches a Sources entry)
  section: string;
  caption: string;
  src: string; // under /public
  jenjang: Jenjang;
  keywords: string[];
};

const IPA = "Ilmu Pengetahuan alam Kelas IX Semester 2";
const INFORMATIKA = "Informatika untuk SMP/MTs Kelas VIII (Edisi Revisi)";
const MUSIK = "Panduan Guru Seni Musik untuk SMA/MA/SMK/MAK Kelas X (Edisi Revisi)";
const SOSIOLOGI = "Sosiologi untuk SMA/MA Kelas XI (Edisi Revisi)";
const BINDO = "Bahasa Indonesia Kelas XII";
const MESIN = "Buku Panduan Guru Dasar-Dasar Teknik Mesin untuk SMK/MAK Kelas X";
const PANCASILA = "Pendidikan Pancasila untuk SMP/MTs Kelas VIII";
const SD_TEMA = "Buku Guru Tema 5 kelas II Pengalamanku";

export const FIGURES: Figure[] = [
  // ---- IPA (SMP) ----
  {
    id: "fig-energi",
    title: IPA,
    section: "Bab 1 › Energi dan Perubahannya",
    caption: "Perubahan bentuk energi listrik menjadi cahaya, panas, dan gerak.",
    src: "/figures/fig-energi.svg",
    jenjang: "SMP",
    keywords: ["energi", "perubahan energi", "bentuk energi", "energi listrik", "usaha dan energi"],
  },
  {
    id: "fig-gaya-gerak",
    title: IPA,
    section: "Bab 2 › Gaya dan Gerak",
    caption: "Gaya yang bekerja pada benda: dorong, gesek, normal, dan berat.",
    src: "/figures/fig-gaya-gerak.svg",
    jenjang: "SMP",
    keywords: ["gaya", "gerak benda", "gaya gesek", "gaya normal", "hukum newton", "percepatan"],
  },
  {
    id: "fig-kemagnetan",
    title: IPA,
    section: "Bab 6 › Kemagnetan › Medan Magnet",
    caption: "Magnet batang dengan kutub utara–selatan dan garis medan magnet.",
    src: "/figures/fig-kemagnetan.svg",
    jenjang: "SMP",
    keywords: ["magnet", "kemagnetan", "medan magnet", "kutub magnet", "garis gaya"],
  },
  {
    id: "fig-lapisan-tanah",
    title: IPA,
    section: "Bab 9 › Tanah dan Keberlangsungan Kehidupan",
    caption: "Horizon tanah: humus, tanah atas, tanah bawah, dan batuan induk.",
    src: "/figures/fig-lapisan-tanah.svg",
    jenjang: "SMP",
    keywords: ["lapisan tanah", "horizon tanah", "humus", "tanah", "kesuburan"],
  },
  {
    id: "fig-atom",
    title: IPA,
    section: "Bab 8 › Partikel Penyusun Benda",
    caption: "Struktur atom: inti (proton dan neutron) dikelilingi elektron.",
    src: "/figures/fig-atom.svg",
    jenjang: "SMP",
    keywords: ["atom", "partikel", "elektron", "proton", "neutron", "molekul"],
  },
  {
    id: "fig-bioteknologi",
    title: IPA,
    section: "Bab 7 › Bioteknologi Pangan",
    caption: "Fermentasi: mikroorganisme mengubah bahan menjadi produk baru.",
    src: "/figures/fig-bioteknologi.svg",
    jenjang: "SMP",
    keywords: ["bioteknologi", "fermentasi", "yoghurt", "tempe", "mikroorganisme"],
  },
  {
    id: "fig-fotosintesis",
    title: IPA,
    section: "Bab 4 › Fotosintesis",
    caption: "Proses fotosintesis: cahaya + CO₂ + H₂O → glukosa + O₂.",
    src: "/figures/fig-fotosintesis.svg",
    jenjang: "SMP",
    keywords: ["fotosintesis", "klorofil", "glukosa", "daun"],
  },
  // ---- Informatika (SMP) ----
  {
    id: "fig-jaringan",
    title: INFORMATIKA,
    section: "Bab 2 › Jaringan Komputer dan Internet",
    caption: "Topologi jaringan: switch menghubungkan klien ke server.",
    src: "/figures/fig-jaringan.svg",
    jenjang: "SMP",
    keywords: ["jaringan komputer", "jaringan", "internet", "topologi", "server", "switch"],
  },
  {
    id: "fig-flowchart",
    title: INFORMATIKA,
    section: "Bab 4 › Algoritma dan Pemrograman",
    caption: "Diagram alir dengan percabangan keputusan.",
    src: "/figures/fig-flowchart.svg",
    jenjang: "SMP",
    keywords: ["flowchart", "diagram alir", "algoritma", "pemrograman", "percabangan"],
  },
  {
    id: "fig-spreadsheet",
    title: INFORMATIKA,
    section: "Bab 3 › Pengolahan Data › Lembar Kerja",
    caption: "Data tabel disajikan ulang sebagai diagram batang.",
    src: "/figures/fig-spreadsheet.svg",
    jenjang: "SMP",
    keywords: ["spreadsheet", "lembar kerja", "diagram batang", "mengolah data", "tabel data"],
  },
  // ---- Pancasila / Matematika (SMP) ----
  {
    id: "fig-pancasila",
    title: PANCASILA,
    section: "Bab 1 › Pancasila sebagai Dasar Negara",
    caption: "Lima sila Pancasila beserta lambangnya.",
    src: "/figures/fig-pancasila.svg",
    jenjang: "SMP",
    keywords: ["pancasila", "sila", "dasar negara", "lambang pancasila", "ideologi"],
  },
  {
    id: "fig-segitiga",
    title: "Matematika untuk SMP/MTs Kelas VIII",
    section: "Bab 6 › Bangun Datar › Segitiga",
    caption: "Segitiga dengan alas dan tinggi. Luas = ½ × alas × tinggi.",
    src: "/figures/fig-segitiga.svg",
    jenjang: "SMP",
    keywords: ["segitiga", "luas segitiga", "alas", "bangun datar", "geometri"],
  },
  // ---- SMA ----
  {
    id: "fig-notasi-musik",
    title: MUSIK,
    section: "Unit 2 › Notasi dan Tangga Nada",
    caption: "Paranada lima garis dan tangga nada mayor do–do.",
    src: "/figures/fig-notasi-musik.svg",
    jenjang: "SMA",
    keywords: ["notasi", "tangga nada", "paranada", "not balok", "birama", "melodi"],
  },
  {
    id: "fig-alat-musik",
    title: MUSIK,
    section: "Unit 1 › Ragam Alat Musik",
    caption: "Pengelompokan alat musik: petik, tiup, dan pukul.",
    src: "/figures/fig-alat-musik.svg",
    jenjang: "SMA",
    keywords: ["alat musik", "petik", "tiup", "pukul", "gamelan", "instrumen"],
  },
  {
    id: "fig-stratifikasi",
    title: SOSIOLOGI,
    section: "Bab 2 › Struktur Sosial › Stratifikasi",
    caption: "Piramida stratifikasi sosial: lapisan atas, menengah, bawah.",
    src: "/figures/fig-stratifikasi.svg",
    jenjang: "SMA",
    keywords: ["stratifikasi", "pelapisan sosial", "struktur sosial", "kelas sosial", "mobilitas sosial"],
  },
  {
    id: "fig-struktur-puisi",
    title: BINDO,
    section: "Bab 3 › Menikmati Puisi",
    caption: "Unsur pembangun puisi: unsur fisik dan unsur batin.",
    src: "/figures/fig-struktur-puisi.svg",
    jenjang: "SMA",
    keywords: ["puisi", "unsur puisi", "rima", "majas", "diksi", "amanat"],
  },
  {
    id: "fig-k3-mesin",
    title: MESIN,
    section: "Bab 2 › Keselamatan dan Kesehatan Kerja (K3)",
    caption: "Alat pelindung diri di bengkel: helm, kacamata, sarung tangan, sepatu.",
    src: "/figures/fig-k3-mesin.svg",
    jenjang: "SMA",
    keywords: ["k3", "keselamatan kerja", "alat pelindung diri", "apd", "bengkel", "keselamatan"],
  },
  // ---- SD ----
  {
    id: "fig-tugas-harian",
    title: SD_TEMA,
    section: "Subtema 1 › Tugasku Sehari-hari",
    caption: "Jadwal kegiatan sehari-hari di rumah dan sekolah.",
    src: "/figures/fig-tugas-harian.svg",
    jenjang: "SD",
    keywords: ["tugas sehari-hari", "kegiatan sehari-hari", "jadwal", "kewajiban", "tugasku"],
  },
  {
    id: "fig-anggota-keluarga",
    title: SD_TEMA,
    section: "Subtema 1 › Pengalamanku di Rumah",
    caption: "Anggota keluarga dan tugas masing-masing di rumah.",
    src: "/figures/fig-anggota-keluarga.svg",
    jenjang: "SD",
    keywords: ["anggota keluarga", "keluarga", "ayah", "ibu", "di rumah"],
  },
];

const byId = new Map(FIGURES.map((f) => [f.id, f]));
export const figureById = (id: string): Figure | undefined => byId.get(id);

/** Dummy matcher: figures whose keywords appear in the query, restricted to the
 *  student's jenjang (text retrieval is filtered the same way, so a figure from
 *  another jenjang could never have supporting excerpts). The LONGEST keyword hit
 *  wins, so a specific figure ("siklus air") outranks a generic one ("air"). */
export function matchFigures(query: string, jenjang: Jenjang, limit = 1): Figure[] {
  const q = query.toLowerCase();
  return FIGURES.filter((f) => f.jenjang === jenjang)
    .map((f) => {
      let best = 0;
      for (const k of f.keywords) if (q.includes(k) && k.length > best) best = k.length;
      return { f, best };
    })
    .filter((x) => x.best > 0)
    .sort((a, b) => b.best - a.best)
    .slice(0, limit)
    .map((x) => x.f);
}
