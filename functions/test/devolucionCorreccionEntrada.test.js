// Corrección pre-firma espejada en la ENTRADA (pedido de recepción 2026-09-02:
// el checklist del lote pegó el mismo daño a los 25 seriales de la Federación
// Panameña de Ciclismo, y la corrección uno a uno en la DEVOLUCIÓN no llegaba
// a la orden de ENTRADA del taller).
//
// Congela dos cosas de functions/src/lib/ordenEntrada.js:
//
//  1. obsEquipoDevolucion: las DOS formas auto-generadas de la observación de
//     un equipo que entró por devolución (creación de la ENTRADA y tanda
//     posterior). Si alguien cambia el texto generado sin cambiar el
//     reconocedor, la corrección deja de aplicarse en silencio — este test
//     truena primero.
//
//  2. corregirEquiposEntrada: reescribe daño y checkmarks de accesorios SOLO
//     cuando la observación actual es exactamente la auto-generada con el
//     daño anterior. Una nota editada a mano NUNCA se pisa (el registro del
//     taller manda), y los seriales que no están en la orden se saltan.
//
// Los otros dos candados (unidad sin acuse firmado; ENTRADA sin tomar por el
// taller) viven en onOrdenDevolucionWrite y las reglas de la UI.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

// Requerir el lib arrastra lib/admin, que exige una app inicializada.
// projectId dummy: nada toca la red mientras no se use Firestore.
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-correccion-entrada" });

const { obsDeTanda, obsEquipoDevolucion, corregirEquiposEntrada } =
  require("../src/lib/ordenEntrada");

const DEV_ID = "2026090204";
const MOTIVO = `Devolución ${DEV_ID} (contrato_papel)`;
const DANO_LOTE = "FALTA 1 CABLE/FUENTE Y 2 CARGADORES.";

const ACC_TODOS = { bateria: true, antena: true, clip: true, cargador: true, fuente: true, cubrepolvo: true };

const equipo = (serial, observaciones, extra = {}) => ({
  id: `eq-${serial}`,
  serial, numero_de_serie: serial,
  modelo: "HYTERA PNC370-R", modelo_id: "pnc370-r",
  ...ACC_TODOS,
  observaciones,
  eliminado: false,
  ...extra,
});

test("obsEquipoDevolucion congela las dos formas auto-generadas", () => {
  assert.deepEqual(obsEquipoDevolucion(DEV_ID, MOTIVO, DANO_LOTE), [
    `Inspección de entrada — ${MOTIVO}. Daño visible al recibir: ${DANO_LOTE}.`,
    `Tanda de devolución ${DEV_ID} — pendiente de inspección. Daño visible al recibir: ${DANO_LOTE}.`,
  ]);
  // Sin daño: solo la base, sin cláusula colgando.
  assert.deepEqual(obsEquipoDevolucion(DEV_ID, MOTIVO, ""), [
    `Inspección de entrada — ${MOTIVO}.`,
    `Tanda de devolución ${DEV_ID} — pendiente de inspección.`,
  ]);
  // obsDeTanda es la misma pieza que usa crearOAlimentarEntrada al agregar.
  assert.equal(obsDeTanda(DEV_ID, DANO_LOTE), obsEquipoDevolucion(DEV_ID, MOTIVO, DANO_LOTE)[1]);
});

test("reescribe el daño y los checkmarks cuando la observación es la auto-generada", () => {
  const [obsCreacion, obsTanda] = obsEquipoDevolucion(DEV_ID, MOTIVO, DANO_LOTE);
  const equipos = [
    equipo("21708A0540", obsCreacion),
    equipo("20311A1554", obsTanda), // entró por tanda posterior: otra forma, mismo trato
  ];
  const correcciones = [
    { serial: "21708A0540", accesorios: { ...ACC_TODOS, cargador: false },
      dano_visible: "Falta el cargador.", dano_antes: DANO_LOTE },
    { serial: "20311a1554", // el pareo por serial no distingue mayúsculas
      accesorios: ACC_TODOS, dano_visible: "", dano_antes: DANO_LOTE },
  ];
  const r = corregirEquiposEntrada(equipos, correcciones, DEV_ID, MOTIVO);
  assert.equal(r.cambios, 2);
  assert.equal(r.equipos[0].observaciones,
    `Inspección de entrada — ${MOTIVO}. Daño visible al recibir: Falta el cargador..`);
  assert.equal(r.equipos[0].cargador, false);
  assert.equal(r.equipos[0].bateria, true);
  // Quitar el daño deja la base limpia, conservando la forma (tanda).
  assert.equal(r.equipos[1].observaciones,
    `Tanda de devolución ${DEV_ID} — pendiente de inspección.`);
  // El array original no se muta (la transacción escribe la copia).
  assert.equal(equipos[0].observaciones, obsCreacion);
});

test("una observación editada a mano NUNCA se pisa", () => {
  const manual = "Revisado por el técnico: antena rota, va a taller.";
  const conNota = `${obsEquipoDevolucion(DEV_ID, MOTIVO, DANO_LOTE)[0]} ${manual}`;
  const equipos = [equipo("21708A0540", manual), equipo("20311A1554", conNota)];
  const r = corregirEquiposEntrada(equipos, [
    { serial: "21708A0540", accesorios: null, dano_visible: "X", dano_antes: DANO_LOTE },
    { serial: "20311A1554", accesorios: null, dano_visible: "X", dano_antes: DANO_LOTE },
  ], DEV_ID, MOTIVO);
  assert.equal(r.cambios, 0);
  assert.equal(r.equipos[0].observaciones, manual);
  assert.equal(r.equipos[1].observaciones, conNota); // nota DESPUÉS del daño: tampoco
});

test("el daño anterior tiene que cuadrar — si la ENTRADA quedó con otro texto, no se toca", () => {
  // Caso real: una corrección vieja no llegó a espejarse (el taller tenía la
  // orden tomada) y la observación quedó con el daño original. Una corrección
  // nueva con otro `dano_antes` no debe adivinar: se salta.
  const equipos = [equipo("21708A0540", obsEquipoDevolucion(DEV_ID, MOTIVO, "Daño original")[0])];
  const r = corregirEquiposEntrada(equipos, [
    { serial: "21708A0540", accesorios: null, dano_visible: "Nuevo", dano_antes: "Otro daño" },
  ], DEV_ID, MOTIVO);
  assert.equal(r.cambios, 0);
});

test("seriales fuera de la orden y equipos eliminados se saltan; sin checklist no se tocan los checkmarks", () => {
  const [obsCreacion] = obsEquipoDevolucion(DEV_ID, MOTIVO, DANO_LOTE);
  const equipos = [
    equipo("21708A0540", obsCreacion, { eliminado: true }),
    equipo("20311A1554", obsCreacion),
  ];
  const r = corregirEquiposEntrada(equipos, [
    { serial: "21708A0540", accesorios: ACC_TODOS, dano_visible: "X", dano_antes: DANO_LOTE },
    { serial: "NO-EXISTE", accesorios: ACC_TODOS, dano_visible: "X", dano_antes: DANO_LOTE },
    { serial: "20311A1554", accesorios: null, dano_visible: "Solo el daño cambió.", dano_antes: DANO_LOTE },
  ], DEV_ID, MOTIVO);
  assert.equal(r.cambios, 1);
  assert.equal(r.equipos[0].observaciones, obsCreacion); // eliminado: intacto
  assert.equal(r.equipos[1].observaciones,
    `Inspección de entrada — ${MOTIVO}. Daño visible al recibir: Solo el daño cambió..`);
  assert.equal(r.equipos[1].cargador, true); // sin checklist: checkmarks como estaban
});
