// Almacén · Asignar — "Disponible" ≠ "en bodega" y pick & confirm
// (auditoría UX 2026-09-28, P2 #13 y #15).
//
//   D1 — una unidad en bodega marcada DAÑADA (la nota del importador), con
//        condición particular vigente o descartada en QC NO es disponible, y
//        la regla dice por qué (motivoNoDisponible).
//   D2 — el picker del estante filtra con esa regla y muestra las que quedan
//        fuera como "No disponibles (N)"; la cabecera de la picklist cuenta
//        disponibles, no "en bodega".
//   V1 — antes de "Listo para programar" hay verificación por escaneo; si se
//        sustituyó algo, se vuelve a validar contra el pool; la verificación
//        queda en seriales_estado/current (picklist_verificada_*).
//   V2 — la gestión completa también se verifica y deja evento; el cambio de
//        serial no (no saca nada del estante).
//   V3 — el sustituido se va al kardex por el servicio (registrarMovimiento),
//        con tipo etiquetado en la ficha.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function cargarServicio() {
  const ctx = { firebase: { firestore: { FieldValue: {} } }, console, window: {} };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "serial.js"), ctx);
  ctx.Serial = ctx.window.Serial;
  vm.runInContext(leer("public", "js", "services", "equiposPoolService.js"), ctx);
  return ctx.window.EquiposPoolService;
}

test("D1 · DAÑADA, condición vigente o descarte sacan la unidad de 'disponible', con motivo", () => {
  const svc = cargarServicio();
  const sana = { serial: "A100", serial_norm: "A100", estado: "en_bodega", notas: "" };
  const danada = { serial: "A200", serial_norm: "A200", estado: "en_bodega", notas: "DAÑADA — reportada por bodega en el conteo" };
  const danadaSinTilde = { serial: "A201", serial_norm: "A201", estado: "en_bodega", notas: "danada, no enciende" };
  const conNota = { serial: "A300", serial_norm: "A300", estado: "en_bodega", notas: "Compra factura 123 (no dañada)" };

  assert.equal(svc.esDanada(danada), true);
  assert.equal(svc.esDanada(danadaSinTilde), true, "la marca vale con N o Ñ");
  assert.equal(svc.esDanada(conNota), false, "«dañada» en medio de una nota no es la marca");
  assert.equal(svc.esDanada(sana), false);

  assert.equal(svc.motivoNoDisponible(sana), null, "sin marcas es disponible");
  assert.match(svc.motivoNoDisponible(danada), /DAÑADA/);

  const condiciones = new Map([["A100", { condicion: "conector de auricular dañado" }]]);
  assert.match(svc.motivoNoDisponible(sana, { condiciones }), /condición particular: conector/);

  const descartados = new Map([["A100", { motivo: "no enciende" }]]);
  assert.match(svc.motivoNoDisponible(sana, { descartados }), /descartado/i,
    "sin EquiposDescartadosService cargado cae al texto genérico, pero bloquea igual");
  // El descarte manda sobre lo demás: es el bloqueo más fuerte.
  assert.match(svc.motivoNoDisponible(danada, { descartados: new Map([["A200", {}]]) }), /descartado/i);
});

test("D2 · el picker filtra con la regla y muestra 'No disponibles (N)'; la cabecera cuenta disponibles", () => {
  const comp = sinComentarios(leer("public", "js", "ui", "asignador-seriales.js"));
  const picker = comp.slice(comp.indexOf("async function abrirPickerPool("), comp.indexOf("async function avisosCondiciones("));
  assert.match(picker, /condicionesVigentes\(\)/, "consulta las condiciones vigentes (una sola lectura)");
  assert.match(picker, /motivoNoDisponible\(u, descartados, condiciones\)/, "cada unidad pasa por la regla");
  assert.match(picker, /No disponibles \(\$\{noDisp\.length\}\)/, "las excluidas se muestran con su cuenta…");
  assert.match(picker, /esc\(x\.motivo\)/, "…y con su motivo");
  assert.match(picker, /extraHtml: noDispHtml/, "dentro del mismo picker, no en un toast que se va");
  const regla = comp.slice(comp.indexOf("function motivoNoDisponible("), comp.indexOf("async function condicionesVigentes("));
  assert.match(regla, /EquiposPoolService\.motivoNoDisponible/, "la regla es la del servicio (una sola)");
  assert.match(regla, /motivoBloqueo\(dsc\)/, "con un servicio viejo en caché sigue bloqueando descartados");

  const pagina = sinComentarios(leer("public", "js", "pages", "almacen-asignar.js"));
  const cab = pagina.slice(pagina.indexOf("async function picklistHtml("), pagina.indexOf("function renderTrabajoVacio("));
  assert.match(cab, /esDanada\(u\)/, "la cabecera descuenta las DAÑADAS");
  assert.match(cab, /disponible\$\{disp === 1 \? '' : 's'\}/, "y dice 'disponibles', no 'en bodega'");
});

