/**
 * fix-visitas-en-taller.js — Devuelve a `en_cliente` las fichas que una VISITA
 * TÉCNICA mandó al taller.
 *
 * La visita se hace EN LAS INSTALACIONES DEL CLIENTE: el radio nunca sale de
 * ahí. Pero la orden caía en el flujo normal de onOrdenWritePool, así que
 * agregarle equipos los pasaba a en_taller; y como el terminal de una visita es
 * CERRADA (VISITA) mientras el retorno solo miraba ENTREGADO AL CLIENTE, la
 * unidad se quedaba "en taller" para siempre (chequeo B de la conciliación).
 * El trigger ya no las mueve; esto limpia lo que quedó.
 *
 * Conservador: SOLO toca fichas cuyo `orden_actual_id` apunta a la visita. Una
 * unidad en_taller que aparece en una visita vieja pero hoy cuelga de otra
 * orden está en el taller por esa otra orden — no se toca.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/fix-visitas-en-taller.js            # dry-run
 *   node scripts/fix-visitas-en-taller.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const norm = (s) => String(s || "").trim().toUpperCase();
const CERRADAS = new Set(["CERRADA (VISITA)", "ENTREGADO AL CLIENTE", "ANULADA"]);

(async () => {
  const [ordSnap, poolSnap] = await Promise.all([
    db.collection("ordenes_de_servicio").get(),
    db.collection("equipos_pool").get(),
  ]);

  const visitas = new Map();
  for (const d of ordSnap.docs) {
    const o = d.data();
    if (o.eliminado === true) continue;
    if (!/VISITA/.test(norm(o.tipo_de_servicio))) continue;
    visitas.set(d.id, { estado: norm(o.estado_reparacion), cliente: o.cliente_nombre || "" });
  }

  const plan = [];
  for (const d of poolSnap.docs) {
    const u = d.data();
    if (u.estado !== "en_taller" || !u.orden_actual_id) continue;
    const v = visitas.get(u.orden_actual_id);
    if (!v) continue;
    plan.push({ ref: d.ref, id: d.id, serial: u.serial, modelo: u.modelo_label,
      orden: u.orden_actual_id, visita: v, cerrada: CERRADAS.has(v.estado) });
  }

  console.log(`Visitas técnicas: ${visitas.size} · fichas en taller por una visita: ${plan.length}`
    + ` · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);
  plan.forEach((p) => console.log(
    `  ${p.serial} "${p.modelo}" · orden ${p.orden} [${p.visita.estado}] · ${p.visita.cliente}`
    + ` → en_cliente${p.cerrada ? " + suelta el link (visita cerrada)" : " (la visita sigue abierta: conserva el link)"}`));
  if (!EXECUTE) { console.log("\nDRY-RUN — nada escrito."); return; }

  for (const p of plan) {
    const cambios = { estado: "en_cliente", updated_at: admin.firestore.FieldValue.serverTimestamp() };
    if (p.cerrada) cambios.orden_actual_id = null;
    await p.ref.set(cambios, { merge: true });
    await p.ref.collection("movimientos").add({
      at: admin.firestore.FieldValue.serverTimestamp(),
      por: "system", por_email: null, tipo: "salida_taller",
      de_estado: "en_taller", a_estado: "en_cliente",
      ref: { tipo: "orden", id: p.orden, label: p.orden },
      notas: "Corrección: la visita técnica se hace donde el cliente — el equipo nunca salió de sus instalaciones.",
    });
  }
  console.log(`\nESCRITURA — fichas devueltas a en_cliente: ${plan.length}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
