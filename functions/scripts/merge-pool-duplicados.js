/**
 * merge-pool-duplicados.js — Fusión one-shot de docs duplicados del pool.
 *
 * La siembra (2026-07-14) aplicó el failsafe de colisión de modelos con los
 * labels desparejos de cada fuente (POC vs órdenes vs contratos), creando dos
 * docs de la MISMA unidad física; las correcciones de labels posteriores los
 * hicieron converger al mismo modelo. Ese doc fantasma produce avisos falsos
 * de "asignado a otro cliente" (caso 25725A0518, SEPROSA vs Central, jul-2026).
 *
 * Regla: por cada serial_norm con >1 doc, los que mismoModelo() declare la
 * misma unidad se fusionan en el doc "vivo" — el de ID sin sufijo si existe
 * (resolver() lo encuentra primero: los flujos lo vienen actualizando), si no
 * el de updated_at más reciente. Del doc fantasma se rellenan campos faltantes,
 * se copian sus movimientos (marcados fusionado_de) y se borra. Si el serial
 * queda con un solo doc, serial_compartido vuelve a false. Colisiones reales
 * (modelos distintos, tipo Kenwood NX420/NX920) no se tocan.
 *
 * USAGE (desde functions/):
 *   node scripts/merge-pool-duplicados.js            # dry-run
 *   node scripts/merge-pool-duplicados.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const { mismoModelo } = require("../src/domain/equiposPool");

const dryRun = !process.argv.includes("--write");
const ms = (t) => (t?.toDate ? t.toDate().getTime() : 0);

// Campos que el keeper adopta del fantasma solo si le faltan.
function rellenar(keeper, otro) {
  const upd = {};
  if (!keeper.modelo_id && otro.modelo_id) upd.modelo_id = otro.modelo_id;
  if (!(keeper.modelo_label || "").trim() && (otro.modelo_label || "").trim()) upd.modelo_label = otro.modelo_label;
  if ((keeper.propiedad || "desconocida") === "desconocida" && otro.propiedad && otro.propiedad !== "desconocida") upd.propiedad = otro.propiedad;
  // Asignación/POC del fantasma solo si el estado del keeper la admite — una
  // unidad en bodega/revisión/baja no carga asignación (quedaría "disponible
  // pero de alguien"); la historia del fantasma preserva quién la tuvo.
  const cargaAsignacion = !["en_bodega", "devuelto_revision", "baja"].includes(keeper.estado);
  if (cargaAsignacion && !keeper.poc_device_id && otro.poc_device_id) upd.poc_device_id = otro.poc_device_id;
  if (cargaAsignacion && !keeper.asignacion && otro.asignacion) upd.asignacion = otro.asignacion;
  if (!keeper.ingreso_bodega_at && otro.ingreso_bodega_at) upd.ingreso_bodega_at = otro.ingreso_bodega_at;
  if (keeper.verificado !== true && otro.verificado === true) upd.verificado = true;
  return upd;
}

(async () => {
  const snap = await db.collection("equipos_pool").get();
  const porNorm = new Map();
  snap.forEach((d) => {
    const p = d.data();
    const k = p.serial_norm || d.id.split("__")[0];
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k).push({ id: d.id, ref: d.ref, ...p });
  });

  const r = { grupos: 0, fusionados: 0, colisionesReales: 0 };
  for (const [normKey, docs] of porNorm) {
    if (docs.length < 2) continue;
    r.grupos++;

    // Componentes conexas por mismoModelo (en la práctica: pares).
    const usado = new Set();
    let fusionesEnGrupo = 0;
    for (const base of docs) {
      if (usado.has(base.id)) continue;
      const cluster = [base];
      usado.add(base.id);
      let creció = true;
      while (creció) {
        creció = false;
        for (const d of docs) {
          if (usado.has(d.id)) continue;
          if (cluster.some((c) => mismoModelo(c, d.modelo_id, d.modelo_label))) {
            cluster.push(d); usado.add(d.id); creció = true;
          }
        }
      }
      if (cluster.length < 2) continue;

      const keeper = cluster.find((d) => d.id === normKey)
        || cluster.slice().sort((a, b) => ms(b.updated_at) - ms(a.updated_at))[0];
      const fantasmas = cluster.filter((d) => d.id !== keeper.id);
      const sinBase = keeper.id !== normKey ? " (SIN doc base: keeper por updated_at)" : "";
      console.log(`\n${normKey}${sinBase} → conservar [${keeper.id}] ${keeper.modelo_label} (${keeper.estado}, ${keeper.asignacion?.cliente_nombre || "-"})`);

      for (const f of fantasmas) {
        console.log(`  fusiona [${f.id}] ${f.modelo_label} (${f.estado}, ${f.asignacion?.cliente_nombre || "-"})`);
        r.fusionados++; fusionesEnGrupo++;
        if (dryRun) continue;

        const movs = await f.ref.collection("movimientos").get();
        const batch = db.batch();
        movs.forEach((m) => {
          batch.set(keeper.ref.collection("movimientos").doc(), { ...m.data(), fusionado_de: f.id });
          batch.delete(m.ref);
        });
        batch.set(keeper.ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: null,
          tipo: "fusion_duplicado", de_estado: null, a_estado: null, ref: null,
          notas: `Fusión del doc duplicado ${f.id} (la siembra creó dos docs de la misma unidad); el duplicado quedaba "${f.estado}"${f.asignacion?.cliente_nombre ? ` con ${f.asignacion.cliente_nombre}` : ""}.`,
        });
        const upd = rellenar(keeper, f);
        batch.set(keeper.ref, { ...upd, updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        batch.delete(f.ref);
        await batch.commit();
      }

      // ¿El serial quedó con un solo doc? → ya no es compartido.
      const restantes = docs.filter((d) => !fantasmas.some((f) => f.id === d.id));
      if (restantes.length === 1 && restantes[0].serial_compartido) {
        console.log(`  serial_compartido → false en [${restantes[0].id}]`);
        if (!dryRun) await restantes[0].ref.set({ serial_compartido: false }, { merge: true });
      }
    }
    if (!fusionesEnGrupo) r.colisionesReales++;
  }

  console.log(`\nmerge-pool-duplicados — ${dryRun ? "DRY-RUN" : "ESCRITURA REAL"}`);
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
