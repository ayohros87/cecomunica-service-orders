// Cotización de TALLER con su propio circuito + REEMPLAZO POR DAÑO del cliente
// (2026-09-25, pedido de Solangel y decisión de Alberto).
//
// LO QUE PROTEGE
//   T — La cotización de taller es un documento propio: su asunto y su título
//       dicen "servicio técnico" y nombran la orden, firma quien la hizo con
//       SU cargo (no "Ejecutivo de Ventas"), no arrastra las condiciones de
//       una venta de equipos, y en el taller 'convertida' se lee "Aceptada".
//       Del lado de ventas nada cambia.
//   E — El correo al cliente tiene UNA sola definición para las dos puertas
//       de envío, y ninguna le pone "aprobada" en el asunto.
//   F — "El cliente aceptó" abre la fila de Facturación pendiente (aunque el
//       equipo siga en el taller), por la MISMA función que la entrega, que
//       es idempotente: la entrega posterior no abre una segunda fila.
//   R — Reposición por daño: la cotización que arma el sistema es de taller,
//       lleva la gestión y el monto aprobado; bodega NO se entera hasta que el
//       cliente acepta; si no acepta, el caso se cierra y pasa a cobranza; la
//       entrega de la orden nunca factura una reposición no aceptada.
//   P — Las reglas: sin fotos no nace una propuesta por daño, y
//       `pendiente_cliente` solo existe para esa causa.
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

// lib/reposicionDano sin Firebase: solo se prueban sus funciones puras.
const origLoad = Module._load;
Module._load = function (req, parent) {
  if (req === "./admin" && parent && /reposicionDano|cobrosEquipos/.test(parent.filename)) {
    return { admin: { firestore: { FieldValue: {}, Timestamp: {} } }, db: {} };
  }
  if (req === "./inventario" && parent && /reposicionDano/.test(parent.filename)) {
    return { APP_BASE_URL: "https://app.test" };
  }
  return origLoad.apply(this, arguments);
};
const RD = require("../src/lib/reposicionDano");
Module._load = origLoad;
const CS = require("../src/lib/cotizacionServicio");

function montarCotState() {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));
  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  ctx.window.FMT = {
    esc, ITBMS_RATE: 0.07,
    round2: (n) => Math.round(Number(n || 0) * 100) / 100,
    money: (n) => "$" + Number(n || 0).toFixed(2),
  };
  ctx.FMT = ctx.window.FMT;
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "domain", "cotizacionesTotales.js"), ctx);
  vm.runInContext(leer("public", "js", "domain", "cotizacionTaller.js"), ctx);
  ctx.CotizacionTotales = ctx.window.CotizacionTotales;
  ctx.CotizacionTaller = ctx.window.CotizacionTaller;
  vm.runInContext(leer("public", "js", "pages", "cot-editor-state.js"), ctx);
  return ctx.window.CotState;
}

const TALLER = { cotizacion_id: "COT-2026-0101", origen: "orden", orden_id: "2026092501", cliente_nombre: "SKY CHEFS" };
const VENTA = { cotizacion_id: "COT-2026-0102", origen: "comercial", cliente_nombre: "RIBA SMITH" };

// ── T ─────────────────────────────────────────────────────────────────────
test("T · el asunto y el título distinguen taller de ventas; ventas no cambia", () => {
  assert.equal(CT.asunto(TALLER),
    "Cotización de servicio técnico COT-2026-0101 · Orden 2026092501 · SKY CHEFS · Cecomunica");
  assert.equal(CT.asunto(VENTA), "Cotización COT-2026-0102 · RIBA SMITH · Cecomunica");
  assert.equal(CT.tituloDocumento(TALLER), "Cotización de servicio técnico");
  assert.equal(CT.tituloDocumento(VENTA), "Cotización");
  // Las viejas sin `origen` pero con orden siguen siendo de taller.
  assert.equal(CT.esTaller({ orden_id: "2026010101" }), true);
  assert.doesNotMatch(CT.notaLegal(TALLER), /orden de compra/, "una reparación no tiene orden de compra");
  assert.match(CT.notaLegal(VENTA), /orden de compra/);
});

