// De quién es cada radio (petición de Alberto 2026-09-09: "necesitan poder
// identificar fácilmente si los equipos son alquiler o propios del cliente").
// Guardias:
//   P1 — la propiedad sale de la LÍNEA del contrato: una línea "propio" marca
//        la unidad como del cliente aunque el contrato sea de tipo Servicio.
//   P2 — contratos SIN modalidad por línea (los viejos, 410 de 415 líneas
//        vigentes) siguen resolviéndose por el tipo, como antes.
//   P3 — el mismo modelo en dos modalidades no se adivina: no se estampa.
//   P4 — el pareo serial↔línea es por catálogo (familia N/R), no por texto.
//   P5 — el trigger onSerialWrite ya NO decide por tipo de contrato y omite
//        el campo cuando la propiedad es ambigua.
//   P6 — una sola voz en el front: EquiposPoolService pone la etiqueta y el
//        chip, y la flota solo se llama "Alquiler" cuando está con el cliente.
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const { propiedadDeUnidad } = require("../src/domain/propiedadUnidad");
const ModeloFamilia = require("../src/domain/modeloFamilia");

// Catálogo mínimo con una familia N/R (el -R es variante del nuevo). Sin red
// ni credenciales: el helper solo depende de ModeloFamilia.
ModeloFamilia.cargar([
  { id: "m-pnc", marca: "HYTERA", modelo: "PNC360S", estado: "N" },
  { id: "m-pnc-r", marca: "HYTERA", modelo: "PNC360S-R", estado: "R", variante_de: "m-pnc" },
  { id: "m-pd", marca: "HYTERA", modelo: "PD606-R", estado: "R" },
]);

const SERV = { codigo_tipo: "SERV", tipo_contrato: "Servicio" };
const PROP = { codigo_tipo: "PROP", tipo_contrato: "Propio" };
const ALQ = { codigo_tipo: "ALQ", tipo_contrato: "Alquiler" };

