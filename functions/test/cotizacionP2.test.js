// Cotizaciones P2 (auditoría UX 2026-09-28 §4.5 #12): el cliente responde
// desde el enlace, la búsqueda por tokens y la limpieza de adjuntos.
//
// LO QUE PROTEGE
//   1. responderCotizacionPublica — el código del enlace es el ÚNICO secreto:
//      sin él no se escribe nada; con él se escribe UNA vez y con la misma
//      forma que "Respuesta del cliente" del detalle (aceptacion.medio
//      'pagina', rechazo_origen 'cliente'), para que el historial, la fila de
//      facturación del taller y la reposición por daño reaccionen igual.
//      Idempotente: la segunda respuesta no cambia nada ni duplica el correo.
//   2. Los tokens del trigger y los del backfill son EL MISMO builder: si uno
//      cambia solo, el histórico y lo nuevo se buscan distinto.
//   3. huerfanos() no borra lo que alguna cotización nombra ni lo reciente.
//
// Corre con: node --test (desde functions/).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

// ── Stubs: nada de firebase-admin ni de registro de functions ────────────
const FIJO = new Date("2026-09-28T15:00:00.000Z");
const ts = (d) => ({ toDate: () => d, toISOString: () => d.toISOString() });
const fakeAdmin = {
  firestore: {
    Timestamp: { now: () => ts(FIJO) },
    FieldValue: { serverTimestamp: () => "SERVER_TS" },
  },
};
class HttpsError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const origLoad = Module._load;
Module._load = function (req, parent) {
  if (req === "firebase-functions/v2/https") return { onCall: (_o, f) => f, HttpsError };
  if (req === "firebase-functions/v2/firestore") return { onDocumentWritten: (_o, f) => f };
  if (req === "firebase-functions/v2/scheduler") return { onSchedule: (_o, f) => f };
  if (req === "firebase-functions/logger") return { info() {}, warn() {}, error() {}, debug() {} };
  if (/(^|\/)admin$/.test(req) && parent && /functions[\\/]src/.test(parent.filename)) {
    return { admin: fakeAdmin, db: {} };
  }
  return origLoad.apply(this, arguments);
};
const responder = require("../src/callable/responderCotizacionPublica");
const onTokens = require("../src/triggers/cotizaciones/onSearchTokens");
const purge = require("../src/triggers/scheduled/purgeAdjuntosCotizacionHuerfanos");
const backfill = require("../scripts/backfill-cotizaciones-search-tokens");
Module._load = origLoad;

const { handler, evaluar, construirPatches, correoVendedor, codigoValido } = responder._interno;

// Base falsa: docs por ruta, transacción que lee/escribe sobre el mismo mapa.
function fakeDb(docs) {
  const store = { docs: { ...docs }, mail: [] };
  const ref = (col, id) => ({ path: col + "/" + id });
  const db = {
    collection: (col) => ({
      doc: (id) => ref(col, id),
      add: async (data) => { if (col === "mail_queue") store.mail.push(data); return { id: "m" + store.mail.length }; },
    }),
    runTransaction: async (fn) => fn({
      get: async (r) => { const d = store.docs[r.path]; return { exists: !!d, data: () => d }; },
      update: (r, patch) => { store.docs[r.path] = { ...store.docs[r.path], ...patch }; },
      set: (r, patch) => { store.docs[r.path] = { ...(store.docs[r.path] || {}), ...patch }; },
    }),
  };
  return { db, store };
}

const COT_VIVA = {
  cotizacion_id: "COT-2026-0101", estado: "enviada", deleted: false, validezDias: 15,
  enviada_en: ts(new Date("2026-09-25T12:00:00.000Z")),
  cliente_nombre: "SKY CHEFS DE PANAMA, S.A.", creado_por_email: "vendedor@cecomunica.com",
  ejecutivo_email: "ejecutivo@cecomunica.com", ejecutivo_nombre: "Solángel Hosang",
};
const ESPEJO = { code: "abc123def456", estado: "enviada" };
const llamada = (data) => ({ data, rawRequest: { ip: "190.0.0.1", headers: { "user-agent": "UA" } } });

