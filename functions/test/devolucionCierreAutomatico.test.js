// Cierre automático de la orden de DEVOLUCIÓN (2026-09-09).
//
// "Cerrar devolución" era un paso del mostrador que no decidía nada: con todo
// resuelto y firmado, el botón solo estampaba el estado — y cuando nadie lo
// pulsaba la orden seguía viva en el recordatorio diario. Ahora la orden se
// cierra sola en la MISMA escritura que resuelve la última unidad o guarda el
// último acuse. Lo que este test congela:
//
//   1. CUÁNDO cierra sola (_cierraSola). El predicado decide un terminal
//      irreversible por reglas, así que sus bordes se prueban uno por uno:
//      nada pendiente, nada sin firmar, ningún faltante que cobrar, y el
//      contrato de PAPEL nunca cierra solo salvo que el total declarado
//      cuadre con lo recibido.
//   2. QUE VIAJE EN LA MISMA ESCRITURA (_guardarDevolucion): el estado, la
//      fecha y el log CERRAR_DEVOLUCION van en el mismo merge que la
//      resolución. Dos escrituras dejarían la ventana donde la orden queda
//      abierta si la segunda falla.
//   3. QUE EL BOTÓN YA NO SEA EL CAMINO NORMAL: el pie solo lo pinta para el
//      contrato de papel (o como salvavidas de órdenes ya resueltas), y la
//      bandeja nombra el acuse en vez de un cierre que nadie pulsa.
//
// El archivo del navegador es un IIFE sin exports: se extraen las funciones
// reales por nombre y se evalúan en un sandbox (mismo truco que
// devolucionPendientes.test.js). Corre con `npm test`, sin red ni navegador.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const SRC = fs.readFileSync(
  path.join(RAIZ, "public", "js", "pages", "ordenes-devolucion.js"), "utf8");
const SRC_RENDER = fs.readFileSync(
  path.join(RAIZ, "public", "js", "pages", "ordenes-render.js"), "utf8");

// Recorta `function nombre(...) { ... }` contando llaves. Basta para este
// archivo: no hay llaves dentro de strings en las funciones que se extraen.
function extraerFuncion(src, nombre) {
  const i = src.indexOf(`function ${nombre}(`);
  assert.notEqual(i, -1, `no se encontró function ${nombre}(`);
  let j = src.indexOf("{", i), nivel = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === "{") nivel++;
    else if (src[k] === "}" && --nivel === 0) return src.slice(i, k + 1);
  }
  throw new Error(`function ${nombre} sin cerrar`);
}

// Sandbox con las funciones REALES del navegador y el mínimo alrededor.
function montar() {
  const ctx = {
    console,
    _orden: null,
    _puedeOperar: true,
    ESTADO_CERRADA: "CERRADA (DEVOLUCION)",
    puedeOperar() { return ctx._puedeOperar; },
  };
  vm.createContext(ctx);
  vm.runInContext(
    `${extraerFuncion(SRC, "_faltantesSinFila")}\n${extraerFuncion(SRC, "_cierraSola")}`,
    ctx, { filename: "ordenes-devolucion.js" });
  return ctx;
}

const ctx = montar();
const cierra = (orden) => { ctx._orden = orden; return ctx._cierraSola(); };
const recibido = (serial, acuse) => ({
  id: serial, serial, modelo: "Hytera PD606-R", resolucion: "recibido",
  acuse_id: acuse || null,
});

// ── 1. Con contrato: la última unidad resuelta + firmada cierra la orden ──
test("no cierra mientras quede una unidad sin resolver", () => {
  assert.equal(cierra({ devolucion: { esperados: [
    recibido("A1", "ac-1"),
    { id: "A2", serial: "A2", resolucion: null },
  ] } }), false);
});

test("no cierra con todo recibido pero sin acuse firmado", () => {
  assert.equal(cierra({ devolucion: { esperados: [
    recibido("A1", "ac-1"), recibido("A2", null),
  ] } }), false);
});

test("cierra sola cuando todo está recibido y firmado", () => {
  assert.equal(cierra({ devolucion: { esperados: [
    recibido("A1", "ac-1"), recibido("A2", "ac-1"),
  ] } }), true);
});

test("las excepciones no piden firma: cierra con nunca_salio / no_devuelve", () => {
  assert.equal(cierra({ devolucion: { modo: "confirmacion", esperados: [
    { id: "A1", serial: "A1", resolucion: "nunca_salio" },
    { id: "A2", serial: "A2", resolucion: "no_devuelve", motivo_codigo: "perdido" },
  ] } }), true);
});

