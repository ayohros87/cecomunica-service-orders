/**
 * audita-evidencia.js — ¿Con qué papel se sostiene lo que está en la calle?
 *
 * Contesta de una sola pasada las dos preguntas que hace una auditoría (y que
 * también hace un cliente cuando pide su información):
 *
 *   1. De cada equipo en poder de un cliente, ¿qué lo respalda? Contrato vivo,
 *      firmado (o que por diseño no firma), y recibo de la entrega.
 *   2. De cada gestión —reemplazo, aumento, baja, demo—, ¿quedó la evidencia
 *      de cada paso? Aprobación, firma del anexo, entrega, acuse.
 *
 * Nació de la auditoría del 2026-09-17. La versión de aquel día reportó tres
 * aumentos "sin rastro de firma" que SÍ la tenían: miraba solo dos de los
 * CUATRO caminos por los que un anexo queda firmado. De ahí la regla que
 * ordena este archivo — cada pregunta enumera todos sus caminos en un solo
 * lugar (`pruebaDeFirmaAnexo`, `pruebaDeEntrega`), para que agregar uno nuevo
 * sea tocar una función y no acordarse de tres scripts.
 *
 * Solo LEE. No escribe una sola línea en Firestore.
 *
 * USAGE (desde functions/):
 *   node scripts/audita-evidencia.js            resumen
 *   node scripts/audita-evidencia.js --detalle  + las filas flojas, una a una
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const detalle = process.argv.includes("--detalle");
const EN_CALLE = ["en_cliente", "asignado_contrato", "pendiente_cobro"];
const ENTREGADO = "ENTREGADO AL CLIENTE";
// Espejo de domain/contratoFirma.js: un REEMP sustituye una unidad bajo el
// contrato que el cliente YA firmó y un DEMO es un préstamo — ninguno lleva
// firma, y contarlos como pendientes infla el hueco con casos sanos.
const SIN_FIRMA = new Set(["REEMP", "DEMO"]);
const codigoTipo = (c) => c?.codigo_tipo
  || ({ Servicio: "SERV", Alquiler: "ALQ", Propio: "PROP", Reemplazo: "REEMP", Demo: "DEMO", Temporal: "TEMP" })[c?.tipo_contrato]
  || (String(c?.contrato_id || "").match(/^[A-Z]+/) || [null])[0];
const llevaFirma = (c) => !SIN_FIRMA.has(codigoTipo(c));

/**
 * Los CUATRO caminos por los que el anexo de un aumento queda firmado. Mirar
 * de menos aquí es lo que produjo el falso positivo de 2026-09-17.
 */
function pruebaDeFirmaAnexo(g) {
  if (g.anexo_firmado_path) return { ok: true, como: "anexo escaneado", quien: g.anexo_firmado_por || "—" };
  const fd = g.anexo_firma_digital;
  if (fd) {
    return { ok: true, como: "firma digital", quien: `${fd.firmante_nombre || "—"} (céd. ${fd.firmante_cedula || "—"})`,
      alerta: fd.coincide_representante === false ? "el firmante NO coincide con el representante del contrato" : "" };
  }
  if (g.sin_firma) return { ok: true, como: "sin firma, con sello", quien: g.sin_firma.por_email || "—" };
  if (g.cierre?.firma === true) return { ok: false, como: "SIN RASTRO", quien: "—" };
  return { ok: null, como: "aún no firmado", quien: "—" };
}

/** Evidencia de que el cliente recibió: firma digital o nota en papel. */
function pruebaDeEntrega(o) {
  if (o.firma_url) return { ok: true, como: "firma digital" };
  if (o.no_recibido) {
    return o.nota_firmada_url
      ? { ok: true, como: "firmó en papel (nota guardada)" }
      : { ok: false, como: "firmó en papel SIN copia de la nota" };
  }
  return { ok: false, como: "sin evidencia" };
}

