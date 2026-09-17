// "¿Cómo llegó este radio a la cuenta?" — la entrega es la prueba.
//
// Decisión de Alberto (2026-09-17, caso SilverKing / ALQ20260902-01): el
// contrato que el cliente FIRMÓ no se reescribe. Sus seriales son los del
// papel y ahí se quedan. Lo que prueba que hoy tiene otro radio es la ENTREGA
// que se le hizo en la orden, así que el linaje del reemplazo tiene que dejar
// esa orden escrita en la ficha del equipo entrante — si no, el serial del
// sistema y el del contrato no cuadran y nadie sabe explicar por qué.
//
// Corre con `npm test` (node --test), sin red ni credenciales: el trigger se
// lee como texto, igual que reemplazoTaller.test.js.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const leer = (...p) => fs.readFileSync(path.join(__dirname, "..", ...p), "utf8");
const trigger = leer("src", "triggers", "gestiones", "onOrdenWriteGestion.js");
const servicio = leer("..", "public", "js", "services", "equiposPoolService.js");

test("el entrante guarda de dónde salió: gestión, saliente y orden de entrega", () => {
  assert.match(trigger, /reemplazo_origen: \{/);
  assert.match(trigger, /gestion_id: gid,/);
  assert.match(trigger, /saliente: pool\.normSerial\(saliente\),/);
  assert.match(trigger, /orden_entrega_id: ordenEntregaId \|\| null,/);
});

test("la orden de entrega llega desde la OS que se marcó ENTREGADO", () => {
  assert.match(trigger, /async function estamparLinaje\(gid, g, ordenEntregaId\)/);
  // Las DOS salidas del reemplazo (con devolución y con el saliente ya en casa)
  // pasan la orden: si una se olvidara, ese camino quedaría sin prueba.
  const llamadas = trigger.match(/estamparLinaje\(gid, g, ordenId\)/g) || [];
  assert.equal(llamadas.length, 2, "ambos caminos estampan la orden de entrega");
});

test("el kardex del entrante nombra la orden con la que se entregó", () => {
  assert.match(trigger, /Reemplaza a \$\{saliente\} \(gestión \$\{gid\}\)\$\{ordenEntregaId \? ` — entregado con la orden/);
});

test("el contrato firmado no se toca: la subcolección de seriales solo se LEE", () => {
  // El reemplazo puede consultar qué firmó el cliente (para decidir si una
  // marca de cancelación se sostiene), pero nunca reescribirlo: el serial del
  // papel es el que se firmó, y el radio de hoy se explica por la entrega.
  const usos = trigger.match(/collection\("seriales"\).*/g) || [];
  assert.ok(usos.length, "el trigger consulta los seriales del contrato");
  for (const u of usos) {
    assert.match(u, /\.get\(\)/, `uso de escritura sobre los seriales del contrato: ${u}`);
  }
});

test("la UI puede explicar el cambio sin abrir el kardex", () => {
  assert.match(servicio, /origenReemplazoHtml\(eq/);
  assert.match(servicio, /sustituye a/);
  assert.match(servicio, /orden_entrega_id/);
});

// ── El expediente tiene que poder CERRAR ────────────────────────────────
// GR20260915-01 (SilverKing) quedó "en proceso" con todo cumplido: recepción
// recibió el radio viejo ANTES de que nadie marcara la entrega del nuevo, así
// que cuando la orden de devolución se ligó a la gestión ya no quedaban
// pendientes y el trigger —que solo miraba el SALTO de pendientes a cero— no
// vio nada. Un trámite cumplido que el sistema no puede dar por terminado no
// aguanta una auditoría.
test("la entrada cierra con que no queden pendientes, sin depender del flanco", () => {
  const i = trigger.indexOf('if (norm(after.tipo_de_servicio) === "DEVOLUCION")');
  assert.ok(i > 0, "existe el bloque de la devolución");
  const bloque = trigger.slice(i, i + 1600);
  assert.match(bloque, /if \(pendientes === 0\) \{/);
  assert.doesNotMatch(bloque, /antes !== 0/,
    "no puede exigir ver la transición: la orden se liga a la gestión después");
  assert.match(bloque, /if \(g\.cierre\?\.entrada === true\) return null;/,
    "el guard de idempotencia es el que evita repetir");
});
