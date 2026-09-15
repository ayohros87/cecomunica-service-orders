// Anular el contrato cierra sus órdenes de servicio (2026-09-15).
//
// Pregunta de Alberto: *"si el contrato se anuló, la orden se debería anular
// también, verifica por qué no se anularía"*. No se anulaba porque nadie la
// tocaba: `onAnnulment` cerraba la facturación, resolvía el pool y abría la
// devolución, pero no miraba `ordenes_de_servicio` por ningún lado. El contrato
// moría y su orden seguía viva en la bandeja para siempre — y desde el candado
// de firma de la entrega (2026-09-03) ya ni podía entregarse, porque un contrato
// anulado no está firmado ni activo.
//
// Medido antes del arreglo: 24 órdenes colgaban de un contrato anulado, 4 vivas
// — tres COMPLETADAS con 15, 10 y 1 radio esperando una entrega imposible desde
// julio y agosto, con los radios en taller o en bodega (no con el cliente).
//
// Lo que fijan estos guardias:
//   A1 — lo terminado no se toca (entregado o cerrado por cualquiera de sus
//        puertas), ni lo eliminado.
//   A2 — sin sustituto y SIN equipos, la orden se ANULA; con equipos NO, porque
//        anular a ciegas destroza trabajo real (ver A7: pasó en 3 de 4 casos).
//   A3 — con sustituto, se REPUNTA: el papel se rehizo, el trabajo es el mismo.
//   A4 — es idempotente: correrlo dos veces no vuelve a tocar nada.
//   A5 — el estado ANULADA es terminal en todas partes (pool, KPIs, bandeja).
//   A7 — un equipo eliminado no cuenta como trabajo.
//
// Y la salida HUMANA que faltaba (A8–A11): hasta hoy una orden así no tenía
// puerta por ningún lado — no se podía entregar (el candado deniega bajo un
// contrato anulado), el editor de cabecera solo abre en POR ASIGNAR, y
// "CERRADA (SIN RETIRAR)" habría mentido diciendo que el cliente no vino a
// buscar unos radios que ni contrato tienen. Se añadieron DOS PUERTAS, mismo
// patrón que la válvula de casos viejos: pasar la orden al contrato nuevo, o
// anularla con motivo. Y el Centro las recuerda donde el dato por fin existe.
//   A8  — las dos puertas existen y son alcanzables desde la fila.
//   A9  — rules deja anular con motivo, solo desde un estado vivo.
//   A10 — al anular, los radios que nunca salieron vuelven a bodega.
//   A11 — el Centro recuerda las señaladas, con un deep-link que SÍ las trae.
//
// Corre con `npm test` (node --test). Sin emulador: planOrdenes es lógica pura.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { planOrdenes, estaViva, TERMINALES, ANULADA } =
  require("../src/domain/ordenesAnulacion");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const orden = (id, estado, extra = {}) => ({ id, data: { estado_reparacion: estado, ...extra } });
const equipos = (n) => Array.from({ length: n }, (_, i) => ({ serial: `S${i}`, eliminado: false }));

// Las 4 órdenes reales que quedaron colgando (2026-09-15), con los equipos que
// de verdad tenían encima. Las tres COMPLETADAS llevaban radios ya preparados y
// el contrato sucesor del cliente NO tenía orden propia: eran el único sitio
// donde vivía ese trabajo.
const VIVAS = [
  orden("2026090704", "POR ASIGNAR", { equipos: [] }),
  orden("2026080705", "COMPLETADO (EN OFICINA)", { equipos: equipos(15) }),
  orden("2026072805", "COMPLETADO (EN OFICINA)", { equipos: equipos(1) }),
  orden("2026072107", "COMPLETADO (EN OFICINA)", { equipos: equipos(10) }),
];

test("A1 · lo que ya terminó no se toca", () => {
  const terminadas = [...TERMINALES].map((e, i) => orden(`t${i}`, e));
  const eliminada = orden("elim", "POR ASIGNAR", { eliminado: true });
  const p = planOrdenes([...terminadas, eliminada]);
  assert.equal(p.anular.length, 0, "anuló una orden ya terminada o eliminada");
  assert.equal(p.repuntar.length, 0);
  assert.equal(p.intactas.length, terminadas.length + 1);
  // Y el minúsculo detalle que hace que esto funcione con datos viejos:
  // el estado se compara en MAYÚSCULAS.
  assert.equal(estaViva({ estado_reparacion: "entregado al cliente" }), false);
});

