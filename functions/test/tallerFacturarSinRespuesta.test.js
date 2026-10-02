// "Pasar a facturar sin respuesta del cliente" (2026-10-01, pedido de Solangel).
//
// EL HUECO
//   El taller cotiza con validez de 3-5 días. Muchas veces el cliente no acepta
//   ni rechaza: la validez se cumple, markCotizacionesVencidas la pasa a
//   'vencida', el botón "Respuesta del cliente" desaparece y la entrega de la
//   orden ya no la manda a facturar (vencida no es facturable). La reparación
//   ya hecha se quedaba sin factura y fuera de la bandeja de Brenda.
//
// LO QUE PROTEGE
//   S1 — La hoja del taller ofrece "Pasar a facturar sin respuesta" y exige
//        quién lo autorizó; cierra como 'convertida' con medio sin_respuesta.
//   S2 — Se ofrece EN CUALQUIER MOMENTO: enviada, aprobada y también vencida
//        (detalle y listado). Una reposición por daño no la tiene.
//   S3 — Lo que se lee no miente: chip "A facturar", historial y la fila de
//        Brenda dicen que el cliente NO respondió y quién autorizó.
//   S4 — Pasar una vencida a facturar vuelve a fijar los materiales de la orden.
//
// Corre con `npm test` (node --test). Sin red ni navegador.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Module = require("module");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const CT = require("../../public/js/domain/cotizacionTaller.js");

const TALLER = { cotizacion_id: "COT-2026-0102", origen: "orden", orden_id: "2026090308", cliente_nombre: "MACELLO, S.A." };

// CotState con un Modal.sheet falso que guarda la hoja para "clicarla".
function montarCotState() {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  const hojas = [];
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  ctx.window.FMT = {
    esc, ITBMS_RATE: 0.07,
    round2: (n) => Math.round(Number(n || 0) * 100) / 100,
    money: (n) => "$" + Number(n || 0).toFixed(2),
  };
  ctx.FMT = ctx.window.FMT;
  ctx.Modal = {
    sheet: (cfg) => new Promise((resolve) => hojas.push({ cfg, resolve })),
    confirm: async () => true,
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "cotizacionesTotales.js"), ctx);
  vm.runInContext(leer("public", "js", "domain", "cotizacionTaller.js"), ctx);
  ctx.CotizacionTotales = ctx.window.CotizacionTotales;
  ctx.CotizacionTaller = ctx.window.CotizacionTaller;
  vm.runInContext(leer("public", "js", "pages", "cot-editor-state.js"), ctx);
  return { S: ctx.window.CotState, hojas };
}

