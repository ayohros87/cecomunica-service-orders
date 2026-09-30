// Chips de estado de la bandeja de órdenes (2026-09-30).
//
// Dos fallas que este test congela:
//   1. El chip y la fila llamaban distinto a la misma orden: el chip filtraba
//      por el estado GUARDADO y la fila muestra el nombre de PANTALLA
//      (estadoCompacto). Una ENTRADA en POR ASIGNAR decía "Por asignar" y caía
//      bajo "Por recibir"; el chip "Por asignar" marcaba 0 con 45 filas que
//      decían "Por asignar". Aquí se exige que EstadosBandeja.coincide() y
//      estadoCompacto() respondan lo mismo para cada combinación.
//   2. Los números eran de lo CARGADO (50 órdenes): cada repintado pisaba el
//      conteo del servidor ("Cerradas 27" con 1,855). Los chips solo pintan el
//      último conteo del servidor, o "—".
//
// Corre con `npm test`, sin red: los archivos del navegador se evalúan en un
// sandbox (mismo truco que devolucionPendientes.test.js).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const PUB = path.join(__dirname, "..", "..", "public");
const leer = (rel) => fs.readFileSync(path.join(PUB, rel), "utf8");
const SRC_EB = leer("js/domain/estadosBandeja.js");
const SRC_STATE = leer("js/pages/ordenes-state.js");
const SRC_RENDER = leer("js/pages/ordenes-render.js");
const SRC_SENALES = leer("js/services/senalesService.js");
const HTML = leer("ordenes/index.html");

function extraerFuncion(src, nombre) {
  const i = src.indexOf(`function ${nombre}(`);
  assert.notEqual(i, -1, `no se encontró function ${nombre}(`);
  let nivel = 0;
  for (let k = src.indexOf("{", i); k < src.length; k++) {
    if (src[k] === "{") nivel++;
    else if (src[k] === "}" && --nivel === 0) return src.slice(i, k + 1);
  }
  throw new Error(`function ${nombre} sin cerrar`);
}

const ctx = { window: {}, OrdenesQC: { qcPendiente: () => false } };
vm.createContext(ctx);
vm.runInContext(SRC_EB, ctx, { filename: "estadosBandeja.js" });
vm.runInContext(["normTxt", "esTipoVisita", "esOrdenVisita", "esOrdenProgramacion", "esOrdenEntrada",
  "_completadoFaltaQc", "estadoCompacto"].map(n => extraerFuncion(SRC_STATE, n)).join("\n"),
ctx, { filename: "ordenes-state.js" });
const EB = ctx.window.EstadosBandeja;

const TIPOS = ["REPARACIÓN", "PROGRAMACIÓN", "ENTRADA", "Entrada", "VISITA TECNICA", "DEVOLUCION", undefined];
const ESTADOS = ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO", "COMPLETADO (EN OFICINA)", undefined];

test("el chip y la fila dicen lo mismo para cada estado y tipo", () => {
  for (const tipo of TIPOS) {
    for (const estado of ESTADOS) {
      const o = { tipo_de_servicio: tipo, estado_reparacion: estado };
      const fila = ctx.estadoCompacto(estado || "POR ASIGNAR", o);
      // La DEVOLUCIÓN en POR ASIGNAR no entra en ningún chip de taller (circuito
      // propio). En RECIBIDO EN MOSTRADOR no existe en los datos; ahí cuenta
      // como cualquiera, igual que el count() del servidor.
      const dev = /DEVOL/i.test(tipo || "") && (estado || "POR ASIGNAR") === "POR ASIGNAR";
      const caso = `${tipo} / ${estado}`;
      assert.equal(EB.coincide(o, "por_recibir"), !dev && fila === "POR RECIBIR", `por_recibir: ${caso} (fila ${fila})`);
      assert.equal(EB.coincide(o, "por_asignar"), !dev && fila === "POR ASIGNAR", `por_asignar: ${caso} (fila ${fila})`);
    }
  }
});

