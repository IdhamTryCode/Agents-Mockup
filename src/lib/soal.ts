/** Membuang framing RAG dari teks soal sebelum sampai ke siswa.
 *
 *  Siswa RantAI Agents TIDAK melihat kutipan apa pun -- hanya soalnya. Jadi kalimat
 *  seperti "Menurut bacaan, ..." mengandaikan sesuatu yang tidak ada di layarnya, dan
 *  "kutipan" itu sendiri istilah internal sistem.
 *
 *  Diukur pada 758 soal di data latih practice v4: 181 memuat framing itu (23,9%).
 *  Pembersih ini menangani 93% di antaranya, dan -- yang lebih penting -- mengubah
 *  NOL dari 577 soal yang memang sudah bersih.
 *
 *  INI TAMBALAN, BUKAN OBAT. Frasanya ada di data latih, jadi model memang
 *  mempelajarinya; obat sebenarnya adalah membersihkan dataset lalu melatih
 *  practice v5.
 *
 *  Ditulis dengan operasi string biasa, TANPA regex. Alasannya bukan gaya: sebuah
 *  regex yang escape-nya luruh tetap lolos typecheck lalu merusak teks soal di
 *  produksi tanpa ada yang tahu. Dengan string biasa, kegagalan seperti itu mustahil.
 */

// "sumber" dan "teks" SENGAJA tidak ada di sini. Keduanya punya pemakaian yang sah
// ("berdasarkan sumber bunyi" di soal musik), dan memasukkannya terbukti merusak 4 soal
// yang tadinya benar: "diimitasi berdasarkan sumber bunyi" menjadi "diimitasi bunyi".
const SUMBER = ["kutipan di atas", "bacaan di atas", "teks di atas", "materi di atas",
                "kutipan", "bacaan"];
const KATA = ["menurut", "berdasarkan", "sesuai dengan", "sesuai", "mengacu pada"];

const FRASA: string[] = [];
for (const k of KATA) for (const s of SUMBER) FRASA.push(k + " " + s);
for (const s of SUMBER) {
  FRASA.push("yang ada pada " + s, "yang ada di " + s,
             "yang disebutkan dalam " + s, "yang disebutkan pada " + s,
             "yang tertulis pada " + s,
             "pada " + s, "dalam " + s, "di " + s);
}
// Terpanjang dulu, supaya "yang ada pada kutipan" menang atas "pada kutipan".
FRASA.sort((a, b) => b.length - a.length);

const RAPI: [string, string][] = [
  ["  ", " "], [" ,", ","], [",,", ","], [" .", "."], [" ?", "?"],
  [" !", "!"], [", ,", ","], ["( ", "("], [" )", ")"],
];

export function bersihkanSoal(teks: string): string {
  let s = teks.trim();
  // Beberapa putaran: satu soal bisa memuat lebih dari satu frasa.
  for (let putaran = 0; putaran < 4; putaran++) {
    const low = s.toLowerCase();
    let pos = -1;
    let pakai = "";
    for (const f of FRASA) {
      const i = low.indexOf(f);
      if (i >= 0 && (pos < 0 || i < pos)) { pos = i; pakai = f; }
    }
    if (pos < 0) break;

    s = s.slice(0, pos) + s.slice(pos + pakai.length);
    for (const [a, b] of RAPI) while (s.includes(a)) s = s.split(a).join(b);
    s = s.trim();
    while (s.startsWith(",")) s = s.slice(1).trim();
    if (s.length > 0) s = s[0].toUpperCase() + s.slice(1);

    // Kapitalkan huruf pertama tiap kalimat berikutnya.
    let keluar = "";
    let i = 0;
    while (i < s.length) {
      keluar += s[i];
      if ((s[i] === "." || s[i] === "?" || s[i] === "!") && i + 2 < s.length && s[i + 1] === " ") {
        keluar += " " + s[i + 2].toUpperCase();
        i += 3;
        continue;
      }
      i++;
    }
    s = keluar;
  }
  return s.trim();
}
