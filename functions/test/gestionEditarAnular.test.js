// Corregir y anular una gestión desde el Centro (2026-09-09, pedido de
// Alberto: "en las gestiones dentro del centro de gestión hace falta la
// opción de editar y de anular").
//
// Hasta ahora, un dedo mal puesto al crear la gestión solo se arreglaba
// anulando y volviendo a crearla — y anular solo lo podía administración,
// nunca el vendedor que se equivocó. Estos guardias congelan la ventana en la
// que se puede tocar el expediente y lo que sale escrito al guardar:
//   E1 — puedeEditarse: la gestión es blanda hasta que alguien actúa
//        (derivación, asignación, OS, firma, entrega).
//   E2 — puedeAnularse: admin/gerencia siempre; quien la creó, solo mientras
//        siga blanda; nadie después de entregar.
//   E3 — la corrección de una BAJA reescribe items, motivo, fechas,
//        penalidad y contratos_afectados (y respeta los seriales desmarcados).
//   E4 — la corrección de un AUMENTO recalcula los totales y nunca toca el
//        estado ni los seriales de bodega.
//
// Corre con `npm test` (node --test). No necesita navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

function cargarServicio() {
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "gestionesService.js"), ctx);
  return ctx.window.GestionesService;
}

// Nodo del DOM falso: lo mínimo que leen los lectores de formulario.
function el(extra = {}) {
  return { style: {}, dataset: {}, value: "", checked: false, innerHTML: "",
    selectedOptions: [], focus() {}, querySelector: () => null, querySelectorAll: () => [], ...extra };
}

// Monta clientes-centro.js sobre un DOM falso y captura lo que le manda a
// GestionesService.editar.
function montarCentro({ nodos = {}, selectores = {}, gestiones = [], contratos = [] } = {}) {
  const escrito = {};
  const ctx = {
    window: {}, console, JSON, Date, Math, Number, String, Array, Object, Set, Map, RegExp,
    setTimeout, encodeURIComponent, isNaN, parseFloat, parseInt,
    document: {
      getElementById: (id) => nodos[id] || null,
      querySelector: (sel) => (selectores[sel] || [])[0] || null,
      querySelectorAll: (sel) => selectores[sel] || [],
      addEventListener() {}, removeEventListener() {},
    },
    Toast: { show(msg, t) { escrito.toast = { msg, t }; } },
    Modal: { async prompt() { return "motivo"; } },
    ROLES: { ADMIN: "administrador", GERENTE: "gerente", VENDEDOR: "vendedor", RECEPCION: "recepcion", INVENTARIO: "inventario" },
    firebase: { auth: () => ({ currentUser: { uid: "u1", email: "v@c.com" } }) },
  };
  vm.createContext(ctx);
  for (const f of [["core", "formatting.js"], ["domain", "totales.js"], ["domain", "contratoTarifario.js"]]) {
    vm.runInContext(leer("public", "js", ...f), ctx);
  }
  Object.assign(ctx, { FMT: ctx.window.FMT, ContractTotals: ctx.window.ContractTotals, ContratoTarifario: ctx.window.ContratoTarifario });
  vm.runInContext(leer("public", "js", "services", "gestionesService.js"), ctx);
  ctx.GestionesService = ctx.window.GestionesService;
  // La escritura real la cubren las reglas (test-emulator/rules.js); aquí
  // interesa el PARCHE que arma la página.
  ctx.GestionesService.editar = async (gid, cambios, resumen) => { escrito.gid = gid; escrito.cambios = cambios; escrito.resumen = resumen; };
  vm.runInContext(leer("public", "js", "pages", "clientes-centro.js"), ctx);
  const Centro = ctx.window.Centro;
  Centro.rol = "vendedor";
  Centro.gestiones = gestiones;
  Centro.contratos = contratos;
  Centro.cliente = { id: "cli1", nombre: "ACME" };
  Centro.modelos = [{ id: "m1", label: "NX-410" }, { id: "m2", label: "TK-3000" }];
  Centro._cerrarModal = () => {};
  Centro.recargarGestiones = async () => {};
  return { Centro, escrito };
}

