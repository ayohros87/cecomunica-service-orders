// Sonda del presupuesto de evaluación de ordenes_de_servicio.
//
// Corre con:
//   firebase emulators:exec --only firestore "node functions/test-emulator/sonda-presupuesto-rules.js"
//
// Firestore corta la evaluación de las reglas a las 1000 expresiones y deniega.
// El emulador no dice cuántas gastó una escritura, así que se mide por relleno:
// se inyecta al `allow update` real una cadena de N comparaciones triviales
// (`1 == 1`) y se busca el N más alto con el que la escritura LEGÍTIMA todavía
// pasa. Ese N es el margen. Se calibra contra una regla vacía (cuántas
// comparaciones caben en las 1000) para traducirlo a porcentaje gastado.
//
// No prueba candados: solo mide. No toca producción.
const fs = require("fs");
const path = require("path");
const { initializeTestEnvironment } = require("@firebase/rules-unit-testing");

const RULES = fs.readFileSync(path.join(__dirname, "../../firestore.rules"), "utf8");
const PROJECT = "demo-sonda-presupuesto";

const ANCLA_UPDATE = "&& (isAdmin() || (ordenTransicionLegal()";
const ANCLA_MATCH = "match /ordenes_de_servicio/{docId} {";
if (RULES.split(ANCLA_UPDATE).length !== 2 || RULES.split(ANCLA_MATCH).length !== 2) {
  console.error("FALLO: no se encontraron las anclas del allow update de ordenes_de_servicio.\n" +
    "Si cambiaste la cadena de guards, actualiza las anclas en este archivo.");
  process.exit(1);
}

// En una lista y no encadenadas con `&&`: una cadena larga anida y el
// compilador la rechaza ("Expression is too complex to evaluate safely").
const pad = (n) => (n > 0 ? `[${Array(n).fill("1 == 1").join(", ")}].size() == ${n}` : "true");
const rulesCon = (n) => RULES
  .replace(ANCLA_MATCH, `match /sonda_cal/{d} { allow write: if (${pad(n)}); }\n    ${ANCLA_MATCH}`)
  .replace(ANCLA_UPDATE, `&& (${pad(n)}) ${ANCLA_UPDATE}`);

const envCon = (n) => initializeTestEnvironment({
  projectId: PROJECT,
  firestore: { rules: rulesCon(n), host: "127.0.0.1", port: 8080 },
});

// "ok" | "tope" (cortó a las 1000 expresiones) | "denegada" (la regla dijo no)
//
// Ojo con el mensaje del emulador: en TODA denegación evalúa dos veces y
// reporta las dos ("<diagnóstico>, false for 'update'"). La segunda es la
// decisión; la primera es una pasada de diagnóstico que no corta en corto
// circuito y por eso suele decir "maximum of 1000 expressions" aunque la regla
// haya dicho que no con presupuesto de sobra. Solo es tope de verdad cuando no
// hay ningún "false for" — comprobado quitando el candado: la escritura pasa.
async function intento(promesa) {
  try { await promesa; return "ok"; }
  catch (e) {
    const msg = String(e && e.message);
    return /1000 expressions/i.test(msg) && !/\bfalse for '/.test(msg) ? "tope" : "denegada";
  }
}

const EQ = (n) => Array.from({ length: n }, (_, i) => ({
  id: "e" + i, serial: "S" + i, numero_de_serie: "S" + i, modelo: "NX-420-R",
  observaciones: "sin novedad", accesorios: ["antena", "bateria", "clip"],
}));
const EXTRA = (m) => Object.fromEntries(Array.from({ length: m }, (_, i) => ["campo_" + i, "valor " + i]));
const T = (n) => ({
  n, numero: "oT-E" + n, receptor_nombre: "Ana", firma_url: "https://x/y.png",
  equipos: [{ id: "e" + n, serial: "S" + n }],
});

const COMPLETADO = "COMPLETADO (EN OFICINA)";
const conQc = (n) => ({ estado_reparacion: COMPLETADO, qc_requerido: true, qc: { resultado: "aprobado", equipos_n: n } });
const CONTRATO = (id) => ({ contrato: { aplica: true, contrato_doc_id: id }, gestion: { id: "gAumento", tipo: "aumento" } });

