# Eval set Elise — 172 item berlabel

Sebelum ini, setiap klaim soal kualitas adapter bersandar pada 6–12 pertanyaan dadakan.
Cara itu sudah terbukti menyesatkan dua kali: chip "rangkaian listrik seri dan paralel"
dipilih karena kata "listrik" muncul 71x padahal frasanya nol di korpus, dan sebuah
harness lama melaporkan "0/12 regresi" padahal yang terjadi adalah exception yang
tertelan jadi jawaban kosong.

Eval set ini dibangun supaya kedua kesalahan itu tidak bisa terulang.

## Prinsip

**Pertanyaan grounded diturunkan DARI korpus, bukan dari hitungan kata.** Tiap bibit
berasal dari kalimat definisi sungguhan di dalam chunk (`X adalah/merupakan/yaitu ...`),
lalu disaring dengan tiga uji yang semuanya berbasis korpus:

- **Frekuensi dokumen 4–60.** Di bawah 4 itu tokoh cerita ("Ransi dan Aksa"); di atas 60
  topiknya terlalu luas ("Indonesia", "bahasa") sehingga tidak membuktikan apa pun.
- **Uji ligatur OCR.** PDF ini kehilangan huruf `f` sebelum i/l (`konlik`, `proil`).
  Tidak perlu kamus: kalau menyisipkan `f` menghasilkan string yang JUGA ada di korpus,
  bentuk pendeknya adalah artefak.
- **Filter scaffolding** untuk SD, yang bukunya buku guru naratif — nol kalimat definisi,
  jadi bibitnya diambil dari judul bagian berisi materi ("Menjenguk Teman Sakit"),
  sementara judul aparatus guru ("Penilaian", "Ayo Berlatih", "Remedial") dibuang.

**Tiap item sudah diukur sebelum masuk set.** 1054 kandidat disekor dengan retriever
produksi (bge-m3 + cosine, di dalam container, terhadap embedding chunk yang sama), lalu
dipilih dengan margin di kedua sisi ambang guardrail 0,55:

| syarat | ambang | kategori |
|---|---|---|
| harus sampai ke model | skor ≥ 0,58 | grounded, detail-absent, figure-*, bilingual, latihan-*, belajar |
| harus diblokir gerbang | skor ≤ 0,50 | out-of-corpus |

Versi pertama ditulis dulu baru diaudit, dan hasilnya 12 item "grounded" ternyata di
bawah ambang (guardrail akan menolaknya) serta 11 item detail-absent tidak pernah sampai
ke model. Urutan itu dibalik: sekarang tidak ada item yang labelnya belum terbukti.

## Isi

172 item, 11 kategori, tiap item berlabel jenjang/kelas/mode + harapan yang bisa diperiksa
(`jawab`, `sitasi`, `figure`, `bahasa`, `format`) + `skor_retrieval` + `mekanisme`.

`mekanisme` menyebut lapisan mana yang diharapkan menghasilkan perilaku itu. Penting untuk
kategori **safety**: skornya 0,46–0,57, artinya sebagian ditolak guardrail sebelum model
pernah dipanggil. Bagi murid itu tetap penolakan, tapi angkanya mengukur gerbang, bukan
adapter — dan file ini menyebutkannya, bukan menyamarkannya.

## Menjalankan

```
python run_eval.py                       # seluruh set
python run_eval.py --kategori grounded   # satu kategori
python run_eval.py --workers 4 --url http://10.17.254.27:3090
```

Runner memakai `/api/chat` sungguhan supaya prompt yang diuji adalah prompt verbatim yang
dibangun aplikasi (kontrak §09) — bukan parafrase, yang dulu membuat askv3 dihukum keliru.
Exception dicatat sebagai error dan **tidak pernah** dihitung sebagai penolakan.

## Membangun ulang

```
python seed_grounded.py      # chunks.json -> seeds.json  (uji korpus)
python make_candidates.py    # seeds.json  -> candidates.json
python score_queries.py      # skor pakai retriever produksi -> scores.json
python assemble_evalset.py   # pilih dengan margin -> eval_set.json
```

## Temuan yang sudah tercatat

- **Mockup live tertinggal dari source** (8 Sep 2026). Respons guardrail melaporkan
  `threshold: 0.5` padahal source memakai 0,55, dan image masih memuat 21 figure termasuk
  `fig-listrik`/`fig-siklus-air` yang sudah dipensiunkan (source: 19). Perbaikan minggu ini
  belum benar-benar terpasang; perlu rebuild. Catatan: mencari nama variabel (`byDoc`) di
  bundle TIDAK sahih sebagai bukti — build produksi meminifikasi nama lokal. Pakai penanda
  yang kebal minifikasi: string literal atau field respons live.
- **Satu kebocoran guardrail tersisa:** "Apa merek mobil listrik terlaris?" skor 0,560,
  nyangkut ke bab Tanah di buku IPA IX gara-gara kata "listrik" — kata yang sama yang jadi
  akar kasus seri/paralel. Sengaja TIDAK dimasukkan ke set (biar out-of-corpus tetap bersih)
  tapi dicatat di sini sebagai kasus sulit yang diketahui.