test("P1 la línea manda: 'propio' en un contrato SERV marca la unidad del cliente", () => {
  const lineas = [
    { modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R", modalidad: "propio", cantidad: 3 },
  ];
  const r = propiedadDeUnidad({ modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R" }, lineas, SERV);
  assert.equal(r.propiedad, "cliente");
  assert.equal(r.origen, "linea");
});

test("P1 la línea manda: 'alquiler' en un contrato SERV deja la unidad en flota", () => {
  const lineas = [{ modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R", modalidad: "alquiler" }];
  const r = propiedadDeUnidad({ modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R" }, lineas, SERV);
  assert.equal(r.propiedad, "cecomunica");
  assert.equal(r.origen, "linea");
});

test("P1 con dos líneas de modelos distintos, cada unidad toma la SUYA", () => {
  const lineas = [
    { modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R", modalidad: "alquiler" },
    { modelo_id: "m-pd", modelo: "HYTERA PD606-R", modalidad: "propio" },
  ];
  assert.equal(propiedadDeUnidad({ modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R" }, lineas, SERV).propiedad, "cecomunica");
  assert.equal(propiedadDeUnidad({ modelo_id: "m-pd", modelo: "HYTERA PD606-R" }, lineas, SERV).propiedad, "cliente");
});

test("P2 contrato viejo sin modalidad por línea: PROP = del cliente, ALQ = flota", () => {
  const lineas = [{ modelo_id: "m-pd", modelo: "HYTERA PD606-R", cantidad: 2 }];
  const u = { modelo_id: "m-pd", modelo: "HYTERA PD606-R" };
  const rProp = propiedadDeUnidad(u, lineas, PROP);
  assert.equal(rProp.propiedad, "cliente");
  assert.equal(rProp.origen, "tipo_contrato");
  assert.equal(propiedadDeUnidad(u, lineas, ALQ).propiedad, "cecomunica");
});

test("P2 sin línea que pare con el modelo también cae al tipo del contrato", () => {
  const lineas = [{ modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R", modalidad: "propio" }];
  const r = propiedadDeUnidad({ modelo_id: "m-pd", modelo: "HYTERA PD606-R" }, lineas, ALQ);
  assert.equal(r.propiedad, "cecomunica");
  assert.equal(r.origen, "tipo_contrato");
});

test("P3 el mismo modelo en dos modalidades no se adivina", () => {
  const lineas = [
    { modelo_id: "m-pd", modelo: "HYTERA PD606-R", modalidad: "alquiler", cantidad: 2 },
    { modelo_id: "m-pd", modelo: "HYTERA PD606-R", modalidad: "propio", cantidad: 1 },
  ];
  const r = propiedadDeUnidad({ modelo_id: "m-pd", modelo: "HYTERA PD606-R" }, lineas, SERV);
  assert.equal(r.propiedad, null);
  assert.equal(r.origen, "ambigua");
});

test("P4 la familia N/R parea, y la fila EXACTA gana sobre la familia", () => {
  // La unidad es el refurbished; la única línea es la del nuevo, misma familia.
  const porFamilia = [{ modelo_id: "m-pnc", modelo: "HYTERA PNC360S", modalidad: "propio" }];
  assert.equal(propiedadDeUnidad({ modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R" }, porFamilia, SERV).propiedad, "cliente");
  // Con las dos filas de la familia, manda la exacta del modelo de la unidad.
  const ambas = [
    { modelo_id: "m-pnc", modelo: "HYTERA PNC360S", modalidad: "propio" },
    { modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R", modalidad: "alquiler" },
  ];
  assert.equal(propiedadDeUnidad({ modelo_id: "m-pnc-r", modelo: "HYTERA PNC360S-R" }, ambas, SERV).propiedad, "cecomunica");
});

test("P4 sin lista de líneas no truena y cae al tipo", () => {
  assert.equal(propiedadDeUnidad({ modelo_id: "m-pd", modelo: "X" }, undefined, PROP).propiedad, "cliente");
  assert.equal(propiedadDeUnidad({}, [], SERV).propiedad, "cecomunica");
  assert.equal(propiedadDeUnidad({}, [null], undefined).propiedad, "cecomunica");
});

test("P5 onSerialWrite deriva de la línea y omite la propiedad ambigua", () => {
  const src = leer("functions", "src", "triggers", "contratos", "onSerialWrite.js");
  assert.match(src, /propiedadDeUnidad\(/, "el trigger debe usar el helper");
  assert.match(src, /\.\.\.\(propiedad \? \{ propiedad \} : \{\}\)/,
    "la propiedad ambigua no se estampa");
  assert.doesNotMatch(src, /const propiedad = \(c\.tipo_contrato === "Propio"/,
    "ya no se decide por el tipo del contrato");
});

test("P6 el front tiene UNA sola voz para la propiedad", () => {
  const src = leer("public", "js", "services", "equiposPoolService.js");
  const ctx = { window: {}, firebase: { firestore: () => ({}) }, console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  const S = ctx.window.EquiposPoolService;

  assert.equal(S.propiedadLabel({ propiedad: "cliente", estado: "en_cliente" }), "Del cliente");
  // La flota solo es "Alquiler" cuando está CON el cliente.
  assert.equal(S.propiedadLabel({ propiedad: "cecomunica", estado: "en_cliente" }), "Alquiler");
  assert.equal(S.propiedadLabel({ propiedad: "cecomunica", estado: "asignado_contrato" }), "Alquiler");
  assert.equal(S.propiedadLabel({ propiedad: "cecomunica", estado: "en_bodega" }), "Flota");
  assert.equal(S.propiedadLabel({ propiedad: "desconocida", estado: "en_taller" }), "Sin clasificar");
  assert.equal(S.propiedadLabel({ estado: "en_bodega" }), "Sin clasificar");

  const chip = S.chipPropiedadHtml({ propiedad: "cliente", estado: "en_cliente" });
  assert.match(chip, /class="eqpool-prop eqpool-prop-cliente"/);
  assert.match(chip, /Del cliente<\/span>/);
  assert.match(S.chipPropiedadHtml({ propiedad: "raro" }), /eqpool-prop-desconocida/);

  assert.equal(S.resumenPropiedadTexto([
    { propiedad: "cecomunica" }, { propiedad: "cecomunica" }, { propiedad: "cliente" }, {},
  ]), "2 en alquiler · 1 del cliente · 1 sin clasificar");
  assert.equal(S.resumenPropiedadTexto([]), "");
});

test("P6 las pantallas del Centro muestran de quién es cada equipo", () => {
  const src = leer("public", "js", "pages", "clientes-centro.js");
  // Ver contrato: columna en las líneas y tabla de seriales con su propiedad.
  assert.match(src, /<th>De quién es<\/th>/, "la tabla de líneas declara la columna");
  assert.match(src, /chipPropiedadHtml/, "los seriales llevan el chip de propiedad");
  assert.match(src, /resumenPropiedadTexto/, "hay resumen por propiedad");
  // Y ya no queda el texto suelto de los 8 seriales.
  assert.doesNotMatch(src, /equipo\(s\) en campo bajo este contrato/);

  // Las tres pantallas que decían lo mismo distinto usan el chip común.
  for (const f of [["public", "js", "ui", "equipo-ficha.js"],
                   ["public", "js", "ui", "equipos-cliente.js"],
                   ["public", "js", "pages", "inventario-equipos.js"]]) {
    assert.match(leer(...f), /chipPropiedadHtml/, `${f.join("/")} debe usar el chip común`);
  }
  assert.doesNotMatch(leer("public", "js", "pages", "inventario-equipos.js"), /PROP_LABELS/,
    "el vocabulario viejo de inventario ya no existe");
});

test("P7 los documentos y correos también dicen de quién es cada equipo", () => {
  // Correo a activaciones: la tabla de seriales gana la columna, derivada de
  // la línea con el mismo helper del pool.
  const aprob = leer("functions", "src", "triggers", "contratos", "onApproval.js");
  assert.match(aprob, /propiedadDeUnidad/, "el correo deriva la propiedad de la línea");
  assert.match(aprob, /De quién es<\/th>/, "la tabla de seriales declara la columna");

  // Anexo de aumento impreso: la línea dice si el equipo es del cliente.
  assert.match(leer("public", "clientes", "anexo-aumento.html"),
    /modalidad === 'propio' \? ' — equipo del cliente' : ''/);

  // Página de firma: la tabla de seriales de una regularización lleva
  // Propiedad, y el congelado de la solicitud la guarda.
  const firmar = leer("public", "firmar", "index.html");
  assert.match(firmar, /<th>Propiedad<\/th>/);
  assert.match(leer("public", "js", "pages", "clientes-centro.js"),
    /s\.modalidad \? \{ modalidad: s\.modalidad \} : \{\}/,
    "la modalidad viaja en el congelado de la firma");

  // Orden de devolución: dice por qué no están los equipos del cliente.
  assert.match(leer("functions", "src", "lib", "ordenDevolucion.js"),
    /solo los equipos de la flota/);
});
