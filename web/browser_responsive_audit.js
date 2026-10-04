"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");

const WEB = __dirname;
const HTML = path.join(WEB, "dist", "cascade.html");
const OUT = path.join(WEB, "..", "out", "responsive-audit");
const WIDTHS = [1440, 1280, 1024, 768, 430, 390, 375];
const SCREENS = ["ask", "answer", "chains", "asset", "plant", "chain", "chat", "assets", "docs", "tests"];
/* The original 5 screens x 7 widths (35 combinations) keep every earlier gate; "chain"
   (chain detail) and the checks below were added with the Part B responsive pass; "assets",
   "docs" and "tests" plus the dashboard component gates (tab bar, tables-to-cards, KPI tiles,
   WCAG text contrast in light and dark) were added with dashboard part 3. */
const SWEEP_WIDTHS = [320, 360, 414, 480, 600, 700, 760, 761, 900, 1080, 1081, 1200, 1600, 1920];
const SWEEP_ROUTES = ["ask", "answer", "chat", "chains", "chain/CH-GA-1201A-01", "asset/GA-1201A", "assets", "plant", "docs", "tests"];
/* In-page helper: every visible interactive element smaller than 44 x 44 CSS px.
   SVG chart marks are excluded (each chart has an equivalent table view). */
const TARGET_PROBE = `((root) => {
  const sel = 'a[href],button,summary,input,select,textarea,[role=tab],[tabindex="0"]';
  const shown = (el) => { const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    return cs.display !== 'none' && cs.visibility !== 'hidden' && r.width > 0 && r.height > 0 && r.right > 0 && r.left < innerWidth && !el.closest('svg'); };
  return [...(root || document).querySelectorAll(sel)].filter(shown).map((el) => { const r = el.getBoundingClientRect();
    return { el: (el.id ? '#' + el.id : el.tagName.toLowerCase() + '.' + String(el.className).trim().split(/\\s+/).join('.')).slice(0, 48), w: Math.round(r.width), h: Math.round(r.height) }; })
    .filter((t) => t.w < 44 || t.h < 44); })`;
/* In-page helper: visible text whose WCAG contrast against its painted background is below
   4.5:1 (3:1 for large text). Text over photographs is skipped (the hero has its own veil). */
const CONTRAST_PROBE = `(() => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,\\/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, under) => { const a = top[3]; return [top[0] * a + under[0] * (1 - a), top[1] * a + under[1] * (1 - a), top[2] * a + under[2] * (1 - a), 1]; };
  function bgOf(el) {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== "none" && !/gradient/.test(cs.backgroundImage)) return null;
      if (e.classList && (e.classList.contains("heroband") || e.classList.contains("heroimg"))) return null;
      const c = parse(cs.backgroundColor); if (c && c[3] > 0) { stack.push(c); if (c[3] >= 1) break; }
    }
    let base = [255, 255, 255, 1];
    for (let i = stack.length - 1; i >= 0; i--) base = over(stack[i], base);
    return base;
  }
  const out = [];
  const all = document.querySelectorAll("body *:not(script):not(style):not(svg *)");
  for (const el of all) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height || r.right < 0 || r.left > innerWidth) continue;
    const cs = getComputedStyle(el); if (cs.visibility === "hidden" || +cs.opacity === 0) continue;
    if (el.closest("[hidden],.sr,[aria-hidden=true]") || el.closest("button:disabled")) continue;
    let hidden = false; for (let e = el; e; e = e.parentElement) if (getComputedStyle(e).display === "none") { hidden = true; break; } if (hidden) continue;
    const bg = bgOf(el); if (!bg) continue;
    let fg = parse(cs.color); if (!fg) continue; fg = over(fg, bg);
    const L1 = lum(fg), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = +cs.fontWeight >= 700; const large = size >= 24 || (bold && size >= 18.66);
    const need = large ? 3 : 4.5;
    if (ratio < need - 0.01) out.push({ sel: (el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/).join(".") : "")).slice(0, 60), text: el.textContent.trim().slice(0, 30), ratio: +ratio.toFixed(2), need });
  }
  const seen = new Set(); return out.filter((o) => { const k = o.sel + o.ratio; if (seen.has(k)) return false; seen.add(k); return true; });
})()`;
/* In-page helper (async): every visible asset photo has loaded, is sharp on a 2x screen
   (naturalWidth >= 2 x rendered width), reserves its box (width/height attributes, async
   decoding), and carries no CSS filter or overlay in either theme. */
const PHOTO_PROBE = `(async () => {
  const imgs=[...document.querySelectorAll('img.photo')].filter((i)=>{ for(let e=i;e;e=e.parentElement){ if(e.hidden||getComputedStyle(e).display==='none') return false; } return true; });
  const out=[];
  for (const img of imgs) {
    img.scrollIntoView({block:'center'});
    if (!img.complete || !img.naturalWidth) await Promise.race([img.decode().catch(()=>{}), new Promise((r)=>setTimeout(r,3000))]);
    const r=img.getBoundingClientRect(); const box=img.parentElement;
    let filtered=false; for(let e=img;e&&e!==document.body;e=e.parentElement){ const cs=getComputedStyle(e); if(cs.filter!=='none'||cs.backdropFilter&&cs.backdropFilter!=='none'||cs.mixBlendMode!=='normal'||parseFloat(cs.opacity)<1) filtered=true; }
    const overlay=['::before','::after'].some((pe)=>{ const cs=getComputedStyle(box,pe); return cs.content!=='none'&&cs.content!=='normal'; })||[...box.children].some((c)=>c!==img);
    out.push({ src:img.closest('.assetphoto')?'header':'thumb', loaded:img.complete&&img.naturalWidth>0, natural:img.naturalWidth, rendered:Math.round(r.width), frameW:Math.round(box.getBoundingClientRect().width), frameH:Math.round(box.getBoundingClientRect().height),
      sharp:img.naturalWidth>=2*r.width, attrs:img.getAttribute('width')==='640'&&img.getAttribute('height')==='480'&&img.decoding==='async',
      cover:getComputedStyle(img).objectFit==='cover', filtered, overlay, alt:img.alt, caption:(box.parentElement.querySelector('.photocap')||{}).textContent||null });
  }
  scrollTo(0,0);
  return out; })()`;
const photoFailures = (rows, tag) => rows.filter((p) => !p.loaded || !p.sharp || !p.attrs || !p.cover || p.filtered || p.overlay || !/^Representative image of /.test(p.alt))
  .map((p) => `${tag}: asset photo gate ${JSON.stringify(p)}`);
const EDGE_CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
];
/* Edge stays first choice. CASCADE_BROWSER, or another installed Chromium-family
   browser, lets the identical CDP gate run where Edge is absent; the report records
   which browser produced the evidence. */