const blanda = {
  id: "GA20260909-01", tipo: "aumento", estado: "pendiente_aprobacion",
  responsable_uid: "u1", cierre: {}, ordenes: {}, aumento: { contrato_doc_id: "c1", lineas: [] },
};

test("E1 · puedeEditarse: la gestión es blanda hasta que alguien actúa", () => {
  const G = cargarServicio();
  assert.equal(G.puedeEditarse(blanda).ok, true);
  assert.equal(G.puedeEditarse({ ...blanda, estado: "pendiente_firma" }).ok, true);
  assert.equal(G.puedeEditarse({ ...blanda, estado: "pendiente_bodega" }).ok, true);

  const no = (g) => { const r = G.puedeEditarse(g); assert.equal(r.ok, false); assert.ok(r.motivo, "sin motivo que mostrar"); return r; };
  no({ ...blanda, estado: "cerrada" });
  no({ ...blanda, estado: "anulada" });
  no({ ...blanda, estado: "en_proceso" });
  no({ ...blanda, cierre: { derivacion: true } });
  no({ ...blanda, cierre: { asignacion: true } });
  no({ ...blanda, ordenes: { programacion_id: "OS-1" } });
  no({ ...blanda, cierre: { entrega: true } });
  no({ ...blanda, aumento: { seriales_asignados: [{ serial: "A1" }] } });
  no({ ...blanda, tipo: "demo", demo: { seriales_asignados: [{ serial: "A1" }] } });
  no({ ...blanda, tipo: "reemplazo", items: [{ serial_saliente: "A1", serial_nuevo: "B2" }] });
  // La firma digital en la calle: primero se retira el enlace.
  no({ ...blanda, estado: "pendiente_firma", firma_solicitud_estado: "pendiente" });
  no({ ...blanda, estado: "pendiente_firma", anexo_firmado_path: "gestiones_anexos/x.pdf" });
});

test("E2 · puedeAnularse: admin/gerencia siempre; quien la creó, mientras siga blanda", () => {
  const G = cargarServicio();
  const creador = { rol: "vendedor", uid: "u1" };
  assert.equal(G.puedeAnularse(blanda, creador).ok, true);
  assert.equal(G.puedeAnularse(blanda, { rol: "recepcion", uid: "u1" }).ok, true);
  // La gestión de otro, no.
  assert.equal(G.puedeAnularse({ ...blanda, responsable_uid: "otro" }, creador).ok, false);
  // Ya en proceso: queda para administración o gerencia.
  const enProceso = { ...blanda, estado: "en_proceso", cierre: { derivacion: true } };
  assert.equal(G.puedeAnularse(enProceso, creador).ok, false);
  assert.equal(G.puedeAnularse(enProceso, { rol: "administrador", uid: "adm" }).ok, true);
  assert.equal(G.puedeAnularse(enProceso, { rol: "gerente", uid: "ger" }).ok, true);
  // Entregada o cerrada: nadie. Lo físico no se deshace anulando.
  assert.equal(G.puedeAnularse({ ...blanda, cierre: { entrega: true } }, { rol: "administrador" }).ok, false);
  assert.equal(G.puedeAnularse({ ...blanda, estado: "cerrada" }, { rol: "administrador" }).ok, false);
  assert.equal(G.puedeAnularse({ ...blanda, estado: "anulada" }, { rol: "administrador" }).ok, false);
  // Bodega no anula gestiones ajenas.
  assert.equal(G.puedeAnularse(blanda, { rol: "inventario", uid: "inv" }).ok, false);
});

