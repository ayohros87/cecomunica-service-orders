// Un reemplazo se APRUEBA, no se avisa (Alberto, 2026-09-10).
//
// Lo que estaba pasando: el wizard del Centro solo frenaba la EXCEPCIÓN —un
// equipo propio del cliente y sin garantía vigente—. Todo lo demás, que es la
// mayoría (alquiler), nacía en 'pendiente_bodega' y el trigger le mandaba el
// correo al estante de una vez. Ventas se enteraba del reemplazo cuando el
// radio ya estaba asignado y la devolución del saliente ya estaba en marcha.
// Un reemplazo saca un radio del inventario y manda a buscar otro: eso se
// decide. El único camino que sí pasaba por administración era la propuesta
// del taller (ordenes-reemplazo.js), que nace aprobándose desde 2026-09-09.
//
// Quien aprueba es ADMINISTRACIÓN, no "ventas" (Alberto 2026-09-10: *"ventas
// no es el vendedor... el correo ventas le llega a los admin de la empresa,
// solo tiene el nombre ventas"*). `ventas@cecomunica.com` es la dirección del
// buzón; los rótulos que ve el usuario dicen administración, porque a un
// vendedor "aprobación de ventas" le suena a que se la aprueba él mismo.
//
// Y al revés: el reemplazo NO lleva firma del cliente. No hay anexo que
// firmar —el contrato no cambia, se sustituye una unidad por otra—, así que
// el checklist no debe pedirla ni el menú ofrecerla. Eso ya era así; el test
// lo congela para que la aprobación nueva no arrastre la firma con ella.
//
// Guardias:
//   R1 — el reemplazo lleva paso de aprobación y NO lleva paso de firma.
//   R2 — un reemplazo viejo (nacido sin aprobación) no estrena un paso
//        pendiente para siempre en su checklist.
//   R3 — aprobado antes de que existiera `cierre.aprobacion`, el paso se da
//        por dado: el estado es la prueba.
//   R4 — en pendiente_aprobacion el menú ofrece Aprobar y nunca firma.
//   R5 — el aviso del expediente distingue excepción de reemplazo normal.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function montar(rol = "administrador", uid = "adm") {
  const ctx = {
    window: {}, console, JSON, Date, Math, Number, String, Array, Object, Set, Map, RegExp,
    setTimeout, encodeURIComponent, isNaN, parseFloat, parseInt,
    document: { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {} },
    Toast: { show() {} }, Modal: {},
    ROLES: { ADMIN: "administrador", GERENTE: "gerente", VENDEDOR: "vendedor", RECEPCION: "recepcion", INVENTARIO: "inventario" },
    firebase: { auth: () => ({ currentUser: { uid, email: "x@c.com" } }) },
  };
  vm.createContext(ctx);
  for (const f of [["core", "formatting.js"], ["domain", "totales.js"], ["domain", "contratoTarifario.js"],
    ["domain", "contratoAnulacion.js"], ["domain", "contratoEdicion.js"], ["services", "gestionesService.js"]]) {
    vm.runInContext(leer("public", "js", ...f), ctx);
  }
  Object.assign(ctx, { FMT: ctx.window.FMT, ContractTotals: ctx.window.ContractTotals,
    ContratoTarifario: ctx.window.ContratoTarifario, ContratoAnulacion: ctx.window.ContratoAnulacion,
    ContratoEdicion: ctx.window.ContratoEdicion, GestionesService: ctx.window.GestionesService });
  vm.runInContext(leer("public", "js", "pages", "clientes-centro.js"), ctx);
  const C = ctx.window.Centro;
  C.rol = rol; C.uid = uid;
  C.cliente = { id: "cli1", nombre: "CLIENTE DE PRUEBA, S.A." };
  C.contratos = []; C.equipos = []; C.gestiones = [];
  return C;
}

const reemplazo = (extra = {}) => ({
  id: "GR20260910-01", tipo: "reemplazo", estado: "pendiente_aprobacion", cliente_id: "cli1",
  responsable_uid: "vend", responsable_email: "vendedor@cecomunica.com",
  aprobacion: { requiere: true, motivo: "reemplazo" },
  items: [{ serial_saliente: "8J4K02245", modelo: "PD606-R", elegibilidad: "alquiler",
    motivo_codigo: "no_enciende" }],
  cierre: {}, ordenes: {}, ...extra,
});

// El Centro vive en un vm con su propio realm: sus arrays no son
// reference-equal con los de aquí, así que se comparan por texto.
const claves = (C, g) => C._defsGestion(g).map(([k]) => k).join(" › ");

