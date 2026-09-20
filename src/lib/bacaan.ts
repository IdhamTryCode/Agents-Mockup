/**
 * Pengolah teks bacaan buku, dipakai bersama oleh /api/chat (mode Latihan) dan /api/grading.
 *
 * Semuanya operasi string biasa, TANPA regex. Alasannya bukan gaya: regex yang escape-nya
 * luruh tetap lolos typecheck, lalu diam-diam merusak teks di produksi.
 */

export type KalimatBuku = { kalimat: string; n: number; judul: string; bagian: string; skor: number };
type Bacaan = { title: string; section: string; text: string };

/** Kata yang terlalu umum untuk membedakan kalimat mana yang relevan. */
const KATA_UMUM = new Set([
  "yang", "dengan", "untuk", "adalah", "dari", "pada", "dalam", "atau", "jelaskan", "sebutkan",
  "tuliskan", "bagaimana", "mengapa", "kamu", "siswa", "soal", "kedua", "berikut", "tersebut",
  "menurut", "jawablah", "jawab", "bagian", "akan", "dapat", "bisa", "juga", "karena", "sebagai",
  "oleh", "atas", "para", "setiap", "suatu", "sebuah", "kita", "mereka", "telah", "sudah", "belum",
]);

export function kataPenting(teks: string): string[] {
  let bersih = "";
  for (const ch of teks.toLowerCase()) {
    const huruf = ch.toUpperCase() !== ch.toLowerCase();
    const angka = ch >= "0" && ch <= "9";
    bersih += huruf || angka ? ch : " ";
  }
  return bersih.split(" ").filter((w) => w.length >= 4 && !KATA_UMUM.has(w));
}

/** Ratakan semua whitespace, termasuk ganti baris. Teks hasil ekstraksi PDF menyimpan ganti
 *  baris di tengah frasa: pencarian "sila kedua" di buku Pendidikan Pancasila pernah gagal
 *  karena ada ganti baris di antara kedua kata itu. */
export function ratakan(teks: string): string {
  let hasil = "";
  for (const ch of teks) {
    const kode = ch.charCodeAt(0);
    hasil += kode <= 32 || kode === 160 ? " " : ch;
  }
  return hasil.split(" ").filter((w) => w.length > 0).join(" ");
}

/** Sambung pemenggalan kata hasil ekstraksi PDF: "kehendak- nya" jadi "kehendaknya". */
function sambungPemenggalan(teks: string): string {
  const t = ratakan(teks);
  let hasil = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === "-" && i > 0 && t[i + 1] === " ") {
      const sebelum = t[i - 1];
      const sesudah = t[i + 2] ?? "";
      const hurufSebelum = sebelum.toLowerCase() !== sebelum.toUpperCase();
      const kecilSesudah = sesudah !== sesudah.toUpperCase();
      if (hurufSebelum && kecilSesudah) {
        i += 1;
        continue;
      }
    }
    hasil += ch;
  }
  return hasil;
}

/** Pecah teks buku jadi kalimat: batas = . ? ! lalu spasi lalu huruf besar, supaya "6.1",
 *  "Gambar 6.9b", dan "Swt. dan" tidak terpotong. */
export function pecahKalimat(teks: string): string[] {
  const t = ratakan(teks);
  const hasil: string[] = [];
  let buf = "";
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    buf += ch;
    if ((ch === "." || ch === "?" || ch === "!") && t[i + 1] === " ") {
      const c = t[i + 2] ?? "";
      if (c === c.toLowerCase()) continue;
      // "...peristiwa itu! 5. Pada sebuah rapat RT, ...": titik sesudah NOMOR BUTIR bukan akhir
      // kalimat. Tanpa ini "5." menempel di akhir kalimat sebelumnya, dan butir soal latihan itu
      // lolos sebagai kalimat biasa yang tidak diawali nomor -- terukur di uji unit.
      if (ch === ".") {
        let j = buf.length - 2;
        let digit = 0;
        while (j >= 0 && buf[j] >= "0" && buf[j] <= "9") {
          j--;
          digit++;
        }
        if (digit >= 1 && digit <= 3 && (j < 0 || buf[j] === " ")) {
          const kepala = buf.slice(0, j + 1).trim();
          if (kepala) hasil.push(kepala);
          buf = buf.slice(j + 1);
          continue;
        }
      }
      hasil.push(buf.trim());
      buf = "";
    }
  }
  if (buf.trim()) hasil.push(buf.trim());
  return hasil;
}