test("E3 · corregir una BAJA: seriales desmarcados fuera, motivo y fechas al día", async () => {
  const g = {
    id: "GB20260909-01", tipo: "baja", estado: "pendiente_aprobacion", responsable_uid: "u1",
    cierre: {}, ordenes: {}, carta_path: "x.pdf", motivo_codigo: "precio",
    fecha_fin_facturacion: "2026-09-30", fecha_nota_cliente: "2026-09-01",
    items: [
      { serial_saliente: "A1", modelo: "NX-410", contrato_doc_id: "c1", contrato_id: "ALQ-1", motivo_codigo: "precio" },
      { serial_saliente: "A2", modelo: "NX-410", contrato_doc_id: "c2", contrato_id: "ALQ-2", motivo_codigo: "precio" },
    ],
  };
  const { Centro, escrito } = montarCentro({
    gestiones: [g],
    nodos: {
      geNotas: el({ value: "  se cae A2  " }), geMotivo: el({ value: "morosidad" }),
      geDet: el({ value: "acuerdo con el cliente" }), geFin: el({ value: "2026-10-31" }),
      geNota: el({ value: "2026-09-05" }),
    },
    // Solo el primer serial queda marcado.
    selectores: { "input[data-gesel]:checked": [el({ dataset: { gesel: "0" } })] },
  });
  await Centro.guardarEdicionGestion("GB20260909-01");

  const c = escrito.cambios;
  assert.equal(escrito.gid, "GB20260909-01");
  assert.equal(c.items.length, 1, "el serial desmarcado debe salir de la baja");
  assert.equal(c.items[0].serial_saliente, "A1");
  assert.equal(c.items[0].motivo_codigo, "morosidad");
  assert.equal(c.items[0].motivo_detalle, "acuerdo con el cliente");
  assert.equal(c.items[0].fecha_fin_facturacion, "2026-10-31");
  assert.equal(c.motivo_codigo, "morosidad");
  assert.equal(c.fecha_fin_facturacion, "2026-10-31");
  assert.equal(c.fecha_nota_cliente, "2026-09-05");
  assert.equal(c.notas, "se cae A2");
  assert.deepEqual(c.contratos_afectados, ["c1"], "el contrato del serial que salió ya no se toca");
  assert.ok(c.penalidad_estimada, "la liquidación estimada se recalcula");
  // Lo que NUNCA puede viajar en una corrección.
  assert.ok(!("estado" in c) && !("cierre" in c) && !("aprobacion" in c), "la corrección no toca estado/cierre/aprobación");
  assert.match(escrito.resumen, /1 serial/);
});

test("E3b · una BAJA no puede quedarse sin seriales ni sin motivo", async () => {
  const g = { id: "GB2", tipo: "baja", estado: "pendiente_aprobacion", responsable_uid: "u1",
    cierre: {}, ordenes: {}, items: [{ serial_saliente: "A1", contrato_doc_id: "c1" }] };
  const sinSeriales = montarCentro({ gestiones: [g], nodos: { geNotas: el(), geMotivo: el({ value: "precio" }) },
    selectores: { "input[data-gesel]:checked": [] } });
  await sinSeriales.Centro.guardarEdicionGestion("GB2");
  assert.equal(sinSeriales.escrito.cambios, undefined, "sin seriales no se guarda");
  assert.match(sinSeriales.escrito.toast.msg, /al menos un serial/i);

  const sinMotivo = montarCentro({ gestiones: [g], nodos: { geNotas: el(), geMotivo: el({ value: "" }) },
    selectores: { "input[data-gesel]:checked": [el({ dataset: { gesel: "0" } })] } });
  await sinMotivo.Centro.guardarEdicionGestion("GB2");
  assert.equal(sinMotivo.escrito.cambios, undefined, "sin motivo no se guarda");
  assert.match(sinMotivo.escrito.toast.msg, /motivo/i);
});

