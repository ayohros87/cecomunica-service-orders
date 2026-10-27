// Serial o modelo corregidos en una unidad YA recibida, antes de la firma del
// acuse (pedido de Brenda, 2026-10-27, FORTALEZA 2026102601: el serial
// tecleado no lo reconoció el sistema, el radio quedó sin modelo y la
// devolución no dejaba corregir ninguno de los dos).
//
// Congela las partes puras de domain/correccionRecibido.js y la corrección
// de identidad en la fila de la ENTRADA (lib/ordenEntrada.js):
//
//  1. detectarCorrecciones: solo unidades que YA estaban recibidas y siguen
//     sin acuse; la tanda nueva y las sustituciones del plan van por otro
//     camino. Serial y modelo se detectan por separado.
//  2. fichaNacidaAqui: una ficha cuyo kardex entero apunta a la devolución o
//     a su ENTRADA (y arranca con un alta) es la fantasma del dígito mal
//     tecleado; cualquier historia previa la vuelve "otro radio".
//  3. estadoPrevioADevolucion: a qué estado vuelve ese otro radio.
//  4. corregirIdentidadEntrada: la fila se busca por el serial ANTERIOR, se
//     reescriben las dos claves del serial y el modelo, y nunca se duplica
//     un serial vivo ni se toca una fila eliminada.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-correccion-recibido" });

const { detectarCorrecciones, fichaNacidaAqui, estadoPrevioADevolucion } =
  require("../src/domain/correccionRecibido");
const { corregirIdentidadEntrada } = require("../src/lib/ordenEntrada");

const DEV = "2026102601";
const ENT = "2026102602";

const recibida = (id, serial, extra = {}) => ({
  id, serial, modelo: "PNC360S-R", modelo_id: "pnc360s-r",
  pool_doc_id: null, resolucion: "recibido", accesorios: null, dano_visible: null,
  ...extra,
});
const mapa = (lista) => new Map(lista.map(e => [e.id, e]));

test("detectarCorrecciones: serial y modelo cambiados en una recibida sin acuse", () => {
  const antes = mapa([
    recibida("a", "22610A4088", { modelo: "", modelo_id: null }),
    recibida("b", "24220A2338"),
    recibida("c", "22806A0307"),
  ]);
  const despues = [
    recibida("a", "22610A4080"),                                   // serial + modelo
    recibida("b", "24220A2338", { modelo: "PNC370-R", modelo_id: "pnc370-r" }), // solo modelo
    recibida("c", "22806-A0307"),                                  // solo formato: nada
  ];
  const r = detectarCorrecciones(antes, despues);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], {
    id: "a", serial: "22610A4080", serial_norm: "22610A4080",
    serial_antes: "22610A4088", antes_norm: "22610A4088",
    modelo: "PNC360S-R", modelo_id: "pnc360s-r", modelo_antes: "", modelo_id_antes: null,
    pool_doc_id: null, cambioSerial: true, cambioModelo: true,
  });
  assert.equal(r[1].id, "b");
  assert.equal(r[1].cambioSerial, false);
  assert.equal(r[1].cambioModelo, true);
});

test("detectarCorrecciones: la tanda nueva, el acuse firmado y la sustitución del plan quedan fuera", () => {
  const antes = mapa([
    { id: "nueva", serial: "X1", resolucion: null },                    // recién recibida: la cubre la tanda
    recibida("firmada", "X2", { acuse_id: "2026102601-A1" }),           // ya firmó: candado
    recibida("sust", "X3"),                                              // sustitución del plan
    recibida("firmaAhora", "X4"),
  ]);
  const despues = [
    recibida("nueva", "X1-CORR"),
    recibida("firmada", "X2-CORR", { acuse_id: "2026102601-A1" }),
    recibida("sust", "X3-REAL", { serial_original: "X3" }),
    recibida("firmaAhora", "X4-CORR", { acuse_id: "2026102601-A2" }),   // firma y cambio en la misma escritura: no
  ];
  assert.deepEqual(detectarCorrecciones(antes, despues), []);
  // Una sustitución YA hecha que después se corrige sí cuenta (el original no cambió).
  const r = detectarCorrecciones(
    mapa([recibida("s", "X3-REAL", { serial_original: "X3" })]),
    [recibida("s", "X3-REAL2", { serial_original: "X3" })]);
  assert.equal(r.length, 1);
  assert.equal(r[0].serial_antes, "X3-REAL");
});