test("A2 · sin sustituto: se anula la vacía, se SEÑALA la que tiene equipos", () => {
  const p = planOrdenes(VIVAS);
  assert.deepEqual(p.anular.map(o => o.id), ["2026090704"],
    "solo la orden sin un solo serial se anula sola");
  assert.deepEqual(p.revisar.map(o => o.id).sort(),
    ["2026072107", "2026072805", "2026080705"],
    "las que ya tienen radios preparados NO se anulan: las decide una persona");
  assert.deepEqual(p.revisar.map(o => o.equipos_n).sort((a, b) => a - b), [1, 10, 15],
    "el aviso tiene que decir cuántos radios hay en juego");
  assert.equal(p.repuntar.length, 0);
});

test("A3 · con sustituto declarado se REPUNTA, no se anula ni se pregunta", () => {
  const p = planOrdenes(VIVAS, { sustitutoId: "cNuevo", sustitutoNumero: "ALQ20260812-01" });
  assert.equal(p.anular.length, 0, "una sustitución NO tira el trabajo a la basura");
  assert.equal(p.revisar.length, 0, "con sustituto declarado no hay nada que preguntar");
  assert.equal(p.repuntar.length, 4);
  for (const o of p.repuntar) {
    assert.equal(o.sustitutoId, "cNuevo");
    assert.equal(o.sustitutoNumero, "ALQ20260812-01");
  }
});

test("A4 · idempotente: una orden ya ANULADA queda fuera", () => {
  const yaAnuladas = VIVAS.map(o => orden(o.id, ANULADA));
  const p = planOrdenes(yaAnuladas);
  assert.equal(p.anular.length, 0, "volvió a anular lo ya anulado");
  assert.equal(p.revisar.length, 0);
  assert.equal(p.intactas.length, 4);
});

test("A7 · un equipo eliminado no cuenta como trabajo", () => {
  // Una orden a la que le quitaron todos los equipos es un papel en blanco
  // aunque el array siga ahí: se anula, no se pregunta.
  const vacia = orden("x", "COMPLETADO (EN OFICINA)",
    { equipos: [{ serial: "S1", eliminado: true }, { serial: "", eliminado: false }] });
  const p = planOrdenes([vacia]);
  assert.deepEqual(p.anular.map(o => o.id), ["x"]);
  assert.equal(p.revisar.length, 0);
});

test("A5 · ANULADA es terminal en todas partes, no solo aquí", () => {
  assert.ok(TERMINALES.has("ANULADA"), "el módulo no la trata como terminal");
  assert.ok(/ANULADA: 'ANULADA'/.test(leer("public", "js", "pages", "ordenes-state.js")),
    "ordenes-state.js: ANULADA no es un estado canónico");
  // admin/operacion la contaba como 'sin asignar' y la sacaba en las alertas.
  const oper = leer("public", "js", "pages", "admin-operacion.js");
  const set = oper.slice(oper.indexOf("ESTADOS_TERMINAL"), oper.indexOf("ESTADOS_TERMINAL") + 600);
  assert.ok(/'ANULADA'/.test(set), "admin-operacion.js: ANULADA fuera de ESTADOS_TERMINAL");
  // La conciliación del pool ya la conocía desde antes: que siga.
  assert.ok(/"ANULADA"/.test(leer("functions", "src", "domain", "conciliacionPool.js")),
    "conciliacionPool.js: ANULADA fuera de los terminales");
  // pendientes.js va por lista BLANCA de estados abiertos: una orden ANULADA
  // sale sola de la cola. Este guardia congela ese diseño.
  const pend = leer("public", "js", "domain", "pendientes.js");
  assert.ok(/ESTADOS_ABIERTOS = \["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO"\]/.test(pend),
    "pendientes.js dejó de usar lista blanca: hay que excluir ANULADA a mano");
});

test("A6 · el trigger de la anulación llama al cierre de órdenes", () => {
  const src = leer("functions", "src", "triggers", "contratos", "onAnnulment.js");
  assert.ok(/cerrarOrdenesDeContratoAnulado/.test(src),
    "onAnnulment no cierra las órdenes del contrato");
  // Y no puede tumbar el correo de la anulación si falla.
  const i = src.indexOf("cerrarOrdenesDeContratoAnulado(event.params.docId");
  assert.ok(i > 0, "no se llama con el doc del contrato");
  assert.ok(/try \{[^}]*cerrarOrdenesDeContratoAnulado/s.test(src.slice(Math.max(0, i - 300), i + 100)),
    "la llamada no está protegida: un fallo ahí frenaría el correo de anulación");
});

