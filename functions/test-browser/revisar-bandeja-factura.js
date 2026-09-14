/* global window, document */
// Revisión del NÚMERO DE FACTURA en la bandeja "Facturación pendiente"
// (F3 de docs/plans/PLAN_COMISIONES.md) con Chrome headless, sobre la PÁGINA
// REAL (misma técnica que revisar-comisiones.js: se interceptan las peticiones
// a Firebase y se inyecta un Firestore de mentira).
//
// Lo que congela:
//   1) el paso QBO pide el número y la nota en DOS campos — antes era uno solo
//      ("N.° de factura o nota") y por eso salieron tres formatos;
//   2) el número se guarda limpio aunque lo peguen con palabras alrededor;
//   3) NO se tranca a Recepción: sin número el paso igual se marca;
//   4) un QBO hecho SIN número se ve distinto y se puede completar después;
//   5) los que ya traen número no ofrecen volver a pedirlo.
//
// Corre con (desde functions/):  node test-browser/revisar-bandeja-factura.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const puppeteer = require("puppeteer-core");

const RAIZ = path.join(__dirname, "../..");
const PAGINA = "https://app.local/facturacion/bandeja.html";

const CHROME = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error("No se encontró Chrome. Define CHROME_PATH."); process.exit(2); }

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "bandeja-fact-"));
const shot = (n) => path.join(OUT, n + ".png");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/json" };