test("E5 · el pie del expediente ofrece corregir/anular, o dice por qué no", () => {
  const g = { ...blanda, tipo: "reemplazo", items: [{ serial_saliente: "A1", modelo: "NX-410" }],
    estado: "pendiente_bodega", cierre: {} };
  const { Centro } = montarCentro({ gestiones: [g] });
  const abierto = Centro._detalleGestion(g);
  assert.match(abierto, /Centro\.editarGestion\('GA20260909-01'\)/, "falta el botón de editar");
  assert.match(abierto, /Centro\.anularGestion\('GA20260909-01'\)/, "el vendedor que la creó debe poder anular la suya");

  // Ya con la OS afuera: no se edita, y se DICE por qué (esconder el botón sin
  // explicación es lo que manda a la gente a crear una gestión nueva).
  const conOS = { ...g, cierre: { asignacion: true }, ordenes: { programacion_id: "OS-1" } };
  const html = Centro._detalleGestion(conOS);
  assert.ok(!/Centro\.editarGestion/.test(html), "con la OS afuera no se ofrece editar");
  assert.match(html, /No se puede editar:/);

  // Entregada: ni editar ni anular.
  const entregada = { ...g, estado: "en_proceso", cierre: { entrega: true, asignacion: true } };
  const htmlE = Centro._detalleGestion(entregada);
  assert.ok(!/Centro\.editarGestion/.test(htmlE) && !/Centro\.anularGestion/.test(htmlE),
    "una gestión entregada no se edita ni se anula");

  // Administración sí anula una que ya está en proceso.
  Centro.rol = "administrador";
  assert.match(Centro._detalleGestion({ ...g, estado: "en_proceso", cierre: { asignacion: true } }),
    /Centro\.anularGestion/);
});

test("E6 · el formulario de corrección llega prellenado por tipo", () => {
  const { Centro } = montarCentro();
  Centro.cargosCat = [{ id: "cg1", concepto: "Servicio GPS", monto_default: 5, recurrente: true }];

  const aum = Centro._edAumentoHtml({ tipo: "aumento", aumento: { duracion_meses: 12,
    lineas: [{ modelo: "NX-410", modelo_id: "m1", cantidad: 3, precio: 22, modalidad: "propio" }],
    cargos: [{ cargo_id: "cg1", cantidad: 2, monto: 5, recurrente: true, seriales: ["A1", "A2"] }],
    totales: { itbms_aplica: false } } });
  assert.match(aum, /value="3"/, "la cantidad guardada debe venir prellenada");
  assert.match(aum, /value="22.00"/, "el precio guardado debe venir prellenado");
  assert.match(aum, /value="propio" selected/, "de quién es el equipo se conserva");
  assert.match(aum, /id="waMeses"[^>]*value="12"/);
  assert.ok(!/id="waItbms"[^>]*checked/.test(aum), "un anexo exento no debe reaparecer con ITBMS");
  assert.match(aum, /data-wac-seriales="\[&quot;A1&quot;,&quot;A2&quot;\]"/, "los seriales amarrados al cargo no se pierden");

  const reg = Centro._edAumentoHtml({ tipo: "aumento", aumento: { es_regularizacion: true,
    regulariza_seriales: [{ serial: "A1", modelo_id: "m1", modelo: "NX-410", modalidad: "alquiler" }],
    lineas: [{ modelo: "NX-410", modelo_id: "m1", cantidad: 1, precio: 18, modalidad: "alquiler" }],
    cargos: [], totales: {} } });
  assert.match(reg, /readonly/, "en la regularización la cantidad la mandan los seriales");
  assert.ok(!/_addLineaModelo/.test(reg), "una regularización no admite líneas nuevas");

  const baja = Centro._edBajaHtml({ tipo: "baja", motivo_codigo: "morosidad", fecha_fin_facturacion: "2026-10-31",
    fecha_nota_cliente: "2026-09-05", items: [{ serial_saliente: "A1", modelo: "NX-410", contrato_id: "ALQ-1" }] });
  assert.match(baja, /value="morosidad" selected/);
  assert.match(baja, /id="geFin"[^>]*value="2026-10-31"/);
  assert.match(baja, /data-gesel="0" checked/);

  const reemp = Centro._edReemplazoHtml({ tipo: "reemplazo", items: [{ serial_saliente: "A1",
    modelo: "NX-410", modelo_solicitado_id: "m2", motivo_codigo: "falla_recurrente", motivo_detalle: "no enciende" }] });
  assert.match(reemp, /value="m2" selected/, "el modelo solicitado se conserva");
  assert.match(reemp, /value="falla_recurrente" selected/);
  assert.match(reemp, /value="no enciende"/);

  const demo = Centro._edDemoHtml({ tipo: "demo", demo: { finalidad: "prueba en mina",
    fecha_salida: "2026-09-10", fecha_devolucion_estimada: "2026-09-20",
    lineas: [{ modelo: "TK-3000", modelo_id: "m2", cantidad: 4 }] } });
  assert.match(demo, /value="prueba en mina"/);
  assert.match(demo, /id="wdDevol"[^>]*value="2026-09-20"/);
  assert.match(demo, /value="4"/);
});

