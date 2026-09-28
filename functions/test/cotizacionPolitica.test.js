// onCotizacionPolitica (auditoría UX 2026-09-28): la política de envío ya no
// depende del flag que estampa el navegador.
//
// LO QUE PROTEGE
//   1. Un doc fuera de política con requiere_aprobacion:false queda en true;
//      dentro de política no se toca (y un true "por rol" nunca se afloja).
//   2. borrador→enviada fuera de política y sin aprobación se REGRESA a
//      borrador con bloqueada_por_politica y un correo al aprobador; con
//      aprobación registrada, dentro de política, o escrito por un aprobador
//      del tipo / el servidor, se respeta.
//   3. Sin eco: la segunda pasada sobre lo que el trigger mismo escribió no
//      escribe nada; un cliente que insiste no repite el correo dentro de
//      la hora.
//
// Corre con: node --test (desde functions/).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("module");

const FIJO = new Date("2026-09-28T15:00:00.000Z");
const ts = (d) => ({ toDate: () => d, toMillis: () => d.getTime() });

// ── Base falsa ────────────────────────────────────────────────────────────
const store = { docs: {}, mail: [], updates: 0 };
const fakeDb = {
  collection: (col) => ({
    doc: (id) => ({
      get: async () => {
        const d = store.docs[col + "/" + id];
        return { exists: !!d, data: () => d };
      },
    }),
    add: async (data) => { if (col === "mail_queue") store.mail.push(data); return { id: "m" + store.mail.length }; },
  }),
};
const fakeAdmin = {
  firestore: {
    Timestamp: { now: () => ts(FIJO) },
    FieldValue: { serverTimestamp: () => "SERVER_TS", delete: () => "DELETE" },
  },
};
const origLoad = Module._load;
Module._load = function (req, parent) {
  if (req === "firebase-functions/v2/firestore") return { onDocumentWrittenWithAuthContext: (_o, f) => f };
  if (req === "firebase-functions/logger") return { info() {}, warn() {}, error() {}, debug() {} };
  if (/(^|\/)admin$/.test(req) && parent && /functions[\\/]src/.test(parent.filename)) {
    return { admin: fakeAdmin, db: fakeDb };
  }
  return origLoad.apply(this, arguments);
};
const onPolitica = require("../src/triggers/cotizaciones/onPolitica");
Module._load = origLoad;
const { decidir, rolAprueba, MAIL_MIN_MS } = onPolitica._interno;

// Config viva: 15% / $5,000. tallerEmailTo lee email_taller de aquí.
store.docs["empresa/config"] = { cotizacion_descuento_max_pct: 15, cotizacion_total_max: 5000, email_taller: "jefa@cecomunica.com" };
store.docs["usuarios/uAdmin"] = { rol: "administrador" };
store.docs["usuarios/uJefa"] = { rol: "jefe_taller" };
store.docs["usuarios/uGerente"] = { rol: "gerente" };
store.docs["usuarios/uVend"] = { rol: "vendedor" };

const FUERA = { cotizacion_id: "COT-2026-0200", cliente_nombre: "ACME", creado_por_email: "v@cecomunica.com",
  items: [{ cant: 1, precio: 100, desc: 40 }], itbmsPct: 7, total: 64.2 };
const DENTRO = { cotizacion_id: "COT-2026-0201", cliente_nombre: "ACME",
  items: [{ cant: 1, precio: 100 }], itbmsPct: 7, total: 107 };

function evento({ before, after, authType = "unknown", authId = "uVend", docId = "d1" }) {
  const patches = [];
  const ev = {
    authType, authId, params: { docId },
    data: {
      before: { data: () => before },
      after: {
        data: () => after,
        ref: { update: async (p) => { patches.push(p); store.updates++; } },
      },
    },
  };
  return { ev, patches };
}

function reset() { store.mail = []; store.updates = 0; }

