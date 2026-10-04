"use strict";
// Chat lookup router: asset details, list, open chain/document, compare, no tag, unknown tag;
// engine questions still reach the engine with unchanged fingerprints.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");
const { Engine } = require("./engine.js");

const HTML = fs.readFileSync(path.join(__dirname, "dist", "cascade.html"), "utf8");
const BUNDLE = JSON.parse(fs.readFileSync(path.join(__dirname, "bundle.json"), "utf8"));
const ENGINE = new Engine(BUNDLE);
const ASSETS = [...new Set(BUNDLE.records.map((r) => r.tag))].sort();
const sorted = (v) => Array.isArray(v) ? v.map(sorted)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
const fingerprint = (a) => crypto.createHash("sha256").update(JSON.stringify(sorted({
  query: a.query ?? null, status: a.status ?? null, intent: a.intent ?? null, asset: a.asset ?? null,
  headline: a.headline ?? null, sections: a.sections || [] }))).digest("hex");
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
    beforeParse(w) { w.scrollTo = () => {}; Object.defineProperty(w, "innerWidth", { configurable: true, value: 1280, writable: true });
      Object.defineProperty(w, "crypto", { value: crypto.webcrypto }); w.fetch = () => { throw new Error("offline"); }; },
  });
  const w = dom.window, d = w.document;
  await waitFor(() => d.getElementById("askbtn").disabled === false);
  d.getElementById("chatBtn").click();
  const send = async (text) => {
    const n = d.querySelectorAll("#chatThread .botcard").length;
    const input = d.getElementById("chatInput");
    input.value = text;
    input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    return waitFor(() => d.querySelectorAll("#chatThread .botcard")[n]);
  };
  const isLookup = (card, kind) => {
    assert.equal(card.dataset.kind, "lookup", "not a lookup card");
    if (kind) assert.equal(card.dataset.lookup, kind);
    assert.match(card.querySelector(".recordtag").textContent, /Plant record/);
    assert.equal(card.querySelector(".pill.st-answered, .pill.st-abstained, .pill.st-sources_only, .pill.st-refused_deviation"), null, "engine status pill on a lookup");
    assert.equal(card.dataset.fingerprint, undefined, "lookup card has a fingerprint");
  };

  // 1. asset details: every trigger form, with a working "Open full asset page" link
  for (const [q, tag] of [["give me asset detail for EA-5601", "EA-5601"], ["asset details EA-5601", "EA-5601"], ["show EA-5601", "EA-5601"],
    ["tell me about GA-1201A", "GA-1201A"], ["EA-5601 overview", "EA-5601"], ["ea-5601 info", "EA-5601"], ["EA-5601", "EA-5601"], ["give me asset details for KC-4501", "KC-4501"]]) {
    d.getElementById("chatNew").click();
    const card = await send(q);
    isLookup(card, "asset");
    assert.equal(card.dataset.asset, tag, q);
    const labels = [...card.querySelectorAll(".lkfields dt")].map((x) => x.textContent);
    assert.deepEqual(labels.slice(0, 4), ["Equipment", "Criticality", "Area", "Failure chains"]);
    const link = card.querySelector("a.lkopen");
    assert.equal(link.getAttribute("href"), "#asset/" + tag);
    assert.match(d.getElementById("chatCtx").textContent, new RegExp(tag), "asset not remembered");
    if (tag === "KC-4501") assert.match(card.textContent, /No approved documents are indexed/);
    for (const chip of card.querySelectorAll(".followups .chip")) {
      if (/\?$/.test(chip.textContent)) assert.equal(ENGINE.ask(chip.textContent).status, "answered");
    }
    link.click();
    await sleep(30);
    assert.equal(w.location.hash, "#asset/" + tag, "Open full asset page did not navigate");
    assert.ok(d.querySelector("#view-asset h2") && d.querySelector("#view-asset h2").textContent === tag);
    d.getElementById("chatBtn").click();
  }
  // follow-up after an asset card still works through the engine
  d.getElementById("chatNew").click();
  await send("show EA-5601");
  const follow = await send("what about its interlock?");
  assert.equal(follow.dataset.query, "what about its interlock? (EA-5601)");

  // 2. list all assets
  for (const q of ["list assets", "which assets do you have", "show all equipment", "what assets are covered"]) {
    d.getElementById("chatNew").click();
    const card = await send(q);
    isLookup(card, "list");
    assert.deepEqual([...card.querySelectorAll(".lkassets button[data-tag]")].map((b) => b.dataset.tag), ASSETS);
    assert.equal(d.getElementById("chatCtx").hidden, true, "list remembered a tag");
  }
  const details = await (async () => { const c = d.querySelectorAll("#chatThread .botcard"); c[c.length - 1].querySelector('button[data-tag="EA-5601"]').click(); return waitFor(() => d.querySelector('#chatThread .botcard[data-lookup="asset"]')); })();
  assert.equal(details.dataset.asset, "EA-5601");

  // 3. open chain / document
  d.getElementById("chatNew").click();
  let card = await send("open chain CH-EA-5601-03");
  isLookup(card, "open");
  assert.equal(card.querySelectorAll(".lkrecs li").length, 1);
  card.querySelector(".lkrecs button").click();
  await sleep(30);
  assert.equal(w.location.hash, "#chain/CH-EA-5601-03");
  assert.equal(d.getElementById("view-chain").hidden, false, "chain page did not open");
  d.getElementById("chatBtn").click();
  card = await send("show chain for GA-1201A");
  assert.deepEqual([...card.querySelectorAll(".lkrecs .mono")].map((x) => x.textContent), ["CH-GA-1201A-01", "CH-GA-1201A-02"]);
  card = await send("open OPL-GA-1201A-03");
  assert.equal(card.querySelectorAll(".lkrecs li").length, 1);
  card.querySelector(".lkrecs button").click();
  await sleep(30);
  assert.equal(w.location.hash, "#docs");
  assert.match(d.getElementById("docView").textContent, /OPL-GA-1201A-03/);
  d.getElementById("chatBtn").click();
  card = await send("show the interlock for GA-1201A");
  assert.deepEqual([...card.querySelectorAll(".lkrecs .mono")].map((x) => x.textContent), ["TJC-LLD-IL-GA-1201A"]);
  card = await send("show the datasheet for EA-5601");
  assert.deepEqual([...card.querySelectorAll(".lkrecs .mono")].map((x) => x.textContent), ["TJC-LLD-DS-EA-5601"]);
  card = await send("open OPL seal flush");
  assert.equal(card.querySelector(".lkrecs .mono").textContent, "OPL-GA-1201A-01");
  card = await send("open chain CH-XX-9999-01 turbine");
  assert.equal(card.dataset.lookup, "none");
  assert.match(card.textContent, /That is not in the CASCADE data\./);
  assert.equal(card.querySelectorAll(".lkrecs li").length, 3);

  // 4. compare: same labels side by side, no judgement words
  card = await send("compare GA-1201A and EA-5601");
  isLookup(card, "compare");
  assert.equal(card.dataset.assets, "GA-1201A,EA-5601");
  const rows = [...card.querySelectorAll(".cmpwide .cmprow:not(.cmphead)")];
  assert.ok(rows.length >= 8 && rows.every((r) => r.children.length === 3));
  assert.doesNotMatch(card.textContent, /\b(better|worse|best|worst|recommend)\b/i);
  assert.equal(card.querySelectorAll(".cmpstack section").length, 2);
  card = await send("GA-1201A vs EA-5601");
  assert.equal(card.dataset.lookup, "compare");

  // 5. no asset named: always the asset buttons, never the remembered asset
  card = await send("show asset details");
  isLookup(card, "pick");
  assert.equal(card.querySelectorAll(".lkpick button[data-tag]").length, ASSETS.length);

  // 6. unknown asset
  card = await send("asset details XY-9999");
  isLookup(card, "unknown");
  assert.match(card.textContent, /That asset is not in the CASCADE data\./);
  assert.ok(card.querySelectorAll(".lkpick button[data-tag]").length >= 2);
  assert.doesNotMatch(card.textContent, /Equipment|Criticality/, "fields invented for an unknown asset");

  // engine questions still go to the engine with unchanged fingerprints
  for (const q of ["EA-5601 tripped, can I restart it?", "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?",
    "what is the warranty period of GA-1201A?", "why does the hexane pump keep failing?"]) {
    d.getElementById("chatNew").click();
    const c = await send(q);
    assert.notEqual(c.dataset.kind, "lookup", `routed to lookup: ${q}`);
    await waitFor(() => c.dataset.fingerprint);
    assert.equal(c.dataset.fingerprint, fingerprint(ENGINE.ask(q)), `fingerprint changed: ${q}`);
  }
  // instrument tags are not "unknown assets"
  d.getElementById("chatNew").click();
  const inst = await send("what is FV-1201");
  assert.notEqual(inst.dataset.lookup, "unknown");
  assert.equal(errors.length, 0, errors.map(String).join("\n"));
  console.log("Chat lookup checks: PASS — 8 asset-detail forms, list x4, open chain/OPL/interlock/datasheet/title/no-match, compare x2, no-tag, unknown tag, engine pass-through fingerprints");
})().catch((error) => { console.error(error); process.exitCode = 1; });
