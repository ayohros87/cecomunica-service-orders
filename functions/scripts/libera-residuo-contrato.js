/**
 * libera-residuo-contrato.js — libera del pool las unidades asignadas a un
 * contrato que ESE contrato ya no lista en su subcolección `seriales`.
 *
 * Es la contraparte manual del chequeo G de la conciliación: corrige el
 * residuo que dejaban los triggers cuando se editan los seriales de un
 * contrato con la orden de entrega ya abierta (las unidades viejas estaban
 * en_taller, fuera del `soloDesde` de la liberación, y se quedaban contratadas
 * para siempre). Caso original: PROP20260731-01 con 24 fichas para 12 radios.
 *
 * Qué hace por ficha residual:
 *   · asignado_contrato | en_cliente | por_clasificar → en_bodega, asignación
 *     suelta, verificado:false (nadie miró la unidad: puede ser typo).
 *   · en_taller → solo suelta la asignación (el radio SÍ está en el taller).
 *   · poc_device_id que apunta a un device cuyo serial ya es otro → se limpia.
 *   · vendido | baja | devuelto_revision → NO se toca, se reporta para revisar
 *     a mano (son hechos de propiedad o devoluciones en curso).
 *
 * USAGE (desde functions/):
 *   node scripts/libera-residuo-contrato.js PROP20260731-01           # dry-run
 *   node scripts/libera-residuo-contrato.js PROP20260731-01 --aplicar
 *   ...admite varios contratos: ... PROP20260731-01 PROP20260731-02 --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const APLICAR = process.argv.includes("--aplicar");
const CONTRATOS = process.argv.slice(2).filter((a) => !a.startsWith("--"));

// Estados desde los que la unidad puede volver al estante.
const A_BODEGA = [pool.ESTADOS.ASIGNADO, pool.ESTADOS.EN_CLIENTE, pool.ESTADOS.POR_CLASIFICAR];

async function procesar(numero) {
  const cs = await db.collection("contratos").where("contrato_id", "==", numero).get();
  if (cs.empty) { console.log(`\n### ${numero}: NO ENCONTRADO`); return; }
  if (cs.size > 1) console.log(`\n!!! ${numero}: ${cs.size} contratos con ese número — se procesan todos`);

  for (const doc of cs.docs) {
    const c = doc.data();
    const serSnap = await doc.ref.collection("seriales").get();
    const vigentes = new Set();
    serSnap.forEach((d) => {
      const n = pool.normSerial(d.data()?.serial || "");
      if (n) vigentes.add(n);
    });

    console.log(`\n### ${numero} (${doc.id}) — ${c.cliente_nombre || "?"} · estado ${c.estado}`);
    console.log(`    seriales del contrato: ${vigentes.size} · total_equipos: ${c.total_equipos ?? "?"}`);
    if (!vigentes.size) {
      console.log("    SIN seriales registrados — no hay contra qué comparar, se omite.");
      continue;
    }

    const pSnap = await db.collection("equipos_pool")
      .where("asignacion.contrato_doc_id", "==", doc.id).get();
    console.log(`    fichas asignadas en el pool: ${pSnap.size}`);

    const residuo = pSnap.docs.filter((d) => {
      const norm = d.data().serial_norm || d.id.split("__")[0];
      return !vigentes.has(norm);
    });
    if (!residuo.length) { console.log("    Sin residuo. ✔"); continue; }
    console.log(`    RESIDUO: ${residuo.length} ficha(s)\n`);

    for (const d of residuo) {
      const f = d.data();
      const acciones = [];
      const upd = {};

      if (f.estado === pool.ESTADOS.EN_TALLER) {
        acciones.push("suelta asignación (sigue en_taller)");
        upd.asignacion = null;
      } else if (A_BODEGA.includes(f.estado)) {
        acciones.push(`${f.estado} → en_bodega + suelta asignación + verificado:false`);
        upd.estado = pool.ESTADOS.EN_BODEGA;
        upd.asignacion = null;
        upd.verificado = false;
      } else {
        console.log(`  ${d.id.padEnd(14)} estado ${f.estado} — NO SE TOCA (revisar a mano)`);
        continue;
      }

      // Enlace POC obsoleto: el device ya lleva OTRO serial.
      if (f.poc_device_id) {
        const dev = await db.collection("poc_devices").doc(f.poc_device_id).get();
        const serialDev = dev.exists ? pool.normSerial(dev.data().serial || "") : null;
        const propio = f.serial_norm || d.id.split("__")[0];
        if (!dev.exists || serialDev !== propio) {
          acciones.push(`desenlaza poc_device_id (device lleva ${serialDev || "(borrado)"})`);
          upd.poc_device_id = null;
        }
      }

      console.log(`  ${d.id.padEnd(14)} ${acciones.join(" · ")}`);
      if (!APLICAR) continue;

      upd.updated_at = admin.firestore.FieldValue.serverTimestamp();
      await d.ref.set(upd, { merge: true });
      await d.ref.collection("movimientos").add({
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: null,
        tipo: "liberacion",
        de_estado: f.estado,
        a_estado: upd.estado || f.estado,
        ref: { tipo: "contrato", id: doc.id, label: numero },
        notas: "Residuo de asignación: el contrato ya no lista este serial "
          + "(corrección manual, scripts/libera-residuo-contrato.js)",
      });
    }
  }
}

(async () => {
  if (!CONTRATOS.length) {
    console.error("Falta el número de contrato. Ej: node scripts/libera-residuo-contrato.js PROP20260731-01");
    process.exit(1);
  }
  console.log(APLICAR ? "=== APLICANDO CAMBIOS ===" : "=== DRY-RUN (usa --aplicar para escribir) ===");
  for (const n of CONTRATOS) await procesar(n);
  console.log("\nListo.");
  process.exit(0);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