test("T · el cargo: lo guardado en la cotización manda; sin él, el de la jefatura de taller", () => {
  assert.equal(CT.cargoFirmante({ ...TALLER, ejecutivo_cargo: "Jefa de Taller" }, { rol: "Otro" }), "Jefa de Taller");
  assert.equal(CT.cargoFirmante(TALLER, { rol: "Jefa de Taller" }), "Jefa de Taller");
  assert.equal(CT.cargoFirmante(TALLER, null), "Jefe(a) de Taller", "nunca 'Ejecutivo de Ventas' en una de taller");
  assert.equal(CT.cargoFirmante(VENTA, null), "Ejecutivo de Ventas", "el respaldo de ventas es el de siempre");
  assert.equal(CT.cargoPorRol("vendedor"), "", "a ventas no se le cambia lo que ya imprime");
});

test("T · condiciones: la de taller trae la garantía de 30 días y ninguna de venta", () => {
  const ks = CT.CONDICIONES_TALLER.map((c) => c.k.toLowerCase()).join(" | ");
  assert.match(CT.CONDICIONES_TALLER[0].v, /30 días/);
  assert.doesNotMatch(ks, /entrega|forma de pago|instalaci/);
  const S = montarCotState();
  // Una de taller guardada SIN condiciones se lee sin condiciones — antes se
  // rellenaba con las de venta al abrirla.
  assert.deepEqual(JSON.parse(JSON.stringify(S.toUi({ ...TALLER, condiciones: [] }).condiciones)), []);
  assert.ok(S.toUi({ ...VENTA, condiciones: [] }).condiciones.length > 0, "la comercial vieja conserva sus defaults");
  assert.ok(S.PLANTILLAS_COND.some((p) => p.id === "taller"), "plantilla de taller en el editor");
});

// Desde la auditoría UX 2026-09-28 (glosario T2) 'convertida' se lee
// "Aceptada" también en ventas: "orden de venta" no es un documento del sistema.
test("T · 'convertida' se lee Aceptada en taller y en ventas", () => {
  const S = montarCotState();
  assert.equal(S.estadoLabel("convertida", TALLER), "Aceptada");
  assert.equal(S.estadoLabel("convertida", VENTA), "Aceptada");
  const p = CT.pasos({ ...TALLER, estado: "convertida", enviada_en: 1, facturacion: { estado: "facturada", factura: "F-88" } });
  assert.deepEqual(p.map((x) => x.done), [true, true, true, true]);
  assert.equal(p[3].t, "Facturada · F-88");
  const r = CT.pasos({ ...TALLER, estado: "rechazada", enviada_en: 1 });
  assert.equal(r[2].cortada, true, "una rechazada no sigue a facturación");
});

test("T · volver a guardar un borrador de taller NO le borra el nombre ni el cargo al firmante", () => {
  const S = montarCotState();
  const ui = S.toUi({ ...TALLER, ejecutivoId: "sol", ejecutivo_nombre: "Solangel", ejecutivo_cargo: "Jefa de Taller", items: [] });
  // El catálogo del editor no trae a la jefa de taller (no es vendedora).
  const doc = S.toDoc(ui, { catalogos: { clientesById: {}, ejecutivos: [] } });
  assert.equal(doc.ejecutivo_nombre, "Solangel");
  assert.equal(doc.ejecutivo_cargo, "Jefa de Taller");
});