// Monta la hoja sobre un "DOM" mínimo: inputs por id y un único listener de
// click en la raíz, que es como la hoja escucha sus botones.
function montarHoja(hoja, valores = {}) {
  const els = {};
  const el = (id) => (els[id] ||= { id, style: {}, value: valores[id] ?? "", textContent: "", focus() {} });
  let onClick = null;
  let cerrado = null;
  const root = {
    querySelector: (sel) => el(sel.replace(/^#/, "")),
    addEventListener: (ev, fn) => { if (ev === "click") onClick = fn; },
  };
  hoja.cfg.onMount(root, { close: (v) => { cerrado = v; } });
  const clic = (act) => onClick({ target: { closest: () => ({ dataset: { act } }) } });
  return { clic, el, cerrado: () => cerrado };
}

test("S1 · la hoja ofrece pasar a facturar sin respuesta y exige quién lo autorizó", () => {
  const { S, hojas } = montarCotState();
  S.cerrarPrompt({ cotizacionId: "COT-2026-0102", total: 301.89, cliente: "MACELLO", taller: true, vencida: true });
  const h = hojas[0];
  assert.match(h.cfg.html, /data-act="sin-respuesta"/);
  assert.match(h.cfg.html, /Pasar a facturar sin respuesta del cliente/);
  assert.match(h.cfg.html, /Se venció la validez sin respuesta/, "sobre una vencida, la hoja dice por qué sigue abierta");

  const m = montarHoja(h, { ctAutorizo: "  " });
  m.clic("sin-respuesta");
  assert.equal(m.el("ctSinResp").style.display, "", "abre el panel de quién autorizó");
  m.clic("confirmar-sin-respuesta");
  assert.equal(m.cerrado(), null, "sin quién autorizó no pasa");
  assert.match(m.el("ctSinRespError").textContent, /quién autorizó/);

  m.el("ctAutorizo").value = "Lo autorizó Juan Pérez (vendedor)";
  m.clic("confirmar-sin-respuesta");
  assert.deepEqual(JSON.parse(JSON.stringify(m.cerrado())), {
    estado: "convertida", motivo: "",
    aceptacion: { medio: "sin_respuesta", nota: "Lo autorizó Juan Pérez (vendedor)" },
  });
});

test("S1 · la reposición por daño NO tiene esa salida: se factura solo si el cliente acepta", () => {
  const { S, hojas } = montarCotState();
  S.cerrarPrompt({ cotizacionId: "COT-X", total: 250, cliente: "GAMBOA", taller: true, reposicion: true });
  assert.doesNotMatch(hojas[0].cfg.html, /data-act="sin-respuesta"/);
});

test("S2 · el botón se ofrece en enviada, aprobada y vencida (detalle y listado)", () => {
  const det = leer("public", "js", "pages", "cot-detalle.js");
  // Desde d3a5be6 (decisión 12 de Alberto) la comercial vencida también se
  // cierra; el taller sigue teniendo su "Pasar a facturación".
  assert.match(det, /cot\.estado === 'aprobada' \|\| cot\.estado === 'enviada' \|\| \(cot\.estado === 'vencida' && !cot\.gestion_id\)\) \? \(esTaller\(\)/);
  assert.match(det, /vencida: cot\.estado === 'vencida'/);
  const idx = leer("public", "js", "pages", "cotizaciones-index.js");
  assert.match(idx, /c\.estado === 'aprobada' \|\| c\.estado === 'enviada' \|\| \(c\.estado === 'vencida' && !c\.gestion_id\)\) \? \(esTallerC\(c\)/);
  assert.match(idx, /vencida: cot\.estado === 'vencida'/);
});

test("S3 · chip, pasos e historial dicen que el cliente no respondió", () => {
  const { S } = montarCotState();
  const doc = { ...TALLER, estado: "convertida", enviada_en: 1, aceptacion: { medio: "sin_respuesta", nota: "vendedor" } };
  assert.equal(S.estadoLabel("convertida", doc), "A facturar");
  assert.equal(S.estadoLabel("convertida", { ...TALLER, aceptacion: { medio: "correo" } }), "Aceptada", "la aceptación normal no cambia");
  assert.equal(CT.pasos(doc)[2].t, "En facturación · sin respuesta del cliente");
  assert.equal(CT.medioLabel("sin_respuesta"), "Sin respuesta del cliente · autorizada internamente");
  assert.ok(!CT.MEDIOS_ACEPTACION.some(([k]) => k === "sin_respuesta"), "no aparece en '¿Cómo aceptó?'");
  assert.match(S.cierreToast("convertida", { taller: true, sinRespuesta: true }), /Pasada a facturación/);
  const det = leer("public", "js", "pages", "cot-detalle.js");
  assert.match(det, /'Pasó a facturación sin respuesta del cliente'/);
});

test("S3 · la fila de Brenda dice que el cliente no respondió y quién autorizó", async () => {
  let aviso = null;
  let marca = null;
  const origLoad = Module._load;
  Module._load = function (req, parent) {
    if (parent && /facturacionCotizacion/.test(parent.filename)) {
      if (req === "./admin") return { admin: { firestore: { FieldValue: { serverTimestamp: () => "TS" } } }, db: {} };
      if (req === "./inventario") return { APP_BASE_URL: "https://app.test" };
      if (req === "./gestiones") {
        return {
          escapeHtml: (s) => String(s ?? "").replace(/</g, "&lt;"),
          avisoFacturacion: async (a) => { aviso = a; },
        };
      }
      if (req === "./facturacionAvisos") return { avisoId: (t, id) => `${t}__${id}` };
    }
    return origLoad.apply(this, arguments);
  };
  const ruta = require.resolve("../src/lib/facturacionCotizacion");
  delete require.cache[ruta];
  const FC = require(ruta);

  const cot = {
    ...TALLER, estado: "convertida", creado_por_email: "solangel@x", total: 301.89,
    items: [{ cant: 1, nombre: "Reparación", precio: 282.14 }],
    aceptacion: { medio: "sin_respuesta", nota: "Lo autorizó Juan (vendedor)" },
  };
  const abrio = await FC.abrirFacturacionCotizacion(
    { id: "doc1", data: () => cot, ref: { set: async (v) => { marca = v; } } },
    { momento: "aceptacion", orden: { estado_reparacion: "ENTREGADO AL CLIENTE" } },
  ).finally(() => { Module._load = origLoad; });
  assert.equal(abrio, true);
  assert.match(aviso.titulo, /sin respuesta del cliente — autorizada para facturar/);
  assert.match(aviso.cuerpo, /<b>no respondió<\/b>/);
  assert.match(aviso.cuerpo, /autorizó: Lo autorizó Juan \(vendedor\)/);
  assert.match(aviso.cuerpo, /El equipo ya se entregó/);
  assert.doesNotMatch(aviso.cuerpo, /el cliente aceptó/i, "no dice que el cliente aceptó");
  assert.doesNotMatch(aviso.cuerpo, /Nota de la aceptación/, "la nota no se repite");
  assert.match(aviso.aviso.contexto.origen_texto, /^Sin respuesta del cliente · autorizada internamente/);
  assert.equal(aviso.aviso.contexto.aceptacion_medio, "sin_respuesta");
  assert.equal(marca.facturacion.aviso_id, "cotizacion_servicio__doc1");
});

test("S4 · vencida → convertida vuelve a fijar los materiales; el correo de vencida enseña la salida", () => {
  const est = leer("functions", "src", "triggers", "cotizaciones", "onEstadoChange.js");
  assert.match(est, /else if \(estadoDespues === "convertida" && ESTADOS_REABREN\.includes\(estadoAntes\)\) emitida = true;/);
  const ven = leer("functions", "src", "triggers", "scheduled", "markCotizacionesVencidas.js");
  assert.match(ven, /c\.origen === "orden" && !c\.gestion_id[\s\S]{0,400}Pasar a facturar sin respuesta del cliente/);
});