(async () => {
  const [cSnap, oSnap, poolSnap, gSnap] = await Promise.all([
    db.collection("contratos").get(),
    db.collection("ordenes_de_servicio").get(),
    db.collection("equipos_pool").where("estado", "in", EN_CALLE).get(),
    db.collection("gestiones").get(),
  ]);
  const C = new Map(cSnap.docs.map((d) => [d.id, d.data()]));

  // ── 1) Recibo de entrega por serial ─────────────────────────────────────
  const entregaDe = new Map();
  const porMes = new Map();
  for (const d of oSnap.docs) {
    const v = d.data();
    if (v.eliminado || String(v.estado_reparacion || "").toUpperCase() !== ENTREGADO) continue;
    const p = pruebaDeEntrega(v);
    const f = v.fecha_entrega?.toDate?.() || v.fecha_creacion?.toDate?.() || null;
    const mes = f ? f.toISOString().slice(0, 7) : "sin fecha";
    const r = porMes.get(mes) || { ok: 0, no: 0 };
    r[p.ok ? "ok" : "no"]++; porMes.set(mes, r);
    for (const e of (v.equipos || [])) {
      const s = pool.normSerial(e.numero_de_serie || e.serial);
      if (!s) continue;
      const prev = entregaDe.get(s);
      if (!prev || (!prev.ok && p.ok)) entregaDe.set(s, { ...p, orden: d.id });
    }
  }
  console.log("=== RECIBO DE LA ENTREGA, por mes (últimos 8) ===");
  [...porMes.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-8).forEach(([m, r]) => {
    const t = r.ok + r.no;
    console.log(`  ${m}: ${String(t).padStart(4)} entregas · ${Math.round(r.ok * 100 / t)}% con recibo`);
  });

  // ── 2) Respaldo de lo que está en la calle ──────────────────────────────
  const clases = { A: 0, B: 0, C: 0, Cx: 0, D: 0, muerto: 0 };
  const flojos = [];
  for (const d of poolSnap.docs) {
    const v = d.data();
    const c = v.asignacion?.contrato_doc_id ? C.get(v.asignacion.contrato_doc_id) : null;
    const ent = entregaDe.get(pool.normSerial(v.serial || d.id));
    const estado = String(c?.estado || "").toLowerCase();
    let k;
    if (!c) k = "D";
    else if (["anulado", "vencido", "terminado"].includes(estado)) k = "muerto";
    else if (!c.firmado && llevaFirma(c)) k = "C";
    else if (!c.firmado) k = "Cx";
    else if (ent?.ok) k = "A";
    else k = "B";
    clases[k]++;
    if (k !== "A" && k !== "Cx") {
      flojos.push(`${k} · ${d.id} · ${v.asignacion?.cliente_nombre || "(sin cliente)"} · ${c?.contrato_id || "sin contrato"}${c ? ` (${c.estado})` : ""}`);
    }
  }
  const tot = poolSnap.size;
  const pct = (n) => `${String(n).padStart(5)} (${String(Math.round(n * 100 / tot)).padStart(2)}%)`;
  console.log(`\n=== RESPALDO DE ${tot} EQUIPOS EN PODER DE CLIENTES ===`);
  console.log(`  A) contrato firmado + recibo documentado     ${pct(clases.A)}`);
  console.log(`  B) contrato firmado, recibo no documentado   ${pct(clases.B)}`);
  console.log(`  C) contrato que lleva firma y no la tiene    ${pct(clases.C)}`);
  console.log(`     (REEMP/DEMO que por diseño no firman      ${String(clases.Cx).padStart(5)})`);
  console.log(`  D) sin contrato en el sistema                ${pct(clases.D)}`);
  console.log(`  !) bajo contrato anulado o vencido           ${pct(clases.muerto)}`);

  // ── 3) Evidencia por gestión ────────────────────────────────────────────
  console.log("\n=== GESTIONES: evidencia de cada paso ===");
  const alertas = [];
  for (const d of gSnap.docs.sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const g = d.data();
    if (g.estado === "anulada" || g.deleted) continue;
    const linea = [`${d.id} · ${g.tipo} · ${g.estado}`];
    if (g.tipo === "aumento") {
      const p = pruebaDeFirmaAnexo(g);
      linea.push(`firma: ${p.como}${p.quien !== "—" ? ` (${p.quien})` : ""}`);
      if (p.ok === false) alertas.push(`${d.id}: anexo aplicado SIN RASTRO de con qué se firmó`);
      if (p.alerta) alertas.push(`${d.id}: ${p.alerta}`);
    }
    // Acuses de las devoluciones de la gestión.
    const ordenes = Object.values(g.ordenes || {}).flat().filter(x => typeof x === "string");
    for (const oid of new Set(ordenes)) {
      const o = oSnap.docs.find((x) => x.id === oid)?.data();
      if (!o || String(o.tipo_de_servicio || "") !== "DEVOLUCION") continue;
      const esp = (o.devolucion?.esperados || []).filter((e) => e.resolucion === "recibido");
      const sin = esp.filter((e) => !e.acuse_id).length;
      linea.push(`devolución ${oid}: ${esp.length - sin}/${esp.length} con acuse`);
      if (sin) alertas.push(`${d.id}: ${sin} unidad(es) recibidas sin acuse en la devolución ${oid}`);
    }
    console.log(`  ${linea.join(" · ")}`);
  }

  console.log(`\n=== LO QUE HAY QUE MIRAR (${alertas.length}) ===`);
  alertas.forEach((a) => console.log(`  · ${a}`));
  if (detalle) {
    console.log(`\n=== EQUIPOS SIN RESPALDO COMPLETO (${flojos.length}) ===`);
    flojos.forEach((f) => console.log(`  ${f}`));
  } else if (flojos.length) {
    console.log(`\n(${flojos.length} equipos sin respaldo completo — corre con --detalle para verlos)`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
