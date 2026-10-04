"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM, VirtualConsole } = require("jsdom");

const HTML = fs.readFileSync(path.join(__dirname, "dist", "cascade.html"), "utf8");
const ASSETS = {
  "GA-1201A": "Hexane Feed Pump",
  "YD-2301": "Polymer Fluid Bed Dryer",
  "DC-3401A": "Catalyst Reduction Reactor",
  "KC-4501": "Recycle Gas Compressor",
  "EA-5601": "Solvent Heater",
  "LV-6701": "Separator Level Control Valve",
  "CT-7801": "Cooling Tower Cell Fan",
  "FA-8901": "Reflux Accumulator Drum",
};

const waitFor = async (fn, timeout = 6000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("timed out waiting for UI state");
};

function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
    return out;
  }
  return value;
}

function fingerprint(answer) {
  const payload = {
    query: answer.query ?? null,
    status: answer.status ?? null,
    intent: answer.intent ?? null,
    asset: answer.asset ?? null,
    headline: answer.headline ?? null,
    sections: answer.sections || [],
  };
  return crypto.createHash("sha256").update(JSON.stringify(sorted(payload))).digest("hex");
}

async function load(url, fetchImpl, width = 1024) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error) => errors.push(error));
  const dom = new JSDOM(HTML, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // jsdom does not implement scrolling.  This stub belongs only to the
      // test harness; production code remains unchanged.
      window.scrollTo = () => {};
      Object.defineProperty(window, "innerWidth", { configurable: true, value: width, writable: true });
      Object.defineProperty(window, "outerWidth", { configurable: true, value: width, writable: true });
      Object.defineProperty(window, "crypto", { value: crypto.webcrypto });
      if (fetchImpl) window.fetch = (...args) => fetchImpl(window, ...args);
      else window.fetch = () => { throw new Error("offline mode must not call fetch"); };
    },
  });
  await waitFor(() => dom.window.document.getElementById("askbtn")?.disabled === false);
  assert.equal(errors.length, 0, errors.map(String).join("\n"));
  return dom;
}

async function mobileResponsiveChecks() {
  const dom = await load("file:///cascade.html", null, 375);
  const { window } = dom;
  const document = window.document;

  const toggle = document.getElementById("menutog");
  toggle.focus();
  toggle.click();
  assert.equal(document.getElementById("navshell").classList.contains("drawer-open"), true);
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  assert.equal(document.getElementById("navscrim").hidden, false);
  assert.equal(document.activeElement, document.getElementById("nav-ask"));
  document.getElementById("navscrim").click();
  assert.equal(document.getElementById("navshell").classList.contains("drawer-open"), false);
  assert.equal(document.activeElement, toggle, "drawer did not return focus to its trigger");

  submit(window, "why does the hexane pump keep failing?");
  const evidence = document.querySelector("#answer button.ev");
  assert.ok(evidence, "mobile answer is missing evidence controls");
  evidence.focus();
  evidence.click();
  const rail = document.getElementById("rail");
  assert.equal(rail.classList.contains("sheet-open"), true);
  assert.equal(document.getElementById("evidenceScrim").hidden, false);
  const railClose = rail.querySelector(".railclose");
  assert.ok(railClose, "evidence sheet is missing its close control");
  railClose.click();
  assert.equal(rail.classList.contains("sheet-open"), false);
  assert.equal(document.activeElement, evidence, "evidence sheet did not return focus to its claim");

  window.location.hash = "#chains";
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  assert.equal(document.querySelector("#view-chains details.chart-table").open, true);
  window.location.hash = "#plant";
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  assert.equal(document.querySelector("#view-plant details.chart-table").open, true);
  assert.match(document.getElementById("plantCallout").textContent, /View 6 failure chains/);

  window.location.hash = "#asset/GA-1201A";
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  assert.equal(document.querySelectorAll("#view-asset .assetmetric").length, 6);
  assert.ok(document.querySelector("#view-asset .assetmetric.critical"), "loss-of-containment metric is not marked critical");
  const pidOpen = [...document.querySelectorAll("#view-asset button")].find((button) => /Open P&ID/.test(button.textContent));
  assert.ok(pidOpen, "asset page is missing the P&ID control");
  pidOpen.focus();
  pidOpen.click();
  assert.equal(document.getElementById("pidmodal").hidden, false);
  assert.ok(document.querySelector("#pidmodal .pidtools"), "P&ID scale controls are missing");
  assert.ok(document.querySelector("#pidmodal img.pidfit"), "mobile P&ID did not start in fit-width mode");
  document.querySelector("#pidmodal .modalh button").click();
  assert.equal(document.activeElement, pidOpen, "P&ID viewer did not return focus to its trigger");

  dom.window.close();
}

