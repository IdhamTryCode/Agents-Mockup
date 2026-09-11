#!/usr/bin/env python3
"""Derive answerable questions FROM the corpus (never from keyword counts).

The seri/paralel chip is the cautionary tale: it was picked because "listrik" appeared
71 times, yet the exact phrase had zero support and scored 0.500. So every grounded
question here has to survive three corpus-derived tests.

SMP/SMA carry textbook prose, so seeds come from real "<term> adalah/merupakan/..."
sentences, then:
  * doc frequency 4..60 — under 4 it is a story character ("Ransi dan Aksa"), over 60
    it is a topic so broad ("Indonesia", "bahasa") that retrieval proves nothing
  * OCR-ligature test — these PDFs lost "f" before i/l ("konlik", "proil"). No lexicon
    needed: if reinserting an "f" yields a string the corpus ALSO contains, the shorter
    form is the artifact.

SD books are teacher's guides written as narrative — zero definitional sentences — but
their section headings carry the content ("Mengenal Pecahan Nilai Uang"). Pedagogical
scaffolding headings ("Ayo Berlatih", "Penilaian", "Remedial") are dropped, and the
chunk behind the heading must hold real prose.
"""
import re, json, collections, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ch = json.load(open("D:/Project/rantai-agents-mockup/data/chunks.json", encoding="utf-8"))
CONN = r"(?:adalah|merupakan|yaitu|ialah|artinya)"
DEF = re.compile(r"(?:^|(?<=[.!?]\s)|(?<=\n))([A-Z][A-Za-zà-ÿ\-]*(?: [a-zà-ÿ][A-Za-zà-ÿ\-]*){0,2})\s+" + CONN + r"\s+([a-zà-ÿ][^.]{30,})\.")
FUNC = set("""ini itu yang mereka kita kami dia semua contoh contohnya tugasnya pertama kedua
ketiga berikut tersebut tujuan kegiatan penilaian guru siswa buku bab gambar tabel halaman
pertanyaan jawaban langkah bagian seandainya kalian kamu anda jika kalau maka karena ketika
saat setelah sebelum dan atau salah satu bagi untuk dengan dari pada oleh tentang adapun
sedangkan namun tetapi jadi hal orang nama hasil bentuk cara jenis proses sumber materi kunci
ayo mari nah selanjutnya demikian sehingga hanya lain lainnya sebagai kemudian""".split())

low = [(c["jenjang"], c["text"].lower()) for c in ch]
_df = {}
def df(jen, term):
    k = (jen, term)
    if k not in _df:
        p = re.compile(r"\b" + re.escape(term) + r"\b")
        _df[k] = sum(1 for j, t in low if j == jen and p.search(t))
    return _df[k]

def ocr_artifact(jen, term):
    """'konlik' is 'konflik' with the fl ligature lost; the real form is in the corpus too."""
    for i, c in enumerate(term):
        if c in "il":
            if df(jen, term[:i] + "f" + term[i:]) >= 2:
                return True
    return False

seeds = collections.defaultdict(list)
seen = set()
for c in ch:
    if c["jenjang"] == "SD":
        continue
    for m in DEF.finditer(c["text"]):
        t = m.group(1).strip()
        w = [x.lower() for x in t.split()]
        if not w or len(t) < 5 or any(x in FUNC for x in w) or w[-1].endswith("nya"):
            continue
        k = (c["jenjang"], t.lower())
        if k in seen:
            continue
        seen.add(k)
        n = df(c["jenjang"], t.lower())
        if not 4 <= n <= 60 or ocr_artifact(c["jenjang"], t.lower()):
            continue
        seeds[c["jenjang"]].append({"term": t, "source": c["source"], "df": n})

# ---- SD: content-bearing section headings ----
SCAFFOLD = re.compile(r"^(ayo|penilaian|remedial|pengayaan|refleksi|releksi|daftar pustaka|"
                      r"pro[fi]il|fokus pembelajaran|subtema|glosarium|kunci|indeks|"
                      r"pendahuluan|pengantar|petunjuk|kegiatan|prosedur|materi pokok|"
                      r"tujuan|langkah|media|sumber|interaksi|remedi|belajar dari|"
                      r"mendengarkan cerita|menceritakan kembali|menuliskan cerita|"
                      r"membaca alkitab|ayo mengingat)\b", re.I)
# these mark teacher-facing apparatus and can sit anywhere in the heading
STRUCT = re.compile(r"(penilaian|remedial|pengayaan|re[fl]?leksi|daftar pustaka|pro[f]?il|glosarium|indeks|rubrik|pemetaan|kompetensi|silabus|penelaah|penyunting)", re.I)

for c in ch:
    if c["jenjang"] != "SD" or len(c["text"]) < 300:
        continue
    head = re.split(r"\s*›\s*|,\s*", c["source"])[-1].strip()
    head = re.sub(r"^[A-Z]\.\s+", "", head)
    w = head.split()
    if (len(w) < 2 or len(w) > 6 or SCAFFOLD.match(head) or STRUCT.search(head) or not re.match(r"^[A-Z]", head)):
        continue
    if re.search(r"[0-9|√]", head) or head.lower() in {s["term"].lower() for s in seeds["SD"]}:
        continue
    seeds["SD"].append({"term": head, "source": c["source"], "df": len(c["text"])})

for j in ("SD", "SMP", "SMA"):
    lst = seeds[j]
    lst.sort(key=lambda x: -x["df"])
    print(f"\n{j}: {len(lst)} bibit")
    for s in lst[:12]:
        print(f"   {s['term']}")
json.dump({k: v for k, v in seeds.items()}, open("seeds.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("\n-> seeds.json")