// Las escrituras legítimas de la operación diaria, de la más barata a las que
// recorren toda la cadena de guards (entrega con contrato, anexo y factura).
const LEGITIMAS = [
  { nombre: "editar nota (sin cambio de estado)", rol: "tecnico",
    seed: () => ({ estado_reparacion: "ASIGNADO" }), update: { nota_tecnica: "revisado" } },
  { nombre: "asignar técnico", rol: "recepcion",
    seed: () => ({ estado_reparacion: "POR ASIGNAR" }), update: { estado_reparacion: "ASIGNADO", tecnico_asignado: "t1" } },
  { nombre: "completar", rol: "tecnico",
    seed: () => ({ estado_reparacion: "ASIGNADO" }), update: { estado_reparacion: COMPLETADO, qc_requerido: true } },
  { nombre: "aprobar QC", rol: "jefe_taller",
    seed: () => ({ estado_reparacion: COMPLETADO, qc_requerido: true }),
    update: (n) => ({ qc: { resultado: "aprobado", tipo: "programacion", equipos_n: n, checklist: { a: 1, b: 1, c: 1, d: 1, e: 1 } },
      qc_historial: [{ resultado: "aprobado" }] }) },
  { nombre: "rechazar QC (vuelve al técnico)", rol: "jefe_taller",
    seed: () => ({ estado_reparacion: COMPLETADO, qc_requerido: true }),
    update: { estado_reparacion: "ASIGNADO", qc: { resultado: "rechazado" } } },
  { nombre: "entregar, sin contrato", rol: "recepcion",
    seed: (n) => conQc(n), update: { estado_reparacion: "ENTREGADO AL CLIENTE" } },
  { nombre: "entregar, contrato activo + anexo + factura", rol: "recepcion",
    seed: (n) => ({ ...conQc(n), ...CONTRATO("activoConFactura") }), update: { estado_reparacion: "ENTREGADO AL CLIENTE" } },
  { nombre: "entregar con firma del contrato pendiente", rol: "recepcion",
    seed: (n) => ({ ...conQc(n), ...CONTRATO("sinFirma") }),
    update: { estado_reparacion: "ENTREGADO AL CLIENTE", entrega_contrato_sin_firma: { contrato_doc_id: "sinFirma" } } },
  { nombre: "entrega parcial (tanda), contrato + anexo + factura", rol: "recepcion",
    seed: (n) => ({ ...conQc(n), ...CONTRATO("activoConFactura") }), update: { "entrega.tandas": [T(1)] } },
  { nombre: "cerrar sin retirar", rol: "recepcion",
    seed: () => ({ estado_reparacion: COMPLETADO }),
    update: { estado_reparacion: "CERRADA (SIN RETIRAR)", sin_retirar: { motivo: "el cliente no vino en 60 días" } } },
  { nombre: "anular", rol: "recepcion",
    seed: () => ({ estado_reparacion: "ASIGNADO" }),
    update: { estado_reparacion: "ANULADA", anulada_motivo: "el contrato se anuló" } },
  { nombre: "eliminar (borrado lógico)", rol: "recepcion",
    seed: () => ({ estado_reparacion: "ASIGNADO" }),
    update: { eliminado: true, eliminado_motivo: "orden duplicada por error" } },
];

// Escrituras que DEBEN ser rechazadas: ¿las rechaza el candado o el tope?
const DENEGADAS = [
  { nombre: "transición ilegal (entregada → asignada)", rol: "recepcion",
    seed: () => ({ estado_reparacion: "ENTREGADO AL CLIENTE" }), update: { estado_reparacion: "ASIGNADO" } },
  { nombre: "técnico toca el QC", rol: "tecnico",
    seed: () => ({ estado_reparacion: COMPLETADO, qc_requerido: true }), update: { qc: { resultado: "aprobado" } } },
  { nombre: "apagar qc_requerido", rol: "recepcion",
    seed: () => ({ estado_reparacion: COMPLETADO, qc_requerido: true }), update: { qc_requerido: false } },
  { nombre: "borrar una tanda firmada", rol: "recepcion",
    seed: () => ({ estado_reparacion: COMPLETADO, entrega: { tandas: [T(1), T(2)] } }), update: { "entrega.tandas": [T(1)] } },
  { nombre: "entregar con QC pendiente", rol: "recepcion",
    seed: () => ({ estado_reparacion: COMPLETADO, qc_requerido: true }), update: { estado_reparacion: "ENTREGADO AL CLIENTE" } },
];

// Tamaños de orden: chica, grande y la más grande razonable.
const TAMANOS = [{ n: 3, m: 0 }, { n: 30, m: 40 }, { n: 100, m: 40 }];

