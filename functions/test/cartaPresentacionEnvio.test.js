// Carta de presentación: que la casilla del vendedor llegue al cliente.
//
// Incidente COT-2026-0040 (CCT, 11-ago-2026): la vendedora destildó "Incluir
// carta de presentación" y la cotización salió CON carta igual. La lógica no
// estaba rota — el documento guardado decía `incluye_carta: true`. Lo que falla
// es la costura: la casilla vive en el editor, pero el envío ocurre en OTRAS
// pantallas (detalle · aprobar desde el listado) que releen el documento de
// Firestore. Un cambio que nunca se guardó, o que se hizo después del último
// Guardar, se pierde sin que nadie lo note.
//
// Este archivo congela los invariantes de esa costura:
//   C1 — toUi/toDoc conservan el destildado, y una cotización de taller nunca
//        lleva carta aunque el campo diga true.
//   C2 — el editor persiste la casilla al instante (no espera a Guardar) y
//        avisa antes de salir con cambios pendientes.
//   C3 — el panel de envío del detalle muestra la carta y respeta lo que se
//        marque ahí (persiste + reescribe el espejo público).
//   C4 — el overlay de aprobación (que aprueba Y envía de una vez) muestra la
//        carta y la persiste.
//   C5 — ninguna ruta de envío inventa el valor: todas lo resuelven con
//        CotState.llevaCarta() sobre el documento.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// ── Carga de CotState con las dependencias mínimas de parse-time ──────────
function cargarCotState() {
  const ctx = {
    console,
    window: {},
    document: { getElementById: () => null, createElement: () => ({ style: {} }) },
    firebase: { firestore: () => ({}) },
  };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "cotizacionesTotales.js"), ctx);
  // FMT: solo lo que toDoc necesita (redondeo e ITBMS canónico).
  ctx.window.FMT = { round2: (n) => Math.round(Number(n || 0) * 100) / 100, ITBMS_RATE: 0.07, esc: String };
  ctx.FMT = ctx.window.FMT;
  ctx.CotizacionTotales = ctx.window.CotizacionTotales;
  vm.runInContext(leer("public", "js", "pages", "cot-editor-state.js"), ctx);
  return ctx.window.CotState;
}

const CATALOGOS = {
  clientesById: { c1: { razon: "COLON CONTAINER TERMINAL", ruc: "", email: "x@y.com", representante: "", itbms_exento: true } },
  ejecutivos: [{ id: "e1", nombre: "Zuleika Diaz" }],
};

const BASE = {
  id: "COT-2026-0040", estado: "borrador", clienteId: "c1", ejecutivoId: "e1",
  fecha: "2026-08-11", validezDias: 15, moneda: "USD", descuentoPct: 0, itbmsPct: 0,
  items: [{ id: "i1", nombre: "Radio", cant: 1, precio: 100, desc: 0 }], condiciones: [],
};

test("C1 · el destildado sobrevive al guardado y el taller nunca lleva carta", () => {
  const CotState = cargarCotState();

  // Default: casilla marcada → el cliente recibe la carta.
  const porDefecto = CotState.toDoc({ ...BASE }, { catalogos: CATALOGOS });
  assert.equal(porDefecto.incluye_carta, true);
  assert.equal(CotState.llevaCarta(porDefecto), true);

  // Destildada en pantalla → false en el documento → sin carta.
  const sinCarta = CotState.toDoc({ ...BASE, incluye_carta: false }, { catalogos: CATALOGOS });
  assert.equal(sinCarta.incluye_carta, false, "toDoc debe persistir el destildado");
  assert.equal(CotState.llevaCarta(sinCarta), false);

  // Y sobrevive al viaje de vuelta a la pantalla (editar → volver a guardar).
  const devuelta = CotState.toUi({ ...sinCarta, cotizacion_id: sinCarta.cotizacion_id });
  assert.equal(devuelta.incluye_carta, false, "toUi no puede re-marcar la casilla");
  assert.equal(CotState.toDoc(devuelta, { catalogos: CATALOGOS }).incluye_carta, false);

  // Cotización de taller: el campo no manda, el origen sí.
  assert.equal(CotState.llevaCarta({ ...porDefecto, origen: "orden" }), false);
  assert.equal(CotState.llevaCarta({ ...porDefecto, orden_id: "2026081001" }), false);

  // Documentos legacy (sin el campo) siguen llevando carta: es el default.
  const legacy = { ...porDefecto };
  delete legacy.incluye_carta;
  assert.equal(CotState.llevaCarta(legacy), true);
});

