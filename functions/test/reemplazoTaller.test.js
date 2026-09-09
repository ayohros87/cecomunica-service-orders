// El taller PROPONE el reemplazo de un radio (2026-09-09). UNO POR UNO.
//
// Hasta hoy el reemplazo solo se pedía desde el Centro de gestión, al que el
// técnico no entra: quien ve el radio dañado tenía que contárselo a alguien
// para que ese alguien abriera la solicitud. Ahora la abre él desde la fila de
// ESE radio y la aprueba ventas@cecomunica.com.
//
// POR SERIAL, NO POR ORDEN (Alberto): el técnico diagnostica radio por radio y
// cada propuesta es su propio expediente, para que ventas apruebe uno y
// rechace otro sin arrastrar a los demás. Es lo que fijan P1 e I1, y lo que
// rules exige con items.size() == 1.
//
// Lo que este test congela:
//
//   S1 — La SITUACIÓN de la unidad, que es lo que decide si se puede proponer.
//        La diferencia deliberada con el Centro (Centro._eleg) es que aquí el
//        radio está en el mostrador: `en_taller` / `devuelto_revision` NO
//        descalifican. Sí bloquean: sin ficha en el pool, dado de baja,
//        comprado fuera de CECOMUNICA y —sobre todo— la unidad que en el pool
//        figura con OTRO cliente (un dígito mal tecleado abriría una gestión
//        contra la cuenta equivocada).
//
//   S2 — La GARANTÍA tiene una sola definición (domain/garantiaEquipo.js):
//        la fecha declarada manda; sin ella se deriva de la factura (12 meses,
//        cláusula 8) pero se marca ESTIMADA y sigue exigiendo aprobación. Es
//        el punto donde las dos pantallas podrían divergir.
//
//   I1 — El ÍTEM que se manda tiene el mismo contrato de datos que los del
//        Centro (bodega y los triggers no deben distinguir de dónde salió la
//        propuesta), hereda el contrato de la ficha y pide el MISMO modelo.
//
//   P1 — Quién puede proponer, sobre qué radio, y que la marca de "ya
//        propuesto" sea POR SERIAL (el radio de al lado sigue libre).
//
//   C1 — Los cables que hacen que exista: botón en la FILA DEL RADIO (escritorio
//        y móvil), handler del evento, permiso en firestore.rules y el trato
//        del saliente que ya está en casa (no se abre una devolución para ir a
//        buscar un radio que está en el mostrador).
//
// Corre con `npm test` (node --test). Sin red ni navegador.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function montar() {
  const ctx = { console, window: {}, document: { getElementById: () => null } };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "core", "serial.js"), ctx);
  vm.runInContext(leer("public", "js", "domain", "garantiaEquipo.js"), ctx);
  vm.runInContext(leer("public", "js", "pages", "ordenes-reemplazo.js"), ctx);
  return ctx.window;
}

const HOY = new Date("2026-09-09T12:00:00-05:00");
const ts = (iso) => ({ toDate: () => new Date(iso) });

// Unidad de alquiler que está EN EL TALLER — el caso de todos los días.
const alquilerEnTaller = {
  id: "B3400055", serial_norm: "B3400055", modelo_label: "NX-420-R", modelo_id: "nx420r",
  estado: "en_taller", propiedad: "cecomunica",
  asignacion: { cliente_id: "cli1", cliente_nombre: "GAMBOA", contrato_doc_id: "c1", contrato_id: "ALQ20250925-03" },
};

test("S1 · un radio de alquiler EN TALLER se puede proponer (la diferencia con el Centro)", () => {
  const W = montar();
  const s = W.OrdenesReemplazo.situacion(alquilerEnTaller, { clienteId: "cli1", hoy: HOY });
  assert.equal(s.ok, true);
  assert.equal(s.code, "alquiler");
});