// ── 1. El flag ────────────────────────────────────────────────────────────
test("P1 · fuera de política con flag false → true + politica_verificada_at; dentro no se toca; true por rol no se afloja", async () => {
  reset();
  let { ev, patches } = evento({ before: null, after: { ...FUERA, estado: "borrador", requiere_aprobacion: false } });
  await onPolitica(ev);
  assert.equal(patches.length, 1);
  assert.equal(patches[0].requiere_aprobacion, true);
  assert.equal(patches[0].politica_verificada_at, "SERVER_TS");
  assert.equal(patches[0].estado, undefined, "en borrador no hay nada que regresar");

  ({ ev, patches } = evento({ before: null, after: { ...DENTRO, estado: "borrador", requiere_aprobacion: false } }));
  await onPolitica(ev);
  assert.equal(patches.length, 0);

  ({ ev, patches } = evento({ before: null, after: { ...DENTRO, estado: "borrador", requiere_aprobacion: true } }));
  await onPolitica(ev);
  assert.equal(patches.length, 0, "true por rol: el servidor no lo afloja");
  assert.equal(store.mail.length, 0);
});

// ── 2. El regreso a borrador ──────────────────────────────────────────────
test("P2 · borrador→enviada fuera de política, sin aprobación y por un vendedor → borrador + bloqueo + correo", async () => {
  reset();
  const before = { ...FUERA, estado: "borrador", requiere_aprobacion: true };
  const after = { ...FUERA, estado: "enviada", requiere_aprobacion: false, enviada_en: ts(FIJO) };
  const { ev, patches } = evento({ before, after });
  await onPolitica(ev);
  assert.equal(patches.length, 1);
  const p = patches[0];
  assert.equal(p.estado, "borrador");
  assert.equal(p.requiere_aprobacion, true);
  assert.equal(p.enviada_en, "DELETE");
  assert.equal(p.bloqueada_por_politica.estado_previo, "enviada");
  assert.equal(p.bloqueada_por_politica.veces, 1);
  assert.match(p.bloqueada_por_politica.motivo, /40%/);
  assert.equal(p.bloqueada_por_politica.enviada_en_previa, after.enviada_en);

  assert.equal(store.mail.length, 1);
  const m = store.mail[0];
  assert.equal(m.to, "ventas@cecomunica.com", "comercial sin lista configurada → ventas@");
  assert.equal(m.cc, "v@cecomunica.com");
  assert.match(m.subject, /Solicitud de aprobación: COT-2026-0200/);
  assert.match(m.bodyContent, /40%/);
  assert.match(m.ctaUrl, /aprobar=d1$/);
  assert.equal(m.meta.source, "onCotizacionPolitica");
  assert.equal(m.status, "queued");
});

test("P2b · servicio → el correo va al jefe de taller; 'aprobada' sin aprobador también se regresa", async () => {
  reset();
  const before = { ...FUERA, origen: "orden", estado: "borrador" };
  const after = { ...FUERA, origen: "orden", estado: "aprobada" };
  const { ev, patches } = evento({ before, after });
  await onPolitica(ev);
  assert.equal(patches[0].estado, "borrador");
  assert.equal(patches[0].bloqueada_por_politica.estado_previo, "aprobada");
  assert.equal(patches[0].enviada_en, undefined);
  assert.equal(store.mail[0].to, "jefa@cecomunica.com");
});