test("las claves de vista no distinguen mayúsculas (URL y búsqueda las suben)", () => {
  const o = { tipo_de_servicio: "ENTRADA", estado_reparacion: "POR ASIGNAR" };
  assert.equal(EB.coincide(o, "POR_ASIGNAR"), true);
  assert.equal(EB.vistaDe("POR_RECIBIR"), "por_recibir");
  assert.deepEqual([...EB.estadosDe("por_asignar")].sort(), ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR"]);
});

test("los estados crudos se filtran tal cual; POR ASIGNAR crudo sigue sin DEVOLUCIÓN", () => {
  assert.equal(EB.coincide({ estado_reparacion: "ASIGNADO" }, "ASIGNADO"), true);
  assert.equal(EB.coincide({ estado_reparacion: "ASIGNADO" }, "COMPLETADO (EN OFICINA)"), false);
  assert.equal(EB.coincide({ estado_reparacion: "POR ASIGNAR", tipo_de_servicio: "DEVOLUCION" }, "POR ASIGNAR"), false);
  assert.equal(EB.coincide({ estado_reparacion: "POR ASIGNAR", tipo_de_servicio: "ENTRADA" }, "POR ASIGNAR"), true);
});

test("la lista de tipos del conteo del servidor es espejo de la regla", () => {
  for (const t of EB.TIPOS_SIN_MOSTRADOR) assert.equal(EB.sinPasoMostrador({ tipo_de_servicio: t }), true, t);
  for (const t of ["REPARACIÓN", "DEVOLUCION"]) assert.equal(EB.sinPasoMostrador({ tipo_de_servicio: t }), false, t);
});

test("los dos chips abiertos apuntan a las vistas, en las dos barras", () => {
  for (const k of ["por_recibir", "por_asignar"]) {
    assert.equal((HTML.match(new RegExp(`data-estado="${k}"`, "g")) || []).length, 2, `chip ${k}`);
    assert.equal((HTML.match(new RegExp(`data-count="${k}"`, "g")) || []).length, 2, `conteo ${k}`);
    assert.match(HTML, new RegExp(`<option value="${k}">`), `el select oculto necesita la opción ${k} o descarta el valor`);
  }
});

test("los chips no pintan conteos de lo cargado", () => {
  const fn = extraerFuncion(SRC_RENDER, "actualizarResumen");
  assert.doesNotMatch(fn, /\.filter\(/, "ningún conteo local sobre la lista cargada");
  assert.match(fn, /_pintarConteosChips\(\)/);
  const pintar = extraerFuncion(SRC_RENDER, "_pintarConteosChips");
  assert.match(pintar, /'—'/, "sin conteo del servidor el chip dice —");
  // Cada data-count del HTML tiene quién lo pinte.
  const claves = new Set([...HTML.matchAll(/data-count="([^"]+)"/g)].map(m => m[1]));
  const listas = ['CHIPS_ABIERTOS', 'CHIPS_CERRADOS'].map(n => {
    const i = SRC_RENDER.indexOf(`const ${n} = [`);
    const m = i < 0 ? null : [null, SRC_RENDER.slice(i, SRC_RENDER.indexOf("];", i))];
    assert.ok(m, `falta ${n}`);
    return m[1];
  }).join(',');
  const pintadas = new Set([...[...listas.matchAll(/'([^']+)'/g)].map(m => m[1]), 'qc', 'cerradas']);
  for (const k of claves) assert.ok(pintadas.has(k), `nadie pinta data-count="${k}"`);
});

test("sumaConteos: null anula, N+ vuelve piso", () => {
  const sctx = { window: {}, firebase: {}, PendientesDomain: {} };
  vm.createContext(sctx);
  vm.runInContext(SRC_SENALES, sctx, { filename: "senalesService.js" });
  const S = sctx.window.SenalesService;
  assert.equal(S.sumaConteos([1, 2, 3]), 6);
  assert.equal(S.sumaConteos([1, "50+"]), "51+");
  assert.equal(S.sumaConteos([1, null]), null);
  assert.equal(S.sumaConteos([1, undefined]), null);
});