// ── 1. responderCotizacionPublica ────────────────────────────────────────
test("R1 · sin el código del enlace no se escribe nada (mismo mensaje si no existe)", async () => {
  const { db, store } = fakeDb({ "cotizacion_verificaciones/c1": ESPEJO, "cotizaciones/c1": COT_VIVA });
  await assert.rejects(
    handler(llamada({ docId: "c1", token: "abc123def457", respuesta: "aceptada", nombre: "Ana Pérez" }), { db, admin: fakeAdmin }),
    (e) => e.code === "permission-denied");
  await assert.rejects(
    handler(llamada({ docId: "nadie", token: "abc123def456", respuesta: "aceptada", nombre: "Ana Pérez" }), { db, admin: fakeAdmin }),
    (e) => e.code === "permission-denied");
  assert.equal(store.docs["cotizaciones/c1"].estado, "enviada");
  assert.equal(store.mail.length, 0);
  assert.equal(codigoValido("abc", "abc"), true);
  assert.equal(codigoValido("abc", "abd"), false);
  assert.equal(codigoValido("", ""), false, "sin código no hay nada que comparar");
});

test("R2 · el nombre es obligatorio y la respuesta solo puede ser aceptada|rechazada", async () => {
  const { db } = fakeDb({ "cotizacion_verificaciones/c1": ESPEJO, "cotizaciones/c1": COT_VIVA });
  await assert.rejects(
    handler(llamada({ docId: "c1", token: "abc123def456", respuesta: "aceptada", nombre: "Al" }), { db, admin: fakeAdmin }),
    (e) => e.code === "invalid-argument");
  await assert.rejects(
    handler(llamada({ docId: "c1", token: "abc123def456", respuesta: "quizas", nombre: "Ana Pérez" }), { db, admin: fakeAdmin }),
    (e) => e.code === "invalid-argument");
});

test("R3 · aceptar escribe la forma de 'Respuesta del cliente' del detalle, espeja y avisa al vendedor", async () => {
  const { db, store } = fakeDb({ "cotizacion_verificaciones/c1": ESPEJO, "cotizaciones/c1": COT_VIVA });
  const r = await handler(llamada({ docId: "c1", token: "abc123def456", respuesta: "aceptada", nombre: "  Ana   Pérez ", comentario: "Lo necesito el lunes" }), { db, admin: fakeAdmin });
  assert.equal(r.status, "registrada");
  assert.equal(r.estado, "convertida");
  assert.equal(r.nombre, "Ana Pérez");
  assert.equal(r.cot, undefined, "el documento completo no sale a un anónimo");

  const c = store.docs["cotizaciones/c1"];
  assert.equal(c.estado, "convertida");
  assert.equal(c.fecha_conversion.toDate().toISOString(), FIJO.toISOString());
  assert.equal(c.aceptacion.medio, "pagina", "el historial del detalle lee medioLabel('pagina')");
  assert.equal(c.aceptacion.por_nombre, "Ana Pérez");
  assert.equal(c.aceptacion.por_uid, null);
  assert.equal(c.respuesta_cliente.respuesta, "aceptada");
  assert.equal(c.respuesta_cliente.ip, "190.0.0.1");

  const v = store.docs["cotizacion_verificaciones/c1"];
  assert.equal(v.estado, "convertida");
  assert.equal(v.code, "abc123def456", "el espejo conserva el código");
  assert.equal(v.respuesta_cliente.ip, undefined, "el espejo es público: sin IP");

  assert.equal(store.mail.length, 1);
  assert.equal(store.mail[0].to, "vendedor@cecomunica.com");
  assert.equal(store.mail[0].cc, "ejecutivo@cecomunica.com");
  assert.match(store.mail[0].subject, /aceptó la cotización COT-2026-0101/);
  assert.match(store.mail[0].bodyContent, /Lo necesito el lunes/);
  assert.equal(store.mail[0].meta.source, "responderCotizacionPublica");
});

test("R4 · rechazar deja rechazo_origen 'cliente' (cuenta como oportunidad perdida) y el motivo", async () => {
  const { db, store } = fakeDb({ "cotizacion_verificaciones/c1": ESPEJO, "cotizaciones/c1": COT_VIVA });
  const r = await handler(llamada({ docId: "c1", token: "abc123def456", respuesta: "rechazada", nombre: "Ana Pérez", comentario: "Muy caro" }), { db, admin: fakeAdmin });
  assert.equal(r.status, "registrada");
  const c = store.docs["cotizaciones/c1"];
  assert.equal(c.estado, "rechazada");
  assert.equal(c.rechazo_origen, "cliente");
  assert.equal(c.rechazo_motivo, "Muy caro");
  assert.equal(c.aceptacion, undefined);
  assert.match(store.mail[0].subject, /no la aceptó/);
});