test("P3 · se respeta: con aprobación registrada, dentro de política, o escrito por aprobador del tipo / servidor", async () => {
  reset();
  const casos = [
    // aprobó jefa/gerente antes → reenvío legítimo
    evento({ before: { ...FUERA, estado: "aprobada" }, after: { ...FUERA, estado: "enviada", fecha_aprobacion: ts(FIJO), aprobado_por_uid: "uJefa", requiere_aprobacion: true } }),
    // dentro de política, envío directo del vendedor
    evento({ before: { ...DENTRO, estado: "borrador" }, after: { ...DENTRO, estado: "enviada", requiere_aprobacion: false } }),
    // admin envía sin estampar aprobación (rules lo permiten)
    evento({ before: { ...FUERA, estado: "borrador" }, after: { ...FUERA, estado: "enviada", requiere_aprobacion: true }, authId: "uAdmin" }),
    // gerente en comercial
    evento({ before: { ...FUERA, estado: "borrador" }, after: { ...FUERA, estado: "enviada", requiere_aprobacion: true }, authId: "uGerente" }),
    // jefe_taller en servicio
    evento({ before: { ...FUERA, origen: "orden", estado: "borrador" }, after: { ...FUERA, origen: "orden", estado: "enviada", requiere_aprobacion: true }, authId: "uJefa" }),
    // escritura del servidor (Admin SDK)
    evento({ before: { ...FUERA, estado: "borrador" }, after: { ...FUERA, estado: "enviada", requiere_aprobacion: true }, authType: "service_account", authId: "" }),
    // ya estaba enviada: un guardado cualquiera no es transición
    evento({ before: { ...FUERA, estado: "enviada" }, after: { ...FUERA, estado: "enviada", requiere_aprobacion: true, intro: "x" } }),
  ];
  for (const { ev, patches } of casos) {
    await onPolitica(ev);
    assert.ok(!patches.some((p) => p.estado === "borrador"), "no debía regresar a borrador: " + JSON.stringify(ev.data.after.data()));
  }
  assert.equal(store.mail.length, 0);
  // Los roles que NO aprueban ese tipo sí se bloquean
  assert.equal(rolAprueba("jefe_taller", { origen: "comercial" }), false);
  assert.equal(rolAprueba("gerente", { origen: "orden" }), false);
  assert.equal(rolAprueba("vendedor", {}), false);
  const { ev, patches } = evento({ before: { ...FUERA, estado: "borrador" }, after: { ...FUERA, estado: "enviada", requiere_aprobacion: true }, authId: "uJefa" });
  await onPolitica(ev);
  assert.equal(patches[0].estado, "borrador", "jefe_taller no aprueba comerciales");
});

// ── 3. Eco ────────────────────────────────────────────────────────────────
test("P4 · sin eco: lo que el trigger escribió no vuelve a escribir; el correo no se repite dentro de la hora", async () => {
  reset();
  // Tras (a): el flag ya coincide.
  let r = evento({ before: { ...FUERA, estado: "borrador", requiere_aprobacion: false },
    after: { ...FUERA, estado: "borrador", requiere_aprobacion: true, politica_verificada_at: ts(FIJO) } });
  await onPolitica(r.ev);
  assert.equal(r.patches.length, 0);

  // Tras (b): enviada→borrador con el bloqueo estampado no es transición a enviada.
  const bloqueada = { ...FUERA, estado: "borrador", requiere_aprobacion: true,
    bloqueada_por_politica: { motivo: "x", motivos: ["x"], estado_previo: "enviada", veces: 1, at: ts(FIJO) } };
  r = evento({ before: { ...FUERA, estado: "enviada", requiere_aprobacion: false }, after: bloqueada });
  await onPolitica(r.ev);
  assert.equal(r.patches.length, 0);
  assert.equal(store.mail.length, 0);

  // El cliente insiste 5 minutos después: se regresa otra vez, pero sin correo.
  const policy = { descuentoMaxPct: 15, totalMax: 5000 };
  const d1 = decidir(bloqueada, { ...bloqueada, estado: "enviada", requiere_aprobacion: false }, policy,
    { ahoraMs: FIJO.getTime() + 5 * 60 * 1000 });
  assert.equal(d1.bloquea, true);
  assert.equal(d1.mandaCorreo, false);
  assert.equal(d1.patch.bloqueada_por_politica.veces, 2);
  // Pasada la ventana, vuelve a avisar.
  const d2 = decidir(bloqueada, { ...bloqueada, estado: "enviada", requiere_aprobacion: false }, policy,
    { ahoraMs: FIJO.getTime() + MAIL_MIN_MS + 1 });
  assert.equal(d2.mandaCorreo, true);

  // Borrado físico y doc borrado lógico: nada.
  await onPolitica({ data: { after: { data: () => undefined } }, params: { docId: "x" } });
  assert.equal(decidir(null, { ...FUERA, estado: "enviada", deleted: true }, policy), null);
});