async function sembrarBase(env) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const rol of ["recepcion", "tecnico", "jefe_taller", "administrador"]) {
      await db.doc("usuarios/" + rol).set({ rol });
    }
    await db.doc("contratos/activoConFactura").set({
      firmado: false, estado: "activo", tipo_contrato: "Servicio", codigo_tipo: "SERV",
      factura_venta_requerida: true, factura_venta: { numero: "F-1" },
    });
    await db.doc("contratos/sinFirma").set({ firmado: false, estado: "borrador", tipo_contrato: "Alquiler", codigo_tipo: "ALQ" });
    await db.doc("gestiones/gAumento").set({ tipo: "aumento", cierre: { firma: true } });
  });
}

async function probar(env, caso, tam) {
  const base = {
    tipo_de_servicio: "PROGRAMACIÓN", cliente_id: "cli1", cliente_nombre: "ACME",
    equipos: EQ(tam.n), ...EXTRA(tam.m), ...caso.seed(tam.n),
  };
  await env.withSecurityRulesDisabled((ctx) => ctx.firestore().doc("ordenes_de_servicio/sonda").set(base));
  const cambio = typeof caso.update === "function" ? caso.update(tam.n) : caso.update;
  return intento(env.authenticatedContext(caso.rol).firestore().doc("ordenes_de_servicio/sonda").update(cambio));
}

// El N más alto en [0, max] con el que `pasa(N)` sigue siendo true.
async function mayorQuePasa(max, pasa) {
  let lo = 0, hi = max;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (await pasa(mid)) lo = mid; else hi = mid - 1;
  }
  return lo;
}

async function conEnv(n, fn) {
  const env = await envCon(n);
  try { return await fn(env); } finally { await env.cleanup(); }
}

async function main() {
  await conEnv(0, sembrarBase);

  // Calibración: cuántas comparaciones triviales caben en una regla vacía.
  const cabe = (n) => conEnv(n, async (env) =>
    (await intento(env.unauthenticatedContext().firestore().doc("sonda_cal/x").set({ a: 1 }))) === "ok");
  const TOPE = await mayorQuePasa(1500, cabe);
  console.log(`Calibración: una regla vacía aguanta ${TOPE} comparaciones triviales antes del tope.\n`);
  if (TOPE === 0 || TOPE === 1500) {
    console.error("FALLO: la calibración no encontró el tope; la sonda no mide nada.");
    process.exit(1);
  }

  console.log("ESCRITURAS LEGÍTIMAS — margen en comparaciones y % del presupuesto gastado");
  const filas = [];
  for (const caso of LEGITIMAS) {
    for (const tam of TAMANOS) {
      const sinRelleno = await conEnv(0, (env) => probar(env, caso, tam));
      if (sinRelleno !== "ok") {
        filas.push({ caso: caso.nombre, tam, margen: null, estado: sinRelleno });
        continue;
      }
      const margen = await mayorQuePasa(TOPE, (n) => conEnv(n, async (env) => (await probar(env, caso, tam)) === "ok"));
      filas.push({ caso: caso.nombre, tam, margen, gastado: Math.round((1 - margen / TOPE) * 100) });
    }
  }
  for (const f of filas) {
    const tam = `${f.tam.n} equipos`.padEnd(12);
    const res = f.margen === null
      ? (f.estado === "tope" ? "*** LLEGA AL TOPE: la escritura legítima se deniega ***" : "denegada por la regla (revisar el caso de la sonda)")
      : `margen ${String(f.margen).padStart(4)}  gastado ~${String(f.gastado).padStart(3)}%`;
    console.log(`  ${f.caso.padEnd(52)} ${tam} ${res}`);
  }

  console.log("\nESCRITURAS QUE DEBEN RECHAZARSE — ¿quién las rechaza?");
  for (const caso of DENEGADAS) {
    const r = await conEnv(0, (env) => probar(env, caso, TAMANOS[0]));
    const quien = r === "tope" ? "*** el TOPE de 1000, no el candado ***"
      : r === "denegada" ? "el candado" : "*** PASÓ: no fue rechazada ***";
    console.log(`  ${caso.nombre.padEnd(52)} ${quien}`);
  }

  const medidas = filas.filter((f) => f.margen !== null);
  const peor = medidas.reduce((a, b) => (a && a.margen <= b.margen ? a : b), null);
  console.log("\nRESUMEN");
  console.log(`  legítimas medidas: ${medidas.length} de ${filas.length}`);
  if (peor) console.log(`  la más cara: "${peor.caso}" con ${peor.tam.n} equipos — gasta ~${peor.gastado}% del presupuesto`);
}

main().catch((e) => { console.error(e); process.exit(1); });
