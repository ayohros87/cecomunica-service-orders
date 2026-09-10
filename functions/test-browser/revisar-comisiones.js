/* global window, document */
// (`window`/`document` globales: los callbacks de evaluate/$eval corren en la
//  PÁGINA. ESLint los ve como código Node — de ahí el comentario.)
//
// Revisión visual y de conducta de la bandeja de COMISIONES
// (docs/plans/PLAN_COMISIONES.md F2) con Chrome headless.
//
// A diferencia de harness-pendientes.html, aquí NO se copia la página: se
// carga `public/facturacion/comisiones.html` TAL CUAL —con su CSS local, que
// vive inline— y se interceptan las peticiones a Firebase para inyectar un
// Firestore de mentira. Copiar el HTML sería probar una copia, y el CSS de esta
// página no está en un archivo aparte.
//
// Corre con (desde functions/):  node test-browser/revisar-comisiones.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const puppeteer = require("puppeteer-core");

const RAIZ = path.join(__dirname, "../..");
const PAGINA = "https://app.local/facturacion/comisiones.html";

const CHROME = process.env.CHROME_PATH || [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
].find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!CHROME) { console.error("No se encontró Chrome. Define CHROME_PATH."); process.exit(2); }

const OUT = fs.mkdtempSync(path.join(os.tmpdir(), "comisiones-"));
const shot = (n) => path.join(OUT, n + ".png");

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/json" };