/** Berapa kali "angka + titik + spasi" muncul: penanda daftar bernomor yang ikut tergabung ke
 *  satu kalimat saat PDF diekstrak ("Apa yang kamu perlukan?1. 2 paku besar ...2. 1 magnet"). */
export function jumlahPenandaDaftar(k: string): number {
  let n = 0;
  for (let i = 0; i + 2 < k.length; i++) {
    if (k[i] >= "0" && k[i] <= "9" && k[i + 1] === "." && k[i + 2] === " ") n++;
  }
  return n;
}

/** Kalimat yang diawali nomor butir ("5. Pada sebuah rapat RT, ..."). Di buku pelajaran ini
 *  hampir selalu butir soal latihan atau langkah kegiatan, bukan uraian materi. */
function diawaliNomor(k: string): boolean {
  let i = 0;
  while (i < k.length && k[i] >= "0" && k[i] <= "9") i++;
  return i > 0 && i <= 3 && k[i] === "." && k[i + 1] === " ";
}

/** Kata perintah soal atau kegiatan di awal kalimat. Tidak semua perintah diakhiri tanda seru:
 *  "Jelaskan sila keberapa dalam Pancasila yang menjadi terkorbankan ... seorang warga." lolos
 *  aturan tanda seru karena di teks hasil ekstraksi kalimat itu berakhir titik. */
const PERINTAH_SOAL = [
  "Jelaskan", "Sebutkan", "Tuliskan", "Buatlah", "Carilah", "Ceritakanlah", "Diskusikan",
  "Perhatikan", "Amatilah", "Isilah", "Pilihlah", "Jawablah", "Lengkapilah", "Bandingkan", "Coba ",
];

/** Kalimat yang BUKAN teks penjelasan. Setiap aturan berasal dari cacat yang benar-benar
 *  ditemukan saat uji tangan, bukan dari dugaan. */
export function bukanPenjelasan(k: string): boolean {
  if (PERINTAH_SOAL.some((p) => k.startsWith(p))) return true; // perintah soal tanpa tanda seru
  if (k.includes("....") || k.includes("…")) return true; // soal rumpang
  if (k.includes("A.") && k.includes("B.")) return true; // opsi pilihan ganda
  if (k.includes("?")) return true; // pertanyaan, termasuk yang tergabung di tengah potongan
  if (k.endsWith("!") || k.includes("! ")) return true; // instruksi kegiatan / perintah soal
  if (jumlahPenandaDaftar(k) >= 2) return true; // daftar alat atau langkah yang tergabung
  if (diawaliNomor(k)) return true; // butir soal latihan bernomor
  if (k.includes("(1)") && k.includes("(2)")) return true; // daftar pernyataan untuk soal pilihan ganda
  if (k.includes("Apa yang kamu perlukan") || k.includes("Apa yang harus kamu lakukan")) return true;
  if (k.includes("Sumber: Dok") || k.includes("Ayo, Kita") || k.includes("Kemdikbud")) return true;
  if (k.includes("##")) return true; // judul markdown yang tergabung ke kalimat
  return false;
}

/** Layak disodorkan ke siswa sebagai kalimat buku. */
export function layakDitampilkan(k: string): boolean {
  return k.length >= 30 && k.length <= 360 && !bukanPenjelasan(k);
}

/** Penanda yang benar-benar menandai blok soal akhir bab. Dipilih dari hitungan di korpus:
 *  "Aktivitas" (520 chunk), "Tugas" (320), "Refleksi" (109) terlalu umum untuk dijadikan titik
 *  potong -- kebanyakan bukan soal latihan. Blok latihan lain ditangani aturan per kalimat. */