test("C2 · el editor guarda la casilla al instante y avisa de cambios sin guardar", () => {
  const src = leer("public", "js", "pages", "cot-editor.js");

  // El toggle escribe a Firestore por su cuenta: esperar al botón Guardar es
  // justo lo que perdió el destildado en COT-2026-0040.
  const toggle = src.slice(src.indexOf("async function onToggleCarta"), src.indexOf("// ── Cliente y meta"));
  assert.match(toggle, /updateCotizacion\(/, "onToggleCarta debe persistir la casilla al instante");
  assert.match(toggle, /incluye_carta/, "onToggleCarta debe escribir incluye_carta");
  assert.match(toggle, /chk\.checked = !val/, "un error al guardar debe revertir la casilla en pantalla");

  // Salir con cambios pendientes no puede ser silencioso.
  assert.match(src, /beforeunload/, "el editor debe avisar al cerrar la pestaña con cambios sin guardar");
  assert.match(src, /Cambios sin guardar/, "Cancelar/breadcrumb deben confirmar antes de descartar");
});

test("C3 · el panel de envío del detalle expone la carta y respeta lo que se marque", () => {
  const estado = leer("public", "js", "pages", "cot-editor-state.js");
  const detalle = leer("public", "js", "pages", "cot-detalle.js");

  const prompt = estado.slice(estado.indexOf("function reenviarPrompt"), estado.indexOf("Correo de solicitud de aprobación"));
  assert.match(prompt, /id="rxCarta"/, "el panel de envío debe mostrar el estado de la carta");
  assert.match(prompt, /llevaCarta: chkCarta \? chkCarta\.checked : null/, "el payload debe devolver la decisión del panel");

  assert.match(detalle, /llevaCarta: cartaAplica \? CotState\.llevaCarta\(cot\) : null/, "el detalle debe pasarle el estado vigente al panel");
  // Cambiarla en el panel tiene que persistir Y reescribir el espejo público:
  // el cliente abre el espejo, no la cotización.
  const tramo = detalle.slice(detalle.indexOf("if (cartaAplica && payload.llevaCarta"), detalle.indexOf("cot.estado = 'enviada'"));
  assert.match(tramo, /updateCotizacion\(cot\._docId, \{ incluye_carta: payload\.llevaCarta \}\)/);
  assert.match(tramo, /generarLink\(\)/, "tras cambiar la casilla hay que regenerar el espejo público");
});

test("C4 · aprobar-y-enviar desde el listado muestra la carta y la persiste", () => {
  const src = leer("public", "js", "pages", "cotizaciones-index.js");

  // El botón Enviar del listado es la tercera ruta al cliente: mismo trato.
  const enviar = src.slice(src.indexOf("async function enviar(cot)"), src.indexOf("async function duplicar"));
  assert.match(enviar, /llevaCarta: cartaAplica \? CotState\.llevaCarta\(cot\) : null/);
  assert.match(enviar, /updateCotizacion\(cot\.id, \{ incluye_carta: payload\.llevaCarta \}\)/);
  assert.match(enviar, /ensureLinkPublico\(cot\.id\)/, "cambiar la casilla obliga a reescribir el espejo");

  const overlay = src.slice(src.indexOf("async function openAprobacion"), src.indexOf("function cerrarAprobacion"));
  assert.match(overlay, /chkCartaAprob/, "el overlay de aprobación debe mostrar la carta");
  assert.match(overlay, /CotState\.llevaCarta\(doc\)/, "el estado mostrado sale del documento, no de un default");
  assert.match(overlay, /updateCotizacion\(docId, \{ incluye_carta: val \}\)/, "cambiarla ahí debe persistir: confirmarAprobacion relee el documento");
});

test("C5 · toda ruta de envío resuelve la carta con llevaCarta() sobre el documento", () => {
  for (const [archivo, ancla] of [
    ["cot-detalle.js", "lleva_carta: CotState.llevaCarta(cot)"],
    ["cotizaciones-index.js", "lleva_carta: CotState.llevaCarta(doc)"],
  ]) {
    assert.match(
      leer("public", "js", "pages", archivo),
      new RegExp(ancla.replace(/[.()]/g, "\\$&")),
      `${archivo} debe alimentar el espejo público con CotState.llevaCarta()`,
    );
  }
  // La vista pública lee el booleano ya resuelto del espejo, nunca `origen`.
  assert.match(leer("public", "js", "pages", "verify-cotizacion.js"), /data\.lleva_carta === true/);
});
