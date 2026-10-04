"use strict";
// Plant-data chat: parity with the engine, session memory, abstention, safety wording.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { Engine } = require("./engine.js");

const HTML = fs.readFileSync(path.join(__dirname, "dist", "cascade.html"), "utf8");
const BUNDLE = JSON.parse(fs.readFileSync(path.join(__dirname, "bundle.json"), "utf8"));
const ENGINE = new Engine(BUNDLE);
const DEMO = [
  "GA-1201A tripped on high vibration, can I restart?",
  "why does the hexane pump keep failing?",
  "kenapa pompa hexane bocor?",
  "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?",
  "EA-5601 tripped, can I restart it?",
  "is it safe to keep running GA-1201A at 5 mm/s vibration?",
  "what is the warranty period of GA-1201A?",
];
const sorted = (v) => Array.isArray(v) ? v.map(sorted)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
const fingerprint = (a) => crypto.createHash("sha256").update(JSON.stringify(sorted({
  query: a.query ?? null, status: a.status ?? null, intent: a.intent ?? null, asset: a.asset ?? null,
  headline: a.headline ?? null, sections: a.sections || [],
}))).digest("hex");
const waitFor = async (fn, timeout = 6000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error("timed out waiting for chat state");
};

async function load(width) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(e));
  const dom = new JSDOM(HTML, {
    url: "file:///cascade.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(w) {
      w.scrollTo = () => {};
      Object.defineProperty(w, "innerWidth", { configurable: true, value: width, writable: true });
      Object.defineProperty(w, "crypto", { value: crypto.webcrypto });
      w.fetch = () => { throw new Error("chat must not use the network"); };
    },
  });
  await waitFor(() => dom.window.document.getElementById("askbtn")?.disabled === false);
  return { dom, errors };
}

async function send(dom, text) {
  const d = dom.window.document, input = d.getElementById("chatInput");
  const before = d.querySelectorAll("#chatThread .botcard").length;
  input.value = text;
  input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  const card = await waitFor(() => d.querySelectorAll("#chatThread .botcard")[before]);
  await waitFor(() => card.dataset.fingerprint);
  return card;
}

(async () => {
  for (const width of [1280, 375]) {
    const { dom, errors } = await load(width);
    const d = dom.window.document;
    d.getElementById("chatBtn").click();
    assert.equal(d.getElementById("chat").hidden, false);
    assert.equal(d.activeElement, d.getElementById("chatInput"), "chat input not focused on open");
    assert.equal(d.getElementById("chat").getAttribute("aria-modal"), String(width <= 760));
    const empty = d.querySelector("#chatThread .chatempty");
    assert.ok(empty, "empty state missing");
    const starters = empty.querySelectorAll(".chip").length;
    assert.ok(starters >= 4 && starters <= 6, "4-6 starter chips expected");

    // 1. the seven demo questions: same fingerprint as asking the engine directly
    for (const q of DEMO) {
      d.getElementById("chatNew").click();
      const card = await send(dom, q);
      assert.equal(card.dataset.query, q, "a demo question was rewritten");
      assert.equal(card.dataset.fingerprint, fingerprint(ENGINE.ask(q)), `fingerprint differs for: ${q}`);
      assert.equal(d.activeElement, d.getElementById("chatInput"), "focus did not return to the input");
      const a = ENGINE.ask(q);
      assert.equal(card.querySelector(".cardanswer").textContent, a.headline, "headline not shown verbatim");
      const chips = [...card.querySelectorAll(".cardev .ev")].map((b) => b.dataset.eid);
      assert.deepEqual(chips, a.evidence.slice(0, 8).map((e) => e.eid), "evidence chips differ from the engine's evidence");
    }

    // 2. follow-up resolves to the remembered asset
    d.getElementById("chatNew").click();
    const first = await send(dom, "why does the hexane pump keep failing?");
    assert.equal(first.dataset.asset, "GA-1201A");
    const follow = await send(dom, "what about its interlock?");
    assert.equal(follow.dataset.query, "what about its interlock? (GA-1201A)");
    assert.equal(follow.dataset.asset, "GA-1201A");
    assert.equal(follow.dataset.fingerprint, fingerprint(ENGINE.ask("what about its interlock? (GA-1201A)")));
    assert.match([...d.querySelectorAll("#chatThread .msg-user")].pop().querySelector(".askedas").textContent, /GA-1201A/);
    const swap = await send(dom, "and for EA-5601?");
    assert.equal(swap.dataset.asset, "EA-5601", "asset switch did not carry the topic");
    // without memory the same follow-up stays ambiguous and uses the engine's clarification
    d.getElementById("chatNew").click();
    const amb = await send(dom, "what about its interlock?");
    assert.equal(amb.dataset.status, "needs_clarification");
    assert.equal(amb.dataset.query, "what about its interlock?");

    // 3. unknown question abstains with nothing invented
    d.getElementById("chatNew").click();
    const unknown = await send(dom, "what is the warranty period of GA-1201A?");
    const ua = ENGINE.ask("what is the warranty period of GA-1201A?");
    assert.equal(unknown.dataset.status, "abstained");
    assert.match(unknown.textContent, /That information is not available in the current records\./);
    assert.equal(unknown.querySelector(".cardanswer").textContent, ua.headline);
    assert.equal(unknown.querySelectorAll(".cardev .ev").length, ua.evidence.length);
    for (const chip of unknown.querySelectorAll(".followups .chip")) {
      const label = chip.textContent;
      if (/\?$/.test(label)) assert.ok(["answered", "sources_only"].includes(ENGINE.ask(label).status), `suggested topic has no answer: ${label}`);
      else assert.match(label, /^Open (CH-|OPL-|TJC-|.+ asset page)/);
    }

    // 4. safety-sensitive question shows the engine's escalation wording unchanged
    d.getElementById("chatNew").click();
    const q = "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?";
    const safe = await send(dom, q);
    const sa = ENGINE.ask(q);
    const banner = safe.querySelector(".chatsafety");
    assert.ok(banner, "escalation banner missing");
    assert.ok(safe.classList.contains("crit"), "safety reply is not in the warning style");
    assert.ok(banner.textContent.includes(sa.escalation.role) && banner.textContent.includes(sa.escalation.why), "escalation text changed");
    assert.equal(safe.firstElementChild, banner, "escalation is not shown first");

    // evidence chip opens the source record inside the card
    const chip = safe.querySelector(".cardev .ev");
    if (chip) { chip.click(); assert.equal(safe.querySelector(".cardsrc").hidden, false); }

    // Shift+Enter does not send; Escape closes and returns focus
    const input = d.getElementById("chatInput");
    const n = d.querySelectorAll("#chatThread .botcard").length;
    input.value = "line one";
    input.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    assert.equal(d.querySelectorAll("#chatThread .botcard").length, n, "Shift+Enter sent the message");
    d.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(d.getElementById("chat").hidden, true);
    assert.equal(errors.length, 0, errors.map(String).join("\n"));
    dom.window.close();
  }
  console.log("Chat checks: PASS — 7/7 demo fingerprints, follow-up memory, asset switch, clarification, abstention, escalation, keyboard (1280 + 375 px)");
})().catch((error) => { console.error(error); process.exitCode = 1; });
