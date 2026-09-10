// UN menú de acciones por expediente — gestión o contrato (2026-09-09).
//
// El reporte de Alberto sobre M.A.M. PROTECTION: tres gestiones del mismo
// cliente enseñaban tres botoneras distintas. A dos les salía "Editar" y no
// "Anular" (el "Rechazar" del aviso de aprobación se lo comía); a la tercera
// al revés (bodega ya había asignado). Y cada botón vivía en un sitio: el
// aviso amarillo, el cuerpo, el pie, el footer del modal.
//
// Estos guardias congelan la regla nueva:
//   M1 — Editar y Anular están SIEMPRE en la lista; lo que no se puede sale
//        con `ok:false` y un MOTIVO, nunca ausente.
//   M2 — los tres casos reales de M.A.M. dan la misma lista, con distinta
//        razón — que es justo lo que se le va a explicar al usuario.
//   M3 — el contrato tiene la MISMA estructura de lista que la gestión.
//   M4 — el render deshabilita en vez de esconder, y toda fila tiene su "⋯".
//   M5 — ya no quedan botoneras sueltas en el expediente.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
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
  C.cliente = { id: "cli1", nombre: "M.A.M. PROTECTION & SECURITY, S.A." };
  C.contratos = []; C.equipos = []; C.gestiones = [];
  return C;
}

// Los tres expedientes reales de M.A.M. PROTECTION (2026-09-09).
const MAM = {
  // Bodega ya asignó y la OS de programación salió.
  conOS: { id: "GA20260909-01", tipo: "aumento", estado: "pendiente_firma", cliente_id: "cli1",
    responsable_uid: "elvia", cierre: { aprobacion: true, asignacion: true },
    ordenes: { programacion_id: "2026090905", programacion_ids: ["2026090905"] },
    aumento: { contrato_doc_id: "c1", contrato_id: "ALQ-6", lineas: [], seriales_asignados: [{ serial: "22N22A0154" }] } },
  // Recién creadas, nadie las ha tocado.
  nueva1: { id: "GA20260909-04", tipo: "aumento", estado: "pendiente_aprobacion", cliente_id: "cli1",
    responsable_uid: "elvia", cierre: {}, ordenes: {}, aumento: { contrato_doc_id: "c1", lineas: [] } },
  nueva2: { id: "GA20260909-05", tipo: "aumento", estado: "pendiente_aprobacion", cliente_id: "cli1",
    responsable_uid: "elvia", cierre: {}, ordenes: {}, aumento: { contrato_doc_id: "c1", lineas: [] } },
};
const porId = (acc) => Object.fromEntries(acc.map(a => [a.id, a]));

test("M1 · Editar y Anular están SIEMPRE, con motivo cuando no se puede", () => {
  const C = montar();
  const casos = [MAM.conOS, MAM.nueva1, MAM.nueva2,
    { ...MAM.nueva1, estado: "cerrada" }, { ...MAM.nueva1, estado: "anulada" },
    { ...MAM.nueva1, tipo: "baja", items: [] }, { ...MAM.nueva1, tipo: "demo", demo: { lineas: [] } },
    { ...MAM.nueva1, tipo: "reemplazo", items: [{ serial_saliente: "A1" }] }];
  for (const g of casos) {
    const a = porId(C._accionesGestion(g));
    assert.ok(a.editar, `${g.id}/${g.estado}: falta Editar`);
    assert.ok(a.anular, `${g.id}/${g.estado}: falta Anular`);
    assert.equal(a.editar.grupo, "Corregir");
    assert.equal(a.anular.grupo, "Corregir");
    // Lo que no se puede TIENE que decir por qué.
    for (const x of [a.editar, a.anular]) {
      if (!x.ok) assert.ok(x.motivo && x.motivo.length > 8, `${g.id}: "${x.label}" deshabilitada sin motivo`);
    }
  }
});

test("M2 · los tres expedientes de M.A.M. dan la misma lista, con distinta razón", () => {
  const C = montar();   // administrador, como Alberto

  // La que ya tiene OS: no se edita (bodega asignó) pero SÍ se anula.
  const a1 = porId(C._accionesGestion(MAM.conOS));
  assert.equal(a1.editar.ok, false);
  assert.match(a1.editar.motivo, /asignó los seriales|orden de programación/i);
  assert.equal(a1.anular.ok, true, "administración anula aunque bodega haya asignado");
  assert.ok(a1.asignar === undefined, "con la OS afuera ya no se ofrece asignar");

  // Las dos recién creadas: se editan Y se anulan — antes "Anular" no salía
  // porque el aviso de aprobación mostraba "Rechazar" y el pie se callaba.
  for (const g of [MAM.nueva1, MAM.nueva2]) {
    const a = porId(C._accionesGestion(g));
    assert.equal(a.editar.ok, true, `${g.id} debería poder editarse`);
    assert.equal(a.anular.ok, true, `${g.id} debería poder anularse`);
    assert.match(a.anular.hint, /rechazar/i, "en aprobación, anular ES el rechazo — hay que decirlo");
    assert.equal(a.aprobar.ok, true);
  }

  // Un vendedor ve la misma lista: aprobar en gris con su motivo.
  const V = montar("vendedor", "elvia");
  const av = porId(V._accionesGestion(MAM.nueva1));
  assert.equal(av.aprobar.ok, false);
  assert.match(av.aprobar.motivo, /administración o gerencia/i);
  assert.equal(av.editar.ok, true);
  assert.equal(av.anular.ok, true, "quien la creó puede anular la suya mientras siga blanda");
  // Y el vendedor que NO la creó, no.
  const O = montar("vendedor", "otro");
  assert.equal(porId(O._accionesGestion(MAM.nueva1)).anular.ok, false);
});