test("una orden ya cerrada no vuelve a cerrarse", () => {
  assert.equal(cierra({
    estado_reparacion: "CERRADA (DEVOLUCION)",
    devolucion: { esperados: [recibido("A1", "ac-1")] },
  }), false);
});

test("un tiquete vacío no se da por terminado solo", () => {
  assert.equal(cierra({ devolucion: { esperados: [], esperados_por_modelo: [] } }), false);
});

test("sin permiso de operar no escribe el cierre", () => {
  ctx._puedeOperar = false;
  assert.equal(cierra({ devolucion: { esperados: [recibido("A1", "ac-1")] } }), false);
  ctx._puedeOperar = true;
});

// ── 2. Faltantes: el cierre con deuda sigue siendo decisión humana ────────
test("por modelo: no cierra hasta que la cantidad esté completa", () => {
  const dev = {
    esperados: [recibido("A1", "ac-1")],
    esperados_por_modelo: [{ modelo: "PD606-R", cantidad: 2, recibidos: 1 }],
  };
  assert.equal(cierra({ devolucion: dev }), false);
  dev.esperados.push(recibido("A2", "ac-2"));
  dev.esperados_por_modelo[0].recibidos = 2;
  assert.equal(cierra({ devolucion: dev }), true);
});

// ── 3. Contrato de papel: solo el total declarado puede cerrarlo ──────────
test("sin_contrato sin total declarado nunca cierra sola", () => {
  assert.equal(cierra({ devolucion: {
    modo: "sin_contrato", total_esperado: 0, esperados: [recibido("A1", "ac-1")],
  } }), false);
});

test("sin_contrato con faltantes tampoco: hay que itemizar lo que se cobra", () => {
  assert.equal(cierra({ devolucion: {
    modo: "sin_contrato", total_esperado: 2, esperados: [recibido("A1", "ac-1")],
  } }), false);
});

test("sin_contrato cierra sola cuando lo recibido cuadra con lo declarado", () => {
  assert.equal(cierra({ devolucion: {
    modo: "sin_contrato", total_esperado: 2,
    esperados: [recibido("A1", "ac-1"), recibido("A2", "ac-1")],
  } }), true);
});

// ── 4. El cierre viaja en la MISMA escritura que la resolución ────────────
test("_guardarDevolucion estampa estado, fecha y log en el mismo merge", () => {
  const fn = extraerFuncion(SRC, "_guardarDevolucion");
  assert.match(fn, /const cierra = _cierraSola\(\)/,
    "el cierre se decide dentro del guardado, no en cada llamador");
  assert.match(fn, /patch\.estado_reparacion = ESTADO_CERRADA/);
  assert.match(fn, /patch\.fecha_completado/);
  assert.match(fn, /action: 'CERRAR_DEVOLUCION'/,
    "el cierre automático deja el mismo rastro en os_logs que el manual");
  assert.equal((fn.match(/mergeOrder\(/g) || []).length, 1,
    "una sola escritura: dos dejarían la orden abierta si la segunda falla");
});

// ── 5. El botón dejó de ser el camino normal ─────────────────────────────
test("el pie solo ofrece cierre manual al contrato de papel (o como salvavidas)", () => {
  assert.match(SRC, /const cierreManual = !cerrada && puedeOperar\(\)\s*\n\s*&& \(esSinContrato \|\| \(!bloqueaCierre && !sinAcuse\.length\)\)/);
  assert.match(SRC, /\$\{cierreManual \? `<button[^`]*id="devCerrarOrden"/,
    "el botón se pinta solo cuando el cierre automático no puede ocurrir");
});

test("el cierre manual solo pregunta cuando hay algo que decidir", () => {
  const fn = extraerFuncion(SRC, "cerrarOrden");
  assert.match(fn, /const hayQueDecidir = pend > 0 \|\| faltan\.total > 0 \|\| sinAcuse > 0/);
  assert.match(fn, /if \(hayQueDecidir && !await Modal\.confirm/,
    "sin faltantes ni unidades sin firmar el cierre no abre ningún modal");
});

test("la bandeja nombra el acuse pendiente, no el cierre", () => {
  assert.match(SRC_RENDER, /Firmar acuse<\/button>/);
  assert.match(SRC_RENDER, /con eso la orden se cierra sola/);
});
