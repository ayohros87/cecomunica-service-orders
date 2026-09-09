// Válvula de casos viejos: cerrar reparaciones que el cliente nunca vino a
// retirar (CERRADA (SIN RETIRAR) + estado de pool `no_retirado`).
//
// El error que estas guardias evitan es UNO y es caro: cerrar el caso como si
// fuera una entrega. Si la orden se marcara ENTREGADO AL CLIENTE, el trigger
// del pool mandaría a `en_cliente` radios que están en nuestro estante — y
// ese radio es del CLIENTE, así que tampoco puede ir a `en_bodega`, que lo
// declararía nuestro y alquilable. Es el mismo agujero por el que se
// perdieron los 4 radios del finiquito de TIL PANAMA.
//
// Corre con `npm test` (node --test), sin red ni credenciales.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const RAIZ = path.join(__dirname, "..", "..");
const leer = (...p) => fs.readFileSync(path.join(RAIZ, ...p), "utf8");

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "test-sin-retirar" });
const pool = require("../src/domain/equiposPool");

// El servicio del navegador se carga en un vm con lo mínimo que toca al
// definirse (no se ejecuta ninguna escritura: solo se leen las constantes).
function cargarPoolService() {
  const ctx = { window: {}, Serial: { norm: (s) => String(s || ""), valido: () => true } };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "services", "equiposPoolService.js"), ctx);
  return ctx.EquiposPoolService || ctx.window.EquiposPoolService;
}

test("no_retirado existe en el pool y significa lo mismo de los dos lados", () => {
  const front = cargarPoolService();
  assert.equal(pool.ESTADOS.NO_RETIRADO, "no_retirado");
  assert.equal(front.ESTADOS.NO_RETIRADO, "no_retirado");
  // El label es lo que lee bodega en la ficha: tiene que decir de quién es el
  // problema, no solo dónde está el radio.
  assert.match(front.ESTADO_LABELS.no_retirado, /no lo retir/i);
});

test("no_retirado NO se confunde con en_cliente ni con en_bodega", () => {
  // La razón de existir del estado. Si algún día alguien lo "simplifica"
  // reusando uno de estos dos, este test dice por qué no.
  assert.notEqual(pool.ESTADOS.NO_RETIRADO, pool.ESTADOS.EN_CLIENTE);
  assert.notEqual(pool.ESTADOS.NO_RETIRADO, pool.ESTADOS.EN_BODEGA);
  assert.notEqual(pool.ESTADOS.NO_RETIRADO, pool.ESTADOS.EN_TALLER);
});

test("el cierre sin retirar NO es una entrega: terminal propio", () => {
  const estados = leer("public", "js", "pages", "ordenes-state.js");
  assert.match(estados, /CERRADA_SIN_RETIRAR:\s*'CERRADA \(SIN RETIRAR\)'/,
    "el terminal tiene que existir en la máquina de estados del front");

  const trigger = leer("functions", "src", "triggers", "ordenes", "onOrdenWritePool.js");
  assert.match(trigger, /CERRADA_SIN_RETIRAR = "CERRADA \(SIN RETIRAR\)"/);
  // Y su rama tiene que mandar las unidades a no_retirado, no a en_cliente.
  const rama = trigger.slice(trigger.indexOf("cerroSinRetirar"));
  const cuerpo = rama.slice(0, rama.indexOf("Qué unidades entrega ESTA escritura"));
  assert.match(cuerpo, /aEstado: pool\.ESTADOS\.NO_RETIRADO/,
    "cerrar sin retirar debe dejar las unidades en no_retirado");
  assert.doesNotMatch(cuerpo, /aEstado: pool\.ESTADOS\.EN_CLIENTE/,
    "un cierre sin retirar NUNCA manda radios al cliente: están en nuestro estante");
  assert.match(cuerpo, /soloDesde: \[pool\.ESTADOS\.EN_TALLER\]/,
    "solo se mueve lo que sigue en el taller — lo que ya salió en una tanda está con el cliente");
});

test("las reglas exigen motivo para cerrar sin retirar", () => {
  const reglas = leer("firestore.rules");
  assert.match(reglas, /a == "CERRADA \(SIN RETIRAR\)"/,
    "la transición tiene que estar declarada en la máquina de estados de las rules");
  assert.match(reglas,
    /sin_retirar", \{\}\)\.get\("motivo", ""\)\.size\(\) >= 10/,
    "cerrar un caso sin decir por qué es como no cerrarlo");
  // Y una orden así cerrada es historial: no se puede borrar lógicamente.
  const elim = reglas.slice(reglas.indexOf("function eliminadoOk"));
  assert.match(elim.slice(0, elim.indexOf("}")), /CERRADA \(SIN RETIRAR\)/,
    "una orden cerrada sin retirar guarda radios ajenos: no se borra");
});