test("R5 · idempotente: la segunda respuesta devuelve la primera y no duplica el correo", async () => {
  const { db, store } = fakeDb({ "cotizacion_verificaciones/c1": ESPEJO, "cotizaciones/c1": COT_VIVA });
  await handler(llamada({ docId: "c1", token: "abc123def456", respuesta: "aceptada", nombre: "Ana Pérez" }), { db, admin: fakeAdmin });
  const r2 = await handler(llamada({ docId: "c1", token: "abc123def456", respuesta: "rechazada", nombre: "Otro Nombre" }), { db, admin: fakeAdmin });
  assert.equal(r2.status, "ya_respondida");
  assert.equal(r2.respuesta, "aceptada");
  assert.equal(r2.nombre, "Ana Pérez");
  assert.equal(store.docs["cotizaciones/c1"].estado, "convertida");
  assert.equal(store.mail.length, 1);
});

test("R6 · evaluar: solo enviada/aprobada vigentes se responden", () => {
  const ahora = new Date("2026-09-28T15:00:00.000Z");
  assert.equal(evaluar(COT_VIVA, ahora).accion, "escribir");
  assert.equal(evaluar({ ...COT_VIVA, estado: "aprobada" }, ahora).accion, "escribir");
  assert.equal(evaluar({ ...COT_VIVA, estado: "borrador" }, ahora).status, "no_disponible");
  assert.equal(evaluar({ ...COT_VIVA, deleted: true }, ahora).status, "no_disponible");
  assert.equal(evaluar(null, ahora).status, "no_disponible");
  assert.equal(evaluar({ ...COT_VIVA, estado: "vencida" }, ahora).status, "vencida");
  assert.equal(evaluar({ ...COT_VIVA, estado: "descartada" }, ahora).status, "cerrada");
  assert.equal(evaluar({ ...COT_VIVA, estado: "convertida" }, ahora).status, "cerrada", "aceptada por el vendedor, no desde el enlace");
  assert.equal(evaluar({ ...COT_VIVA, estado: "convertida", respuesta_cliente: { respuesta: "aceptada" } }, ahora).status, "ya_respondida");
  // Vencida por fecha aunque el cron de las 06:00 aún no la marcó.
  assert.equal(evaluar({ ...COT_VIVA, enviada_en: ts(new Date("2026-09-01T12:00:00.000Z")) }, ahora).status, "vencida");
  // Sin enviada_en cae a la fecha del documento + validez.
  assert.equal(evaluar({ ...COT_VIVA, enviada_en: null, fecha: "2026-09-20", validezDias: 15 }, ahora).accion, "escribir");
});

test("R7 · el correo dice qué sigue según sea taller o ventas", () => {
  const base = { docId: "c1", cot: COT_VIVA, respuesta: "aceptada", nombre: "Ana", comentario: "" };
  assert.match(correoVendedor(base).bodyContent, /cerrar la venta/);
  assert.match(correoVendedor({ ...base, cot: { ...COT_VIVA, origen: "orden" } }).bodyContent, /Facturación pendiente/);
  assert.match(correoVendedor({ ...base, cot: { ...COT_VIVA, origen: "orden", gestion_id: "g1" } }).bodyContent, /reposición/);
  assert.match(correoVendedor({ ...base, respuesta: "rechazada", cot: { ...COT_VIVA, origen: "orden", gestion_id: "g1" } }).bodyContent, /cobranza/);
  assert.equal(correoVendedor({ ...base, cot: { ...COT_VIVA, creado_por_email: null, ejecutivo_email: null } }), null);
  // Sin CC cuando el vendedor y el ejecutivo son la misma persona.
  assert.equal(correoVendedor({ ...base, cot: { ...COT_VIVA, ejecutivo_email: "VENDEDOR@cecomunica.com" } }).cc, null);
  const p = construirPatches({ respuesta: "aceptada", nombre: "Ana", comentario: "ok" }, ts(FIJO));
  assert.equal(p.cot.aceptacion.nota, "Ana: ok");
});

