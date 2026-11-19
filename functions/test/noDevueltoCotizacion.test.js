// Reposición de un equipo NO DEVUELTO que se cotiza antes de cobrarse
// (2026-10-15, pedido de Solangel, decisión de Alberto).
//
// LO QUE PROTEGE
//   D — La cotización que arma el sistema es de TALLER (origen 'orden'), lleva
//       `cobro_equipo_id` y NO `gestion_id`, su renglón cobra monto × cantidad
//       y su introducción dice que el equipo no se devolvió. Sin monto no se
//       arma. El daño (lib/reposicionDano) sigue intacto.
//   C — El circuito: onCotizacionEstadoChange entra aunque no haya orden,
//       avisa al renglón al aceptarse y al rechazarse, y no toca materiales;
//       la fila de facturación dice que es un no devuelto; la factura cierra
//       el renglón (onCotizacionFacturada).
//   P — Permisos y pantalla: la jefa de taller solo puede escribir
//       `cotizacion_pedida` en el renglón (rules), ve la bandeja en su rail y
//       el botón "Cotizar la reposición" existe en la bandeja.
//
// Corre con `npm test` (node --test). Sin red ni navegador.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("module");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

// Las libs sin Firebase: solo se prueban sus funciones puras.
const origLoad = Module._load;
Module._load = function (req, parent) {
  if (req === "./admin" && parent && /reposicionDano|reposicionNoDevuelto|cobrosEquipos/.test(parent.filename)) {
    return { admin: { firestore: { FieldValue: {}, Timestamp: {} } }, db: {} };
  }
  if (req === "./inventario" && parent && /reposicionDano/.test(parent.filename)) {
    return { APP_BASE_URL: "https://app.test" };
  }
  return origLoad.apply(this, arguments);
};
const RD = require("../src/lib/reposicionDano");
const RN = require("../src/lib/reposicionNoDevuelto");
Module._load = origLoad;

const ROW = {
  cliente_id: "cliGamboa", cliente_nombre: "GAMBOA, S.A.", orden_devolucion_id: "2026101501",
  serial: "B6810431", serial_norm: "B6810431", pool_doc_id: "B6810431",
  modelo_id: "nx420", modelo_label: "NX-420", cantidad: 1,
  motivo_codigo: "perdido", motivo_detalle: "No apareció al cierre del contrato",
  monto_catalogo_unit: 285, monto_unit: 285, monto_total: 285, etapa: "pendiente",
};
const FIRMANTE = { uid: "uJefa", nombre: "Solangel Hosang", email: "solangel@cecomunica.com", cargo: "Jefa de Taller" };

// ── D ─────────────────────────────────────────────────────────────────────
test("D · el monto: unidad × cantidad; con serial siempre 1; sin monto, null", () => {
  assert.deepEqual(RN.montoNoDevuelto(ROW), { unit: 285, qty: 1, total: 285 });
  assert.deepEqual(RN.montoNoDevuelto({ ...ROW, serial: "", serial_norm: null, cantidad: 4, monto_unit: 100 }),
    { unit: 100, qty: 4, total: 400 }, "los 4 radios de un contrato de papel");
  assert.equal(RN.montoNoDevuelto({ ...ROW, monto_unit: 0 }), null, "sin monto no se inventa uno");
  assert.throws(() => RN.docCotizacionNoDevuelto({ rowId: "r1", row: { ...ROW, monto_unit: 0 }, firmante: FIRMANTE, cotizacionId: "COT-2026-0200", fechaIso: "2026-10-15" }), /monto/);
});

test("D · la cotización es de taller, del renglón (no de una gestión) y dice que no se devolvió", () => {
  const doc = RN.docCotizacionNoDevuelto({
    rowId: "r1", row: ROW, cliente: { email: "compras@gamboa.com", representante: "Ana Pérez" },
    firmante: FIRMANTE, cotizacionId: "COT-2026-0200", fechaIso: "2026-10-15", validezDias: 15,
  });
  assert.equal(doc.origen, "orden");
  assert.equal(doc.orden_id, "2026101501", "la devolución es la orden de referencia");
  assert.equal(doc.cobro_equipo_id, "r1");
  assert.equal(doc.gestion_id, "", "no es una gestión de reemplazo");
  assert.equal(doc.generada_por, "sistema:no_devuelto");
  assert.equal(doc.estado, "borrador");
  assert.equal(doc.ejecutivo_cargo, "Jefa de Taller");
  assert.equal(doc.creado_por_uid, "uJefa", "la jefa de taller es la dueña: la envía ella");
  assert.equal(doc.dirigido_email, "compras@gamboa.com");
  assert.match(doc.intro, /no devuelto al cierre/);
  assert.match(doc.intro, /B6810431/);
  assert.doesNotMatch(doc.intro, /daño físico/, "no es la introducción del daño");
  assert.equal(doc.items.length, 1);
  assert.equal(doc.items[0].cant, 1);
  assert.equal(doc.items[0].precio, 285);
  assert.match(doc.items[0].nombre, /no devuelto/);
  assert.match(doc.items[0].spec, /Serie B6810431/);
  assert.equal(doc.subtotal, 285);
  assert.equal(doc.total, 304.95, "285 + 7 % ITBMS");
});

test("D · varios equipos sin serial: un renglón con la cantidad, total = unidad × cantidad", () => {
  const row = { ...ROW, serial: "", serial_norm: null, pool_doc_id: null, cantidad: 4, monto_unit: 100, monto_total: 400 };
  const doc = RN.docCotizacionNoDevuelto({ rowId: "r2", row, firmante: FIRMANTE, cotizacionId: "COT-2026-0201", fechaIso: "2026-10-15" });
  assert.equal(doc.items[0].cant, 4);
  assert.equal(doc.items[0].precio, 100);
  assert.equal(doc.subtotal, 400);
  assert.match(doc.intro, /4 × NX-420/);
});

