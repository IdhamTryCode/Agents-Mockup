#!/usr/bin/env python3
"""Run eval_set.json against the live stack and score every expectation.

Replaces the ad-hoc harness that produced two wrong verdicts this week: a "0/12 regresi"
alarm caused by exceptions being swallowed into empty answers, and a condemnation of
askv3 built on a paraphrased preamble. So: exceptions are recorded as errors and never
counted as refusals, and every request goes through the real /api/chat, which builds the
verbatim training prompt itself.

Each item asserts up to five things; only the ones its category cares about are scored:
  jawab   answered vs refused
  sitasi  carries [n] citations
  figure  wrote [figure:N] when a relevant figure was attached, and not when it wasn't
  bahasa  replied in the language it was asked in
  format  latihan produced the requested question type

Usage:  python run_eval.py [--url http://10.17.254.27:3090] [--workers 4] [--kategori grounded]
"""
import json, sys, re, time, argparse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://10.17.254.27:3090")
ap.add_argument("--workers", type=int, default=4)
ap.add_argument("--kategori", default=None, help="run only this category")
ap.add_argument("--limit", type=int, default=0)
ap.add_argument("--out", default="eval_results.json")
ap.add_argument("--timeout", type=int, default=180)
A = ap.parse_args()

REFUSAL = re.compile(
    r"(tidak tahu berdasarkan buku|tidak (?:saya )?temukan|tidak ada (?:di|dalam) (?:buku|materi)|"
    r"belum tersedia (?:di|dalam) (?:buku|materi)|tidak dijelaskan (?:di|dalam)|"
    r"tidak (?:bisa|dapat) (?:saya )?(?:bantu|jawab)|di luar (?:materi|buku)|"
    r"i (?:don't|do not) know based on|not (?:available|found) in the (?:book|material))", re.I)
CITE = re.compile(r"\[\d+\]")
FIGURE = re.compile(r"\[figure:\s*\d+\]", re.I)
EN = set("the of and to in is are was were what how why explain please your you it this that "
         "for with a an be can does do used means difference between".split())
ID = set("yang dan di ke dari itu ini adalah untuk pada dengan tidak kamu saya bisa apa "
         "bagaimana mengapa jelaskan buku materi juga akan atau karena".split())


def lang(text: str) -> str:
    w = re.findall(r"[a-z']+", text.lower())
    if not w:
        return "?"
    en = sum(1 for x in w if x in EN)
    idn = sum(1 for x in w if x in ID)
    return "en" if en > idn else "id"


def ask(item):
    body = json.dumps({"mode": item["mode"], "jenjang": item["jenjang"],
                       "kelas": item["kelas"], "query": item["pertanyaan"],
                       "history": []}).encode()
    req = urllib.request.Request(f"{A.url}/api/chat", data=body,
                                 headers={"content-type": "application/json"})
    t0 = time.time()
    try:
        r = json.loads(urllib.request.urlopen(req, timeout=A.timeout).read())
        r["_lat"] = round(time.time() - t0, 1)
        return r
    except urllib.error.HTTPError as e:
        return {"_error": f"HTTP {e.code}: {e.read()[:120].decode('utf-8','ignore')}",
                "_lat": round(time.time() - t0, 1)}
    except Exception as e:
        return {"_error": str(e)[:120], "_lat": round(time.time() - t0, 1)}


def judge(item, r):
    """Returns {check: bool} for the checks this item's category actually asserts."""
    h = item["harapan"]
    ans = str(r.get("answer") or "")
    out = {}
    if r.get("_error") or not ans.strip():
        return {"_error": True}

    refused = bool(REFUSAL.search(ans)) or r.get("model") == "guardrail"
    out["jawab"] = (not refused) if h["jawab"] else refused

    # only judge citation when the model was supposed to answer AND did
    if h["sitasi"] and not refused:
        out["sitasi"] = bool(CITE.search(ans))

    if h["figure"] is not None and not refused:
        out["figure"] = bool(FIGURE.search(ans)) == h["figure"]

    if h["bahasa"] == "en" and not refused:
        out["bahasa"] = lang(ans) == "en"

    if h["format"]:
        low = ans.lower()
        if h["format"] == "mcq":
            out["format"] = bool(re.search(r'"(pilihan|opsi|options)"', low)
                                 or re.search(r"^\s*[a-d][.)]\s", ans, re.M))
        elif h["format"] == "isian":
            out["format"] = bool(re.search(r"\.{3,}|_{3,}|isian", low)) or not re.search(
                r'"(pilihan|opsi)"', low)
        else:  # uraian
            out["format"] = bool(re.search(r"jelaskan|uraikan|analisis|mengapa|bagaimana", low))
    return out


items = json.load(open("eval_set.json", encoding="utf-8"))
if A.kategori:
    items = [i for i in items if i["kategori"] == A.kategori]
if A.limit:
    items = items[:A.limit]
print(f"menjalankan {len(items)} item ke {A.url} ({A.workers} thread)\n", flush=True)

results, done = [], 0
with ThreadPoolExecutor(max_workers=A.workers) as pool:
    for item, r in zip(items, pool.map(ask, items)):
        checks = judge(item, r)
        results.append({**item, "checks": checks, "latency": r.get("_lat"),
                        "model": r.get("model"), "error": r.get("_error"),
                        "jawaban": str(r.get("answer") or "")[:400],
                        "n_sumber": len(r.get("sources") or []),
                        "guardrail": r.get("guardrail")})
        done += 1
        if done % 20 == 0:
            print(f"  {done}/{len(items)}", flush=True)

json.dump(results, open(A.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

# ── report ──────────────────────────────────────────────────────────────────
import collections
err = [r for r in results if r["checks"].get("_error")]
print(f"\n=== HASIL ({len(results)} item, {len(err)} error) ===")
if err:
    print("  error (TIDAK dihitung sebagai penolakan):")
    for r in err[:5]:
        print(f"    {r['id']}: {r['error']}")

CHECKS = ["jawab", "sitasi", "figure", "bahasa", "format"]
print(f"\n{'kategori':16s} {'n':>3s}  " + "  ".join(f"{c:>7s}" for c in CHECKS) + "   lat")
for kat in sorted({r["kategori"] for r in results}):
    rs = [r for r in results if r["kategori"] == kat and not r["checks"].get("_error")]
    if not rs:
        continue
    cells = []
    for c in CHECKS:
        v = [r["checks"][c] for r in rs if c in r["checks"]]
        cells.append(f"{sum(v)}/{len(v):<3d}" if v else "   -   ")
    lat = [r["latency"] for r in rs if r["latency"]]
    print(f"{kat:16s} {len(rs):3d}  " + "  ".join(f"{c:>7s}" for c in cells)
          + f"   {sum(lat)/max(1,len(lat)):.0f}s")

allc = [v for r in results for k, v in r["checks"].items() if k != "_error"]
print(f"\ntotal cek lulus: {sum(allc)}/{len(allc)} ({sum(allc)/max(1,len(allc))*100:.0f}%)")

print("\ngagal per kategori (maks 3 contoh):")
for kat in sorted({r["kategori"] for r in results}):
    bad = [r for r in results if r["kategori"] == kat
           and any(v is False for k, v in r["checks"].items() if k != "_error")]
    if not bad:
        continue
    print(f"  {kat} ({len(bad)} gagal):")
    for r in bad[:3]:
        f = [k for k, v in r["checks"].items() if v is False]
        print(f"    [{'+'.join(f)}] {r['pertanyaan'][:56]}")
        print(f"       -> {r['jawaban'][:110]}")
print(f"\ndetail lengkap: {A.out}")
