/**
 * fix-custodia-apmt-prestamo-2026-10-28.js
 *
 * Reporte del taller (2026-10-28): no se puede proponer el reemplazo de
 * B7310900 (OS 2026102107, APMT) porque el pool dice "Figura con otro cliente:
 * C COMUNICA, S.A.". El radio es parte del préstamo de octubre a APMT.
 *
 * Causa: bodega pasó los radios del préstamo por órdenes "PARA MAQUILLAJE" a
 * nombre del cliente interno C COMUNICA, S.A. (2026101204/09, 2026101301/05).
 * Esas órdenes no tienen contrato, así que onOrdenWritePool, al meter el
 * radio al taller, le estampó la custodia del cliente de la orden
 * (asignacionSiFalta → C COMUNICA). Después la entrega de la orden de
 * PRÉSTAMO a APMT también usa asignacionSiFalta, que nunca pisa una custodia
 * existente: el radio pasó a en_cliente pero siguió "con C COMUNICA".
 *
 *   · 16 radios salieron en las órdenes de PRÉSTAMO 2026101407, 2026101502 y
 *     2026101507 (ENTREGADO AL CLIENTE) y quedaron con custodia C COMUNICA.
 *   · B7310900 ni siquiera pasó por una orden de PRÉSTAMO: salió del
 *     maquillaje 2026101301 (entrega tardía 2026-10-15) y hoy está en_taller
 *     por la REPARACIÓN 2026102107 de APMT. El taller afirma que es del
 *     préstamo.
 *   · B7310900NX420R es una ficha fantasma: el serial se digitó con el modelo
 *     pegado ("B7310900 NX-420-R") al crear la OS 2026102107; se corrigió el
 *     2026-10-28 y la fantasma quedó en_cliente/APMT sin que nadie la cite.
 *
 * Qué hace:
 *   1. Los 17 radios: asignación → APMT PANAMA, S.A. (custodia sin contrato,
 *      igual que los otros 121 radios del préstamo). Propiedad y estado no se
 *      tocan. Movimiento 'reasignacion' en el kardex con la orden de PRÉSTAMO
 *      (o la OS 2026102107 para B7310900) como referencia.
 *   2. Borra la fantasma B7310900NX420R con sus movimientos.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-custodia-apmt-prestamo-2026-10-28.js          # dry-run
 *   node scripts/fix-custodia-apmt-prestamo-2026-10-28.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const WRITE = process.argv.includes("--write");
const EMAIL = "script:fix-custodia-apmt-prestamo-2026-10-28";
const APMT = { cliente_id: "4n11Y9wt2aItdYfBj1Om", cliente_nombre: "APMT PANAMA, S.A." };
const CCOM_ID = "6yoaiUMRAhhSMtiC4O0S";
const FANTASMA = "B7310900NX420R";
const OS_TALLER = "2026102107";

// serial → orden de PRÉSTAMO que lo entregó (kardex: salida_taller → en_cliente)
const ENTREGADOS = {
  B6711412: "2026101407", B6110170: "2026101407", B3900152: "2026101407", B6210532: "2026101407",
  B3600128: "2026101502", B6711358: "2026101502", B6711411: "2026101502", B8C10575: "2026101502",
  B5200158: "2026101502", B6711413: "2026101502", B3600222: "2026101502", B6210659: "2026101502",
  B8B10558: "2026101507", B3400054: "2026101507", B8B11211: "2026101507", B6210726: "2026101507",
};

const up = (s) => String(s || "").toUpperCase();
const norm = (s) => up(s).replace(/[^A-Z0-9]/g, "");

async function borrar(ref) {
  const movs = await ref.collection("movimientos").get();
  const b = db.batch();
  movs.docs.forEach((m) => b.delete(m.ref));
  b.delete(ref);
  await b.commit();
}

(async () => {
  console.log(WRITE ? "*** ESCRIBIENDO ***\n" : "*** DRY-RUN ***\n");
  const pool = db.collection("equipos_pool");

  // ── Salvaguardas ────────────────────────────────────────────────────────
  const planes = [];
  for (const [serial, osPrestamo] of Object.entries(ENTREGADOS)) {
    const snap = await pool.doc(serial).get();
    const d = snap.data();
    if (!d) throw new Error(`${serial} no existe en el pool`);
    if (d.estado !== "en_cliente" || d.propiedad !== "cecomunica" || d.asignacion?.cliente_id !== CCOM_ID || d.asignacion?.contrato_doc_id) {
      throw new Error(`${serial} no tiene la forma esperada: ${d.estado}/${d.propiedad}/${d.asignacion?.cliente_nombre}/${d.asignacion?.contrato_id}`);
    }
    const os = (await db.collection("ordenes_de_servicio").doc(osPrestamo).get()).data();
    if (!os || os.cliente_id !== APMT.cliente_id || up(os.estado_reparacion) !== "ENTREGADO AL CLIENTE") {
      throw new Error(`La orden ${osPrestamo} no es una entrega a APMT`);
    }
    if (!(os.equipos || []).some((e) => up(e.numero_de_serie || e.serial) === serial)) {
      throw new Error(`La orden ${osPrestamo} no trae ${serial}`);
    }
    const entregada = os.fecha_entrega?.toDate?.() || null;
    planes.push({
      serial, ref: snap.ref, d,
      refMov: { tipo: "orden", id: osPrestamo, label: os.numero_orden || osPrestamo },
      notas: `Entregado a APMT PANAMA, S.A. en la orden de PRÉSTAMO ${osPrestamo}`
        + (entregada ? ` (${entregada.toISOString().slice(0, 10)})` : "")
        + "; la custodia se había quedado con C COMUNICA, S.A. por la orden de maquillaje sin contrato. Corrección del 2026-10-28.",
    });
  }
  const b73 = await pool.doc("B7310900").get();
  const d73 = b73.data();
  if (!d73 || d73.estado !== "en_taller" || d73.propiedad !== "cecomunica" || d73.asignacion?.cliente_id !== CCOM_ID
      || d73.asignacion?.contrato_doc_id || d73.orden_actual_id !== OS_TALLER) {
    throw new Error(`B7310900 no tiene la forma esperada: ${JSON.stringify({ e: d73?.estado, p: d73?.propiedad, a: d73?.asignacion, o: d73?.orden_actual_id })}`);
  }
  const osT = (await db.collection("ordenes_de_servicio").doc(OS_TALLER).get()).data();
  if (!osT || osT.cliente_id !== APMT.cliente_id) throw new Error(`${OS_TALLER} no es de APMT`);
  if (!(osT.equipos || []).some((e) => up(e.numero_de_serie || e.serial) === "B7310900")) throw new Error(`${OS_TALLER} no trae B7310900`);
  planes.push({
    serial: "B7310900", ref: b73.ref, d: d73,
    refMov: { tipo: "orden", id: OS_TALLER, label: osT.numero_orden || OS_TALLER },
    notas: `Forma parte del préstamo de octubre a APMT PANAMA, S.A. según el taller (OS ${OS_TALLER}); salió del maquillaje 2026101301 sin orden de entrega a APMT y la custodia se quedó con C COMUNICA, S.A. Corrección del 2026-10-28 para poder tramitar el reemplazo.`,
  });

  const fant = await pool.doc(FANTASMA).get();
  if (fant.exists) {
    const f = fant.data();
    if (f.serial_norm !== FANTASMA || f.orden_actual_id || f.asignacion?.contrato_doc_id || f.venta || f.poc_device_id) {
      throw new Error(`${FANTASMA} no tiene la forma de fantasma: ${JSON.stringify(f)}`);
    }
    const gs = await db.collection("gestiones").where("seriales_norm", "array-contains", FANTASMA).get();
    if (gs.size) throw new Error(`Gestiones citan la fantasma: ${gs.docs.map((x) => x.id)}`);
    const citan = (await db.collection("ordenes_de_servicio").where("cliente_id", "==", APMT.cliente_id).get()).docs
      .filter((o) => (o.data().equipos || []).some((e) => norm(e.numero_de_serie || e.serial) === FANTASMA));
    if (citan.length) throw new Error(`Órdenes citan la fantasma: ${citan.map((x) => x.id)}`);
  }
  console.log("Salvaguardas OK.\n");

  // ── 1. Reasignar los 17 ────────────────────────────────────────────────
  for (const p of planes) {
    console.log(`  ${p.serial} (${p.d.modelo_label || p.d.modelo}, ${p.d.estado}): C COMUNICA, S.A. → APMT PANAMA, S.A.  ref ${p.refMov.id}`);
    if (!WRITE) continue;
    const b = db.batch();
    b.set(p.ref, {
      asignacion: { contrato_doc_id: null, contrato_id: "", ...APMT },
      updated_at: FV.serverTimestamp(), updated_by_email: EMAIL,
    }, { merge: true });
    b.set(p.ref.collection("movimientos").doc(), {
      tipo: "reasignacion", de_estado: p.d.estado, a_estado: p.d.estado,
      ref: p.refMov,
      notas: `Reasignado: antes con C COMUNICA, S.A. (sin contrato) — ${p.notas}`,
      at: FV.serverTimestamp(), por: "system", por_email: EMAIL,
    });
    await b.commit();
  }

  // ── 2. Fantasma ────────────────────────────────────────────────────────
  if (fant.exists) {
    console.log(`\n  ${FANTASMA}: BORRAR (serial "${fant.data().serial}", ${fant.data().estado}, nacida en la OS ${OS_TALLER} el 2026-10-21)`);
    if (WRITE) await borrar(fant.ref);
  } else {
    console.log(`\n  ${FANTASMA}: ya no existe`);
  }

  if (!WRITE) { console.log("\nDRY-RUN. Corre con --write."); process.exit(0); }

  // ── Verificación ───────────────────────────────────────────────────────
  let mal = 0;
  for (const p of planes) {
    const v = (await p.ref.get()).data();
    const ok = v.asignacion?.cliente_id === APMT.cliente_id && v.estado === p.d.estado && v.propiedad === "cecomunica";
    if (!ok) { mal++; console.log(`  OJO ${p.serial}: ${JSON.stringify(v.asignacion)} ${v.estado} ${v.propiedad}`); }
  }
  const fFin = await pool.doc(FANTASMA).get();
  console.log(`\n  ${planes.length - mal}/${planes.length} fichas con APMT; fantasma ${fFin.exists ? "OJO: sigue existiendo" : "borrada"}.`);
  console.log(mal || fFin.exists ? "OJO: revisar." : "Listo.");
  process.exit(0);
})().catch((e) => { console.error("ABORTADO:", e.message); process.exit(1); });
