// Hay contratos que NO llevan firma del cliente: REEMPLAZO y DEMO (2026-09-15).
//
// Caso de Brenda — MACELLO, S.A., orden de servicio 2026090310: tres radios
// reemplazados que la vendedora ya le había entregado al cliente el 4 de
// septiembre, y el sistema no dejaba cerrar la entrega porque "el contrato de
// reemplazo aún no ha sido firmado". La orden hermana (2026090306) sí salió, y
// esa diferencia es todo el síntoma: su REEMP estaba firmado por casualidad.
//
// Un reemplazo no pacta nada. No hay precio nuevo, ni plazo nuevo, ni
// obligación nueva: sustituye una unidad por otra bajo el contrato que el
// cliente YA firmó. Por eso 79 de los 82 REEMP del sistema están sin firmar —
// esa es su forma normal, no un pendiente. El candado de firma de la entrega
// (2026-09-03, Zuleika) los trataba como a cualquier contrato y dejaba los
// radios trancados mientras el cliente ya los tenía en la mano.
//
// Y firmarlo tampoco era inocuo: la firma ACTIVA el contrato, y una activación
// le crea un aviso de facturación con su comisión — un cobro que nadie pactó
// por unos radios que solo cambiaron de número de serie.
//
// SEGUNDA VUELTA — el DEMO (decisión de Alberto, mismo día). Al repasar el resto
// de los tipos apareció el mismo cuadro, y peor: **14 de 14 demos entregados
// nunca se firmaron**, ninguno llegó a `activo`, y el sistema ya se contradecía
// solo — un demo creado como GESTIÓN no tiene paso de firma (CIERRE_DEFS.demo),
// pero el mismo demo creado como CONTRATO exigía la firma para entregar, con 14
// órdenes vivas trancadas. TEMP se queda pidiendo firma: es un alquiler de
// evento con precio, y ahí la firma sí documenta la custodia.
//
// Corre con `npm test` (node --test). Sin navegador ni red.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");
const back = require("../src/domain/contratoFirma");

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
    ["domain", "contratoAnulacion.js"], ["domain", "contratoCierre.js"], ["domain", "contratoEdicion.js"],
    ["domain", "contratoFirma.js"], ["services", "gestionesService.js"]]) {
    vm.runInContext(leer("public", "js", ...f), ctx);
  }
  Object.assign(ctx, { FMT: ctx.window.FMT, ContractTotals: ctx.window.ContractTotals,
    ContratoTarifario: ctx.window.ContratoTarifario, ContratoAnulacion: ctx.window.ContratoAnulacion,
    ContratoCierre: ctx.window.ContratoCierre, ContratoEdicion: ctx.window.ContratoEdicion,
    ContratoFirma: ctx.window.ContratoFirma, GestionesService: ctx.window.GestionesService });
  vm.runInContext(leer("public", "js", "pages", "clientes-centro.js"), ctx);
  const C = ctx.window.Centro;
  C.rol = rol; C.uid = uid;
  C.cliente = { id: "cli1", nombre: "MACELLO, S.A." };
  C.contratos = []; C.equipos = []; C.gestiones = [];
  return { C, front: ctx.window.ContratoFirma };
}

// Los dos contratos reales de MACELLO (2026-09).
const REEMP = { id: "cR", contrato_id: "REEMP20260901-02", codigo_tipo: "REEMP", tipo_contrato: "Reemplazo",
  estado: "aprobado", accion: "No Aplica", fecha_creacion: new Date(), equipos: [{ cantidad: 1, precio: 0 }] };
const ALQ = { id: "cA", contrato_id: "ALQ20260901-01", codigo_tipo: "ALQ", tipo_contrato: "Alquiler",
  estado: "aprobado", accion: "Nuevo", fecha_creacion: new Date(), equipos: [{ cantidad: 5, precio: 25 }] };
// Un demo real de los que estaban trancados (P.H. PLAZA DEL ESTE, 3 radios).
const DEMO = { id: "cD", contrato_id: "DEMO20260730-02", codigo_tipo: "DEMO", tipo_contrato: "Demo",
  estado: "aprobado", accion: "No Aplica", fecha_creacion: new Date(), equipos: [{ cantidad: 3, precio: 0 }] };