const PENANDA_SOAL_LATIHAN = [
  "Uji Kompetensi", "Rajin Berlatih", "Pilihlah salah satu jawaban",
  "Lembar Kerja Peserta Didik", "Soal Latihan", "Penilaian Akhir",
];

/** Buang bagian soal latihan dari teks bacaan, sisakan uraian materi. */
export function bersihkanDariSoalLatihan(teks: string): string {
  let t = ratakan(teks).split("## ").join("").split("##").join("");
  let potong = t.length;
  for (const p of PENANDA_SOAL_LATIHAN) {
    const i = t.indexOf(p);
    if (i >= 0 && i < potong) potong = i;
  }
  t = t.slice(0, potong);
  return pecahKalimat(t).filter((k) => !bukanPenjelasan(k)).join(" ");
}

/** Kutipan untuk MEMBUAT soal Latihan: hanya uraian materi.
 *
 *  Uji tangan menemukan soal yang dibangun dari bagian soal latihan buku, dan penilai lalu
 *  diminta menilai terhadap buku yang tidak memuat jawabannya:
 *   - "mengukur kekuatan magnet berdasarkan Aktivitas 6.1" -- Aktivitas 6.1 berjudul Sifat Magnet
 *     Bahan; materi kekuatan magnet hanya ada di soal latihan pilihan ganda no. 8.
 *   - "bekerja sama membersihkan selokan desa -> sila kedua" -- butir PENGECOH soal latihan no. 4.
 *   - "warga Y memaksakan pendapat di rapat RT -> sila ...." -- soal uraian latihan tanpa kunci.
 *
 *  Kutipan yang sudah dibersihkan ini juga yang dikirim ke penilai, supaya soal dan penilaiannya
 *  bersandar pada teks yang sama. Kutipan yang tinggal terlalu sedikit isinya disingkirkan;
 *  kalau semuanya habis, kutipan asli dipakai daripada membuat soal tanpa bacaan sama sekali. */
export function bacaanUntukLatihan<T extends Bacaan>(daftar: T[], maks = 4, minPanjang = 350): T[] {
  const bersih = daftar.map((e) => ({ ...e, text: bersihkanDariSoalLatihan(e.text) }));
  const cukup = bersih.filter((e) => e.text.length >= minPanjang);
  const sisa = cukup.length > 0 ? cukup : bersih.filter((e) => e.text.length > 0);
  return sisa.length > 0 ? sisa.slice(0, maks) : daftar.slice(0, maks);
}

/** Satu kata beserta letaknya di teks yang sudah diratakan. */
type Kata = { w: string; a: number; b: number };

function hurufAtauAngka(ch: string): boolean {
  return ch.toUpperCase() !== ch.toLowerCase() || (ch >= "0" && ch <= "9");
}

/** Kata berhuruf kecil beserta posisinya. Pemenggalan "kehendak- nya" disambung jadi satu kata. */
function daftarKata(t: string): Kata[] {
  const hasil: Kata[] = [];
  let w = "";
  let a = -1;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (hurufAtauAngka(ch)) {
      if (a < 0) a = i;
      w += ch.toLowerCase();
      continue;
    }
    if (ch === "-" && w.length > 0 && t[i + 1] === " ") {
      const c = t[i + 2] ?? "";
      if (c !== c.toUpperCase()) {
        i += 1;
        continue;
      }
    }
    if (a >= 0) {
      hasil.push({ w, a, b: i });
      w = "";
      a = -1;
    }
  }
  if (a >= 0) hasil.push({ w, a, b: t.length });
  return hasil;
}

/** Penyelarasan lokal kata demi kata (Smith-Waterman): cocok +1, beda -1, kata sisipan -1.
 *  Salinan persis bernilai sama dengan jumlah katanya. Salah baca OCR ("isik" untuk "fisik")
 *  hanya mengurangi sedikit, dan salinan yang melintasi dua kalimat buku tetap utuh. Kalimat
 *  karangan yang kata-katanya tersebar di buku tidak mendapat rentang berurutan yang panjang. */
