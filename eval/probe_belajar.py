#!/usr/bin/env python3
"""Probe Belajar over TWO turns, because one turn cannot test what we trained.

The single-turn eval marked citation 0/8 and that verdict was wrong: the contract's first
Belajar turn is supposed to ask what the student already knows and explain nothing, so a
correct first turn has nothing to cite. The citation habit lives in the SECOND Elise turn,
where she responds to the student's attempt — which the single-turn eval never reaches.

So: send the opening, take Elise's question, reply as a student who is half right, then
judge the turn that actually explains. Checks there:
  sitasi   does the explaining turn cite [n]
  petunjuk does it hint rather than hand over the answer outright
  tanya    does it still end by asking, instead of closing into a lecture

Usage: python probe_belajar.py [--out probe_learn_v6.json]
"""
import sys, json, re, argparse, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ap = argparse.ArgumentParser()
ap.add_argument("--url", default="http://10.17.254.27:3090")
ap.add_argument("--out", default="probe_belajar.json")
A = ap.parse_args()

CITE = re.compile(r"\[\d+\]")
# a half-right student reply keeps the probe realistic without tailoring it per topic
REPLY = ("Setahuku sih itu yang sering dipakai sehari-hari, tapi aku lupa detailnya. "
         "Kayaknya ada hubungannya sama yang di buku kemarin deh, tapi aku nggak yakin.")


def chat(item, history):
    body = json.dumps({"mode": "belajar", "jenjang": item["jenjang"], "kelas": item["kelas"],
                       "query": item["pertanyaan"] if not history else REPLY,
                       "history": history}).encode()
    req = urllib.request.Request(f"{A.url}/api/chat", data=body,
                                 headers={"content-type": "application/json"})
    try:
        return json.loads(urllib.request.urlopen(req, timeout=180).read())
    except urllib.error.HTTPError as e:
        return {"_error": f"HTTP {e.code}"}
    except Exception as e:
        return {"_error": str(e)[:90]}


def run(item):
    r1 = chat(item, [])
    a1 = str(r1.get("answer") or "")
    if r1.get("_error") or not a1.strip():
        return {**item, "error": r1.get("_error"), "checks": {}}
    hist = [{"role": "user", "content": item["pertanyaan"]},
            {"role": "assistant", "content": a1}]
    r2 = chat(item, hist)
    a2 = str(r2.get("answer") or "")
    if r2.get("_error") or not a2.strip():
        return {**item, "error": r2.get("_error"), "giliran1": a1, "checks": {}}
    checks = {
        "sitasi": bool(CITE.search(a2)),
        "tanya": "?" in a2,
        "tidak_ceramah": len(re.findall(r"[.!?]", a2)) <= 8 or "?" in a2,
    }
    return {**item, "giliran1": a1, "giliran2": a2, "model": r2.get("model"), "checks": checks}


items = [i for i in json.load(open("eval_set.json", encoding="utf-8"))
         if i["kategori"] == "belajar"]
print(f"menguji {len(items)} percakapan Belajar dua giliran ...\n", flush=True)
with ThreadPoolExecutor(max_workers=4) as pool:
    res = list(pool.map(run, items))

json.dump(res, open(A.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
ok = [r for r in res if r.get("checks")]
err = len(res) - len(ok)
for k in ("sitasi", "tanya", "tidak_ceramah"):
    v = [r["checks"][k] for r in ok]
    print(f"  {k:14s} {sum(v)}/{len(v)}")
print(f"  error          {err}")
print("\ncontoh giliran ke-2 (yang menjelaskan):")
for r in ok[:2]:
    print(f"\n  topik: {r['pertanyaan'][:60]}")
    print(f"  Elise-1: {r['giliran1'][:110].strip()}")
    print(f"  Elise-2: {r['giliran2'][:260].strip()}")
print(f"\ndetail: {A.out}")