// ── 2. searchTokens: trigger y backfill, el mismo builder ─────────────────
test("T1 · el trigger y el backfill producen los mismos tokens", () => {
  const docs = [
    { cliente_nombre: "Sociedad Israelita de Beneficencia", ejecutivo_nombre: "Solángel Hosang", cotizacion_id: "COT-2026-0040", orden_id: "2026090701" },
    { cliente_nombre: "SKY CHEFS DE PANAMÁ, S.A.", cotizacion_id: "COT-2026-0101" },
    { cliente_nombre: "", cotizacion_id: "" },
    {},
  ];
  for (const d of docs) {
    assert.deepEqual(onTokens.buildCotizacionSearchTokens(d), backfill.buildCotizacionSearchTokens(d));
  }
  const t = onTokens.buildCotizacionSearchTokens(docs[0]);
  assert.ok(t.includes("israelita"), "palabra interior completa");
  assert.ok(t.includes("isr"), "prefijo");
  assert.ok(t.includes("solangel"), "sin acento");
  assert.ok(t.includes("cot-2026-0040") && t.includes("0040") && t.includes("40"), "número con y sin ceros");
  assert.ok(t.includes("2026090701"), "la orden de taller");
  assert.ok(!t.includes("s"), "nada de un solo carácter");
  assert.deepEqual(t, [...t].sort(), "ordenados: la comparación del trigger lo exige");
  assert.ok(onTokens.tokensIguales(t, [...t]));
  assert.ok(!onTokens.tokensIguales(t, t.slice(1)));
});

test("T2 · el trigger no reescribe cuando los tokens ya coinciden (sin eco)", async () => {
  const doc = { cliente_nombre: "ACME", cotizacion_id: "COT-2026-0001" };
  doc.searchTokens = onTokens.buildCotizacionSearchTokens(doc);
  let updates = 0;
  await onTokens({ data: { after: { data: () => doc, ref: { update: async () => { updates++; } } } }, params: { docId: "x" } });
  assert.equal(updates, 0);
  delete doc.searchTokens;
  await onTokens({ data: { after: { data: () => doc, ref: { update: async () => { updates++; } } } }, params: { docId: "x" } });
  assert.equal(updates, 1);
  await onTokens({ data: { after: { data: () => undefined } }, params: { docId: "x" } });
  assert.equal(updates, 1, "un borrado físico no hace nada");
});

// ── 3. adjuntos huérfanos ─────────────────────────────────────────────────
test("H1 · huerfanos(): ni lo referenciado, ni lo reciente, ni lo de otra carpeta", () => {
  const { huerfanos, rutasReferenciadas, pathDeUrl } = purge._interno;
  const ahora = Date.parse("2026-09-28T00:00:00Z");
  const viejo = "2026-09-01T00:00:00Z";
  const ref = rutasReferenciadas([
    { adjuntos: [{ path: "cotizaciones_adjuntos/adj_a.pdf" }] },
    { adjuntos: [{ url: "https://firebasestorage.googleapis.com/v0/b/x/o/cotizaciones_adjuntos%2Fadj_b.pdf?alt=media&token=t" }] },
    { adjuntos: null },
    null,
  ]);
  assert.ok(ref.has("cotizaciones_adjuntos/adj_a.pdf"));
  assert.ok(ref.has("cotizaciones_adjuntos/adj_b.pdf"), "la ruta también se saca de la URL de descarga");
  assert.equal(pathDeUrl("sin-o"), null);
  const out = huerfanos([
    { name: "cotizaciones_adjuntos/adj_a.pdf", timeCreated: viejo },       // referenciado
    { name: "cotizaciones_adjuntos/adj_b.pdf", timeCreated: viejo },       // referenciado por URL
    { name: "cotizaciones_adjuntos/adj_c.pdf", timeCreated: viejo },       // huérfano viejo → sí
    { name: "cotizaciones_adjuntos/adj_d.pdf", timeCreated: "2026-09-26T00:00:00Z" }, // reciente
    { name: "cotizaciones_adjuntos/adj_e.pdf" },                            // sin fecha: se conserva
    { name: "cotizaciones_adjuntos/" },                                     // la carpeta
    { name: "otros/adj_f.pdf", timeCreated: viejo },                        // otra carpeta
  ], ref, ahora);
  assert.deepEqual(out.map((f) => f.name), ["cotizaciones_adjuntos/adj_c.pdf"]);
});
