// La devolución cierra la ficha de POC (functions/src/lib/pocCierre.js).
//
// POC es la plataforma de airtime: mientras el radio está con el cliente tiene
// ficha viva, y cuando vuelve esa ficha tiene que cerrarse. Nunca se cerraba —
// al 2026-09-09 había 1,263 fichas abiertas de radios que ya no están con el
// cliente y 817 seriales vivos en más de una cuenta. Quien pagaba era
// recepción: el batch veía el serial "ya registrado con este cliente" y se
// paraba en seco.
//
// Lo que se congela aquí:
//   · se cierra la ficha del cliente que devuelve, y SOLO esa (un serial
//     repetido entre modelos no puede arrastrar la ficha de un radio ajeno);
//   · el SIM vuelve al pool como disponible… salvo que el pool ya lo tenga en
//     OTRO radio, y entonces solo se limpia la ficha (invariante "SIM asignado
//     ⇒ ficha viva", hoy 338/338);
//   · queda rastro en poc_logs;
//   · fichas legacy sin cliente_id se reconocen por nombre.
//
// Corre con `npm test` (node --test), sin red ni credenciales: el módulo recibe
// un Firestore de mentira por parámetro.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-poc-cierre" });

const { cerrarFichasPoc, fichasDelCliente } = require("../src/lib/pocCierre");

// Firestore de mentira: lo justo que toca el módulo.
function fakeDb(estado) {
  estado.poc_logs = estado.poc_logs || [];
  const ref = (col, id) => ({
    _col: col, _id: id,
    get: async () => ({ exists: !!estado[col]?.[id], id, data: () => estado[col]?.[id] }),
    update: async (patch) => { estado[col][id] = { ...estado[col][id], ...patch }; },
  });
  const aplicar = (r, patch, opts) => {
    estado[r._col] = estado[r._col] || {};
    estado[r._col][r._id] = opts?.merge ? { ...estado[r._col][r._id], ...patch } : patch;
  };
  return {
    collection: (col) => ({
      doc: (id) => ref(col, id),
      where: (campo, _op, valor) => ({
        get: async () => {
          const docs = Object.entries(estado[col] || {})
            .filter(([, d]) => d[campo] === valor)
            .map(([id, d]) => ({ id, data: () => d }));
          return { docs, forEach: (fn) => docs.forEach(fn) };
        },
      }),
      add: async (doc) => { (estado[col] = estado[col] || []).push(doc); return { id: "nuevo" }; },
    }),
    runTransaction: async (fn) => fn({
      get: async (r) => r.get(),
      update: (r, patch) => aplicar(r, patch, { merge: true }),
      set: (r, patch, opts) => aplicar(r, patch, opts),
    }),
  };
}

const ARRAIJAN = { clienteId: "CLI1", clienteNombre: "MUNICIPIO DE ARRAIJAN" };

function escenario({ sim = null, simEnOtroRadio = false } = {}) {
  const estado = {
    poc_devices: {
      devArraijan: {
        serial: "21814A0123", unit_id: "273826", cliente_id: "CLI1",
        cliente_nombre: "MUNICIPIO DE ARRAIJAN", activo: false, deleted: false,
        ...(sim ? { sim_number: sim, sim_phone: "6000-0000", operador: "+móvil" } : {}),
      },
      devBalboa: {
        serial: "21814A0123", unit_id: "274089", cliente_id: "CLI9",
        cliente_nombre: "BALBOA LOGISTICS", activo: false, deleted: false,
      },
    },
    equipos_pool: { "21814A0123": { serial: "21814A0123", poc_device_id: "devBalboa" } },
    sim_cards: sim ? {
      [sim]: {
        sim_number: sim, estado: "asignado",
        asignado_a: { device_id: simEnOtroRadio ? "devOtro" : "devArraijan" },
      },
    } : {},
    poc_logs: [],
  };
  return { estado, db: fakeDb(estado) };
}

const cerrar = (db, extra = {}) => cerrarFichasPoc({
  serial: "21814A0123", poolDocId: "21814A0123", ...ARRAIJAN,
  motivo: "Devolución recibida",
  ref: { tipo: "orden", id: "2026090907", label: "DEVOLUCIÓN 2026090907" },
  ...extra,
}, db);

test("la ficha del cliente que devuelve queda cerrada", async () => {
  const { estado, db } = escenario();

  const r = await cerrar(db);

  assert.equal(estado.poc_devices.devArraijan.deleted, true);
  assert.equal(estado.poc_devices.devArraijan.activo, false);
  assert.deepEqual(r.cerradas.map(c => c.id), ["devArraijan"]);
});

test("la ficha de OTRO cliente no se toca, ni siquiera si el pool apunta a ella", async () => {
  const { estado, db } = escenario();

  const r = await cerrar(db);

  assert.equal(estado.poc_devices.devBalboa.deleted, false,
    "un serial repetido no puede arrastrar el registro de un radio ajeno");
  assert.equal(r.deOtros, 1, "pero sí se reporta, que es lo que limpia el batch");
});

test("el SIM vuelve al pool como disponible y sale de la ficha", async () => {
  const SIM = "8950702902411531805";
  const { estado, db } = escenario({ sim: SIM });

  await cerrar(db);

  assert.equal(estado.sim_cards[SIM].estado, "disponible");
  assert.equal(estado.sim_cards[SIM].asignado_a, null);
  assert.equal(estado.poc_devices.devArraijan.sim_number, "");
  assert.equal(estado.sim_cards[SIM].liberado_de.device_id, "devArraijan",
    "con rastro de dónde salió");
});

test("un SIM que el pool ya tiene en otro radio no se toca", async () => {
  const SIM = "8950702902411531805";
  const { estado, db } = escenario({ sim: SIM, simEnOtroRadio: true });

  const r = await cerrar(db);

  assert.equal(estado.sim_cards[SIM].estado, "asignado", "la otra asignación manda");
  assert.deepEqual(estado.sim_cards[SIM].asignado_a, { device_id: "devOtro" });
  assert.equal(estado.poc_devices.devArraijan.sim_number, "", "la ficha vieja sí lo suelta");
  assert.deepEqual(r.simsAjenos, [SIM], "y el llamador se entera");
});

test("el cierre queda en poc_logs con su motivo y su orden", async () => {
  const { estado, db } = escenario();

  await cerrar(db);

  const log = estado.poc_logs[0];
  assert.equal(log.equipo_id, "devArraijan");
  assert.equal(log.accion, "eliminar");
  assert.equal(log.origen, "devolucion");
  assert.equal(log.motivo, "Devolución recibida");
  assert.equal(log.ref.id, "2026090907");
});

test("una ficha legacy sin cliente_id se reconoce por nombre", () => {
  const legacy = [{ id: "x", serial: "A1", cliente_nombre: "municipio de arraijan", deleted: false }];
  assert.equal(fichasDelCliente(legacy, ARRAIJAN).length, 1);
});

test("una ficha sin cliente no se cierra: no hay con qué afirmar que es suya", () => {
  const huerfana = [{ id: "x", serial: "A1", deleted: false }];
  assert.equal(fichasDelCliente(huerfana, ARRAIJAN).length, 0);
});

test("no se vuelve a cerrar lo ya cerrado", async () => {
  const { estado, db } = escenario();
  estado.poc_devices.devArraijan.deleted = true;

  const r = await cerrar(db);

  assert.equal(r.cerradas.length, 0);
  assert.equal(estado.poc_logs.length, 0, "sin log de un cierre que no ocurrió");
});