const BROWSER_CANDIDATES = [process.env.CASCADE_BROWSER, ...EDGE_CANDIDATES,
  "/opt/pw-browsers/chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome"].filter(Boolean);
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    });
    req.on("error", reject);
  });
}

async function waitForFile(file, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${file}`);
}

class CDP {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message}: ${JSON.stringify(message.error.data || {})}`));
      else resolve(message.result || {});
    });
  }
  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { this.socket.close(); }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) {
    const d = result.exceptionDetails;
    throw new Error(`${d.text || "browser evaluation failed"} ${d.exception && d.exception.description ? d.exception.description : ""}`.trim());
  }
  return result.result.value;
}

async function waitFor(cdp, expression, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for browser state: ${expression}`);
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, "document.readyState === 'complete' && document.getElementById('askbtn') && !document.getElementById('askbtn').disabled");
}

async function screenshot(cdp, file) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(result.data, "base64"));
}

async function main() {
  if (!fs.existsSync(HTML)) throw new Error("run python web/build.py before browser audit");
  const edge = BROWSER_CANDIDATES.find((file) => fs.existsSync(file));
  if (!edge) throw new Error("Microsoft Edge (or CASCADE_BROWSER) was not found");
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cascade-edge-"));
  const activePort = path.join(profile, "DevToolsActivePort");
  const child = spawn(edge, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--disable-default-apps",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    ...(process.getuid && process.getuid() === 0 ? ["--no-sandbox"] : []), "about:blank",
  ], { stdio: "ignore", windowsHide: true });

  let cdp;
  try {
    await waitForFile(activePort);
    const [port] = fs.readFileSync(activePort, "utf8").trim().split(/\r?\n/);
    const pages = await getJson(`http://127.0.0.1:${port}/json/list`);
    const page = pages.find((item) => item.type === "page");
    if (!page) throw new Error("Edge did not expose a page target");
    cdp = new CDP(page.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const base = pathToFileURL(HTML).href;
    const results = [];
    for (const width of WIDTHS) {
      const height = width <= 430 ? 844 : width <= 768 ? 900 : 960;
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width, height, deviceScaleFactor: 1, mobile: width <= 430,
        screenWidth: width, screenHeight: height,
      });

      for (const screen of SCREENS) {
        const route = screen === "asset" ? "asset/GA-1201A" : screen === "answer" || screen === "chat" ? "ask" : screen === "chain" ? "chain/CH-GA-1201A-01" : screen;
        await navigate(cdp, `${base}?audit=${width}-${screen}#${route}`);
        if (screen === "answer") {
          await evaluate(cdp, `(() => { const q=document.getElementById('q'); q.value='why does the hexane pump keep failing?'; document.getElementById('askform').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
          await waitFor(cdp, "!document.getElementById('askgrid').hidden && document.querySelector('#answer .headline')");
        }
        if (screen === "chat") {
          await evaluate(cdp, `(() => { document.getElementById('chatBtn').click(); const i=document.getElementById('chatInput'); i.value='GA-1201A tripped on high vibration, can I restart?'; document.getElementById('chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
          await waitFor(cdp, "document.querySelector('#chatThread .botcard')");
          for (const lookup of ["compare GA-1201A and EA-5601", "give me asset detail for EA-5601"]) {
            await sleep(300);
            await evaluate(cdp, `(() => { const i=document.getElementById('chatInput'); i.value=${JSON.stringify(lookup)}; document.getElementById('chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
          }
          await waitFor(cdp, "document.querySelectorAll('#chatThread .botcard[data-kind=\"lookup\"]').length === 2");
        }
        await sleep(120);

        const state = await evaluate(cdp, `(() => {
          const root=document.documentElement;
          const visible=(el)=>el && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden' && el.getBoundingClientRect().width>0 && el.getBoundingClientRect().height>0;
          const rect=(el)=>el?({w:Math.round(el.getBoundingClientRect().width),h:Math.round(el.getBoundingClientRect().height)}):null;
          const data={
            width:innerWidth, documentClientWidth:root.clientWidth, documentScrollWidth:root.scrollWidth, noDocumentOverflow:root.scrollWidth===root.clientWidth,
            topbar:rect(document.querySelector('.mobilebar')), nav:rect(document.getElementById('navshell')),
            mobileMenuVisible:visible(document.getElementById('menutog')),
            targetOffenders: innerWidth <= 1080 ? ${TARGET_PROBE}(document) : [],
          };
          /* dashboard components (design 05 §5-§7) */
          const view=document.querySelector('.view:not([hidden])');
          const tb=document.getElementById('tabbar'), items=[...tb.querySelectorAll('a[href],button')];
          data.tabbar={ display:getComputedStyle(tb).display, items:items.length, minH:Math.min(...items.map((x)=>x.getBoundingClientRect().height)),
            height:Math.round(tb.getBoundingClientRect().height), current:(items.find((x)=>x.getAttribute('aria-current')==='page')||{}).id||null,
            shellPad:parseFloat(getComputedStyle(document.querySelector('.shell')).paddingBottom) };
          const dt=view&&view.querySelector('table.dtable')?.closest('div.dt');
          if(dt){ const cards=[...dt.querySelectorAll('.dtcards .dtcard')];
            data.dt={ tableShown:visible(dt.querySelector('.dtwrap')), cardsShown:cards.filter(visible).length, rows:dt.querySelectorAll('tbody tr').length,
              cardOverflow:cards.filter(visible).some((c)=>c.scrollWidth>c.clientWidth+1||c.getBoundingClientRect().right>innerWidth+0.5),
              sortable:dt.querySelectorAll('th[aria-sort] button.sortbtn').length }; }
          const tiles=view&&view.querySelector('.tiles,.kpirow');
          if(tiles&&visible(tiles)){ const t=[...tiles.children].filter(visible);
            data.kpi={ count:t.length, columns:getComputedStyle(tiles).gridTemplateColumns.split(' ').length,
              overflow:t.some((x)=>x.scrollWidth>x.clientWidth+1||x.getBoundingClientRect().right>innerWidth+0.5),
              truncated:t.some((x)=>{const b=x.querySelector('b');return b&&b.scrollWidth>b.clientWidth+1;}) }; }
          data.contrast=${CONTRAST_PROBE};
          if (${JSON.stringify(screen)}==='ask') {
            data.hero=rect(document.querySelector('.heroband'));
            data.keyTile=Boolean(document.querySelector('#tiles a.htile.key[href] .hchev'));
          }
          if (${JSON.stringify(screen)}==='answer') {
            const ev=document.querySelector('#answer .ev');
            const tab=document.querySelector('#answer .atabs button');
            const panel=document.getElementById('apanel'), related=document.querySelector('#answer .relasset');
            data.evidenceTarget=rect(ev); data.tabTarget=rect(tab);
            data.trustDisclosure=Boolean(document.querySelector('#answer .trustdisc'));
            data.relatedAfterAnswer=Boolean(panel&&related&&(panel.compareDocumentPosition(related)&Node.DOCUMENT_POSITION_FOLLOWING));
            if(ev){ev.click();data.evidenceSheet=document.getElementById('rail').classList.contains('sheet-open');document.querySelector('#rail .railclose')?.click();}
          }
          if (${JSON.stringify(screen)}==='chains') {
            data.chartDisplay=getComputedStyle(document.querySelector('#view-chains .chartwrap')).display;
            data.tableOpen=document.querySelector('#view-chains details.chart-table').open;
            const cards=[...document.querySelectorAll('#view-chains .chaincards .chaincard')];
            data.chainCards=cards.filter(visible).length;
            data.chainRows=document.querySelectorAll('#tlTable tbody tr').length;
            data.chainTableDisplay=getComputedStyle(document.querySelector('#view-chains details.chart-table>.tablewrap')).display;
            data.chainCardsLinked=cards.length>0&&cards.every((c)=>(c.getAttribute('href')||'').startsWith('#chain/'));
            data.chainCardOverflow=cards.filter(visible).some((c)=>c.scrollWidth>c.clientWidth+1||c.getBoundingClientRect().right>innerWidth);
          }
          if (${JSON.stringify(screen)}==='chat') {
            const chat=document.getElementById('chat'), r=chat.getBoundingClientRect();
            const compose=document.getElementById('chatForm').getBoundingClientRect(), input=document.getElementById('chatInput').getBoundingClientRect();
            const thread=document.getElementById('chatThread'), card=document.querySelector('#chatThread .botcard');
            data.chat={ open:visible(chat), left:Math.round(r.left), width:Math.round(r.width), top:Math.round(r.top), bottom:Math.round(r.bottom),
              composeBottom:Math.round(compose.bottom), inputBottom:Math.round(input.bottom), inputH:Math.round(input.height),
              threadScrolls:getComputedStyle(thread).overflowY==='auto', threadOverflowX:thread.scrollWidth>thread.clientWidth+1,
              cardWithin:card?card.getBoundingClientRect().right<=r.right+0.5:false, status:card?card.dataset.status:null,
              evidenceChips:document.querySelectorAll('#chatThread .botcard .cardev .ev').length,
              openFull:Boolean([...document.querySelectorAll('#chatThread .botcard .cardfoot button')].length),
              lookupCards:document.querySelectorAll('#chatThread .botcard[data-kind="lookup"]').length,
              lookupWithin:[...document.querySelectorAll('#chatThread .botcard[data-kind="lookup"]')].every((c)=>c.getBoundingClientRect().right<=r.right+0.5&&c.scrollWidth<=c.clientWidth+1),
              compareMode:(()=>{const c=document.querySelector('#chatThread .botcard[data-lookup="compare"]');return c?(visible(c.querySelector('.cmpwide'))?'wide':visible(c.querySelector('.cmpstack'))?'stack':'none'):null;})(),
              assetLink:Boolean(document.querySelector('#chatThread .botcard[data-lookup="asset"] a.lkopen[href="#asset/EA-5601"]')),
              targets: innerWidth<=1080 ? ${TARGET_PROBE}(chat) : [] };
          }
          if (${JSON.stringify(screen)}==='chain') {
            data.crumbs=document.querySelectorAll('#view-chain .crumbs li').length;
          }
          if (${JSON.stringify(screen)}==='asset') {
            data.metricColumns=getComputedStyle(document.querySelector('.assetmetrics')).gridTemplateColumns.split(' ').length;
            data.criticalMetric=Boolean(document.querySelector('.assetmetric.critical'));
            data.metricTotal=document.querySelectorAll('#view-asset .assetmetric').length;
            data.metricStrip=document.querySelectorAll('#view-asset .assetmetrics:not(.moremetricsgrid) .assetmetric').length;
            const more=document.querySelector('#view-asset details.moremetrics');
            data.moreMetricsVisible=visible(more);
            data.moreMetricCount=document.querySelectorAll('#view-asset .moremetrics .assetmetric').length;
            const open=[...document.querySelectorAll('#view-asset button')].find((b)=>/Open P&ID/.test(b.textContent));
            data.pidOpenTarget=rect(open);
            if(open){open.click();data.pidControls=Boolean(document.querySelector('#pidmodal .pidtools'));data.pidFit=Boolean(document.querySelector('#pidmodal img.pidfit'));document.querySelector('#pidmodal .modalh button')?.click();}
          }
          if (${JSON.stringify(screen)}==='plant') {
            data.chartDisplay=getComputedStyle(document.querySelector('#view-plant .chartwrap')).display;
            data.tableOpen=document.querySelector('#view-plant details.chart-table').open;
            data.chainCta=/View 6 failure chains/.test(document.getElementById('plantCallout').textContent);
            data.tagTargets=[...document.querySelectorAll('#mechGroups a.tag')].map(rect);
          }
          if (${JSON.stringify(screen)}==='docs') {
            const sel=document.getElementById('docFilterType'); sel.value='pid'; sel.dispatchEvent(new Event('change'));
            data.docPidRows=document.querySelectorAll('#docTable tbody tr').length; data.docPidCards=document.querySelectorAll('#docList .dtcard').length;
            sel.value=''; sel.dispatchEvent(new Event('change'));
            data.docRows=document.querySelectorAll('#docTable tbody tr').length;
            const first=document.querySelector('#docTable tbody tr'); if(first){ first.querySelector('td:nth-child(3)').click(); }
            data.docViewer=/OPL-/.test(document.getElementById('docView').textContent);
          }
          if (${JSON.stringify(screen)}==='tests') {
            document.getElementById('liveRun').click();
            data.liveRows=document.querySelectorAll('#liveTable tbody tr').length;
            data.liveCardsStacked=innerWidth<=760 ? getComputedStyle(document.querySelector('#liveTable tbody tr')).display==='grid' : null;
          }
          if(innerWidth<=760){
            document.getElementById('menutog').click();
            data.drawerOpen=document.getElementById('navshell').classList.contains('drawer-open');
            data.drawerRoutes=document.querySelectorAll('#navdrawer a[href]').length;
            data.drawerTargetMin=Math.min(...[...document.querySelectorAll('#navdrawer a[href],#themetog')].map((el)=>el.getBoundingClientRect().height));
            document.getElementById('navscrim').click();
          }
          return data;
        })()`);
        if (screen === "asset") {
          state.pid = await evaluate(cdp, `(async () => {
            const open=[...document.querySelectorAll('#view-asset button')].find((b)=>/Open P&ID/.test(b.textContent));
            if (!open) return { opened:false };
            open.click();
            const img=document.querySelector('#pidmodal .modalb img'), canvas=document.querySelector('#pidmodal .modalb');
            if (!img.complete) await new Promise((r)=>img.addEventListener('load',r,{once:true}));
            await new Promise((r)=>requestAnimationFrame(()=>requestAnimationFrame(r)));
            const btn=(l)=>[...document.querySelectorAll('#pidmodal .pidtools button')].find((b)=>b.getAttribute('aria-label')===l||b.textContent.trim()===l);
            const w=()=>img.getBoundingClientRect().width;
            const key=(k)=>canvas.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true}));
            const out={ opened:true, controls:['Zoom out','Zoom in','Fit width','100%','Reset'].every((l)=>btn(l)) };
            out.initialFit=img.classList.contains('pidfit');
            btn('Fit width').click(); out.fitWithin=w()<=canvas.clientWidth+1; out.fitClass=img.classList.contains('pidfit');
            const wFit=w(); btn('Zoom in').click(); out.zoomInGrows=w()>wFit*1.2;
            const wIn=w(); btn('Zoom out').click(); out.zoomOutShrinks=w()<wIn-1;
            const wKey=w(); canvas.focus(); key('+'); out.keyZoomIn=w()>wKey; key('-'); out.keyZoomOut=Math.abs(w()-wKey)<2;
            btn('100%').click(); out.actualSize=Math.abs(w()-img.naturalWidth)<2;
            key('0'); out.keyReset=innerWidth<=760 ? img.classList.contains('pidfit') : Math.abs(w()-img.naturalWidth)<2;
            out.level=(document.querySelector('#pidmodal .pidlevel')||{}).textContent||'';
            out.targetOffenders=innerWidth<=1080 ? ${TARGET_PROBE}(document.getElementById('pidmodal')) : [];
            const box=document.querySelector('#pidmodal .modalbox').getBoundingClientRect();
            out.modalInViewport=box.left>=0&&box.right<=innerWidth+0.5;
            out.noDocumentOverflow=document.documentElement.scrollWidth===document.documentElement.clientWidth;
            document.querySelector('#pidmodal .modalh button').click();
            out.closed=document.getElementById('pidmodal').hidden;
            return out; })()`);
        }
        if (screen === "asset" || screen === "answer") state.photos = await evaluate(cdp, PHOTO_PROBE);
        results.push({ screen, ...state });
        await screenshot(cdp, path.join(OUT, `${screen}-${width}.png`));
      }
    }

    /* no sideways page scroll at any width: sweep intermediate and extreme widths */
    const sweep = [];
    for (const width of SWEEP_WIDTHS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 430, screenWidth: width, screenHeight: 900 });
      await navigate(cdp, `${base}?audit=sweep-${width}#ask`);
      for (const route of SWEEP_ROUTES) {
        if (route === "answer") {
          await evaluate(cdp, `(() => { location.hash='#ask'; const q=document.getElementById('q'); q.value='GA-1201A tripped on high vibration, can I restart?'; document.getElementById('askform').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
        } else if (route === "chat") {
          await evaluate(cdp, `(() => { location.hash='#ask'; document.getElementById('chatBtn').click(); const i=document.getElementById('chatInput'); i.value='can I bypass the min-flow interlock on GA-1201A to get more discharge pressure?'; document.getElementById('chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
          await sleep(400);
        } else {
          await evaluate(cdp, `(() => { document.getElementById('chatClose') && !document.getElementById('chat').hidden && document.getElementById('chatClose').click(); location.hash=${JSON.stringify("#" + route)}; return true; })()`);
        }
        await sleep(90);
        const row = await evaluate(cdp, `(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }))()`);
        sweep.push({ width, route, ...row, ok: row.scrollWidth === row.clientWidth });
      }
    }

    const failures = [];
    /* dashboard acceptance (cascade/design/05-dashboard-ui.md §9) */
    const acceptance = {};
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 667, deviceScaleFactor: 1, mobile: true, screenWidth: 375, screenHeight: 667 });
    await navigate(cdp, `${base}?audit=accept-375x667#ask`);
    await evaluate(cdp, `(() => { const q=document.getElementById('q'); q.value='GA-1201A tripped on high vibration, can I restart?'; document.getElementById('askform').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
    await waitFor(cdp, "document.querySelector('#answer .lead .headline')");
    await sleep(120);
    acceptance.fold = await evaluate(cdp, `(() => { const r=(s)=>document.querySelector(s).getBoundingClientRect(); const tab=r('#tabbar');
      return { scrollY: Math.round(scrollY), pillBottom: Math.round(r('#answer .lead .pill').bottom), headlineBottom: Math.round(r('#answer .lead .headline').bottom),
        safetyFirst: Boolean(document.querySelector('#answer .safety')) && document.querySelector('#answer .safety').compareDocumentPosition(document.querySelector('#answer .lead')) === Node.DOCUMENT_POSITION_FOLLOWING,
        tabTop: Math.round(tab.top) }; })()`);
    acceptance.reach = await evaluate(cdp, `(() => { const tabs=[...document.querySelectorAll('#tabbar a[href]')].map((a)=>a.getAttribute('href'));
      document.getElementById('tabMore').click(); const drawer=[...document.querySelectorAll('#navdrawer a[href]')].map((a)=>a.getAttribute('href'));
      const open=document.getElementById('navshell').classList.contains('drawer-open'); document.getElementById('navscrim').click();
      return { tabs, drawer, moreOpensDrawer: open }; })()`);
    const f = acceptance.fold, rch = acceptance.reach;
    if (!(f.scrollY === 0 && f.safetyFirst && f.pillBottom <= f.tabTop && f.headlineBottom <= f.tabTop)) failures.push(`acceptance 375x667: status + one-line answer not above the fold ${JSON.stringify(f)}`);
    for (const hash of ["#ask", "#assets", "#chains", "#plant"]) if (!rch.tabs.includes(hash)) failures.push(`acceptance: ${hash} not one tap away`);
    for (const hash of ["#docs", "#tests"]) if (!rch.moreOpensDrawer || !rch.drawer.includes(hash)) failures.push(`acceptance: ${hash} not two taps away`);

    const assets = [];
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1024, height: 960, deviceScaleFactor: 1, mobile: false });
    for (const [tag, type] of Object.entries(ASSETS)) {
      await navigate(cdp, `${base}?audit=asset-${tag}#asset/${tag}`);
      assets.push(await evaluate(cdp, `(() => { const img=document.querySelector('#view-asset .assetphoto img'); return {tag:${JSON.stringify(tag)},alt:img?.alt||null,caption:document.querySelector('#view-asset .photocap')?.textContent||null}; })()`));
      const last = assets[assets.length - 1];
      if (last.alt !== `Representative image of ${type}` || last.caption !== `Representative image — ${type}`) {
        throw new Error(`asset photo mapping failed for ${tag}`);
      }
      last.photos = await evaluate(cdp, PHOTO_PROBE);
      last.layoutShift = await evaluate(cdp, `new Promise((res) => { let s=0; try { new PerformanceObserver((l)=>{ for (const e of l.getEntries()) if (!e.hadRecentInput) s+=e.value; }).observe({ type:'layout-shift', buffered:true }); } catch (e) {} setTimeout(()=>res(Math.round(s*1000)/1000), 300); })`);
      last.overflow = await evaluate(cdp, `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
      failures.push(...photoFailures(last.photos, `asset ${tag}`));
      if (last.photos.length !== 1 || last.photos[0].caption !== `Representative image — ${type}`) failures.push(`asset ${tag}: header photo/caption ${JSON.stringify(last.photos)}`);
      if (last.layoutShift > 0.01 || last.overflow > 0) failures.push(`asset ${tag}: layout shift ${last.layoutShift} / overflow ${last.overflow}`);
    }

    for (const row of results) {
      if (!row.noDocumentOverflow) failures.push(`${row.screen}@${row.width}: document overflow ${row.documentScrollWidth}`);
      if (row.width <= 760 && (!row.drawerOpen || row.drawerRoutes !== 6 || row.drawerTargetMin < 44 || row.nav.h > 56)) failures.push(`${row.screen}@${row.width}: mobile navigation gate`);
      if (row.screen === "answer" && (!row.trustDisclosure || !row.relatedAfterAnswer || (row.width <= 760 && (row.evidenceTarget.h < 44 || row.tabTarget.h < 44)) || (row.width <= 1080 && !row.evidenceSheet))) failures.push(`answer@${row.width}: answer hierarchy/evidence gate`);
      if ((row.screen === "chains" || row.screen === "plant") && row.width <= 430 && (row.chartDisplay !== "none" || !row.tableOpen)) failures.push(`${row.screen}@${row.width}: chart fallback gate`);
      if (row.screen === "asset" && (!row.criticalMetric || !row.pidControls || (row.width <= 760 && (!row.pidFit || row.metricColumns !== 2)))) failures.push(`asset@${row.width}: metric/P&ID gate`);
      if (row.screen === "plant" && (!row.chainCta || (row.width <= 760 && row.tagTargets.some((target) => target.h < 44)))) failures.push(`plant@${row.width}: CTA/tap-target gate`);
      if (row.screen === "ask" && !row.keyTile) failures.push(`ask@${row.width}: KPI affordance gate`);
      /* Part B gates */
      if (row.width <= 1080 && row.targetOffenders.length) failures.push(`${row.screen}@${row.width}: touch targets under 44px ${JSON.stringify(row.targetOffenders.slice(0, 5))}`);
      if (row.screen === "chains") {
        if (row.width <= 430 && (row.chainCards !== row.chainRows || !row.chainRows || row.chainTableDisplay !== "none" || !row.chainCardsLinked || row.chainCardOverflow)) failures.push(`chains@${row.width}: phone chain-card gate`);
        if (row.width > 430 && row.chainCards !== 0) failures.push(`chains@${row.width}: chain cards shown above phone width`);
      }
      if (row.screen === "chat") {
        const c = row.chat || {};
        /* input pinned: composer ends at the panel's bottom edge; panel edges measured against the layout viewport */
        const pinned = c.composeBottom >= c.bottom - 2 && c.inputBottom <= c.bottom;
        const phoneFull = row.width > 760 || (c.left === 0 && c.width === row.documentClientWidth && c.top === 0);
        const sidePanel = row.width <= 760 || (c.width <= 440 && Math.abs(c.left + c.width - row.documentClientWidth) <= 1);
        if (!c.open || !pinned || !phoneFull || !sidePanel || !c.threadScrolls || c.threadOverflowX || !c.cardWithin || c.status !== "answered"
          || !c.evidenceChips || !c.openFull || c.inputH < 44 || (c.targets || []).length
          || c.lookupCards !== 2 || !c.lookupWithin || !c.assetLink || c.compareMode !== (row.width <= 430 ? "stack" : "wide")) failures.push(`chat@${row.width}: chat layout gate ${JSON.stringify(c)}`);
      }
      if (row.screen === "chain" && row.crumbs !== 4) failures.push(`chain@${row.width}: breadcrumb gate`);
      if (row.screen === "asset") {
        if (row.width <= 760 && (row.metricStrip > 3 || !row.moreMetricsVisible || row.metricStrip + row.moreMetricCount !== row.metricTotal || row.metricTotal !== 6)) failures.push(`asset@${row.width}: compact metric strip gate`);
        if (row.width > 760 && (row.metricStrip !== row.metricTotal || row.moreMetricsVisible)) failures.push(`asset@${row.width}: full metric grid gate`);
        const p = row.pid || {};
        if (!p.opened || !p.controls || !p.fitWithin || !p.fitClass || !p.zoomInGrows || !p.zoomOutShrinks || !p.keyZoomIn || !p.keyZoomOut || !p.actualSize || !p.keyReset
          || !p.level || !p.modalInViewport || !p.noDocumentOverflow || !p.closed || (row.width <= 760 && !p.initialFit) || (p.targetOffenders || []).length) {
          failures.push(`asset@${row.width}: P&ID zoom/fit/reset gate ${JSON.stringify(p)}`);
        }
      }
    }
    /* dashboard part 3 component gates */
    const TAB_FOR = { ask: "tab-ask", answer: "tab-ask", chat: "tab-ask", assets: "tab-assets", asset: "tab-assets", chains: "tab-chains", chain: "tab-chains", plant: "tab-plant", docs: "tabMore", tests: "tabMore" };
    for (const row of results) {
      const t = row.tabbar;
      if (row.width <= 760 && (t.display === "none" || t.items !== 5 || t.minH < 44 || t.shellPad < t.height || t.current !== TAB_FOR[row.screen])) failures.push(`${row.screen}@${row.width}: phone tab bar gate ${JSON.stringify(t)}`);
      if (row.width > 760 && t.display !== "none") failures.push(`${row.screen}@${row.width}: tab bar shown above phone width`);
      if (["assets", "chains", "docs"].includes(row.screen)) {
        const d = row.dt;
        if (!d || !d.rows) failures.push(`${row.screen}@${row.width}: data table missing`);
        else if (row.width <= 760 && (d.tableShown || d.cardsShown !== d.rows || d.cardOverflow)) failures.push(`${row.screen}@${row.width}: tables-to-cards gate ${JSON.stringify(d)}`);
        else if (row.width > 760 && (!d.tableShown || d.cardsShown || !d.sortable)) failures.push(`${row.screen}@${row.width}: desktop table gate ${JSON.stringify(d)}`);
      }
      if (["ask", "asset", "plant", "tests"].includes(row.screen)) {
        const k = row.kpi;
        /* Home KPI rows: 4 columns from 900 px, 2 below (Home section fix); other screens unchanged */
        const homeCols = row.screen === "ask" ? (row.width >= 900 ? 4 : 2) : null;
        if (!k || k.count < 4 || k.overflow || k.truncated || (homeCols ? k.columns !== homeCols : ((row.width <= 760 && k.columns !== 2) || (row.width > 760 && k.columns < 3)))) failures.push(`${row.screen}@${row.width}: KPI tile gate ${JSON.stringify(k)}`);
      }
      if (row.photos) {
        failures.push(...photoFailures(row.photos, `${row.screen}@${row.width}`));
        if (row.screen === "asset") { const hd = row.photos.find((p) => p.src === "header");
          if (!hd || (row.width > 760 ? hd.frameW !== 200 || hd.frameH !== 150 : hd.frameW !== 132 || hd.frameH !== 99)) failures.push(`asset@${row.width}: header photo size ${JSON.stringify(hd)}`); }
        if (row.screen === "answer" && !row.photos.some((p) => p.src === "thumb")) failures.push(`answer@${row.width}: related-asset thumbnail missing`);
      }
      if (row.screen === "docs" && (row.docPidRows !== 2 || row.docPidCards !== 2 || row.docRows !== 20 || !row.docViewer)) failures.push(`docs@${row.width}: filter/viewer gate`);
      if (row.screen === "tests" && (row.liveRows !== 7 || (row.width <= 760 && !row.liveCardsStacked))) failures.push(`tests@${row.width}: live run gate`);
      if (row.contrast.length) failures.push(`${row.screen}@${row.width}: contrast below WCAG AA ${JSON.stringify(row.contrast.slice(0, 4))}`);
    }
    /* WCAG AA text contrast in dark mode as well (desktop and phone) */
    const dark = [];
    for (const width of [1440, 375]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 430, screenWidth: width, screenHeight: 900 });
      await navigate(cdp, `${base}?audit=dark-${width}#ask`);
      await evaluate(cdp, `(() => { document.documentElement.dataset.theme='dark'; return true; })()`);
      await sleep(350); /* let colour transitions settle before measuring contrast */
      for (const route of SWEEP_ROUTES) {
        if (route === "answer") await evaluate(cdp, `(() => { location.hash='#ask'; const q=document.getElementById('q'); q.value='GA-1201A tripped on high vibration, can I restart?'; document.getElementById('askform').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
        else if (route === "chat") { await evaluate(cdp, `(() => { location.hash='#ask'; document.getElementById('chatBtn').click(); const i=document.getElementById('chatInput'); i.value='GA-1201A tripped on high vibration, can I restart?'; document.getElementById('chatForm').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`); await sleep(400); }
        else await evaluate(cdp, `(() => { !document.getElementById('chat').hidden && document.getElementById('chatClose').click(); location.hash=${JSON.stringify("#" + route)}; return true; })()`);
        await sleep(120);
        const off = await evaluate(cdp, CONTRAST_PROBE);
        dark.push({ width, route, offenders: off.length });
        if (route.startsWith("asset/") || route === "answer") failures.push(...photoFailures(await evaluate(cdp, PHOTO_PROBE), `dark ${route}@${width}`));
        if (off.length) failures.push(`dark ${route}@${width}: contrast below WCAG AA ${JSON.stringify(off.slice(0, 4))}`);
      }
    }
    acceptance.darkContrast = dark;

    /* Home "What CASCADE found" section: layout, alignment, focus, and figures identical to the
       pre-change build (web/home_baseline.json), at 7 widths in light and dark */
    const HOME = JSON.parse(fs.readFileSync(path.join(WEB, "home_baseline.json"), "utf8"));
    const home = [];
    for (const theme of ["light", "dark"]) for (const width of [1440, 1024, 768, 430, 390, 375, 320]) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width <= 430, screenWidth: width, screenHeight: 900 });
      await navigate(cdp, `${base}?audit=home-${theme}-${width}#ask`);
      await evaluate(cdp, `(() => { document.documentElement.dataset.theme=${JSON.stringify(theme)}; return true; })()`);
      await sleep(350); /* let colour transitions settle before measuring contrast */
      const r = await evaluate(cdp, `(() => {
        const out={ overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth };
        const tiles=[...document.querySelectorAll('#tiles a.htile')];
        const rows={}; for(const t of tiles){ const top=Math.round(t.getBoundingClientRect().top); (rows[top]=rows[top]||[]).push(t.querySelector('.hval').getBoundingClientRect().top); }
        out.baselineSpread=Math.max(0,...Object.values(rows).map((v)=>Math.max(...v)-Math.min(...v)));
        out.rowCols=[...document.querySelectorAll('#tiles .kpirow')].map((r)=>getComputedStyle(r).gridTemplateColumns.split(' ').length);
        out.tiles=Object.fromEntries(tiles.map((t)=>[t.dataset.key,{ value:t.dataset.value, shown:t.querySelector('.hval').textContent.replace(/\\s+/g,''), caption:t.querySelector('.hcap').textContent, href:t.getAttribute('href') }]));
        out.tileFocus=tiles.map((t)=>({ key:t.dataset.key, stops:t.tabIndex>=0 && !t.querySelector('a,button,input,select,textarea,[tabindex]'),
          named:(t.getAttribute('aria-label')||'').includes(t.dataset.value.replace(/^Rp\\s?|\\s?(jt|h)$/g,'')) }));
        const go=document.getElementById('golinks'), pat=document.getElementById('callout');
        out.cards={ go:Math.round(go.getBoundingClientRect().height), pat:Math.round(pat.getBoundingClientRect().height), side:Math.round(go.getBoundingClientRect().top)===Math.round(pat.getBoundingClientRect().top),
          patBeforeGo:pat.getBoundingClientRect().top<go.getBoundingClientRect().top };
        out.go=[...go.querySelectorAll('a.golink')].map((a)=>({ href:a.getAttribute('href'), count:(a.querySelector('.gocount')||{}).textContent||null, h:Math.round(a.getBoundingClientRect().height) }));
        out.chips=[...pat.querySelectorAll('a.tag')].map((a)=>({ text:a.textContent, href:a.getAttribute('href') }));
        out.callout={ title:pat.querySelector('h3').textContent, body:pat.querySelector('.patbody').textContent, cta:pat.querySelector('a.patbtn').getAttribute('href'),
          squares:pat.querySelectorAll('.covsq i').length, filled:pat.querySelectorAll('.covsq i.on').length };
        out.minLabel=Math.min(...[...document.querySelectorAll('#homesum .hlabel,#homesum .kpigrouph,#homesum .eyebrow,#homesum .gosub,#homesum .hcap')].map((e)=>parseFloat(getComputedStyle(e).fontSize)));
        out.heading=parseFloat(getComputedStyle(document.getElementById('homesumH')).fontSize);
        out.contrast=${CONTRAST_PROBE}.filter((o)=>true);
        return out; })()`);
      /* keyboard: real Tab presses from the section heading visit every tile once, in order, with a visible ring */
      await evaluate(cdp, `(() => { const h=document.getElementById('homesumH'); h.tabIndex=-1; h.focus(); return true; })()`);
      r.tabOrder = [];
      for (let i = 0; i < r.tileFocus.length; i++) {
        for (const type of ["keyDown", "keyUp"]) await cdp.send("Input.dispatchKeyEvent", { type, key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
        r.tabOrder.push(await evaluate(cdp, `(() => { const a=document.activeElement, cs=getComputedStyle(a); return { key:a.dataset.key||a.tagName, ring:cs.outlineStyle!=='none'&&parseFloat(cs.outlineWidth)>=2 }; })()`));
      }
      await evaluate(cdp, `(() => { document.getElementById('homesumH').removeAttribute('tabindex'); return true; })()`);
      home.push({ theme, width, ...r });
      const tag = `home ${theme}@${width}`;
      if (r.overflow > 0) failures.push(`${tag}: horizontal overflow ${r.overflow}`);
      if (r.baselineSpread > 1) failures.push(`${tag}: tile values not on one baseline (${r.baselineSpread}px)`);
      if (r.rowCols.some((c) => c !== (width >= 900 ? 4 : 2))) failures.push(`${tag}: tile columns ${JSON.stringify(r.rowCols)}`);
      for (const [key, want] of Object.entries(HOME.tiles)) {
        const got = r.tiles[key];
        if (!got || got.value !== want.value || got.shown !== want.value.replace(/\s+/g, "") || got.caption !== want.caption || got.href !== want.href) failures.push(`${tag}: tile ${key} differs from before ${JSON.stringify({ want, got })}`);
      }
      if (Object.keys(r.tiles).length !== Object.keys(HOME.tiles).length) failures.push(`${tag}: tile count changed`);
      if (r.tileFocus.some((f) => !f.stops || !f.named)) failures.push(`${tag}: tile tab stop / accessible name ${JSON.stringify(r.tileFocus)}`);
      if (JSON.stringify(r.tabOrder.map((t) => t.key)) !== JSON.stringify(r.tileFocus.map((t) => t.key)) || r.tabOrder.some((t) => !t.ring)) failures.push(`${tag}: keyboard focus order / ring ${JSON.stringify(r.tabOrder)}`);
      if (JSON.stringify(r.go.map((g) => ({ href: g.href, count: g.count }))) !== JSON.stringify(HOME.go) || r.go.some((g) => g.h < 56)) failures.push(`${tag}: Go to list differs ${JSON.stringify(r.go)}`);
      if (JSON.stringify(r.chips) !== JSON.stringify(HOME.chips) || r.callout.title !== HOME.callout.title || r.callout.body !== HOME.callout.body || r.callout.cta !== HOME.callout.cta
        || r.callout.filled !== HOME.chips.length || r.callout.squares !== HOME.tiles["home.tile.assets"].value * 1) failures.push(`${tag}: pattern card differs ${JSON.stringify(r.callout)}`);
      if (width >= 900 && (!r.cards.side || Math.abs(r.cards.go - r.cards.pat) > 1)) failures.push(`${tag}: Go to and pattern cards not side by side at equal height ${JSON.stringify(r.cards)}`);
      if (width < 900 && !r.cards.patBeforeGo) failures.push(`${tag}: pattern card should come before Go to`);
      if (r.minLabel < 12 || r.heading < 13) failures.push(`${tag}: text below minimum size (${r.minLabel}/${r.heading})`);
      if (r.contrast.length) failures.push(`${tag}: contrast below WCAG AA ${JSON.stringify(r.contrast.slice(0, 4))}`);
    }
    /* Floating chat button (top-bar Chat/Glossary removed): every main screen, 6 widths, light and
       dark. Circular, visible, correct offsets, above the phone tab bar, covers no control or
       last content row (checked scrolled to the bottom), AA icon contrast, opens the chat, hides
       while the chat is open and takes focus back when it closes. Glossary stays reachable from
       Help and from the sidebar / More drawer. */
    const fab = [];
    const FAB_ROUTES = ["ask", "answer", "assets", "asset/GA-1201A", "chains", "chain/CH-GA-1201A-01", "plant", "docs", "tests"];
    for (const theme of ["light", "dark"]) for (const width of [1440, 1024, 768, 430, 390, 375]) {
      const height = width <= 430 ? 844 : 900;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width <= 430, screenWidth: width, screenHeight: height });
      for (const route of FAB_ROUTES) {
        await navigate(cdp, `${base}?audit=fab-${theme}-${width}-${route.replace(/\W/g, "")}#${route === "answer" ? "ask" : route}`);
        await evaluate(cdp, `(() => { document.documentElement.dataset.theme=${JSON.stringify(theme)}; return true; })()`);
        if (route === "answer") {
          await evaluate(cdp, `(() => { const q=document.getElementById('q'); q.value='GA-1201A tripped on high vibration, can I restart?'; document.getElementById('askform').dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})); return true; })()`);
          await waitFor(cdp, "document.querySelector('#answer .headline')");
        }
        await sleep(300);
        const r = await evaluate(cdp, `(async () => {
          const f=document.getElementById('chatFab'), cs=getComputedStyle(f);
          scrollTo(0, document.documentElement.scrollHeight); await new Promise((res)=>requestAnimationFrame(()=>requestAnimationFrame(res)));
          const fr=f.getBoundingClientRect(), vw=document.documentElement.clientWidth, vh=innerHeight;
          const hit=(r)=>r.width>0&&r.height>0&&r.left<fr.right&&r.right>fr.left&&r.top<fr.bottom&&r.bottom>fr.top;
          const shown=(el)=>{ for(let e=el;e;e=e.parentElement){ const s=getComputedStyle(e); if(s.display==='none'||s.visibility==='hidden') return false; } return true; };
          const covered=[...document.querySelectorAll('a[href],button,input,select,textarea,summary,[tabindex="0"],#foot,#foot *')]
            .filter((el)=>el!==f&&!f.contains(el)&&shown(el)&&hit(el.getBoundingClientRect())).map((el)=>(el.id?'#'+el.id:el.tagName.toLowerCase()+'.'+String(el.className).split(' ')[0]).slice(0,40));
          const tb=document.getElementById('tabbar'), tbr=tb.getBoundingClientRect(), tabShown=getComputedStyle(tb).display!=='none';
          const c=(x)=>x.match(/[\\d.]+/g).slice(0,3).map(Number), L=(v)=>{ const [r,g,b]=v.map((x)=>{ x/=255; return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
          const a1=L(c(cs.color)), a2=L(c(cs.backgroundColor)), contrast=(Math.max(a1,a2)+0.05)/(Math.min(a1,a2)+0.05);
          const top=document.elementFromPoint(fr.left+fr.width/2, fr.top+fr.height/2);
          const out={ w:Math.round(fr.width), h:Math.round(fr.height), radius:cs.borderRadius, right:Math.round(vw-fr.right), bottom:Math.round(vh-fr.bottom),
            aboveTabbar: tabShown ? fr.bottom<=tbr.top-15 : null, onTop: f===top||f.contains(top), covered, contrast:Math.round(contrast*100)/100,
            label:f.getAttribute('aria-label'), overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth };
          f.click(); out.opens=!document.getElementById('chat').hidden && f.hidden;
          document.getElementById('chatClose').click(); out.returns=!f.hidden && document.activeElement===f;
          scrollTo(0,0); return out; })()`);
        fab.push({ theme, width, route, ...r });
        const tag = `fab ${theme} ${route}@${width}`;
        const size = width <= 760 ? 52 : 56, off = width <= 760 ? 16 : 20;
        if (r.w !== size || r.h !== size || !/^50%$|^(\d+)px$/.test(r.radius) || (r.radius.endsWith("px") && parseFloat(r.radius) < size / 2)) failures.push(`${tag}: not a ${size}px circle ${JSON.stringify(r)}`);
        if (r.right !== off || (width > 760 && r.bottom !== off) || (width <= 760 && !r.aboveTabbar)) failures.push(`${tag}: position ${JSON.stringify(r)}`);
        if (!r.onTop || r.covered.length) failures.push(`${tag}: hidden or overlapping ${JSON.stringify(r.covered)}`);
        if (r.contrast < 4.5 || r.label !== "Open chat") failures.push(`${tag}: icon contrast / label ${r.contrast} ${r.label}`);
        if (!r.opens || !r.returns) failures.push(`${tag}: open/close/focus return ${JSON.stringify({ opens: r.opens, returns: r.returns })}`);
        if (r.overflow > 0) failures.push(`${tag}: horizontal overflow ${r.overflow}`);
      }
      /* Glossary from Help (orientation) and from the sidebar / More drawer; P&ID tools clear of the button */
      await navigate(cdp, `${base}?audit=gloss-${theme}-${width}#asset/GA-1201A`);
      const g = await evaluate(cdp, `(async () => {
        const phone=innerWidth<=760, wait=()=>new Promise((r)=>setTimeout(r,60)), open=()=>!document.getElementById('glossary').hidden;
        const viaDrawer=async(id)=>{ if(phone){ document.getElementById('menutog').click(); await wait(); } document.getElementById(id).click(); await wait(); };
        const out={};
        await viaDrawer('helpBtn'); out.helpShowsOrientation=!document.getElementById('orient').hidden;
        document.getElementById('orientGloss').click(); await wait(); out.fromHelp=open(); document.getElementById('glossClose').click(); await wait();
        location.hash='#asset/GA-1201A'; await wait(); await wait();
        await viaDrawer('glossBtn'); out.fromSidebar=open(); document.getElementById('glossClose').click(); await wait();
        out.topbarButtons=document.querySelectorAll('#topbar button').length;
        const pid=[...document.querySelectorAll('#view-asset button')].find((b)=>/Open P&ID/.test(b.textContent)); pid.click(); await wait();
        const f=document.getElementById('chatFab').getBoundingClientRect();
        out.pidOverlap=[...document.querySelectorAll('#pidmodal .pidtools button,#pidmodal .modalh button')].some((b)=>{ const r=b.getBoundingClientRect();
          if(!(r.left<f.right&&r.right>f.left&&r.top<f.bottom&&r.bottom>f.top)) return false; const t=document.elementFromPoint((Math.max(r.left,f.left)+Math.min(r.right,f.right))/2,(Math.max(r.top,f.top)+Math.min(r.bottom,f.bottom))/2); return t===document.getElementById('chatFab'); });
        document.querySelector('#pidmodal .modalh button').click();
        return out; })()`);
      fab.push({ theme, width, route: "glossary+pid", ...g });
      if (!g.helpShowsOrientation || !g.fromHelp || !g.fromSidebar) failures.push(`glossary ${theme}@${width}: not reachable ${JSON.stringify(g)}`);
      if (g.topbarButtons !== 0) failures.push(`topbar ${theme}@${width}: header still has ${g.topbarButtons} buttons`);
      if (g.pidOverlap) failures.push(`fab ${theme}@${width}: overlaps the P&ID controls`);
    }
    acceptance.fab = fab.filter((x) => x.route === "ask" || x.route === "glossary+pid");
    acceptance.home = home.map(({ theme, width, baselineSpread, cards, overflow }) => ({ theme, width, baselineSpread, cards, overflow }));
    for (const row of sweep) if (!row.ok) failures.push(`sweep ${row.route}@${row.width}: document overflow ${row.scrollWidth} > ${row.clientWidth}`);

    const version = await cdp.send("Browser.getVersion").catch(() => ({}));
    const report = { status: failures.length ? "failed" : "passed", browser: { path: edge, product: version.product || null }, widths: WIDTHS, screens: SCREENS, failures, results, sweep, acceptance, assets };
    fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
    if (failures.length) throw new Error(failures.join("\n"));
    console.log(`Browser responsive audit: PASS - ${results.length} viewport/screen checks (35 original + ${results.length - 35} added), ${sweep.length} overflow-sweep checks, ${dark.length} dark-mode contrast checks, ${home.length} Home section checks, ${fab.length} floating-chat checks, 8/8 asset mappings + photo checks (${version.product || edge})`);
    console.log(`Evidence: ${path.join(OUT, "report.json")}`);
    await cdp.send("Browser.close");
  } finally {
    if (cdp) cdp.close();
    if (!child.killed) child.kill();
    await sleep(200);
    const resolvedProfile = path.resolve(profile);
    const resolvedTemp = path.resolve(os.tmpdir()) + path.sep;
    if (resolvedProfile.startsWith(resolvedTemp)) {
      try { fs.rmSync(resolvedProfile, { recursive: true, force: true }); } catch (_) { /* Edge may still be releasing files */ }
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