test("E4 · corregir un AUMENTO: recalcula los totales y no toca el estado", async () => {
  const g = {
    id: "GA20260909-02", tipo: "aumento", estado: "pendiente_aprobacion", responsable_uid: "u1",
    cierre: {}, ordenes: {},
    aumento: { contrato_doc_id: "c1", contrato_id: "ALQ-1", duracion_meses: 18,
      lineas: [{ modelo: "NX-410", modelo_id: "m1", cantidad: 1, precio: 20, modalidad: "alquiler" }],
      cargos: [], totales: { total_mensual: 21.4, itbms_aplica: true }, seriales_asignados: [] },
  };
  // Dos radios a $25 en vez de uno a $20, sin ITBMS.
  const linea = { value: "m1" };
  const { Centro, escrito } = montarCentro({
    gestiones: [g],
    nodos: { geNotas: el(), waMeses: el({ value: "24" }), waItbms: el({ checked: false }) },
    selectores: {
      "select[data-wau-modelo]": [el(linea)],
      "input[data-wau-cant]": [el({ value: "2" })],
      "input[data-wau-precio]": [el({ value: "25" })],
      "select[data-wau-modalidad]": [el({ value: "alquiler" })],
      ".wa-cargo": [],
    },
  });
  await Centro.guardarEdicionGestion("GA20260909-02");

  const c = escrito.cambios;
  // JSON: los objetos vienen del vm (otro realm) y deepEqual mira el prototipo.
  assert.equal(JSON.stringify(c["aumento.lineas"]),
    JSON.stringify([{ modelo: "NX-410", modelo_id: "m1", cantidad: 2, precio: 25, modalidad: "alquiler" }]));
  assert.equal(c["aumento.duracion_meses"], 24);
  assert.equal(c["aumento.totales"].total_mensual, 50, "50/mes: 2 × $25 sin ITBMS");
  assert.equal(c["aumento.itbms"].aplica, false);
  assert.ok(!("aumento.seriales_asignados" in c), "los seriales son de bodega: la corrección no los pisa");
  assert.ok(!("estado" in c), "la corrección no cambia el estado");

  // Una línea sin precio no se guarda (mismo candado que al crearla).
  const sinPrecio = montarCentro({
    gestiones: [g],
    nodos: { geNotas: el(), waMeses: el({ value: "24" }), waItbms: el({ checked: true }) },
    selectores: {
      "select[data-wau-modelo]": [el(linea)], "input[data-wau-cant]": [el({ value: "1" })],
      "input[data-wau-precio]": [el({ value: "" })], "select[data-wau-modalidad]": [el({ value: "alquiler" })],
      ".wa-cargo": [],
    },
  });
  await sinPrecio.Centro.guardarEdicionGestion("GA20260909-02");
  assert.equal(sinPrecio.escrito.cambios, undefined, "sin precio no se guarda");
  assert.match(sinPrecio.escrito.toast.msg, /precio/i);
});
