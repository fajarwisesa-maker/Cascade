/* CASCADE UI. Everything on screen is computed by the engine or read from the bundle.
   Redesign per design/02..04. The engine script above is byte-frozen and untouched. */
(function () {
  "use strict";
  const B = JSON.parse(document.getElementById("bundle").textContent);
  const $ = (id) => document.getElementById(id);

  /* ------------------------------------------------------------- i18n
     Every user-facing UI string lives in ONE object, web/i18n.json, English first;
     build.py fails if a key used here or in template.html is missing from it.
     Engine output (headlines, sections, evidence labels) and the example questions
     are data sent to or returned by the deterministic engine, so they are not translated. */
  const I18N = JSON.parse(document.getElementById("i18n").textContent);
  let LANG = "en";
  const hasT = (key) => Object.prototype.hasOwnProperty.call(I18N.en, key);
  function T(key, vars) {
    const table = I18N[LANG] || I18N.en;
    let str = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : I18N.en[key];
    if (str === undefined) return key;
    if (vars) str = str.replace(/\{([a-z_]+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m));
    return str;
  }
  const TN = (key, n, vars) => T(key + (n === 1 ? ".one" : ".other"), Object.assign({ n }, vars));
  function applyStaticI18n() {
    document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = T(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-html]").forEach((el) => { el.innerHTML = T(el.dataset.i18nHtml); });
    document.querySelectorAll("[data-i18n-attr]").forEach((el) => {
      for (const pair of el.dataset.i18nAttr.split(",")) { const [attr, key] = pair.split("="); el.setAttribute(attr, T(key)); }
    });
    document.documentElement.lang = LANG;
  }
  const ns = "http://www.w3.org/2000/svg";
  let ENG = null, current = null, selectedEid = null, answered = false;
  let evidenceTrigger = null, navReturnFocus = null, pidReturnFocus = null;
  let askSequence = 0;
  const params = new URLSearchParams(location.search);
  const loopback = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(location.hostname);
  const BACKEND_MODE = /^https?:$/.test(location.protocol) && (loopback || params.get("backend") === "1");

  /* ------------------------------------------------------------ helpers */
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of kids.flat(Infinity)) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  function s(tag, attrs, ...kids) {
    const el = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v !== null && v !== undefined) el.setAttribute(k, v);
    for (const c of kids.flat()) if (c) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
    return el;
  }
  const ws = (t) => (t || "").replace(/\s+/g, " ").trim();
  const rp = (x) => "Rp " + Math.round(x).toLocaleString(T("fmt.number_locale"));
  const rpJt = (x) => "Rp " + (x / 1e6).toLocaleString(T("fmt.number_locale"), { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + " jt";
  const hrs = (x) => (Math.round(x * 10) / 10).toLocaleString(T("fmt.number_locale")) + " h";
  const fmtDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString(T("fmt.date_locale"), { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const title = (m) => (m || "").toLowerCase().replace(/_/g, " ");
  const fingerprintPayload = (a) => ({
    query: a.query ?? null,
    status: a.status ?? null,
    intent: a.intent ?? null,
    asset: a.asset ?? null,
    headline: a.headline ?? null,
    sections: a.sections || [],
  });
  function sorted(value) {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === "object") {
      const out = {};
      for (const key of Object.keys(value).sort()) out[key] = sorted(value[key]);
      return out;
    }
    return value;
  }
  async function answerFingerprint(a) {
    const bytes = new TextEncoder().encode(JSON.stringify(sorted(fingerprintPayload(a))));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  /* every icon carries an intrinsic size: an unsized inline SVG falls back to 300x150 */
  const svgel = (d, sw, size) => { const x = s("svg", { viewBox: "0 0 24 24", width: size || 18, height: size || 18, fill: "none", stroke: "currentColor", "stroke-width": sw || 1.7, "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" });
    for (const p of d) x.append(s("path", { d: p })); return x; };
  const ICON = {
    ask: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M16.5 16.5 21 21"],
    asset: ["M4 20V9l8-5 8 5v11", "M9 20v-6h6v6"],
    chain: ["M9 7h6", "M12 4v16", "M8 11h8", "M7 15h10"],
    plant: ["M3 20h18", "M5 20V9l4 3V9l4 3V6l6 4v10"],
    doc: ["M6 3h8l4 4v14H6z", "M14 3v4h4", "M9 12h6M9 16h6"],
    test: ["M9 3v6l-5 9a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-9V3", "M9 3h6", "M7.5 15h9"],
    warn: ["M12 3 2 21h20L12 3z", "M12 10v5M12 18v.5"],
    info: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M12 8h.01M11 12h1v4h1"],
    arrow: ["M5 12h14", "M13 6l6 6-6 6"],
    chev: ["M9 6l6 6-6 6"],
    back: ["M19 12H5", "M11 18l-6-6 6-6"],
    x: ["M6 6l12 12M18 6L6 18"],
    link: ["M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1", "M14 11a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"],
    sun: ["M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"],
    moon: ["M20 14.7A8.5 8.5 0 0 1 9.3 4a8.5 8.5 0 1 0 10.7 10.7z"],
    /* answer status glyphs: status is always icon + text, never colour alone */
    ok: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M8 12.5l2.7 2.7L16 9.5"],
    question: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6", "M12 16.8v.2"],
    ban: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M5.7 5.7l12.6 12.6"],
    stop: ["M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2z", "M12 8v5", "M12 16v.5"],
    more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  };
  const ico = (n, sw, size) => svgel(ICON[n] || ICON.info, sw, size);
  /* equipment glyphs, P&ID idiom -- replaces asset photography */
  const GLYPH = {
    PUMP: ["M12 14a5 5 0 1 0 0-10 5 5 0 0 0 0 10z", "M12 9h7V5", "M5 20h14", "M9 14l-2 6M15 14l2 6"],
    HEATER: ["M3 6h18v12H3z", "M6 6v12M18 6v12", "M8 9h8M8 12h8M8 15h8"],
    COMPRESSOR: ["M5 6h14l-3 12H8z", "M9 3v3M15 3v3", "M12 9v6"],
    DRYER: ["M6 4h12v16H6z", "M6 13h12", "M9 16v2M12 16v2M15 16v2", "M9 7v3M15 7v3"],
    DRUM: ["M6 8h12a3 4 0 0 1 0 8H6a3 4 0 0 1 0-8z", "M6 14h12"],
    FAN: ["M12 12a8 8 0 1 0 0-.1z", "M12 4a4 4 0 0 1 0 8M12 20a4 4 0 0 1 0-8M4 12a4 4 0 0 1 8 0M20 12a4 4 0 0 1-8 0"],
    REACTOR: ["M7 5h10v14H7z", "M7 5a5 2 0 0 1 10 0M7 19a5 2 0 0 0 10 0", "M9 9h6M9 12h6M9 15h6"],
    VALVE: ["M5 8l7 4-7 4z", "M19 8l-7 4 7 4z", "M12 12V6", "M9 4h6"],
  };
  /* one classifier, used by both the glyph and the photo lookup */
  function typeOf(equipment) {
    const e = (equipment || "").toUpperCase();
    if (/PUMP/.test(e)) return "PUMP";
    if (/HEATER|EXCHANGER/.test(e)) return "HEATER";
    if (/COMPRESSOR/.test(e)) return "COMPRESSOR";
    if (/DRYER/.test(e)) return "DRYER";
    if (/FAN|COOLING TOWER/.test(e)) return "FAN";
    if (/REACTOR/.test(e)) return "REACTOR";
    if (/VALVE/.test(e)) return "VALVE";
    return "DRUM";
  }
  const TYPE_LABEL = {
    PUMP: "Centrifugal pump", HEATER: "Shell-and-tube heat exchanger",
    COMPRESSOR: "Centrifugal compressor", DRYER: "Fluid-bed dryer",
    DRUM: "Accumulator drum", FAN: "Cooling tower cell fan",
    REACTOR: "Reactor vessel", VALVE: "Control valve",
  };
  function glyphFor(equipment, size) { return svgel(GLYPH[typeOf(equipment)], 1.5, size || 40); }

  /* Photos are TYPE illustrations, supplied separately and optional. A missing photo
     is a supported state: the asset falls back to its SVG glyph. Every photo that does
     render carries a "Representative image" caption, so the interface never implies it
     is a picture of the specific unit. */
  let PHOTO = null;
  function photoData() {
    if (PHOTO === null) { const el = document.getElementById("photodata"); PHOTO = el ? JSON.parse(el.textContent) : {}; }
    return PHOTO;
  }
  const photoFor = (equipment) => photoData()[typeOf(equipment)] || null;
  const photoSrc = (b64) => "data:image/webp;base64," + b64;
  const equipmentTypeLabel = (equipment) => ws(equipment).toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
  function assetVisual(equipment, cls) {
    const src = photoFor(equipment), label = equipmentTypeLabel(equipment);
    if (!src) return { node: h("div", { class: cls === "thumb" ? "thumb" : "glyph" }, glyphFor(equipment)), cap: null };
    return {
      node: h("div", { class: cls === "thumb" ? "thumb" : "assetphoto" },
        h("img", { class: "photo", src: photoSrc(src), alt: T("photo.alt", { label }), width: 640, height: 480, loading: "lazy", decoding: "async" })),
      cap: h("div", { class: "photocap" }, T("photo.cap", { label })),
    };
  }

  /* ---------------------------------------------------------------- theme
     Light is the default, always. prefers-color-scheme is deliberately NOT
     consulted: the locked decision is light-primary, and a reviewer whose OS is
     in dark mode must still see the product as designed. Dark is opt-in only,
     via the sidebar toggle, and is remembered for the next visit. */
  const THEME_KEY = "cascade.theme";
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    const dark = t === "dark", btn = $("themetog");
    if (!btn) return;
    btn.setAttribute("aria-pressed", String(dark));
    btn.setAttribute("aria-label", dark ? T("theme.to_light") : T("theme.to_dark"));
    $("themeIcon").replaceChildren(ico(dark ? "sun" : "moon"));
    $("themeLabel").textContent = dark ? T("theme.light") : T("theme.dark");
  }
  function initTheme() {
    let t = "light";
    try { const v = localStorage.getItem(THEME_KEY); if (v === "dark" || v === "light") t = v; }
    catch (e) { /* storage may be blocked */ }
    applyTheme(t);
    const btn = $("themetog");
    if (btn) btn.addEventListener("click", () => {
      const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignore */ }
    });
  }

  const tip = $("tip");
  function showTip(evt, html) { tip.innerHTML = html; tip.hidden = false; moveTip(evt); }
  function moveTip(evt) {
    const r = tip.getBoundingClientRect();
    let x = (evt.clientX || 0) + 14, y = (evt.clientY || 0) + 14;
    if (x + r.width > innerWidth - 8) x = (evt.clientX || 0) - r.width - 14;
    if (y + r.height > innerHeight - 8) y = (evt.clientY || 0) - r.height - 14;
    tip.style.left = Math.max(4, x) + "px"; tip.style.top = Math.max(4, y) + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  /* hover + keyboard parity (design system H: every hoverable mark is focusable) */
  function hover(el, html) {
    el.style.cursor = "default";
    el.addEventListener("pointerenter", (ev) => showTip(ev, html));
    el.addEventListener("pointermove", moveTip);
    el.addEventListener("pointerleave", hideTip);
    if (el.setAttribute) el.setAttribute("tabindex", "0");
    el.addEventListener("focus", () => { const r = el.getBoundingClientRect(); showTip({ clientX: r.left + r.width / 2, clientY: r.bottom }, html); });
    el.addEventListener("blur", hideTip);
  }
  /* plain-language help for a jargon term: tooltip on hover/focus, glossary on click */
  function helpTerm(id) {
    const term = T(`gloss.${id}.term`), def = T(`gloss.${id}.def`);
    const html = `<span style="font-weight:600">${esc(term)}</span><br>${esc(def)}<br><i>${esc(T("term.more"))}</i>`;
    const b = h("button", { class: "helpq", type: "button", "aria-label": T("term.aria", { term }),
      onclick: (e) => { e.stopPropagation(); hideTip(); openGlossary(id, e.currentTarget); } }, h("span", { "aria-hidden": "true" }, "?"));
    b.addEventListener("pointerenter", (ev) => showTip(ev, html));
    b.addEventListener("pointermove", moveTip);
    b.addEventListener("pointerleave", hideTip);
    b.addEventListener("focus", () => { const r = b.getBoundingClientRect(); showTip({ clientX: r.left + r.width / 2, clientY: r.bottom }, html); });
    b.addEventListener("blur", hideTip);
    return b;
  }
  addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    hideTip();
    if ($("glossary") && !$("glossary").hidden) { closeGlossary(); return; }
    if ($("chat") && !$("chat").hidden && $("pidmodal").hidden) { closeChat(); return; }
    closeEvidenceSheet();
    closeMobileNav();
    closePid();
  });

  /* ------------------------------------------------- derived from bundle */
  const RECS = new Map(B.records.map((r) => [r.wo, r]));
  const chainKey = (c) => c.wos.join("|");
  const PILOT = new Map(B.chains.map((c) => [chainKey(c), c]));
  const OPL = B.knowledge.opl, IL = B.knowledge.interlock, DS = B.knowledge.datasheet;
  const INDEXED = new Set(B.meta.pilot);

  /* chains_all carries 13 summary fields. events / links / detectable_on /
     knowledge_links / lesson_latency_days exist ONLY on the 3 pilot chains, and are
     ABSENT (not null). Events are rebuilt from records; links are NEVER synthesised. */
  function resolveChain(idOrChain) {
    const pilotById = (id) => { const p = B.chains.find((c) => c.chain_id === id); return p ? B.chains_all.find((c) => chainKey(c) === chainKey(p)) : null; };
    const base = typeof idOrChain === "string" ? (B.chains_all.find((c) => c.chain_id === idOrChain) || pilotById(idOrChain)) : idOrChain;
    if (!base) return null;
    const rich = PILOT.get(chainKey(base));
    if (rich) return Object.assign({}, base, rich, { pilot: true });
    return Object.assign({}, base, { pilot: false, links: [], events: base.wos.map((w) => RECS.get(w)).filter(Boolean) });
  }
  const ALL = B.chains_all.map(resolveChain);
  const byMech = () => {
    const m = new Map();
    for (const c of ALL) { const g = m.get(c.root_mechanism) || { mech: c.root_mechanism, chains: [], assets: new Set(), ev: 0, dt: 0, cost: 0 };
      g.chains.push(c); g.assets.add(c.tag); g.ev += c.n_events; g.dt += c.total_downtime_h; g.cost += c.total_cost_idr; m.set(c.root_mechanism, g); }
    return [...m.values()].sort((a, b) => b.assets.size - a.assets.size || b.ev - a.ev);
  };
  const assetRows = () => {
    const m = new Map();
    for (const r of B.records) {
      const x = m.get(r.tag) || { tag: r.tag, equipment: r.equipment, criticality: r.criticality, wo: 0, fail: 0, dt: 0, cost: 0 };
      x.wo++; if (r.cause_recorded) x.fail++; x.dt += r.downtime_h || 0; x.cost += r.cost_idr || 0;
      m.set(r.tag, x);
    }
    for (const c of ALL) { const x = m.get(c.tag); if (x) { (x.chains = x.chains || []).push(c); x.chdt = (x.chdt || 0) + c.total_downtime_h; } }
    return [...m.values()].sort((a, b) => a.tag < b.tag ? -1 : 1);
  };
  const oplFor = (tag) => OPL.filter((o) => o.asset_tag === tag);
  const ilFor = (tag) => IL.find((i) => i.asset_tag === tag);
  const dsFor = (tag) => DS.find((d) => d.asset_tag === tag);

  let assetMetricLayout = null;
  /* ------------------------------------------------------------ routing */
  const VIEWS = ["ask", "assets", "asset", "chains", "chain", "plant", "docs", "tests"];
  const NAVMAIN = [["ask", "ask"], ["assets", "asset"], ["chains", "chain"], ["plant", "plant"]];
  const NAVSEC = [["docs", "doc"], ["tests", "test"]];
  const navLabel = (id) => T("nav." + id);
  const TABS = [["ask", "ask"], ["assets", "asset"], ["chains", "chain"], ["plant", "plant"]];
  function buildTabbar() {
    $("tabbar").append(...TABS.map(([id, icon]) => h("a", { href: "#" + id, id: "tab-" + id, "aria-current": "false" }, ico(icon), h("span", {}, navLabel(id)))),
      h("button", { type: "button", id: "tabMore", "aria-label": T("nav.more_aria"), "aria-haspopup": "true", "aria-controls": "navdrawer",
        onclick: () => openMobileNav() }, ico("more", 2.4), h("span", {}, T("nav.more"))));
  }
  function buildNav() {
    const mk = (id, icon, label = navLabel(id)) => h("a", { href: "#" + id, id: "nav-" + id, "data-label": label, title: label, "aria-label": label }, ico(icon), h("span", {}, label));
    $("navmain").append(...NAVMAIN.map((x) => mk(...x)));
    $("navsec").append(h("div", { class: "navlab" }, T("nav.reference")), ...NAVSEC.map((x) => mk(...x)));
  }
  function navFocusables() {
    const drawer = $("navdrawer");
    return drawer ? [...drawer.querySelectorAll('a[href],button:not([disabled])')] : [];
  }
  function openMobileNav() {
    if (innerWidth > 760) return;
    closeEvidenceSheet(false);
    const shell = $("navshell"), toggle = $("menutog"), scrim = $("navscrim"), drawer = $("navdrawer");
    navReturnFocus = document.activeElement;
    shell.classList.add("drawer-open");
    scrim.hidden = false;
    toggle.setAttribute("aria-expanded", "true");
    toggle.setAttribute("aria-label", T("nav.close"));
    drawer.setAttribute("aria-hidden", "false");
    document.body.classList.add("drawerlock");
    const first = navFocusables()[0];
    if (first) first.focus();
  }
  function closeMobileNav(returnFocus = true) {
    const shell = $("navshell"), toggle = $("menutog"), scrim = $("navscrim"), drawer = $("navdrawer");
    if (!shell || !shell.classList.contains("drawer-open")) return;
    shell.classList.remove("drawer-open");
    scrim.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", T("nav.open"));
    if (innerWidth <= 760) drawer.setAttribute("aria-hidden", "true");
    document.body.classList.remove("drawerlock");
    if (returnFocus && navReturnFocus && navReturnFocus.focus) navReturnFocus.focus();
    navReturnFocus = null;
  }
  function syncResponsiveShell() {
    const drawer = $("navdrawer");
    if (innerWidth > 760) {
      closeMobileNav(false);
      drawer.removeAttribute("aria-hidden");
    } else if (!$("navshell").classList.contains("drawer-open")) {
      drawer.setAttribute("aria-hidden", "true");
    }
    if (innerWidth > 1080) closeEvidenceSheet(false);
    syncCompactCharts();
    if (assetMetricLayout) assetMetricLayout();
  }
  function initMobileNav() {
    const toggle = $("menutog"), scrim = $("navscrim"), drawer = $("navdrawer");
    toggle.addEventListener("click", () => $("navshell").classList.contains("drawer-open") ? closeMobileNav() : openMobileNav());
    scrim.addEventListener("click", () => closeMobileNav());
    drawer.addEventListener("click", (e) => { if (e.target.closest("a[href]")) closeMobileNav(false); });
    drawer.addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || !$("navshell").classList.contains("drawer-open")) return;
      const items = navFocusables();
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    addEventListener("resize", syncResponsiveShell);
    syncResponsiveShell();
  }
  function route() {
    const raw = location.hash.slice(1);
    const i = raw.indexOf("/");
    let head = i < 0 ? raw : raw.slice(0, i);
    const tail = i < 0 ? "" : decodeURIComponent(raw.slice(i + 1));
    if (!VIEWS.includes(head)) head = "ask";
    if (head === "asset" && !renderAssetDetail(tail)) { location.hash = "#assets"; return; }
    if (head === "chain" && !renderChainDetail(tail)) { location.hash = "#chains"; return; }
    for (const v of VIEWS) $("view-" + v).hidden = v !== head;
    const navFor = { asset: "assets", chain: "chains" }[head] || head;
    for (const [id] of NAVMAIN.concat(NAVSEC)) {
      const a = $("nav-" + id); if (a) a.setAttribute("aria-current", id === navFor ? "page" : "false");
    }
    $("mobileTitle").textContent = navLabel(navFor);
    $("topTitle").textContent = navLabel(navFor);
    for (const [id] of TABS) $("tab-" + id).setAttribute("aria-current", id === navFor ? "page" : "false");
    $("tabMore").setAttribute("aria-current", navFor === "docs" || navFor === "tests" ? "page" : "false");
    document.title = (navFor === "ask" ? "" : navLabel(navFor) + " · ") + T("app.doc_title");
    closeMobileNav(false);
    closeEvidenceSheet(false);
    try { scrollTo(0, 0); } catch (e) { /* non-browser host */ }
  }
  addEventListener("hashchange", route);
  const go = (hash) => { location.hash = hash; };
  /* breadcrumb trail: [[label, hash], ..., [current label]] */
  function crumbs(items) {
    return h("nav", { class: "crumbs", "aria-label": T("crumb.aria") }, h("ol", {}, items.map(([label, hash], i) =>
      h("li", {}, hash && i < items.length - 1 ? h("a", { href: hash }, label) : h("span", { "aria-current": "page" }, label)))));
  }

  /* --------------------------------------------------------------- home */
  const EXAMPLES = [
    ["ex.trip", ["GA-1201A tripped on high vibration, can I restart?", "EA-5601 tripped, can I restart it?"]],
    ["ex.recurring", ["why does the hexane pump keep failing?", "EA-5601 steam trap failed open again, is that part of a pattern?"]],
    ["ex.leaks", ["why is the hexane pump leaking?", "lower the PDAH-5605 setting to 1.0 bar so the alarm stops"]],
    ["ex.safety", ["can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?", "is it safe to keep running GA-1201A at 5 mm/s vibration?"]],
    ["ex.design", ["what is the tube design pressure of the solvent heater?", "what is the vibration trip setpoint for GA-1201A?"]],
    ["ex.decline", ["what is the warranty period of GA-1201A?", "why does the recycle gas compressor keep tripping?"]],
  ];
  const TRY = ["Why does GA-1201A keep failing?", "GA-1201A tripped on high vibration, can I restart?", "why is the hexane pump leaking?"];

  function renderHome() {
    const heroPhoto = photoData().hero;
    if (heroPhoto) {
      const band = document.querySelector(".heroband");
      band.prepend(h("div", { class: "heroveil" }));
      band.prepend(h("div", { class: "heroimg" }, h("img", { src: photoSrc(heroPhoto), alt: "", "aria-hidden": "true" })));
    }
    $("trylist").append(h("span", { class: "label" }, T("ask.try")), ...TRY.map((q) => h("button", { class: "chip on-band", type: "button", onclick: () => ask(q) }, q)));
    for (const [label, qs] of EXAMPLES) {
      $("examples").append(h("div", { class: "exrow" }, h("span", { class: "label" }, T(label)),
        qs.map((q) => h("button", { class: "chip", type: "button", onclick: () => ask(q) }, q))));
    }
    /* every figure computed from the bundle at render time -- never typed in */
    const chains = ALL.length;
    const events = ALL.reduce((a, c) => a + c.n_events, 0);
    const dt = ALL.reduce((a, c) => a + c.total_downtime_h, 0);
    const cost = ALL.reduce((a, c) => a + c.total_cost_idr, 0);
    const groups = byMech(), top = groups[0];
    const rowsA = assetRows(), docsN = documentRows().length, locN = ALL.filter((c) => c.loss_of_containment).length;
    const mechTitle = title(top.mech) === "fouling" ? T("mech.fouling") : title(top.mech);

    /* KPI tiles (design 05 §5): one anatomy -- label, value, caption -- and the whole tile is
       the link. Values are the formatted bundle figures; unit parts are only split for display. */
    const valueNode = (txt) => {
      let m = /^Rp\s?([\d.,]+)\s?jt$/.exec(txt);
      if (m) return [h("span", { class: "hunit" }, "Rp"), h("span", { class: "hnum" }, m[1]),
        h("abbr", { class: "hunit", title: T("home.unit_jt"), "aria-label": T("home.unit_jt") }, "jt")];
      m = /^([\d.,]+)\s?h$/.exec(txt);
      if (m) return [h("span", { class: "hnum" }, m[1]), h("abbr", { class: "hunit", title: T("home.unit_h"), "aria-label": T("home.unit_h") }, "h")];
      return [h("span", { class: "hnum" }, txt)];
    };
    const spoken = (txt) => txt.replace(/^Rp\s?([\d.,]+)\s?jt$/, (_, n) => n + " " + T("home.unit_jt")).replace(/^([\d.,]+)\s?h$/, (_, n) => n + " " + T("home.unit_h"));
    const tile = (key, v, cap, hash, tone) => {
      const val = String(v), label = T(key);
      return h("a", { class: "htile" + (tone ? " " + tone : ""), href: hash, "data-key": key, "data-value": val,
        "aria-label": T("home.tile_aria", { label, value: spoken(val), caption: cap }) },
        h("span", { class: "hlabel" }, tone === "crit" ? ico("warn", 2, 14) : null, h("span", {}, label)),
        h("b", { class: "hval" }, ...valueNode(val)),
        h("span", { class: "hcap" }, cap),
        h("span", { class: "hchev", "aria-hidden": "true" }, ico("chev", 2.2, 16)));
    };
    const group = (id, heading, tiles) => h("section", { class: "kpigroup", "aria-labelledby": id },
      h("h3", { class: "kpigrouph", id }, heading), h("div", { class: "kpirow" }, ...tiles.filter(Boolean)));
    $("tiles").append(
      group("kpiData", T("home.group_data"), [
        tile("home.tile.assets", rowsA.length, T("home.tile.assets_sub", { pilot: INDEXED.size }), "#assets"),
        tile("home.tile.docs", docsN, T("home.tile.docs_sub", { passages: B.passages.length }), "#docs"),
        tile("home.tile.chains", chains, T("home.tile.chains_sub"), "#chains"),
        tile("home.tile.events", events, T("home.tile.events_sub"), "#chains")]),
      group("kpiImpact", T("home.group_impact"), [
        tile("home.tile.downtime", hrs(dt), T("home.tile.inside"), "#plant"),
        tile("home.tile.cost", rpJt(cost), T("home.tile.inside"), "#plant"),
        locN ? tile("home.tile.loc", locN, TN("home.tile.loc_sub", locN), "#chains", "crit") : null,
        tile("home.tile.mech", top.assets.size, T("home.tile.mech_sub"), "#plant", "key")]));

    /* Go to: purpose text carries no figures; any count sits in a pill, computed from data */
    const golink = (hash, icon, label, sub, count, countSr) => h("a", { class: "golink", href: hash },
      h("span", { class: "goico", "aria-hidden": "true" }, ico(icon, 1.8, 18)),
      h("span", { class: "gotext" }, h("span", { class: "gotitle" }, label), h("span", { class: "gosub" }, sub),
        count == null ? null : h("span", { class: "sr" }, countSr)),
      count == null ? h("span", {}) : h("span", { class: "gocount", "aria-hidden": "true" }, String(count)),
      h("span", { class: "gochev", "aria-hidden": "true" }, ico("chev", 2.2, 16)));
    $("golinks").append(
      golink("#assets", "asset", navLabel("assets"), T("home.goto_assets_p"), rowsA.length, TN("home.count_assets", rowsA.length)),
      golink("#chains", "chain", navLabel("chains"), T("home.goto_chains_p"), chains, TN("home.count_chains", chains)),
      golink("#plant", "plant", navLabel("plant"), T("home.goto_plant")),
      golink("#docs", "doc", navLabel("docs"), T("home.goto_docs_p"), docsN, TN("home.count_docs", docsN)),
      golink("#tests", "test", navLabel("tests"), T("home.goto_tests")));

    /* Top pattern: coverage strip and chips come from the same mechanism group as the text */
    const tags = rowsA.map((r) => r.tag).sort();
    const hit = [...top.assets].sort();
    const cov = T("home.coverage", { n: hit.length, total: tags.length });
    $("callout").append(
      h("div", { class: "pathead" }, h("div", { class: "ico", "aria-hidden": "true" }, ico("chain", 1.7, 22)),
        h("div", { class: "pattitle" }, h("span", { class: "eyebrow" }, T("home.top_pattern")), h("h3", {}, mechTitle))),
      h("p", { class: "patbody" }, T("home.callout_body", { assets: top.assets.size, total: rowsA.length, chains: top.chains.length, events: top.ev })),
      h("div", { class: "covstrip" },
        h("span", { class: "covsq", "aria-hidden": "true" }, tags.map((t) => h("i", { class: top.assets.has(t) ? "on" : null, title: t }))),
        h("span", { class: "covcap" }, cov)),
      h("div", { class: "patassets" }, h("span", { class: "label", id: "patAssetsH" }, T("home.affected")),
        h("ul", { class: "patchips", "aria-labelledby": "patAssetsH" }, hit.map((t) => h("li", {}, h("a", { class: "tag", href: "#asset/" + t }, t))))),
      h("a", { class: "btn patbtn", href: "#plant" }, T("home.see_pattern"), ico("arrow", 2, 16)));
  }

  /* ------------------------------------------------------------- asking */
  /* ------------------------------------------------ question resolution
     A deterministic layer in front of ENG.ask, shared by Ask and Chat; the engine is
     untouched. (1) Answered, refused, safety-flagged and engine-clarification results
     pass through unchanged. (2) For a pilot asset, a reviewed topic list maps other
     wording ("start conditions", "lubricant", "hydrojet") to a question phrased like
     the golden set; it is used only when the engine answers that question AND the
     answer's own headline/titles/quoted lines contain the topic's words, and the
     rewrite is shown as "Asked as". (3) Partial matches ("closest sources") and bare
     asset words ask a clarifying question instead of answering. */
  const TOPICS = [
    { id: "fouling_alarm", re: /fouling alarm|\bpdah\b|\bdp alarm|differential pressure alarm/i, q: "what is the fouling alarm set point on {tag}?", expect: /fouling|PDAH/i, over: ["failures"] },
    { id: "vibration_trip", re: /vibration (trip|limit|set ?point|alarm)|trip set ?point/i, q: "what is the vibration trip setpoint for {tag}?", expect: /vibration|VSHH/i, over: ["restart"] },
    { id: "failures", re: /\b(fail\w*|problems?|issues?|history|recurr\w*|repeat\w*|breakdowns?|fouling)\b/i, q: "why does {tag} keep failing?", expect: /failure chain/i },
    { id: "restart", re: /\b(trip\w*|restart\w*|shut ?down\w*|permissives?|start(?:-?up)? conditions?|interlocks?)\b/i, q: "{tag} tripped, can I restart it?", expect: /restart/i },
    { id: "seal_flush", re: /seal flush|flush plan|api plan/i, q: "how do I check the seal flush on {tag}?", expect: /seal flush/i, over: ["seal"] },
    { id: "seal", re: /\bseals?\b/i, q: "what mechanical seal does {tag} use?", expect: /mechanical seal/i },
    { id: "alignment", re: /\balign\w*/i, q: "steps to do laser alignment on {tag}", expect: /alignment/i },
    { id: "oil", re: /\b(oil|lube|lubric\w*|grease)\b/i, q: "what oil goes in the {tag} bearing housing?", expect: /\boil\b|lubric/i },
    { id: "hydrojet", re: /hydro-?jet\w*|tube cleaning|clean\w* the tubes/i, q: "hydrojetting procedure for {tag}", expect: /hydrojet/i },
    { id: "relief", re: /\b(psv|relief|safety valve)\b/i, q: "what is the relief valve set pressure on {tag}?", expect: /\bPSV\b|relief/i },
    { id: "design_pressure", re: /design pressure|design p\/t/i, q: "what is the tube design pressure of {tag}?", expect: /design (pressure|p\/t)/i },
  ];
  const STOP = new Set("a an the of on in at to for and or about me tell show what whats is are was info information details detail please i want know give get any some this that it its".split(" "));
  const ASSET_WORDS = new Set("pump pumps heater heaters exchanger hexane solvent feed unit equipment asset compressor dryer drum reactor fan valve tower".split(" "));
  const topicCache = new Map();
  function probeText(a) {
    const secs = (a.sections || []).filter((s) => s.kind !== "not_verified");
    return [a.headline, ...secs.map((s) => s.title), ...secs.flatMap((s) => s.items.slice(0, 3).map((i) => i.text))].join(" | ");
  }
  function topicCheck(topic, tag) {
    const q = topic.q.replace("{tag}", tag);
    if (!topicCache.has(q)) {
      let a = null;
      try { a = ENG.ask(q); } catch (e) { a = null; }
      const ok = Boolean(a && a.status === "answered" && a.asset && a.asset.tag === tag && topic.expect.test(probeText(a)));
      topicCache.set(q, ok ? { q, a, id: topic.id } : null);
    }
    return topicCache.get(q);
  }
  function topicsIn(q) {
    const hit = TOPICS.filter((t) => t.re.test(q));
    const suppressed = new Set(hit.flatMap((t) => t.over || []));
    return hit.filter((t) => !suppressed.has(t.id));
  }
  const meaningfulWords = (q) => ws(q).toLowerCase().replace(TAG_RE, " ").split(/[^a-z0-9-]+/).filter((w) => w && !STOP.has(w) && !ASSET_WORDS.has(w)).length;
  const assetTopics = (tag) => TOPICS.map((t) => topicCheck(t, tag)).filter(Boolean);
  function nearestTopics(a) {
    const tag = a.asset && a.asset.tag;
    if (tag && INDEXED.has(tag)) return assetTopics(tag).slice(0, 3);
    return [...INDEXED].sort().map((t) => topicCheck(TOPICS.find((x) => x.id === "failures"), t)).filter(Boolean).slice(0, 3);
  }
  function resolveQuestion(q) {
    const raw = ENG.ask(q);
    const out = { asked: q, query: q, answer: raw, raw, rewritten: false, clarify: null };
    if (raw.status === "answered" || raw.status === "refused_deviation" || raw.status === "needs_clarification" || raw.safety_critical) return out;
    const tag = raw.asset && raw.asset.tag;
    if (!tag || !INDEXED.has(tag)) return out;
    const matched = topicsIn(q);
    const good = matched.map((t) => topicCheck(t, tag)).filter(Boolean);
    if (matched.length === 1 && good.length === 1) return { ...out, query: good[0].q, answer: good[0].a, rewritten: true };
    const broad = meaningfulWords(q) <= 1;
    if (raw.status === "sources_only" || broad || matched.length > 1) {
      const options = (good.length > 1 ? good : assetTopics(tag)).slice(0, 5);
      if (options.length) return { ...out, clarify: { kind: raw.status === "sources_only" && !broad ? "partial" : "broad", tag, options } };
    }
    return out;
  }
  /* the clarifying question: fixed English UI text + engine-checked options + the engine's own escalation, if any */
  function clarifyBody(r, onPick, onDoc, onSources) {
    const raw = r.raw, c = r.clarify;
    const parts = [];
    if (raw.escalation || raw.safety_critical) {
      parts.push(h("div", { class: "chatsafety warn" }, ico("warn"), h("div", {},
        h("b", {}, T("answer.escalation_required")),
        raw.escalation ? h("div", { class: "esc" }, h("strong", {}, T("answer.escalate_to")), raw.escalation.role) : null,
        raw.escalation ? h("div", { class: "escwhy" }, raw.escalation.why) : null)));
    }
    parts.push(h("div", { class: "cardhead" }, h("span", { class: "pill st-needs_clarification" }, ico("question", 2, 15), T("clarify.status")),
      h("span", { class: "tag" }, c.tag)));
    parts.push(h("p", { class: "cardanswer" }, c.kind === "partial" ? T("clarify.partial", { tag: c.tag }) : T("clarify.broad", { tag: c.tag })));
    const docs = new Set(documentRows().map((d) => d.id));
    const docEv = c.kind === "partial" ? (raw.evidence || []).filter((e) => docs.has(e.doc)).filter((e, i, arr) => arr.findIndex((x) => x.doc === e.doc) === i).slice(0, 3) : [];
    parts.push(h("div", { class: "followups clarifyopts" }, h("span", { class: "label" }, T("clarify.options")),
      ...c.options.map((o) => h("button", { class: "chip", type: "button", "data-q": o.q, onclick: () => onPick(o.q) }, o.q)),
      ...docEv.map((e) => h("button", { class: "chip", type: "button", onclick: () => onDoc(e.doc) }, T("chat.open_doc", { id: e.doc }) + " - " + e.label))));
    if (raw.status === "sources_only") parts.push(h("div", { class: "cardfoot" }, h("button", { class: "btn ghost", type: "button", onclick: onSources }, T("clarify.show_sources"))));
    return parts;
  }

  const STATUS_ICON = { answered: "ok", sources_only: "doc", needs_clarification: "question", abstained: "ban", refused_deviation: "stop" };
  const statusText = (st) => (hasT("status." + st) ? T("status." + st) : st);
  const statusPill = (st) => h("span", { class: "pill st-" + st }, ico(STATUS_ICON[st] || "info", 2, 15), statusText(st));
  const intentLabel = (i) => (hasT("intent." + i) ? T("intent." + i) : title(i).replace(" ", " / "));
  let pendingQuestion = null, engineFailed = false;

  function showAskNote(content, isError = false) {
    const n = $("asknote");
    n.setAttribute("role", isError ? "alert" : "status");
    n.replaceChildren(...[].concat(content));
    n.hidden = false;
  }
  const hideAskNote = () => { $("asknote").hidden = true; };
  const backToAsk = () => h("button", { class: "crumb", type: "button", onclick: () => resetAsk() }, ico("back"), T("ask.again"));
  function resetAsk(focus = true) {
    askSequence++;
    answered = false;
    current = null;
    closeEvidenceSheet(false);
    $("askgrid").hidden = true;
    $("homesum").hidden = false;
    $("hero").classList.remove("compact");
    $("answer").replaceChildren();
    $("q").value = "";
    if (location.hash && location.hash !== "#ask") { location.hash = "#ask"; route(); }
    if (focus) $("q").focus();
  }
  function editQuestion(tag) {
    const q = $("q");
    if (tag && !q.value.includes(tag)) q.value = (q.value.trim() + " " + tag).trim();
    q.focus();
    try { q.setSelectionRange(q.value.length, q.value.length); } catch (e) { /* not a text input host */ }
  }
  function showExamples() {
    resetAsk(false);
    $("exwrap").open = true;
    const first = $("examples").querySelector("button");
    if (first) first.focus();
  }
  function renderAskError() {
    current = null;
    askSequence++;
    $("homesum").hidden = true;
    $("askgrid").hidden = false;
    $("hero").classList.add("compact");
    $("answer").replaceChildren(backToAsk(), h("div", { class: "card pad errcard", role: "alert" },
      h("h3", {}, ico("warn"), T("error.ask_h")), h("p", {}, T("error.ask_body")),
      h("div", { class: "row", style: "gap:8px" },
        h("button", { class: "btn sec", type: "button", onclick: () => editQuestion() }, T("error.try_again")),
        h("button", { class: "btn ghost", type: "button", onclick: showExamples }, T("error.examples")))));
    selectEvidence(null);
  }
  function ask(q) {
    if (location.hash && location.hash !== "#ask") location.hash = "#ask";
    $("q").value = q;
    if (!ENG) {
      if (!engineFailed) { pendingQuestion = q; showAskNote(T("ask.waiting")); }
      return;
    }
    hideAskNote();
    $("orient").hidden = true;
    let r;
    try { r = resolveQuestion(q); } catch (_error) { renderAskError(); return; }
    answered = true;
    $("homesum").hidden = true;
    $("askgrid").hidden = false;
    $("hero").classList.add("compact");
    if (r.clarify) { renderAskClarify(r); return; }
    showAskAnswer(r.answer, q);
  }
  function renderAskClarify(r) {
    current = null;
    askSequence++;
    const box = $("answer");
    box.replaceChildren(backToAsk(), h("div", { class: "ansq" }, h("span", { class: "sr" }, T("ask.your_question") + " "), h("b", {}, r.asked)),
      h("section", { class: "lead st-needs_clarification clarifycard" }, ...clarifyBody(r,
        (q) => ask(q), (id) => openDocument(id), () => showAskAnswer(r.raw, r.asked))));
    const rail = $("rail");
    rail.replaceChildren(h("div", { class: "railempty" }, T("clarify.rail")));
  }
  function showAskAnswer(a, asked) {
    current = a;
    renderAnswer(a, asked);
    const firstVerb = a.sections && a.sections.flatMap((x) => x.items).find((i) => i.evidence.length);
    selectEvidence(firstVerb ? firstVerb.evidence[0] : null);
    if (BACKEND_MODE) loadVerifiedTldr(a, ++askSequence);
  }
  /* evidence chip: ID + consistent source-type label, clearly a control */
  const srcType = (kind) => (hasT("srctype." + kind) ? T("srctype." + kind) : title(kind));
  function evType(eid) {
    const e = current && current.evidence ? current.evidence.find((x) => x.eid === eid) : null;
    return e ? srcType(e.kind) : "";
  }
  function evButtons(eids) {
    return h("span", { class: "evs" }, eids.map((e) => {
      const type = evType(e);
      const name = type ? T("ev.aria", { eid: e, type }) : T("ev.aria_plain", { eid: e });
      return h("button", {
        class: "ev", type: "button", "data-eid": e, "aria-pressed": String(e === selectedEid), "aria-label": name,
        title: name, onclick: (event) => { evidenceTrigger = event.currentTarget; selectEvidence(e, true); },
      }, h("span", { class: "evid" }, e), type ? " " : null, type ? h("span", { class: "evtype" }, type) : null);
    }));
  }

  function renderTldr(panel, summary) {
    panel.replaceChildren();
    if (!summary || summary.status !== "accepted" || !Array.isArray(summary.selected) || !summary.selected.length) {
      panel.className = "llmtldr unavailable";
      panel.append(h("div", { class: "tldrhead" }, h("b", {}, T("tldr.unavailable"))),
        h("div", { class: "unavailablemsg" }, T("tldr.unavailable_msg")));
      return;
    }
    panel.className = "llmtldr";
    panel.append(h("div", { class: "tldrhead" },
      h("b", {}, T("tldr.head")),
      h("span", { class: "tldrmeta" }, `${summary.provider} · ${summary.model} · ${summary.latency_ms} ms`)),
      h("ul", {}, summary.selected.map((claim) => h("li", {},
        h("span", {}, claim.text), evButtons(claim.evidence || [])))));
  }

  async function loadVerifiedTldr(localAnswer, sequence) {
    const panel = $("llmTldr");
    if (!panel) return;
    panel.hidden = false;
    panel.className = "llmtldr loading";
    panel.replaceChildren(h("div", { class: "tldrhead" }, h("b", {}, T("tldr.loading"))));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5500);
    try {
      const response = await fetch("/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: localAnswer.query }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("backend unavailable");
      const remote = await response.json();
      const localFingerprint = await answerFingerprint(localAnswer);
      if (sequence !== askSequence) return;
      if (remote.engine_commit !== B.meta.engine_commit || remote.answer_fingerprint !== localFingerprint) {
        throw new Error("engine fingerprint mismatch");
      }
      renderTldr(panel, remote.summary);
    } catch (_error) {
      if (sequence !== askSequence) return;
      renderTldr(panel, null);
    } finally {
      clearTimeout(timer);
    }
  }


  const HELPFOR = { cause_effect: "interlock", permissives: "permissive", lesson: "opl", chain: "failure_chain" };
  function renderSection(sec) {
    const verbatimAll = sec.items.length && sec.items.every((i) => i.verbatim);
    const head = h("div", { class: "sech" }, h("h3", { class: "h3" }, sec.title, HELPFOR[sec.kind] ? helpTerm(HELPFOR[sec.kind]) : null),
      verbatimAll ? h("span", { class: "vb", title: T("sec.verbatim_tip") }, T("sec.verbatim")) : null,
      verbatimAll ? helpTerm("verbatim") : null,
      sec.note ? h("div", { class: "secnote" }, sec.note) : null);
    let body;
    if (sec.kind === "steps") {
      body = h("div", { class: "tablewrap" }, h("table", { class: "steps" },
        h("thead", {}, h("tr", {}, h("th", {}, T("steps.num")), h("th", {}, T("steps.action")), h("th", {}, T("steps.check")), h("th", {}, h("span", { class: "sr" }, T("steps.evidence"))))),
        h("tbody", {}, sec.items.map((it) => {
          const m = it.text.match(/^(\d+)\. (.*)$/);
          return h("tr", {}, h("td", { class: "n" }, m ? m[1] : ""), h("td", {}, m ? m[2] : it.text), h("td", { class: "chk" }, it.check), h("td", {}, evButtons(it.evidence)));
        }))));
    } else if (sec.kind === "chain") {
      body = h("div", {}, sec.items.map((it) => {
        const m = it.text.match(/^(\d{4}-\d{2}-\d{2}) . (WO-\d+) . (.*)$/);
        if (m) {
          const loc = /hexane leak|leak observed/i.test(m[3]);
          return h("div", { class: "evt" + (loc ? " loc" : "") }, h("span", { class: "d" }, m[1]),
            h("span", {}, h("span", { class: "w" }, m[2] + "  "), m[3]), evButtons(it.evidence));
        }
        return h("div", { class: "it", style: "padding:4px 0;color:var(--ink-2)" }, h("span", { class: "tx" }, it.text), evButtons(it.evidence));
      }));
    } else {
      body = h("ul", { class: "items" }, sec.items.map((it) => {
        const isCE = /^(\s*. )?[A-Z]\d+ . |^\s*. EFF/.test(it.text);
        const cls = "tx" + (isCE ? " ce" + (/^\s*(.|→)\s*EFF/.test(it.text) ? " eff" : "") : "") + (sec.kind === "refusal" ? " quote" : "");
        return h("li", { class: "it" }, h("span", { class: cls }, it.text.replace(/^\s+/, "")), it.evidence.length ? evButtons(it.evidence) : null);
      }));
    }
    return h("section", { class: "sec" }, head, body);
  }

  /* next actions for answers that stop short, so no state is a dead end */
  function nextSteps(a) {
    const acts = [];
    if (a.status === "needs_clarification") {
      acts.push(h("button", { class: "btn sec", type: "button", onclick: () => editQuestion() }, T("answer.edit_question")));
      for (const x of a.indexed_assets || []) {
        acts.push(h("button", { class: "chip", type: "button", "aria-label": T("answer.use_tag_aria", { tag: x.tag }),
          onclick: () => editQuestion(x.tag) }, T("answer.use_tag", { tag: x.tag })));
      }
    } else if (a.status === "abstained") {
      const near = nearestTopics(a);
      if (near.length) {
        acts.push(h("span", { class: "label" }, T("answer.nearest")),
          ...near.map((o) => h("button", { class: "chip", type: "button", onclick: () => ask(o.q) }, o.q)));
      }
      acts.push(h("button", { class: "btn sec", type: "button", onclick: () => go("#docs") }, T("answer.browse_docs")),
        h("button", { class: "btn ghost", type: "button", onclick: () => resetAsk() }, T("ask.again")));
    }
    return acts.length ? h("div", { class: "nextsteps" }, h("span", { class: "label" }, T("answer.next")), ...acts) : null;
  }

  function renderAnswer(a, asked) {
    const box = $("answer");
    box.replaceChildren();

    box.append(h("div", { class: "qbar" }, h("div", { class: "ansq" }, h("span", { class: "sr" }, T("ask.your_question") + " "), h("b", {}, asked || a.query),
      asked && asked !== a.query ? h("span", { class: "askedas" }, T("ask.asked_as", { q: a.query })) : null), backToAsk()));

    /* safety tier: banner above everything, escalation never collapsed */
    if (a.safety_critical || a.escalation) {
      const crit = a.safety_critical || a.status === "refused_deviation" || a.status === "abstained";
      box.append(h("div", { class: "safety" + (crit ? "" : " warn") }, ico("warn"),
        h("div", {},
          a.safety_critical ? h("b", {}, T("answer.safety_critical", { flags: a.safety_flags.join(" - ") })) : h("b", {}, T("answer.escalation_required")),
          a.escalation ? h("div", { class: "esc" }, h("strong", {}, T("answer.escalate_to")), a.escalation.role, helpTerm("escalation")) : null,
          a.escalation ? h("div", { class: "escwhy" }, a.escalation.why) : null)));
    }

    /* lead: status (icon + text + plain meaning), then the engine's one-line answer */
    const lead = h("section", { class: "lead decision st-" + a.status },
      h("div", { class: "leadtop" }, statusPill(a.status),
        a.status === "refused_deviation" ? helpTerm("moc") : a.status === "abstained" ? helpTerm("abstain") : null,
        a.asset ? h("a", { class: "tag", href: "#asset/" + a.asset.tag, title: a.asset.name || "" }, a.asset.tag) : null,
        h("span", { class: "meta" }, intentLabel(a.intent) + " · " + T("answer.latency", { ms: a.latency_ms }))),
      h("div", { class: "headline" }, a.headline),
      hasT("statusx." + a.status) ? h("p", { class: "statusx" }, T("statusx." + a.status)) : null);
    if (a.reason) lead.append(h("div", { class: "reason" }, a.reason));
    if (a.asset_resolution && a.status !== "needs_clarification") {
      /* English-only output: a quoted match ('<user words>' -> TAG) would echo the question's own
         wording (possibly Indonesian), so it is stated in fixed English instead */
      const quoted = /^'.*' -> ([A-Z0-9-]+)$/.exec(a.asset_resolution);
      lead.append(h("div", { class: "reason small" }, quoted
        ? T("answer.asset_named", { tag: quoted[1], name: a.asset && a.asset.name ? " (" + a.asset.name.toLowerCase() + ")" : "" })
        : T("answer.asset", { v: a.asset_resolution })));
    }
    if (a.indexed_assets) lead.append(h("div", { class: "reason" }, T("answer.indexed", { list: a.indexed_assets.map((x) => `${x.tag} (${x.name.toLowerCase()})`).join(", ") })));
    const next = nextSteps(a);
    if (next) lead.append(next);
    box.append(lead);

    box.append(h("section", { id: "llmTldr", class: "llmtldr", hidden: true, "aria-live": "polite" }));


    /* Confidence in plain words first; the computed methodology stays one click away. */
    if (a.confidence) {
      const c = a.confidence, v = a.verification;
      const passed = v.verbatim.passed + v.grounding.passed;
      const checked = v.verbatim.checked + v.grounding.checked;
      if ((a.status === "answered" || a.status === "sources_only") && hasT("conf.plain." + c.band)) {
        box.append(h("p", { class: "confplain" }, h("span", {},
          T("conf.plain." + c.band) + " " + T("conf.plain_checks", { score: c.score, passed, checked, withheld: v.removed.length })),
          helpTerm("confidence")));
      }
      box.append(h("details", { class: "trustdisc" },
        h("summary", {}, h("span", {}, T("conf.summary", { score: c.score, passed, checked, withheld: v.removed.length })), h("span", { class: "trustmore" }, T("conf.more"))),
        h("div", { class: "trust" },
          h("div", {}, h("div", { class: "label" }, T("conf.label")),
            h("div", { class: "score" }, h("strong", {}, c.score), h("span", {}, "/100  " + c.band)),
            h("div", { class: "meter", role: "img", "aria-label": T("conf.meter_aria", { score: c.score }) }, h("i", { style: `width:${c.score}%` })),
            h("div", { class: "factors" }, c.factors.map((f) => h("div", { class: "factor", title: f.note },
              h("span", {}, `${f.name} x${f.weight}`), h("span", { class: "bar" }, h("i", { style: `width:${f.value * 100}%` })), h("span", { class: "v" }, f.value.toFixed(2))))),
            c.caps.length ? h("ul", { class: "caps" }, c.caps.map((x) => h("li", {}, h("span", {}, x)))) : null),
          h("div", {}, h("div", { class: "label" }, T("conf.gates")),
            h("div", { class: "vgrid" },
              h("b", {}, `${v.verbatim.passed}/${v.verbatim.checked}`), h("span", {}, T("conf.gate_verbatim")),
              h("b", {}, `${v.grounding.passed}/${v.grounding.checked}`), h("span", {}, T("conf.gate_grounding")),
              h("b", {}, String(v.removed.length)), h("span", {}, T("conf.gate_withheld"))),
            h("div", { class: "retr" }, T("conf.retrieval", { mode: a.retrieval.mode.replace(/\+/g, " + ") }))))));
    }

    /* related asset: photo (or glyph) + identity, always labelled */
    let relatedAsset = null;
    if (a.asset) {
      const vis = assetVisual((a.asset.name || ""), "thumb");
      relatedAsset = h("div", { class: "card relasset" }, vis.node,
        h("div", {}, h("div", { class: "label" }, T("related.label")),
          h("h4", {}, a.asset.tag),
          h("div", { class: "eqn" }, (a.asset.name || "").toLowerCase()),
          vis.cap,
          h("button", { class: "btn ghost", type: "button", style: "margin-top:6px;padding:0",
            onclick: () => go("#asset/" + a.asset.tag) }, T("related.view"))));
    }

    /* refusal: full, verbatim, above everything else */
    const nv = a.sections.filter((x) => x.kind === "not_verified");
    const refusal = a.sections.filter((x) => x.kind === "refusal");
    for (const r of refusal) box.append(h("div", { class: "card pad refusalcard" }, renderSection(r)));

    /* scannable modules (design 05 §8): Not verified (never truncated), Steps, Limits and
       interlocks, History, Related findings, Evidence; each shows <=5 items + "Show all" */
    const MODS = [["steps", ["steps", "safety", "troubleshooting"]], ["limits", ["parameter", "cause_effect", "permissives"]], ["history", ["chain", "history", "lesson"]]];
    const modOf = (kind) => (MODS.find(([, kinds]) => kinds.includes(kind)) || ["other"])[0];
    const rest = a.sections.filter((x) => x.kind !== "not_verified" && x.kind !== "refusal");
    const groups = new Map();
    for (const sec of rest) { const m = modOf(sec.kind); (groups.get(m) || groups.set(m, []).get(m)).push(sec); }
    const modules = [];
    for (const n of nv) modules.push(moduleCard("nv", n.title, n.items.length, [h("ul", { class: "nvlist" }, n.items.map((i) => h("li", {}, i.text)))], false, "warn"));
    for (const m of ["steps", "limits", "history", "other"].filter((x) => groups.has(x))) {
      const secs = groups.get(m);
      modules.push(moduleCard(m, T("mod." + m), secs.reduce((n, s) => n + s.items.length, 0), secs.map(renderSection), true));
    }
    if (a.evidence.length) modules.push(moduleCard("evidence", T("mod.evidence"), a.evidence.length, [renderEvidenceList(a)], true));
    if (!modules.length) { if (relatedAsset) box.append(relatedAsset); return; }

    const panel = h("div", { id: "apanel", class: "modules" }, ...modules);
    if (modules.length > 1) {
      const strip = h("div", { class: "atabs", role: "group", "aria-label": T("mod.filter_aria") });
      const show = (id) => {
        modules.forEach((m) => { m.hidden = id !== "all" && m.dataset.module !== id; });
        [...strip.children].forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.tab === id)));
      };
      strip.append(h("button", { type: "button", "aria-pressed": "true", "data-tab": "all", onclick: () => show("all") }, T("mod.all")),
        ...modules.map((m) => h("button", { type: "button", "aria-pressed": "false", "data-tab": m.dataset.module, onclick: () => show(m.dataset.module) },
          T("mod.count", { label: m.dataset.short, n: m.dataset.count }))));
      box.append(strip);
    }
    box.append(panel);
    if (relatedAsset) box.append(relatedAsset);
  }

  /* module card: title bar (label + count) + body (<=5 items) + optional "Show all" footer */
  function moduleCard(id, label, count, body, truncate, tone) {
    const card = h("section", { class: "module mod-" + id + (tone ? " tone-" + tone : ""), "data-module": id, "data-count": String(count),
      "data-short": id === "nv" ? T("mod.nv") : label, "aria-label": label },
      h("div", { class: "modhead" }, tone ? ico("warn", 2, 15) : null, h("h3", { class: "label modtitle" }, label), h("span", { class: "modcount" }, String(count))),
      h("div", { class: "modbody" }, ...body));
    if (truncate) {
      const rows = [...card.querySelectorAll(".modbody .items > li, .modbody tbody > tr, .modbody .evt, .modbody .sec > div > .it")];
      if (rows.length > 5) {
        rows.slice(5).forEach((el) => el.classList.add("is-more"));
        const btn = h("button", { class: "btn ghost modmore", type: "button", "aria-expanded": "false" }, T("mod.show_all", { n: rows.length }));
        btn.addEventListener("click", () => {
          const open = card.classList.toggle("expanded");
          btn.setAttribute("aria-expanded", String(open));
          btn.textContent = open ? T("mod.show_less") : T("mod.show_all", { n: rows.length });
        });
        card.append(h("div", { class: "modfoot" }, btn));
      }
    }
    return card;
  }

  function renderEvidenceList(a) {
    return h("div", { class: "sec" }, h("ul", { class: "items" }, a.evidence.map((e) => h("li", { class: "it" },
      h("span", { class: "tx" }, h("span", { class: "mono" }, e.eid), " - ", e.label,
        h("div", { class: "small" }, srcType(e.kind) + " - " + e.locator)),
      evButtons([e.eid])))));
  }

  /* ----------------------------------------------------- evidence rail */
  function coreOf(text) {
    return ws(text.replace(/^\d+\. /, "").replace(/^(Symptom|Likely cause|Action taken|Document caveat): /, "")
      .replace(/^\s*.\s*EFF-\d+:\s*/, "").replace(/ . [A-Z]{2,4}-?\d*.*$/, "").split(" . ").slice(-4).join(" "));
  }
  function sourceBody(e, cited) {
    const src = h("div", { class: "src", tabindex: "0", "aria-label": T("src.aria") });
    let firstHit = null;
    const page = B.page_text[e.doc];
    if (page) {
      const needles = cited.map((i) => coreOf(i.text).toLowerCase().slice(0, 34)).filter((n) => n.length > 6);
      if (e.kind === "DATASHEET") { const f = (e.locator.match(/'(.+)'/) || [])[1]; if (f) needles.push(f.toLowerCase()); }
      const pre = h("pre", {});
      for (const line of page.split("\n")) {
        const L = ws(line).toLowerCase();
        const hit = needles.some((n) => L.includes(n) || (n.length > 20 && L.includes(n.slice(0, 20))));
        const span = h("span", { class: hit ? "hit" : null }, line || " ");
        if (hit && !firstHit) firstHit = span;
        pre.append(span);
      }
      src.append(h("div", { class: "label", style: "padding:0 15px 6px" }, T("src.page_text")), pre);
    } else if (e.kind === "WORK_ORDER") {
      const r = RECS.get(e.doc);
      if (r) src.append(h("div", { class: "label", style: "padding:0 15px 6px" }, T("src.wo")),
        h("dl", { class: "kv", style: "border:0" }, [[T("wo.equipment"), `${r.tag} - ${r.equipment}`], [T("wo.work_type"), r.work_type], [T("wo.problem"), r.problem],
          [T("wo.root_cause"), r.root_cause], [T("wo.action"), r.action], [T("wo.interlock"), r.related_interlock && r.related_interlock !== "nan" ? r.related_interlock : "-"]]
          .map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
    } else if (e.kind === "CHAIN") {
      const ch = B.chains.find((c) => c.chain_id === e.doc);
      if (ch) src.append(h("div", { class: "label", style: "padding:0 15px 6px" }, T("src.chain_why")),
        h("ul", { class: "items", style: "padding:0 15px" }, ch.links.map((l) => h("li", {},
          h("span", { class: "mono" }, `${l.frm} -> ${l.to}`), h("br"),
          h("span", { class: "small" }, T("src.chain_link", { rationale: l.rationale, score: l.score, mechanism: l.factors.mechanism, component: l.factors.component,
            lexical: l.factors.lexical, recurrence: l.factors.recurrence_cue, temporal: l.factors.temporal, gap: l.factors.gap_days }))))));
    }
    return { src, firstHit };
  }
  function openEvidenceSheet() {
    if (innerWidth > 1080) return;
    closeMobileNav(false);
    const rail = $("rail"), scrim = $("evidenceScrim");
    rail.classList.add("sheet-open");
    rail.setAttribute("role", "dialog");
    rail.setAttribute("aria-modal", "true");
    scrim.hidden = false;
    const close = rail.querySelector(".railclose");
    if (close) close.focus();
  }
  function closeEvidenceSheet(returnFocus = true) {
    const rail = $("rail"), scrim = $("evidenceScrim");
    if (!rail) return;
    const wasOpen = rail.classList.contains("sheet-open");
    rail.classList.remove("sheet-open");
    rail.removeAttribute("aria-modal");
    rail.setAttribute("role", "complementary");
    if (scrim) scrim.hidden = true;
    if (wasOpen && returnFocus && evidenceTrigger && evidenceTrigger.focus) evidenceTrigger.focus();
    if (wasOpen) evidenceTrigger = null;
  }
  function initEvidenceSheet() {
    const rail = $("rail"), scrim = $("evidenceScrim");
    scrim.addEventListener("click", () => closeEvidenceSheet());
    rail.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || !rail.classList.contains("sheet-open")) return;
      const items = [...rail.querySelectorAll('button:not([disabled]),a[href],[tabindex="0"]')];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  function selectEvidence(eid, reveal = false) {
    selectedEid = eid;
    document.querySelectorAll("#answer .ev").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.eid === eid)));
    const rail = $("rail");
    rail.replaceChildren();
    if (!eid || !current) { rail.append(h("div", { class: "railempty" }, T("rail.none"))); return; }
    const e = current.evidence.find((x) => x.eid === eid);
    if (!e) return;
    const cited = current.sections.flatMap((x) => x.items).filter((i) => i.evidence.includes(eid));
    rail.append(h("div", { class: "railh" }, h("div", { class: "railheadrow" },
      h("div", {}, h("div", { class: "label" }, TN("rail.cited", cited.length, { eid: e.eid, type: srcType(e.kind) })),
        h("h3", {}, e.label)),
      h("button", { class: "btn ghost railclose", type: "button", "aria-label": T("rail.close"), onclick: () => closeEvidenceSheet() }, ico("x", 1.8, 18)))));
    const kv = [[T("kv.locator"), e.locator]];
    const m = e.meta || {};
    if (m.classification) kv.push([T("kv.opl_type"), m.classification]);
    if (m.date_shared) kv.push([T("kv.shared"), fmtDate(m.date_shared)]);
    if (m.reviewed_by) kv.push([T("kv.reviewed_by"), m.reviewed_by]);
    if (m.approved_by) kv.push([T("kv.approved_by"), m.approved_by]);
    if (m.revision) kv.push([T("kv.revision"), T("kv.rev", { r: m.revision })]);
    if (m.sil) kv.push([T("kv.sil"), m.sil]);
    if (m.related_interlock) kv.push([T("kv.interlock"), m.related_interlock]);
    if (m.pid_ref) kv.push([T("kv.pid"), m.pid_ref]);
    if (m.date) kv.push([T("kv.reported"), fmtDate(m.date)]);
    if (m.downtime_h !== undefined && m.downtime_h !== null) kv.push([T("kv.downtime"), hrs(m.downtime_h)]);
    if (m.cost_idr) kv.push([T("kv.cost"), rp(m.cost_idr)]);
    if (m.confidence !== undefined && e.kind === "CHAIN") kv.push([T("kv.chain_score"), String(m.confidence)]);
    if (e.source_path) kv.push([T("kv.source_file"), e.source_path]);
    rail.append(h("dl", { class: "kv" }, kv.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
    const { src, firstHit } = sourceBody(e, cited);
    rail.append(src);
    if (firstHit) requestAnimationFrame(() => { src.scrollTop = Math.max(0, firstHit.offsetTop - 40); });
    if (reveal && innerWidth <= 1080) openEvidenceSheet();
  }

  /* --------------------------------------------------------- chain index */
  function renderChainIndex() {
    const C = B.chains;
    const lat = C.map((c) => c.lesson_latency_days);
    $("chainsIntro").textContent = T("chains.intro", { all: ALL.length, assets: new Set(ALL.map((c) => c.tag)).size, pilot: C.length, min: Math.min(...lat), max: Math.max(...lat) });
    $("chainsH").append(helpTerm("lesson_latency"));

    const lg = $("tlLegend");
    const mk = (el, text) => { const sv = s("svg", { width: 22, height: 14, "aria-hidden": "true" }); sv.append(el); return h("span", {}, sv, text); };
    lg.append(mk(s("circle", { cx: 11, cy: 7, r: 4.5, fill: "var(--ink-2)" }), T("chains.lg_failure")),
      mk(s("circle", { cx: 11, cy: 7, r: 4.5, fill: "var(--crit)" }), T("common.loc")),
      mk(s("circle", { cx: 11, cy: 7, r: 5, fill: "none", stroke: "var(--cyan-mark)", "stroke-width": 2.5 }), T("chains.lg_detectable")),
      mk(s("rect", { x: 6, y: 2, width: 10, height: 10, fill: "var(--ok)" }), T("chains.lg_opl")),
      mk(s("rect", { x: 1, y: 3, width: 20, height: 8, rx: 2, fill: "var(--warn-tint)", stroke: "var(--warn-mark)" }), T("chains.lg_gap")));

    const W = 1000, left = 190, right = 30, top = 34, rowH = 96, H = top + rowH * C.length + 10;
    const t0 = Date.parse("2024-08-01"), t1 = Date.parse("2026-07-01");
    const X = (d) => left + (Date.parse(d) - t0) / (t1 - t0) * (W - left - right);
    const svg = $("timeline");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W);
    svg.style.maxWidth = "100%"; svg.style.minWidth = "760px"; svg.style.height = "auto";
    svg.replaceChildren();
    for (const d of ["2024-10-01", "2025-01-01", "2025-04-01", "2025-07-01", "2025-10-01", "2026-01-01", "2026-04-01", "2026-07-01"]) {
      const x = X(d);
      svg.append(s("line", { x1: x, x2: x, y1: top - 6, y2: H - 10, stroke: "var(--line)", "stroke-width": 1 }));
      const dt = new Date(d);
      svg.append(s("text", { x, y: top - 14, "text-anchor": "middle", "font-size": 12, style: "fill:var(--ink-muted)" },
        dt.toLocaleDateString(T("fmt.date_locale"), { month: "short", timeZone: "UTC" }) + (dt.getUTCMonth() === 0 ? " " + dt.getUTCFullYear() : "")));
    }
    C.forEach((c, i) => {
      const y = top + i * rowH + rowH / 2;
      const opl = (c.knowledge_links || []).filter((k) => k.date_shared).sort((a, b) => a.date_shared < b.date_shared ? -1 : 1)[0];
      svg.append(s("text", { x: 0, y: y - 8, "font-size": 14, "font-weight": 600, style: "fill:var(--ink)" }, c.tag),
        s("text", { x: 0, y: y + 10, "font-size": 12.5 }, T("chains.row_sub", { mech: title(c.root_mechanism), n: c.n_events })),
        s("text", { x: 0, y: y + 26, "font-size": 11.5, style: "fill:var(--ink-muted);font-family:var(--f-mono)" }, c.chain_id));
      if (opl) {
        const xa = X(c.first_seen), xb = X(opl.date_shared);
        svg.append(s("rect", { x: xa, y: y - 13, width: xb - xa, height: 26, rx: 4, fill: "var(--warn-tint)", stroke: "var(--warn-mark)", "stroke-width": 1 }));
        const xl = (X(c.last_seen) + xb) / 2;
        svg.append(s("text", { x: xl, y: y - 20, "text-anchor": "middle", "font-size": 12.5, "font-weight": 600, style: "fill:var(--warn-ink)" },
          T("chains.until_opl", { n: c.lesson_latency_days })));
        const sq = s("rect", { x: xb - 6, y: y - 6, width: 12, height: 12, fill: "var(--ok)", stroke: "var(--surface)", "stroke-width": 2 });
        svg.append(sq, s("text", { x: xb, y: y + 26, "text-anchor": "middle", "font-size": 11.5, style: "font-family:var(--f-mono)" }, opl.opl_no));
        hover(sq, `<b>${esc(opl.opl_no)}</b><br>${esc(opl.title)}<br>${esc(T("chains.opl_tip", { classification: opl.classification, date: fmtDate(opl.date_shared) }))}<br>${opl.relation.replace(/_/g, " ")}`);
      }
      svg.append(s("line", { x1: X(c.first_seen), x2: X(c.last_seen), y1: y, y2: y, stroke: "var(--ink-2)", "stroke-width": 2, "stroke-linecap": "round" }));
      const xd = X(c.detectable_on);
      const dm = s("circle", { cx: xd, cy: y, r: 9, fill: "none", stroke: "var(--cyan-mark)", "stroke-width": 2.5 });
      svg.append(dm, s("text", { x: xd, y: y + 26, "text-anchor": "middle", "font-size": 11.5, style: "fill:var(--cyan-ink)" }, T("chains.detectable")));
      hover(dm, `<b>${esc(T("chains.detectable_tip", { date: fmtDate(c.detectable_on) }))}</b><br>${esc(T("chains.second_wo"))}`);
      for (const e of c.events) {
        const loc = /hexane leak/i.test(e.problem);
        const dot = s("circle", { cx: X(e.date.slice(0, 10)), cy: y, r: 5, fill: loc ? "var(--crit)" : "var(--ink-2)", stroke: "var(--warn-tint)", "stroke-width": 2 });
        const hit = s("circle", { cx: X(e.date.slice(0, 10)), cy: y, r: 12, fill: "transparent" });
        svg.append(dot, hit);
        hover(hit, `<b>${esc(e.wo)}</b> - ${fmtDate(e.date.slice(0, 10))}<br>${esc(e.problem)}<br><i>${esc(T("chains.root_cause_tip"))}</i> ${esc(e.root_cause)}` + (e.downtime_h ? `<br>${esc(T("chains.down", { h: hrs(e.downtime_h) }))}` : ""));
        if (loc) svg.append(s("text", { x: X(e.date.slice(0, 10)) - 12, y: y - 20, "text-anchor": "end", "font-size": 12, "font-weight": 600, style: "fill:var(--crit-ink)" }, T("chains.hexane_leak")));
      }
    });
    /* table view for the timeline */
    $("tlTable").append(h("thead", {}, h("tr", {}, ["chains.th_chain", "chains.th_asset", "chains.th_mech", "chains.th_first", "chains.th_last", "chains.th_opl", "chains.th_latency"].map((k, i) => T(k)).map((t, i) => h("th", { class: i >= 6 ? "r" : null }, t)))),
      h("tbody", {}, C.map((c) => {
        const opl = (c.knowledge_links || []).filter((k) => k.date_shared).sort((a, b) => a.date_shared < b.date_shared ? -1 : 1)[0];
        return h("tr", {}, h("td", { class: "mono" }, c.chain_id), h("td", { class: "mono" }, c.tag), h("td", {}, title(c.root_mechanism)),
          h("td", {}, fmtDate(c.first_seen)), h("td", {}, fmtDate(c.last_seen)), h("td", { class: "mono" }, opl ? opl.opl_no : "-"),
          h("td", { class: "r" }, T("common.d", { n: c.lesson_latency_days })));
      })));
    /* <=430 px: one card per chain instead of a table that needs sideways panning */
    $("tlTable").closest(".tablewrap").after(h("ul", { class: "chaincards", "aria-label": T("chains.cards_aria") }, C.map((c) => {
      const opl = (c.knowledge_links || []).filter((k) => k.date_shared).sort((a, b) => a.date_shared < b.date_shared ? -1 : 1)[0];
      return h("li", {}, h("a", { class: "chaincard", href: "#chain/" + c.chain_id },
        h("span", { class: "cctop" }, h("span", { class: "mono cctag" }, c.tag),
          h("span", { class: "mech " + (c.root_mechanism === "FOULING" ? "f" : "m") }, title(c.root_mechanism)),
          c.loss_of_containment ? h("span", { class: "pill loc" }, ico("warn", 2, 14), T("common.loc")) : null),
        h("span", { class: "cclat" }, T("chains.until_opl", { n: c.lesson_latency_days })),
        h("span", { class: "cckv" },
          h("span", {}, h("span", { class: "k" }, T("chains.th_first")), h("span", { class: "v" }, fmtDate(c.first_seen))),
          h("span", {}, h("span", { class: "k" }, T("chains.th_last")), h("span", { class: "v" }, fmtDate(c.last_seen))),
          h("span", {}, h("span", { class: "k" }, T("chains.th_opl")), h("span", { class: "v mono" }, opl ? opl.opl_no : "-")),
          h("span", {}, h("span", { class: "k" }, T("chains.th_chain")), h("span", { class: "v mono" }, c.chain_id))),
        ico("arrow", 1.8, 18)));
    })));

    /* all chains: filterable, sortable table (cards on phones) */
    const list = $("chainList");
    const fAsset = h("select", { id: "chainFilterAsset" },
      h("option", { value: "" }, T("chains.filter_all_assets")), ...[...new Set(ALL.map((c) => c.tag))].sort().map((t) => h("option", { value: t }, t)));
    const fStatus = h("select", { id: "chainFilterStatus" },
      h("option", { value: "" }, T("chains.filter_all")), h("option", { value: "loc" }, T("chains.f_loc")),
      h("option", { value: "pilot" }, T("chains.f_pilot")), h("option", { value: "wo" }, T("chains.f_wo")));
    const count = h("span", { class: "dtcount", role: "status" });
    const emptyState = h("div", { class: "empty", hidden: true }, ico("info"), h("span", {}, T("chains.none")),
      h("button", { class: "btn ghost", type: "button", onclick: () => { fAsset.value = ""; fStatus.value = ""; apply(); } }, T("chains.reset")));
    const opts = {
      id: "chainTable", label: T("nav.chains"), initial: { key: "status", dir: -1 }, rows: ALL,
      href: (c) => "#chain/" + c.chain_id,
      cardTitle: (c) => [h("span", { class: "mono" }, c.chain_id), " ", h("span", { class: "lkname" }, title(c.root_mechanism))],
      cardBadge: (c) => chainStatus(c), cardFields: ["asset", "wos", "recur"],
      cols: [
        { key: "status", label: T("chains.th_status"), sort: (c) => (c.loss_of_containment ? 1 : 0), cell: (c) => chainStatus(c), noCard: true },
        { key: "id", label: T("chains.th_chain"), sort: (c) => c.chain_id, cell: (c) => h("a", { class: "mono rowlink", href: "#chain/" + c.chain_id }, c.chain_id), noCard: true },
        { key: "asset", label: T("chains.th_asset"), sort: (c) => c.tag, cell: (c) => h("span", { class: "mono" }, c.tag) },
        { key: "title", label: T("chains.th_title"), sort: (c) => c.root_mechanism, cell: (c) => h("span", { class: "mech " + (c.root_mechanism === "FOULING" ? "f" : "m") }, title(c.root_mechanism)), noCard: true },
        { key: "wos", label: T("chains.th_wos"), num: true, sort: (c) => c.n_events, cell: (c) => String(c.n_events) },
        { key: "recur", label: T("chains.th_recur"), sort: (c) => c.span_days, cell: (c) => h("span", { class: "recur" }, T("chains.recur", { n: c.n_events, d: c.span_days }),
          h("span", { class: "cardnote recurdates" }, `${fmtDate(c.first_seen)} → ${fmtDate(c.last_seen)}`)) },
        { key: "downtime", label: T("assets.th_downtime"), num: true, pri: 2, sort: (c) => c.total_downtime_h, cell: (c) => hrs(c.total_downtime_h) },
        { key: "cost", label: T("assets.th_cost"), num: true, pri: 3, sort: (c) => c.total_cost_idr, cell: (c) => rpJt(c.total_cost_idr) },
        { key: "latency", label: T("chains.th_latency"), num: true, pri: 2, sort: (c) => (c.pilot ? c.lesson_latency_days : -1),
          cell: (c) => (c.pilot ? T("common.d", { n: c.lesson_latency_days }) : "-") },
      ],
    };
    const tbl = dataTable(opts);
    function apply() {
      const rows = ALL.filter((c) => (!fAsset.value || c.tag === fAsset.value)
        && (!fStatus.value || (fStatus.value === "loc" ? c.loss_of_containment : fStatus.value === "pilot" ? c.pilot : !c.pilot)));
      opts.rerender(rows);
      count.textContent = T("chains.showing", { n: rows.length, total: ALL.length });
      emptyState.hidden = rows.length > 0;
      tbl.hidden = rows.length === 0;
    }
    fAsset.addEventListener("change", apply);
    fStatus.addEventListener("change", apply);
    list.replaceChildren(h("div", { class: "modhead" }, h("h3", { class: "label modtitle" }, T("chains.all", { n: ALL.length })), count),
      h("div", { class: "filters" },
        h("label", {}, h("span", { class: "label" }, T("chains.filter_asset")), fAsset),
        h("label", {}, h("span", { class: "label" }, T("chains.filter_status")), fStatus)),
      emptyState, tbl);
    apply();
  }

  /* ---------------------------------------------------- chain hero */
  function renderChainDetail(id) {
    const c = resolveChain(id);
    if (!c) return false;
    const v = $("view-chain");
    v.replaceChildren();
    v.append(crumbs([[T("nav.ask"), "#ask"], [T("nav.chains"), "#chains"], [c.tag, "#asset/" + c.tag], [T("crumb.chain", { id: c.chain_id })]]));

    /* header: status first */
    v.append(h("div", { class: "mechband" },
      h("h2", {}, c.root_mechanism === "FOULING" ? T("mech.fouling") : title(c.root_mechanism)),
      h("div", { class: "meta" }, T("chain.meta", { id: c.chain_id, tag: c.tag, equipment: c.equipment.toLowerCase(), from: fmtDate(c.first_seen), to: fmtDate(c.last_seen) })),
      h("div", { class: "badges" }, chainStatus(c), coverageBadge(c.tag))));

    /* summary module: KPIs + analysis fields + actions */
    const opl = c.pilot ? (c.knowledge_links || []).filter((k) => k.date_shared).sort((a, b) => a.date_shared < b.date_shared ? -1 : 1)[0] : null;
    const nums = h("div", { class: "nums" },
      h("div", {}, h("b", {}, c.n_events), h("span", {}, T("chain.n_linked"))),
      h("div", {}, h("b", {}, T("common.d", { n: c.span_days })), h("span", {}, T("chain.n_span"))),
      h("div", {}, h("b", {}, hrs(c.total_downtime_h)), h("span", {}, T("chain.n_downtime"))),
      h("div", {}, h("b", {}, rpJt(c.total_cost_idr)), h("span", {}, T("chain.n_cost"))));
    if (c.pilot) nums.append(h("div", { class: "w" }, h("b", {}, T("common.d", { n: c.lesson_latency_days })), h("span", {}, T("chain.n_latency"))));
    v.append(h("section", { class: "module chainsummary", "aria-label": T("chain.summary_h") },
      h("div", { class: "modhead" }, h("h3", { class: "label modtitle" }, T("chain.summary_h")), helpTerm("failure_chain")),
      h("div", { class: "modbody" }, nums,
        h("p", { class: "cardnote" }, T("chain.summary", { n: c.n_events, tag: c.tag, mech: title(c.root_mechanism), d: c.span_days })),
        h("dl", { class: "lkfields" },
          h("div", {}, h("dt", {}, T("chain.score_label")), h("dd", {}, String(c.confidence))),
          h("div", {}, h("dt", {}, c.pilot ? T("chain.detectable_from") : T("chain.detect_na")), h("dd", {}, c.pilot ? fmtDate(c.detectable_on) : "-")))),
      h("div", { class: "modfoot chainactions" },
        h("button", { class: "btn sec", type: "button", onclick: () => ask(chainQuestion(c)) }, T("chain.ask")),
        h("a", { class: "btn ghost lkopen", href: "#asset/" + c.tag }, T("chain.open_asset", { tag: c.tag })))));

    /* timeline module: one row per work order; the WO chip opens the record in place */
    const linkFor = (fromWo, toWo) => (c.links || []).find((l) => l.frm === fromWo && l.to === toWo)
      || (c.links || []).find((l) => l.to === toWo);
    const spine = h("ol", { class: "spine tline" });
    c.events.forEach((e, i) => {
      const wo = e.wo, date = (e.date || "").slice(0, 10);
      const loc = /hexane leak|leak observed/i.test(e.problem || "");
      const det = c.pilot && c.detectable_on === date;
      const detail = h("div", { class: "evdet", hidden: true, id: "rec-" + wo },
        h("div", {}, h("b", {}, T("chain.root_cause")), e.root_cause || "-"),
        e.action ? h("div", {}, h("b", {}, T("chain.action")), e.action) : null,
        h("div", {}, h("b", {}, T("chain.impact")), (e.downtime_h ? hrs(e.downtime_h) : T("common.no_downtime")) + (e.cost_idr ? "  -  " + rp(e.cost_idr) : "")),
        e.components && e.components.length ? h("div", {}, h("b", {}, T("chain.components")), e.components.join(", ")) : null);
      const chip = h("button", { class: "ev wochip", type: "button", "aria-expanded": "false", "aria-controls": "rec-" + wo, "aria-label": T("chain.wo_aria", { wo }),
        onclick: () => { detail.hidden = !detail.hidden; chip.setAttribute("aria-expanded", String(!detail.hidden)); } },
        h("span", { class: "evid" }, wo), " ", h("span", { class: "evtype" }, T("srctype.WORK_ORDER")));
      spine.append(h("li", { class: "ev-node" + (loc ? " loc" : "") + (det ? " det" : "") }, h("div", { class: "evcard" },
        h("div", { class: "evtop" }, h("span", { class: "dt" }, fmtDate(date)), chip,
          e.primary_mode ? h("span", { class: "mech" }, title(e.primary_mode)) : null,
          e.causal_mode ? h("span", { class: "mech f" }, title(e.causal_mode)) : null,
          loc ? h("span", { class: "locflag" }, ico("warn"), T("common.loc")) : null),
        h("p", { class: "evtitle" }, clampText(e.problem)), detail),
        det ? h("div", { class: "detnote" }, T("chain.detnote")) : null));
      if (i < c.events.length - 1) {
        const nxt = c.events[i + 1];
        const l = c.pilot ? linkFor(wo, nxt.wo) : null;
        spine.append(h("li", { class: "linkseg" }, ...(l
          ? [h("div", { class: "linkhead" }, ico("link", 2, 15), T("chain.linked"), h("span", { class: "sc" }, T("chain.score", { s: l.score }))),
            h("p", { class: "linkrat" }, clampText(l.rationale)),
            h("div", { class: "fchips" },
              h("span", { class: "fchip" }, T("chain.f_mechanism", { v: l.factors.mechanism })),
              h("span", { class: "fchip" }, T("chain.f_component", { v: l.factors.component })),
              h("span", { class: "fchip" }, T("chain.f_lexical", { v: l.factors.lexical })),
              h("span", { class: "fchip" }, T("chain.f_recurrence", { v: l.factors.recurrence_cue })),
              h("span", { class: "fchip" }, T("chain.f_temporal", { v: l.factors.temporal })),
              h("span", { class: "fchip" }, T("chain.f_gap", { n: l.factors.gap_days })))]
          : [h("div", { class: "linkhead", style: "color:var(--ink-muted)" }, T("chain.by_detector")),
            h("p", { class: "linkrat", style: "color:var(--ink-muted)" }, T("chain.rationale_pilot"))])));
      }
    });
    const knowledge = h("section", { class: "module", "aria-label": T("chain.related") },
      h("div", { class: "modhead" }, h("h3", { class: "label modtitle" }, T("chain.related")), helpTerm("opl")));
    if (c.pilot && c.knowledge_links && c.knowledge_links.length) {
      knowledge.append(h("div", { class: "modbody" }, h("ul", { class: "lklist lkrecs" }, c.knowledge_links.slice(0, 5).map((k) => h("li", {},
        h("div", { class: "lkrectext" }, h("span", { class: "mono" }, k.opl_no), clampText(k.title),
          h("span", { class: "cardnote" }, T("common.shared_rel", { date: fmtDate(k.date_shared), relation: k.relation.replace(/_/g, " ") }))),
        h("button", { class: "btn sec", type: "button", "aria-label": T("lookup.open_aria", { id: k.opl_no }), onclick: () => openDocument(k.opl_no) }, T("lookup.open")))))));
    } else knowledge.append(h("div", { class: "modbody" }, h("div", { class: "empty" }, ico("info"), h("span", {}, T("common.pilot_only_note")))));
    v.append(h("div", { class: "grid2 chaingrid" },
      h("section", { class: "module", "aria-label": T("chain.timeline_h") },
        h("div", { class: "modhead" }, h("h3", { class: "label modtitle" }, T("chain.timeline_h")), h("span", { class: "modcount" }, String(c.events.length))),
        h("div", { class: "modbody" }, spine)),
      knowledge));

    if (c.pilot) {
      v.append(h("div", { class: "card latency" }, h("div", { class: "latwrap" },
        h("div", { class: "label withhelp" }, T("chain.latency_h"), helpTerm("lesson_latency")),
        latencyStrip(c, opl),
        h("dl", { class: "latencymobile" },
          h("dt", {}, T("chain.first_failure")), h("dd", {}, fmtDate(c.first_seen)),
          h("dt", {}, T("chain.last_failure")), h("dd", {}, fmtDate(c.last_seen)),
          h("dt", {}, T("chain.first_lesson")), h("dd", {}, opl ? `${fmtDate(opl.date_shared)} · ${opl.opl_no}` : T("chain.not_available")),
          h("dt", {}, T("chain.latency")), h("dd", {}, T("common.days", { n: c.lesson_latency_days }))),
        h("p", { class: "latbody" },
          T("chain.latency_body", { opl: opl ? T("chain.latency_opl", { opl: opl.opl_no, date: fmtDate(opl.date_shared) }) : "", n: c.lesson_latency_days,
            after: Math.round((Date.parse(c.first_lesson_shared_on) - Date.parse(c.last_seen)) / 864e5) })))));
    }
    return true;
  }
  function chainQuestion(c) {
    if (c.root_mechanism === "MISALIGNMENT") return "why does the hexane pump keep failing?";
    if (c.loss_of_containment) return "why is the hexane pump leaking?";
    return `why does ${c.tag} keep failing?`;
  }
  function latencyStrip(c, opl) {
    const W = 900, H = 116, L = 20, R = 30;
    const t0 = Date.parse(c.first_seen), t1 = Date.parse(opl ? opl.date_shared : c.last_seen);
    const X = (d) => L + (Date.parse(d) - t0) / Math.max(1, t1 - t0) * (W - L - R);
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": T("chain.latency_aria", { n: c.lesson_latency_days }), style: "width:100%;min-width:560px;height:auto" });
    const y = 44;
    svg.append(s("rect", { x: X(c.first_seen), y: y - 13, width: X(opl ? opl.date_shared : c.last_seen) - X(c.first_seen), height: 26, rx: 4, fill: "var(--warn-tint)", stroke: "var(--warn-mark)" }));
    svg.append(s("line", { x1: X(c.first_seen), x2: X(c.last_seen), y1: y, y2: y, stroke: "var(--ink-2)", "stroke-width": 3, "stroke-linecap": "round" }));
    if (opl) svg.append(s("line", { x1: X(c.last_seen), x2: X(opl.date_shared), y1: y, y2: y, stroke: "var(--warn-mark)", "stroke-width": 2, "stroke-dasharray": "3 5" }));
    for (const e of c.events) {
      const loc = /hexane leak|leak observed/i.test(e.problem || "");
      svg.append(s("circle", { cx: X((e.date || "").slice(0, 10)), cy: y, r: 6, fill: loc ? "var(--crit)" : "var(--navy)", stroke: "var(--surface)", "stroke-width": 2 }));
    }
    if (opl) svg.append(s("rect", { x: X(opl.date_shared) - 7, y: y - 7, width: 14, height: 14, fill: "var(--ok)", stroke: "var(--surface)", "stroke-width": 2 }));
    svg.append(s("text", { x: X(c.first_seen), y: y - 24, "font-size": 12, style: "fill:var(--ink-muted)" }, fmtDate(c.first_seen)));
    svg.append(s("text", { x: X(c.last_seen), y: y + 32, "text-anchor": "middle", "font-size": 12, style: "fill:var(--ink-muted)" }, fmtDate(c.last_seen)));
    if (opl) {
      svg.append(s("text", { x: X(opl.date_shared), y: y - 24, "text-anchor": "end", "font-size": 12, style: "fill:var(--ok-ink)" }, fmtDate(opl.date_shared) + " " + opl.opl_no));
      svg.append(s("text", { x: (X(c.first_seen) + X(opl.date_shared)) / 2, y: y + 56, "text-anchor": "middle", "font-size": 13, "font-weight": 600, style: "fill:var(--warn-ink)" },
        T("common.latency_published", { n: c.lesson_latency_days })));
    }
    return h("div", { class: "chartwrap latency-chart", style: "margin-top:10px" }, svg);
  }

  function syncCompactCharts() {
    document.querySelectorAll("details.chart-table").forEach((details) => {
      if (innerWidth <= 430) {
        if (!details.open) details.dataset.autoOpen = "true";
        details.open = true;
      } else if (details.dataset.autoOpen === "true") {
        details.open = false;
        delete details.dataset.autoOpen;
      }
    });
  }

  /* -------------------------------------------------------- assets */
  /* ---------------------------------------- dashboard helpers (design 05 §5) */
  const badge = (tone, icon, text) => h("span", { class: "pill bd-" + tone }, ico(icon, 2, 14), text);
  function lastEventOf(tag) {
    let best = null;
    for (const r of B.records) if (r.tag === tag && (!best || (r.date || "") > (best.date || ""))) best = r;
    return best ? { date: (best.date || "").slice(0, 10), wo: best.wo } : null;
  }
  function assetStatus(r) {
    const chains = r.chains || [];
    if (chains.some((c) => c.loss_of_containment)) return badge("crit", "warn", T("st.asset_loc"));
    if (chains.length) return badge("warn", "chain", TN("st.asset_chains", chains.length));
    return badge("ok", "ok", T("st.asset_none"));
  }
  const coverageBadge = (tag) => (INDEXED.has(tag) ? badge("info", "doc", T("st.docs")) : badge("muted", "info", T("st.wo_only")));
  const chainStatus = (c) => (c.loss_of_containment ? badge("crit", "warn", T("common.loc")) : badge("warn", "chain", T("st.recurring")));
  /* long text stays in the DOM, clamped to 2 lines behind "Show more" */
  function clampText(text, cls) {
    const span = h("span", { class: "clamp" + (cls ? " " + cls : "") }, text);
    if (!text || text.length <= 110) return span;
    const btn = h("button", { class: "btn ghost clampbtn", type: "button", "aria-expanded": "false" }, T("common.show_more"));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = span.classList.toggle("open");
      btn.setAttribute("aria-expanded", String(open));
      btn.textContent = open ? T("common.show_less") : T("common.show_more");
    });
    return h("span", { class: "clampwrap" }, span, btn);
  }
  /* sortable data table (desktop) + compact cards (phones): one data source, two layouts */
  function dataTable(o) {
    let sortKey = o.initial.key, dir = o.initial.dir;
    const wrap = h("div", { class: "dt" });
    const table = h("table", { class: "data dtable", id: o.id });
    const cards = h("ul", { class: "dtcards", "aria-label": o.label });
    const extra = o.cols.filter((c) => !o.cardFields.includes(c.key) && !c.noCard);
    const render = () => {
      const col = o.cols.find((c) => c.key === sortKey);
      const rows = [...o.rows].sort((x, y) => {
        const a = col.sort(x), b = col.sort(y);
        return (a < b ? -1 : a > b ? 1 : 0) * dir;
      });
      table.replaceChildren(
        h("thead", {}, h("tr", {}, o.cols.map((c) => h("th", { class: (c.num ? "r " : "") + (c.pri ? "pri" + c.pri : ""), scope: "col",
          "aria-sort": c.key === sortKey ? (dir > 0 ? "ascending" : "descending") : "none" },
          c.sort ? h("button", { class: "sortbtn", type: "button", "aria-label": T("dt.sort", { col: c.label }), onclick: () => {
            dir = sortKey === c.key ? -dir : (c.num ? -1 : 1); sortKey = c.key; render(); } }, c.label, h("span", { class: "sortmark", "aria-hidden": "true" },
            c.key === sortKey ? (dir > 0 ? "▲" : "▼") : "")) : c.label)))),
        h("tbody", {}, rows.map((r) => h("tr", { "data-href": o.href ? o.href(r) : null, onclick: (e) => { if (!e.target.closest("a,button")) (o.open ? o.open(r) : go(o.href(r))); } },
          o.cols.map((c) => h("td", { class: (c.num ? "r " : "") + (c.pri ? "pri" + c.pri : "") + (c.cls ? " " + c.cls : "") }, c.cell(r)))))));
      cards.replaceChildren(...rows.map((r) => h("li", { class: "dtcard" },
        h("div", { class: "dtcardhead" }, o.open
          ? h("button", { type: "button", class: "dtcardtitle", "aria-label": o.openLabel ? o.openLabel(r) : null, onclick: () => o.open(r) }, o.cardTitle(r))
          : h("a", { href: o.href(r), class: "dtcardtitle" }, o.cardTitle(r)), o.cardBadge(r)),
        h("dl", { class: "lkfields" }, o.cardFields.map((k) => { const c = o.cols.find((x) => x.key === k); return h("div", {}, h("dt", {}, c.label), h("dd", {}, c.cell(r))); })),
        extra.length ? h("details", { class: "dtmore" }, h("summary", {}, T("dt.more")),
          h("dl", { class: "lkfields" }, extra.map((c) => h("div", {}, h("dt", {}, c.label), h("dd", {}, c.cell(r)))))) : null)));
    };
    o.rerender = (rows) => { if (rows) o.rows = rows; render(); };
    render();
    wrap.append(h("div", { class: "tablewrap dtwrap" }, table), cards);
    return wrap;
  }

  function renderAssets() {
    const rows = assetRows();
    $("assetsIntro").textContent = T("assets.intro", { n: rows.length, pilot: INDEXED.size });
    const docCount = (tag) => documentRows().filter((d) => d.tag === tag).length;
    const sev = (r) => ((r.chains || []).some((c) => c.loss_of_containment) ? 2 : (r.chains || []).length ? 1 : 0);
    const tbl = dataTable({
      id: "assetTable", label: T("nav.assets"), initial: { key: "status", dir: -1 }, rows,
      href: (r) => "#asset/" + r.tag,
      cardTitle: (r) => [h("span", { class: "mono" }, r.tag), " ", h("span", { class: "lkname" }, r.equipment.toLowerCase())],
      cardBadge: (r) => assetStatus(r), cardFields: ["chains", "last", "docs"],
      cols: [
        { key: "tag", label: T("assets.th_tag"), sort: (r) => r.tag, cell: (r) => h("a", { class: "mono rowlink", href: "#asset/" + r.tag }, r.tag), noCard: true },
        { key: "equipment", label: T("assets.th_equipment"), sort: (r) => r.equipment, cell: (r) => r.equipment.toLowerCase(), noCard: true },
        { key: "status", label: T("assets.th_status"), sort: (r) => sev(r) * 100 + (r.chains || []).length, cell: (r) => assetStatus(r), noCard: true },
        { key: "chains", label: T("assets.th_chains"), num: true, sort: (r) => (r.chains || []).length, cell: (r) => String((r.chains || []).length) },
        { key: "last", label: T("assets.th_last"), sort: (r) => (lastEventOf(r.tag) || {}).date || "", cell: (r) => { const l = lastEventOf(r.tag); return l ? fmtDate(l.date) : "-"; } },
        { key: "docs", label: T("assets.th_docs"), num: true, sort: (r) => docCount(r.tag), cell: (r) => String(docCount(r.tag)) },
        { key: "crit", label: T("assets.th_crit"), pri: 2, sort: (r) => r.criticality, cell: (r) => r.criticality.toLowerCase() },
        { key: "wo", label: T("assets.th_wo"), num: true, pri: 3, sort: (r) => r.wo, cell: (r) => String(r.wo) },
        { key: "fail", label: T("assets.th_fail"), num: true, pri: 3, sort: (r) => r.fail, cell: (r) => String(r.fail) },
        { key: "downtime", label: T("assets.th_downtime"), num: true, pri: 2, sort: (r) => r.dt, cell: (r) => hrs(r.dt) },
        { key: "cost", label: T("assets.th_cost"), num: true, pri: 3, sort: (r) => r.cost, cell: (r) => rpJt(r.cost) },
      ],
    });
    $("assetTable").closest(".card").replaceWith(h("div", { class: "card dtcard-host" }, tbl));
  }

  function renderAssetDetail(tag) {
    const rows = assetRows().filter((r) => r.tag === tag);
    if (!rows.length) return false;
    const a = rows[0];
    const chains = a.chains || [];
    const indexed = INDEXED.has(tag);
    const opls = oplFor(tag), il = ilFor(tag), ds = dsFor(tag);
    const docs = documentRows().filter((d) => d.tag === tag);
    const v = $("view-asset");
    v.replaceChildren();
    v.append(crumbs([[T("nav.ask"), "#ask"], [T("nav.assets"), "#assets"], [tag]]));

    /* header: identity + status first */
    const vis = assetVisual(a.equipment);
    const head = h("div", { class: "ahead" },
      h("div", {}, vis.node, vis.cap),
      h("div", {}, h("h2", {}, tag), h("div", { class: "eq" }, a.equipment.toLowerCase()),
        h("div", { class: "ameta" }, (opls[0] && opls[0].area ? T("asset.area", { area: opls[0].area.toLowerCase() }) : "") + a.criticality.toLowerCase()),
        h("div", { class: "badges" }, assetStatus(a), coverageBadge(tag))),
      h("div", { class: "spacer" }));
    /* Every asset has a drawing. Only the pilot assets have a controlled document
       number; for the rest we show the drawing without inventing one. */
    const pid = opls[0] && opls[0].pid_ref;
    if (hasPid(tag)) {
      head.append(h("button", { class: "btn sec", type: "button", onclick: () => openPid(tag, pid, !pid) },
        ico("doc"), pid ? T("asset.open_pid", { ref: pid }) : T("asset.open_pid_drawing")));
    }
    v.append(head);

    /* KPI row: open chains, last event, documents, interlocks (+ loss of containment);
       the remaining asset-page metrics follow, and collapse behind a disclosure on phones */
    const chdt = chains.reduce((x, c) => x + c.total_downtime_h, 0);
    const chcost = chains.reduce((x, c) => x + c.total_cost_idr, 0);
    const linked = new Set(chains.flatMap((c) => c.wos)).size;
    const locn = chains.filter((c) => c.loss_of_containment).length;
    const last = lastEventOf(tag);
    const tl = (val, lab, sub, critical = false) => h("div", { class: "tile assetmetric" + (critical ? " critical" : "") },
      h("span", { class: "label assetmetriclabel" }, critical ? ico("warn", 1.8, 16) : null, lab), h("b", {}, val), h("span", {}, sub));
    const kpi = (val, lab, sub) => h("div", { class: "tile kpi" }, h("span", { class: "label" }, lab), h("b", {}, val), h("span", {}, sub));
    const mChains = tl(chains.length, T("asset.m_chains"), T("asset.m_chains_sub"));
    const kLast = kpi(last ? fmtDate(last.date) : "-", T("asset.k_last"), last ? last.wo : "");
    const kDocs = kpi(docs.length, T("asset.k_docs"), docs.length ? TN("asset.k_docs_sub", opls.length) : T("asset.k_none"));
    const kIl = kpi(il ? 1 : 0, T("asset.k_il"), il ? il.logic_no : T("asset.k_none"));
    const mFail = tl(a.fail, T("asset.m_fail"), T("asset.m_fail_sub", { n: a.wo }));
    const mLinked = tl(linked, T("asset.m_linked"), T("asset.m_inside"));
    const mDown = tl(hrs(chdt), T("asset.m_downtime"), T("asset.m_inside"));
    const mCost = tl(rpJt(chcost), T("asset.m_cost"), T("asset.m_inside"));
    const mLoc = locn ? tl(locn, T("asset.m_loc"), TN("asset.m_loc_sub", locn), true) : null;
    const allMetrics = [mChains, kLast, kDocs, kIl, mLoc, mFail, mLinked, mDown, mCost].filter(Boolean);
    const primary = [mChains, kLast, kDocs, kIl, mLoc].filter(Boolean), secondary = [mFail, mLinked, mDown, mCost];
    const strip = h("div", { class: "tiles assetmetrics" });
    const moreGrid = h("div", { class: "tiles assetmetrics moremetricsgrid" });
    const more = h("details", { class: "tv moremetrics" }, h("summary", {}, T("asset.more_metrics", { n: secondary.length })), moreGrid);
    assetMetricLayout = () => {
      const compact = innerWidth <= 760;
      if (compact === strip.classList.contains("compact") && strip.childElementCount) return;
      strip.classList.toggle("compact", compact);
      moreGrid.classList.toggle("compact", compact);
      if (compact) { strip.replaceChildren(...primary); moreGrid.replaceChildren(...secondary); more.hidden = false; }
      else { strip.replaceChildren(...allMetrics); moreGrid.replaceChildren(); more.hidden = true; }
    };
    assetMetricLayout();
    v.append(strip, more);

    /* tabs: Failure chains · Documents · Interlocks · P&ID */
    const panels = [];
    /* -- failure chains: chain list + mechanism bars (counted from records) */
    const chainPanel = h("div", {});
    if (chains.length) {
      chainPanel.append(h("ul", { class: "lklist chainlist" }, chains.map((c) => h("li", { class: "chainrow" },
        h("div", { class: "chainrowhead" }, chainStatus(c), h("a", { class: "mono rowlink", href: "#chain/" + c.chain_id }, c.chain_id),
          h("span", { class: "mech " + (c.root_mechanism === "FOULING" ? "f" : "m") }, title(c.root_mechanism))),
        h("div", { class: "cst" }, T("common.row_stats", { n: c.n_events, d: c.span_days, h: hrs(c.total_downtime_h), cost: rpJt(c.total_cost_idr) })),
        c.pilot ? h("div", { class: "lat" }, T("common.latency_published", { n: c.lesson_latency_days }))
                : h("div", { class: "cardnote" }, T("chains.not_indexed"))))));
      const mc = new Map();
      for (const c of chains) for (const w of c.wos) {
        const r = RECS.get(w); if (!r) continue;
        const k = r.causal_mode || r.primary_mode || "UNCLASSIFIED";
        mc.set(k, (mc.get(k) || 0) + 1);
      }
      const mech = [...mc.entries()].sort((x, y) => y[1] - x[1]);
      const mx = Math.max(1, ...mech.map((m) => m[1]));
      const CAT = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)"];
      chainPanel.append(h("div", { class: "lksec" }, h("h3", { class: "label modtitle" }, T("asset.mech_h")),
        h("p", { class: "sub" }, T("asset.mech_sub")),
        h("div", { class: "mbars" }, mech.map(([m, n], i) => h("div", { class: "mbar" },
          h("span", {}, title(m)), h("span", { class: "t", style: `width:${Math.round(n / mx * 100)}%;background:${CAT[i % 3]}` }), h("span", { class: "n" }, n)))),
        h("details", { class: "tv" }, h("summary", {}, T("common.show_table")),
          h("div", { class: "tablewrap" }, h("table", { class: "data" },
            h("thead", {}, h("tr", {}, h("th", {}, T("asset.th_mech")), h("th", { class: "r" }, T("asset.th_events")))),
            h("tbody", {}, mech.map(([m, n]) => h("tr", {}, h("td", {}, title(m)), h("td", { class: "r" }, n)))))))));
    } else chainPanel.append(h("div", { class: "empty" }, ico("info"), h("span", {}, T("common.no_chain"))));
    panels.push(["chains", T("asset.tab_chains", { n: chains.length }), chainPanel]);
    /* -- documents */
    const docPanel = h("div", {});
    if (indexed && docs.length) {
      docPanel.append(h("p", { class: "sub" }, T("asset.know_sub", { opl: opls.length, il: il ? 1 : 0, ds: ds ? 1 : 0 }), " ", helpTerm("opl")),
        h("ul", { class: "lklist lkrecs" }, docs.map((d) => h("li", {},
          h("div", { class: "lkrectext" }, h("span", { class: "mono" }, d.id), clampText(d.title),
            h("span", { class: "cardnote" }, d.kind + (d.shared ? " · " + T("asset.shared_by", { date: fmtDate(d.shared), by: d.by }) : d.rev ? " · " + T("kv.rev", { r: d.rev }) : ""))),
          h("button", { class: "btn sec", type: "button", "aria-label": T("asset.open_doc", { id: d.id, title: d.title }), onclick: () => openDocument(d.id) }, T("lookup.open"))))));
    } else docPanel.append(h("div", { class: "empty" }, ico("info"), h("span", {}, T("asset.no_docs"))));
    panels.push(["docs", T("asset.tab_docs", { n: docs.length }), docPanel]);
    /* -- interlocks */
    const ilPanel = h("div", {});
    if (il) {
      const kv = [[T("asset.il_doc"), il.doc_number], [T("asset.il_logic"), il.logic_no], [T("asset.il_sil"), il.sil], [T("asset.il_rev"), T("kv.rev", { r: il.revision })],
        [T("asset.il_causes"), String((il.causes || []).length)], [T("asset.il_effects"), String((il.effects || []).length)], [T("asset.il_perm"), String((il.permissives || []).length)]];
      ilPanel.append(h("div", { class: "lkhead" }, il.logic_no, " ", helpTerm("interlock")),
        il.description ? h("p", { class: "cardnote" }, clampText(il.description)) : null,
        h("dl", { class: "lkfields" }, kv.map(([k, val]) => h("div", {}, h("dt", {}, k), h("dd", {}, val)))),
        h("div", { class: "cardfoot" }, h("button", { class: "btn sec", type: "button", onclick: () => openDocument(il.doc_number) }, T("asset.open_doc_btn"))));
    } else ilPanel.append(h("div", { class: "empty" }, ico("info"), h("span", {}, T("asset.il_none"))));
    panels.push(["il", T("asset.tab_il", { n: il ? 1 : 0 }), ilPanel]);
    /* -- P&ID */
    const pidPanel = h("div", {});
    if (hasPid(tag)) {
      pidPanel.append(h("dl", { class: "lkfields" }, h("div", {}, h("dt", {}, T("asset.pid_ref")), h("dd", { class: "mono" }, pid || tag))),
        pid ? null : h("p", { class: "cardnote" }, T("pid.uncontrolled")),
        h("div", { class: "cardfoot" }, h("button", { class: "btn sec", type: "button", onclick: () => openPid(tag, pid, !pid) }, ico("doc"),
          pid ? T("asset.open_pid", { ref: pid }) : T("asset.open_pid_drawing"))));
    } else pidPanel.append(h("div", { class: "empty" }, ico("info"), h("span", {}, T("asset.pid_none"))));
    panels.push(["pid", T("asset.tab_pid"), pidPanel]);

    const strip2 = h("div", { class: "atabs", role: "tablist", "aria-label": T("asset.tabs_aria") });
    const body = h("section", { class: "module assettabs" }, strip2);
    const select = (id, focus) => {
      for (const [pid2, , panel] of panels) panel.hidden = pid2 !== id;
      [...strip2.children].forEach((b) => { const on = b.dataset.tab === id; b.setAttribute("aria-selected", String(on)); b.tabIndex = on ? 0 : -1; if (on && focus) b.focus(); });
    };
    panels.forEach(([id, label, panel], i) => {
      panel.id = "atab-" + id; panel.setAttribute("role", "tabpanel"); panel.classList.add("modbody");
      panel.setAttribute("aria-labelledby", "atabbtn-" + id);
      strip2.append(h("button", { type: "button", role: "tab", id: "atabbtn-" + id, "data-tab": id, "aria-controls": panel.id, onclick: () => select(id),
        onkeydown: (e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          const n = (i + (e.key === "ArrowRight" ? 1 : panels.length - 1)) % panels.length;
          select(panels[n][0], true);
        } }, label));
      body.append(panel);
    });
    select("chains");
    v.append(body);
    return true;
  }

  /* --------------------------------------------------------- plant */
  function renderPlant() {
    const R = B.records;
    const dt = R.reduce((a, r) => a + (r.downtime_h || 0), 0);
    const cost = R.reduce((a, r) => a + (r.cost_idr || 0), 0);
    const chainDt = ALL.reduce((a, c) => a + c.total_downtime_h, 0);
    const chainCost = ALL.reduce((a, c) => a + c.total_cost_idr, 0);
    const rows = assetRows();
    const groups = byMech();
    const mechName = (m) => (title(m) === "fouling" ? T("mech.fouling") : title(m));

    $("plantIntro").textContent = T("plant.intro", { n: rows.length, pilot: INDEXED.size });
    $("gapH").append(helpTerm("opl"));

    /* KPI strip: status first, every figure counted from the bundle */
    const linked = new Set(ALL.flatMap((c) => c.wos)).size;
    const locN = ALL.filter((c) => c.loss_of_containment).length;
    const kpi = (val, lab, sub, sev) => h("div", { class: "tile kpi" + (sev ? " sev-crit" : "") },
      h("span", { class: "label" }, sev ? ico("warn", 2, 14) : null, lab), h("b", {}, val), h("span", {}, sub));
    $("plantKpis").append(
      kpi(rows.length, T("home.tile.assets"), T("home.tile.assets_sub", { pilot: INDEXED.size })),
      kpi(hrs(dt), T("plant.k_downtime"), T("plant.k_downtime_sub", { pct: Math.round(chainDt / dt * 100) })),
      kpi(rpJt(cost), T("home.tile.cost"), T("plant.k_cost_sub", { cost: rpJt(chainCost) })),
      kpi(ALL.length, T("home.tile.chains"), T("plant.k_chains_sub", { n: linked })),
      kpi(groups.length, T("plant.k_mech"), T("plant.k_mech_sub", { n: groups[0].assets.size })),
      locN ? kpi(locN, T("home.tile.loc"), TN("home.tile.loc_sub", locN), true) : null);

    $("plantCallout").append(h("div", { class: "ico" }, ico("plant")),
      h("div", { class: "calloutcontent" },
        h("h3", {}, T("plant.callout_h")),
        h("p", { class: "calloutbody" },
          T("plant.callout_1", { n: ALL.length, h: hrs(chainDt), pct: Math.round(chainDt / dt * 100), cost: rpJt(chainCost) }),
          h("strong", {}, T("plant.callout_2", { k: groups[0].chains.length, n: ALL.length, mech: title(groups[0].mech) === "fouling" ? T("mech.fouling_long") : title(groups[0].mech) })),
          T("plant.callout_3", { assets: [...groups[0].assets].sort().join(", ") })),
        h("div", { class: "plantactions" },
          h("button", { class: "btn ghost", type: "button", onclick: () => go("#chains") },
            T("plant.view_chains", { n: ALL.length }), ico("arrow", 1.8, 15)))));

    /* exactly the mechanism groups the engine emits -- two, not three */
    $("mechCount").textContent = String(groups.length);
    const mg = $("mechGroups");
    groups.forEach((g, i) => {
      mg.append(h("div", { class: "mgroup" },
        h("h3", {}, h("span", { class: "rank" }, i + 1), mechName(g.mech)),
        h("div", { class: "st" }, `${TN("plant.mg_assets", g.assets.size)}  -  ${TN("plant.mg_chains", g.chains.length)}  -  ${T("plant.mg_rest", { events: g.ev, h: hrs(g.dt), cost: rpJt(g.cost) })}`),
        h("div", { class: "as" }, [...g.assets].sort().map((t) => h("a", { class: "tag", href: "#asset/" + t }, t)))));
    });

    /* chart 1 -- downtime bars: figure/ground, not two categories */
    const bars = rows.map((r) => ({ tag: r.tag, name: r.equipment, dt: r.dt, ch: r.chdt || 0 })).sort((a, b) => b.dt - a.dt);
    $("barLegend").append(
      h("span", {}, h("i", { style: "background:var(--cat-1)" }), T("plant.lg_in")),
      h("span", {}, h("i", { style: "background:var(--cat-rest)" }), T("plant.lg_other")));
    {
      const W = 560, left = 96, right = 62, bh = 18, gap = 16, top = 6, H = top + bars.length * (bh + gap) + 24;
      const max = Math.max(25, Math.ceil(Math.max(...bars.map((r) => r.dt)) / 25) * 25);
      const X = (v) => (v / max) * (W - left - right);
      const svg = $("bars");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.width = "100%"; svg.style.minWidth = "430px"; svg.style.height = "auto";
      svg.replaceChildren();
      for (let val = 0; val <= max; val += 25) {
        svg.append(s("line", { x1: left + X(val), x2: left + X(val), y1: top, y2: H - 22, stroke: "var(--line)", "stroke-width": 1 }),
          s("text", { x: left + X(val), y: H - 6, "text-anchor": "middle", "font-size": 11, style: "fill:var(--ink-muted);font-variant-numeric:tabular-nums" }, val + (val === max ? " h" : "")));
      }
      bars.forEach((r, i) => {
        const y = top + i * (bh + gap);
        svg.append(s("text", { x: left - 10, y: y + bh / 2 + 4, "text-anchor": "end", "font-size": 12.5, style: "fill:var(--ink);font-family:var(--f-mono)" }, r.tag));
        const wc = X(r.ch), wo = X(r.dt - r.ch);
        const g = s("g", {});
        if (r.ch > 0) g.append(barPath(left, y, wc, bh, r.dt - r.ch <= 0.001, "var(--cat-1)"));
        if (r.dt - r.ch > 0.001) g.append(barPath(left + wc + (r.ch > 0 ? 2 : 0), y, Math.max(0, wo - (r.ch > 0 ? 2 : 0)), bh, true, "var(--cat-rest)"));
        g.append(s("rect", { x: left, y: y - gap / 2, width: W - left, height: bh + gap, fill: "transparent" }));
        svg.append(g, s("text", { x: left + X(r.dt) + 6, y: y + bh / 2 + 4, "font-size": 12, style: "fill:var(--ink);font-variant-numeric:tabular-nums" }, hrs(r.dt)));
        hover(g, `<b>${esc(r.tag)}</b> - ${esc(r.name.toLowerCase())}<br>${esc(T("plant.bar_tip", { h: hrs(r.dt), ch: hrs(r.ch) }))}`);
      });
    }
    $("barTable").append(h("caption", { class: "sr" }, T("plant.bars_sub")),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, T("plant.th_asset")), h("th", { scope: "col" }, T("plant.th_equipment")), h("th", { class: "r", scope: "col" }, T("plant.th_downtime")), h("th", { class: "r", scope: "col" }, T("plant.th_in")))),
      h("tbody", {}, bars.map((r) => h("tr", {}, h("td", { class: "mono" }, r.tag), h("td", {}, r.name.toLowerCase()), h("td", { class: "r" }, hrs(r.dt)), h("td", { class: "r" }, hrs(r.ch))))));

    /* chart 2 -- linked work orders by failure mode, stacked by the chain's root mechanism.
       Colour follows the root mechanism (fixed order: the engine's group order), never the rank. */
    const CAT = ["var(--cat-1)", "var(--cat-2)", "var(--cat-3)"];
    const mechs = groups.map((g) => g.mech);
    const colour = (m) => CAT[mechs.indexOf(m)] || "var(--cat-rest)";
    const modes = new Map();
    for (const c of ALL) for (const w of c.wos) {
      const r = RECS.get(w); if (!r) continue;
      const k = r.causal_mode || r.primary_mode || "UNCLASSIFIED";
      const row = modes.get(k) || { mode: k, total: 0, by: new Map() };
      row.total++; row.by.set(c.root_mechanism, (row.by.get(c.root_mechanism) || 0) + 1);
      modes.set(k, row);
    }
    const mrows = [...modes.values()].sort((a, b) => b.total - a.total || (a.mode < b.mode ? -1 : 1));
    $("modeLegend").append(...mechs.map((m) => h("span", {}, h("i", { style: "background:" + colour(m) }), T("plant.lg_root", { mech: mechName(m) }))));
    {
      const W = 420, left = 132, right = 30, bh = 18, gap = 14, top = 6, H = top + mrows.length * (bh + gap) + 24;
      const max = Math.max(1, ...mrows.map((r) => r.total));
      const step = max > 10 ? 5 : max > 5 ? 2 : 1;
      const X = (v) => (v / max) * (W - left - right);
      const svg = $("modeBars");
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.width = "100%"; svg.style.height = "auto";
      svg.replaceChildren();
      for (let val = 0; val <= max; val += step) {
        svg.append(s("line", { x1: left + X(val), x2: left + X(val), y1: top, y2: H - 22, stroke: "var(--line)", "stroke-width": 1 }),
          s("text", { x: left + X(val), y: H - 6, "text-anchor": "middle", "font-size": 12.5, style: "fill:var(--ink-muted);font-variant-numeric:tabular-nums" }, val));
      }
      mrows.forEach((r, i) => {
        const y = top + i * (bh + gap);
        svg.append(s("text", { x: left - 10, y: y + bh / 2 + 4, "text-anchor": "end", "font-size": 14, style: "fill:var(--ink)" }, title(r.mode)));
        const g = s("g", {});
        let x = left;
        const parts = mechs.filter((m) => r.by.get(m));
        parts.forEach((m, j) => {
          const w = X(r.by.get(m)) - (j > 0 ? 2 : 0);
          g.append(barPath(x + (j > 0 ? 2 : 0), y, Math.max(0, w), bh, j === parts.length - 1, colour(m)));
          x += X(r.by.get(m));
        });
        g.append(s("rect", { x: left, y: y - gap / 2, width: W - left, height: bh + gap, fill: "transparent" }));
        svg.append(g, s("text", { x: left + X(r.total) + 6, y: y + bh / 2 + 4, "font-size": 13.5, style: "fill:var(--ink);font-variant-numeric:tabular-nums" }, r.total));
        hover(g, `<b>${esc(title(r.mode))}</b><br>` + parts.map((m) => esc(T("plant.mode_tip", { n: r.by.get(m), mech: mechName(m) }))).join("<br>"));
      });
    }
    $("modeTable").append(h("caption", { class: "sr" }, T("plant.modes_sub")),
      h("thead", {}, h("tr", {}, h("th", { scope: "col" }, T("asset.th_mech")), ...mechs.map((m) => h("th", { class: "r", scope: "col" }, mechName(m))), h("th", { class: "r", scope: "col" }, T("plant.th_total")))),
      h("tbody", {}, mrows.map((r) => h("tr", {}, h("td", {}, title(r.mode)), ...mechs.map((m) => h("td", { class: "r" }, r.by.get(m) || 0)), h("td", { class: "r" }, r.total)))));
  }
  function barPath(x, y, w, hgt, roundEnd, fill) {
    const r = roundEnd ? Math.min(4, w / 2) : 0;
    const d = `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt - r} Q${x + w},${y + hgt} ${x + w - r},${y + hgt} H${x} Z`;
    return s("path", { d, fill });
  }

  /* ----------------------------------------------------- documents */
  function documentRows() {
    const docs = [];
    for (const o of OPL) docs.push({ id: o.opl_no, title: o.title, tag: o.asset_tag, kind: o.classification, shared: o.date_shared, by: o.approved_by, rev: "" });
    for (const i of IL) docs.push({ id: i.doc_number, title: T("docs.interlock_title", { logic: i.logic_no, sil: i.sil }), tag: i.asset_tag, kind: T("asset.interlock"), shared: "", by: "", rev: i.revision });
    for (const d of DS) docs.push({ id: d.doc_number, title: T("asset.eq_datasheet"), tag: d.asset_tag, kind: T("asset.datasheet"), shared: "", by: "", rev: d.revision });
    return docs;
  }
  function openDocument(id) {
    const doc = documentRows().find((item) => item.id === id);
    if (!doc) return;
    go("#docs");
    showDoc(doc);
  }
  /* Documents screen: the indexed documents plus the controlled P&ID drawings of the pilot
     assets (document numbers come from the OPL records; no number is invented). A P&ID row
     opens the P&ID viewer; every other row opens the existing text viewer. */
  const DOC_TYPES = [["opl", "doc"], ["il", "link"], ["ds", "info"], ["pid", "plant"]];
  function docTypeOf(d) {
    if (d.pid) return "pid";
    if (OPL.some((o) => o.opl_no === d.id)) return "opl";
    if (IL.some((i) => i.doc_number === d.id)) return "il";
    return "ds";
  }
  const typeBadge = (t) => badge("muted", (DOC_TYPES.find((x) => x[0] === t) || DOC_TYPES[0])[1], T("docs.type_" + t));
  function renderDocs() {
    const docs = documentRows();
    $("docsIntro").textContent = T("docs.intro", { n: docs.length, pilot: INDEXED.size, passages: B.passages.length });
    const pids = [...new Map(OPL.filter((o) => o.pid_ref && hasPid(o.asset_tag)).map((o) => [o.pid_ref, o])).values()]
      .map((o) => ({ id: o.pid_ref, title: T("docs.pid_title"), tag: o.asset_tag, kind: T("docs.type_pid"), shared: "", by: "", rev: "", pid: true }));
    const ALLDOCS = [...docs, ...pids].map((d) => Object.assign({}, d, { type: docTypeOf(d) }));
    const open = (d) => {
      if (d.pid) { openPid(d.tag, d.id, false); return; }
      showDoc(d);
      /* on one-column layouts the viewer sits below the register: bring it into view */
      if (innerWidth <= 980) try { $("docView").scrollIntoView({ block: "start" }); } catch (e) { /* non-browser host */ }
    };
    const fType = h("select", { id: "docFilterType" }, h("option", { value: "" }, T("docs.filter_all_types")),
      ...DOC_TYPES.filter(([t]) => ALLDOCS.some((d) => d.type === t)).map(([t]) => h("option", { value: t }, T("docs.type_" + t))));
    const fAsset = h("select", { id: "docFilterAsset" }, h("option", { value: "" }, T("chains.filter_all_assets")),
      ...[...new Set(ALLDOCS.map((d) => d.tag))].sort().map((t) => h("option", { value: t }, t)));
    const count = h("span", { class: "dtcount", role: "status" });
    const emptyState = h("div", { class: "empty", hidden: true }, ico("info"), h("span", {}, T("docs.none")),
      h("button", { class: "btn ghost", type: "button", onclick: () => { fType.value = ""; fAsset.value = ""; apply(); } }, T("chains.reset")));
    const order = (t) => DOC_TYPES.findIndex((x) => x[0] === t);
    const opts = {
      id: "docTable", label: T("nav.docs"), initial: { key: "type", dir: 1 }, rows: ALLDOCS, open,
      openLabel: (d) => T("docs.open_aria", { id: d.id, title: d.title }),
      cardTitle: (d) => [h("span", { class: "mono" }, d.id), " ", h("span", { class: "lkname" }, d.title)],
      cardBadge: (d) => typeBadge(d.type), cardFields: ["asset", "kind", "shared"],
      cols: [
        { key: "type", label: T("docs.th_type"), sort: (d) => order(d.type) + ":" + d.id, cell: (d) => typeBadge(d.type), noCard: true },
        { key: "id", label: T("docs.th_doc"), sort: (d) => d.id, noCard: true,
          cell: (d) => h("button", { class: "btn ghost docopen mono", type: "button", "aria-label": T("docs.open_aria", { id: d.id, title: d.title }),
            onclick: (e) => { e.stopPropagation(); open(d); } }, d.id) },
        { key: "title", label: T("docs.th_title"), sort: (d) => d.title, cell: (d) => clampText(d.title), noCard: true },
        { key: "asset", label: T("docs.th_asset"), sort: (d) => d.tag, cell: (d) => h("a", { class: "mono rowlink", href: "#asset/" + d.tag }, d.tag) },
        { key: "kind", label: T("docs.th_kind"), pri: 3, sort: (d) => d.kind, cell: (d) => d.kind },
        { key: "shared", label: T("docs.th_shared"), pri: 2, sort: (d) => d.shared || d.rev || "",
          cell: (d) => (d.shared ? fmtDate(d.shared) : d.rev ? T("kv.rev", { r: d.rev }) : "-") },
      ],
    };
    const tbl = dataTable(opts);
    function apply() {
      const rows = ALLDOCS.filter((d) => (!fType.value || d.type === fType.value) && (!fAsset.value || d.tag === fAsset.value));
      opts.rerender(rows);
      count.textContent = T("docs.showing", { n: rows.length, total: ALLDOCS.length });
      emptyState.hidden = rows.length > 0;
      tbl.hidden = rows.length === 0;
    }
    fType.addEventListener("change", apply);
    fAsset.addEventListener("change", apply);
    $("docList").replaceChildren(h("div", { class: "modhead" }, h("h3", { class: "label modtitle" }, T("docs.list_h")), count),
      h("div", { class: "filters" },
        h("label", {}, h("span", { class: "label" }, T("docs.filter_type")), fType),
        h("label", {}, h("span", { class: "label" }, T("chains.filter_asset")), fAsset)),
      emptyState, tbl);
    apply();
  }
  function showDoc(d) {
    const box = $("docView");
    box.replaceChildren();
    const page = B.page_text[d.id];
    box.append(h("div", { class: "railh" }, h("div", { class: "label" }, d.kind + " - " + d.tag), h("h3", {}, d.id + " - " + d.title)));
    const kv = [];
    if (d.shared) kv.push([T("kv.shared"), fmtDate(d.shared)]);
    if (d.by) kv.push([T("kv.approved_by"), d.by]);
    if (d.rev) kv.push([T("kv.revision"), T("kv.rev", { r: d.rev })]);
    if (kv.length) box.append(h("dl", { class: "kv" }, kv.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
    const src = h("div", { class: "src", tabindex: "0", "aria-label": T("src.aria") });
    if (page) { const pre = h("pre", {}); for (const line of page.split("\n")) pre.append(h("span", {}, line || " ")); src.append(pre); }
    else src.append(h("div", { class: "railempty" }, T("docs.no_text")));
    box.append(src);
  }

  /* ---------------------------------------------------------- P&ID */
  let PID = null;
  function pidData() {
    if (PID === null) { const el = document.getElementById("piddata"); PID = el ? JSON.parse(el.textContent) : {}; }
    return PID;
  }
  const hasPid = (tag) => Object.prototype.hasOwnProperty.call(pidData(), tag);
  const PID_MIN = 0.1, PID_MAX = 4, PID_STEP = 1.25;
  function openPid(tag, ref, uncontrolled) {
    const d = pidData()[tag];
    if (!d) return;
    const m = $("pidmodal");
    pidReturnFocus = document.activeElement;
    const image = h("img", { src: "data:image/webp;base64," + d, alt: T("pid.alt", { ref: ref || tag }), draggable: "false" });
    const canvas = h("div", { class: "modalb", tabindex: "0", "aria-label": T("pid.canvas_aria") }, image);
    const btn = (label, aria, fn) => h("button", { class: "btn sec", type: "button", "aria-label": aria, onclick: fn }, label);
    const level = h("span", { class: "pidlevel", role: "status", "aria-label": T("pid.level_aria") });
    const initial = innerWidth <= 760 ? "fit" : "actual";
    let mode = initial, scale = 1;
    const natural = () => image.naturalWidth || 1;
    const fitScale = () => Math.min(PID_MAX, Math.max(0.02, (canvas.clientWidth - 24) / natural()));
    const currentScale = () => (mode === "fit" ? fitScale() : scale);
    const zoomOut = btn("\u2212", T("pid.zoom_out"), () => setZoom(currentScale() / PID_STEP));
    const zoomIn = btn("+", T("pid.zoom_in"), () => setZoom(currentScale() * PID_STEP));
    const fit = btn(T("pid.fit"), null, () => { mode = "fit"; apply(false); });
    const actual = btn(T("pid.actual"), null, () => { mode = "actual"; scale = 1; apply(true); });
    const reset = btn(T("pid.reset"), T("pid.reset_aria"), () => { mode = initial; scale = 1; apply(false); canvas.scrollLeft = 0; canvas.scrollTop = 0; });
    [fit, actual].forEach((b) => b.removeAttribute("aria-label"));
    function apply(keepCenter) {
      const before = image.getBoundingClientRect();
      const cx = canvas.scrollLeft + canvas.clientWidth / 2, cy = canvas.scrollTop + canvas.clientHeight / 2;
      image.classList.toggle("pidfit", mode === "fit");
      image.style.width = mode === "fit" ? "" : Math.round(natural() * scale) + "px";
      const pct = Math.round(currentScale() * 100);
      level.textContent = mode === "fit" ? T("pid.level_fit", { pct }) : T("pid.level", { pct });
      fit.setAttribute("aria-pressed", String(mode === "fit"));
      actual.setAttribute("aria-pressed", String(mode !== "fit" && Math.abs(scale - 1) < 1e-6));
      zoomOut.disabled = currentScale() <= Math.min(PID_MIN, fitScale()) + 1e-6;
      zoomIn.disabled = currentScale() >= PID_MAX - 1e-6;
      if (keepCenter && before.width) {
        const ratio = image.getBoundingClientRect().width / before.width;
        canvas.scrollLeft = cx * ratio - canvas.clientWidth / 2;
        canvas.scrollTop = cy * ratio - canvas.clientHeight / 2;
      }
    }
    function setZoom(next) {
      scale = Math.min(PID_MAX, Math.max(Math.min(PID_MIN, fitScale()), next));
      mode = "zoom";
      apply(true);
    }
    image.addEventListener("load", () => apply(false));
    /* touch: two-finger pinch; mouse: drag to pan; ctrl/cmd + wheel zooms */
    const pointers = new Map();
    let pinch = null, drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        pinch = { dist: Math.hypot(p1.x - p2.x, p1.y - p2.y) || 1, scale: currentScale() };
        drag = null;
      } else if (e.pointerType === "mouse" && e.button === 0) {
        drag = { x: e.clientX, y: e.clientY, left: canvas.scrollLeft, top: canvas.scrollTop };
        canvas.classList.add("dragging");
      }
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && pointers.size === 2) {
        const [p1, p2] = [...pointers.values()];
        setZoom(pinch.scale * (Math.hypot(p1.x - p2.x, p1.y - p2.y) / pinch.dist));
      } else if (drag) {
        canvas.scrollLeft = drag.left - (e.clientX - drag.x);
        canvas.scrollTop = drag.top - (e.clientY - drag.y);
      }
    });
    const endPointer = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) pinch = null; drag = null; canvas.classList.remove("dragging"); };
    ["pointerup", "pointercancel", "pointerleave"].forEach((type) => canvas.addEventListener(type, endPointer));
    canvas.addEventListener("wheel", (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom(currentScale() * (e.deltaY < 0 ? PID_STEP : 1 / PID_STEP));
    }, { passive: false });
    const close = h("button", { class: "btn sec", type: "button", "aria-label": T("pid.close_aria"), onclick: closePid }, T("pid.close"));
    m.replaceChildren(h("div", { class: "modalbox", role: "dialog", "aria-modal": "true", "aria-label": T("pid.alt", { ref: ref || tag }) },
      h("div", { class: "modalh" }, h("span", { class: "label" }, T("pid.label")), h("strong", { class: "mono" }, ref || tag),
        h("span", { class: "spacer" }), close),
      uncontrolled ? h("div", { class: "modalnote" }, T("pid.uncontrolled")) : null,
      h("div", { class: "pidtools" }, h("span", { class: "pidhint" }, T("pid.hint")),
        h("span", { class: "pidzoom" }, zoomOut, level, zoomIn), fit, actual, reset),
      canvas));
    m.hidden = false;
    apply(false);
    m.addEventListener("click", (e) => { if (e.target === m) closePid(); }, { once: true });
    m.onkeydown = (event) => {
      if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomIn.click(); return; }
      if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomOut.click(); return; }
      if (event.key === "0") { event.preventDefault(); reset.click(); return; }
      if (event.key !== "Tab") return;
      const items = [...m.querySelectorAll("button:not([disabled]),[tabindex=\"0\"]")];
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    close.focus();
  }
  function closePid() {
    const m = $("pidmodal");
    if (!m || m.hidden) return;
    m.hidden = true;
    m.onkeydown = null;
    m.replaceChildren();
    if (pidReturnFocus && pidReturnFocus.focus) pidReturnFocus.focus();
    pidReturnFocus = null;
  }

  /* ---------------------------------------------------------- tests */
  const HELD = [["#1", "12/16", 2, "tests.held_1"], ["#2", "13/14", 0, "tests.held_2"], ["#3", "15/20", "3-4", "tests.held_3"],
    ["#4", "12/18", 3, "tests.held_4"], ["#5", "16/18", 1, "tests.held_5"]];
  function renderTests() {
    const tile = (v, a, b) => h("div", { class: "tile kpi" }, h("span", { class: "label" }, a), h("b", {}, v), h("span", {}, b));
    $("testTiles").append(tile("467/467", T("tests.t_parity"), T("tests.t_parity_sub")),
      tile("157/157", T("tests.t_verbatim"), T("tests.t_verbatim_sub")),
      tile("28/28", T("tests.t_golden"), T("tests.t_golden_sub")),
      tile("4/4", T("tests.t_llm"), T("tests.t_llm_sub")));
    $("heldout").append(h("thead", {}, h("tr", {}, h("th", {}, T("tests.th_round")), h("th", { class: "r" }, T("tests.th_first")), h("th", { class: "r" }, T("tests.th_serious")), h("th", {}, T("tests.th_found")))),
      h("tbody", {}, HELD.map(([r, p, n, w]) => h("tr", {}, h("td", { "data-label": T("tests.th_round") }, r), h("td", { class: "r", "data-label": T("tests.th_first") }, p), h("td", { class: "r" + (n === 0 ? " pass" : " fail"), "data-label": T("tests.th_serious") }, h("span", { class: "sevcell" }, ico(n === 0 ? "ok" : "warn", 2, 14), String(n))), h("td", { class: "wide", "data-label": T("tests.th_found") }, T(w))))));
    $("liveRun").addEventListener("click", () => {
      const tb = $("liveTable"); tb.replaceChildren();
      if (!ENG) { tb.append(h("caption", { style: "text-align:left;padding:6px 0" }, T("tests.live_wait"))); return; }
      const qs = ["GA-1201A tripped on high vibration, can I restart?", "why does the hexane pump keep failing?", "why is the hexane pump leaking?",
        "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?", "EA-5601 tripped, can I restart it?",
        "is it safe to keep running GA-1201A at 5 mm/s vibration?", "what is the warranty period of GA-1201A?"];
      tb.append(h("thead", {}, h("tr", {}, h("th", {}, T("tests.th_q")), h("th", {}, T("tests.th_result")), h("th", { class: "r" }, T("tests.th_verbatim")), h("th", { class: "r" }, T("tests.th_ms")))));
      const body = h("tbody");
      for (const q of qs) {
        const a = ENG.ask(q), v = a.verification;
        body.append(h("tr", {}, h("td", { class: "wide", "data-label": T("tests.th_q") }, q), h("td", { "data-label": T("tests.th_result") }, statusPill(a.status)), h("td", { class: "r", "data-label": T("tests.th_verbatim") }, v ? `${v.verbatim.passed}/${v.verbatim.checked}` : "-"), h("td", { class: "r", "data-label": T("tests.th_ms") }, a.latency_ms)));
      }
      tb.append(body);
    });
    const lim = [1, 2, 3, 4, 5, 6].map((i) => T("tests.lim_" + i));
    $("limits").append(...lim.map((x) => h("li", {}, x)));
  }

  /* ------------------------------------------------------ glossary drawer */
  const GLOSSARY = ["failure_chain", "lesson_latency", "opl", "permissive", "moc", "interlock", "evidence_id",
    "verbatim", "grounding", "confidence", "abstain", "escalation", "pid"];
  let glossReturnFocus = null;
  function openGlossary(id, trigger) {
    const from = trigger || document.activeElement;
    glossReturnFocus = from && innerWidth <= 760 && $("navdrawer").contains(from) ? $("menutog") : from;
    closeMobileNav(false);
    closeEvidenceSheet(false);
    const g = $("glossary");
    g.hidden = false;
    $("glossScrim").hidden = false;
    document.body.classList.add("drawerlock");
    g.querySelectorAll(".gl.hit").forEach((x) => x.classList.remove("hit"));
    const target = id ? $("gl-" + id) : null;
    g.scrollTop = 0;
    if (target) { target.classList.add("hit"); try { target.scrollIntoView({ block: "center" }); } catch (e) { /* non-browser host */ } }
    $("glossClose").focus();
  }
  function closeGlossary(returnFocus = true) {
    const g = $("glossary");
    if (!g || g.hidden) return;
    g.hidden = true;
    $("glossScrim").hidden = true;
    document.body.classList.remove("drawerlock");
    if (returnFocus && glossReturnFocus && glossReturnFocus.focus) glossReturnFocus.focus();
    glossReturnFocus = null;
  }
  function initGlossary() {
    $("glossList").replaceChildren(...GLOSSARY.map((id) => h("div", { class: "gl", id: "gl-" + id },
      h("dt", {}, T(`gloss.${id}.term`)), h("dd", {}, T(`gloss.${id}.def`)))));
    $("glossClose").addEventListener("click", () => closeGlossary());
    $("glossScrim").addEventListener("click", () => closeGlossary());
    $("glossBtn").addEventListener("click", (e) => openGlossary(null, e.currentTarget));
    /* the drawer is modal: its only control keeps focus */
    $("glossary").addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); $("glossClose").focus(); } });
  }

  /* ------------------------------------------------ first-use orientation */
  const ORIENT_KEY = "cascade.orientation.dismissed";
  function showOrientation() {
    if (location.hash && location.hash !== "#ask") { location.hash = "#ask"; route(); }
    $("orient").hidden = false;
    $("orientTitle").focus();
    try { $("orient").scrollIntoView({ block: "start" }); } catch (e) { /* non-browser host */ }
  }
  function dismissOrientation() {
    $("orient").hidden = true;
    try { localStorage.setItem(ORIENT_KEY, "1"); } catch (e) { /* storage may be blocked */ }
    $("q").focus();
  }
  function initOrientation() {
    let dismissed = false;
    try { dismissed = localStorage.getItem(ORIENT_KEY) === "1"; } catch (e) { /* storage may be blocked */ }
    $("orient").hidden = dismissed;
    $("orientClose").addEventListener("click", dismissOrientation);
    $("orientOk").addEventListener("click", dismissOrientation);
    $("orientGloss").addEventListener("click", (e) => openGlossary(null, e.currentTarget));
    $("helpBtn").addEventListener("click", () => { closeMobileNav(false); showOrientation(); });
  }

  /* ------------------------------------------------------------ chat
     A conversational layer over the same deterministic engine the Ask screen uses
     (ENG.ask). The chat never writes answer text: every card shows the engine's own
     status, headline, safety/escalation wording and evidence. Session memory only
     rewrites the QUESTION (adding the remembered asset tag), shown to the user as
     "Asked as". History lives in memory for this page session; no network. */
  const CHAT_STARTERS = ["GA-1201A tripped on high vibration, can I restart?", "why does the hexane pump keep failing?",
    "why is the hexane pump leaking?", "EA-5601 tripped, can I restart it?", "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?"];
  const CHAT_DELAY_MS = 260;
  const FOLLOW_CUE = /\b(it|its|it's|this|that|these|those|same|there)\b|what about|how about|\b\w+nya\b/i;
  const SWITCH_CUE = /^\s*(and|what about|how about|same for|bagaimana dengan|kalau|untuk)\b/i;
  const TAG_RE = /\b[A-Z]{2,4}-\d{3,5}[A-Z]?\b/gi;
  let chatMemory = { tag: null, lastQuery: null };
  let chatReturnFocus = null, chatBusy = false;
  const chatThread = () => $("chatThread");
  const chatNearBottom = () => { const t = chatThread(); return t.scrollHeight - t.scrollTop - t.clientHeight < 80; };
  const normQ = (q) => ws(q).toLowerCase();

  function resolveChatQuery(q) {
    const assetTags = new Set(assetRows().map((r) => r.tag));
    const tags = [...new Set((q.match(TAG_RE) || []).map((t) => t.toUpperCase()).filter((t) => assetTags.has(t)))];
    const mem = chatMemory;
    /* "and for EA-5601?" -> the previous question with the asset swapped */
    if (mem.tag && mem.lastQuery && tags.length === 1 && tags[0] !== mem.tag && SWITCH_CUE.test(q)
      && q.split(/\s+/).length <= 6 && mem.lastQuery.includes(mem.tag)) {
      return { query: mem.lastQuery.split(mem.tag).join(tags[0]), rewritten: true };
    }
    if (!mem.tag || tags.length || !FOLLOW_CUE.test(q)) return { query: q, rewritten: false };
    /* only when the engine itself finds no asset in the question */
    if (ENG.ask(q).asset) return { query: q, rewritten: false };
    return { query: `${q} (${mem.tag})`, rewritten: true };
  }

  function chatNavigate(hash) {
    if (innerWidth <= 1080) closeChat(false);
    go(hash);
  }
  function chatOpenDoc(id) {
    if (innerWidth <= 1080) closeChat(false);
    openDocument(id);
  }
  function chatOpenFull(query) {
    closeChat(false);
    ask(query);
    const box = $("answer");
    if (box) { box.setAttribute("tabindex", "-1"); box.focus(); }
  }

  /* follow-ups only from data the answer already references, each pre-checked with the engine */
  function chatFollowups(a, query) {
    const out = [], seen = new Set([normQ(query)]);
    const tryAsk = (q) => {
      if (out.length >= 3 || seen.has(normQ(q))) return;
      seen.add(normQ(q));
      let r = null;
      try { r = ENG.ask(q); } catch (e) { r = null; }
      if (r && (r.status === "answered" || r.status === "sources_only")) out.push({ kind: "ask", label: q, q });
    };
    const tag = a.asset && a.asset.tag;
    if (a.status === "needs_clarification" && (a.indexed_assets || []).length) {
      return a.indexed_assets.slice(0, 3).map((x) => ({ kind: "ask", label: T("chat.use_tag", { tag: x.tag }), q: `${query} ${x.tag}` }));
    }
    if (tag) {
      if (a.intent !== "RECURRING" && ALL.some((c) => c.tag === tag)) tryAsk(`Why does ${tag} keep failing?`);
      if (a.intent !== "TRIP_RESTART" && ilFor(tag)) tryAsk(`${tag} tripped, can I restart it?`);
    }
    if (a.status !== "abstained" && a.status !== "needs_clarification") {
      const chainEv = (a.evidence || []).find((e) => e.kind === "CHAIN" && resolveChain(e.doc));
      if (chainEv && out.length < 3) out.push({ kind: "open", label: T("chat.open_chain", { id: chainEv.doc }), hash: "#chain/" + chainEv.doc });
      const docs = new Set(documentRows().map((d) => d.id));
      const docEv = (a.evidence || []).find((e) => (e.kind === "OPL" || e.kind === "INTERLOCK" || e.kind === "DATASHEET") && docs.has(e.doc));
      if (docEv && out.length < 3) out.push({ kind: "doc", label: T("chat.open_doc", { id: docEv.doc }), id: docEv.doc });
    }
    if (!tag || a.status === "abstained" || a.status === "needs_clarification") {
      for (const o of nearestTopics(a)) tryAsk(o.q);
    }
    if (tag && out.length < 3) out.push({ kind: "open", label: T("chat.open_asset", { tag }), hash: "#asset/" + tag });
    return out.slice(0, 3);
  }

  function chatSource(card, a, eid, chip) {
    const slot = card.querySelector(".cardsrc");
    const already = chip.getAttribute("aria-pressed") === "true";
    card.querySelectorAll(".cardev .ev").forEach((b) => b.setAttribute("aria-pressed", "false"));
    slot.replaceChildren();
    slot.hidden = true;
    if (already) return;
    const e = a.evidence.find((x) => x.eid === eid);
    if (!e) return;
    chip.setAttribute("aria-pressed", "true");
    const cited = a.sections.flatMap((x) => x.items).filter((i) => i.evidence.includes(eid));
    const kv = [[T("kv.locator"), e.locator]];
    const m = e.meta || {};
    if (m.date_shared) kv.push([T("kv.shared"), fmtDate(m.date_shared)]);
    if (m.approved_by) kv.push([T("kv.approved_by"), m.approved_by]);
    if (m.revision) kv.push([T("kv.revision"), T("kv.rev", { r: m.revision })]);
    if (m.date) kv.push([T("kv.reported"), fmtDate(m.date)]);
    const { src, firstHit } = sourceBody(e, cited);
    slot.append(h("div", { class: "srchead" }, h("span", {}, T("chat.source_of", { eid: e.eid, type: srcType(e.kind), label: e.label })),
      h("button", { class: "btn ghost", type: "button", onclick: () => { slot.hidden = true; chip.setAttribute("aria-pressed", "false"); chip.focus(); } }, T("chat.hide_source"))),
      h("dl", { class: "kv" }, kv.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])), src);
    slot.hidden = false;
    if (firstHit) requestAnimationFrame(() => { src.scrollTop = Math.max(0, firstHit.offsetTop - 30); });
  }

  function renderBotCard(a, query) {
    const hasSafety = a.safety_critical || a.escalation;
    const crit = a.safety_critical || a.status === "refused_deviation" || a.status === "abstained";
    const card = h("article", { class: "botcard st-" + a.status + (hasSafety ? (crit ? " crit" : " warn") : ""),
      "aria-label": T("chat.bot"), "data-status": a.status, "data-query": query, "data-asset": (a.asset && a.asset.tag) || "" });
    /* safety/escalation: the engine's wording, unchanged and first */
    if (hasSafety) {
      card.append(h("div", { class: "chatsafety" + (crit ? "" : " warn") }, ico("warn"), h("div", {},
        a.safety_critical ? h("b", {}, T("answer.safety_critical", { flags: a.safety_flags.join(" - ") })) : h("b", {}, T("answer.escalation_required")),
        a.escalation ? h("div", { class: "esc" }, h("strong", {}, T("answer.escalate_to")), a.escalation.role) : null,
        a.escalation ? h("div", { class: "escwhy" }, a.escalation.why) : null)));
    }
    card.append(h("div", { class: "cardhead" }, statusPill(a.status),
      a.asset ? h("a", { class: "tag", href: "#asset/" + a.asset.tag, onclick: (e) => { e.preventDefault(); chatNavigate("#asset/" + a.asset.tag); } }, a.asset.tag) : null),
      h("p", { class: "cardanswer" }, a.headline));
    if (a.status === "abstained") card.append(h("p", { class: "cardnote nodata" }, T("chat.no_data")));
    if (a.reason && a.status !== "answered") card.append(h("p", { class: "cardnote" }, a.reason));
    for (const sec of a.sections.filter((x) => x.kind === "refusal")) {
      card.append(h("div", { class: "cardblock refusal" }, h("b", {}, sec.title), h("ul", {}, sec.items.map((i) => h("li", {}, i.text)))));
    }
    for (const sec of a.sections.filter((x) => x.kind === "not_verified")) {
      card.append(h("div", { class: "cardblock nv" }, h("b", {}, sec.title), h("ul", {}, sec.items.map((i) => h("li", {}, i.text)))));
    }
    const ev = a.evidence || [];
    if (ev.length) {
      const shown = ev.slice(0, 8);
      card.append(h("div", { class: "cardev" }, h("span", { class: "label" }, T("chat.sources")),
        ...shown.map((e) => {
          const type = srcType(e.kind), name = T("ev.aria", { eid: e.eid, type });
          const chip = h("button", { class: "ev", type: "button", "data-eid": e.eid, "aria-pressed": "false", "aria-label": name, title: name },
            h("span", { class: "evid" }, e.eid), " ", h("span", { class: "evtype" }, type));
          chip.addEventListener("click", () => chatSource(card, a, e.eid, chip));
          return chip;
        }),
        ev.length > shown.length ? h("span", { class: "more" }, T("chat.more_sources", { n: ev.length - shown.length })) : null),
        h("div", { class: "cardsrc", hidden: true }));
    }
    card.append(h("div", { class: "cardfoot" }, h("button", { class: "btn ghost", type: "button", onclick: () => chatOpenFull(query) },
      T("chat.open_full"), ico("arrow", 1.8, 14))));
    const follow = chatFollowups(a, query);
    if (follow.length) {
      card.append(h("div", { class: "followups" },
        h("span", { class: "label" }, a.status === "abstained" || (!a.asset && a.status !== "needs_clarification") ? T("chat.nearest") : T("chat.followups")),
        ...follow.map((f) => h("button", { class: "chip", type: "button", onclick: () => {
          if (f.kind === "ask") chatSend(f.q);
          else if (f.kind === "doc") chatOpenDoc(f.id);
          else chatNavigate(f.hash);
        } }, f.label))));
    }
    answerFingerprint(a).then((f) => { card.dataset.fingerprint = f; }).catch(() => { /* no WebCrypto: fingerprint omitted */ });
    return card;
  }

  function updateChatContext() {
    const box = $("chatCtx");
    const tag = chatMemory.tag;
    box.hidden = !tag;
    box.replaceChildren();
    if (!tag) return;
    box.append(h("span", {}, T("chat.context", { tag })),
      h("button", { class: "iconbtn", type: "button", "aria-label": T("chat.context_clear", { tag }),
        onclick: () => { chatMemory = { tag: null, lastQuery: null }; updateChatContext(); $("chatInput").focus(); } }, ico("x", 1.8, 16)));
  }
  function renderChatEmpty() {
    chatThread().replaceChildren(h("div", { class: "chatempty" },
      h("p", {}, T("chat.empty_can")), h("p", {}, T("chat.empty_cannot")),
      h("span", { class: "label" }, T("chat.starters")),
      h("div", { class: "chips" }, CHAT_STARTERS.map((q) => h("button", { class: "chip", type: "button", onclick: () => chatSend(q) }, q)))));
  }
  function scrollChatTo(el) {
    const t = chatThread();
    t.scrollTop = Math.max(0, el.offsetTop - t.offsetTop - 8);
  }

  /* ----------------------------------------------------- chat lookups
     A router in front of the engine for plain lookup requests (asset details, asset
     list, open a chain/document, compare two assets). Lookup cards show labeled
     fields and links from data the app already holds: no sentences, no summaries, no
     advice, no engine status and no answer fingerprint. Anything that reads like an
     engine question goes to the engine as before. */
  const ENGINE_CUE = /\b(restart\w*|trip\w*|bypass\w*|overrid\w*|why|keeps? failing|steps?|procedures?|limits?|set ?points?|can i|should i|safe\w*|defeat\w*|disabl\w*|inhibit\w*|jumper\w*|isolat\w*)\b/i;
  const ASSET_TAG_LIKE = /\b[a-z]{2}-\d{4}[a-z]?\b/gi;
  const LOOKUP_WORDS = new Set("give me asset assets detail details show tell about overview info information summary profile for the of on please equipment data record card what is are a an this display view see get".split(" "));
  const DETAIL_WORDS = /\b(assets?|details?|overview|info|information|summary|profile|show|tell|about)\b/i;
  const OPEN_VERB = /^\s*(please\s+)?(open|show|find|view|display|go to)\b/i;
  const RECORD_WORDS = /\b(chains?|opls?|one[- ]point lessons?|lessons?|interlocks?|datasheets?|data sheets?|documents?|docs?)\b/i;
  let bundleText = null;
  const inBundle = (tag) => { if (bundleText === null) bundleText = JSON.stringify(B).toUpperCase(); return bundleText.includes(tag); };
  const assetIndex = () => new Map(assetRows().map((r) => [r.tag, r]));
  function tagsIn(q) {
    const known = assetIndex(), found = [], unknown = [];
    for (const m of q.match(ASSET_TAG_LIKE) || []) {
      const t = m.toUpperCase();
      if (known.has(t)) { if (!found.includes(t)) found.push(t); }
      else if (!inBundle(t) && !unknown.includes(t)) unknown.push(t);   /* instrument tags such as FV-1201 are in the data, not unknown */
    }
    return { found, unknown };
  }
  const leftoverWords = (q) => ws(q).toLowerCase().replace(ASSET_TAG_LIKE, " ").split(/[^a-z0-9-]+/).filter((w) => w && !LOOKUP_WORDS.has(w));
  function recordItems() {
    const typeOfDoc = (id) => (/^OPL-/.test(id) ? "OPL" : /-IL-/.test(id) ? "INTERLOCK" : /-DS-/.test(id) ? "DATASHEET" : "OPL");
    return [
      ...ALL.map((c) => ({ kind: "chain", type: "CHAIN", id: c.chain_id, tag: c.tag, title: T("lookup.chain_title", { mech: title(c.root_mechanism), tag: c.tag }) })),
      ...documentRows().map((d) => ({ kind: "doc", type: typeOfDoc(d.id), id: d.id, tag: d.tag, title: d.title })),
    ];
  }
  const recordScore = (item, words) => words.filter((w) => w.length > 2 && (item.title + " " + item.id).toLowerCase().includes(w)).length;

  function routeLookup(text) {
    const q = ws(text), ql = q.toLowerCase();
    const { found, unknown } = tagsIn(q);
    if (/\bcompare\b|\bvs\.?\b|\bversus\b/i.test(q)) return { kind: "compare", found, unknown };
    if (!found.length && !unknown.length && /\b(list|which|what|show|all)\b[\s\S]*\b(assets|equipment)\b/i.test(q) && !/\bdetails?\b/i.test(q)) return { kind: "list" };
    const items = recordItems();
    const explicitOpen = OPEN_VERB.test(q) && RECORD_WORDS.test(q);
    const byId = items.filter((it) => ql.includes(it.id.toLowerCase()));
    const byTitle = items.filter((it) => it.kind === "doc" && it.title.length > 8 && ql.includes(it.title.toLowerCase()));
    if (explicitOpen) {
      if (byId.length || byTitle.length) return { kind: "open", matches: byId.length ? byId : byTitle };
      const want = /\bchains?\b/i.test(q) ? "CHAIN" : /\binterlocks?\b/i.test(q) ? "INTERLOCK" : /\bdata ?sheets?\b/i.test(q) ? "DATASHEET" : /\b(opls?|one[- ]point|lessons?)\b/i.test(q) ? "OPL" : null;
      let pool = items.filter((it) => (!want || it.type === want) && (!found.length || found.includes(it.tag)));
      const words = ws(ql.replace(ASSET_TAG_LIKE, " ").replace(OPEN_VERB, " ").replace(RECORD_WORDS, " ")).split(/[^a-z0-9-]+/)
        .filter((w) => w && !LOOKUP_WORDS.has(w) && !STOP.has(w));
      if (words.length) pool = pool.map((it) => [it, recordScore(it, words)]).filter(([, s]) => s > 0).sort((x, y) => y[1] - x[1]).map(([it]) => it);
      if (unknown.length && !found.length) pool = [];
      return { kind: "open", matches: pool, words: words.length ? words : ql.split(/\W+/) };
    }
    if (ENGINE_CUE.test(q)) return null;
    if (byId.length || byTitle.length) return { kind: "open", matches: byId.length ? byId : byTitle };
    const extra = leftoverWords(q);
    if (found.length === 1 && !unknown.length && !extra.length) return { kind: "asset", tag: found[0] };
    if (unknown.length && !found.length && !extra.length) return { kind: "unknown", tags: unknown };
    if (!found.length && !unknown.length && !extra.length && DETAIL_WORDS.test(q) && /\b(assets?|details?|overview|profile|summary|info|information)\b/i.test(q)) return { kind: "pick" };
    return null;
  }

  function lookupCard(kind) {
    return h("article", { class: "botcard lookupcard", "data-kind": "lookup", "data-lookup": kind, "aria-label": T("lookup.label") },
      h("div", { class: "cardhead" }, h("span", { class: "recordtag" }, ico("doc", 1.8, 14), T("lookup.label"))));
  }
  function assetButtons(onPick, exclude) {
    const rows = assetRows().filter((r) => r.tag !== exclude).sort((x, y) => Number(INDEXED.has(y.tag)) - Number(INDEXED.has(x.tag)) || (x.tag < y.tag ? -1 : 1));
    return h("div", { class: "followups lkpick" }, rows.map((r) => h("button", { class: "chip", type: "button", "data-tag": r.tag,
      "aria-label": T("lookup.details_aria", { tag: r.tag }), onclick: () => onPick(r.tag) },
      h("span", { class: "mono" }, r.tag), " ", r.equipment.toLowerCase())));
  }
  /* the asset page's fields, in the same order and with the same labels */
  function assetFields(r) {
    const chains = r.chains || [];
    const opls = oplFor(r.tag);
    const linked = new Set(chains.flatMap((c) => c.wos)).size;
    const locn = chains.filter((c) => c.loss_of_containment).length;
    const rows = [
      [T("assets.th_equipment"), r.equipment.toLowerCase()],
      [T("assets.th_crit"), r.criticality.toLowerCase()],
      [T("lookup.area"), opls[0] && opls[0].area ? opls[0].area.toLowerCase() : "-"],
      [T("asset.m_chains"), String(chains.length)],
      [T("asset.m_fail"), `${r.fail} · ${T("asset.m_fail_sub", { n: r.wo })}`],
      [T("asset.m_linked"), `${linked} · ${T("asset.m_inside")}`],
      [T("asset.m_downtime"), `${hrs(chains.reduce((x, c) => x + c.total_downtime_h, 0))} · ${T("asset.m_inside")}`],
      [T("asset.m_cost"), `${rpJt(chains.reduce((x, c) => x + c.total_cost_idr, 0))} · ${T("asset.m_inside")}`],
      [T("asset.m_loc"), String(locn)],
      [T("assets.th_docs"), INDEXED.has(r.tag) ? T("assets.indexed") : T("assets.wo_only")],
    ];
    return rows;
  }
  function renderAssetLookup(tag) {
    const r = assetIndex().get(tag);
    const card = lookupCard("asset");
    card.dataset.asset = tag;
    card.append(h("h3", { class: "lkhead" }, h("span", { class: "mono" }, tag), " ", h("span", { class: "lkname" }, r.equipment.toLowerCase())),
      h("dl", { class: "lkfields" }, assetFields(r).map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v)))));
    const chains = r.chains || [];
    card.append(h("div", { class: "lksec" }, h("span", { class: "label" }, T("asset.chains_h")),
      chains.length ? h("ul", { class: "lklist" }, chains.map((c) => h("li", {},
        h("a", { class: "tag", href: "#chain/" + c.chain_id, onclick: (e) => { e.preventDefault(); chatNavigate("#chain/" + c.chain_id); } }, c.chain_id),
        " ", h("span", { class: "mech " + (c.root_mechanism === "FOULING" ? "f" : "m") }, title(c.root_mechanism)),
        c.loss_of_containment ? h("span", { class: "pill loc" }, ico("warn", 2, 14), T("common.loc")) : null)))
        : h("p", { class: "cardnote" }, T("common.no_chain"))));
    const docs = documentRows().filter((d) => d.tag === tag);
    if (docs.length) {
      const key = [...docs.filter((d) => !/^OPL-/.test(d.id)), ...docs.filter((d) => /^OPL-/.test(d.id))].slice(0, 5);
      card.append(h("div", { class: "lksec" }, h("span", { class: "label" }, T("lookup.docs")),
        h("div", { class: "cardev" }, key.map((d) => h("button", { class: "chip idchip", type: "button", "aria-label": T("lookup.open_aria", { id: d.id }) + " - " + d.title, onclick: () => chatOpenDoc(d.id) }, d.id))),
        docs.length > key.length ? h("span", { class: "cardnote" }, T("lookup.more_docs", { n: docs.length - key.length })) : null));
    } else {
      card.append(h("p", { class: "cardnote" }, T("asset.no_docs")));
    }
    card.append(h("div", { class: "cardfoot" }, h("a", { class: "btn ghost lkopen", href: "#asset/" + tag,
      onclick: (e) => { e.preventDefault(); chatNavigate("#asset/" + tag); } }, T("lookup.open_asset"), ico("arrow", 1.8, 14))));
    const follow = chatFollowups({ status: "answered", intent: "LOOKUP", asset: { tag }, evidence: [], sections: [] }, "")
      .filter((f) => !(f.kind === "open" && f.hash === "#asset/" + tag));
    if (follow.length) {
      card.append(h("div", { class: "followups" }, h("span", { class: "label" }, T("chat.followups")),
        ...follow.map((f) => h("button", { class: "chip", type: "button", onclick: () => (f.kind === "ask" ? chatSend(f.q) : f.kind === "doc" ? chatOpenDoc(f.id) : chatNavigate(f.hash)) }, f.label))));
    }
    return card;
  }
  function renderRecordLookup(route) {
    const card = lookupCard("open");
    const m = route.matches || [];
    const item = (it) => h("li", { class: "lkrec" },
      h("div", { class: "lkrectext" }, h("span", { class: "mono" }, it.id), h("span", {}, it.title),
        h("span", { class: "cardnote" }, `${T("lookup.type")}: ${srcType(it.type)} · ${T("lookup.asset")}: ${it.tag}`)),
      h("button", { class: "btn sec", type: "button", "aria-label": T("lookup.open_aria", { id: it.id }),
        onclick: () => (it.kind === "chain" ? chatNavigate("#chain/" + it.id) : chatOpenDoc(it.id)) }, T("lookup.open")));
    if (m.length === 1) card.append(h("ul", { class: "lklist lkrecs" }, item(m[0])));
    else if (m.length > 1) card.append(h("p", { class: "cardanswer" }, T("lookup.choose")), h("ul", { class: "lklist lkrecs" }, m.slice(0, 5).map(item)));
    else {
      const words = (route.words || []).filter((w) => w.length > 2);
      const all = recordItems();
      const near = all.map((it) => [it, recordScore(it, words)]).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([it]) => it);
      card.dataset.lookup = "none";
      card.append(h("p", { class: "cardanswer" }, T("lookup.not_found")), h("span", { class: "label" }, T("lookup.nearest")), h("ul", { class: "lklist lkrecs" }, near.map(item)));
    }
    return card;
  }
  function renderListLookup() {
    const rows = assetRows();
    const card = lookupCard("list");
    card.append(h("h3", { class: "lkhead" }, T("lookup.list_title", { n: rows.length })),
      h("ul", { class: "lklist lkassets" }, rows.map((r) => h("li", {},
        h("span", { class: "mono" }, r.tag), h("span", { class: "lkname" }, r.equipment.toLowerCase()),
        h("button", { class: "btn sec", type: "button", "data-tag": r.tag, "aria-label": T("lookup.details_aria", { tag: r.tag }),
          onclick: () => chatSend(T("lookup.ask_details", { tag: r.tag })) }, T("lookup.details"))))));
    return card;
  }
  function renderPickLookup(unknown) {
    const card = lookupCard(unknown ? "unknown" : "pick");
    if (unknown) card.append(h("p", { class: "cardanswer" }, T("lookup.not_asset")), h("div", { class: "cardev" }, unknown.map((t) => h("span", { class: "tag" }, t))));
    card.append(h("p", { class: "cardnote" }, T("lookup.pick_asset")), assetButtons((tag) => chatSend(T("lookup.ask_details", { tag }))));
    return card;
  }
  function renderCompareLookup(route) {
    const idx = assetIndex();
    if (route.unknown.length) return renderPickLookup(route.unknown);
    if (route.found.length < 2) {
      const card = lookupCard("compare-pick");
      const first = route.found[0];
      if (first) card.append(h("p", { class: "cardnote" }, T("lookup.compare_pick", { tag: first })),
        assetButtons((tag) => chatSend(T("lookup.ask_compare", { a: first, b: tag })), first));
      else card.append(h("p", { class: "cardnote" }, T("lookup.pick_asset")), assetButtons((tag) => chatSend(T("lookup.ask_details", { tag }))));
      return card;
    }
    const [ta, tb] = route.found;
    const fa = assetFields(idx.get(ta)), fb = assetFields(idx.get(tb));
    const card = lookupCard("compare");
    card.dataset.assets = ta + "," + tb;
    /* wide: label | A | B; narrow (<=430 px): one block per asset with the same labels */
    card.append(h("div", { class: "cmpwide", role: "table", "aria-label": `${ta} / ${tb}` },
      h("div", { class: "cmprow cmphead", role: "row" }, h("span", { role: "columnheader" }, ""), h("span", { role: "columnheader", class: "mono" }, ta), h("span", { role: "columnheader", class: "mono" }, tb)),
      ...fa.map(([k, v], i) => h("div", { class: "cmprow", role: "row" }, h("span", { role: "rowheader" }, k), h("span", { role: "cell" }, v), h("span", { role: "cell" }, fb[i][1])))),
    h("div", { class: "cmpstack" }, [[ta, fa], [tb, fb]].map(([t, f]) => h("section", {},
      h("h3", { class: "lkhead mono" }, t), h("dl", { class: "lkfields" }, f.map(([k, v]) => h("div", {}, h("dt", {}, k), h("dd", {}, v))))))),
    h("div", { class: "cardfoot lkfoot" }, [ta, tb].map((t) => h("a", { class: "btn ghost lkopen", href: "#asset/" + t,
      onclick: (e) => { e.preventDefault(); chatNavigate("#asset/" + t); } }, `${T("lookup.open_asset")} · ${t}`))));
    return card;
  }
  function renderLookup(route) {
    if (route.kind === "asset") { chatMemory = { tag: route.tag, lastQuery: null }; return renderAssetLookup(route.tag); }
    if (route.kind === "list") return renderListLookup();
    if (route.kind === "open") return renderRecordLookup(route);
    if (route.kind === "compare") return renderCompareLookup(route);
    if (route.kind === "unknown") return renderPickLookup(route.tags);
    return renderPickLookup(null);
  }

  function chatSend(text) {
    const q = ws(text);
    if (!q || chatBusy) return;
    const thread = chatThread(), input = $("chatInput");
    if (!ENG) { thread.append(h("p", { class: "cardnote", role: "status" }, T("chat.loading"))); return; }
    input.value = "";
    sizeChatInput();
    const empty = thread.querySelector(".chatempty");
    if (empty) empty.remove();
    let route = null;
    try { route = routeLookup(q); } catch (e) { route = null; }
    if (route) {
      thread.append(h("div", { class: "msg-user" }, h("span", { class: "sr" }, T("chat.you") + ": "), q));
      const thinking = h("div", { class: "chatthinking", role: "status" }, h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), T("chat.thinking"));
      thread.append(thinking);
      thread.scrollTop = thread.scrollHeight;
      chatBusy = true;
      setTimeout(() => {
        const follow = chatNearBottom();
        thinking.remove();
        let card;
        try { card = renderLookup(route); } catch (e) { card = h("article", { class: "botcard crit" }, h("p", { class: "cardnote" }, T("chat.error"))); }
        thread.append(card);
        updateChatContext();
        if (follow) { scrollChatTo(card); $("chatJump").hidden = true; } else $("chatJump").hidden = false;
        chatBusy = false;
        if (!$("chat").hidden) input.focus();
      }, CHAT_DELAY_MS);
      return;
    }
    let resolved;
    try { resolved = resolveChatQuery(q); } catch (e) { resolved = { query: q, rewritten: false }; }
    thread.append(h("div", { class: "msg-user" }, h("span", { class: "sr" }, T("chat.you") + ": "), q,
      resolved.rewritten ? h("span", { class: "askedas" }, T("chat.asked_as", { q: resolved.query })) : null));
    const thinking = h("div", { class: "chatthinking", role: "status" }, h("span", { class: "dots", "aria-hidden": "true" }, h("i"), h("i"), h("i")), T("chat.thinking"));
    thread.append(thinking);
    thread.scrollTop = thread.scrollHeight;
    chatBusy = true;
    setTimeout(() => {
      const follow = chatNearBottom();
      thinking.remove();
      let a = null, res = null;
      try { res = resolveQuestion(resolved.query); a = res.clarify ? res.raw : res.answer; } catch (e) { a = null; }
      let card;
      if (!a) card = h("article", { class: "botcard crit" }, h("p", { class: "cardnote" }, T("chat.error")));
      else if (res.clarify) {
        card = h("article", { class: "botcard st-needs_clarification clarifycard", "aria-label": T("chat.bot"), "data-status": "clarify", "data-query": resolved.query, "data-asset": res.clarify.tag },
          ...clarifyBody(res, (q) => chatSend(q), (id) => chatOpenDoc(id), () => {
            const full = renderBotCard(res.raw, resolved.query);
            card.after(full);
            scrollChatTo(full);
          }));
      } else {
        card = renderBotCard(a, res.query);
        if (res.rewritten) {
          const last = [...thread.querySelectorAll(".msg-user")].pop();
          if (last && !last.querySelector(".askedas")) last.append(h("span", { class: "askedas" }, T("chat.asked_as", { q: res.query })));
        }
      }
      thread.append(card);
      if (a && a.asset) chatMemory = { tag: a.asset.tag, lastQuery: resolved.query };
      updateChatContext();
      if (follow) { scrollChatTo(card); $("chatJump").hidden = true; } else $("chatJump").hidden = false;
      chatBusy = false;
      if (!$("chat").hidden) input.focus();
    }, CHAT_DELAY_MS);
  }
  function sizeChatInput() {
    const i = $("chatInput");
    i.style.height = "auto";
    i.style.height = Math.min(132, Math.max(44, i.scrollHeight + 3)) + "px";
  }
  function syncChatViewport() {
    const c = $("chat"), vv = window.visualViewport;
    if (!c) return;
    c.setAttribute("aria-modal", String(innerWidth <= 760));
    if (vv && innerWidth <= 760) { c.style.setProperty("--vvh", vv.height + "px"); c.style.setProperty("--vvt", vv.offsetTop + "px"); }
    else { c.style.removeProperty("--vvh"); c.style.removeProperty("--vvt"); }
  }
  function openChat(trigger) {
    const from = trigger || document.activeElement;
    chatReturnFocus = from && innerWidth <= 760 && $("navdrawer").contains(from) ? $("menutog") : from;
    closeMobileNav(false);
    closeEvidenceSheet(false);
    $("chat").hidden = false;
    $("chatFab").hidden = true; /* the panel has its own close control */
    if (innerWidth <= 760) document.body.classList.add("chatlock");
    if (!chatThread().childElementCount) renderChatEmpty();
    syncChatViewport();
    updateChatContext();
    sizeChatInput();
    $("chatInput").focus();
  }
  function closeChat(returnFocus = true) {
    const c = $("chat");
    if (!c || c.hidden) return;
    c.hidden = true;
    $("chatFab").hidden = false;
    document.body.classList.remove("chatlock");
    if (returnFocus && chatReturnFocus && chatReturnFocus.focus) chatReturnFocus.focus();
    chatReturnFocus = null;
  }
  function newChat() {
    chatMemory = { tag: null, lastQuery: null };
    renderChatEmpty();
    updateChatContext();
    $("chatJump").hidden = true;
    $("chatInput").focus();
  }
  function initChat() {
    $("chatBtn").addEventListener("click", (e) => openChat(e.currentTarget));
    $("chatHero").addEventListener("click", (e) => openChat(e.currentTarget));
    $("chatFab").addEventListener("click", (e) => openChat(e.currentTarget));
    $("chatClose").addEventListener("click", () => closeChat());
    $("chatNew").addEventListener("click", newChat);
    $("chatForm").addEventListener("submit", (e) => { e.preventDefault(); chatSend($("chatInput").value); });
    $("chatInput").addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatSend($("chatInput").value); }
    });
    $("chatInput").addEventListener("input", sizeChatInput);
    chatThread().addEventListener("scroll", () => { if (chatNearBottom()) $("chatJump").hidden = true; });
    $("chatJump").addEventListener("click", () => { const t = chatThread(); t.scrollTop = t.scrollHeight; $("chatJump").hidden = true; $("chatInput").focus(); });
    /* full-screen on phones is modal: keep Tab inside the chat */
    $("chat").addEventListener("keydown", (e) => {
      if (e.key !== "Tab" || innerWidth > 760) return;
      const items = [...$("chat").querySelectorAll('button:not([disabled]):not([hidden]),a[href],textarea,[tabindex="0"]')].filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    if (window.visualViewport) { visualViewport.addEventListener("resize", syncChatViewport); visualViewport.addEventListener("scroll", syncChatViewport); }
    addEventListener("resize", syncChatViewport);
  }

  /* ----------------------------------------------------------- logo
     build.py embeds assets/Cascade Logo.* as {mime, b64} (or null). The logo takes the
     old brand mark's place and size, next to the unchanged CASCADE text wordmark. For a
     raster lockup (emblem above the word) the emblem is cut out on a canvas: the flat
     background is ignored and the tallest band of content is kept. Missing logo: the
     original glyph and SVG favicon stay. */
  function logoEmblem(img) {
    const w = img.naturalWidth, hgt = img.naturalHeight;
    if (!w || !hgt) return null;
    const k = Math.min(1, 800 / w), cw = Math.max(1, Math.round(w * k)), ch = Math.max(1, Math.round(hgt * k));
    const probe = document.createElement("canvas");
    probe.width = cw; probe.height = ch;
    const ctx = probe.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, cw, ch);
    const d = ctx.getImageData(0, 0, cw, ch).data, bg = [d[0], d[1], d[2], d[3]];
    const ink = (x, y) => { const i = (y * cw + x) * 4;
      return Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) + Math.abs(d[i + 3] - bg[3]) > 48; };
    /* horizontal bands of content, small gaps merged */
    const rows = [];
    for (let y = 0; y < ch; y++) { let any = false; for (let x = 0; x < cw && !any; x++) any = ink(x, y); rows.push(any); }
    const bands = [], gap = Math.max(2, Math.round(ch * 0.015));
    for (let y = 0; y < ch; y++) {
      if (!rows[y]) continue;
      const last = bands[bands.length - 1];
      if (last && y - last[1] <= gap) last[1] = y; else bands.push([y, y]);
    }
    if (!bands.length) return null;
    const [y0, y1] = bands.reduce((best, b) => (b[1] - b[0] > best[1] - best[0] ? b : best));
    let x0 = cw, x1 = -1;
    for (let y = y0; y <= y1; y++) for (let x = 0; x < cw; x++) if (ink(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; }
    if (x1 < 0) return null;
    const side = Math.max(x1 - x0, y1 - y0) * 1.08, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const square = (size) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const g = c.getContext("2d");
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, size, size);
      g.drawImage(img, (cx - side / 2) / k, (cy - side / 2) / k, side / k, side / k, 0, 0, size, size);
      return c.toDataURL("image/png");
    };
    return { mark: square(96), icon: square(64) };
  }
  function initLogo() {
    let logo = null;
    try { logo = JSON.parse(($("logodata") || {}).textContent || "null"); } catch (e) { logo = null; }
    if (!logo || !logo.b64 || !logo.mime) { document.documentElement.classList.add("nologo"); return; }
    const src = `data:${logo.mime};base64,${logo.b64}`;
    const imgs = [$("brandMark"), $("mobileMark")].map((mark) => {
      const img = h("img", { class: "logoimg", src, alt: T("brand.logo_alt"), decoding: "async" });
      mark.classList.add("logochip");
      mark.replaceChildren(img);
      return img;
    });
    $("favicon").setAttribute("href", src);
    if (logo.mime === "image/svg+xml") return;
    imgs[0].addEventListener("load", () => {
      let emblem = null;
      try { emblem = logoEmblem(imgs[0]); } catch (e) { emblem = null; /* canvas unavailable: keep the whole logo */ }
      if (!emblem) return;
      imgs.forEach((img) => { img.src = emblem.mark; });
      $("favicon").setAttribute("href", emblem.icon);
    }, { once: true });
  }

  /* ----------------------------------------------------------- boot */
  function setEngineStatus(state, text) {
    if (state) $("engine").classList.add(state);
    $("engineText").textContent = text;
    document.querySelectorAll("[data-engine-status]").forEach((el) => { el.textContent = text; if (state) el.dataset.state = state; });
  }
  function boot() {
    applyStaticI18n();
    initLogo();
    buildNav();
    buildTabbar();
    initTheme();
    initGlossary();
    initOrientation();
    initChat();
    renderHome(); renderChainIndex(); renderAssets(); renderPlant(); renderDocs(); renderTests();
    initMobileNav();
    initEvidenceSheet();
    syncCompactCharts();
    /* no view restore from browser storage: a judge opening this file always lands on Home */
    route();
    $("foot").append(BACKEND_MODE
      ? T("foot.backend", { commit: B.meta.engine_commit })
      : T("foot.static", { commit: B.meta.engine_commit }));
    $("askform").addEventListener("submit", (e) => { e.preventDefault(); const q = $("q").value.trim(); if (q) ask(q); });
    setEngineStatus(null, T("engine.indexing", { n: B.passages.length }));
    setTimeout(() => {
      const t0 = performance.now();
      try { ENG = new CascadeEngine.Engine(B); }
      catch (_error) {
        engineFailed = true;
        pendingQuestion = null;
        setEngineStatus("failed", T("engine.failed"));
        showAskNote([h("b", {}, T("error.engine_h")), " ", T("error.engine_body"), " ",
          h("button", { class: "chip on-band", type: "button", onclick: () => location.reload() }, T("error.reload"))], true);
        return;
      }
      const ms = Math.round(performance.now() - t0);
      setEngineStatus("ready", BACKEND_MODE
        ? T("engine.ready_backend", { n: B.passages.length, ms })
        : T("engine.ready", { n: B.passages.length, ms }));
      $("askbtn").disabled = false;
      if (pendingQuestion) { const q = pendingQuestion; pendingQuestion = null; ask(q); }
      /* no boot auto-ask: the demo asks the first question on camera */
    }, 30);
  }
  boot();
})();