const FAKE = `
(function () {
  const ts = (iso) => ({ toDate: () => new Date(iso), _iso: iso });
  const paso = (o) => Object.assign({ aplica: true, hecho: false, at: null, por_email: null }, o || {});
  const base = (o) => Object.assign({
    tipo: 'contrato_activo', titulo: 'Contrato activo', efecto: 'arranca', estado: 'pendiente',
    cliente_id: 'c1', cliente_nombre: 'CLIENTE', contrato_id: 'ALQ20260910-01', contrato_doc_id: 'k1',
    fecha_efectiva: ts('2026-09-01T12:00:00Z'), resumen: { mensual: 90, equipos: '3 × PD606-R' },
    detalle: {}, contexto: {}, historial: [], correo: { mail_queue_id: null, status: null, error: null },
    pasos: { qbo: paso(), poc: paso() },
  }, o || {});

  const DATA = {
    // 1) Pendiente: es el que abre el formulario de marcar.
    a_pend: base({ cliente_nombre: 'SEINTEGRA PANAMA, S.A.', contrato_id: 'ALQ20260717-01' }),
    // 2) Otro pendiente, para probar que sin número igual se marca.
    a_pend2: base({ cliente_nombre: 'GIRAG PANAMA', contrato_id: 'ALQ20260720-01' }),
    // 3) QBO hecho SIN número: tiene que verse a medias y dejar anotarlo.
    a_sinnum: base({ cliente_nombre: 'HOTELES DECAMERON, S.R.L.', contrato_id: 'ALQ20260304-02',
      pasos: { qbo: paso({ hecho: true, at: ts('2026-09-11T14:00:00Z'), por_email: 'cecrecep@cecomunica.com', facturar_desde: '2026-09-11' }), poc: paso() } }),
    // 4) QBO hecho CON número: no debe volver a pedirlo.
    a_connum: base({ cliente_nombre: 'FALCON SERVICIOS INTEGRALES, S.A.', contrato_id: 'ALQ20230529-01',
      pasos: { qbo: paso({ hecho: true, at: ts('2026-09-11T14:00:00Z'), por_email: 'cecrecep@cecomunica.com',
        facturar_desde: '2026-09-11', factura: '10791', ref: 'Factura N° 10791' }), poc: paso() } }),
  };

  const USUARIOS = { 'u-recep': { rol: 'recepcion', email: 'cecrecep@cecomunica.com', activo: true } };

  window.__ESCRITURAS = [];
  const setEnRuta = (obj, ruta, val) => {
    const p = ruta.split('.');
    let o = obj;
    for (let i = 0; i < p.length - 1; i++) { if (typeof o[p[i]] !== 'object' || o[p[i]] === null) o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = val;
  };
  const snapDoc = (id, d) => ({ id, exists: !!d, data: () => d });
  const docRef = (col, id) => ({
    async get() { const d = col === 'usuarios' ? USUARIOS[id] : DATA[id]; return { id, exists: !!d, data: () => d }; },
    async update(patch) {
      window.__ESCRITURAS.push({ col, id, patch: JSON.parse(JSON.stringify(patch, (k, v) => (typeof v === 'function' ? '(fn)' : v))) });
      const d = DATA[id]; if (!d) throw new Error('no existe');
      for (const [k, v] of Object.entries(patch)) {
        if (v && v.__arrayUnion) { d[k] = (d[k] || []).concat(v.__arrayUnion); continue; }
        if (v && v.__server) { setEnRuta(d, k, ts(new Date().toISOString())); continue; }
        setEnRuta(d, k, v);
      }
    },
  });
  const coll = (col) => ({
    doc: (id) => docRef(col, id),
    where() { return this; }, limit() { return this; },
    async get() {
      const fuente = col === 'usuarios' ? USUARIOS : DATA;
      const docs = Object.entries(fuente).map(([id, d]) => snapDoc(id, d));
      return { size: docs.length, docs, forEach: (f) => docs.forEach(f) };
    },
  });
  window.db = { collection: coll, doc(p) { const [c, i] = p.split('/'); return docRef(c, i); } };
  window.firebase = {
    auth: () => ({ currentUser: { uid: 'u-recep', email: 'cecrecep@cecomunica.com' },
      onAuthStateChanged: (cb) => cb({ uid: 'u-recep', email: 'cecrecep@cecomunica.com' }) }),
    firestore: () => window.db,
  };
  window.firebase.firestore.FieldValue = { serverTimestamp: () => ({ __server: true }),
    arrayUnion: (...v) => ({ __arrayUnion: v }), delete: () => ({ __delete: true }) };
  window.firebase.firestore.Timestamp = { now: () => ts(new Date().toISOString()), fromDate: (d) => ts(d.toISOString()) };
  window.Sesion = { cacheAnonima: () => ({ rol: 'recepcion' }), cache: () => ({ rol: 'recepcion' }),
    perfil: async () => ({ rol: 'recepcion' }), rol: async () => 'recepcion', nombre: () => 'Recepción', limpiar() {} };
})();
`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new",
    args: ["--disable-gpu", "--no-sandbox"], defaultViewport: { width: 1320, height: 900, deviceScaleFactor: 1.5 } });
  const page = await browser.newPage();
  const errores = [];
  let fallos = 0;
  const check = (c, m) => { console.log((c ? "  OK    " : "  FALLO ") + m); if (!c) fallos++; };

  page.on("console", async (m) => {
    if (m.type() !== "error") return;
    try {
      const partes = await Promise.all(m.args().map(a => a.evaluate(
        v => (v instanceof Error ? `${v.name}: ${v.message}` : String(v))).catch(() => "?")));
      errores.push(partes.join(" ") || m.text());
    } catch { errores.push(m.text()); }
  });

  await page.evaluateOnNewDocument(FAKE);
  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("gstatic.com/firebasejs") || u.includes("firebase-init.js")) {
      return r.respond({ status: 200, contentType: "text/javascript", body: "" });
    }
    if (!u.startsWith("https://app.local/")) return r.abort();
    const rel = decodeURIComponent(u.replace("https://app.local/", "").split("?")[0]);
    const file = path.join(RAIZ, "public", rel);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      return r.respond({ status: 404, contentType: "text/plain", body: "no" });
    }
    return r.respond({ status: 200, contentType: MIME[path.extname(file)] || "application/octet-stream",
      body: fs.readFileSync(file) });
  });

  console.log("Número de factura en la bandeja — revisión en Chrome\n");
  await page.goto(PAGINA, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelectorAll(".fb-row").length > 0, { timeout: 15000 });

  // Abre el popover del paso QBO de una fila por nombre de cliente.
  const abrirQbo = async (cliente) => {
    await page.evaluate((c) => {
      const fila = [...document.querySelectorAll(".fb-row")].find(r => r.textContent.includes(c));
      [...fila.querySelectorAll('[data-act="paso"]')].find(b => b.textContent.includes("QBO")).click();
    }, cliente);
    await new Promise(r => setTimeout(r, 300));
  };

  // ── 1. Dos campos, no uno ────────────────────────────────────────────────
  await abrirQbo("SEINTEGRA");
  await page.screenshot({ path: shot("1-pop-qbo"), fullPage: true });
  const campos = await page.evaluate(() => {
    const p = document.querySelector(".fb-pop");
    if (!p) return null;
    return {
      factura: !!p.querySelector('[data-f="factura"]'),
      nota: !!p.querySelector('[data-f="ref"]'),
      desde: !!p.querySelector('[data-f="desde"]'),
      texto: p.textContent.replace(/\s+/g, " "),
      placeholderNota: p.querySelector('[data-f="ref"]')?.placeholder || "",
    };
  });
  check(!!campos && campos.factura && campos.nota && campos.desde,
    "el paso QBO pide fecha, N.° de factura y nota en campos SEPARADOS");
  check(!!campos && !/factura o nota/i.test(campos.placeholderNota),
    `la nota ya no dice "N.° de factura o nota" (dice "${campos && campos.placeholderNota}")`);
  check(!!campos && /confirmar el pago solo|pago solo/i.test(campos.texto),
    "y explica para qué sirve el número");

  // ── 2. El número se guarda LIMPIO aunque lo peguen con palabras ──────────
  await page.evaluate(() => {
    const p = document.querySelector(".fb-pop");
    p.querySelector('[data-f="factura"]').value = "Factura N° 10802";
    p.querySelector('[data-f="ref"]').value = "sin fiscalizar";
    p.querySelector('[data-act="pop-ok"]').click();
  });
  await new Promise(r => setTimeout(r, 500));
  const e1 = await page.evaluate(() => window.__ESCRITURAS[window.__ESCRITURAS.length - 1]);
  const qbo1 = e1 && e1.patch["pasos.qbo"];
  check(!!qbo1 && qbo1.factura === "10802",
    `pegando "Factura N° 10802" se guarda el número limpio (dio "${qbo1 && qbo1.factura}")`);
  check(!!qbo1 && qbo1.ref === "sin fiscalizar", "y la nota queda aparte, sin mezclarse");
  check(!!qbo1 && qbo1.hecho === true, "el paso queda hecho");

  // ── 3. Sin número NO se tranca a Recepción ──────────────────────────────
  await abrirQbo("GIRAG");
  await page.evaluate(() => document.querySelector('.fb-pop [data-act="pop-ok"]').click());
  await new Promise(r => setTimeout(r, 500));
  const e2 = await page.evaluate(() => window.__ESCRITURAS[window.__ESCRITURAS.length - 1]);
  const qbo2 = e2 && e2.patch["pasos.qbo"];
  check(!!qbo2 && qbo2.hecho === true, "sin número de factura el paso IGUAL se marca (no se tranca a Recepción)");
  check(!!qbo2 && qbo2.factura === null, "y queda explícito que no lo tiene");
  const hist2 = e2 && e2.patch.historial?.__arrayUnion?.[0]?.detalle;
  check(/SIN número de factura/i.test(hist2 || ""), `el rastro lo dice (“${hist2}”)`);

  // ── 4. Un QBO hecho SIN número se ve a medias y se completa después ──────
  const marca = await page.evaluate(() => {
    const fila = [...document.querySelectorAll(".fb-row")].find(r => r.textContent.includes("DECAMERON"));
    const b = [...fila.querySelectorAll('[data-act="paso"]')].find(x => x.textContent.includes("QBO"));
    return { sinNum: b.classList.contains("sin-num"), q: !!b.querySelector(".q"), title: b.title };
  });
  check(marca.sinNum && marca.q, "un QBO hecho sin número se marca distinto (clase sin-num + “?”)");
  check(/SIN número de factura/i.test(marca.title), "y el tooltip invita a anotarlo");

  await abrirQbo("DECAMERON");
  await page.screenshot({ path: shot("2-anotar-despues"), fullPage: true });
  const anot = await page.evaluate(() => {
    const p = document.querySelector(".fb-pop");
    return p ? { texto: p.textContent.replace(/\s+/g, " "), soloNumero: !p.querySelector('[data-f="desde"]') } : null;
  });
  check(!!anot && anot.soloNumero, "al completarlo solo se pide el número, no todo de nuevo");
  await page.evaluate(() => {
    const p = document.querySelector(".fb-pop");
    p.querySelector('[data-f="factura"]').value = "10429";
    p.querySelector('[data-act="pop-factura"]').click();
  });
  await new Promise(r => setTimeout(r, 500));
  const e3 = await page.evaluate(() => window.__ESCRITURAS[window.__ESCRITURAS.length - 1]);
  check(!!e3 && e3.patch["pasos.qbo.factura"] === "10429",
    `se anota sobre el paso ya marcado (dio "${e3 && e3.patch["pasos.qbo.factura"]}")`);
  check(!!e3 && !("pasos.qbo.hecho" in e3.patch), "sin volver a tocar lo que ya estaba");

  // ── 5. El que ya tiene número no vuelve a pedirlo ────────────────────────
  const conNum = await page.evaluate(() => {
    const fila = [...document.querySelectorAll(".fb-row")].find(r => r.textContent.includes("FALCON"));
    const b = [...fila.querySelectorAll('[data-act="paso"]')].find(x => x.textContent.includes("QBO"));
    b.click();
    return { sinNum: b.classList.contains("sin-num"), title: b.title };
  });
  await new Promise(r => setTimeout(r, 300));
  const popTrasClic = await page.evaluate(() => !!document.querySelector(".fb-pop"));
  check(!conNum.sinNum, "un QBO con número NO se marca como incompleto");
  check(/factura 10791/i.test(conNum.title), "el tooltip muestra el número");
  check(!popTrasClic, "y al hacer clic abre el detalle, no el formulario de anotar");

  const reales = errores.filter(e => !/favicon|manifest|404|net::ERR|Failed to load resource/i.test(e));
  check(reales.length === 0, `sin errores de consola${reales.length ? ": " + reales.slice(0, 3).join(" | ") : ""}`);

  console.log(`\nCapturas: ${OUT}`);
  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo en orden.");
  await browser.close();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
