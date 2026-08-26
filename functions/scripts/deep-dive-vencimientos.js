/**
 * deep-dive-vencimientos.js — Radiografía de SOLO LECTURA de los contratos y
 * sus vencimientos (2026-08-26, pedido de Alberto tras el backfill).
 *
 * Preguntas que responde:
 *  A) ¿Qué tipos de contrato quedaron con señal de vencimiento? (DEMO pidiendo
 *     renovación no hace sentido)
 *  B) ¿Cuántos contratos dicen accion="Renovación" pero NO tienen el linaje
 *     (contrato_origen_ids) — es decir, renovaciones sueltas que hacen que el
 *     viejo aparezca como "vencido sin renovar"?
 *  C) ¿Cuántos REEMP están sin origen (obligatorio desde 2026-08-11)?
 *  D) Para cada renovación suelta: ¿qué candidatos a origen hay en el mismo
 *     cliente? (mismo tipo, creado antes, vigente, no renovado ya)
 *
 * USAGE (desde functions/): node scripts/deep-dive-vencimientos.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const iso = (t) => { const d = t?.toDate ? t.toDate() : (t ? new Date(t) : null); return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "—"; };
const codigo = (c) => c.codigo_tipo || ({ "Alquiler": "ALQ", "Propio": "PROP", "Reemplazo": "REEMP", "Demo": "DEMO", "Temporal": "TEMP" }[c.tipo_contrato]) || (String(c.contrato_id || "").match(/^[A-Z]+/) || ["?"])[0];

(async () => {
  const snap = await db.collection("contratos").get();
  const todos = [];
  snap.forEach((d) => { const c = d.data(); if (!c.deleted) todos.push({ id: d.id, ...c }); });

  // ── A) tipo × vencimiento ──
  console.log("=== A) Vencimiento por tipo (no borrados) ===");
  const porTipo = {};
  for (const c of todos) {
    const k = codigo(c);
    porTipo[k] = porTipo[k] || { n: 0, conFecha: 0, vencidos: 0, porVencer: 0, vigentes: 0 };
    porTipo[k].n++;
    if (c.fecha_vencimiento) {
      porTipo[k].conFecha++;
      if (c.vencimiento_estado === "vencido") porTipo[k].vencidos++;
      else if (c.vencimiento_estado === "por_vencer") porTipo[k].porVencer++;
      else porTipo[k].vigentes++;
    }
  }
  Object.entries(porTipo).sort().forEach(([k, v]) =>
    console.log(`  ${k.padEnd(6)} total=${v.n}  conFecha=${v.conFecha}  vencidos=${v.vencidos}  por_vencer=${v.porVencer}  vigentes=${v.vigentes}`));

  // ── B) Renovaciones sueltas ──
  const vigente = (c) => ["activo", "aprobado"].includes(c.estado);
  const origenIds = (c) => Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length
    ? c.contrato_origen_ids : (c.contrato_origen_id ? [c.contrato_origen_id] : []);
  const sueltas = todos.filter((c) => c.accion === "Renovación" && !origenIds(c).length && vigente(c));
  console.log(`\n=== B) accion="Renovación" SIN origen (vigentes): ${sueltas.length} ===`);

  // ── C) REEMP sin origen ──
  const reempSueltos = todos.filter((c) => codigo(c) === "REEMP" && !origenIds(c).length && vigente(c));
  console.log(`=== C) REEMP sin origen (vigentes): ${reempSueltos.length} ===`);

  // ── D) candidatos por renovación suelta ──
  const porCliente = new Map();
  for (const c of todos) {
    if (!c.cliente_id) continue;
    if (!porCliente.has(c.cliente_id)) porCliente.set(c.cliente_id, []);
    porCliente.get(c.cliente_id).push(c);
  }
  const ms = (t) => (t?.toMillis ? t.toMillis() : (t ? new Date(t).getTime() : 0));
  console.log(`\n=== D) Candidatos a origen por renovación suelta ===`);
  let auto = 0, ambiguas = 0, sinCandidato = 0;
  for (const n of sueltas) {
    const hermanos = (porCliente.get(n.cliente_id) || []).filter((v) =>
      v.id !== n.id
      && codigo(v) === codigo(n)                    // mismo tipo (ALQ→ALQ, PROP→PROP)
      && vigente(v)
      && ms(v.fecha_creacion) < ms(n.fecha_creacion)  // creado antes
      && !(Array.isArray(v.renovado_por_ids) && v.renovado_por_ids.length)); // no renovado ya
    hermanos.sort((a, b) => ms(b.fecha_creacion) - ms(a.fecha_creacion));
    const tag = hermanos.length === 0 ? "SIN-CANDIDATO" : hermanos.length === 1 ? "AUTO" : "AMBIGUA";
    if (tag === "AUTO") auto++; else if (tag === "AMBIGUA") ambiguas++; else sinCandidato++;
    console.log(`  [${tag}] ${n.contrato_id} (${n.cliente_nombre || "?"}, creado ${iso(n.fecha_creacion)}, estado ${n.estado})`);
    hermanos.slice(0, 3).forEach((h, i) =>
      console.log(`      ${i === 0 ? "→" : " "} ${h.contrato_id}  creado ${iso(h.fecha_creacion)}  vence ${iso(h.fecha_vencimiento)}  [${h.vencimiento_estado || "—"}]  unidades=${(h.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0)}`));
  }
  console.log(`\nResumen D: auto=${auto}  ambiguas=${ambiguas}  sin candidato=${sinCandidato}`);

  // ── E) vencidos que en realidad YA fueron renovados (linaje existente) ──
  const vencidosRenovados = todos.filter((c) => c.vencimiento_estado === "vencido"
    && Array.isArray(c.renovado_por_ids) && c.renovado_por_ids.length);
  console.log(`\n=== E) Vencidos con renovado_por_ids (señal de renovación sobra): ${vencidosRenovados.length} ===`);
  vencidosRenovados.slice(0, 15).forEach((c) =>
    console.log(`  ${c.contrato_id}  ${c.cliente_nombre || "?"}  renovado por ${(c.renovado_por_ids || []).join(",")}`));

  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e); process.exit(1); });