function selaraskan(q: Kata[], e: Kata[]): { skor: number; awal: number; akhir: number } {
  const m = q.length;
  let skorLalu = new Array<number>(m + 1).fill(0);
  let awalLalu = new Array<number>(m + 1).fill(-1);
  let terbaik = { skor: 0, awal: -1, akhir: -1 };
  for (let j = 1; j <= e.length; j++) {
    const skorKini = new Array<number>(m + 1).fill(0);
    const awalKini = new Array<number>(m + 1).fill(-1);
    for (let i = 1; i <= m; i++) {
      let s = 0;
      let aw = -1;
      const miring = skorLalu[i - 1] + (q[i - 1].w === e[j - 1].w ? 1 : -1);
      if (miring > s) {
        s = miring;
        aw = skorLalu[i - 1] > 0 ? awalLalu[i - 1] : j - 1;
      }
      const lewatiBuku = skorLalu[i] - 1;
      if (lewatiBuku > s) {
        s = lewatiBuku;
        aw = awalLalu[i];
      }
      const lewatiModel = skorKini[i - 1] - 1;
      if (lewatiModel > s) {
        s = lewatiModel;
        aw = awalKini[i - 1];
      }
      skorKini[i] = s;
      awalKini[i] = aw;
      if (s > terbaik.skor) terbaik = { skor: s, awal: aw, akhir: j - 1 };
    }
    skorLalu = skorKini;
    awalLalu = awalKini;
  }
  return terbaik;
}

/** Kalimat yang jelas-jelas soal atau pilihan jawaban. Sengaja lebih longgar dari
 *  bukanPenjelasan: nomor subjudul, tanda seru, dan judul "##" tidak dianggap soal di sini.
 *  Kalibrasi gerbang pada 99 kasus sah menunjukkan aturan ketat itu menolak 15 kalimat materi
 *  yang benar, misalnya "2. Alat Musik Idiophone, Alat musik idiophone adalah alat musik yang ...". */
export function jelasSoal(k: string): boolean {
  if (PERINTAH_SOAL.some((p) => k.startsWith(p))) return true;
  if (k.includes("....") || k.includes("…")) return true;
  if (k.includes("?")) return true;
  if (k.includes("A.") && k.includes("B.")) return true;
  if (k.includes("(1)") && k.includes("(2)")) return true;
  if (k.includes("Apa yang kamu perlukan") || k.includes("Apa yang harus kamu lakukan")) return true;
  return false;
}

/** Judul atau kaki halaman yang ikut terekstrak dari PDF dan kadang ikut disalin model:
 *  "Subtema 3: Tugasku sebagai Umat Beragama85", "Buku Siswa Kelas 2 SD/MI96". */
function judulHalaman(k: string): boolean {
  return ["Subtema ", "Buku Siswa", "Buku Guru", "SD/MI", "SMP/MTs", "SMA/MA"].some((p) => k.includes(p));
}

const AKHIR_KALIMAT = ".?!";

/** Batas kalimat yang memuat rentang [a, b): diperluas sampai tanda akhir kalimat atau butir
 *  "•", paling jauh 300 karakter ke tiap arah. */
function kalimatPembungkus(t: string, a: number, b: number): { kiri: number; kanan: number } {
  let kiri = a;
  while (kiri > 0 && a - kiri < 300) {
    if (t[kiri - 1] === "•") break;
    if (t[kiri - 1] === " " && kiri >= 2 && AKHIR_KALIMAT.includes(t[kiri - 2])) break;
    kiri--;
  }
  let kanan = b;
  if (kanan > a && AKHIR_KALIMAT.includes(t[kanan - 1])) return { kiri, kanan };
  while (kanan < t.length && kanan - b < 300) {
    const ch = t[kanan];
    if (ch === "•") break;
    kanan++;
    if (AKHIR_KALIMAT.includes(ch) && (kanan >= t.length || t[kanan] === " ")) break;
  }
  return { kiri, kanan };
}