test("R1 · el tipo manda, no el número: qué contratos llevan firma", () => {
  const { front } = montar();
  for (const F of [front.lleva.bind(front), back.llevaFirma]) {
    assert.equal(F({ codigo_tipo: "REEMP" }), false, "REEMP por codigo_tipo");
    assert.equal(F({ tipo_contrato: "Reemplazo" }), false, "REEMP por nombre del tipo");
    assert.equal(F({ contrato_id: "REEMP20260901-02" }), false, "REEMP por el número, sin campos");
    // REEMP20251024 se numeró ALQ20251024-01 por error y sigue siendo un
    // reemplazo: el campo manda sobre el prefijo.
    assert.equal(F({ codigo_tipo: "REEMP", contrato_id: "ALQ20251024-01" }), false, "el campo gana al prefijo");
    assert.equal(F({ codigo_tipo: "DEMO" }), false, "DEMO por codigo_tipo");
    assert.equal(F({ tipo_contrato: "Demo" }), false, "DEMO por nombre del tipo");
    // TEMP es alquiler de evento con precio: la firma documenta la custodia.
    for (const t of ["ALQ", "PROP", "TEMP", "SERV"]) {
      assert.equal(F({ codigo_tipo: t }), true, `${t} sí lleva firma`);
    }
  }
});

test("R2 · front y back dicen lo mismo, contrato por contrato", () => {
  const { front } = montar();
  const casos = [REEMP, ALQ, DEMO, { tipo_contrato: "Propio" },
    { contrato_id: "TEMP20260902-01" }, { codigo_tipo: "TEMP" }, {}, null];
  for (const c of casos) {
    assert.equal(front.lleva(c), back.llevaFirma(c), `llevaFirma difiere en ${JSON.stringify(c)}`);
    assert.equal(front.esperando(c), back.esperandoFirma(c), `esperandoFirma difiere en ${JSON.stringify(c)}`);
  }
});

test("R3 · al contrato sin firma no se le ofrece firmarlo ni subirle un firmado", () => {
  const { C } = montar();
  C.contratos = [REEMP, DEMO, ALQ];
  for (const c of [REEMP, DEMO]) {
    const ids = C._accionesContrato(c).map(a => a.id);
    assert.ok(!ids.includes("firma"), `${c.codigo_tipo} NO se manda a firma`);
    assert.ok(!ids.includes("subir_firmado"), `a ${c.codigo_tipo} NO se le sube un firmado (lo activaría y arrancaría a facturar)`);
    // Lo demás del menú no se toca: sigue siendo un expediente completo.
    for (const id of ["ver", "documento", "editar", "anular"]) {
      assert.ok(ids.includes(id), `${c.codigo_tipo} perdió "${id}" del menú`);
    }
  }
  const idsA = C._accionesContrato(ALQ).map(a => a.id);
  assert.ok(idsA.includes("firma"), "el alquiler aprobado SÍ se manda a firma");
  assert.ok(idsA.includes("subir_firmado"), "al alquiler aprobado SÍ se le sube el firmado");
});