// ── E ─────────────────────────────────────────────────────────────────────
test("E · un solo correo al cliente: taller nombra la orden y pide responder para autorizar", () => {
  const S = montarCotState();
  const t = S.correoCliente({ doc: TALLER, clienteNombre: "SKY CHEFS", total: 104.22, link: "https://x",
    ejecutivo: "Solangel", ejecutivoCargo: "Jefa de Taller" });
  assert.match(t.subject, /^Cotización de servicio técnico COT-2026-0101 · Orden 2026092501/);
  assert.match(t.html, /Orden de servicio:<\/b> 2026092501/);
  assert.match(t.html, /Solangel · Jefa de Taller/);
  assert.match(t.html, /basta con responder a este correo/);
  const v = S.correoCliente({ doc: VENTA, clienteNombre: "RIBA SMITH", total: 10, link: "https://x" });
  assert.equal(v.subject, "Cotización COT-2026-0102 · RIBA SMITH · Cecomunica");
  assert.doesNotMatch(v.html, /Orden de servicio/);
  // La copia que vivía en "Aprobar y enviar" le decía "aprobada" al cliente.
  // "Aprobar y enviar" vive en cot-aprobacion.js desde la auditoría UX 2026-09-28.
  const idx = leer("public", "js", "pages", "cot-aprobacion.js");
  assert.doesNotMatch(idx, /aprobada\$\{clienteNom/, "el asunto al cliente ya no dice 'aprobada'");
  assert.match(idx, /CotState\.correoCliente\(/);
});

test("E · la respuesta del cliente vuelve al firmante, no al buzón del SMTP", () => {
  const S = montarCotState();
  assert.equal(S.replyToDe({ ejecutivoEmail: "solangel@cecomunica.com", creadoPorEmail: "tec@cecomunica.com" }), "solangel@cecomunica.com");
  assert.equal(S.replyToDe({ ejecutivoEmail: "x@sin.email.cecomunica.com", creadoPorEmail: "tec@cecomunica.com" }), "tec@cecomunica.com");
  assert.equal(S.replyToDe({}), null);
  const q = leer("functions", "src", "triggers", "mail", "onMailQueued.js");
  assert.match(q, /replyTo:\s+\/\^/, "onMailQueued pasa replyTo (validado) al SMTP");
});

test("E · el espejo público dice que es de taller y lleva el cargo", () => {
  const S = montarCotState();
  const T = { subtotal: 1, descGlobal: 0, itbms: 0, total: 1, venta: { total: 1 }, alquiler: { total: 0 }, plazoMeses: 0, hayAlquiler: false, hayVenta: true };
  const snap = S.snapshotPublico({ ...TALLER, id: "COT-2026-0101", condiciones: [] }, T, {}, { nombre: "Solangel", rol: "Jefa de Taller" });
  assert.equal(snap.origen, "orden");
  assert.equal(snap.orden_id, "2026092501");
  assert.equal(snap.ejecutivo.rol, "Jefa de Taller");
  assert.equal(CT.tituloDocumento(snap), "Cotización de servicio técnico", "la vista pública lo lee del espejo");
});

// ── F ─────────────────────────────────────────────────────────────────────
test("F · 'El cliente aceptó' abre la facturación por la misma función que la entrega", () => {
  const est = leer("functions", "src", "triggers", "cotizaciones", "onEstadoChange.js");
  assert.match(est, /estadoDespues === "convertida"[\s\S]{0,400}abrirFacturacionCotizacion\(event\.data\.after, \{ momento: "aceptacion" \}\)/);
  const ent = leer("functions", "src", "triggers", "ordenes", "onOrdenEntregada.js");
  assert.match(ent, /abrirFacturacionCotizacion\(d, \{ momento: "entrega"/);
  const lib = leer("functions", "src", "lib", "facturacionCotizacion.js");
  assert.match(lib, /if \(cot\.facturacion\?\.aviso_id\)[\s\S]{0,200}return false;/, "idempotente: la segunda puerta no abre otra fila");
  assert.match(lib, /equipo_en_taller:/, "la fila dice si el equipo sigue en el taller");
  // El panel manual del detalle no puede saltarse la pregunta de CÓMO aceptó.
  const det = leer("public", "js", "pages", "cot-detalle.js");
  assert.match(det, /filter\(e => !\(esTaller\(\) && e === 'convertida'\)\)/);
});

// ── R ─────────────────────────────────────────────────────────────────────
const G_DANO = {
  tipo: "reemplazo", causa: "dano_cliente", cliente_id: "cli1", cliente_nombre: "GAMBOA",
  estado: "pendiente_cliente",
  origen: { tipo: "taller", orden_id: "2026092502", equipo_id: "e1", diagnostico: "Cayó al agua" },
  dano: { tipo: "liquido", fotos: ["gestiones_anexos/GR1/dano-1.jpg"] },
  cobro: { requiere: true, monto_referencia: 285, monto: 250 },
  items: [{ serial_saliente: "B6810431", modelo: "NX-420", modelo_id: "nx420" }],
};

test("R · el monto: el que aprobó administración manda sobre el del catálogo; sin ninguno, null", () => {
  assert.equal(RD.montoReposicion(G_DANO), 250);
  assert.equal(RD.montoReposicion({ ...G_DANO, cobro: { monto_referencia: 285 } }), 285);
  assert.equal(RD.montoReposicion({ ...G_DANO, cobro: {} }), null, "no se inventa un precio");
  assert.deepEqual(RD.totalesReposicion(250), { subtotal: 250, itbms: 17.5, total: 267.5 });
  assert.deepEqual(RD.totalesReposicion(250, { exento: true }), { subtotal: 250, itbms: 0, total: 250 });
  assert.equal(RD.cobraCargo(G_DANO), true);
  assert.equal(RD.cobraCargo({ ...G_DANO, cobro: { requiere: false } }), false, "la cortesía no cobra");
  assert.equal(RD.esReposicionDano({ tipo: "reemplazo", causa: "falla" }), false);
});

test("R · la cotización que arma el sistema es de TALLER, de la gestión y facturable al aceptarse", () => {
  const doc = RD.docCotizacionReposicion({
    gid: "GR20260925-01", g: G_DANO, cliente: { email: "c@x.com", representante: "Ana" },
    firmante: { uid: "sol", nombre: "Solangel", email: "sol@cecomunica.com", cargo: "Jefa de Taller" },
    cotizacionId: "COT-2026-0103", fechaIso: "2026-09-25", validezDias: 15, monto: 250,
  });
  assert.equal(doc.estado, "borrador", "la envía la jefatura de taller, no sale sola");
  assert.equal(doc.origen, "orden");
  assert.equal(doc.orden_id, "2026092502");
  assert.equal(doc.gestion_id, "GR20260925-01");
  assert.deepEqual(doc.condiciones, []);
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].equipo.serial, "B6810431");
  assert.equal(doc.items[0].precio, 250);
  assert.equal(doc.total_con_itbms, 267.5);
  assert.equal(doc.ejecutivo_cargo, "Jefa de Taller");
  assert.equal(doc.creado_por_email, "sol@cecomunica.com", "la factura le vuelve a quien firmó");
  assert.equal(CT.esTaller(doc), true);
  assert.equal(CS.esFacturable({ ...doc, estado: "convertida" }), true);
  assert.equal(CS.resumenCotizacion({ ...doc, estado: "convertida" }).total, 267.5);
});

test("R · bodega espera al cliente; aceptar libera, rechazar cierra y va a cobranza", () => {
  const gw = leer("functions", "src", "triggers", "gestiones", "onGestionWrite.js");
  // Aprobar con cargo → se arma la cotización, NO el correo a bodega.
  assert.match(gw, /before\.estado === "pendiente_aprobacion" && after\.estado === "pendiente_cliente"[\s\S]{0,120}RD\.crearCotizacionReposicion\(gid\)/);
  // El aviso a bodega sale cuando la gestión llega a pendiente_bodega DESDE pendiente_cliente.
  assert.match(gw, /\["pendiente_aprobacion", "pendiente_firma", "pendiente_cliente"\]\.includes\(before\.estado\)/);
  const lib = leer("functions", "src", "lib", "reposicionDano.js");
  assert.match(lib, /if \(g\.estado !== "pendiente_cliente"\) return \{ ok: false/, "solo mueve una gestión que espera al cliente");
  assert.match(lib, /estado: "pendiente_bodega",\s*\n\s*"cierre\.cotizacion": true/);
  assert.match(lib, /estado: "cerrada",\s*\n\s*resultado: "sin_reemplazo_cobranza"/);
  assert.match(lib, /CE\.abrirCobro\(\{[\s\S]{0,600}gestion_id: gid/, "la deuda queda en cobros_equipos");
  assert.match(lib, /g\.cobro\.cotizacion_doc_id !== docId\) return \{ ok: false, motivo: "otra_cotizacion" \}/,
    "rechazar una copia vieja no cierra el caso vivo");
  const est = leer("functions", "src", "triggers", "cotizaciones", "onEstadoChange.js");
  assert.match(est, /estadoDespues === "rechazada" && after\.gestion_id/);
  assert.match(est, /if \(after\.gestion_id\) return null;/, "la reposición no bloquea los materiales de la orden");
  const ent = leer("functions", "src", "triggers", "ordenes", "onOrdenEntregada.js");
  assert.match(ent, /CS\.esFacturable\(d\.data\(\)\) && !d\.data\(\)\.gestion_id/,
    "la entrega nunca factura una reposición que el cliente no aceptó");
  const cob = leer("functions", "src", "lib", "cobrosEquipos.js");
  assert.match(cob, /where\("gestion_id", "==", gestion_id\)/, "una gestión = una deuda");
});

test("R · la pantalla del técnico: dos causas, fotos obligatorias y propio sin reemplazo por daño", () => {
  const ui = leer("public", "js", "pages", "ordenes-reemplazo.js");
  assert.match(ui, /tarjeta\('falla', 'Falla del equipo'[\s\S]{0,120}'Sin cargo al cliente'/);
  assert.match(ui, /tarjeta\('dano_cliente', 'Daño causado por el cliente'[\s\S]{0,160}'Se cotiza y se factura'/);
  assert.match(ui, /esPropio, esPropio \? 'Este radio es del cliente: no hay reemplazo por daño/);
  assert.match(ui, /Agrega al menos una foto del daño/);
  assert.match(ui, /reservarId\('reemplazo'\)[\s\S]{0,600}gestiones_anexos\/\$\{gidReservado\}/,
    "las fotos suben ANTES de crear el expediente, con el número reservado");
  assert.doesNotMatch(ui, /lo decide ventas/, "el aprobador se llama administración");
});

// ── P ─────────────────────────────────────────────────────────────────────
test("P · reglas: sin fotos no hay propuesta por daño; pendiente_cliente solo para daño", () => {
  const r = leer("firestore.rules");
  assert.match(r, /request\.resource\.data\.get\("causa", ""\) != "dano_cliente"\s*\n\s*\|\| request\.resource\.data\.get\("dano", \{\}\)\.get\("fotos", \[\]\)\.size\(\) > 0/);
  assert.match(r, /\["pendiente_bodega","en_proceso","pendiente_firma","pendiente_cliente"\]/);
  assert.match(r, /request\.resource\.data\.estado != "pendiente_cliente"\s*\n\s*\|\| resource\.data\.get\("causa", ""\) == "dano_cliente"/);
  // `cambio_modelo` (2026-09-29) es la decisión sobre un radio de otro modelo.
  assert.match(r, /soloTocaG\(\["estado","aprobacion","cierre","cobro","cambio_modelo"\]\)/);
  assert.match(r, /resource\.data\.estado in \["pendiente_aprobacion","pendiente_firma","pendiente_bodega","pendiente_cliente"\]/,
    "mientras espera al cliente la gestión sigue blanda: se corrige o se anula sin efectos regados");
});
