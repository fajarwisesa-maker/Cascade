/* CASCADE UI. Everything on screen is computed by the engine or read from the bundle. */
(function () {
  "use strict";
  const B = JSON.parse(document.getElementById("bundle").textContent);
  const $ = (id) => document.getElementById(id);
  const ns = "http://www.w3.org/2000/svg";
  let ENG = null, current = null, selectedEid = null;

  // ---------------------------------------------------------------- helpers
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
  const rp = (x) => "Rp " + Math.round(x).toLocaleString("en-US");
  const rpJt = (x) => "Rp " + (x / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + " jt";
  const hrs = (x) => (Math.round(x * 10) / 10).toLocaleString("en-US") + " h";
  const fmtDate = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const days = (a, b) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
  const warnIcon = () => { const x = s("svg", { width: 18, height: 18, viewBox: "0 0 24 24", "aria-hidden": "true" });
    x.append(s("path", { d: "M12 3 2 21h20L12 3z", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linejoin": "round" }),
      s("path", { d: "M12 10v5M12 18v.5", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" })); return x; };

  const tip = $("tip");
  function showTip(evt, html) { tip.innerHTML = html; tip.hidden = false; moveTip(evt); }
  function moveTip(evt) {
    const r = tip.getBoundingClientRect();
    let x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + r.width > innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = evt.clientY - r.height - 14;
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  const hideTip = () => { tip.hidden = true; };
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  // ---------------------------------------------------------------- routing
  const VIEWS = ["ask", "chains", "plant", "tests"];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "ask";
    for (const x of VIEWS) {
      $("view-" + x).hidden = x !== v;
      $("tab-" + x).setAttribute("aria-selected", String(x === v));
    }
    try { localStorage.setItem("cascade.view", v); } catch (e) { /* storage may be blocked */ }
  }
  addEventListener("hashchange", route);

  // ---------------------------------------------------------------- ask view
  const EXAMPLES = [
    ["Trip and restart", ["GA-1201A tripped on high vibration, can I restart?", "EA-5601 tripped, can I restart it?"]],
    ["Recurring failure", ["why does the hexane pump keep failing?", "EA-5601 steam trap failed open again, is that part of a pattern?"]],
    ["Bahasa Indonesia", ["kenapa pompa hexane bocor?", "turunkan setting PDAH-5605 jadi 1.0 bar biar alarm tidak bunyi terus"]],
    ["Safety gate", ["can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?", "is it safe to keep running GA-1201A at 5 mm/s vibration?"]],
    ["Design data", ["what is the tube design pressure of the solvent heater?", "what is the vibration trip setpoint for GA-1201A?"]],
    ["Should not answer", ["what is the warranty period of GA-1201A?", "why does the recycle gas compressor keep tripping?"]],
  ];
  function renderExamples() {
    if (matchMedia("(max-width: 640px)").matches) $("exwrap").open = false;
    const box = $("examples");
    for (const [label, qs] of EXAMPLES) {
      box.append(h("div", { class: "exrow" }, h("span", { class: "label" }, label),
        qs.map((q) => h("button", { class: "chip", type: "button", onclick: () => ask(q) }, q))));
    }
  }

  const STATUS_TEXT = {
    answered: "Answered from approved sources", refused_deviation: "Refused · MOC required",
    abstained: "Not answered", needs_clarification: "Needs the equipment tag", sources_only: "Sources only · no recommendation",
  };

  function ask(q) {
    if (!ENG) return;
    $("q").value = q;
    const a = ENG.ask(q);
    current = a;
    renderAnswer(a);
    const firstVerb = a.sections && a.sections.flatMap((x) => x.items).find((i) => i.evidence.length);
    selectEvidence(firstVerb ? firstVerb.evidence[0] : null);
  }

  function evButtons(eids) {
    return h("span", { class: "evs" }, eids.map((e) => h("button", { class: "ev", type: "button", "data-eid": e, "aria-pressed": String(e === selectedEid),
      title: "Show source for " + e, onclick: () => selectEvidence(e, true) }, e)));
  }

  function renderSection(sec) {
    const verbatimAll = sec.items.length && sec.items.every((i) => i.verbatim);
    const head = h("div", { class: "sec-h" }, h("h3", {}, sec.title),
      verbatimAll ? h("span", { class: "vb", title: "Every line matched the source cell and the page text" }, "✓ verbatim · checked") : null,
      sec.note ? h("div", { class: "sec-note" }, sec.note) : null);
    let body;
    if (sec.kind === "steps") {
      body = h("div", { class: "tablewrap" }, h("table", { class: "steps" },
        h("thead", {}, h("tr", {}, h("th", {}, "#"), h("th", {}, "Action"), h("th", {}, "Check / acceptance"), h("th", {}, ""))),
        h("tbody", {}, sec.items.map((it) => {
          const m = it.text.match(/^(\d+)\. (.*)$/);
          return h("tr", {}, h("td", { class: "n" }, m ? m[1] : ""), h("td", {}, m ? m[2] : it.text), h("td", { class: "chk" }, it.check), h("td", {}, evButtons(it.evidence)));
        }))));
    } else if (sec.kind === "chain") {
      body = h("div", {}, sec.items.map((it) => {
        const m = it.text.match(/^(\d{4}-\d{2}-\d{2}) · (WO-\d+) · (.*)$/);
        if (m) {
          const loc = /hexane leak|leak observed/i.test(m[3]);
          return h("div", { class: "evt" + (loc ? " loc" : "") }, h("span", { class: "d" }, m[1]),
            h("span", {}, h("span", { class: "w" }, m[2] + "  "), m[3]), evButtons(it.evidence));
        }
        return h("div", { class: "it derived", style: "padding:4px 0" }, h("span", { class: "tx" }, it.text), evButtons(it.evidence));
      }));
    } else {
      const cls = sec.kind === "not_verified" ? "items nv" : "items";
      body = h("ul", { class: cls }, sec.items.map((it) => {
        const isCE = /^(\s*→ )?[A-Z]\d+ · |^\s*→ EFF/.test(it.text);
        const txCls = "tx" + (isCE ? " ce" + (/^\s*→/.test(it.text) ? " eff" : "") : "") + (sec.kind === "refusal" ? " quote" : "");
        return h("li", { class: "it" }, h("span", { class: txCls }, it.text.replace(/^\s+/, "")), it.evidence.length ? evButtons(it.evidence) : null);
      }));
    }
    return h("section", { class: "sec" }, head, body);
  }

  function renderAnswer(a) {
    const box = $("answer");
    box.replaceChildren();
    const card = h("article", { class: "card answer st-" + a.status, "aria-live": "polite" });
    const asset = a.asset ? h("span", { class: "tagchip", title: a.asset.name || "" }, a.asset.tag + (a.asset.name ? " · " + a.asset.name.toLowerCase() : "")) : null;
    card.append(h("div", { class: "status" }, h("span", { class: "pill" }, STATUS_TEXT[a.status] || a.status), asset,
      h("span", { class: "label" }, a.intent.replace("_", " / ").toLowerCase()),
      h("span", { class: "meta-r" }, `${a.latency_ms} ms in this browser`)));
    card.append(h("div", { class: "headline" }, a.headline));
    if (a.reason) card.append(h("div", { class: "reason" }, a.reason));
    if (a.asset_resolution && a.status !== "needs_clarification") card.append(h("div", { class: "reason small" }, "Asset: " + a.asset_resolution));
    if (a.safety_critical || a.escalation) {
      const esc_ = a.escalation;
      card.append(h("div", { class: "safety" }, warnIcon(), h("div", {},
        a.safety_critical ? h("b", {}, "Safety-critical · " + a.safety_flags.join(" · ")) : null,
        esc_ ? h("div", {}, h("strong", {}, "Escalate to: "), esc_.role, h("div", { class: "small", style: "color:var(--ink-2)" }, esc_.why)) : null)));
    }
    if (a.indexed_assets) card.append(h("div", { class: "reason" }, "Indexed in this pilot: ", a.indexed_assets.map((x) => `${x.tag} (${x.name.toLowerCase()})`).join(", ") + "."));
    if (a.sections.length) card.append(h("div", { class: "sections" }, a.sections.map(renderSection)));
    if (a.confidence) {
      const c = a.confidence, v = a.verification;
      card.append(h("div", { class: "foot" },
        h("div", {}, h("div", { class: "label" }, "Confidence · computed, not self-assessed"),
          h("div", { class: "score" }, h("strong", {}, c.score), h("span", {}, c.band)),
          h("div", { class: "meter", role: "img", "aria-label": `Confidence ${c.score} of 100` }, h("i", { style: `width:${c.score}%` })),
          h("div", { class: "factors" }, c.factors.map((f) => h("div", { class: "factor", title: f.note },
            h("span", {}, `${f.name} ×${f.weight}`), h("span", { class: "bar" }, h("i", { style: `width:${f.value * 100}%` })), h("span", { class: "v" }, f.value.toFixed(2))))),
          c.caps.length ? h("ul", { class: "caps" }, c.caps.map((x) => h("li", {}, x))) : null),
        h("div", {}, h("div", { class: "label" }, "Verification gates"),
          h("div", { class: "vgrid" },
            h("b", {}, `${v.verbatim.passed}/${v.verbatim.checked}`), h("span", {}, "quoted lines identical to the source cell and found in page order"),
            h("b", {}, `${v.grounding.passed}/${v.grounding.checked}`), h("span", {}, "generated sentences whose tags, numbers and dates all appear in cited evidence"),
            h("b", {}, String(v.removed.length)), h("span", {}, "statements withheld")),
          h("div", { class: "small", style: "margin-top:10px" }, `Retrieval: ${a.retrieval.mode.replace(/\+/g, " + ")} · reciprocal rank fusion`))));
    }
    box.append(card);
  }

  // ---------------------------------------------------------------- evidence rail
  function coreOf(text) {
    return ws(text.replace(/^\d+\. /, "").replace(/^(Symptom|Likely cause|Action taken|Document caveat): /, "")
      .replace(/^\s*→\s*EFF-\d+:\s*/, "").replace(/ — [A-Z]{2,4}-?\d*.*$/, "").split(" · ").slice(-4).join(" "));
  }
  function selectEvidence(eid, scroll) {
    selectedEid = eid;
    document.querySelectorAll(".ev").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.eid === eid)));
    const rail = $("rail");
    rail.replaceChildren();
    if (!eid || !current) { rail.append(h("div", { class: "railempty" }, "No evidence for this answer.")); return; }
    const e = current.evidence.find((x) => x.eid === eid);
    if (!e) return;
    const cited = current.sections.flatMap((x) => x.items).filter((i) => i.evidence.includes(eid));
    rail.append(h("div", { class: "rail-h" }, h("div", { class: "label" }, `${e.eid} · ${e.kind.replace("_", " ").toLowerCase()} · cited by ${cited.length} line${cited.length === 1 ? "" : "s"}`),
      h("h3", {}, e.label)));
    const kv = [["Locator", e.locator]];
    const m = e.meta || {};
    if (m.classification) kv.push(["OPL type", m.classification]);
    if (m.date_shared) kv.push(["Shared", fmtDate(m.date_shared)]);
    if (m.reviewed_by) kv.push(["Reviewed by", m.reviewed_by]);
    if (m.approved_by) kv.push(["Approved by", m.approved_by]);
    if (m.revision) kv.push(["Revision", "Rev " + m.revision]);
    if (m.sil) kv.push(["SIL", m.sil]);
    if (m.related_interlock) kv.push(["Interlock", m.related_interlock]);
    if (m.pid_ref) kv.push(["P&ID", m.pid_ref]);
    if (m.date) kv.push(["Reported", fmtDate(m.date)]);
    if (m.downtime_h !== undefined && m.downtime_h !== null) kv.push(["Downtime", hrs(m.downtime_h)]);
    if (m.cost_idr) kv.push(["Cost", rp(m.cost_idr)]);
    if (m.confidence !== undefined && e.kind === "CHAIN") kv.push(["Chain score", String(m.confidence)]);
    if (e.source_path) kv.push(["Source file", e.source_path]);
    rail.append(h("dl", { class: "kv" }, kv.map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));

    const src = h("div", { class: "src", tabindex: "0", "aria-label": "Source text" });
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
      src.append(h("div", { class: "label", style: "padding:0 16px 6px" }, "Extracted page text · cited lines highlighted"), pre);
    } else if (e.kind === "WORK_ORDER") {
      const r = ENG.wo.get(e.doc);
      src.append(h("div", { class: "label", style: "padding:0 16px 6px" }, "Maintenance history record"),
        h("dl", { class: "kv", style: "border:0" }, [["Equipment", `${r.tag} · ${r.equipment}`], ["Work type", r.work_type], ["Problem", r.problem],
          ["Root cause", r.root_cause], ["Action", r.action], ["Interlock", r.related_interlock || "–"]].map(([k, v]) => [h("dt", {}, k), h("dd", {}, v)])));
    } else if (e.kind === "CHAIN") {
      const ch = B.chains.find((c) => c.chain_id === e.doc);
      src.append(h("div", { class: "label", style: "padding:0 16px 6px" }, "Why these work orders are linked"),
        h("ul", { class: "items", style: "padding:0 16px" }, ch.links.map((l) => h("li", {}, h("span", { class: "mono" }, `${l.frm} → ${l.to}`), h("br"),
          h("span", { class: "small" }, `${l.rationale}. Score ${l.score}: mechanism ${l.factors.mechanism}, component ${l.factors.component}, lexical ${l.factors.lexical}, recurrence cue ${l.factors.recurrence_cue}, time ${l.factors.temporal} (${l.factors.gap_days} d apart).`)))));
    }
    rail.append(src);
    if (firstHit) requestAnimationFrame(() => { src.scrollTop = Math.max(0, firstHit.offsetTop - 40); });
    if (scroll && innerWidth <= 1080) rail.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------- chains view
  function renderChains() {
    const C = B.chains;
    const lat = C.map((c) => c.lesson_latency_days);
    $("chainsIntro").textContent = `${C.length} failure chains in the pilot assets. Each could have been raised at its second work order. The first OPL covering each chain was shared ${Math.min(...lat)} to ${Math.max(...lat)} days after the chain's first failure, after every linked failure had already happened.`;
    const lg = $("tlLegend");
    const mk = (svgEl, text) => { const sv = s("svg", { width: 22, height: 14, "aria-hidden": "true" }); sv.append(svgEl); return h("span", {}, sv, text); };
    lg.append(mk(s("circle", { cx: 11, cy: 7, r: 4.5, fill: "var(--ink-2)" }), "failure work order"),
      mk(s("circle", { cx: 11, cy: 7, r: 4.5, fill: "var(--crit)" }), "loss of containment"),
      mk(s("circle", { cx: 11, cy: 7, r: 5, fill: "none", stroke: "var(--accent)", "stroke-width": 2.5 }), "detectable by CASCADE"),
      mk(s("rect", { x: 6, y: 2, width: 10, height: 10, fill: "var(--ok)" }), "first OPL shared"),
      mk(s("rect", { x: 1, y: 3, width: 20, height: 8, rx: 2, fill: "var(--warn-soft)", stroke: "var(--warn-mark)" }), "time without a lesson"));

    const W = 1000, left = 190, right = 30, top = 34, rowH = 96, H = top + rowH * C.length + 10;
    const t0 = Date.parse("2024-08-01"), t1 = Date.parse("2026-07-01");
    const X = (d) => left + (Date.parse(d) - t0) / (t1 - t0) * (W - left - right);
    const svg = $("timeline");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("width", W); svg.style.maxWidth = "100%"; svg.style.minWidth = "760px"; svg.style.height = "auto";
    svg.replaceChildren();
    for (const d of ["2024-10-01", "2025-01-01", "2025-04-01", "2025-07-01", "2025-10-01", "2026-01-01", "2026-04-01", "2026-07-01"]) {
      const x = X(d);
      svg.append(s("line", { x1: x, x2: x, y1: top - 6, y2: H - 10, stroke: "var(--line-soft)", "stroke-width": 1 }));
      const dt = new Date(d);
      svg.append(s("text", { x, y: top - 14, "text-anchor": "middle", "font-size": 12, style: "fill:var(--muted)" },
        dt.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }) + (dt.getUTCMonth() === 0 ? " " + dt.getUTCFullYear() : "")));
    }
    C.forEach((c, i) => {
      const y = top + i * rowH + rowH / 2;
      const opl = (c.knowledge_links || []).filter((k) => k.date_shared).sort((a, b) => a.date_shared < b.date_shared ? -1 : 1)[0];
      svg.append(s("text", { x: 0, y: y - 8, "font-size": 14, "font-weight": 600, style: "fill:var(--ink)" }, c.tag),
        s("text", { x: 0, y: y + 10, "font-size": 12.5 }, c.root_mechanism.toLowerCase().replace(/_/g, " ") + " · " + c.n_events + " failures"),
        s("text", { x: 0, y: y + 26, "font-size": 11.5, style: "fill:var(--muted);font-family:var(--f-mono)" }, c.chain_id));
      if (opl) {
        const xa = X(c.first_seen), xb = X(opl.date_shared);
        svg.append(s("rect", { x: xa, y: y - 13, width: xb - xa, height: 26, rx: 4, fill: "var(--warn-soft)", stroke: "var(--warn-mark)", "stroke-width": 1 }));
        // label sits over the stretch AFTER the last failure: the time with no lesson
        const xl = (X(c.last_seen) + xb) / 2;
        svg.append(s("text", { x: xl, y: y - 20, "text-anchor": "middle", "font-size": 12.5, "font-weight": 600, style: "fill:var(--warn)" },
          `${c.lesson_latency_days} days until first OPL`));
        const sq = s("rect", { x: xb - 6, y: y - 6, width: 12, height: 12, fill: "var(--ok)", stroke: "var(--surface)", "stroke-width": 2 });
        svg.append(sq, s("text", { x: xb, y: y + 26, "text-anchor": "middle", "font-size": 11.5, style: "font-family:var(--f-mono)" }, opl.opl_no));
        hover(sq, `<b>${esc(opl.opl_no)}</b><br>${esc(opl.title)}<br>${esc(opl.classification)} · shared ${fmtDate(opl.date_shared)}<br>${opl.relation.replace(/_/g, " ")}`);
      }
      svg.append(s("line", { x1: X(c.first_seen), x2: X(c.last_seen), y1: y, y2: y, stroke: "var(--ink-2)", "stroke-width": 2, "stroke-linecap": "round" }));
      const xd = X(c.detectable_on);
      const dm = s("circle", { cx: xd, cy: y, r: 9, fill: "none", stroke: "var(--accent)", "stroke-width": 2.5 });
      svg.append(dm, s("text", { x: xd, y: y + 26, "text-anchor": "middle", "font-size": 11.5, style: "fill:var(--accent-ink)" }, "detectable"));
      hover(dm, `<b>Detectable ${fmtDate(c.detectable_on)}</b><br>second linked work order recorded`);
      for (const e of c.events) {
        const loc = /hexane leak/i.test(e.problem);
        const dot = s("circle", { cx: X(e.date.slice(0, 10)), cy: y, r: 5, fill: loc ? "var(--crit)" : "var(--ink-2)", stroke: "var(--warn-soft)", "stroke-width": 2 });
        const hit = s("circle", { cx: X(e.date.slice(0, 10)), cy: y, r: 12, fill: "transparent" });
        svg.append(dot, hit);
        hover(hit, `<b>${esc(e.wo)}</b> · ${fmtDate(e.date.slice(0, 10))}<br>${esc(e.problem)}<br><i>Root cause:</i> ${esc(e.root_cause)}` + (e.downtime_h ? `<br>${hrs(e.downtime_h)} down` : ""));
        if (loc) svg.append(s("text", { x: X(e.date.slice(0, 10)) - 12, y: y - 20, "text-anchor": "end", "font-size": 12, "font-weight": 600, style: "fill:var(--crit)" }, "⚠ hexane leak"));
      }
    });

    const box = $("chainCards");
    for (const c of C) {
      const opl = (c.knowledge_links || []).filter((k) => k.date_shared).sort((a, b) => a.date_shared < b.date_shared ? -1 : 1)[0];
      const q = c.chain_id === "CH-EA-5601-03" ? "why does EA-5601 keep failing?" : c.root_mechanism === "MISALIGNMENT" ? "why does the hexane pump keep failing?" : "kenapa pompa hexane bocor?";
      box.append(h("article", { class: "card" },
        h("div", { class: "chainhead" }, h("h3", {}, `${c.tag} · ${c.root_mechanism.toLowerCase().replace(/_/g, " ")} chain`),
          h("span", { class: "mono small" }, c.chain_id), c.loss_of_containment ? h("span", { class: "pill st-abstained", style: "--st:var(--crit);--stsoft:var(--crit-soft)" }, "loss of containment") : null,
          h("button", { class: "btn ghost", type: "button", style: "margin-left:auto", onclick: () => { location.hash = "#ask"; ask(q); } }, "Ask CASCADE about it")),
        h("div", { class: "numrow" },
          h("div", { class: "num" }, h("b", {}, c.n_events), h("span", {}, "linked failures")),
          h("div", { class: "num" }, h("b", {}, c.span_days + " d"), h("span", {}, "first to last")),
          h("div", { class: "num" }, h("b", {}, hrs(c.total_downtime_h)), h("span", {}, "downtime")),
          h("div", { class: "num" }, h("b", {}, rp(c.total_cost_idr)), h("span", {}, "maintenance cost")),
          h("div", { class: "num warn" }, h("b", {}, c.lesson_latency_days + " d"), h("span", {}, "until first OPL" + (opl ? ` (${opl.opl_no})` : "")))),
        h("div", { class: "tablewrap" }, h("table", { class: "data" },
          h("thead", {}, h("tr", {}, ["Date", "Work order", "Problem", "Root cause", "Down", "Cost"].map((t, i) => h("th", { class: i >= 4 ? "r" : null }, t)))),
          h("tbody", {}, c.events.map((e) => h("tr", {}, h("td", { class: "mono" }, e.date.slice(0, 10)), h("td", { class: "mono" }, e.wo), h("td", {}, e.problem), h("td", {}, e.root_cause),
            h("td", { class: "r" }, e.downtime_h ? hrs(e.downtime_h) : "–"), h("td", { class: "r" }, e.cost_idr ? rp(e.cost_idr) : "–"))))))));
    }
  }
  function hover(el, html) {
    el.style.cursor = "default";
    el.addEventListener("pointerenter", (ev) => showTip(ev, html));
    el.addEventListener("pointermove", moveTip);
    el.addEventListener("pointerleave", hideTip);
  }

  // ---------------------------------------------------------------- plant view
  function renderPlant() {
    const R = B.records, A = B.chains_all;
    const dt = R.reduce((a, r) => a + (r.downtime_h || 0), 0), cost = R.reduce((a, r) => a + (r.cost_idr || 0), 0);
    const withCause = R.filter((r) => r.cause_recorded).length;
    const bd = R.filter((r) => r.breakdown).length;
    const chainDt = A.reduce((a, c) => a + c.total_downtime_h, 0), chainCost = A.reduce((a, c) => a + c.total_cost_idr, 0);
    const fouling = A.filter((c) => c.root_mechanism === "FOULING");
    const tile = (v, t) => h("div", { class: "card tile" }, h("span", { class: "label" }, t[0]), h("b", {}, v), h("span", {}, t[1]));
    $("tiles").append(tile(R.length, ["Work orders", "June 2024 – December 2025, 8 assets"]),
      tile(Math.round(withCause / R.length * 100) + "%", ["Reusable root cause", `${R.length - withCause} of ${R.length} closed as routine with no finding`]),
      tile(hrs(dt), ["Downtime", `${bd} breakdowns`]), tile(rpJt(cost), ["Maintenance cost", "all work orders"]));
    $("plantCallout").append(h("p", {}, `${A.length} failure chains explain ${hrs(chainDt)} of downtime, ${Math.round(chainDt / dt * 100)}% of the plant total, and ${rpJt(chainCost)} of cost. `,
      h("strong", {}, `${fouling.length} of ${A.length} share one root mechanism: fouling by polymer fines`), `, on ${fouling.map((c) => c.tag).join(", ")}. Each equipment file shows only its own piece of that pattern.`));

    // bars
    const by = new Map();
    for (const r of R) { const x = by.get(r.tag) || { tag: r.tag, name: r.equipment, dt: 0, ch: 0 }; x.dt += r.downtime_h || 0; by.set(r.tag, x); }
    for (const c of A) by.get(c.tag).ch += c.total_downtime_h;
    const rows = [...by.values()].sort((a, b) => b.dt - a.dt);
    $("barLegend").append(h("span", {}, h("i", { style: "width:12px;height:12px;border-radius:2px;background:var(--accent);display:inline-block" }), "inside a failure chain"),
      h("span", {}, h("i", { style: "width:12px;height:12px;border-radius:2px;background:var(--rest);display:inline-block" }), "other downtime"));
    const W = 560, left = 150, right = 60, bh = 18, gap = 16, top = 6, H = top + rows.length * (bh + gap) + 24;
    const max = Math.ceil(Math.max(...rows.map((r) => r.dt)) / 25) * 25;
    const X = (v) => (v / max) * (W - left - right);
    const svg = $("bars");
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.style.width = "100%"; svg.style.minWidth = "420px"; svg.style.height = "auto";
    for (let v = 0; v <= max; v += 25) {
      svg.append(s("line", { x1: left + X(v), x2: left + X(v), y1: top, y2: H - 22, stroke: "var(--line-soft)", "stroke-width": 1 }),
        s("text", { x: left + X(v), y: H - 6, "text-anchor": "middle", "font-size": 11, style: "fill:var(--muted);font-variant-numeric:tabular-nums" }, v + (v === max ? " h" : "")));
    }
    rows.forEach((r, i) => {
      const y = top + i * (bh + gap);
      svg.append(s("text", { x: left - 10, y: y + bh / 2 + 4, "text-anchor": "end", "font-size": 12.5, style: "fill:var(--ink);font-family:var(--f-mono)" }, r.tag));
      const wc = X(r.ch), wo = X(r.dt - r.ch);
      const g = s("g", {});
      if (r.ch > 0) g.append(barPath(left, y, wc, bh, r.dt - r.ch <= 0, "var(--accent)"));
      if (r.dt - r.ch > 0) g.append(barPath(left + wc + (r.ch > 0 ? 2 : 0), y, Math.max(0, wo - (r.ch > 0 ? 2 : 0)), bh, true, "var(--rest)"));
      g.append(s("rect", { x: left, y: y - gap / 2, width: W - left, height: bh + gap, fill: "transparent" }));
      svg.append(g, s("text", { x: left + X(r.dt) + 6, y: y + bh / 2 + 4, "font-size": 12, style: "font-variant-numeric:tabular-nums" }, hrs(r.dt)));
      hover(g, `<b>${esc(r.tag)}</b> · ${esc(r.name.toLowerCase())}<br>${hrs(r.dt)} downtime · ${hrs(r.ch)} inside a chain`);
    });
    $("barTable").append(h("thead", {}, h("tr", {}, h("th", {}, "Asset"), h("th", {}, "Equipment"), h("th", { class: "r" }, "Downtime"), h("th", { class: "r" }, "In chains"))),
      h("tbody", {}, rows.map((r) => h("tr", {}, h("td", { class: "mono" }, r.tag), h("td", {}, r.name.toLowerCase()), h("td", { class: "r" }, hrs(r.dt)), h("td", { class: "r" }, hrs(r.ch))))));
    $("allChains").append(h("thead", {}, h("tr", {}, h("th", {}, "Asset"), h("th", {}, "Mechanism"), h("th", { class: "r" }, "Events"), h("th", { class: "r" }, "Down"), h("th", { class: "r" }, "Cost"))),
      h("tbody", {}, A.map((c) => h("tr", {}, h("td", { class: "mono" }, c.tag), h("td", {}, h("span", { class: "mech" + (c.root_mechanism === "FOULING" ? " f" : "") }, c.root_mechanism.toLowerCase())),
        h("td", { class: "r" }, c.n_events), h("td", { class: "r" }, hrs(c.total_downtime_h)), h("td", { class: "r" }, rp(c.total_cost_idr))))));
  }
  // bar with a 4px rounded data-end and a square baseline
  function barPath(x, y, w, hgt, roundEnd, fill) {
    const r = roundEnd ? Math.min(4, w / 2) : 0;
    const d = `M${x},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + hgt - r} Q${x + w},${y + hgt} ${x + w - r},${y + hgt} H${x} Z`;
    return s("path", { d, fill });
  }

  // ---------------------------------------------------------------- tests view
  const HELD = [["#1", "12/16", 2, "bypass named by instrument tag; set point read from the wrong document"],
    ["#2", "13/14", 0, "one safe miss left open on purpose"],
    ["#3", "15/20", "3–4", "set-point change; cost read from the datasheet; “is it safe”; car-seal removal"],
    ["#4", "12/18", 3, "set-point change in Indonesian; standby auto-start; wrong component's chain"],
    ["#5", "16/18", 1, "closing a min-flow valve by hand"]];
  function renderTests() {
    const t = (v, a, b) => h("div", { class: "card tile" }, h("span", { class: "label" }, a), h("b", {}, v), h("span", {}, b));
    $("testTiles").append(t("467/467", "Browser = reference", "identical answers, JS port vs tested Python engine; 1,800/1,800 identical rankings"),
      t("157/157", "Verbatim lines", "quoted lines identical to the source cell across the golden set"),
      t("28/28", "Golden questions", "plus a regression suite of every serious failure ever found"),
      t("4/4", "LLM gate tests", "hallucinated number, injected bypass and uncited summary all rejected"));
    $("heldout").append(h("thead", {}, h("tr", {}, h("th", {}, "Round"), h("th", { class: "r" }, "First run"), h("th", { class: "r" }, "Serious"), h("th", {}, "What was found"))),
      h("tbody", {}, HELD.map(([r, p, n, w]) => h("tr", {}, h("td", {}, r), h("td", { class: "r" }, p), h("td", { class: "r" + (n === 0 ? " pass" : " fail") }, n), h("td", {}, w)))));
    $("liveRun").addEventListener("click", () => {
      const tb = $("liveTable"); tb.replaceChildren();
      const qs = ["GA-1201A tripped on high vibration, can I restart?", "why does the hexane pump keep failing?", "kenapa pompa hexane bocor?",
        "can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?", "EA-5601 tripped, can I restart it?",
        "is it safe to keep running GA-1201A at 5 mm/s vibration?", "what is the warranty period of GA-1201A?"];
      tb.append(h("thead", {}, h("tr", {}, h("th", {}, "Question"), h("th", {}, "Result"), h("th", { class: "r" }, "Verbatim"), h("th", { class: "r" }, "ms"))));
      const body = h("tbody");
      for (const q of qs) {
        const a = ENG.ask(q), v = a.verification;
        body.append(h("tr", {}, h("td", {}, q), h("td", {}, STATUS_TEXT[a.status]), h("td", { class: "r" }, v ? `${v.verbatim.passed}/${v.verbatim.checked}` : "–"), h("td", { class: "r" }, a.latency_ms)));
      }
      tb.append(body);
    });
    const lim = ["No live process data: the dataset has no historian, so every answer that depends on the current condition says so and its confidence is capped at 75.",
      "Documents are indexed for the two pilot assets only. The other six assets have work orders but no documents; questions about them are declined.",
      "P&IDs are raster images without a tag list. Tag extraction from drawings is on the roadmap and is not claimed here.",
      "Interlock set points in the committee documents are marked as dummy training values. Answers quote that caveat.",
      "Every OPL in the dataset was shared after the failures it covers. CASCADE measures that delay; it does not claim the lesson existed earlier.",
      "The intent router is rule-based. Held-out testing found gaps in it round after round; the safety gate is therefore fail-closed and refuses when a request touches a safeguard."];
    $("limits").append(...lim.map((x) => h("li", {}, x)));
  }

  // ---------------------------------------------------------------- boot
  function boot() {
    renderExamples(); renderChains(); renderPlant(); renderTests();
    try { const v = localStorage.getItem("cascade.view"); if (!location.hash && v && v !== "ask") location.hash = "#" + v; } catch (e) { /* ignore */ }
    route();
    $("foot").append(`Data: CALIBER 2026 Case 1 sample dataset (committee-provided). Engine: JavaScript port of the reference engine at commit ${B.meta.engine_commit}, running entirely in this browser; no question leaves this page.`);
    $("engineText").textContent = `Indexing ${B.passages.length} passages…`;
    setTimeout(() => {
      const t0 = performance.now();
      ENG = new CascadeEngine.Engine(B);
      const ms = Math.round(performance.now() - t0);
      $("engine").classList.add("ready");
      $("engineText").textContent = `Engine ready · runs in this browser · ${B.passages.length} passages indexed in ${ms} ms`;
      $("askform").addEventListener("submit", (e) => { e.preventDefault(); const q = $("q").value.trim(); if (q) ask(q); });
      ask(EXAMPLES[0][1][0]);
    }, 30);
  }
  boot();
})();