test("el terminal cuenta como cerrado para la conciliación del pool", () => {
  // Si no, la conciliación diaria reportaría estas órdenes como vivas y
  // pediría explicación por unidades que ya tienen su historia contada.
  const conc = leer("functions", "src", "domain", "conciliacionPool.js");
  assert.match(conc, /CERRADA \(SIN RETIRAR\)/);
});

test("salir de no_retirado exige estado de partida y motivo", () => {
  const front = cargarPoolService();
  const src = leer("public", "js", "services", "equiposPoolService.js");

  for (const metodo of ["retiradoPorCliente", "noRetiradoABodega"]) {
    assert.equal(typeof front[metodo], "function", `falta la puerta ${metodo}`);
    const cuerpo = src.slice(src.indexOf(`async ${metodo}(`), src.indexOf(`async ${metodo}(`) + 500);
    assert.match(cuerpo, /esperado: this\.ESTADOS\.NO_RETIRADO/,
      `${metodo} debe rebotar si la unidad ya se movió por otro lado`);
    assert.match(cuerpo, /notas: motivo/, `${metodo} debe dejar el motivo en el kardex`);
  }
});

test("las tres puertas de salida están en la barra de lote, y la baja es solo de admin", () => {
  const src = leer("public", "js", "pages", "inventario-equipos.js");
  const bloque = src.slice(src.indexOf("LOTE_ACCIONES:"), src.indexOf("_seleccionados()"));
  for (const clave of ["retirado", "noRetiradoBodega", "abandonado"]) {
    assert.ok(bloque.includes(`${clave}: {`), `falta la puerta "${clave}"`);
  }
  // Las tres piden motivo: sin eso esto se vuelve una gaveta donde limpiar
  // la lista, que es justo lo que la válvula viene a evitar.
  const puertas = bloque.slice(bloque.indexOf("retirado: {"));
  assert.equal((puertas.match(/pideMotivo: true/g) || []).length, 3,
    "las tres salidas de no_retirado piden motivo");
  // Dar por abandonado equipo AJENO no puede ser una acción de cualquiera.
  const abandonado = bloque.slice(bloque.indexOf("abandonado: {"));
  assert.match(abandonado, /ROLES\.ADMIN/,
    "declarar abandonado un radio del cliente es de admin");
});

test("la bandeja de casos viejos ofrece las DOS puertas, no un botón de cerrar", () => {
  // La trampa que este test cierra: las órdenes viejas en COMPLETADO NO son
  // todas "el cliente no vino" — la mayoría se entregaron y nadie las marcó
  // (67 medidas el 2026-08-20, ver domain/pendientes.js). Un solo botón de
  // "cerrar" mandaría a `no_retirado` radios que están con el cliente.
  const src = leer("public", "js", "pages", "ordenes-casos-viejos.js");
  assert.match(src, /data-cv="entregada"/, "falta la puerta de entrega retroactiva");
  assert.match(src, /data-cv="sin-retirar"/, "falta la puerta de cierre por no retiro");
  assert.match(src, /noRecibido: true/,
    "la entrega retroactiva se abre en firma en papel: el cliente se llevó los radios hace meses");
  assert.match(src, /DIAS_UMBRAL = 30/);
});

test("un caso viejo es una REPARACIÓN terminada, con QC resuelto y ≥30 días", () => {
  const ctx = {
    window: {},
    EntregaTandas: { admiteTandas: (o) => /REPARACI/i.test(o.tipo_de_servicio || "") },
    PendientesDomain: { qcPendiente: (o) => o.qc_requerido === true && !o.qc },
    APP: { state: { orders: [] } },
    Date,
  };
  vm.createContext(ctx);
  vm.runInContext(leer("public", "js", "pages", "ordenes-casos-viejos.js"), ctx);
  const { esCasoViejo } = ctx.window.CasosViejos;

  const hace = (d) => new Date(Date.now() - d * 86400000);
  const base = {
    tipo_de_servicio: "REPARACIÓN", estado_reparacion: "COMPLETADO (EN OFICINA)",
    fecha_completado: hace(45),
  };
  assert.ok(esCasoViejo(base));
  assert.ok(!esCasoViejo({ ...base, fecha_completado: hace(10) }), "10 días no es un caso viejo");
  assert.ok(!esCasoViejo({ ...base, eliminado: true }));
  assert.ok(!esCasoViejo({ ...base, estado_reparacion: "ASIGNADO" }), "sigue en el taller");
  assert.ok(!esCasoViejo({ ...base, estado_reparacion: "ENTREGADO AL CLIENTE" }), "ya cerró");
  assert.ok(!esCasoViejo({ ...base, tipo_de_servicio: "PROGRAMACION" }),
    "la válvula es solo para REPARACIÓN");
  // Con QC pendiente el caso NO espera al cliente: espera al taller, y esa
  // cola ya tiene su propia señal. Cerrarlo aquí saltaría el control.
  assert.ok(!esCasoViejo({ ...base, qc_requerido: true }), "QC pendiente no es un caso viejo");
  assert.ok(esCasoViejo({ ...base, qc_requerido: true, qc: { resultado: "aprobado" } }));
});