/** Di posisi i dimulai nomor butir: 1-3 angka, titik, spasi, huruf besar ("5. Pada sebuah"). */
function nomorButirDi(t: string, i: number): boolean {
  if (i > 0 && t[i - 1] !== " ") return false;
  let j = i;
  while (j < t.length && t[j] >= "0" && t[j] <= "9") j++;
  if (j - i < 1 || j - i > 3 || t[j] !== "." || t[j + 1] !== " ") return false;
  const c = t[j + 2] ?? "";
  return c !== c.toLowerCase();
}

/** Isi butir bernomor yang memuat rentang [a, b): dari nomor terdekat sebelum a (paling jauh
 *  700 karakter) sampai nomor berikutnya (paling jauh 900 karakter). Kosong bila tidak di butir. */
function isiButirBernomor(t: string, a: number, b: number): string {
  let awal = -1;
  for (let i = a; i >= 0 && a - i <= 700; i--) {
    if (nomorButirDi(t, i)) {
      awal = i;
      break;
    }
  }
  if (awal < 0) return "";
  let akhir = Math.min(t.length, b + 900);
  for (let i = b; i < akhir; i++) {
    if (nomorButirDi(t, i)) {
      akhir = i;
      break;
    }
  }
  return t.slice(awal, akhir);
}

/** Kata di soal yang terlalu umum untuk menandai bahwa sebuah kalimat membahas soal itu. */
const KATA_SOAL_UMUM = new Set([
  "contoh", "kegiatan", "menunjukkan", "terjadi", "pengertian", "disebut", "dimaksud", "maksud",
  "bacaan", "buku", "lainnya", "yaitu", "benar", "salah", "manakah", "cara",
]);

function kataSerupa(a: string, b: string): boolean {
  if (a === b) return true;
  const pendek = a.length <= b.length ? a : b;
  const panjang = a.length <= b.length ? b : a;
  return pendek.length >= 5 && panjang.includes(pendek);
}

/** Minimal satu kata penting soal (atau bentuk berimbuhannya: "rukun" di "kerukunan") muncul
 *  di sekitar kalimat buku. Menutup lubang kalibrasi: kalimat buku yang ADA tetapi dari bab lain,
 *  misalnya "Perangkat Input (Input Device)" untuk soal tentang teman berbeda agama. */
export function berkaitanDenganSoal(soal: string, teks: string): boolean {
  const ks = kataPenting(soal).filter((w) => !KATA_SOAL_UMUM.has(w));
  const kt = kataPenting(teks);
  return ks.some((a) => kt.some((b) => kataSerupa(a, b)));
}

function rapikanTampilan(s: string): string {
  let k = sambungPemenggalan(s.split("## ").join("").split("##").join("").trim());
  let i = 0;
  while (i < k.length && k[i] >= "0" && k[i] <= "9") i++;
  if (i > 0 && i <= 3 && k[i] === "." && k[i + 1] === " ") k = k.slice(i + 2);
  if (k.startsWith("•")) k = k.slice(1).trim();
  if (k.length > 600) k = k.slice(0, k.lastIndexOf(" ", 600)) + " …";
  return k;
}

/** Periksa kalimat yang DISALIN model sebagai dasar jawaban soal.
 *
 *  Model tidak dipercaya untuk menyalin dengan benar: yang dikembalikan selalu teks buku pada
 *  rentang hasil penyelarasan, bukan tulisan model. Diterima bila (1) minimal 80% skor
 *  penyelarasan kata demi kata terhadap satu kutipan, (2) rentang itu dan kalimat pembungkusnya
 *  bukan soal atau pilihan jawaban, dan bukan skenario butir soal bernomor yang disusul perintah
 *  soal, dan (3) sekitarnya membahas soal. Alasan penolakan terakhir ditambahkan ke `alasan`. */