test("R1 · el reemplazo lleva aprobación de administración y NO lleva firma del cliente", () => {
  const C = montar();
  const ks = claves(C, reemplazo());
  assert.ok(ks.startsWith("aprobacion"), "la aprobación va delante: es la compuerta antes de bodega");
  assert.ok(!ks.includes("firma"), "un reemplazo no tiene anexo que firmar");
  assert.equal(ks, "aprobacion › asignacion › programacion › entrega › entrada");
});

test("R1b · la propuesta del taller lo dice con sus palabras en el mismo paso", () => {
  const C = montar();
  const taller = reemplazo({ origen: { tipo: "taller", orden_id: "2026091001" } });
  const [, , sub] = C._defsGestion(taller).find(([k]) => k === "aprobacion");
  assert.match(sub, /taller/i);
});

test("R2 · un reemplazo viejo no estrena un paso pendiente para siempre", () => {
  const C = montar();
  // Nacido antes de 2026-09-10: fue derecho a bodega, sin `aprobacion`.
  const viejo = reemplazo({ estado: "en_proceso", aprobacion: undefined,
    cierre: { asignacion: true, programacion: true } });
  delete viejo.aprobacion;
  assert.equal(claves(C, viejo), "asignacion › programacion › entrega › entrada");
});

test("R3 · aprobado antes de que existiera cierre.aprobacion, el estado es la prueba", () => {
  const C = montar();
  const esperando = reemplazo();
  assert.equal(C._pasoDone(esperando, "aprobacion"), false);

  // Aprobada con el código viejo: pasó a bodega sin estampar el flag.
  const aprobadaVieja = reemplazo({ estado: "pendiente_bodega", cierre: {} });
  assert.equal(C._pasoDone(aprobadaVieja, "aprobacion"), true);

  // Anulada = rechazada: eso NO es una aprobación.
  const rechazada = reemplazo({ estado: "anulada", anulada_motivo: "no procede" });
  assert.equal(C._pasoDone(rechazada, "aprobacion"), false);

  // Y el flag, cuando está, manda igual.
  assert.equal(C._pasoDone(reemplazo({ cierre: { aprobacion: true } }), "aprobacion"), true);
});

test("R4 · en pendiente_aprobacion el menú ofrece Aprobar y nunca la firma", () => {
  const C = montar();
  const acc = C._accionesGestion(reemplazo());
  const aprobar = acc.find(a => a.id === "aprobar");
  assert.ok(aprobar, "tiene que ofrecer Aprobar");
  assert.equal(aprobar.ok, true, "administración aprueba");
  assert.ok(!acc.some(a => ["firma", "subir_firmado", "aplicar_sin_firma"].includes(a.id)),
    "un reemplazo no manda nada a firmar");
});

test("R4b · gerencia también aprueba — es lo que dicen las reglas y el motivo en gris", () => {
  const G = montar("gerente", "ger");
  const aprobar = G._accionesGestion(reemplazo()).find(a => a.id === "aprobar");
  assert.equal(aprobar.ok, true, "esAprobacionGestion admite administrador y gerente");

  const V = montar("vendedor", "vend");
  const suyo = V._accionesGestion(reemplazo()).find(a => a.id === "aprobar");
  assert.equal(suyo.ok, false, "el que la pide no se la aprueba");
  assert.match(suyo.motivo, /administración o gerencia/i);
});

test("R5 · el expediente distingue la excepción del reemplazo normal", () => {
  const C = montar();
  const normal = C._detalleGestion(reemplazo());
  assert.match(normal, /aprobación de administración/i);
  assert.ok(!/de ventas/i.test(normal),
    'a un vendedor "aprobación de ventas" le suena a que se la aprueba él mismo');
  assert.ok(!/excepción/i.test(normal), "un reemplazo de alquiler no es una excepción");

  const excepcion = C._detalleGestion(reemplazo({
    aprobacion: { requiere: true, motivo: "propio_excepcion" },
    items: [{ serial_saliente: "8J4K02245", modelo: "PD606-R", elegibilidad: "propio_excepcion" }],
  }));
  assert.match(excepcion, /excepción por servicio al cliente/i);
  assert.match(excepcion, /sin garantía/i);
});

test("R5b · el checklist del reemplazo nunca rotula un paso de firma", () => {
  const C = montar();
  for (const g of [reemplazo(), reemplazo({ estado: "pendiente_bodega" }),
    reemplazo({ estado: "cerrada", cierre: { aprobacion: true, asignacion: true, programacion: true, entrega: true, entrada: true } })]) {
    assert.ok(!/firma/i.test(C._detalleGestion(g)), `sobra la firma en ${g.estado}`);
  }
});