test("S1 · sin ficha, dado de baja, comprado fuera o de otro cliente: bloqueado", () => {
  const W = montar();
  const sit = (f, o) => W.OrdenesReemplazo.situacion(f, { clienteId: "cli1", hoy: HOY, ...o });

  assert.equal(sit(null).ok, false, "sin ficha en el pool");
  assert.equal(sit(null).code, "sin_ficha");

  assert.equal(sit({ ...alquilerEnTaller, estado: "baja" }).ok, false, "ya de baja");

  assert.equal(sit({ ...alquilerEnTaller, propiedad: "cliente", venta: null }).ok, false,
    "propio comprado fuera de CECOMUNICA");

  const ajeno = { ...alquilerEnTaller, asignacion: { ...alquilerEnTaller.asignacion, cliente_id: "cli2", cliente_nombre: "OTRO" } };
  const s = sit(ajeno);
  assert.equal(s.ok, false, "la unidad figura con otro cliente");
  assert.equal(s.code, "otro_cliente");
  assert.match(s.why, /OTRO/, "el aviso nombra al cliente que sí la tiene");
});

test("S2 · garantía DECLARADA vigente: no hay excepción que aprobar", () => {
  const W = montar();
  const propio = {
    ...alquilerEnTaller, propiedad: "cliente",
    venta: { factura: "1234", at: ts("2026-03-01"), garantia_vence: ts("2027-03-01") },
  };
  const s = W.OrdenesReemplazo.situacion(propio, { clienteId: "cli1", hoy: HOY });
  assert.equal(s.code, "propio_garantia");
  assert.match(s.label, /garantía hasta/);
  assert.doesNotMatch(s.label, /estimada/, "la declarada no se anuncia como estimada");
});

test("S2 · sin fecha declarada la garantía se deriva de la factura, pero queda ESTIMADA", () => {
  const W = montar();
  const G = W.GarantiaEquipo;
  const reciente = { propiedad: "cliente", venta: { factura: "9", at: ts("2026-06-01") } };
  const g = G.garantia(reciente, { hoy: HOY });
  assert.equal(g.vigente, true, "3 meses de facturado: dentro de los 12 de la cláusula 8");
  assert.equal(g.derivada, true);
  assert.equal(g.fuente, "factura");
  assert.match(G.textoGarantia(g), /estimada/);
  // Conservador a propósito: la estimada NO le quita la aprobación a nadie.
  assert.equal(G.requiereExcepcion(g), true);

  const s = W.OrdenesReemplazo.situacion({ ...alquilerEnTaller, ...reciente }, { clienteId: "cli1", hoy: HOY });
  assert.equal(s.ok, true);
  assert.equal(s.code, "propio_excepcion");
  assert.match(s.label, /estimada/);

  const viejo = { propiedad: "cliente", venta: { factura: "9", at: ts("2024-01-15") } };
  const gv = G.garantia(viejo, { hoy: HOY });
  assert.equal(gv.vigente, false);
  assert.match(G.textoGarantia(gv), /vencida/);
});

test("S2 · el alquiler no tiene garantía que discutir", () => {
  const W = montar();
  const g = W.GarantiaEquipo.garantia(alquilerEnTaller, { hoy: HOY });
  assert.equal(g.aplica, false);
  assert.equal(W.GarantiaEquipo.textoGarantia(g), "");
});

test("I1 · el ítem hereda contrato, pide el MISMO modelo y lleva el diagnóstico", () => {
  const W = montar();
  const equipo = { id: "e1", numero_de_serie: " B3400055 ", modelo: "NX-420" };
  const sit = W.OrdenesReemplazo.situacion(alquilerEnTaller, { clienteId: "cli1", hoy: HOY });
  const it = W.OrdenesReemplazo.construirItem(equipo, alquilerEnTaller, sit, {
    motivo: "garantia_fabrica", diagnostico: "No enciende; placa quemada.", salienteEnCasa: true,
  });

  assert.equal(it.serial_saliente, "B3400055", "el serial va limpio");
  assert.equal(it.pool_doc_id_saliente, "B3400055");
  assert.equal(it.contrato_doc_id, "c1", "hereda el contrato de la ficha del pool");
  assert.equal(it.contrato_id, "ALQ20250925-03");
  assert.equal(it.modelo_solicitado, "NX-420-R", "se repone el mismo modelo: el técnico no elige catálogo");
  assert.equal(it.modelo_solicitado_id, "nx420r");
  assert.equal(it.elegibilidad, "alquiler");
  assert.equal(it.motivo_codigo, "garantia_fabrica");
  assert.equal(it.motivo_detalle, "No enciende; placa quemada.");
  assert.equal(it.saliente_en_casa, true);
  // El contrato de datos que bodega y los triggers ya consumen:
  assert.equal(it.serial_nuevo, null);
  assert.equal(it.pool_doc_id_nuevo, null);
});