test("fichaNacidaAqui: todo el kardex apunta a la devolución o a su ENTRADA", () => {
  const alta = { tipo: "migracion", ref: { tipo: "orden", id: DEV } };
  const taller = { tipo: "ingreso_taller", ref: { tipo: "orden", id: ENT } };
  assert.equal(fichaNacidaAqui([alta], [DEV, ENT]), true);
  assert.equal(fichaNacidaAqui([alta, taller], [DEV, ENT]), true);
  // Nacida por la ENTRADA (modo con contrato: transicionar no crea, la ENTRADA sí).
  assert.equal(fichaNacidaAqui([{ tipo: "migracion", ref: { id: ENT } }], [DEV, ENT]), true);
  // Historia previa = otro radio.
  assert.equal(fichaNacidaAqui([{ tipo: "migracion", ref: { id: "CONTRATO-1" } }, { tipo: "devolucion", ref: { id: DEV } }], [DEV, ENT]), false);
  // Sin alta, sin ref, o sin kardex: no se juzga como fantasma.
  assert.equal(fichaNacidaAqui([{ tipo: "devolucion", ref: { id: DEV } }], [DEV, ENT]), false);
  assert.equal(fichaNacidaAqui([{ tipo: "migracion", ref: null }], [DEV, ENT]), false);
  assert.equal(fichaNacidaAqui([], [DEV, ENT]), false);
  assert.equal(fichaNacidaAqui([alta], [DEV, null]), true);
});

test("estadoPrevioADevolucion: el de_estado del movimiento de ESTA devolución, el más reciente", () => {
  const movs = [
    { tipo: "devolucion", de_estado: "asignado_contrato", a_estado: "devuelto_revision", ref: { id: "OTRA" }, at: 5 },
    { tipo: "devolucion", de_estado: "en_cliente", a_estado: "devuelto_revision", ref: { id: DEV }, at: 10 },
    { tipo: "ingreso_taller", de_estado: "devuelto_revision", a_estado: "en_taller", ref: { id: ENT }, at: 11 },
    { tipo: "devolucion", de_estado: "asignado_contrato", a_estado: "devuelto_revision", ref: { id: DEV }, at: { toMillis: () => 20 } },
  ];
  assert.equal(estadoPrevioADevolucion(movs, DEV), "asignado_contrato");
  assert.equal(estadoPrevioADevolucion(movs, "NADIE"), null);
  assert.equal(estadoPrevioADevolucion([], DEV), null);
});

const equipo = (serial, extra = {}) => ({
  id: `eq-${serial}`, serial, numero_de_serie: serial,
  modelo: "", modelo_id: null, observaciones: "Tanda…", eliminado: false, ...extra,
});

test("corregirIdentidadEntrada: busca por el serial anterior y reescribe las dos claves + modelo", () => {
  const equipos = [equipo("22610A4088"), equipo("24220A2338", { modelo: "PNC360S-R", modelo_id: "pnc360s-r" })];
  const r = corregirIdentidadEntrada(equipos, [
    { serial_antes: "22610a4088", serial: "22610A4080", modelo: "PNC360S-R", modelo_id: "pnc360s-r", cambioSerial: true, cambioModelo: true },
    { serial_antes: "24220A2338", serial: "24220A2338", modelo: "PNC370-R", modelo_id: "pnc370-r", cambioSerial: false, cambioModelo: true },
  ]);
  assert.equal(r.cambios, 2);
  assert.equal(r.equipos[0].serial, "22610A4080");
  assert.equal(r.equipos[0].numero_de_serie, "22610A4080");
  assert.equal(r.equipos[0].modelo, "PNC360S-R");
  assert.equal(r.equipos[0].observaciones, "Tanda…"); // no se toca
  assert.equal(r.equipos[1].serial, "24220A2338");
  assert.equal(r.equipos[1].modelo, "PNC370-R");
  assert.deepEqual(r.aplicadas[0], {
    serial_antes: "22610A4088", serial: "22610A4080", modelo_antes: "", modelo: "PNC360S-R",
    cambioSerial: true, cambioModelo: true,
  });
  assert.equal(equipos[0].serial, "22610A4088"); // el original no se muta
});

test("corregirIdentidadEntrada: no duplica un serial vivo, salta eliminadas y seriales ajenos", () => {
  const equipos = [equipo("A1"), equipo("A2"), equipo("A3", { eliminado: true })];
  const r = corregirIdentidadEntrada(equipos, [
    { serial_antes: "A1", serial: "A2", cambioSerial: true, cambioModelo: false },     // A2 ya vive: no
    { serial_antes: "A3", serial: "A9", cambioSerial: true, cambioModelo: false },     // eliminada: no
    { serial_antes: "ZZ", serial: "A8", cambioSerial: true, cambioModelo: false },     // no está: no
    { serial_antes: "A2", serial: "A3", cambioSerial: true, cambioModelo: false },     // A3 está eliminada: sí
  ]);
  assert.equal(r.cambios, 1);
  assert.equal(r.equipos[0].serial, "A1");
  assert.equal(r.equipos[1].serial, "A3");
});
