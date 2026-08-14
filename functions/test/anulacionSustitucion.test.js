// Anulación: SUSTITUCIÓN (se rehace el papel) vs TERMINACIÓN (el cliente
// devuelve). Hasta el 2026-08-14 el sistema solo conocía la segunda, y por eso
// ALQ20260715-01 (SOCIEDAD ISRAELITA) abrió una orden pidiendo confirmar la
// devolución de 32 radios que nadie iba a devolver: el contrato se había
// rehecho como ALQ20260806-03 por el ajuste de precio del micrófono.
//
// La evidencia que justifica la distinción, medida sobre los 84 anulados:
//   · 35 tienen contrato sustituto (mismo cliente, mismo total, minutos aparte)
//   · de las 3 anulaciones con equipo YA ENTREGADO, las 3 eran sustituciones
//   · `anulacion/recibido` (una anulación que devolvió un radio): 0 casos
//
// Estas pruebas fijan el criterio ficha por ficha. Corren con `npm test`
// (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

// equiposPool toca el SDK al cargarse; basta con que exista una app por defecto
// (mismo arranque que bajaPropioRecuperacion.test.js). No se abre ninguna
// conexión: solo se leen sus constantes.
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-anulacion-sustitucion" });

const {
  clasificarUnidadesAnulacion, TIPO_ANULACION, ESTADOS_COLGANDO,
} = require("../src/lib/devolucion");
const pool = require("../src/domain/equiposPool");

const CONTRATO = "contrato-anulado-1";

function ficha(serial, over = {}) {
  return {
    serial, modelo: "PNC360S-R", modelo_id: "modelo-pnc360s", pool_doc_id: serial,
    propiedad: "cecomunica", estado: "en_cliente", contrato_doc_id: CONTRATO,
    ...over,
  };
}
const seriales = (r) => r.map(u => u.serial).sort();

// ── El corazón: el mismo equipo, distinto destino según el tipo ────────────
test("TERMINACIÓN: el equipo entregado se reclama con una devolución", () => {
  const fichas = [ficha("A1"), ficha("A2")];
  const r = clasificarUnidadesAnulacion({
    fichas, contratoDocId: CONTRATO,
    tipo: TIPO_ANULACION.TERMINACION, entregaConfirmada: true,
  });
  assert.deepEqual(seriales(r.devolucion), ["A1", "A2"]);
  assert.equal(r.continuan.length, 0);
});

test("SUSTITUCIÓN: el mismo equipo continúa con el cliente, sin devolución", () => {
  const fichas = [ficha("A1"), ficha("A2")];
  const r = clasificarUnidadesAnulacion({
    fichas, contratoDocId: CONTRATO,
    tipo: TIPO_ANULACION.SUSTITUCION, entregaConfirmada: true,
  });
  assert.deepEqual(seriales(r.continuan), ["A1", "A2"]);
  assert.equal(r.devolucion.length, 0);
});

// ── El default no puede cambiar el pasado ─────────────────────────────────
test("sin tipo (contrato viejo o script) se comporta como TERMINACIÓN", () => {
  const fichas = [ficha("A1")];
  for (const tipo of [undefined, "", null, "cualquier_cosa"]) {
    const r = clasificarUnidadesAnulacion({
      fichas, contratoDocId: CONTRATO, tipo, entregaConfirmada: true,
    });
    assert.equal(r.devolucion.length, 1, `tipo=${String(tipo)} debe reclamar`);
    assert.equal(r.continuan.length, 0);
  }
});

// ── Lo que NO cambia con la sustitución ───────────────────────────────────
test("el equipo del CLIENTE va a custodia, se anule como se anule", () => {
  const fichas = [ficha("A1", { propiedad: "cliente" })];
  for (const tipo of [TIPO_ANULACION.SUSTITUCION, TIPO_ANULACION.TERMINACION]) {
    const r = clasificarUnidadesAnulacion({
      fichas, contratoDocId: CONTRATO, tipo, entregaConfirmada: true,
    });
    assert.deepEqual(seriales(r.custodia), ["A1"], `tipo=${tipo}`);
    assert.equal(r.devolucion.length + r.continuan.length, 0);
  }
});

