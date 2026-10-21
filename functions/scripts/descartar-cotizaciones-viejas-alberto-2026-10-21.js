/**
 * descartar-cotizaciones-viejas-alberto-2026-10-21.js
 *
 * Limpieza del inicio (2026-10-21). "Mis cotizaciones activas" de Alberto
 * contaba 4 cotizaciones de febrero y junio que nadie iba a trabajar:
 *   · VUSYWTElnhxq5HrUtCvf  CEMENTO BAYANO CONCRETO   enviada  (feb-2026)
 *   · ujsoV8IizlruH5dox3Vr  AGENCIAS FEDURO S.A.      aprobada (jun-2026)
 *   · v6YMo1HeIkZm6t8PL4yi  AGENCIAS FEDURO S.A.      borrador (jun-2026)
 *   · wwTHgW0ISNYfE3HogxyA  PARADISE BEACH CORPORATION borrador (jun-2026)
 * Alberto pidió descartarlas (solo las suyas; las de Zuleika no se tocan).
 *
 * Qué hace: el MISMO sello que "Cerrar cotización → Otro motivo" del app
 * (CotState.patchCierre('descartada')): estado, fecha_descarte,
 * descartada_por_uid, cierre_motivo; y el espejo público
 * cotizacion_verificaciones.{id}.estado si existe (updateCotizacion).
 * `descartada` no cuenta como oportunidad perdida en la tasa de cierre.
 * Antes de escribir verifica que cada doc siga en el estado esperado y que
 * sea de Alberto; si algo no cuadra, no escribe nada.
 *
 * USAGE (desde functions/):
 *   node scripts/descartar-cotizaciones-viejas-alberto-2026-10-21.js          # dry-run
 *   node scripts/descartar-cotizaciones-viejas-alberto-2026-10-21.js --write
 */
const admin = require("firebase-admin");
if (process.env.FIRESTORE_EMULATOR_HOST) { console.error("Quita FIRESTORE_EMULATOR_HOST: este script es de producción"); process.exit(2); }
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const dryRun = !process.argv.includes("--write");

const EMAIL = "alberto.yohros@cecomunica.com";
const COTIZACIONES = {
  VUSYWTElnhxq5HrUtCvf: { estado: "enviada", desde: "febrero de 2026" },
  ujsoV8IizlruH5dox3Vr: { estado: "aprobada", desde: "junio de 2026" },
  v6YMo1HeIkZm6t8PL4yi: { estado: "borrador", desde: "junio de 2026" },
  wwTHgW0ISNYfE3HogxyA: { estado: "borrador", desde: "junio de 2026" },
};

(async () => {
  const u = await db.collection("usuarios").where("email", "==", EMAIL).limit(1).get();
  if (u.empty) throw new Error(`no existe el usuario ${EMAIL}`);
  const uid = u.docs[0].id;

  const planes = [];
  for (const [id, esperado] of Object.entries(COTIZACIONES)) {
    const snap = await db.collection("cotizaciones").doc(id).get();
    const c = snap.exists ? snap.data() : null;
    if (!c) throw new Error(`${id}: no existe`);
    if (c.deleted) throw new Error(`${id}: está eliminada`);
    if (c.creado_por_uid !== uid) throw new Error(`${id}: no es de ${EMAIL} (creado_por_uid=${c.creado_por_uid})`);
    if (c.estado !== esperado.estado) throw new Error(`${id}: estado ${c.estado}, se esperaba ${esperado.estado}`);
    planes.push({ id, cliente: c.cliente_nombre, estado: c.estado, motivo: `Sin movimiento desde ${esperado.desde}; limpieza del inicio (2026-10-21)` });
  }
  for (const p of planes) console.log(`${dryRun ? "[DRY-RUN] " : ""}${p.id}  ${p.cliente}  ${p.estado} → descartada  · ${p.motivo}`);
  if (dryRun) { console.log("\nNada escrito. Repite con --write."); return; }

  const ahora = admin.firestore.Timestamp.now();
  const batch = db.batch();
  for (const p of planes) {
    batch.update(db.collection("cotizaciones").doc(p.id), {
      estado: "descartada",
      fecha_descarte: ahora,
      descartada_por_uid: uid,
      cierre_motivo: p.motivo.slice(0, 300),
    });
  }
  await batch.commit();
  // Espejo público (best-effort, como updateCotizacion): solo si existe.
  for (const p of planes) {
    const v = db.collection("cotizacion_verificaciones").doc(p.id);
    if ((await v.get()).exists) await v.update({ estado: "descartada", estado_at: admin.firestore.FieldValue.serverTimestamp() });
  }
  console.log(`\nListo: ${planes.length} cotizaciones descartadas.`);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
