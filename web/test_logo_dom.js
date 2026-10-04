"use strict";
// DOM half of web/test_logo.py: node test_logo_dom.js <built.html> <present|missing> [mime]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM, VirtualConsole } = require("jsdom");

const [file, mode, mime] = process.argv.slice(2);
const errors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (error) => errors.push(error));
const dom = new JSDOM(fs.readFileSync(file, "utf8"), {
  url: "file:///cascade.html", runScripts: "dangerously", pretendToBeVisual: true, virtualConsole,
  beforeParse(window) { window.scrollTo = () => {}; window.fetch = () => { throw new Error("offline"); }; },
});
const d = dom.window.document;
const side = d.querySelector("#brandMark img.logoimg");
const top = d.querySelector("#mobileMark img.logoimg");
const fav = d.getElementById("favicon").getAttribute("href");
if (mode === "present") {
  const logo = JSON.parse(d.getElementById("logodata").textContent);
  const src = `data:${logo.mime};base64,${logo.b64}`;
  assert.equal(logo.mime, mime);
  assert.ok(side && top, "logo missing from sidebar or phone top bar");
  assert.equal(side.getAttribute("src"), src);
  assert.equal(top.getAttribute("src"), src);
  assert.equal(side.alt, "CASCADE logo");
  assert.equal(top.alt, "CASCADE logo");
  assert.ok(d.getElementById("brandMark").classList.contains("logochip"), "sidebar logo is not in its light/dark-safe chip");
  assert.ok(d.getElementById("mobileMark").classList.contains("logochip"), "top-bar logo is not in its chip");
  assert.equal(d.getElementById("brandName").textContent, "CASCADE", "text wordmark must stay beside the logo");
  assert.equal(fav, src, "favicon does not use the logo");
} else {
  assert.equal(d.getElementById("logodata").textContent, "null");
  assert.equal(side, null);
  assert.equal(top, null);
  assert.equal(d.getElementById("brandName").textContent, "CASCADE", "text wordmark fallback missing");
  assert.ok(d.documentElement.classList.contains("nologo"));
  assert.ok(fav.startsWith("data:image/svg+xml"), "fallback SVG favicon missing");
}
assert.equal(errors.length, 0, errors.map(String).join("\n"));
console.log(`logo DOM ${mode}: PASS`);
