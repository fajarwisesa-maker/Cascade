"""
CASCADE — Hybrid retrieval index

Every piece of knowledge becomes a typed PASSAGE carrying:
  - text        what retrieval matches against
  - kind        OPL_STEPS | OPL_SAFETY | OPL_TROUBLE | OPL_LEARNING |
                IL_CAUSE | IL_PERMISSIVE | DS_PARAM | WO | CHAIN
  - asset_tag   hard filter, never a soft preference
  - anchor      doc id / number / revision / page / section / row
  - ref         pointer back to the structured object the composer uses

Retrieval = BM25  +  tf-idf (word 1-2gram)  +  tf-idf (char 3-5gram, so
"GA1201A", "ga 1201a" and "GA-1201A" still meet), fused with reciprocal rank
fusion. A dense embedding retriever is added to the fusion automatically if
sentence-transformers is installed; nothing depends on it.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field, asdict
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

OUT = Path(__file__).resolve().parents[1] / "out"
PILOT_TAGS = ("GA-1201A", "EA-5601")

# --------------------------------------------------------------------------
# Query-side vocabulary: field language -> document language.
# Bahasa Indonesia included because that is how operators actually ask.
# --------------------------------------------------------------------------
EXPANSIONS = [
    (r"\bkeep(s)? failing|\brecurr\w*|\brepeat\w*|\bagain\b|\bkeeps? breaking|"
     r"sering rusak|berulang|terus rusak|lagi\b",
     "repeated recurrent chain history failure"),
    (r"\bwhy\b|\bkenapa\b|\bmengapa\b|\bpenyebab\b|\broot cause\b",
     "root cause why"),
    (r"\btrip(ped|s)?\b|\bshut ?down\b|\bmati\b",
     "trip interlock initiator shutdown"),
    (r"\brestart\b|\breset\b|\bstart (it )?again\b|\bnyalakan lagi\b|"
     r"\bhidupkan lagi\b|\bstart[- ]?up\b",
     "restart reset start permissive"),
    (r"\bleak(ing|s)?\b|\bbocor\w*\b|\brembes\b", "leak seal gland drip"),
    (r"\bgetaran\b|\bvibrat\w*\b|\bbergetar\b", "vibration VSHH mm/s"),
    (r"\bmisalign\w*|\bkelurusan\b|\balignment\b", "alignment misalignment laser"),
    (r"\bfoul\w*|\bkerak\b|\bbuntu\b|\btersumbat\b|\bplug\w*\b",
     "fouling plugged deposit fines"),
    (r"\bsteps?\b|\bprocedure\b|\bhow (do|to|should)\b|\blangkah\b|"
     r"\bprosedur\b|\bcara\b|\bbagaimana\b|\bwhat should i do\b",
     "procedure steps action"),
    (r"\bsuhu\b|\btemperature\b|\btemp\b", "temperature degC"),
    (r"\btekanan\b|\bpressure\b", "pressure barg bar"),
    (r"\bpompa\b", "pump"), (r"\bbantalan\b", "bearing"),
    (r"\bdesign\b|\brated\b|\bspec\w*\b|\blimit\b|\bdatasheet\b",
     "design rated datasheet parameter"),
    (r"\bsetpoint\b|\bset point\b|\bsetting\b", "set point trip"),
]

TOKEN = re.compile(r"[a-z0-9]+(?:[-/.][a-z0-9]+)*")


def expand(q: str) -> str:
    extra = [add for pat, add in EXPANSIONS if re.search(pat, q, re.I)]
    return q + (" " + " ".join(extra) if extra else "")


def tokenize(s: str) -> list[str]:
    toks = TOKEN.findall(s.lower())
    out = []
    for t in toks:
        out.append(t)
        if "-" in t:                     # "vshh-1201" -> also "vshh", "1201"
            out.extend(p for p in t.split("-") if p)
    return out


# --------------------------------------------------------------------------
@dataclass
class Passage:
    pid: str
    kind: str
    asset_tag: str
    text: str
    anchor: dict
    ref: dict = field(default_factory=dict)


def build_passages() -> list[Passage]:
    K = json.loads((OUT / "knowledge.json").read_text())
    recs = json.loads((OUT / "failure_records.json").read_text())
    chains = json.loads((OUT / "chains_enriched.json").read_text())
    P: list[Passage] = []

    for o in K["opl"]:
        base = {"doc": o["opl_no"], "title": o["title"],
                "classification": o["classification"],
                "date_shared": o["date_shared"],
                "approved_by": o["approved_by"], "page": 1,
                "source_path": o["source_path"]}
        steps_txt = " ".join(f"{s['n']}. {s['action']} ({s['check']})" for s in o["steps"])
        P.append(Passage(f"{o['opl_no']}#steps", "OPL_STEPS", o["asset_tag"],
                         f"{o['title']}. {o['purpose']} Procedure steps: {steps_txt}",
                         {**base, "section": "4. DETAILED PROCEDURE / STEPS"},
                         {"opl_no": o["opl_no"]}))
        P.append(Passage(f"{o['opl_no']}#safety", "OPL_SAFETY", o["asset_tag"],
                         f"{o['title']} safety precautions: " + " ".join(o["safety"]),
                         {**base, "section": "2. SAFETY PRECAUTIONS"},
                         {"opl_no": o["opl_no"]}))
        for i, r in enumerate(o["troubleshooting"], 1):
            P.append(Passage(f"{o['opl_no']}#trouble{i}", "OPL_TROUBLE", o["asset_tag"],
                             f"Symptom: {r['symptom']}. Likely cause: {r['cause']}. "
                             f"Action: {r['action']}",
                             {**base, "section": "5. COMMON PROBLEMS & TROUBLESHOOTING",
                              "row": i},
                             {"opl_no": o["opl_no"], "row": i - 1}))
        if o["key_learning"]:
            P.append(Passage(f"{o['opl_no']}#learning", "OPL_LEARNING", o["asset_tag"],
                             f"{o['title']} key learning: " + " ".join(o["key_learning"]),
                             {**base, "section": "6. KEY LEARNING POINTS"},
                             {"opl_no": o["opl_no"]}))

    for il in K["interlock"]:
        base = {"doc": il["doc_number"], "rev": il["revision"],
                "logic": il["logic_no"], "sil": il["sil"], "page": 1,
                "section": "CAUSE & EFFECT MATRIX",
                "source_path": il["source_path"]}
        for c in il["causes"]:
            eff = "; ".join(il["effects"].get(e, e) for e in c["effects"])
            P.append(Passage(f"{il['doc_number']}#{c['id']}", "IL_CAUSE", il["asset_tag"],
                             f"Interlock {il['logic_no']} cause {c['id']}: {c['initiator']} "
                             f"{c['tag']} set point {c['setpoint']} voting {c['vote']}. "
                             f"Trip effects: {eff}",
                             {**base, "row": c["id"]},
                             {"interlock": il["doc_number"], "cause": c["id"]}))
        if il["permissives"]:
            P.append(Passage(f"{il['doc_number']}#permissives", "IL_PERMISSIVE",
                             il["asset_tag"],
                             "Start permissives restart reset conditions (AND gate): "
                             + "; ".join(f"{p['condition']} {p['signal']}"
                                         for p in il["permissives"]),
                             {**base, "section": "START PERMISSIVE (AND-gate)"},
                             {"interlock": il["doc_number"]}))

    for ds in K["datasheet"]:
        base = {"doc": ds["doc_number"], "rev": ds["revision"], "page": 1,
                "section": "DATA SHEET", "source_path": ds["source_path"]}
        for k, v in ds["params"].items():
            P.append(Passage(f"{ds['doc_number']}#{k}", "DS_PARAM", ds["asset_tag"],
                             f"{ds['asset_tag']} datasheet {k.lower()}: {v}",
                             {**base, "field": k},
                             {"datasheet": ds["doc_number"], "field": k}))

    for r in recs:
        if r["tag"] not in PILOT_TAGS:
            continue
        P.append(Passage(f"{r['wo']}", "WO", r["tag"],
                         f"Work order {r['wo']} {r['date'][:10]} {r['work_type']}: "
                         f"{r['problem']}. Root cause: {r['root_cause']}. "
                         f"Action: {r['action']}",
                         {"doc": r["wo"], "source": "Maintenance History (CMMS export)",
                          "date": r["date"][:10], "work_type": r["work_type"]},
                         {"wo": r["wo"]}))

    for c in chains:
        P.append(Passage(c["chain_id"], "CHAIN", c["tag"],
                         f"Repeated recurrent failure chain history on {c['tag']} "
                         f"{c['equipment']}: root mechanism {c['root_mechanism'].lower()}. "
                         + " ".join(f"{e['problem']}. {e['root_cause']}." for e in c["events"]),
                         {"doc": c["chain_id"], "source": "CASCADE chain detector",
                          "wos": c["wos"]},
                         {"chain_id": c["chain_id"]}))
    return P


# --------------------------------------------------------------------------
class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.4, b: float = 0.75):
        self.k1, self.b = k1, b
        self.docs = docs
        self.N = len(docs)
        self.avgdl = sum(len(d) for d in docs) / max(self.N, 1)
        df = Counter(t for d in docs for t in set(d))
        self.idf = {t: math.log(1 + (self.N - n + 0.5) / (n + 0.5)) for t, n in df.items()}
        self.tf = [Counter(d) for d in docs]

    def scores(self, q: list[str]) -> np.ndarray:
        out = np.zeros(self.N)
        for i, (tf, d) in enumerate(zip(self.tf, self.docs)):
            dl = len(d)
            s = 0.0
            for t in q:
                if t in tf:
                    f = tf[t]
                    s += self.idf[t] * f * (self.k1 + 1) / (
                        f + self.k1 * (1 - self.b + self.b * dl / self.avgdl))
            out[i] = s
        return out


class Retriever:
    RRF_K = 60

    def __init__(self, passages: list[Passage]):
        self.P = passages
        texts = [p.text for p in passages]
        self.bm25 = BM25([tokenize(t) for t in texts])
        self.word = TfidfVectorizer(ngram_range=(1, 2), sublinear_tf=True,
                                    stop_words="english", token_pattern=r"[A-Za-z0-9][A-Za-z0-9\-/.]*")
        self.Wm = self.word.fit_transform(texts)
        self.char = TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 5), sublinear_tf=True)
        self.Cm = self.char.fit_transform(texts)
        self.dense = None
        try:  # optional upgrade, never required
            from sentence_transformers import SentenceTransformer  # type: ignore
            self.dense = SentenceTransformer("all-MiniLM-L6-v2")
            self.Dm = self.dense.encode(texts, normalize_embeddings=True)
        except Exception:
            self.dense = None

    @property
    def mode(self) -> str:
        return "bm25+tfidf+char" + ("+dense" if self.dense else "")

    def search(self, query: str, tag: str | None = None,
               kinds: tuple[str, ...] | None = None, k: int = 8) -> list[dict]:
        q = expand(query)
        mask = np.array([
            (tag is None or p.asset_tag == tag) and (kinds is None or p.kind in kinds)
            for p in self.P])
        if not mask.any():
            return []

        rankings = []
        s_bm = self.bm25.scores(tokenize(q))
        s_w = (self.Wm @ self.word.transform([q]).T).toarray().ravel()
        s_c = (self.Cm @ self.char.transform([q]).T).toarray().ravel()
        for s in (s_bm, s_w, s_c):
            rankings.append(s)
        if self.dense is not None:
            qv = self.dense.encode([q], normalize_embeddings=True)[0]
            rankings.append(self.Dm @ qv)

        fused = np.zeros(len(self.P))
        for s in rankings:
            s = np.where(mask, s, -np.inf)
            order = np.argsort(-s)
            for rank, i in enumerate(order):
                if not mask[i] or s[i] <= 0:
                    continue
                fused[i] += 1.0 / (self.RRF_K + rank + 1)

        idx = [i for i in np.argsort(-fused) if mask[i] and fused[i] > 0][:k]
        return [{"pid": self.P[i].pid, "kind": self.P[i].kind,
                 "asset_tag": self.P[i].asset_tag, "text": self.P[i].text,
                 "anchor": self.P[i].anchor, "ref": self.P[i].ref,
                 "score": round(float(fused[i]), 5),
                 "bm25": round(float(s_bm[i]), 3)} for i in idx]


def load_retriever() -> Retriever:
    return Retriever(build_passages())


def main() -> int:
    P = build_passages()
    (OUT / "passages.json").write_text(
        json.dumps([asdict(p) for p in P], indent=1, ensure_ascii=False), encoding="utf-8")
    kinds = Counter(p.kind for p in P)
    print(f"passages: {len(P)}  {dict(kinds)}")
    R = Retriever(P)
    print(f"retrieval mode: {R.mode}\n")
    for q, tag in [("why does the hexane pump keep failing", "GA-1201A"),
                   ("pump tripped on high vibration can I restart", "GA-1201A"),
                   ("kenapa pompa hexane bocor", "GA-1201A"),
                   ("what is the tube design pressure", "EA-5601"),
                   ("steps to check seal flush", "GA-1201A")]:
        print(f"Q: {q}  [{tag}]")
        for h in R.search(q, tag=tag, k=4):
            print(f"   {h['score']:.4f} {h['kind']:13s} {h['pid'][:34]:34s} | {h['text'][:70]}")
        print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