function submit(window, query) {
  const input = window.document.getElementById("q");
  input.value = query;
  window.document.getElementById("askform").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true })
  );
}

async function offlineChecks() {
  let calls = 0;
  const dom = await load("file:///cascade.html", () => { calls += 1; throw new Error("network"); });
  const { window } = dom;
  assert.equal(window.document.documentElement.dataset.theme, "light");
  window.document.getElementById("themetog").click();
  assert.equal(window.document.documentElement.dataset.theme, "dark");

  for (const [tag, type] of Object.entries(ASSETS)) {
    window.location.hash = `#asset/${tag}`;
    window.dispatchEvent(new window.HashChangeEvent("hashchange"));
    const image = await waitFor(() => window.document.querySelector("#view-asset .assetphoto img"));
    const caption = window.document.querySelector("#view-asset .photocap")?.textContent;
    assert.equal(image.alt, `Representative image of ${type}`);
    assert.equal(caption, `Representative image — ${type}`);
  }

  window.location.hash = "#ask";
  window.dispatchEvent(new window.HashChangeEvent("hashchange"));
  for (const [query, type] of [
    ["why does the hexane pump keep failing?", "Hexane Feed Pump"],
    ["why does EA-5601 keep failing?", "Solvent Heater"],
  ]) {
    submit(window, query);
    const image = window.document.querySelector("#answer .relasset img");
    const caption = window.document.querySelector("#answer .relasset .photocap")?.textContent;
    assert.equal(image?.alt, `Representative image of ${type}`);
    assert.equal(caption, `Representative image — ${type}`);
  }

  submit(window, "GA-1201A tripped on high vibration, can I restart?");
  assert.match(window.document.getElementById("answer").textContent, /Do not restart GA-1201A/);
  assert.equal(window.document.getElementById("llmTldr").hidden, true);
  assert.equal(calls, 0, "offline/static mode made a network request");
  dom.window.close();
}

async function backendChecks() {
  let calls = 0;
  const fetchImpl = async (window, url, options) => {
    calls += 1;
    assert.equal(url, "/ask");
    assert.equal(options.method, "POST");
    const query = JSON.parse(options.body).query;
    const bundle = JSON.parse(window.document.getElementById("bundle").textContent);
    const answer = new window.CascadeEngine.Engine(bundle).ask(query);
    const item = answer.sections.flatMap((section) => section.items)
      .find((candidate) => candidate.evidence.length);
    answer.summary = {
      status: "accepted", accepted: true,
      selected: [{ claim_id: "C1", text: item.text, evidence: item.evidence, section: "test" }],
      provider: "gemini", model: "test-flash", latency_ms: 12,
    };
    answer.engine_commit = bundle.meta.engine_commit;
    answer.answer_fingerprint = fingerprint(answer);
    return { ok: true, json: async () => answer };
  };
  const dom = await load("http://127.0.0.1:8765/", fetchImpl);
  const { window } = dom;
  submit(window, "GA-1201A tripped on high vibration, can I restart?");
  const panel = await waitFor(() => {
    const node = window.document.getElementById("llmTldr");
    return node && !node.hidden && !node.classList.contains("loading") ? node : null;
  });
  assert.match(panel.textContent, /Verified TL;DR/);
  assert.match(panel.textContent, /gemini · test-flash · 12 ms/);
  assert.ok(panel.querySelector("button.ev"), "TL;DR evidence control is missing");
  assert.equal(calls, 1);
  dom.window.close();
}

async function failureChecks() {
  const dom = await load("http://localhost:8765/", async () => { throw new Error("offline"); });
  submit(dom.window, "why does the hexane pump keep failing?");
  const panel = await waitFor(() => {
    const node = dom.window.document.getElementById("llmTldr");
    return node?.classList.contains("unavailable") ? node : null;
  });
  assert.match(panel.textContent, /full deterministic answer below is unchanged/i);
  assert.match(dom.window.document.getElementById("answer").textContent, /open failure chain/i);
  dom.window.close();
}

(async () => {
  await offlineChecks();
  await mobileResponsiveChecks();
  await backendChecks();
  await failureChecks();
  console.log("UI structural checks: PASS — offline, backend, fallback, theme, 8/8 asset photos, 2/2 related assets");
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