test("D · el daño no cambia: docCotizacionReposicion sin overrides es el de siempre", () => {
  const g = {
    cliente_id: "cliGamboa", cliente_nombre: "GAMBOA, S.A.", origen: { orden_id: "2026092502", diagnostico: "Entró con agua" },
    dano: { tipo: "liquido" }, items: [{ serial_saliente: "B6810431", modelo: "NX-420", modelo_codigo: "nx420" }],
    cobro: { requiere: true, monto: 285 },
  };
  const doc = RD.docCotizacionReposicion({ gid: "GR1", g, firmante: FIRMANTE, cotizacionId: "COT-2026-0202", fechaIso: "2026-10-15", monto: 285 });
  assert.equal(doc.gestion_id, "GR1");
  assert.equal(doc.cobro_equipo_id, undefined);
  assert.match(doc.intro, /daño físico/);
  assert.match(doc.items[0].spec, /Reposición por daño: Líquido o humedad/);
});

// ── C ─────────────────────────────────────────────────────────────────────
test("C · onCotizacionEstadoChange: entra sin orden si es un no devuelto, avisa al renglón y no toca materiales", () => {
  const src = leer("functions", "src", "triggers", "cotizaciones", "onEstadoChange.js");
  assert.match(src, /\(!after\.orden_id && !after\.cobro_equipo_id\)/, "un renglón de contrato de papel no tiene orden");
  assert.match(src, /reposicionNoDevuelto"\)\.alAceptarse/);
  assert.match(src, /reposicionNoDevuelto"\)\.alRechazarse/);
  assert.match(src, /if \(esReposicion \|\| after\.cobro_equipo_id\) return null;/, "no bloquea materiales de ninguna orden");
  const fc = leer("functions", "src", "lib", "facturacionCotizacion.js");
  assert.match(fc, /const esNoDevuelto = !!cot\.cobro_equipo_id/);
  assert.match(fc, /Equipo no devuelto — reposición aceptada/);
  assert.match(fc, /cobro_equipo_id: cot\.cobro_equipo_id, no_devuelto: true/, "la fila de Brenda lleva el renglón");
  const of = leer("functions", "src", "triggers", "facturacion", "onCotizacionFacturada.js");
  assert.match(of, /reposicionNoDevuelto"\)\.alFacturarse\(c\.cobro_equipo_id/);
  assert.match(of, /alDesfacturarse\(after\.contexto\.cobro_equipo_id/);
  const idx = leer("functions", "index.js");
  assert.match(idx, /exports\.onCobroEquipoWrite\s*=\s*require\("\.\/src\/triggers\/cobros\/onCobroEquipoWrite"\)/);
});

// ── P ─────────────────────────────────────────────────────────────────────
test("P · rules: la jefa de taller solo escribe cotizacion_pedida sobre un renglón abierto", () => {
  const rules = leer("firestore.rules");
  const bloque = rules.slice(rules.indexOf("match /cobros_equipos/{docId}"));
  const fin = bloque.indexOf("allow delete");
  const upd = bloque.slice(0, fin);
  assert.match(upd, /userRole\(\) == "jefe_taller"/);
  assert.match(upd, /resource\.data\.etapa in \["pendiente", "en_cobranza"\]/);
  assert.match(upd, /hasOnly\(\["cotizacion_pedida", "updated_at"\]\)/);
  assert.match(upd, /allow create: if puedeGestionarSeriales\(\);/, "crear sigue siendo de quien gestiona seriales");
});

test("P · pantalla: la bandeja está en el rail de la jefa de taller y trae el botón de cotizar", () => {
  const mod = leer("public", "js", "core", "modulos.js");
  assert.match(mod, /jefe_taller:\s*\["ordenes", "poc", "cotizaciones", "no-devueltos", "firma"\]/);
  assert.match(mod, /id: 'no-devueltos', label: 'Equipos no devueltos'.*href: '\/inventario\/no-devueltos\.html'/);
  for (const rol of ["administrador", "recepcion", "inventario", "vendedor", "tecnico"]) {
    const m = mod.match(new RegExp(`${rol}:\\s*\\[([^\\]]*)\\]`));
    assert.ok(m && !/no-devueltos/.test(m[1]), `${rol} llega por Almacén, no por el rail`);
  }
  const pag = leer("public", "js", "pages", "inventario-no-devueltos.js");
  assert.match(pag, /class="btn btn-secondary btn-sm nd-cotizar"/);
  assert.match(pag, /S\(\)\.puedeCotizarReposicion\(\)/);
  assert.match(pag, /detalle-cotizacion\.html\?id=\$\{encodeURIComponent\(r\.cotizacion_doc_id\)\}/, "el renglón enlaza su cotización");
  assert.match(pag, /window\.userRole === 'jefe_taller'/, "sin pestañas de Almacén para el taller");
  const svc = leer("public", "js", "services", "cobrosEquiposService.js");
  assert.match(svc, /puedeCotizarReposicion\(\)\s*\{[\s\S]*?'jefe_taller'/);
  assert.match(svc, /async pedirCotizacion\(id\)/);
  const pedir = svc.slice(svc.indexOf("async pedirCotizacion(id)"), svc.indexOf("puedeAprobarDescuento()"));
  assert.match(pedir, /cotizacion_pedida: \{ \.\.\.a, at: /);
  assert.doesNotMatch(pedir, /etapa:|cotizacion_doc_id:/, "el navegador no escribe nada más: lo prohíben las rules");
});