test("I1 · de un propio viaja la garantía que vio el taller (para que ventas decida con dato)", () => {
  const W = montar();
  const ficha = { ...alquilerEnTaller, propiedad: "cliente", venta: { factura: "9", at: ts("2026-06-01") } };
  const sit = W.OrdenesReemplazo.situacion(ficha, { clienteId: "cli1", hoy: HOY });
  const it = W.OrdenesReemplazo.construirItem(
    { numero_de_serie: "B3400055", modelo: "NX-420" }, ficha, sit,
    { motivo: "otro", diagnostico: "x", salienteEnCasa: false });
  assert.equal(it.elegibilidad, "propio_excepcion");
  assert.equal(it.garantia.vigente, true);
  assert.equal(it.garantia.derivada, true);
  assert.equal(typeof it.garantia.vence, "string", "la fecha viaja serializada");
  assert.equal(it.saliente_en_casa, false);
});

test("P1 · se propone POR RADIO: quién, sobre cuál y desde qué orden", () => {
  const W = montar();
  const P = W.OrdenesReemplazo.puedeProponer;
  const orden = { cliente_id: "cli1", estado_reparacion: "ASIGNADO" };
  const eq = { id: "e1", numero_de_serie: "B3400055" };
  for (const rol of ["tecnico", "tecnico_operativo", "jefe_taller", "administrador"]) {
    assert.equal(P(orden, eq, rol), true, `${rol} propone`);
  }
  for (const rol of ["recepcion", "vendedor", "vista", "inventario", ""]) {
    assert.equal(P(orden, eq, rol), false, `${rol} no propone desde la orden`);
  }
  assert.equal(P({ ...orden, cliente_id: "" }, eq, "tecnico"), false, "sin cliente no hay gestión posible");
  assert.equal(P({ ...orden, estado_reparacion: "CERRADA (ENTRADA)" }, eq, "tecnico"), false, "orden cerrada");
  assert.equal(P({ ...orden, estado_reparacion: "ENTREGADO AL CLIENTE" }, eq, "tecnico"), false, "orden entregada");
  assert.equal(P(orden, { id: "e1" }, "tecnico"), false, "sin serial no hay radio que reemplazar");
  assert.equal(P(orden, { id: "e1", numero_de_serie: "B34", eliminado: true }, "tecnico"), false,
    "un equipo eliminado no cuenta");
});

test("P1 · la marca de 'ya propuesto' es POR SERIAL, no de la orden entera", () => {
  const W = montar();
  const D = W.OrdenesReemplazo.propuestaDe;
  const orden = { reemplazos_propuestos: { B3400055: { gestion_id: "GR20260909-01", por_email: "t@c.com" } } };
  assert.equal(D(orden, "b3 4000-55").gestion_id, "GR20260909-01", "la identidad del serial es tolerante");
  assert.equal(D(orden, "B3400099"), null, "el radio de al lado sigue libre");
  assert.equal(D({}, "B3400055"), null);
  // Formato viejo (las primeras horas del 2026-09-09, cuando la propuesta era
  // de la orden entera): se sigue leyendo para no perder las ya creadas.
  const legacy = { reemplazo_propuesto: { gestion_id: "GR20260909-02", seriales: ["B3400099"] } };
  assert.equal(D(legacy, "B3400099").gestion_id, "GR20260909-02");
  assert.equal(D(legacy, "B3400055"), null);
});

