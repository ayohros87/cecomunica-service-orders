/**
 * analiza-origen-faltante.js — SOLO LECTURA. Qué contratos VIVOS de renovación
 * o reemplazo no dicen a qué contrato reemplazan, y con qué se podrían vincular.
 *
 * CONTEXTO (2026-08-11). El vínculo al contrato original era opcional y casi
 * nadie lo llenaba: 67 de los transicionables no-legacy sin origen, y de 25
 * renovaciones, cero. Sin ese vínculo `onEntregaTransicion` corta en
 * `!origenIds.length` —es el único que crea los mapeos de devolución y la orden
 * de recuperación— y la pantalla de transición cae a "todos los equipos del
 * cliente", que ofrece radios de contratos ajenos.
 *
 * El formulario ya no deja crear uno nuevo sin declararlo (js/domain/
 * origenContrato.js), pero los que ya existen siguen huérfanos. Este script NO
 * los arregla: los saca a la luz. Vincular es una decisión de negocio —cuál de
 * los contratos viejos renueva este— y se hace desde la pantalla de transición
 * ("Vincular original(es)"), que escribe el vínculo y deja al trigger trabajar.
 *
 * POR QUÉ NO HAY BACKFILL AUTOMÁTICO: de los que lo necesitan, la mayoría tiene
 * VARIOS candidatos (COMPAÑÍA GOLY tiene tres renovaciones compitiendo por el
 * mismo pool). Adivinar el origen equivocado no deja un hueco: crea una orden
 * pidiéndole al cliente radios que no debe. El script marca los casos de UN
 * SOLO candidato aparte, que son los únicos donde no hay ambigüedad.
 *
 * QUÉ QUEDA FUERA a propósito:
 *   · Adición — agrega a un contrato vigente, el cliente conserva lo de antes:
 *     no hay devolución que reclamar (mismo corte que onEntregaTransicion).
 *   · anulados — su devolución la maneja onAnnulment, no la transición.
 *   · legacy (seriales_estado / origen_tipo) — su ciclo ocurrió antes del pool.
 *
 * USAGE (desde functions/): node scripts/analiza-origen-faltante.js [--todos]
 *   --todos  incluye también anulados y adiciones (censo completo)
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const TODOS = process.argv.includes("--todos");
const iso = (t) => {
  const d = t?.toDate ? t.toDate() : null;
  return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "";
};

(async () => {
  const snap = await db.collection("contratos").get();
  const todos = [];
  snap.forEach((d) => {
    const c = d.data();
    if (c.deleted) return;
    todos.push({ id: d.id, ...c });
  });

  // Universo: renovación/adición/reemplazo con equipo, no legacy, sin origen.
  const huerfanos = todos.filter((c) => {
    const es = !c.renovacion_sin_equipo
      && (c.accion === "Renovación" || c.accion === "Adición" || c.codigo_tipo === "REEMP");
    if (!es) return false;
    if (c.seriales_estado === "legacy" || c.origen_tipo === "legacy") return false;
    const tiene = (Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length)
      || !!c.contrato_origen_id;
    return !tiene;
  });

  // Los que de verdad piden acción: renovación/reemplazo, vigentes, sin mapeos.
  const accionables = huerfanos.filter((c) =>
    (c.accion === "Renovación" || c.codigo_tipo === "REEMP")
    && ["activo", "aprobado"].includes(c.estado)
    && !Number(c.transicion_mapeos_count || 0));

  console.log("=== CONTRATOS SIN ORIGEN VINCULADO ===");
  console.log(`total (incl. adiciones y anulados): ${huerfanos.length}`);
  console.log(`  · Adición (no se les exige — no generan devolución): ${huerfanos.filter(c => c.accion === "Adición").length}`);
  console.log(`  · anulados (los resuelve onAnnulment): ${huerfanos.filter(c => c.estado === "anulado").length}`);
  console.log(`  · con transición ya registrada a mano: ${huerfanos.filter(c => Number(c.transicion_mapeos_count || 0)).length}`);
  console.log(`\n>>> ACCIONABLES (renovación/reemplazo vigentes, sin registro): ${accionables.length}\n`);

  // Pool por contrato, para saber qué candidato tiene equipo que reclamar.
  const unidadesPorContrato = new Map();
  const poolSnap = await db.collection("equipos_pool")
    .where("estado", "in", ["asignado_contrato", "en_cliente"]).get();
  poolSnap.forEach((d) => {
    const u = d.data();
    const cid = u.asignacion?.contrato_doc_id;
    if (!cid) return;
    if (u.propiedad === "cliente") return; // propios del cliente: no se devuelven
    unidadesPorContrato.set(cid, (unidadesPorContrato.get(cid) || 0) + 1);
  });

  const unico = [];
  const ambiguo = [];
  const sinCandidato = [];

  for (const c of accionables.sort((a, b) => (iso(a.fecha_creacion) < iso(b.fecha_creacion) ? 1 : -1))) {
    // Candidato = contrato vigente del MISMO cliente, ANTERIOR a este (uno no
    // renueva a un contrato que nació después) y que no sea él mismo.
    const fecha = iso(c.fecha_creacion);
    const candidatos = todos
      .filter((k) => k.id !== c.id
        && k.cliente_id === c.cliente_id
        && ["activo", "aprobado"].includes(k.estado)
        && (!fecha || !iso(k.fecha_creacion) || iso(k.fecha_creacion) <= fecha))
      .map((k) => ({
        contrato_id: k.contrato_id, docId: k.id, creado: iso(k.fecha_creacion),
        unidades: unidadesPorContrato.get(k.id) || 0,
      }))
      // El que tiene equipo colgando es el candidato con sentido: es de donde
      // saldrían los radios a devolver.
      .sort((a, b) => b.unidades - a.unidades || (a.creado < b.creado ? 1 : -1));

    const fila = {
      contrato: c.contrato_id, cliente: (c.cliente_nombre || "").slice(0, 32),
      accion: c.accion === "Renovación" ? "Renovación" : "Reemplazo",
      estado: c.estado, creado: fecha, seriales: Number(c.seriales_count || 0),
      entrega: c.entrega_confirmada ? "SI" : "",
      candidatos, docId: c.id,
    };
    const conEquipo = candidatos.filter((k) => k.unidades > 0);
    if (!candidatos.length) sinCandidato.push(fila);
    else if (candidatos.length === 1 || conEquipo.length === 1) unico.push(fila);
    else ambiguo.push(fila);
  }

  const pinta = (titulo, lista, nota) => {
    console.log(`\n=== ${titulo}: ${lista.length} ===`);
    if (nota) console.log(nota);
    for (const f of lista) {
      console.log(`\n  ${f.contrato}  (${f.accion} · ${f.estado} · creado ${f.creado} · ${f.seriales} seriales${f.entrega ? " · ENTREGADO" : ""})`);
      console.log(`    ${f.cliente}`);
      console.log(`    transicion.html?id=${f.docId}`);
      if (!f.candidatos.length) console.log("    (el cliente no tiene otros contratos vigentes → probablemente es de PAPEL)");
      f.candidatos.slice(0, 6).forEach((k) => console.log(
        `      ${k.unidades ? "◆" : "·"} ${String(k.contrato_id).padEnd(20)} ${k.creado}  ${k.unidades} unidad(es) en el pool`));
      if (f.candidatos.length > 6) console.log(`      … y ${f.candidatos.length - 6} más`);
    }
  };

  pinta("UN SOLO CANDIDATO CON EQUIPO — vinculación sin ambigüedad", unico,
    "  Son los únicos donde el origen se deduce solo. Aun así lo confirma un humano.");
  pinta("VARIOS CANDIDATOS — decide ventas/recepción", ambiguo,
    "  ◆ = ese contrato tiene equipo nuestro colgando (el candidato con sentido).");
  pinta("SIN CANDIDATO — el original no está en el sistema", sinCandidato,
    "  Vía correcta: marcarlos de PAPEL con su referencia, no inventar un vínculo.");

  if (TODOS) {
    console.log("\n\n=== CENSO COMPLETO (incl. adiciones y anulados) ===");
    console.table(huerfanos.map((c) => ({
      contrato: c.contrato_id, cliente: (c.cliente_nombre || "").slice(0, 28),
      accion: c.accion, tipo: c.codigo_tipo, estado: c.estado,
      creado: iso(c.fecha_creacion), mapeos: Number(c.transicion_mapeos_count || 0),
    })));
  }

  console.log("\n--- cómo se arregla cada uno ---");
  console.log("  Abrir contratos/transicion.html?id=<docId> → 'Vincular original(es)'.");
  console.log("  Eso escribe contrato_origen_ids[] y deja que onEntregaTransicion");
  console.log("  registre la devolución cuando se confirme la entrega.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
