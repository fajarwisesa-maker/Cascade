"use strict";
// Clarifying questions, reviewed topic rewrites, "not available" wording and English-only UI.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { Engine } = require("./engine.js");

const HTML = fs.readFileSync(path.join(__dirname, "dist", "cascade.html"), "utf8");
const ENGINE = new Engine(JSON.parse(fs.readFileSync(path.join(__dirname, "bundle.json"), "utf8")));
const INDONESIAN = /\b(kenapa|pompa|bocor|turunkan|jadi|biar|tidak|bunyi|terus|yang|dengan|untuk|prosedur|bagaimana)\b/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (fn, timeout = 6000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = fn(); if (v) return v; await sleep(15); }
  throw new Error("timed out");
};

(async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e));
  const dom = new JSDOM(HTML, {
    url: "file:///cascade.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) { w.scrollTo = () => {}; Object.defineProperty(w, "crypto", { value: crypto.webcrypto }); w.fetch = () => { throw new Error("offline"); }; },
  });
  const d = dom.window.document;
  await waitFor(() => d.getElementById("askbtn").disabled === false);
  const ask = (q) => { d.getElementById("q").value = q; d.getElementById("askform").dispatchEvent(new dom.window.Event("submit", { cancelable: true })); };
  const text = (sel) => (d.querySelector(sel) || {}).textContent || "";

  // English-only UI: no Indonesian in example chips, starters, chain prompts or the demo run
  const visible = () => { const b = d.body.cloneNode(true); b.querySelectorAll("script").forEach((s) => s.remove()); return b.textContent; };
  d.getElementById("chatBtn").click();
  d.getElementById("chatClose").click();
  d.getElementById("liveRun").click();
  assert.doesNotMatch(visible(), INDONESIAN, "Indonesian text is shown in the UI");

  // Indonesian input is still understood and answered in English
  ask("kenapa pompa hexane bocor?");
  assert.equal(text("#answer .headline"), ENGINE.ask("kenapa pompa hexane bocor?").headline);
  assert.doesNotMatch(text("#answer .lead"), INDONESIAN);

  // 1. bare equipment word -> clarifying question, no answer shown
  for (const q of ["pump", "GA-1201A", "heater"]) {
    ask(q);
    assert.ok(d.querySelector("#answer .clarifycard"), `no clarifying question for "${q}"`);
    assert.equal(d.querySelector("#answer .headline"), null, `an answer was shown for "${q}"`);
    const opts = [...d.querySelectorAll("#answer .clarifyopts .chip[data-q]")].map((b) => b.dataset.q);
    assert.ok(opts.length >= 2, `too few options for "${q}"`);
    for (const o of opts) assert.equal(ENGINE.ask(o).status, "answered", `option not answerable: ${o}`);
  }
  // picking an option runs the full answer
  const pick = d.querySelector("#answer .clarifyopts .chip[data-q]");
  const picked = pick.dataset.q;
  pick.click();
  assert.equal(text("#answer .headline"), ENGINE.ask(picked).headline);

  // 2. partial match -> clarifying question with the closest sources one click away
  ask("seal problems on GA-1201A");
  assert.ok(d.querySelector("#answer .clarifycard"), "no clarifying question for a partial match");
  const multi = [...d.querySelectorAll("#answer .clarifyopts .chip[data-q]")].map((b) => b.dataset.q);
  assert.deepEqual(multi, ["why does GA-1201A keep failing?", "what mechanical seal does GA-1201A use?"]);
  ask("tell me about the pump seal");
  const partial = d.querySelector("#answer .clarifycard");
  if (partial && [...partial.querySelectorAll("button")].some((b) => /closest sources/.test(b.textContent))) {
    [...partial.querySelectorAll("button")].find((b) => /closest sources/.test(b.textContent)).click();
    assert.ok(d.querySelector("#answer .headline"));
  }

  // 3. reviewed rewrites: shown as "Asked as", only when the engine's answer is on topic
  const REWRITES = {
    "tell me about the pump seal": "what mechanical seal does GA-1201A use?",
    "start conditions for GA-1201A": "GA-1201A tripped, can I restart it?",
    "GA-1201A bearing lubricant": "what oil goes in the GA-1201A bearing housing?",
    "shaft alignment GA-1201A": "steps to do laser alignment on GA-1201A",
    "hydrojet the heater": "hydrojetting procedure for EA-5601",
    "GA-1201A permissives": "GA-1201A tripped, can I restart it?",
    "tell me about failures on the solvent heater tubes": "why does EA-5601 keep failing?",
  };
  for (const [q, expected] of Object.entries(REWRITES)) {
    ask(q);
    assert.equal(text("#answer .headline"), ENGINE.ask(expected).headline, `wrong answer for "${q}"`);
    assert.match(text("#answer .ansq .askedas"), new RegExp(expected.replace(/[?.]/g, "\\$&")), `"Asked as" missing for "${q}"`);
  }
  // safety-flagged questions are never rewritten or clarified: the engine's banner stays
  ask("PSV on EA-5601");
  const psv = ENGINE.ask("PSV on EA-5601");
  assert.ok(psv.safety_critical || psv.escalation);
  assert.equal(text("#answer .headline"), psv.headline);
  assert.equal(text("#answer .ansq .askedas"), "");
  assert.ok(d.querySelector("#answer .safety"), "safety banner missing");
  // a topic that the engine answers off-topic for this asset is never used
  ask("hydrojet GA-1201A");
  assert.doesNotMatch(text("#answer"), /Start-Up & Priming/, "off-topic procedure offered as a hydrojetting answer");

  // 4. answered, refused and demo questions are never rewritten or clarified
  for (const q of ["GA-1201A tripped on high vibration, can I restart?", "what is the warranty period of GA-1201A?",
    "disable interlock SEQ-1201", "I have an MOC permit, how do I bypass SEQ-1201?", "how to align GA-1201A"]) {
    ask(q);
    const a = ENGINE.ask(q);
    assert.equal(text("#answer .headline"), a.headline, `changed: ${q}`);
    assert.equal(text("#answer .ansq .askedas"), "", `rewritten: ${q}`);
    if (a.status === "refused_deviation") assert.ok(text("#answer .safety").includes(a.escalation.role), "escalation missing");
  }

  // 5. missing data: plain "not available" + engine-checked related topics
  ask("what is the warranty period of GA-1201A?");
  assert.match(text("#answer .lead"), /not available in the current records/);
  const near = [...d.querySelectorAll("#answer .nextsteps .chip")].map((b) => b.textContent);
  assert.ok(near.length >= 1, "no related topics suggested");
  for (const q of near) assert.equal(ENGINE.ask(q).status, "answered");
  ask("what is the design pressure of FA-8901?");
  const far = [...d.querySelectorAll("#answer .nextsteps .chip")].map((b) => b.textContent);
  assert.ok(far.some((q) => /GA-1201A|EA-5601/.test(q)), "pilot assets not suggested for an out-of-scope asset");

  // 6. chat uses the same layer
  d.getElementById("chatBtn").click();
  const input = d.getElementById("chatInput");
  input.value = "pump";
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const card = await waitFor(() => d.querySelector("#chatThread .botcard"));
  assert.equal(card.dataset.status, "clarify");
  assert.equal(errors.length, 0, errors.map(String).join("\n"));
  console.log("Clarify + English checks: PASS — English-only UI, Indonesian input answered in English, broad/partial clarification, 7 reviewed rewrites, off-topic guard, pass-through, not-available + related topics, chat");
})().catch((error) => { console.error(error); process.exitCode = 1; });