test("R4 · la cola Ahora pide la ENTREGA, no una firma, y lo llama por su nombre", () => {
  const { C } = montar();
  for (const [c, nombre] of [[REEMP, "reemplazo"], [DEMO, "demo"]]) {
    C.contratos = [c];
    const textos = C._itemsAccion().map(i => `${i.t} ${i.s}`).join(" | ");
    assert.ok(!/espera la firma/.test(textos), `${c.codigo_tipo}: la cola sigue pidiendo firma: ${textos}`);
    assert.ok(/espera la entrega/.test(textos), `${c.codigo_tipo}: la cola no pide la entrega: ${textos}`);
    assert.ok(!/Enviar para firma/.test(textos), `${c.codigo_tipo}: sigue ofreciendo el botón de firma`);
    assert.ok(new RegExp(`El ${nombre} `).test(textos), `${c.codigo_tipo}: el aviso no lo llama "${nombre}": ${textos}`);
  }
  // Y el contrato que sí la lleva no perdió su aviso — una vez que bodega
  // asignó los seriales (auditoría UX 2026-09-28: antes de eso el anexo
  // saldría vacío y la cola pide a bodega, no la firma).
  C.contratos = [{ ...ALQ, seriales_estado: "asignados" }];
  assert.ok(/espera la firma/.test(C._itemsAccion().map(i => i.t).join(" | ")), "el alquiler perdió su aviso de firma");
  C.contratos = [{ ...ALQ, seriales_estado: "pendiente" }];
  const sinSeriales = C._itemsAccion().map(i => `${i.t} ${i.s} ${i.btns}`).join(" | ");
  assert.ok(/espera que bodega asigne/.test(sinSeriales), "sin seriales la cola debe pedirle a bodega");
  assert.ok(!/Enviar para firma/.test(sinSeriales), "sin seriales no se ofrece enviar a firma");
});

test("R5 · el trámite sin firma se cierra con la entrega, no con la firma", () => {
  const { C } = montar();
  for (const c of [REEMP, DEMO]) {
    C.contratos = [{ ...c }];
    assert.equal(C._tramitesContrato().length, 1, `${c.codigo_tipo} aprobado sin entregar sigue en trámite`);
    C.contratos = [{ ...c, entrega_confirmada: true }];
    assert.equal(C._tramitesContrato().length, 0, `entregado, el trámite de ${c.codigo_tipo} se cierra`);
  }
  // El contrato con firma no cambia de criterio: lo cierra la firma.
  C.contratos = [{ ...ALQ, entrega_confirmada: true }];
  assert.equal(C._tramitesContrato().length, 1, "un alquiler entregado pero SIN firmar sigue en trámite");
  C.contratos = [{ ...ALQ, firmado: true }];
  assert.equal(C._tramitesContrato().length, 0, "firmado, el trámite del alquiler se cierra");
});

test("R6 · el candado de la entrega exime a los tipos sin firma en rules y en el front", () => {
  const rules = leer("firestore.rules");
  const bloque = rules.slice(rules.indexOf("function contratoFirmadoParaEntregar()"));
  const cuerpo = bloque.slice(0, bloque.indexOf("\n      }"));
  for (const t of ["REEMP", "DEMO"]) {
    assert.ok(new RegExp(`codigo_tipo[^\n]*${t}`).test(cuerpo), `rules: el candado de entrega no exime al ${t} por codigo_tipo`);
  }
  for (const t of ["Reemplazo", "Demo"]) {
    assert.ok(new RegExp(`tipo_contrato[^\n]*${t}`).test(cuerpo), `rules: el candado de entrega no exime al ${t} por tipo_contrato`);
  }
  const flujo = leer("public", "js", "pages", "ordenes-flujo.js");
  assert.ok(/ContratoFirma\.lleva/.test(flujo), "ordenes-flujo: el espejo del candado no consulta ContratoFirma");
  assert.ok(/domain\/contratoFirma\.js/.test(leer("public", "ordenes", "index.html")),
    "ordenes/index.html no carga el módulo del que depende el candado");
  assert.ok(/domain\/contratoFirma\.js/.test(leer("public", "clientes", "centro.html")),
    "clientes/centro.html no carga el módulo del que depende el Centro");
});

test("R7 · al vendedor de un contrato sin firma no se le pide que persiga una", () => {
  const src = leer("functions", "src", "triggers", "contratos", "onApproval.js");
  assert.ok(/llevaFirma/.test(src), "onApproval no consulta si el contrato lleva firma");
  const i = src.indexOf("APROBADO — sigue la firma del cliente");
  assert.ok(i > 0, "desapareció el correo de firma al vendedor");
  // El asunto de la firma tiene que estar bajo la condición, no suelto.
  const ventana = src.slice(Math.max(0, i - 400), i);
  assert.ok(/conFirma/.test(ventana), "el correo de firma sale sin mirar si el contrato la lleva");
  assert.ok(/sigue la entrega/.test(src), "el reemplazo aprobado no avisa cuál es su siguiente paso");
});