test("V1 · Listo para programar pasa por la verificación por escaneo y la persiste", () => {
  const src = sinComentarios(leer("public", "js", "pages", "almacen-asignar.js"));
  const listo = src.slice(src.indexOf("async function listoParaProgramar("), src.indexOf("async function guardarReemplazo("));
  const iVal = listo.indexOf("validarContrato(c, datos.seriales)");
  const iVer = listo.indexOf("verificarPicklist(datos.seriales)");
  const iHoja = listo.indexOf("hojaListo(c, datos)");
  const iPers = listo.indexOf("persistirContrato(c, 'asignados', datos, { verificacion: v })");
  assert.ok(iVal > 0 && iVer > iVal && iHoja > iVer && iPers > iHoja,
    "orden: validar contra el pool → verificar por escaneo → hoja de cierre → persistir con la verificación");
  assert.match(listo, /if \(v\.reemplazos\.length\) \{\s*datos = asg\.collect\(\);\s*r = await validarContrato/,
    "si hubo sustitutos, el formulario cambió: se recoge y valida de nuevo");
  assert.match(listo, /if \(!v\) return;/, "volver atrás en la verificación no cierra el trabajo");

  const pers = src.slice(src.indexOf("async function persistirContrato("), src.indexOf("async function registrarExcepcion("));
  for (const campo of ["picklist_verificada_at", "picklist_verificada_por", "picklist_verificada_n", "picklist_reemplazos"]) {
    assert.ok(pers.includes(campo), `seriales_estado/current guarda ${campo}`);
  }
  assert.match(pers, /collection\('seriales_estado'\)\.doc\('current'\)\.set\(\{[\s\S]*\.\.\.verif/, "va en el doc de estado (write ya permitido a gestionar-seriales)");

  // La hoja: ✓ por serial, aviso si no está, "falta N", sustituto con motivo.
  const hoja = src.slice(src.indexOf("async function hojaVerificacion("), src.indexOf("async function aplicarReemplazos("));
  assert.match(hoja, /NO está en la lista/, "aviso cuando el escaneado no es de la lista");
  assert.match(hoja, /Falta\$\{n === 1 \? '' : 'n'\} <b>\$\{n\}<\/b> de \$\{pend\.size\}/, "dice cuántas faltan");
  assert.match(hoja, /btn\.disabled = n > 0/, "no se confirma con faltantes");
  assert.match(hoja, /Modal\.prompt\(\{[\s\S]*title: 'No está en el estante'/, "sustituir pide motivo");
  assert.match(hoja, /disponiblesDe\(f\.modelo_id, f\.modelo, new Set\(pend\.keys\(\)\)\)/, "el sustituto es del MISMO modelo y no está ya en la lista");
  assert.match(hoja, /ok: false, sustituye: f\.serial/, "el sustituto también hay que escanearlo");
  const disp = src.slice(src.indexOf("async function disponiblesDe("), src.indexOf("async function hojaVerificacion("));
  assert.match(disp, /motivoNoDisponible\(u, descartados, condiciones\)/, "el sustituto respeta 'disponible ≠ en bodega'");

  // Imprimible: modelo, serial, ubicación, cliente/contrato, casilla.
  const imp = src.slice(src.indexOf("async function imprimirPicklist("), src.indexOf("async function disponiblesDe("));
  assert.match(imp, /<th>#<\/th><th>Modelo<\/th><th>Serial<\/th><th>Ubicación<\/th><th>Cliente \/ contrato<\/th><th>✓<\/th>/);
  assert.match(imp, /☐/, "casilla por serial");
  assert.match(src, /data-as="imprimir"/, "el botón vive en la toolbar del trabajo");
});

test("V2 · la gestión completa se verifica y deja evento; el cambio de serial no", () => {
  const src = sinComentarios(leer("public", "js", "pages", "almacen-asignar.js"));
  const g = src.slice(src.indexOf("async function guardarGestion("), src.indexOf("async function siguiente("));
  assert.match(g, /if \(!esCambio\(g\) && esperado && datos\.seriales\.length >= esperado\) \{\s*v = await verificarPicklist/,
    "solo cuando la asignación queda completa y saca radios del estante");
  assert.match(g, /r = await asg\.exigirEnBodega\(datos\.seriales, \{\}\);\s*if \(!r\) return;\s*\}\s*\}/,
    "con sustitutos se vuelve a validar contra el pool");
  assert.match(g, /registrarEvento\(t\.gid, 'asignar',\s*`Lista verificada por escaneo/, "queda como evento de la gestión");
});

test("V3 · el sustituido se anota en el kardex por el servicio, y la ficha sabe leerlo", () => {
  const svc = sinComentarios(leer("public", "js", "services", "equiposPoolService.js"));
  const mov = svc.slice(svc.indexOf("async registrarMovimiento("), svc.indexOf("async registrarMovimiento(") + 400);
  assert.match(mov, /this\._conKardex\(id, \{\}, \{ tipo, de_estado: estadoActual, a_estado: estadoActual, notas, ref \}, user\)/,
    "solo kardex: no toca campos de la ficha");
  const pagina = sinComentarios(leer("public", "js", "pages", "almacen-asignar.js"));
  const ap = pagina.slice(pagina.indexOf("async function aplicarReemplazos("), pagina.indexOf("async function verificarPicklist("));
  assert.match(ap, /registrarMovimiento\(d\.id, \{\s*tipo: 'picklist_no_encontrado'/, "tipo propio, con el motivo y el sustituto en la nota");
  assert.doesNotMatch(ap, /\.collection\('movimientos'\)|\.update\(|batch\(/, "la página no escribe kardex por su cuenta");
  const ficha = leer("public", "js", "ui", "equipo-ficha.js");
  assert.match(ficha, /picklist_no_encontrado:\s*'No estaba en el estante al verificar la lista'/, "la ficha etiqueta el movimiento");
});
