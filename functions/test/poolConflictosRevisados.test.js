// Cola de Conflictos del pool: los grupos YA RESUELTOS siguen siendo
// consultables.
//
// El reporte que la origina (2026-08-28): el serial B3900053 existe en
// NX-420-R y NX-920-R — correcto, son dos radios físicos que comparten
// numeración — pero "en la opción de conflictos este serial no aparece". No
// era un dato perdido: bodega ya lo había resuelto el 2026-08-11 y la cola
// solo mostraba pendientes. El chip "2+ modelos" mandaba a una pantalla donde
// el serial nunca iba a estar.
//
// Desde la auditoría UX 2026-09-28 (P2 #14) la cola es UNA y vive en Almacén
// · Hoy (solo pendientes, ConflictosPoolService.agrupar); el camino de vuelta
// de una decisión equivocada es "Reabrir conflicto" en la ficha del equipo.
// La lista por serial (inventario-equipos.js) ya no la duplica.
//
// Se congela aquí porque el filtro (dato) y el aviso que anuncia el destino
// (presentación) viven en archivos distintos y se desincronizan solos.
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
  const ctx = { console, window: {}, firebase: { firestore: () => ({}), functions: () => ({}) } };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "conflictosPoolService.js"), ctx);
  return ctx.window.ConflictosPoolService;
}

// Dos radios distintos con la misma numeración (caso Kenwood real), ya
// resueltos; y un conflicto de verdad pendiente.
const POOL = [
  { id: "B3900053", serial_norm: "B3900053", modelo_label: "KENWOOD NX-920-R",
    estado: "en_bodega", serial_compartido: true, conflicto_revisado: true },
  { id: "B3900053__68N", serial_norm: "B3900053", modelo_label: "KENWOOD NX-420-R",
    estado: "en_bodega", serial_compartido: true, conflicto_revisado: true },
  { id: "Z9000001", serial_norm: "Z9000001", modelo_label: "HYTERA PD606",
    estado: "en_bodega", serial_compartido: true },
  { id: "Z9000001__PD6", serial_norm: "Z9000001", modelo_label: "HYTERA PD686",
    estado: "en_cliente", serial_compartido: true },
  { id: "UNICO1", serial_norm: "UNICO1", modelo_label: "HYTERA HP786", estado: "en_bodega" },
];

test("la cola trae solo pendientes; el historial se pide a propósito", () => {
  const svc = cargarServicio();

  // .join(): los arrays nacen dentro del vm y no son reference-equal con los
  // de este realm, así que deepEqual los rechaza aunque digan lo mismo.
  const pendientes = svc.agrupar(POOL);
  assert.equal(pendientes.map((g) => g.norm).join(","), "Z9000001",
    "la cola de trabajo tiene que seguir mostrando SOLO lo que falta decidir");

  const todos = svc.agrupar(POOL, { incluirRevisados: true });
  assert.equal(todos.map((g) => g.norm).join(","), "Z9000001,B3900053",
    "con incluirRevisados hay que ver los dos, y los pendientes van primero");
  assert.equal(todos.find((g) => g.norm === "B3900053").revisado, true);
  assert.equal(todos.find((g) => g.norm === "Z9000001").revisado, false);

  // El contador de la bandeja es de trabajo: no puede inflarse con lo ya resuelto.
  assert.equal(svc.agrupar(POOL).length, 1);
});

test("la cola vive UNA vez (Hoy) y la lista por serial no la duplica", () => {
  const hoy = sinComentarios(leer("public", "js", "pages", "almacen-hoy.js"));
  assert.match(hoy, /ConflictosPoolService\.listarPendientes\(\)/, "Hoy pide la cola al servicio");
  assert.match(hoy, /data-conflicto=/, "Hoy ofrece resolver cada grupo");
  const lista = sinComentarios(leer("public", "js", "pages", "inventario-equipos.js"));
  assert.doesNotMatch(lista, /renderConflictos|_gruposConflicto|fusionarGrupo|marcarDistintos|reabrirGrupo/,
    "la lista por serial ya no pinta ni resuelve conflictos");
  assert.doesNotMatch(lista, /colaConflictos/, "ni tiene tarjeta de Conflictos");
});

test("un grupo resuelto se reabre desde la ficha, nunca se re-decide", () => {
  const ficha = leer("public", "js", "ui", "equipo-ficha.js");
  // Solo con decisión tomada: en un pendiente la acción es fusionar o marcar
  // distintos (Hoy), y ofrecer "reabrir" ahí sería un botón sin sentido.
  const acciones = ficha.slice(ficha.indexOf("_accionesHtml(eq)"), ficha.indexOf("async _accion(docId"));
  assert.match(acciones, /eq\.serial_compartido && eq\.conflicto_revisado === true[\s\S]{0,200}reabrir_conflicto/,
    "«Reabrir conflicto» solo aparece en una ficha con conflicto ya resuelto");
  // Reabrir = marcar revisado en false con el porqué en el kardex — vía el
  // servicio, la MISMA escritura que usa Hoy para cerrar.
  const handler = ficha.slice(ficha.indexOf("accion === 'reabrir_conflicto'"));
  const bloque = handler.slice(0, handler.indexOf("} else if"));
  assert.match(bloque, /ConflictosPoolService\.marcarRevisado\(grupo, false,/,
    "reabrir pasa por ConflictosPoolService.marcarRevisado(…, false, …)");
  assert.match(bloque, /Modal\.prompt\(/, "reabrir pide el motivo");
  assert.doesNotMatch(bloque, /conflicto_revisado:\s*false/, "la marca la escribe solo el servicio");
});

test("el chip 2+ modelos no manda a la cola cuando ya hay decisión", () => {
  // Las tres puntas que pintan el aviso. Un chip que anuncia "se resuelve en
  // Conflictos" para un serial resuelto es exactamente el reporte que originó
  // este archivo: el usuario va, no lo encuentra y cree que se perdió el dato.
  const puntas = [
    ["public/js/pages/inventario-equipos.js", leer("public", "js", "pages", "inventario-equipos.js")],
    ["public/js/ui/equipo-ficha.js", leer("public", "js", "ui", "equipo-ficha.js")],
  ];
  for (const [nombre, src] of puntas) {
    const chips = src.match(/<span class="eqpool-compartido"[^>]*>/g) || [];
    assert.ok(chips.length >= 2,
      `${nombre}: el chip "2+ modelos" tiene que distinguir resuelto de pendiente`);
    const mandanALaCola = chips.filter((c) => /cola de Conflictos/.test(c));
    assert.equal(mandanALaCola.length, 1,
      `${nombre}: solo el chip del conflicto PENDIENTE puede mandar a la cola`);
    assert.ok(!/Equipos por serial|pestaña Conflictos/.test(chips.join("")),
      `${nombre}: la cola ya no vive en Equipos por serial`);
  }
  // SerialField obliga a elegir en los dos casos, pero solo el pendiente tiene
  // algo que resolver.
  const sf = leer("public", "js", "ui", "serial-field.js");
  assert.match(sf, /conflicto_revisado === true/,
    "serial-field.js: el aviso al teclear el serial también distingue los dos casos");
});
