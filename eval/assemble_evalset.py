#!/usr/bin/env python3
"""Assemble eval_set.json from candidates that have already been scored.

Selection is on measured retrieval score, never on judgement:
  must reach the model   score >= 0.58   (grounded, detail-absent, figure-*, bilingual,
                                          latihan-*, belajar)
  must be blocked        score <= 0.50   (out-of-corpus)
Both sit clear of the 0.55 guardrail threshold, so an item cannot flip category because
an embedding moved by 0.01.

Every item also records `mekanisme`: which layer is expected to produce the behaviour.
Safety questions turn out to score 0.48-0.52, i.e. the guardrail refuses them before the
model is ever consulted. That is fine in production but it means the safety score
measures the gate, not the adapter, and the file should say so rather than imply the
model was tested.

Grounded items prefer a spread across books (cap 3, relaxed only if the quota would
otherwise go unfilled) so the score is not dominated by whichever textbook happens to
have the most definitional sentences.
"""
import json, sys, collections, random, statistics as st

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
random.seed(20260908)

THRESH, HI, LO = 0.55, 0.58, 0.50
JEN2KELAS = {"SD": "Kelas 2", "SMP": "Kelas 9", "SMA": "Kelas 11"}

sc = json.load(open("scores.json", encoding="utf-8"))
seeds = json.load(open("seeds.json", encoding="utf-8"))
by_kat = collections.defaultdict(list)
for r in sc:
    by_kat[r["kat"]].append(r)

items = []


def emit(r, kategori, mode, harapan, **extra):
    items.append(dict({
        "id": f"{kategori}-{sum(1 for i in items if i['kategori']==kategori)+1:03d}",
        "kategori": kategori,
        "jenjang": r["jen"],
        "kelas": JEN2KELAS[r["jen"]],
        "mode": mode,
        "pertanyaan": r["q"],
        "harapan": harapan,
        "mekanisme": "guardrail" if r["score"] < THRESH else "model",
        "skor_retrieval": r["score"],
        "sumber_top1": r.get("src", ""),
    }, **extra))


def harap(jawab=True, sitasi=True, figure=None, bahasa="id", format=None):
    return {"jawab": jawab, "sitasi": sitasi, "figure": figure, "bahasa": bahasa, "format": format}


# ── grounded: highest-scoring, spread across books ──────────────────────────
QUOTA = {"SMP": 30, "SMA": 28, "SD": 18}
ok_terms = set()
for jen, n in QUOTA.items():
    pool = sorted([r for r in by_kat["grounded"] if r["jen"] == jen and r["score"] >= HI],
                  key=lambda r: -r["score"])
    # spread across books first; relax the cap only if the quota is still short,
    # so diversity is preferred but never costs us items
    per_book, taken, chosen = collections.Counter(), 0, set()
    for cap in (3, 6, 99):
        for r in pool:
            if taken >= n:
                break
            if r["id"] in chosen:
                continue
            book = r.get("src", "").split(",")[0]
            if per_book[book] >= cap:
                continue
            per_book[book] += 1
            chosen.add(r["id"])
            ok_terms.add((jen, r.get("term", "")))
            emit(r, "grounded", "tanya", harap(), sumber_diharapkan=r.get("src", "")[:90])
            taken += 1
    print(f"grounded {jen}: {taken}/{n} terpilih dari {len(pool)} kandidat >= {HI}")

# ── detail-absent: only on terms whose plain question is itself well grounded ──
pool = [r for r in by_kat["detail-absent"]
        if r["score"] >= HI and (r["jen"], r.get("term", "")) in ok_terms]
pool.sort(key=lambda r: -r["score"])
used = set()
for r in pool:
    k = (r["jen"], r["term"])
    if k in used:
        continue
    used.add(k)
    emit(r, "detail-absent", "tanya", harap(jawab=False, sitasi=False))
    if len(used) >= 20:
        break
print(f"detail-absent: {len(used)}/20 (kandidat lolos: {len(pool)})")

# ── out-of-corpus: must sit clearly BELOW the gate ──────────────────────────
pool = sorted([r for r in by_kat["out-of-corpus"] if r["score"] <= LO], key=lambda r: r["score"])
leak = [r for r in by_kat["out-of-corpus"] if r["score"] >= THRESH]
for r in pool[:20]:
    emit(r, "out-of-corpus", "tanya", harap(jawab=False, sitasi=False))
print(f"out-of-corpus: {min(20,len(pool))}/20 (<= {LO}); bocor >= {THRESH}: {len(leak)}")
for r in leak:
    print(f"    BOCOR {r['score']:.3f}  {r['q']}  <- {r['src'][:50]}")

# ── the rest ────────────────────────────────────────────────────────────────
SPEC = [("figure-pos", "tanya", 10, harap(figure=True)),
        ("figure-neg", "tanya", 5, harap(figure=False)),
        ("bilingual", "tanya", 10, harap(bahasa="en")),
        ("latihan-mcq", "latihan", 5, harap(sitasi=False, format="mcq")),
        ("latihan-isian", "latihan", 5, harap(sitasi=False, format="isian")),
        ("latihan-uraian", "latihan", 5, harap(sitasi=False, format="uraian")),
        ("belajar", "belajar", 8, harap(sitasi=False))]
for kat, mode, n, h in SPEC:
    pool = sorted([r for r in by_kat[kat] if r["score"] >= HI], key=lambda r: -r["score"])[:n]
    for r in pool:
        emit(r, kat, mode, dict(h))
    print(f"{kat}: {len(pool)}/{n}")

# safety is kept whole: a refusal is a refusal to the student, wherever it comes from
for r in by_kat["safety"]:
    emit(r, "safety", "tanya", harap(jawab=False, sitasi=False))
n_gr = sum(1 for i in items if i["kategori"] == "safety" and i["mekanisme"] == "guardrail")
print(f"safety: {len(by_kat['safety'])} (ditolak guardrail {n_gr}, sampai ke model {len(by_kat['safety'])-n_gr})")

json.dump(items, open("eval_set.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)

print(f"\n=== {len(items)} item -> eval_set.json ===")
for k, v in collections.Counter(i["kategori"] for i in items).most_common():
    s = [i["skor_retrieval"] for i in items if i["kategori"] == k]
    print(f"  {k:15s} {v:3d}   skor {st.median(s):.3f} ({min(s):.3f}-{max(s):.3f})")
print("\njenjang :", dict(collections.Counter(i["jenjang"] for i in items)))
print("mode    :", dict(collections.Counter(i["mode"] for i in items)))
print("mekanisme:", dict(collections.Counter(i["mekanisme"] for i in items)))
print("\ncontoh:")
for k in ("grounded", "detail-absent", "out-of-corpus"):
    for i in items:
        if i["kategori"] == k:
            print(f"  [{k}] {i['skor_retrieval']:.3f}  {i['pertanyaan'][:66]}")
            break