test("M3 · el contrato usa la misma lista, con los mismos grupos", () => {
  const C = montar();
  const casos = [
    { id: "c1", contrato_id: "ALQ20260601-06", estado: "activo", firmado: true },
    { id: "c2", contrato_id: "REEMP20260714-01", estado: "aprobado", firmado: false },
    { id: "c3", contrato_id: "REEMP20260127-01", estado: "pendiente_aprobacion" },
    { id: "c4", contrato_id: "ALQ20260601-05", estado: "anulado" },
  ];
  for (const c of casos) {
    const a = porId(C._accionesContrato(c));
    assert.ok(a.ver && a.editar && a.anular, `${c.contrato_id}: falta ver/editar/anular`);
    assert.equal(a.editar.grupo, "Corregir");
    assert.equal(a.anular.grupo, "Corregir");
    for (const x of [a.editar, a.anular]) {
      if (!x.ok) assert.ok(x.motivo && x.motivo.length > 8, `${c.contrato_id}: "${x.label}" sin motivo`);
    }
  }
  // Un contrato activo no se edita, y se dice por qué; uno anulado ni se anula.
  assert.match(porId(C._accionesContrato(casos[0])).editar.motivo, /activo ya no se edita/i);
  assert.equal(porId(C._accionesContrato(casos[3])).anular.ok, false);
  // Con enlace de firma vivo: no se edita, pero aparece "retirar".
  const conEnlace = { id: "c5", contrato_id: "X", estado: "aprobado", firmado: false,
    firma_solicitud_estado: "pendiente", firma_solicitud_id: "s1" };
  const a5 = porId(C._accionesContrato(conEnlace));
  assert.equal(a5.editar.ok, false);
  assert.match(a5.editar.motivo, /enlace de firma/i);
  assert.equal(a5.retirar_firma.ok, true);
});

test("M4 · el render deshabilita con el motivo y toda fila lleva su ⋯", () => {
  const C = montar();
  const html = C._menuAccionesHtml(C._accionesGestion(MAM.conOS));
  assert.match(html, /<div class="hd">Corregir<\/div>/);
  assert.match(html, /disabled aria-disabled="true"/, "lo que no se puede va deshabilitado, no escondido");
  assert.match(html, /Editar…/);
  assert.match(html, /Anular gestión…/);
  // El motivo viaja como pista visible.
  assert.match(html, /cg-menu-hint">[^<]*(asignó|programación)/i);

  const fila = C._masFila("GA20260909-01", C._accionesGestion(MAM.conOS), "GA20260909-01");
  assert.match(fila, /class="cg-masbtn"/);
  assert.match(fila, /id="accm-GA20260909-01"/);
  assert.match(fila, /Centro\.toggleAcciones\('GA20260909-01', event\)/);

  // El pie del detalle abre EL MISMO menú (otra id, misma lista).
  const pie = C._pieAcciones("dg-GA20260909-04", C._accionesGestion(MAM.nueva1));
  assert.match(pie, /Acciones ⋯/);
  assert.match(pie, /id="accm-dg-GA20260909-04"/);
  assert.match(pie, /Aprobar/, "el siguiente paso queda a un clic, sacado de la misma lista");
});

test("M5 · el expediente ya no pinta botoneras sueltas por estado", () => {
  const src = leer("public", "js", "pages", "clientes-centro.js");
  const det = src.slice(src.indexOf("_detalleGestion(g) {"), src.indexOf("/* ── Acciones sobre el expediente ── */"));
  for (const suelto of [
    ">Rechazar</button>", ">Aprobar</button>", "Imprimir anexo</a>", ">Subir firmado",
    ">Subir carta", "Retirar enlace de firma…</button>", "Anular gestión…</button>", ">Editar…</button>",
  ]) {
    assert.ok(!det.includes(suelto), `_detalleGestion todavía pinta "${suelto}" fuera del menú`);
  }
  assert.ok(det.includes("_pieAcciones("), "_detalleGestion debe cerrar con el menú único");
  // Y los helpers de la botonera vieja del contrato ya no existen.
  for (const muerto of ["_btnEditarContrato", "_btnsFirmadoContrato", "_linkAsignar("]) {
    assert.ok(!src.includes(muerto + " {") && !src.includes("this." + muerto),
      `quedó código muerto: ${muerto}`);
  }
});
