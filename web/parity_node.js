// Node side of the parity test: run web/engine.js over the same questions.
const fs = require("fs");
const path = require("path");
const { Engine } = require("./engine.js");

const bundle = JSON.parse(fs.readFileSync(path.join(__dirname, "bundle.json"), "utf8"));
const qs = JSON.parse(fs.readFileSync(path.join(__dirname, "parity_questions.json"), "utf8"));
const cases = JSON.parse(fs.readFileSync(path.join(__dirname, "_ret_cases.json"), "utf8"));

const t0 = Date.now();
const eng = new Engine(bundle);
const boot = Date.now() - t0;
const answers = {};
const t1 = Date.now();
for (const q of qs) answers[q] = eng.ask(q);
const perQ = (Date.now() - t1) / qs.length;
const retrieval = cases.map((c) => eng.R.search(c.q, c.tag, c.kinds, 8).map((h) => h.pid));
fs.writeFileSync(path.join(__dirname, "_js_out.json"), JSON.stringify({ answers, retrieval }));
console.error(`js engine boot ${boot} ms, ${perQ.toFixed(1)} ms/question`);