test("A8 · las DOS PUERTAS existen y son alcanzables", () => {
  // Puerta 1 (repuntar) y puerta 2 (anular) en el servicio, con el listón de
  // motivo que hace que un cierre diga por qué.
  const svc = leer("public", "js", "services", "ordenesService.js");
  assert.ok(/async repuntarContratoOrden\(/.test(svc), "falta la puerta de repuntar");
  assert.ok(/async anularOrden\(/.test(svc), "falta la puerta de anular");
  assert.ok(/texto\.length < 10/.test(svc.slice(svc.indexOf("async anularOrden("))),
    "anularOrden acepta un cierre sin motivo");
  // Las dos apagan la marca del trigger: si no, el aviso quedaría eterno.
  for (const fn of ["repuntarContratoOrden", "anularOrden"]) {
    const cuerpo = svc.slice(svc.indexOf(`async ${fn}(`), svc.indexOf(`async ${fn}(`) + 2400);
    assert.ok(/contrato_anulado_revisar: firebase\.firestore\.FieldValue\.delete\(\)/.test(cuerpo),
      `${fn} no apaga contrato_anulado_revisar`);
  }
  // La hoja y su entrada en el menú de la fila.
  const flujo = leer("public", "js", "pages", "ordenes-flujo.js");
  assert.ok(/function abrirResolverContratoAnulado\(/.test(flujo), "falta la hoja de las dos puertas");
  assert.ok(/repuntarContratoOrden|anularOrden/.test(flujo), "la hoja no llama al servicio");
  const render = leer("public", "js", "pages", "ordenes-render.js");
  assert.ok(/resolver-contrato-anulado/.test(render), "el menú de la fila no ofrece resolverla");
  assert.ok(/estadoUpper === "ANULADA"/.test(render), "ANULADA no cuenta como terminal en el menú");
  assert.ok(/'resolver-contrato-anulado':/.test(leer("public", "js", "pages", "ordenes-events.js")),
    "la acción no está cableada en el dispatcher");
});

test("A9 · rules deja ANULAR con motivo, y solo desde un estado vivo", () => {
  const rules = leer("firestore.rules");
  const i = rules.indexOf('a == "ANULADA"');
  assert.ok(i > 0, "rules no permite la transición a ANULADA");
  const bloque = rules.slice(i, i + 400);
  assert.ok(/anulada_motivo[\s\S]*size\(\) >= 10/.test(bloque), "rules acepta anular sin motivo");
  assert.ok(/COMPLETADO \(EN OFICINA\)/.test(bloque), "no se puede anular una orden ya completada");
  assert.ok(!/ENTREGADO AL CLIENTE/.test(bloque), "deja anular una orden YA entregada");
});

test("A10 · al anular, los radios que nunca salieron vuelven a bodega", () => {
  const pool = leer("functions", "src", "triggers", "ordenes", "onOrdenWritePool.js");
  const i = pool.indexOf("const anulada = after");
  assert.ok(i > 0, "el pool no reacciona a la orden ANULADA");
  const bloque = pool.slice(i, i + 1200);
  assert.ok(/EN_BODEGA/.test(bloque), "no los devuelve a bodega");
  assert.ok(/soloDesde: \[pool\.ESTADOS\.EN_TALLER, pool\.ESTADOS\.ASIGNADO\]/.test(bloque),
    "sin soloDesde le quitaría al cliente un radio ya entregado en una tanda");
  assert.ok(/orden_actual_id === ordenId/.test(bloque),
    "sin la condición tocaría un radio ya reasignado a otra orden");
});

test("A11 · el Centro recuerda las órdenes que quedaron sin contrato", () => {
  const centro = leer("public", "js", "pages", "clientes-centro.js");
  assert.ok(/_cargarOrdenesPorDecidir/.test(centro), "el Centro no busca las órdenes señaladas");
  assert.ok(/ordenesPorDecidir/.test(centro), "no hay cola de órdenes por decidir");
  // El deep-link tiene que TRAER la orden: son viejas y no caben en la primera
  // página de la bandeja (?orden= solo filtra lo ya cargado).
  const i = centro.indexOf("ordenesPorDecidir || []");
  assert.ok(/ordenes\/index\.html\?ids=/.test(centro.slice(i, i + 900)),
    "el CTA usa ?orden= en vez de ?ids=: aterrizaría en una lista vacía");
});