// ── Firestore de mentira: solo la superficie que usa la página ────────────
// facturacionAvisosService: db.collection(COL).get() y .doc(id).update(patch).
// Los patches usan rutas con punto ('comision.requisitos.pago') y
// FieldValue.arrayUnion / serverTimestamp.
const FAKE = `
(function () {
  const ts = (iso) => ({ toDate: () => new Date(iso), _iso: iso });
  const req = (aplica, hecho, extra) => Object.assign({ aplica, hecho, at: hecho ? ts('2026-09-01T12:00:00Z') : null, motivo: hecho ? null : 'pendiente' }, extra || {});
  const com = (o) => Object.assign({
    aplica: true, estado: 'esperando', motivo: null, vendedor_email: 'karla.ferrer@cecomunica.com',
    base: 75, base_de: 'mensual', porcentaje: null, monto: null, regla_id: null,
    requisitos: { firma: req(true, true), entrega: req(true, true), pago: req(true, false, { factura: null, monto: null, saldo: null, fuente: null, motivo: 'falta confirmar el primer pago (factura en cero)' }) },
    periodo: null, liberada_por: null, liberada_at: null, nota: null,
  }, o || {});

  const DATA = {
    // 1) Lista para pago: los tres requisitos hechos.
    a_listo: { tipo: 'contrato_activo', titulo: 'Contrato activo', estado: 'hecho',
      cliente_nombre: 'AIR EUROPA', contrato_id: 'ALQ20260713-02', contrato_doc_id: 'c1',
      fecha_efectiva: ts('2026-07-29T12:00:00Z'), resumen: { equipos: '6 × PD606-R', mensual: 162 },
      historial: [{ accion: 'comision_pago', detalle: 'Primer pago confirmado · factura 1189 · 2026-08-05', fecha_iso: '2026-08-05', por_email: 'zuleika.diaz@cecomunica.com' }],
      comision: com({ base: 162, vendedor_email: 'elvia.onodera@cecomunica.com', estado: 'listo',
        requisitos: { firma: req(true, true), entrega: req(true, true),
          pago: req(true, true, { factura: '1189', monto: 162, saldo: 0, fuente: 'manual' }) } }) },
    // 2) RENOVACIÓN: la entrega NO aplica y tiene que decir por qué.
    a_renov: { tipo: 'renovacion_activa', titulo: 'Renovación activa', estado: 'hecho',
      cliente_nombre: 'R. SMITH CORONADO', contrato_id: 'ALQ20260601-02', contrato_doc_id: 'c2',
      fecha_efectiva: ts('2026-09-03T12:00:00Z'), resumen: { equipos: '4 × PD606-R', mensual: 90 },
      historial: [],
      comision: com({ base: 90, vendedor_email: 'elvia.onodera@cecomunica.com',
        requisitos: { firma: req(true, true),
          entrega: Object.assign(req(false, false), { motivo: 'renovación: los equipos ya están en el cliente' }),
          pago: req(true, false, { factura: null, motivo: 'falta confirmar el primer pago (factura en cero)' }) } }) },
    // 3) Esperando entrega Y pago.
    a_espera: { tipo: 'contrato_activo', titulo: 'Contrato activo', estado: 'pendiente',
      cliente_nombre: 'FORTALEZA SECURITY, S.A', contrato_id: 'PROP20260727-02', contrato_doc_id: 'c3',
      fecha_efectiva: ts('2026-09-02T12:00:00Z'), resumen: { equipos: '3 × PNC360S', mensual: 90 },
      historial: [],
      comision: com({ base: 90, vendedor_email: 'salomon.arauz@cecomunica.com',
        requisitos: { firma: req(true, true),
          entrega: Object.assign(req(true, false), { motivo: 'los equipos no se han entregado' }),
          pago: req(true, false, { factura: null, motivo: 'falta confirmar el primer pago (factura en cero)' }) } }) },
    // 4) SIN vendedor: no hay a quién pagarle.
    a_sinvend: { tipo: 'contrato_activo', titulo: 'Contrato activo', estado: 'hecho',
      cliente_nombre: 'GRUPO INDECSA, S.A.', contrato_id: 'PROP20260818-01', contrato_doc_id: 'c4',
      fecha_efectiva: ts('2026-09-04T12:00:00Z'), resumen: { equipos: '1 × TC-508U-R', mensual: 16 },
      historial: [],
      comision: com({ base: 16, vendedor_email: null }) },
    // 5) Ya pagada (marca del módulo anterior).
    a_pagada: { tipo: 'contrato_activo', titulo: 'Contrato activo', estado: 'hecho',
      cliente_nombre: 'NADCAR CONSTRUCCIONES, S.A.', contrato_id: 'ALQ20260803-01', contrato_doc_id: 'c5',
      fecha_efectiva: ts('2026-08-06T12:00:00Z'), resumen: { equipos: '4 × PD606-R', mensual: 112 },
      historial: [],
      comision: com({ base: 112, vendedor_email: 'salomon.arauz@cecomunica.com', estado: 'pagada',
        periodo: '2026-08', liberada_por: 'zuleika.diaz@cecomunica.com', liberada_at: ts('2026-08-20T12:00:00Z'),
        nota: 'marca del módulo anterior (listo_para_comision)',
        requisitos: { firma: req(true, true), entrega: req(true, true),
          pago: req(true, true, { factura: '1102', fuente: 'marca_modulo_anterior' }) } }) },
    // 6) No paga comisión (ajuste de tarifa) — con el motivo escrito.
    a_ajuste: { tipo: 'ajuste_tarifa', titulo: 'Ajuste de tarifa', estado: 'hecho',
      cliente_nombre: 'SKY CHEFS DE PANAMA, S.A.', contrato_id: 'ALQ20260701-01', contrato_doc_id: 'c6',
      fecha_efectiva: ts('2026-09-05T12:00:00Z'), resumen: { mensual: 55 }, historial: [],
      comision: { aplica: false, estado: 'no_aplica', motivo: 'el ajuste se comisiona en la renovación',
        vendedor_email: null, base: null, base_de: null, porcentaje: null, monto: null, regla_id: null,
        requisitos: {}, periodo: null, liberada_por: null, liberada_at: null, nota: null } },
  };

  window.__ESCRITURAS = [];
  const setEnRuta = (obj, ruta, val) => {
    const p = ruta.split('.');
    let o = obj;
    for (let i = 0; i < p.length - 1; i++) { if (typeof o[p[i]] !== 'object' || o[p[i]] === null) o[p[i]] = {}; o = o[p[i]]; }
    o[p[p.length - 1]] = val;
  };

  // El usuario de la sesión. Hace falta en el db de mentira porque
  // usuariosService.js (el REAL, que se carga después de este script y
  // sobreescribe cualquier stub) resuelve el rol leyendo usuarios/{uid} — sin
  // esto la página cierra con "Acceso restringido".
  const USUARIOS = {
    'u-zuleika': { rol: 'administrador', email: 'zuleika.diaz@cecomunica.com', nombre: 'Zuleika Díaz', activo: true },
  };

  // Sin JSON.parse(JSON.stringify(...)): el roundtrip mata los toDate() de los
  // Timestamp de mentira y la página pintaba todas las fechas como "—".
  const snapDoc = (id, d) => ({ id, exists: !!d, data: () => d });
  const docRef = (col, id) => ({
    async get() {
      const d = col === 'usuarios' ? USUARIOS[id] : DATA[id];
      return { id, exists: !!d, data: () => d };
    },
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

  window.db = {
    collection(col) {
      return {
        doc: (id) => docRef(col, id),
        async get() {
          const fuente = col === 'usuarios' ? USUARIOS : DATA;
          const docs = Object.entries(fuente).map(([id, d]) => snapDoc(id, d));
          return { size: docs.length, docs, forEach: (f) => docs.forEach(f) };
        },
        where() { return this; }, limit() { return this; },
      };
    },
    doc(p) { const [c, i] = p.split('/'); return docRef(c, i); },
  };

  window.firebase = {
    auth: () => ({
      currentUser: { uid: 'u-zuleika', email: 'zuleika.diaz@cecomunica.com' },
      onAuthStateChanged: (cb) => cb({ uid: 'u-zuleika', email: 'zuleika.diaz@cecomunica.com' }),
    }),
    firestore: () => window.db,
  };
  window.firebase.firestore.FieldValue = {
    serverTimestamp: () => ({ __server: true }),
    arrayUnion: (...v) => ({ __arrayUnion: v }),
    delete: () => ({ __delete: true }),
  };
  window.firebase.firestore.Timestamp = {
    now: () => ts(new Date().toISOString()),
    fromDate: (d) => ts(d.toISOString()),
  };

  window.UsuariosService = { async getUsuario() { return { rol: 'administrador', email: 'zuleika.diaz@cecomunica.com', activo: true }; } };
  window.Sesion = { cacheAnonima: () => ({ rol: 'administrador' }), cache: () => ({ rol: 'administrador' }),
    perfil: async () => ({ rol: 'administrador' }), rol: async () => 'administrador', nombre: () => 'Zuleika', limpiar() {} };
  // El rail hace su propia red; en el harness no aporta nada.
  window.__SIN_RAIL = true;
})();
`;

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--disable-gpu", "--no-sandbox"],
    defaultViewport: { width: 1320, height: 980, deviceScaleFactor: 1.5 },
  });
  const page = await browser.newPage();
  const errores = [];
  let fallos = 0;
  const check = (cond, msg) => { console.log((cond ? "  OK    " : "  FALLO ") + msg); if (!cond) fallos++; };

  // m.text() de un console.error(objetoError) sale como "JSHandle@error" y no
  // dice nada: hay que resolver los argumentos.
  // `esperando` marca los tramos donde la prueba PROVOCA un error a propósito
  // (la validación del número de factura): ahí el console.error es la señal de
  // que el candado funcionó, no ruido que haya que perdonar en la lista final.
  let esperando = null;
  page.on("console", async (m) => {
    if (m.type() !== "error") return;
    try {
      const partes = await Promise.all(m.args().map(a => a.evaluate(
        v => (v instanceof Error ? `${v.name}: ${v.message}` : String(v))).catch(() => "?")));
      (esperando || errores).push(partes.join(" ") || m.text());
    } catch { (esperando || errores).push(m.text()); }
  });
  page.on("pageerror", (e) => errores.push("pageerror: " + e.message));

  // El fake se instala ANTES de cualquier script de la página.
  await page.evaluateOnNewDocument(FAKE);

  await page.setRequestInterception(true);
  page.on("request", (r) => {
    const u = r.url();
    // Firebase real y firebase-init: fuera. El fake ya puso window.firebase/db.
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

  console.log("Bandeja de comisiones — revisión en Chrome\n");
  await page.goto(PAGINA, { waitUntil: "networkidle0" });
  try {
    await page.waitForFunction(() => document.querySelectorAll(".cm-row").length > 0, { timeout: 15000 });
  } catch (e) {
    console.log("--- No se pintaron filas. Diagnóstico ---");
    console.log("errores:", JSON.stringify(errores, null, 1));
    console.log(await page.evaluate(() => ({
      rows: document.getElementById("cmRows")?.innerHTML.slice(0, 300),
      hayServicio: !!window.FacturacionAvisosService,
      hayPagina: !!window.FacturacionComisiones,
      hayDb: !!window.db, hayFmt: !!window.FMT, hayToast: !!window.Toast,
      hayLayout: !!window.Layout, hayModal: !!window.Modal,
      body: document.body.innerHTML.slice(0, 200),
    })));
    throw e;
  }
  await page.screenshot({ path: shot("1-lista"), fullPage: true });

  // ── 1. Se pintan las filas y los chips cuentan ───────────────────────────
  const cnt = await page.evaluate(() => {
    const g = (k) => Number(document.querySelector(`[data-cnt="${k}"]`)?.textContent || -1);
    return { abiertas: g("abiertas"), listo: g("listo"), esperando: g("esperando"),
      pagada: g("pagada"), sinvend: g("sinvend"), filas: document.querySelectorAll(".cm-row").length,
      grupos: document.querySelectorAll(".cm-grupo").length };
  });
  check(cnt.listo === 1, `chip "Listas para pago" = 1 (dio ${cnt.listo})`);
  check(cnt.esperando === 3, `chip "Esperando" = 3 (dio ${cnt.esperando})`);
  check(cnt.pagada === 1, `chip "Pagadas" = 1 (dio ${cnt.pagada})`);
  check(cnt.sinvend === 1, `chip "Sin vendedor" = 1 (dio ${cnt.sinvend})`);
  check(cnt.abiertas === 4, `chip "Abiertas" = 4 — no cuenta la pagada ni el no_aplica (dio ${cnt.abiertas})`);
  check(cnt.filas === 4, `el filtro por defecto muestra las 4 abiertas (dio ${cnt.filas})`);

  // ── 2. Sin vendedor: aviso arriba y grupo PRIMERO ────────────────────────
  const sv = await page.evaluate(() => ({
    aviso: !document.getElementById("cmAviso").hidden,
    texto: document.getElementById("cmAviso").textContent.trim().slice(0, 60),
    primerGrupo: document.querySelector(".cm-gh .who")?.textContent.trim(),
  }));
  check(sv.aviso, "sale el aviso de comisiones sin vendedor");
  check(sv.primerGrupo === "SIN VENDEDOR ASIGNADO",
    `el grupo sin vendedor va PRIMERO (dio "${sv.primerGrupo}")`);

  // ── 3. La renovación dice que la entrega no aplica ───────────────────────
  const renov = await page.evaluate(() => {
    const fila = [...document.querySelectorAll(".cm-row")].find(r => r.textContent.includes("R. SMITH CORONADO"));
    return fila ? fila.querySelector(".cm-t2").textContent.replace(/\\s+/g, " ").trim() : null;
  });
  check(!!renov && /entrega\s*\(no aplica\)/i.test(renov),
    `la renovación muestra "entrega (no aplica)" (dio "${renov}")`);

  // ── 4. Abrir el detalle de la que está LISTA y ver el botón de cierre ────
  await page.evaluate(() => {
    const fila = [...document.querySelectorAll(".cm-row")].find(r => r.textContent.includes("AIR EUROPA"));
    fila.querySelector(".cm-main").click();
  });
  await page.waitForFunction(() => !!document.querySelector(".cm-row.is-open .cm-det"), { timeout: 5000 });
  await page.screenshot({ path: shot("2-detalle-listo"), fullPage: true });
  const det = await page.evaluate(() => {
    const d = document.querySelector(".cm-row.is-open .cm-det");
    const btn = [...d.querySelectorAll("button")].find(b => b.textContent.includes("Cerrar el período"));
    return { texto: d.textContent.replace(/\s+/g, " "), cierreHabilitado: btn ? !btn.disabled : null };
  });
  check(det.cierreHabilitado === true, "con los tres requisitos hechos, 'Cerrar el período' está habilitado");
  check(/fact\. 1189|1189/.test(det.texto), "el detalle muestra el número de factura del pago");

  // ── 5. En una que espera, el cierre está DESHABILITADO ──────────────────
  await page.evaluate(() => {
    const fila = [...document.querySelectorAll(".cm-row")].find(r => r.textContent.includes("FORTALEZA"));
    fila.querySelector(".cm-main").click();
  });
  await page.waitForFunction(() => document.querySelector(".cm-row.is-open")?.textContent.includes("FORTALEZA"), { timeout: 5000 });
  const esp = await page.evaluate(() => {
    const d = document.querySelector(".cm-row.is-open .cm-det");
    const btn = [...d.querySelectorAll("button")].find(b => b.textContent.includes("Cerrar el período"));
    return { deshabilitado: btn ? btn.disabled : null, texto: d.textContent.replace(/\s+/g, " ") };
  });
  check(esp.deshabilitado === true, "faltando requisitos, 'Cerrar el período' está deshabilitado");
  check(/Falta:/.test(esp.texto) && /entrega/.test(esp.texto),
    "el detalle dice QUÉ falta y por qué (no un chip mudo)");

  // ── 6. Confirmar el pago EXIGE el número de factura ─────────────────────
  await page.evaluate(() => {
    const d = document.querySelector(".cm-row.is-open .cm-det");
    [...d.querySelectorAll("button")].find(b => b.textContent.includes("Confirmar el primer pago")).click();
  });
  await page.waitForFunction(() => !!document.querySelector(".cm-form"), { timeout: 5000 });
  await page.screenshot({ path: shot("3-form-pago"), fullPage: true });
  const provocados = [];
  esperando = provocados;
  await page.evaluate(() => {
    const d = document.querySelector(".cm-row.is-open .cm-det");
    [...d.querySelectorAll("button")].find(b => b.textContent.trim() === "Guardar").click();
  });
  await new Promise(r => setTimeout(r, 400));
  esperando = null;
  const escrituras1 = await page.evaluate(() => window.__ESCRITURAS.length);
  check(escrituras1 === 0, `sin número de factura NO se escribe nada (escrituras: ${escrituras1})`);
  check(provocados.some(e => /número de la factura/i.test(e)),
    "y el candado lo dice con el mensaje correcto");

  // Con factura y saldo pendiente: se guarda, pero NO libera.
  await page.evaluate(() => {
    const d = document.querySelector(".cm-row.is-open .cm-det");
    d.querySelector('input[id^="pgF-"]').value = "5001";
    d.querySelector('input[id^="pgS-"]').value = "45";
    [...d.querySelectorAll("button")].find(b => b.textContent.trim() === "Guardar").click();
  });
  await new Promise(r => setTimeout(r, 600));
  const conSaldo = await page.evaluate(() => {
    const e = window.__ESCRITURAS[window.__ESCRITURAS.length - 1];
    return e ? { estado: e.patch["comision.estado"], pago: e.patch["comision.requisitos.pago"] } : null;
  });
  check(!!conSaldo && conSaldo.pago?.hecho === false,
    "una factura con saldo NO cuenta como pago hecho");
  check(!!conSaldo && conSaldo.estado === "esperando",
    `con saldo pendiente la comisión sigue 'esperando' (dio "${conSaldo && conSaldo.estado}")`);

  // ── 7. Filtro "Pagadas" y CSV ───────────────────────────────────────────
  await page.evaluate(() => document.querySelector('[data-f="pagada"]').click());
  await new Promise(r => setTimeout(r, 250));
  const pag = await page.evaluate(() => ({
    filas: document.querySelectorAll(".cm-row").length,
    texto: document.getElementById("cmRows").textContent.replace(/\s+/g, " "),
  }));
  check(pag.filas === 1 && /NADCAR/.test(pag.texto), "el filtro 'Pagadas' muestra solo la cerrada");
  check(/Pagada/i.test(pag.texto), "la fila pagada se ve como pagada");
  await page.screenshot({ path: shot("4-pagadas"), fullPage: true });

  // ── 8. Cero errores de consola ──────────────────────────────────────────
  const reales = errores.filter(e => !/favicon|manifest|404|net::ERR|Failed to load resource/i.test(e));
  check(reales.length === 0, `sin errores de consola${reales.length ? ": " + reales.slice(0, 3).join(" | ") : ""}`);

  console.log(`\nCapturas: ${OUT}`);
  console.log(fallos ? `\n${fallos} FALLO(S)` : "\nTodo en orden.");
  await browser.close();
  process.exit(fallos ? 1 : 0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