test("la unidad RESERVADA que nunca salió vuelve a bodega en ambos casos", () => {
  const fichas = [ficha("A1", { estado: "asignado_contrato" })];
  for (const tipo of [TIPO_ANULACION.SUSTITUCION, TIPO_ANULACION.TERMINACION]) {
    const r = clasificarUnidadesAnulacion({
      fichas, contratoDocId: CONTRATO, tipo, entregaConfirmada: false,
    });
    assert.deepEqual(seriales(r.bodega), ["A1"], `tipo=${tipo}`);
  }
});

test("reservada pero con entrega confirmada NO va a bodega: sí salió", () => {
  const fichas = [ficha("A1", { estado: "asignado_contrato" })];
  const r = clasificarUnidadesAnulacion({
    fichas, contratoDocId: CONTRATO,
    tipo: TIPO_ANULACION.TERMINACION, entregaConfirmada: true,
  });
  assert.equal(r.bodega.length, 0);
  assert.deepEqual(seriales(r.devolucion), ["A1"]);
});

// ── Descartes: ninguno puede ser mudo ─────────────────────────────────────
test("la ficha reasignada a otro contrato se omite con su motivo", () => {
  const fichas = [ficha("A1", { contrato_doc_id: "otro", contrato_id: "ALQ-OTRO" })];
  const r = clasificarUnidadesAnulacion({
    fichas, contratoDocId: CONTRATO, tipo: TIPO_ANULACION.SUSTITUCION,
  });
  assert.equal(r.omitidas.length, 1);
  assert.match(r.omitidas[0].motivo, /ALQ-OTRO/);
  assert.equal(r.continuan.length, 0);
});

test("un estado fuera del contrato (en_taller, vendido, baja) se omite", () => {
  for (const estado of ["en_taller", "vendido", "baja", "en_bodega", "devuelto_revision"]) {
    const r = clasificarUnidadesAnulacion({
      fichas: [ficha("A1", { estado })], contratoDocId: CONTRATO,
      tipo: TIPO_ANULACION.SUSTITUCION, entregaConfirmada: true,
    });
    assert.equal(r.omitidas.length, 1, `estado=${estado}`);
    assert.match(r.omitidas[0].motivo, new RegExp(estado));
    assert.equal(r.continuan.length + r.devolucion.length + r.bodega.length, 0);
  }
});

test("una ficha sin serial no produce ni cubo ni omisión", () => {
  const r = clasificarUnidadesAnulacion({
    fichas: [ficha("  "), ficha("")], contratoDocId: CONTRATO,
    tipo: TIPO_ANULACION.TERMINACION,
  });
  const total = r.custodia.length + r.bodega.length + r.continuan.length
    + r.devolucion.length + r.omitidas.length;
  assert.equal(total, 0);
});

// ── El caso real, completo ────────────────────────────────────────────────
test("caso ALQ20260715-01: 32 entregados en una sustitución → 0 devoluciones", () => {
  const fichas = Array.from({ length: 32 }, (_, i) => ficha(`S${String(i).padStart(2, "0")}`));
  const r = clasificarUnidadesAnulacion({
    fichas, contratoDocId: CONTRATO,
    tipo: TIPO_ANULACION.SUSTITUCION, entregaConfirmada: true,
  });
  assert.equal(r.continuan.length, 32);
  assert.equal(r.devolucion.length, 0, "no debe abrirse ninguna orden de devolución");
  assert.equal(r.bodega.length, 0, "ningún radio debe mandarse a bodega: están con el cliente");
});

test("caso PROP20260625-01: equipo del cliente en una sustitución → custodia, nunca bodega", () => {
  const fichas = Array.from({ length: 4 }, (_, i) => ficha(`P${i}`, { propiedad: "cliente" }));
  const r = clasificarUnidadesAnulacion({
    fichas, contratoDocId: CONTRATO,
    tipo: TIPO_ANULACION.SUSTITUCION, entregaConfirmada: true,
  });
  assert.equal(r.custodia.length, 4);
  assert.equal(r.bodega.length, 0, "el equipo del cliente jamás entra a nuestra bodega");
});

// ── Contrato con el pool: la copia de estados no puede divergir ───────────
test("ESTADOS_COLGANDO sigue alineado con equiposPool", () => {
  assert.deepEqual([...ESTADOS_COLGANDO].sort(),
    [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE].sort());
});