test("C1 · la acción vive en la FILA DEL RADIO y está cableada de punta a punta", () => {
  const render = leer("public", "js", "pages", "ordenes-render.js");
  assert.match(render, /function botonProponerReemplazo\(ordenId, ordenData, equipo\)/);
  assert.match(render, /data-action="proponer-reemplazo"[\s\S]{0,220}data-equipo-id=/,
    "el botón lleva el radio, no solo la orden");
  assert.match(render, /<td class="col-acciones">\s*\$\{botonProponerReemplazo\(/,
    "y se pinta en la fila del equipo");
  assert.match(render, /ROLES\.TECNICO,\s*ROLES\.TECNICO_OPERATIVO,\s*ROLES\.JEFE_TALLER/,
    "se le ofrece al taller");
  // Ya NO cuelga del ⋯ de la orden: ahí volvía a ser una decisión por orden.
  const menu = render.slice(render.indexOf("function botonesGestion("),
    render.indexOf("window.botonesGestion = botonesGestion"));
  assert.ok(menu.length > 500, "se localizó el menú ⋯");
  assert.doesNotMatch(menu, /proponer-reemplazo/, "el ⋯ de la orden ya no la ofrece");

  const equipos = leer("public", "js", "pages", "ordenes-equipos.js");
  assert.match(equipos, /botonProponerReemplazo\(ordenId, o, e\)/, "también en la tarjeta de móvil");

  const events = leer("public", "js", "pages", "ordenes-events.js");
  assert.match(events, /'proponer-reemplazo':/, "el handler existe");
  assert.match(events, /abrirProponerReemplazo\(ordenId, equipoId\)/, "y le pasa el radio");
  assert.match(events, /CargaDiferida\.reemplazo\(\)/, "el módulo se carga diferido");

  const carga = leer("public", "js", "core", "carga-diferida.js");
  assert.match(carga, /reemplazo\(\)/);
  assert.match(carga, /gestionesService\.js/, "arrastra el servicio de gestiones, que /ordenes/ no carga");
  assert.match(carga, /garantiaEquipo\.js/);
});

test("C1 · rules: el taller solo puede PROPONER, nunca darse curso", () => {
  const rules = leer("firestore.rules");
  const i = rules.indexOf("function esPropuestaTaller()");
  assert.notEqual(i, -1, "existe el permiso de propuesta del taller");
  const bloque = rules.slice(i, i + 700);
  assert.match(bloque, /tipo == "reemplazo"/, "solo reemplazo");
  assert.match(bloque, /estado == "pendiente_aprobacion"/, "siempre nace esperando aprobación");
  assert.match(bloque, /items\.size\(\) == 1/, "un serial por propuesta");
  assert.match(bloque, /"origen", \{\}\)\.get\("tipo", ""\) == "taller"/);
  assert.match(bloque, /responsable_uid == request\.auth\.uid/, "a nombre de quien la abre");

  // Aprobar sigue siendo de administración/gerencia: el técnico no está.
  const j = rules.indexOf("function esAprobacionGestion()");
  const aprob = rules.slice(j, j + 300);
  assert.match(aprob, /\["administrador","gerente"\]/);
  assert.doesNotMatch(aprob, /tecnico/);
});

test("C1 · el radio que YA está en el mostrador no genera orden de devolución", () => {
  const trg = leer("functions", "src", "triggers", "gestiones", "onOrdenWriteGestion.js");
  assert.match(trg, /\.filter\(it => !it\.saliente_en_casa\)/,
    "los salientes que ya están en casa no se mandan a recuperar");
  assert.match(trg, /const todosEnCasa =/);
  assert.match(trg, /entrada: true/, "y el paso de entrada queda cumplido");
  assert.match(trg, /if \(!it\.saliente_en_casa\) \{/,
    "tampoco se les pone pendiente_devolucion: sería una deuda falsa en el cron");
});

test("C1 · el correo de aprobación va a ventas con el vendedor y el técnico en copia", () => {
  const trg = leer("functions", "src", "triggers", "gestiones", "onGestionWrite.js");
  assert.match(trg, /async function correoPropuestaTaller/);
  assert.match(trg, /to: await G\.aprobacionesTo\(\)[\s\S]{0,80}cc: await ccTaller\(g\)/,
    "a ventas@cecomunica.com, con copia");
  const i = trg.indexOf("async function ccTaller");
  const cc = trg.slice(i, i + 600);
  assert.match(cc, /vendedorEmailDeCliente/, "el vendedor del cliente queda informado");
  assert.match(cc, /tecnico_email/, "y el técnico que propuso");
  assert.match(trg, /subject: `Aprobación requerida: reemplazo del radio \$\{serial\}/,
    "el asunto nombra el radio — es lo que ventas necesita para decidir");
  assert.match(trg, /async function correoRechazoTaller/, "y el rechazo se le avisa al taller");
});