export function verifikasiSalinan(
  tulisanModel: string,
  kutipan: Bacaan[],
  soal: string,
  alasan?: string[],
): KalimatBuku | null {
  const q = daftarKata(ratakan(tulisanModel)).slice(0, 150);
  if (q.length < 5) {
    alasan?.push("salinan kurang dari 5 kata");
    return null;
  }
  let terbaik: KalimatBuku | null = null;
  let tolak = "salinan tidak ada di buku";
  for (let n = 0; n < kutipan.length; n++) {
    const t = ratakan(kutipan[n].text);
    const kata = daftarKata(t);
    const s = selaraskan(q, kata);
    if (s.awal < 0) continue;
    const skor = s.skor / q.length;
    if (skor < 0.8) continue;
    const a = kata[s.awal].a;
    let b = kata[s.akhir].b;
    if (b < t.length && AKHIR_KALIMAT.includes(t[b])) b++;
    const { kiri, kanan } = kalimatPembungkus(t, a, b);
    const pembungkus = t.slice(kiri, kanan).trim();
    if (judulHalaman(t.slice(a, b))) {
      tolak = "salinan berupa judul atau kaki halaman";
      continue;
    }
    if (jelasSoal(t.slice(a, b)) || jelasSoal(pembungkus)) {
      tolak = "salinan berasal dari soal atau pilihan jawaban";
      continue;
    }
    // Skenario soal uraian latihan bisa berjalan beberapa kalimat sebelum perintahnya: "5. Pada
    // sebuah rapat RT, seorang warga ... (empat kalimat) ... Jelaskan sila keberapa ...". Butir
    // bernomor yang memuat kalimat PERINTAH soal adalah soal, seluruhnya. Hanya perintah, bukan
    // tanda tanya: subjudul materi "3. Kekerasan" memuat pertanyaan retoris "Bagaimana hubungan
    // di antara keduanya?", dan uraian di bawahnya sah (kalibrasi, kasus ev-104).
    const butir = isiButirBernomor(t, a, b);
    if (butir && pecahKalimat(butir).some((k) => PERINTAH_SOAL.some((p) => k.startsWith(p)))) {
      tolak = "salinan berasal dari butir soal latihan bernomor";
      continue;
    }
    const sekitar = t.slice(Math.max(0, a - 300), Math.min(t.length, b + 300));
    if (!berkaitanDenganSoal(soal, sekitar)) {
      tolak = "kalimat ada di buku tetapi tidak membahas soal";
      continue;
    }
    if (terbaik === null || skor > terbaik.skor) {
      terbaik = {
        kalimat: rapikanTampilan(t.slice(a, b)),
        n: n + 1,
        judul: kutipan[n].title,
        bagian: kutipan[n].section,
        skor: Number(skor.toFixed(2)),
      };
    }
  }
  if (terbaik === null) alasan?.push(tolak);
  return terbaik;
}

/** Periksa satu isian salinan model: utuh dulu, lalu per baris dan per kalimat.
 *
 *  Model sering menggabungkan kalimat yang di buku berjauhan ("Semua siswa bekerja bersama ...
 *  Semua siswa sangat senang melakukan kerja bakti." dengan kalimat definisi di antaranya
 *  dilewati) atau menempelkan judul halaman di depan salinan. Salinan utuhnya tidak berurutan
 *  di buku walau setiap kalimatnya ada, sehingga pemeriksaan utuh saja salah menolak. */
export function verifikasiSalinanModel(
  tulisanModel: string,
  kutipan: Bacaan[],
  soal: string,
  alasan?: string[],
): KalimatBuku[] {
  const utuh = verifikasiSalinan(tulisanModel, kutipan, soal, alasan);
  if (utuh) return [utuh];
  const hasil: KalimatBuku[] = [];
  for (const baris of tulisanModel.split(String.fromCharCode(10))) {
    for (const k of pecahKalimat(baris)) {
      if (k.length === ratakan(tulisanModel).length) continue; // sama dengan salinan utuh
      const v = verifikasiSalinan(k, kutipan, soal, alasan);
      if (v && !hasil.some((x) => x.kalimat === v.kalimat)) hasil.push(v);
    }
  }
  return hasil;
}
