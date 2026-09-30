/*
 * CASCADE — browser engine (port of src/rag_index.py, src/verify.py, src/qa.py)
 *
 * Reference implementation is the Python engine at the commit recorded in the
 * bundle. This port is accepted only while web/parity.sh shows identical
 * answers for every question in the parity set. Precomputed data (passages,
 * instrument map, safeguard lists, page text, stop words) comes from the
 * bundle; only query-time logic lives here.
 *
 * Works as a browser global (window.CascadeEngine) and as a Node module.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------ utilities
  const ws = (s) => (s || "").replace(/\s+/g, " ").trim();
  const words = (s) => (s || "").toLowerCase().match(/[A-Za-z0-9]+/g) || [];
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\\/-]/g, "\\$&");
  const tagOf = (m) => `${m[1].toUpperCase()}-${m[2].toUpperCase()}`;
  const TAG_RE = /\b([A-Z]{2,5})[-\s]?(\d{3,4}[A-Z]?)\b/gi;
  const findTags = (s) => Array.from(s.matchAll(TAG_RE), tagOf);
  const re = (src, flags = "i") => new RegExp(src, flags);
  const search = (src, s) => new RegExp(src, "i").test(s);

  // Python round(x, n): round-half-even on the exact binary value.
  function pyRound(x, n = 0) {
    if (!isFinite(x)) return x;
    const s = Math.abs(x).toFixed(40);
    const [ip, fp = ""] = s.split(".");
    const keep = fp.slice(0, n), rest = fp.slice(n);
    let digits = (ip + keep).replace(/^0+(?=\d)/, "");
    const first = rest[0] || "0";
    const tail = rest.slice(1);
    let up = false;
    if (first > "5") up = true;
    else if (first === "5") {
      if (/[1-9]/.test(tail)) up = true;
      else up = parseInt(digits[digits.length - 1] || "0", 10) % 2 === 1; // tie -> even
    }
    let big = BigInt(digits || "0");
    if (up) big += 1n;
    let out = Number(big) / Math.pow(10, n);
    return x < 0 ? -out : out;
  }
  // Python f"{x:g}" for the magnitudes used here (hours, scores)
  const fmtG = (x) => {
    if (Number.isInteger(x)) return String(x);
    const s = Number(x.toPrecision(6)).toString();
    return s;
  };
  // Python f"{x:,.0f}"
  const fmtThousands = (x) => {
    const r = pyRound(x, 0);
    const neg = r < 0;
    const s = Math.abs(r).toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return neg ? "-" + s : s;
  };
  // Python's str(float) for values embedded in grounding text
  const pyStr = (v) => {
    if (v === null || v === undefined) return "None";
    if (typeof v === "boolean") return v ? "True" : "False";
    if (typeof v === "number") {
      if (Number.isInteger(v)) return v.toFixed(1);
      return String(v);
    }
    return String(v);
  };
  const dayDiff = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);

  // ------------------------------------------------------------ retrieval
  const EXPANSIONS = [
    [String.raw`\bkeep(s)? failing|\brecurr\w*|\brepeat\w*|\bagain\b|\bkeeps? breaking|sering rusak|berulang|terus rusak|lagi\b`,
      "repeated recurrent chain history failure"],
    [String.raw`\bwhy\b|\bkenapa\b|\bmengapa\b|\bpenyebab\b|\broot cause\b`, "root cause why"],
    [String.raw`\btrip(ped|s)?\b|\bshut ?down\b|\bmati\b`, "trip interlock initiator shutdown"],
    [String.raw`\brestart\b|\breset\b|\bstart (it )?again\b|\bnyalakan lagi\b|\bhidupkan lagi\b|\bstart[- ]?up\b`,
      "restart reset start permissive"],
    [String.raw`\bleak(ing|s)?\b|\bbocor\w*\b|\brembes\b`, "leak seal gland drip"],
    [String.raw`\bgetaran\b|\bvibrat\w*\b|\bbergetar\b`, "vibration VSHH mm/s"],
    [String.raw`\bmisalign\w*|\bkelurusan\b|\balignment\b`, "alignment misalignment laser"],
    [String.raw`\bfoul\w*|\bkerak\b|\bbuntu\b|\btersumbat\b|\bplug\w*\b`, "fouling plugged deposit fines"],
    [String.raw`\bsteps?\b|\bprocedure\b|\bhow (do|to|should)\b|\blangkah\b|\bprosedur\b|\bcara\b|\bbagaimana\b|\bwhat should i do\b`,
      "procedure steps action"],
    [String.raw`\bsuhu\b|\btemperature\b|\btemp\b`, "temperature degC"],
    [String.raw`\btekanan\b|\bpressure\b`, "pressure barg bar"],
    [String.raw`\bpompa\b`, "pump"], [String.raw`\bbantalan\b`, "bearing"],
    [String.raw`\bdesign\b|\brated\b|\bspec\w*\b|\blimit\b|\bdatasheet\b`, "design rated datasheet parameter"],
    [String.raw`\bsetpoint\b|\bset point\b|\bsetting\b`, "set point trip"],
  ];
  function expand(q) {
    const extra = EXPANSIONS.filter(([p]) => search(p, q)).map(([, a]) => a);
    return q + (extra.length ? " " + extra.join(" ") : "");
  }
  const TOKEN = /[a-z0-9]+(?:[-/.][a-z0-9]+)*/g;
  function tokenize(s) {
    const out = [];
    for (const t of s.toLowerCase().match(TOKEN) || []) {
      out.push(t);
      if (t.includes("-")) for (const p of t.split("-")) if (p) out.push(p);
    }
    return out;
  }
  const counter = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) || 0) + 1); return m; };

  class BM25 {
    constructor(docs, k1 = 1.4, b = 0.75) {
      this.k1 = k1; this.b = b; this.docs = docs; this.N = docs.length;
      this.avgdl = docs.reduce((a, d) => a + d.length, 0) / Math.max(this.N, 1);
      const df = new Map();
      for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
      this.idf = new Map();
      for (const [t, n] of df) this.idf.set(t, Math.log(1 + (this.N - n + 0.5) / (n + 0.5)));
      this.tf = docs.map(counter);
    }
    scores(q) {
      const out = new Array(this.N).fill(0);
      for (let i = 0; i < this.N; i++) {
        const tf = this.tf[i], dl = this.docs[i].length;
        let s = 0.0;
        for (const t of q) {
          const f = tf.get(t);
          if (f !== undefined) s += this.idf.get(t) * f * (this.k1 + 1) / (f + this.k1 * (1 - this.b + this.b * dl / this.avgdl));
        }
        out[i] = s;
      }
      return out;
    }
  }

  // sklearn TfidfVectorizer replicas (sublinear_tf, smooth_idf, l2 norm)
  class Tfidf {
    constructor(analyzer) { this.analyzer = analyzer; }
    fit(texts) {
      const docsTerms = texts.map(this.analyzer);
      const df = new Map();
      for (const terms of docsTerms) for (const t of new Set(terms)) df.set(t, (df.get(t) || 0) + 1);
      const n = texts.length;
      this.idf = new Map();
      for (const [t, d] of df) this.idf.set(t, Math.log((1 + n) / (1 + d)) + 1);
      this.docVecs = docsTerms.map((terms) => this.vec(terms));
      return this;
    }
    vec(terms) {
      const tf = counter(terms);
      const v = new Map();
      for (const [t, c] of tf) { const idf = this.idf.get(t); if (idf !== undefined) v.set(t, (Math.log(c) + 1) * idf); }
      let norm = 0; for (const x of v.values()) norm += x * x; norm = Math.sqrt(norm);
      if (norm > 0) for (const [t, x] of v) v.set(t, x / norm);
      return v;
    }
    scores(q) {
      const qv = this.vec(this.analyzer(q));
      return this.docVecs.map((dv) => {
        let s = 0; for (const [t, x] of qv) { const y = dv.get(t); if (y !== undefined) s += x * y; } return s;
      });
    }
  }
  function wordAnalyzer(stop) {
    const tp = /[A-Za-z0-9][A-Za-z0-9\-/.]*/g;
    return (doc) => {
      const toks = (doc.toLowerCase().match(tp) || []).filter((w) => !stop.has(w));
      const out = toks.slice();
      for (let i = 0; i + 1 < toks.length; i++) out.push(toks[i] + " " + toks[i + 1]);
      return out;
    };
  }
  function charWbAnalyzer(minN, maxN) {
    return (doc) => {
      const text = doc.toLowerCase().replace(/\s\s+/g, " ");
      const out = [];
      for (const w0 of text.split(/\s+/).filter(Boolean)) {
        const w = " " + w0 + " ", L = w.length;
        for (let n = minN; n <= maxN; n++) {
          let off = 0;
          out.push(w.slice(off, off + n));
          while (off + n < L) { off += 1; out.push(w.slice(off, off + n)); }
          if (off === 0) break;
        }
      }
      return out;
    };
  }

  class Retriever {
    constructor(passages, stopWords) {
      this.P = passages;
      const texts = passages.map((p) => p.text);
      this.bm25 = new BM25(texts.map(tokenize));
      this.word = new Tfidf(wordAnalyzer(new Set(stopWords))).fit(texts);
      this.char = new Tfidf(charWbAnalyzer(3, 5)).fit(texts);
      this.RRF_K = 60;
      this.mode = "bm25+tfidf+char";
    }
    search(query, tag = null, kinds = null, k = 8) {
      const q = expand(query);
      const mask = this.P.map((p) => (tag === null || p.asset_tag === tag) && (kinds === null || kinds.includes(p.kind)));
      if (!mask.some(Boolean)) return [];
      const sBm = this.bm25.scores(tokenize(q));
      const rankings = [sBm, this.word.scores(q), this.char.scores(q)];
      const n = this.P.length;
      const fused = new Array(n).fill(0);
      const idx = [...Array(n).keys()];
      for (const s0 of rankings) {
        const s = s0.map((x, i) => (mask[i] ? x : -Infinity));
        const order = idx.slice().sort((a, b) => (s[b] - s[a]) || (a - b));
        order.forEach((i, rank) => { if (mask[i] && s[i] > 0) fused[i] += 1.0 / (this.RRF_K + rank + 1); });
      }
      const top = idx.slice().sort((a, b) => (fused[b] - fused[a]) || (a - b)).filter((i) => mask[i] && fused[i] > 0).slice(0, k);
      return top.map((i) => ({ pid: this.P[i].pid, kind: this.P[i].kind, asset_tag: this.P[i].asset_tag,
        text: this.P[i].text, anchor: this.P[i].anchor, ref: this.P[i].ref,
        score: pyRound(fused[i], 5), bm25: pyRound(sBm[i], 3) }));
    }
  }

  // ------------------------------------------------------------ verifiers
  const FACT_PATTERNS = [
    ["tag", /\b[A-Z]{1,5}-\d{3,4}[A-Z]?\b/g],
    ["wo", /\bWO-\d{6}\b/g],
    ["opl", /\bOPL-[A-Z]{2}-\d{4}[A-Z]?-\d{2}\b/g],
    ["date", /\b20\d{2}-\d{2}-\d{2}\b/g],
    ["qty", /(?<![\w.])\d+(?:[.,]\d+)?\s?(?:mm\/s|barg|bar|degC|°C|m3\/h|kW|rpm|mm\/100mm|mm|MW|kg\/h|h|years?|months?|weeks?|days?|d)\b/g],
    ["money", /Rp\s?[\d.,]+/g],
  ];
  function orderedSubsequence(needle, hay) {
    let j = 0;
    for (const w of needle) { while (j < hay.length && hay[j] !== w) j++; if (j >= hay.length) return false; j++; }
    return true;
  }
  function checkVerbatim(quote, sourceCell, pageText) {
    const cellExact = ws(quote) === ws(sourceCell);
    const inPage = orderedSubsequence(words(quote), words(pageText));
    return { cell_exact: cellExact, in_page_order: inPage, passed: cellExact && inPage };
  }
  function facts(sentence) {
    const out = [];
    for (const [kind, pat] of FACT_PATTERNS) for (const m of sentence.matchAll(pat)) out.push([kind, m[0]]);
    return out;
  }
  const normFact = (f) => f.replace(/,/g, "").replace(/ /g, "").toLowerCase();
  function factSupported(kind, fact, evidence) {
    const ev = evidence.replace(/,/g, "").toLowerCase();
    const f = normFact(fact);
    if (kind === "qty") {
      const num = f.match(/[\d.]+/)[0];
      return new RegExp(`(?<![\\w.])${escRe(num)}(?![\\d])`).test(ev);
    }
    if (kind === "money") {
      const digits = f.replace(/\D/g, "");
      return ev.replace(/\D/g, "").includes(digits) || ev.replace(/\./g, "").includes(digits);
    }
    return ev.replace(/ /g, "").includes(f);
  }
  function checkGrounding(sentence, evidenceTexts, derived = {}) {
    const blob = evidenceTexts.join(" \n ");
    const unsupported = [];
    const fs = facts(sentence);
    for (const [kind, f] of fs) {
      if (factSupported(kind, f, blob)) continue;
      if (Object.keys(derived).some((d) => normFact(f).startsWith(normFact(d)) || normFact(f) === normFact(d))) continue;
      unsupported.push(f);
    }
    return { facts: fs.length, unsupported, passed: unsupported.length === 0 };
  }

  // ------------------------------------------------------------ router config
  const PILOT = ["GA-1201A", "EA-5601"];
  const SAFETY_TAXONOMY = [
    ["trip / shutdown", String.raw`\btrip\w*|\bshut ?down|\besd\b|\bmati mendadak`],
    ["restart / reset", String.raw`\bre-?start|\breset\b|\bstart[- ]?up|\bstartup|\bnyalakan`],
    ["loss of containment", String.raw`\bleak\w*|\bbocor|\brembes|\bspill`],
    ["isolation / LOTO", String.raw`\bisolat\w*|\bloto\b|\block ?out`],
    ["overpressure / relief", String.raw`\bover ?pressure|\bpsv\b|\brelief|\bcar[- ]seal`],
    ["interlock bypass", String.raw`\bbypass|\bby-pass|\bdefeat|\boverride|\bjumper|\binhibit`],
    ["hot work / permit", String.raw`\bhot work|\bpermit`],
  ];
  const DEVIATION = String.raw`\b(bypass|by-pass|defeat|override|jumper(ed)?( out)?|jump out|inhibit|disable|force(d)? (the )?(interlock|trip)|matikan interlock|put \w+ in bypass|mask (the )?(trip|alarm))\b`;
  const SETPOINT_CHANGE = String.raw`\b(raise|increase|lower|decrease|change|adjust|move|widen|reset the setting|naikkan|turunkan|ubah)\b[^.?!]{0,40}\b(trip|set ?point|setting|alarm( limit)?|set pressure)\b(?=[^.?!]*(\bto \d|\bhigher\b|\blower\b|\bup\b|\bdown\b|so (it|we)|nuisance|\bmore\b|\bless\b))`;
  const PROTECTION_REMOVAL = String.raw`\b(remove|break|cut|lepas\w*|open)\b[^.?!]{0,25}\bcar[- ]?seal|\bblock[- ]?in\b[^.?!]{0,25}\b(psv|relief)|\bisolate\b[^.?!]{0,25}\b(psv|relief valve)`;
  const NEGATED = /\b(won'?t|will not|do not|don'?t|never|not going to|tidak|tanpa)\s+(\w+\s+){0,2}$/i;
  const MODIFY_VERB = String.raw`\b(change|raise|increase|lower|decrease|adjust|modify|disable|deactivate|remove|silence|mute|suppress|inhibit|bypass|by-pass|defeat|override|jumper|block[- ]?in|turn off|switch off|ubah|naikkan|turunkan|matikan|nonaktifkan|hilangkan|lepas\w*|jadi \d|close|shut|tutup|(to|in|on|into) manual|manualkan)\b|\bset\b[^.?!]{0,30}\bto \d`;
  const PROHIBITED_OPERATION = String.raw`\bclos\w*\b[^.?!]{0,30}\b(xv-\d+|discharge)\b[^.?!]{0,40}\b(run|running|keep)\b|\b(run|running)\b[^.?!]{0,30}\bagainst (a )?closed`;
  const IDIOM_NOT_MODIFY = /\b(raises?|raised) (an|the) alarm\b|\balarm (is )?raised\b/gi;
  const INFO_QUESTION = String.raw`^\s*(why|what|when|which|who|how does|how did|does|did|is|was|explain|kenapa|mengapa|apa|kapan|siapa)\b`;
  const ACTION_ASK = String.raw`\b(can (i|we)|could (i|we)|should (i|we)|how (do|can|to|should) (i|we)?|let'?s|please|boleh|bisa|gimana cara|bagaimana cara|tolong)\b|\bto \d|\bjadi \d`;
  const SAFEGUARD_WORDS = String.raw`\b(interlock|trip\w*|alarm|psv|relief|car[- ]?seal|auto[- ]?start|standby (pump )?start|permissive|sis|esd|shutdown logic)\b`;
  const JUDGEMENT_CUE = String.raw`\b(is it safe|safe to|still safe|ok to (run|continue|keep)|can i keep (it )?running|keep running|aman( tidak)?|masih aman|boleh jalan)\b`;
  const HISTORY_CUE = String.raw`\b(cost|biaya|how much did|downtime|how long was|when did|what happened|last time|history|riwayat|kapan)\b`;
  const PARAM_CUE = String.raw`\b(what is|what's|berapa|set ?point|setting|set pressure|value|rated|design|spec\w*|material|limit|alarm at|trip at|capacity|nilai|how many|how much|number of|what oil|which oil|goes in|what (type|kind|model)|which (type|model|seal|bearing|oil)|what \w+( \w+)? (does|do) .* (use|have|run))\b`;
  const ACTION_CUE = String.raw`\b(can i|should i|restart|re-?start|reset|what (do|should) i do|boleh|bisa)\b`;
  const TRIP_CUE = String.raw`\b(trip\w*|shut ?down|restart|re-?start|reset|interlock|permissive|esd)\b`;
  const RECUR_CUE = String.raw`(\bkeeps?\s+\w+ing\b|\brecurr\w*|\brepeat\w*|\bagain\b|\bhistory\b|\broot cause\b|\bchain\b|\bsering\b|\bberulang|\bterus\s+rusak|\bwhy does .* fail|\bfailure pattern)`;
  const PROC_CUE = String.raw`\b(steps?|procedure|how (do|to|should|can)|what should i do|langkah|prosedur|cara|bagaimana|checklist)\b`;
  const SYMPTOM_CUE = String.raw`\b(leak\w*|bocor|noise|noisy|vibrat\w*|getaran|hot|overheat\w*|hunting|erratic|crack\w*|water (found )?in|panas|rising temperature|low (outlet )?temperature|knocking|hammer|drip\w*)\b`;
  const WHY_CUE = String.raw`\b(why|kenapa|mengapa|what causes|what caused|penyebab)\b`;

  const ALIASES = [
    ["GA-1201A", [String.raw`hexane (feed )?pump`, String.raw`\bfeed pump\b`, String.raw`pompa (umpan )?hexane`, String.raw`\bga-?1201b\b`, String.raw`\bpump\b`, String.raw`\bpompa\b`]],
    ["EA-5601", [String.raw`solvent heater`, String.raw`\bheat exchanger\b`, String.raw`\bexchanger\b`, String.raw`\bheater\b`, String.raw`pemanas`]],
  ];
  const GENERIC_ALIAS = new Set([String.raw`\bpump\b`, String.raw`\bpompa\b`, String.raw`\bheater\b`, String.raw`\bexchanger\b`]);
  const OUT_OF_PILOT_HINT = [
    ["YD-2301", String.raw`\bdryer\b|fluid bed`], ["DC-3401A", String.raw`\breactor\b`],
    ["KC-4501", String.raw`\bcompressor\b|kompresor`], ["LV-6701", String.raw`level control valve`],
    ["CT-7801", String.raw`cooling tower`], ["FA-8901", String.raw`reflux|accumulator|\bdrum\b`],
  ];
  const INITIATOR_HINTS = [
    [String.raw`vibrat|getaran|vshh`, "VSHH"], [String.raw`low[- ]?flow|min(imum)?[- ]?flow|fsll|deadhead`, "FSLL"],
    [String.raw`suction|psll|npsh`, "PSLL"], [String.raw`bearing temp|tshh|bearing (is )?hot`, "TSHH"],
    [String.raw`overload|electrical|mpr|motor fault`, "MPR"], [String.raw`emergency stop|e-?stop|hs-`, "HS"],
    [String.raw`foul|dp\b|pdah|differential`, "PDAH"], [String.raw`relief|psv|overpressure`, "PSV"],
    [String.raw`outlet temp|tic-|temperature control`, "TIC"],
  ];
  const INITIATOR_OPL = { VSHH: "vibration", FSLL: "minimum flow", PSLL: "priming", TSHH: "bearing",
    MPR: "start-up", HS: "start-up", PDAH: "fouling", PSV: "psv", TIC: "thermal" };
  const FOCUS = [
    ["steam trap", ["steam trap", "trap"]], ["coupling", ["coupling"]], ["bearing", ["bearing"]],
    ["mechanical seal", ["seal", "gland", "flush"]], ["tube", ["tube"]], ["gasket", ["gasket"]],
    ["grout / baseplate", ["grout", "baseplate", "foundation"]], ["impulse line", ["impulse"]],
    ["motor", ["motor", "insulation"]], ["gauge glass", ["gauge glass", "sight glass", "glass"]],
    ["control valve", ["tv-5602", "control valve", "loop"]], ["psv", ["psv"]],
    ["alignment", ["align"]], ["lubrication", ["oil", "lube", "lubrication"]],
  ];
  const FIELD_SYNONYMS = { pressure: ["p/t", "pressure"], temperature: ["p/t", "temp"], temp: ["p/t", "temp"],
    power: ["output"], motor: ["output", "driver"], flow: ["flow"], head: ["head"], seal: ["seal"],
    bearing: ["bearing"], material: ["material"], speed: ["speed"], rpm: ["speed"], tubes: ["tube"],
    gasket: ["gasket"], duty: ["duty"], area: ["area"], lubrication: ["lubrication"], oil: ["lubrication"],
    coupling: ["coupling"], npsh: ["npsh"], steam: ["steam"], fouling: ["fouling"],
    classification: ["classification", "ex protection"], hazardous: ["classification"],
    criticality: ["criticality"], current: ["current"], voltage: ["voltage"], many: ["no. of"],
    number: ["no. of"], count: ["no. of"], passes: ["passes"], length: ["length"], shaft: ["shaft"],
    impeller: ["impeller"], casing: ["casing"], baffle: ["baffle"] };
  const GENERIC = new Set(["what", "which", "the", "for", "and", "design", "rated", "value", "spec", "specs",
    "datasheet", "data", "sheet", "is", "of", "berapa", "nilai", "please", "tell", "me"]);
  const GUARD_TEXT = /defeat|bypass|override|never block|car-sealed|car seal|never isolat|without an authori[sz]ed|never run the pump against/i;

  const sp = (c) => (/^(set|sp)\b/i.test(c.setpoint) ? c.setpoint : `set point ${c.setpoint}`);
  const item = (text, evidence, o = {}) => ({ text, evidence, verbatim: !!o.verbatim, check: o.check || "", derived: o.derived || {} });
  const section = (kind, title, items = [], note = "") => ({ kind, title, items, note });

  // ------------------------------------------------------------ engine
  class Engine {
    constructor(bundle) {
      this.B = bundle;
      this.K = bundle.knowledge;
      this.recs = bundle.records;
      this.chains = bundle.chains;
      this.opl = new Map(this.K.opl.map((o) => [o.opl_no, o]));
      this.il = new Map(this.K.interlock.map((i) => [i.asset_tag, i]));
      this.ds = new Map(this.K.datasheet.map((d) => [d.asset_tag, d]));
      this.page_text = bundle.page_text;
      this.wo = new Map(this.recs.map((r) => [r.wo, r]));
      this.assets = new Map();
      for (const r of this.recs) if (!this.assets.has(r.tag)) this.assets.set(r.tag, { tag: r.tag, name: r.equipment, criticality: r.criticality });
      this.instrument_owner = bundle.instrument_owner;
      this.sgTags = new Set(bundle.safeguard_tags);
      this.sgAll = new Set(bundle.safeguard_everything);
      this.R = new Retriever(bundle.passages, bundle.stop_words);
    }

    resolveAsset(q) {
      for (const t of findTags(q)) {
        if (this.assets.has(t)) return [t, 1.0, `tag ${t} named in question`];
        if (t === "GA-1201B") return ["GA-1201A", 0.9, "GA-1201B is the standby of GA-1201A (same interlock SEQ-1201)"];
        if (this.instrument_owner[t]) { const own = this.instrument_owner[t]; return [own, 0.9, `instrument ${t} belongs to ${own}`]; }
      }
      for (const [tag, pat] of OUT_OF_PILOT_HINT) if (search(pat, q)) return [tag, 0.8, "described equipment"];
      for (const [tag, pats] of ALIASES) for (const p of pats) {
        const m = q.match(re(p));
        if (m) return [tag, GENERIC_ALIAS.has(p) ? 0.75 : 0.85, `'${m[0]}' -> ${tag}`];
      }
      return [null, 0.0, "no asset identified"];
    }

    unnegated(src, q) {
      for (const m of q.matchAll(new RegExp(src, "gi"))) if (!NEGATED.test(q.slice(0, m.index))) return true;
      return false;
    }
    modifiesSafeguard(q) {
      const named = new Set(findTags(q));
      const touches = [...named].some((t) => this.sgAll.has(t)) || search(SAFEGUARD_WORDS, q);
      if (!touches) return false;
      const cleaned = q.replace(IDIOM_NOT_MODIFY, " ");
      if (!this.unnegated(MODIFY_VERB, cleaned)) return false;
      if (search(INFO_QUESTION, q) && !search(ACTION_ASK, q)) return false;
      return true;
    }
    classify(q) {
      const named = new Set(findTags(q));
      const guarded = /interlock|trip|alarm|safety|sis|permissive|min-?flow|psv|relief/i.test(q) || [...named].some((t) => this.sgTags.has(t));
      if ((this.unnegated(DEVIATION, q) && guarded) || this.unnegated(PROTECTION_REMOVAL, q)
        || (this.unnegated(SETPOINT_CHANGE, q) && guarded) || this.modifiesSafeguard(q)
        || this.unnegated(PROHIBITED_OPERATION, q)) return "DEVIATION";
      if (search(JUDGEMENT_CUE, q)) return "JUDGEMENT";
      if (search(HISTORY_CUE, q)) return "RECURRING";
      if (search(TRIP_CUE, q) && search(PARAM_CUE, q) && !search(ACTION_CUE, q)) return "PARAMETER";
      if (search(TRIP_CUE, q)) return "TRIP_RESTART";
      if (search(RECUR_CUE, q)) return "RECURRING";
      if (search(PROC_CUE, q)) return "PROCEDURE";
      if (search(PARAM_CUE, q) && !search(SYMPTOM_CUE, q)) return "PARAMETER";
      if (search(SYMPTOM_CUE, q)) return "SYMPTOM";
      if (search(WHY_CUE, q)) return "SYMPTOM";
      return "GENERAL";
    }
    safetyFlags(q, intent) {
      const flags = SAFETY_TAXONOMY.filter(([, p]) => search(p, q)).map(([n]) => n);
      if ((intent === "TRIP_RESTART" || intent === "DEVIATION") && !flags.length) flags.push("trip / shutdown");
      if (intent === "JUDGEMENT") flags.push("live-condition judgement requested");
      if (intent === "DEVIATION" && (search(SETPOINT_CHANGE, q) || search(PROTECTION_REMOVAL, q) || search(MODIFY_VERB, q)))
        flags.push("change to a protective setting / device");
      return flags;
    }

    // ---------------------------------------------------- evidence builders
    evOpl(E, oplNo, sectionName, quote = "") {
      const o = this.opl.get(oplNo);
      const eid = `E${E.length + 1}`;
      const steps = o.steps.map((s) => `${s.n}. ${s.action} (${s.check})`).join(" ");
      const trouble = o.troubleshooting.map((r) => `${r.symptom} ${r.cause} ${r.action}`).join(" ");
      E.push({ eid, kind: "OPL", label: `${o.opl_no} — ${o.title}`, doc: o.opl_no, locator: `${sectionName}, p1`,
        meta: { classification: o.classification, date_shared: o.date_shared, approved_by: o.approved_by,
          reviewed_by: o.reviewed_by, related_interlock: o.related_interlock, pid_ref: o.pid_ref },
        ground_text: `${o.opl_no} ${o.title} shared ${o.date_shared} ${o.related_interlock} ${o.pid_ref} ${steps} ${trouble} ${o.safety.join(" ")} ${o.key_learning.join(" ")}`,
        quote, source_path: o.source_path });
      return eid;
    }
    evIl(E, tag, locator, quote = "") {
      const il = this.il.get(tag);
      const eid = `E${E.length + 1}`;
      const rows = il.causes.map((c) => `${c.id} ${c.initiator} ${c.tag} ${c.setpoint} ${c.vote} ${c.effects.map((e) => il.effects[e] ?? e).join(" ")}`).join(" ");
      const perm = il.permissives.map((p) => `${p.condition} ${p.signal}`).join(" ");
      E.push({ eid, kind: "INTERLOCK", label: `${il.doc_number} Rev ${il.revision} — ${il.logic_no} (${il.sil})`, doc: il.doc_number,
        locator, meta: { revision: il.revision, logic: il.logic_no, sil: il.sil },
        ground_text: `${il.doc_number} ${il.logic_no} ${il.sil} ${il.description} ${rows} ${perm} ${il.notes.join(" ")}`,
        quote, source_path: il.source_path });
      return eid;
    }
    evDs(E, tag, field) {
      const ds = this.ds.get(tag);
      const eid = `E${E.length + 1}`;
      E.push({ eid, kind: "DATASHEET", label: `${ds.doc_number} Rev ${ds.revision}`, doc: ds.doc_number,
        locator: `field '${field}', p1`, meta: { revision: ds.revision },
        ground_text: `${tag} ${ds.doc_number} ${field} ${ds.params[field]}`, quote: ds.params[field], source_path: ds.source_path });
      return eid;
    }
    evWo(E, wo) {
      const r = this.wo.get(wo);
      const eid = `E${E.length + 1}`;
      E.push({ eid, kind: "WORK_ORDER", label: `${wo} (${r.date.slice(0, 10)}, ${r.work_type})`, doc: wo,
        locator: "Maintenance History (CMMS export)", meta: { date: r.date.slice(0, 10), downtime_h: r.downtime_h, cost_idr: r.cost_idr },
        ground_text: `${wo} ${r.tag} ${r.date.slice(0, 10)} ${r.problem} ${r.root_cause} ${r.action} downtime ${pyStr(r.downtime_h)} h cost ${pyStr(r.cost_idr)} ${r.related_interlock}`,
        quote: r.root_cause, source_path: "" });
      return eid;
    }
    evChain(E, ch) {
      const eid = `E${E.length + 1}`;
      E.push({ eid, kind: "CHAIN", label: `${ch.chain_id} (CASCADE chain detector)`, doc: ch.chain_id,
        locator: `${ch.n_events} linked work orders`, meta: { confidence: ch.confidence, links: ch.links },
        ground_text: `${ch.chain_id} ${ch.tag} ${ch.root_mechanism} ${ch.wos.join(" ")} ` +
          ch.events.map((e) => `${e.date.slice(0, 10)} ${e.problem} ${e.root_cause}`).join(" ") +
          ` detectable ${ch.detectable_on} lesson ${ch.first_lesson_shared_on ?? ""}`,
        quote: "", source_path: "" });
      return eid;
    }

    // ---------------------------------------------------- pickers
    bestOpl(tag, query, prefer = "") {
      const hits = this.R.search(query, tag, ["OPL_STEPS"], 6);
      if (prefer) {
        for (const h of hits) if (this.opl.get(h.ref.opl_no).title.toLowerCase().includes(prefer)) return h.ref.opl_no;
        for (const o of this.opl.values()) if (o.asset_tag === tag && o.title.toLowerCase().includes(prefer)) return o.opl_no;
      }
      return hits.length ? hits[0].ref.opl_no : null;
    }
    stepsSection(E, oplNo, title) {
      const o = this.opl.get(oplNo);
      const eid = this.evOpl(E, oplNo, "4. DETAILED PROCEDURE / STEPS");
      return section("steps", title, o.steps.map((s) => item(`${s.n}. ${s.action}`, [eid], { verbatim: true, check: s.check })),
        `${o.opl_no} · ${o.classification} · approved by ${o.approved_by} · shared ${o.date_shared} · interlock ${o.related_interlock} · P&ID ${o.pid_ref}`);
    }
    safetySection(E, oplNo) {
      const o = this.opl.get(oplNo);
      const eid = this.evOpl(E, oplNo, "2. SAFETY PRECAUTIONS");
      return section("safety", "Safety precautions (verbatim)", o.safety.map((s) => item(s, [eid], { verbatim: true })));
    }
    chainsFor(tag) {
      return this.chains.filter((c) => c.tag === tag)
        .sort((a, b) => (b.n_events - a.n_events) || (b.total_downtime_h - a.total_downtime_h));
    }
    chainOf(wo) { return this.chains.find((c) => c.wos.includes(wo)) || null; }

    // ---------------------------------------------------- composers
    composeChain(E, ch) {
      const cid = this.evChain(E, ch);
      const mech = ch.root_mechanism.toLowerCase().replace(/_/g, " ");
      const sec = section("chain", `${ch.chain_id}: ${ch.n_events} linked failures — ${mech}`, [],
        `chain confidence ${ch.confidence}` + (ch.loss_of_containment ? " · LOSS OF CONTAINMENT in chain" : ""));
      const woE = [];
      for (const e of ch.events) {
        const weid = this.evWo(E, e.wo); woE.push(weid);
        const dt = e.downtime_h ? `, ${fmtG(e.downtime_h)} h down` : "";
        const cost = e.cost_idr ? `, Rp ${fmtThousands(e.cost_idr)}` : "";
        sec.items.push(item(`${e.date.slice(0, 10)} · ${e.wo} · ${e.problem} — root cause: ${e.root_cause}${dt}${cost}`, [weid, cid]));
      }
      for (const ln of ch.links) {
        sec.items.push(item(`Link ${ln.frm} → ${ln.to}: ${ln.rationale} (score ${ln.score}, ${ln.factors.gap_days} d apart).`, [cid],
          { derived: { [String(ln.score)]: "link score", [`${ln.factors.gap_days} d`]: "date difference" } }));
      }
      const acted = ch.events.slice(0, -1).map((e) => e.wo);
      if (ch.events.length >= 3) {
        sec.items.push(item(`Corrective actions on ${acted.join(", ")} were each followed by a further linked failure; the mechanism was not eliminated by ${ch.events[ch.events.length - 1].date.slice(0, 10)}.`,
          [...woE, cid]));
      }
      const d = {};
      d[`${fmtG(ch.total_downtime_h)} h`] = "sum of Downtime_Hours";
      d[`Rp ${fmtThousands(ch.total_cost_idr)}`] = "sum of Total_Cost_IDR";
      d[`${ch.span_days} days`] = "last − first event";
      sec.items.push(item(`Recorded impact across the chain: ${fmtG(ch.total_downtime_h)} h downtime, Rp ${fmtThousands(ch.total_cost_idr)} maintenance cost, over ${ch.span_days} days.`, woE, { derived: d }));
      return sec;
    }
    composeLesson(E, ch) {
      const k = (ch.knowledge_links || []).filter((h) => h.date_shared);
      if (!k.length) return null;
      const first = k.reduce((a, b) => (b.date_shared < a.date_shared ? b : a));
      const oeid = this.evOpl(E, first.opl_no, "header / signature block");
      const cid = this.evChain(E, ch);
      const ev2 = ch.events[1];
      const w2 = this.evWo(E, ev2.wo);
      const lat = ch.lesson_latency_days;
      const early = dayDiff(first.date_shared, ch.detectable_on);
      const sec = section("lesson", "Lesson timeline");
      sec.items.push(item(`CASCADE could raise this chain on ${ch.detectable_on}, when its second linked work order ${ev2.wo} was recorded.`, [w2, cid]));
      const nb = ch.events_before_lesson;
      const phrase = (nb === 2 && ch.n_events === 2) ? "both linked failures"
        : nb === ch.n_events ? `all ${nb} linked failures` : `${nb} of ${ch.n_events} linked failures`;
      sec.items.push(item(`The first OPL covering it, ${first.opl_no} (${first.classification}), was shared on ${first.date_shared} — ${lat} days after the first event, and after ${phrase} had occurred.`,
        [oeid, cid], { derived: { [`${lat} days`]: "date_shared − first event date" } }));
      sec.items.push(item(`Detection at the second event would have surfaced the pattern ${early} days before that OPL existed.`,
        [oeid, w2], { derived: { [`${early} days`]: "date_shared − detectable_on" } }));
      return sec;
    }
    notVerified(list) { return section("not_verified", "Not verified by CASCADE — confirm in the field", list.map((x) => item(x, []))); }

    focusOf(q) {
      const ql = q.toLowerCase();
      for (const [name, terms] of FOCUS) if (terms.some((t) => new RegExp(`\\b${escRe(t)}`).test(ql))) return [name, terms];
      return null;
    }

    // ---------------------------------------------------- intents
    aRecurring(q, tag, E, S) {
      let chains = this.chainsFor(tag);
      const focus = this.focusOf(q);
      if (focus) {
        const [name, terms] = focus;
        const involves = (c) => { const blob = c.events.map((e) => `${e.problem} ${e.root_cause} ${e.action}`).join(" ").toLowerCase(); return terms.some((t) => blob.includes(t)); };
        chains = chains.filter(involves);
        if (!chains.length) {
          const hist = this.recs.filter((r) => r.tag === tag && r.cause_recorded && terms.some((t) => `${r.problem} ${r.root_cause} ${r.action}`.toLowerCase().includes(t)));
          if (!hist.length) return "no_chain";
          const sec = section("history", `No recurring failure chain on ${tag} involves the ${name}`, [], `${hist.length} recorded occurrence(s) with a root cause`);
          for (const r of hist) {
            const weid = this.evWo(E, r.wo);
            const extra = r.cost_idr ? `, Rp ${fmtThousands(r.cost_idr)}` : "";
            sec.items.push(item(`${r.date.slice(0, 10)} · ${r.wo} · ${r.problem} — root cause: ${r.root_cause}${extra}`, [weid]));
          }
          S.push(sec);
          let oplNo = null;
          for (const o of this.opl.values()) if (o.asset_tag === tag && terms.some((t) => o.title.toLowerCase().includes(t))) { oplNo = o.opl_no; break; }
          oplNo = oplNo || this.bestOpl(tag, q);
          if (oplNo) S.push(this.stepsSection(E, oplNo, "Approved check (verbatim)"));
          return null;
        }
      }
      if (!chains.length) return "no_chain";
      for (const ch of chains) { S.push(this.composeChain(E, ch)); const les = this.composeLesson(E, ch); if (les) S.push(les); }
      const top = chains[0];
      let oplNo = (top.knowledge_links && top.knowledge_links.length) ? top.knowledge_links[0].opl_no : null;
      const named = new Set(findTags(q)); named.delete(tag);
      if (named.size) {
        const cand = this.bestOpl(tag, q);
        if (cand) {
          const hay = JSON.stringify(this.opl.get(cand).steps) + this.opl.get(cand).title;
          if ([...named].some((t) => hay.includes(t))) oplNo = cand;
        }
      }
      if (oplNo) S.push(this.stepsSection(E, oplNo, "Current approved check (verbatim)"));
      return null;
    }

    findCause(il, q) {
      let cause = null;
      for (const t of findTags(q)) cause = il.causes.find((c) => c.tag === t) || cause;
      if (!cause) for (const [pat, prefix] of INITIATOR_HINTS) {
        if (search(pat, q)) { cause = il.causes.find((c) => c.tag.startsWith(prefix)) || null; if (cause) break; }
      }
      return cause;
    }

    aTrip(q, tag, E, S, notv) {
      const il = this.il.get(tag);
      if (!il) return "no_interlock";
      if (!il.causes.length || !il.logic_no.startsWith("SEQ")) {
        const eid = this.evIl(E, tag, "header", il.logic_no);
        const sec = section("cause_effect", `${tag} has no dedicated ESD trip`, [item(`Logic: ${il.logic_no} — ${il.description}`, [eid])]);
        for (const c of il.causes) {
          const ceid = this.evIl(E, tag, `C&E row ${c.id}`);
          sec.items.push(item(`${c.id} · ${c.initiator} · ${c.tag} · ${c.setpoint} · ${c.vote} → ${c.effects.map((e) => il.effects[e] ?? e).join(", ")}`, [ceid], { verbatim: true }));
        }
        S.push(sec);
        if (il.permissives.length) {
          const peid = this.evIl(E, tag, "START PERMISSIVE (AND-gate)");
          S.push(section("permissives", "Return to service only when ALL start permissives are true (AND gate)",
            il.permissives.map((p) => item(`${p.n}. ${p.condition} — ${p.signal}`, [peid], { verbatim: true }))));
        }
        const oplNo = this.bestOpl(tag, q + " start-up", "start-up");
        if (oplNo) S.push(this.stepsSection(E, oplNo, "Approved start-up check (verbatim)"));
        notv.push("What stopped the unit — no SIS trip exists, so the stop was manual or upstream",
          "Current process values (no live historian / DCS connection in this pilot)",
          "Status of each start permissive signal in the field");
        return null;
      }
      const cause = this.findCause(il, q);
      const sec = section("cause_effect", `Interlock ${il.logic_no} (${il.sil}) — cause & effect`);
      for (const c of (cause ? [cause] : il.causes)) {
        const ceid = this.evIl(E, tag, `C&E row ${c.id}`);
        sec.items.push(item(`${c.id} · ${c.initiator} · ${c.tag} · ${sp(c)} · vote ${c.vote}`, [ceid], { verbatim: true }));
        for (const e of c.effects) sec.items.push(item(`   → ${e}: ${il.effects[e] ?? e}`, [ceid], { verbatim: true }));
      }
      if (!cause) sec.note = "Initiator not stated — all trip causes shown. Name the alarm (e.g. VSHH-1201) to narrow.";
      const latch = il.notes.find((n) => n.toLowerCase().includes("latched")) || "";
      if (latch) sec.items.push(item(latch, [this.evIl(E, tag, "NOTES", latch)], { verbatim: true }));
      const dummy = il.notes.find((n) => n.toLowerCase().includes("dummy")) || "";
      if (dummy) sec.items.push(item(`Document caveat: ${dummy}`, [this.evIl(E, tag, "NOTES", dummy)], { verbatim: true }));
      S.push(sec);
      const peid = this.evIl(E, tag, "START PERMISSIVE (AND-gate)");
      S.push(section("permissives", "Restart only when ALL start permissives are true (AND gate)",
        il.permissives.map((p) => item(`${p.n}. ${p.condition} — ${p.signal}`, [peid], { verbatim: true }))));
      const prefer = cause ? (INITIATOR_OPL[cause.tag.split("-")[0]] || "") : "";
      const oplNo = this.bestOpl(tag, q, prefer);
      if (oplNo) S.push(this.stepsSection(E, oplNo, "Approved recovery check (verbatim)"));
      if (cause) {
        const prior = this.recs.filter((r) => r.tag === tag && `${r.problem} ${r.root_cause}`.includes(cause.tag) && r.work_type === "Corrective");
        if (prior.length) {
          const hs = section("history", `Previous ${cause.tag} trips on ${tag}`);
          for (const r of prior) {
            const weid = this.evWo(E, r.wo);
            hs.items.push(item(`${r.date.slice(0, 10)} · ${r.wo} · ${r.problem} — root cause: ${r.root_cause}`, [weid]));
            const ch = this.chainOf(r.wo);
            if (ch) {
              const ceid = this.evChain(E, ch);
              hs.items.push(item(`${r.wo} opened chain ${ch.chain_id} (${ch.root_mechanism.toLowerCase()}): ${ch.n_events} linked failures followed. Treat a repeat trip as a possible continuation of that chain, not a new event.`, [weid, ceid]));
            }
          }
          S.push(hs);
        }
      }
      notv.push("Current process values (no live historian / DCS connection in this pilot)",
        "Status of each start permissive signal in the field",
        "That the cause of THIS trip has been found and cleared (interlock is latched)",
        "Active permits and isolations");
      return null;
    }

    aProcedure(q, tag, E, S) {
      const oplNo = this.bestOpl(tag, q);
      if (!oplNo) return "no_procedure";
      S.push(this.stepsSection(E, oplNo, `${this.opl.get(oplNo).title} (verbatim)`));
      S.push(this.safetySection(E, oplNo));
      const others = this.R.search(q, tag, ["OPL_STEPS"], 3).map((h) => h.ref.opl_no).filter((o) => o !== oplNo);
      if (others.length) {
        const rel = section("related", "Related procedures");
        for (const o of others.slice(0, 2)) rel.items.push(item(`${o} — ${this.opl.get(o).title}`, [this.evOpl(E, o, "title")]));
        S.push(rel);
      }
      return null;
    }

    aParameter(q, tag, E, S) {
      let found = false;
      const il = this.il.get(tag);
      const named = new Set(findTags(q));
      const ilNamed = !!il && il.causes.some((c) => named.has(c.tag));
      if (il && (ilNamed || /trip|alarm|set ?point|setting|set pressure|interlock/i.test(q))) {
        let rows = [];
        for (const [pat, prefix] of INITIATOR_HINTS) if (search(pat, q)) rows = rows.concat(il.causes.filter((c) => c.tag.startsWith(prefix)));
        for (const t of findTags(q)) rows = rows.concat(il.causes.filter((c) => c.tag === t));
        if (rows.length) {
          const sec = section("parameter", `Set points — ${il.doc_number} Rev ${il.revision}`);
          const uniq = new Map(); for (const c of rows) uniq.set(c.id, c);
          for (const c of uniq.values()) {
            sec.items.push(item(`${c.id} · ${c.initiator} · ${c.tag} · ${sp(c)} · vote ${c.vote}`, [this.evIl(E, tag, `C&E row ${c.id}`)], { verbatim: true }));
            this.alsoStated(E, sec, tag, c.tag);
          }
          const dummy = il.notes.find((n) => n.toLowerCase().includes("dummy")) || "";
          if (dummy) sec.items.push(item(`Document caveat: ${dummy}`, [this.evIl(E, tag, "NOTES", dummy)], { verbatim: true }));
          S.push(sec); found = true;
        }
      }
      if (!found) {
        const fields = this.matchFields(q, tag);
        if (fields.length) {
          const ds = this.ds.get(tag);
          const sec = section("parameter", `Design data — ${ds.doc_number} Rev ${ds.revision}`);
          for (const f of fields.slice(0, 2)) sec.items.push(item(`${f}: ${ds.params[f]}`, [this.evDs(E, tag, f)], { verbatim: true }));
          S.push(sec); found = true;
        }
      }
      return found ? null : "no_parameter";
    }
    matchFields(q, tag) {
      const ds = this.ds.get(tag);
      if (!ds) return [];
      const excl = new Set(["ga-1201a", "ea-5601", "pump", "hexane", "heater", "solvent", "feed"]);
      const toks = (q.toLowerCase().match(/[a-z0-9/]+/g) || []).filter((t) => t.length >= 3 && !GENERIC.has(t) && !tag.toLowerCase().includes(t) && !excl.has(t));
      if (!toks.length) return [];
      const scored = [];
      for (const f of Object.keys(ds.params)) {
        const ftxt = f.toLowerCase();
        let s = 0;
        for (const t of toks) { const alts = FIELD_SYNONYMS[t] || [t]; if (alts.some((a) => ftxt.includes(a))) s += 1; }
        if (s) {
          s += 0.5 * ["design", "rated"].filter((g) => q.toLowerCase().includes(g) && ftxt.includes(g)).length;
          scored.push([s, f]);
        }
      }
      if (!scored.length) return [];
      const best = Math.max(...scored.map(([s]) => s));
      // Python: sorted(scored, reverse=True) -> score desc, then field name desc
      scored.sort((a, b) => (b[0] - a[0]) || (b[1] < a[1] ? -1 : b[1] > a[1] ? 1 : 0));
      return scored.filter(([s]) => s === best).map(([, f]) => f);
    }
    alsoStated(E, sec, tag, inst) {
      for (const o of this.opl.values()) {
        if (o.asset_tag !== tag) continue;
        for (const s of o.steps) if (s.action.includes(inst) && /\d/.test(s.action)) {
          sec.items.push(item(`   also stated in ${o.opl_no} step ${s.n}: ${s.action}`, [this.evOpl(E, o.opl_no, `step ${s.n}`)]));
        }
      }
    }

    aSymptom(q, tag, E, S, notv) {
      const hits = this.R.search(q, tag, ["OPL_TROUBLE", "WO"], 8);
      if (!hits.length) return "no_symptom";
      const seen = new Set(), rows = [];
      for (const h of hits) {
        if (h.kind !== "OPL_TROUBLE") continue;
        const o = this.opl.get(h.ref.opl_no), r = o.troubleshooting[h.ref.row];
        const key = ws(r.symptom).toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key); rows.push([o, r]);
      }
      if (!rows.length) return "no_symptom";
      const [o, r] = rows[0];
      const copies = [...this.opl.values()].filter((x) => x.asset_tag === tag && x.troubleshooting.some((t) => ws(t.symptom).toLowerCase() === ws(r.symptom).toLowerCase())).map((x) => x.opl_no);
      const ranked = this.R.search(`${r.symptom} ${r.cause}`, tag, ["OPL_STEPS"], 20).map((h) => h.ref.opl_no);
      const home = ranked.find((x) => copies.includes(x)) || o.opl_no;
      const checkOpl = this.bestOpl(tag, `${r.symptom} ${r.cause}`) || home;
      const eid = this.evOpl(E, home, "5. COMMON PROBLEMS & TROUBLESHOOTING");
      const sec = section("troubleshooting", "Recorded case matching your description (verbatim)", [
        item(`Symptom: ${r.symptom}`, [eid], { verbatim: true }),
        item(`Likely cause: ${r.cause}`, [eid], { verbatim: true }),
        item(`Action taken: ${r.action}`, [eid], { verbatim: true }),
      ], `row appears in ${copies.length} OPL(s); cited from ${home}`);
      const stem = ws(r.symptom).toLowerCase().replace(/[. ]+$/, "");
      const pre = stem.slice(0, Math.max(20, stem.length - 3));
      const wo = this.recs.find((x) => x.tag === tag && ws(x.problem).toLowerCase().startsWith(pre)) || null;
      if (wo) {
        const weid = this.evWo(E, wo.wo);
        const full = ws(wo.problem) !== ws(r.symptom);
        sec.items.push(item(`Source work order: ${wo.wo} (${wo.date.slice(0, 10)})` + (full ? ` — full record: ${wo.problem}. Root cause: ${wo.root_cause}.` : "."), [weid]));
      }
      S.push(sec);
      if (wo) {
        const ch = this.chainOf(wo.wo);
        if (ch) { S.push(this.composeChain(E, ch)); const les = this.composeLesson(E, ch); if (les) S.push(les); }
      }
      S.push(this.stepsSection(E, checkOpl, `Approved check — ${this.opl.get(checkOpl).title} (verbatim)`));
      notv.push("Whether the current condition matches the recorded case", "Current process values (no live historian / DCS connection in this pilot)");
      return null;
    }

    aDeviation(q, tag, E, S) {
      const named = new Set(findTags(q));
      const sec = section("refusal", "Deviation from an approved safeguard — CASCADE will not advise a workaround");
      const cands = [];
      for (const o of this.opl.values()) {
        if (o.asset_tag !== tag) continue;
        const stepsJson = JSON.stringify(o.steps);
        const aboutNamed = [...named].some((t) => o.title.includes(t) || stepsJson.includes(t));
        for (const s of o.steps) if (GUARD_TEXT.test(s.action)) cands.push([aboutNamed ? 0 : 1, o.opl_no, `step ${s.n}`, s.action]);
        for (const s of o.safety) if (/defeat|override/i.test(s)) cands.push([2, o.opl_no, "2. SAFETY PRECAUTIONS", s]);
        if (search(PROHIBITED_OPERATION, q)) for (const s of o.key_learning) if (/never run the pump against/i.test(s)) cands.push([-1, o.opl_no, "6. KEY LEARNING POINTS", s]);
      }
      const cmp = (a, b) => { for (let i = 0; i < 4; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; };
      cands.sort(cmp);
      const seen = new Set();
      for (const [, oplNo, loc, text] of cands) {
        if (seen.has(ws(text)) || sec.items.length >= 3) continue;
        seen.add(ws(text));
        sec.items.push(item(text, [this.evOpl(E, oplNo, loc)], { verbatim: true }));
      }
      S.push(sec);
      const il = this.il.get(tag);
      if (il && (search(SETPOINT_CHANGE, q) || /set ?point|setting|jadi \d|to \d/i.test(q))) {
        const rows = il.causes.filter((c) => named.has(c.tag));
        if (rows.length) {
          S.push(section("parameter", "Approved set point — changing it requires Management of Change",
            rows.map((c) => item(`${c.id} · ${c.initiator} · ${c.tag} · ${sp(c)} · vote ${c.vote}`, [this.evIl(E, tag, `C&E row ${c.id}`)], { verbatim: true }))));
        }
      }
      return null;
    }

    aJudgement(q, tag, E, S, notv) {
      const il = this.il.get(tag);
      const cause = il ? this.findCause(il, q) : null;
      if (!cause) return "no_limit";
      const sec = section("parameter", `Approved limits for ${cause.tag} — compare with your live reading`);
      sec.items.push(item(`${cause.id} · ${cause.initiator} · ${cause.tag} · ${sp(cause)} · vote ${cause.vote}`, [this.evIl(E, tag, `C&E row ${cause.id}`)], { verbatim: true }));
      this.alsoStated(E, sec, tag, cause.tag);
      S.push(sec);
      const prefer = INITIATOR_OPL[cause.tag.split("-")[0]] || "";
      const oplNo = this.bestOpl(tag, q, prefer);
      if (oplNo) S.push(this.stepsSection(E, oplNo, "Approved response procedure (verbatim)"));
      notv.push("Whether the current condition is safe — CASCADE never makes that judgement",
        "Your reading's trend and rate of change (no live historian / DCS connection in this pilot)");
      return null;
    }

    // ---------------------------------------------------- verify
    verify(E, S) {
      const emap = new Map(E.map((e) => [e.eid, e]));
      let vT = 0, vP = 0, gT = 0, gP = 0;
      const removed = [];
      for (const sec of S) {
        const keep = [];
        for (const it of sec.items) {
          if (!it.evidence.length) { keep.push(it); continue; }
          if (it.verbatim) {
            vT++;
            const [q, cell] = this.sourceCell(it, emap);
            const page = this.page_text[emap.get(it.evidence[0]).doc] || "";
            const res = checkVerbatim(q, cell, page);
            if (res.passed) { vP++; keep.push(it); } else removed.push({ text: it.text, why: "verbatim mismatch", ...res });
          } else {
            gT++;
            const res = checkGrounding(it.text, it.evidence.filter((e) => emap.has(e)).map((e) => emap.get(e).ground_text), it.derived);
            if (res.passed) { gP++; keep.push(it); } else removed.push({ text: it.text, why: "unsupported facts", unsupported: res.unsupported });
          }
        }
        sec.items = keep;
      }
      return { verbatim: { checked: vT, passed: vP }, grounding: { checked: gT, passed: gP }, removed };
    }
    sourceCell(it, emap) {
      const text = it.text;
      const m = text.match(/^(\d+)\. (.*)$/);
      if (m) {
        const core = m[2];
        const e = emap.get(it.evidence[0]);
        if (e.kind === "OPL") {
          const o = this.opl.get(e.doc);
          const step = o.steps.find((s) => s.n === parseInt(m[1], 10));
          if (step && ws(step.action) === ws(core)) return [core, step.action];
        }
        if (e.kind === "INTERLOCK") {
          const il = [...this.il.values()].find((x) => x.doc_number === e.doc);
          const p = il.permissives.find((pp) => pp.n === parseInt(m[1], 10));
          if (p) {
            const shown = `${p.condition} — ${p.signal}`;
            return ws(shown) === ws(core) ? [p.condition + " " + p.signal, p.condition + " " + p.signal] : [core, ""];
          }
        }
      }
      const e = emap.get(it.evidence[0]);
      for (const prefix of ["Symptom: ", "Likely cause: ", "Action taken: ", "Document caveat: "]) {
        if (text.startsWith(prefix)) {
          const core = text.slice(prefix.length);
          return [core, ws(e.ground_text).toLowerCase().includes(ws(core).toLowerCase()) ? core : ""];
        }
      }
      if (e.kind === "INTERLOCK") {
        const core = text.replace(/^\s*→\s*EFF-\d+:\s*/, "");
        const cells = core.split(/\s·\s|\s→\s/).filter((c) => c.trim()).map((c) => c.trim().replace(/^(set point|vote)\s+/, ""));
        const joined = cells.join(" ");
        const ok = cells.every((c) => ws(e.ground_text).toLowerCase().includes(ws(c).toLowerCase()));
        return [joined, ok ? joined : ""];
      }
      if (e.kind === "DATASHEET") {
        const i = text.indexOf(": ");
        const v = i >= 0 ? text.slice(i + 2) : "";
        return [v, e.quote];
      }
      return [text, ws(e.ground_text).toLowerCase().includes(ws(text).toLowerCase()) ? text : ""];
    }

    // ---------------------------------------------------- confidence
    confidence(E, ver, assetMatch, intent) {
      const auth = { OPL: 1.0, INTERLOCK: 1.0, DATASHEET: 1.0, WORK_ORDER: 0.7, CHAIN: 0.6 };
      let a = 0;
      if (E.length) { let s = 0; for (const e of E) s += auth[e.kind]; a = s / E.length; }
      const claims = ver.verbatim.checked + ver.grounding.checked;
      const ok = ver.verbatim.passed + ver.grounding.passed;
      const cov = claims ? ok / claims : 0;
      const kinds = [...new Set(E.map((e) => e.kind))].sort();
      const corr = Math.min(kinds.length / 3, 1.0);
      const needMap = { TRIP_RESTART: ["INTERLOCK", "OPL"], RECURRING: ["CHAIN", "WORK_ORDER", "OPL"], PROCEDURE: ["OPL"],
        PARAMETER: ["DATASHEET", "INTERLOCK"], SYMPTOM: ["OPL", "WORK_ORDER"], DEVIATION: ["OPL"] };
      const need = (needMap[intent] || []).slice().sort();
      const inter = kinds.filter((k) => need.includes(k)).length;
      const fit = intent === "PARAMETER" ? (inter ? 1.0 : 0.0) : (need.length ? inter / need.length : 0.5);
      const factors = [
        { name: "Source authority", weight: 0.30, value: pyRound(a, 2), note: "controlled documents 1.0 · work orders 0.7 · derived chains 0.6" },
        { name: "Asset match", weight: 0.25, value: assetMatch, note: "1.0 tag named · 0.9 via instrument tag · <0.9 via description" },
        { name: "Evidence coverage", weight: 0.25, value: pyRound(cov, 2), note: "claims passing verbatim/grounding gates" },
        { name: "Corroboration", weight: 0.10, value: pyRound(corr, 2), note: `independent source types: ${kinds.join(", ") || "-"}` },
        { name: "Intent coverage", weight: 0.10, value: pyRound(fit, 2), note: `evidence types this question needs: ${need.join(", ") || "-"}` },
      ];
      let sum = 0; for (const f of factors) sum += f.weight * f.value;
      let score = pyRound(100 * sum, 0);
      const caps = [];
      if (["TRIP_RESTART", "SYMPTOM", "JUDGEMENT"].includes(intent) && score > 75) { caps.push("Capped at 75: no live process data in this pilot (read-only historian not connected)"); score = 75; }
      if (ver.removed.length) { caps.push(`${ver.removed.length} statement(s) removed by verification`); score = Math.min(score, 70); }
      if (assetMatch < 0.8) { caps.push("Asset inferred from a generic description — confirm the tag"); score = Math.min(score, 65); }
      if (intent === "GENERAL") { caps.push("No direct answer: closest sources only, no recommendation"); score = Math.min(score, 55); }
      const band = score >= 80 ? "High" : score >= 60 ? "Medium" : "Low";
      return { score, band, factors, caps };
    }

    // ---------------------------------------------------- ask
    ask(q) {
      const t0 = Date.now();
      const [tag, amatch, how] = this.resolveAsset(q);
      const intent = this.classify(q);
      const safety = this.safetyFlags(q, intent);
      const E = [], S = [], notv = [];
      const base = { query: q, intent, safety_critical: safety.length > 0, safety_flags: safety, asset_resolution: how };
      if (tag === null) {
        return { ...base, status: "needs_clarification", asset: null, headline: "Which equipment? Name the tag (e.g. GA-1201A) or the unit.",
          sections: [], evidence: [], latency_ms: Date.now() - t0, indexed_assets: PILOT.map((t) => this.assets.get(t)) };
      }
      const asset = this.assets.get(tag) || { tag };
      if (!PILOT.includes(tag)) {
        const n = this.recs.filter((r) => r.tag === tag).length;
        return { ...base, status: "abstained", asset, headline: `${tag} is outside the pilot scope — no approved documents indexed for it.`,
          reason: `Pilot covers ${PILOT.join(", ")}. ${n} work orders exist for ${tag} and become answerable when its document set is ingested.`,
          sections: [], evidence: [], latency_ms: Date.now() - t0 };
      }
      const handlers = {
        RECURRING: () => this.aRecurring(q, tag, E, S), TRIP_RESTART: () => this.aTrip(q, tag, E, S, notv),
        PROCEDURE: () => this.aProcedure(q, tag, E, S), PARAMETER: () => this.aParameter(q, tag, E, S),
        SYMPTOM: () => this.aSymptom(q, tag, E, S, notv), DEVIATION: () => this.aDeviation(q, tag, E, S),
        JUDGEMENT: () => this.aJudgement(q, tag, E, S, notv) };
      const miss = handlers[intent] ? handlers[intent]() : "general";
      const retrievalTop = this.R.search(q, tag, null, 5);
      let status;
      if (miss) {
        const stop = new Set(["what", "which", "does", "have", "about", "there", "with", "that", "this", "from", "when", "kenapa",
          "apakah", "bagaimana", "yesterday", "today", "please", "team", "would", "could", "should", "their", "they", "your"]);
        const content = (q.toLowerCase().match(/[a-z]{4,}/g) || []).filter((t) => !stop.has(t) && !tag.toLowerCase().includes(t));
        const share = (h) => (content.length ? content.filter((c) => h.text.toLowerCase().includes(c)).length / content.length : 0);
        const relevant = retrievalTop.filter((h) => h.bm25 > 2.0 && share(h) >= 0.6);
        if (!relevant.length) {
          return { ...base, status: "abstained", asset, headline: "No approved source answers this. CASCADE will not guess.",
            reason: `no evidence above threshold for intent ${intent}`,
            escalation: safety.length ? { role: "Shift supervisor", why: `safety-critical question without an approved source: ${safety.join(", ")}` }
              : { role: "Process / reliability engineer for the unit", why: "question outside indexed knowledge" },
            sections: [], evidence: [], latency_ms: Date.now() - t0 };
        }
        const sec = section("sources", "Closest sources (no recommendation made)");
        for (const h of relevant.slice(0, 3)) {
          let eid;
          if (h.kind === "WO") eid = this.evWo(E, h.ref.wo);
          else if (h.kind.startsWith("OPL")) eid = this.evOpl(E, h.ref.opl_no, h.anchor.section ?? "");
          else if (h.kind === "DS_PARAM") eid = this.evDs(E, tag, h.ref.field);
          else if (h.kind === "CHAIN") eid = this.evChain(E, this.chains.find((c) => c.chain_id === h.ref.chain_id));
          else eid = this.evIl(E, tag, h.anchor.row ?? "");
          sec.items.push(item(ws(h.text).slice(0, 220), [eid]));
        }
        S.push(sec);
        status = "sources_only";
      } else {
        status = intent === "DEVIATION" ? "refused_deviation" : "answered";
      }
      if (notv.length) S.push(this.notVerified(notv));
      const ver = this.verify(E, S);
      const conf = this.confidence(E, ver, amatch, intent);
      if (safety.length && ver.removed.length) status = "abstained";
      if (safety.length && conf.band === "Low") status = "abstained";
      let escalation = null;
      if (intent === "DEVIATION") escalation = { role: "Shift supervisor + process engineer; MOC / authorised override permit",
        why: "any defeat of an interlock, change to a protective set point, or removal of a protective device requires Management of Change or an approved override permit" };
      else if (intent === "JUDGEMENT") escalation = { role: "Shift supervisor decides; reliability engineer for trend assessment", why: "a live-condition safety judgement is never made by CASCADE" };
      else if (status === "abstained" && safety.length) escalation = { role: "Shift supervisor", why: `safety-critical question without an approved source: ${safety.join(", ")}` };
      else if (safety.length) escalation = { role: "Shift supervisor (acknowledgement before acting)", why: `safety-critical: ${safety.join(", ")}` };
      if (intent === "TRIP_RESTART" && /vibrat|vshh|getaran/i.test(q)) escalation.role += "; reliability engineer if the 1x running-speed component dominates (OPL-GA-1201A-07 step 5)";
      const headline = this.headline(intent, tag, S, status);
      const used = new Set(); for (const s of S) for (const it of s.items) for (const e of it.evidence) used.add(e);
      return { ...base, status, asset, headline,
        sections: S.filter((s) => s.items.length).map((s) => ({ kind: s.kind, title: s.title, note: s.note,
          items: s.items.map((it) => ({ text: it.text, evidence: it.evidence, verbatim: it.verbatim, check: it.verbatim && it.check ? it.check : "", derived: it.derived })) })),
        evidence: E.filter((e) => used.has(e.eid)).map((e) => ({ eid: e.eid, kind: e.kind, label: e.label, doc: e.doc, locator: e.locator, meta: e.meta, quote: e.quote, source_path: e.source_path || "" })),
        confidence: conf, verification: ver, escalation,
        retrieval: { mode: this.R.mode, top: retrievalTop.map((h) => ({ pid: h.pid, kind: h.kind, score: h.score })) },
        latency_ms: Date.now() - t0 };
    }
    headline(intent, tag, S, status) {
      if (status === "abstained") return "Withheld: a safety-critical statement failed verification. Escalate.";
      if (status === "sources_only") return `No direct answer for ${tag}; closest approved sources listed, no recommendation made.`;
      const chains = S.filter((s) => s.kind === "chain");
      if (intent === "RECURRING" && !chains.length && S.some((s) => s.kind === "history")) return S.find((s) => s.kind === "history").title + "; the recorded occurrences are listed.";
      if (intent === "RECURRING" && chains.length) { const t = chains[0].title; return `${tag} has ${chains.length} open failure chain(s); the largest is ${t.slice(t.indexOf(": ") + 2)}.`; }
      if (intent === "TRIP_RESTART") return `Do not restart ${tag} until the trip cause is cleared and every start permissive is true. Steps below are verbatim from approved documents.`;
      if (intent === "SYMPTOM") return `This matches a recorded case on ${tag}` + (chains.length ? " that belongs to a recurring failure chain." : ".");
      if (intent === "PROCEDURE") { const st = S.find((s) => s.kind === "steps"); return `Approved procedure for ${tag}: ${st ? st.title : ""}`; }
      if (intent === "PARAMETER") return `Values below are quoted from the controlled documents for ${tag}.`;
      if (intent === "DEVIATION") {
        if (S.some((s) => s.kind === "parameter")) return "Refused: changing a protective set point requires Management of Change. The approved value is shown unchanged; escalation below.";
        return "Refused: CASCADE never advises defeating, bypassing or removing a safeguard. Escalation below.";
      }
      if (intent === "JUDGEMENT") return "CASCADE does not judge whether a live condition is safe. Approved limits and the response procedure are below; the shift supervisor decides.";
      return tag;
    }
  }

  const api = { Engine, Retriever, pyRound, checkVerbatim, checkGrounding };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.CascadeEngine = api;
})(typeof window !== "undefined" ? window : globalThis);
