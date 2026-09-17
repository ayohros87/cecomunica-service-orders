/**
 * backfill-reemplazo-origen.js — Escribe `reemplazo_origen` en los radios que
 * ENTRARON por una gestión de reemplazo y quedaron sin esa explicación.
 *
 * Por qué (decisión de Alberto, 2026-09-17, caso SilverKing / ALQ20260902-01):
 * el contrato que el cliente FIRMÓ no se reescribe — sus seriales son los del
 * papel. Lo que prueba que hoy tiene otro radio es LA ENTREGA que se le hizo
 * en la orden. Hasta ahora el entrante solo guardaba `reemplaza_a` (el serial
 * sustituido), así que el serial del sistema y el del contrato no cuadraban y
 * la explicación solo aparecía abriendo el kardex.
 *
 * Deja en la ficha del equipo: gestión que lo autorizó, radio al que sustituye,
 * orden con la que se entregó y contrato al que pertenece. Es el mismo campo
 * que ahora estampa el trigger onOrdenWriteGestion al registrarse la entrega.
 *
 * No toca el contrato ni el estado del equipo. Idempotente: salta las fichas
 * que ya lo tienen.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-reemplazo-origen.js            (dry-run)
 *   node scripts/backfill-reemplazo-origen.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const apply = process.argv.includes("--apply");

// La orden de PROGRAMACIÓN con la que se entregó el radio nuevo. Es la prueba
// del cambio, así que si la gestión no la tiene se deja en null antes que
// inventar una: mejor sin dato que con uno que no se puede verificar.
function ordenEntrega(g) {
  const o = g.ordenes || {};
  return o.programacion_id || (Array.isArray(o.programacion_ids) ? o.programacion_ids[0] : null) || null;
}

(async () => {
  const snap = await db.collection("gestiones").where("tipo", "==", "reemplazo").get();
  let items = 0, escritas = 0, yaEstaban = 0, sinFicha = 0;

  for (const d of snap.docs) {
    const g = d.data();
    if (g.deleted === true || g.estado === "anulada") continue;
    const orden = ordenEntrega(g);

    for (const it of (g.items || [])) {
      const entrante = String(it.serial_nuevo || "").trim();
      const saliente = String(it.serial_saliente || "").trim();
      if (!entrante || !saliente) continue;
      items++;

      const r = await pool.resolver(entrante, it.modelo_solicitado_id || it.modelo_id || null,
        it.modelo_solicitado || it.modelo || "");
      if (!r?.data) {
        sinFicha++;
        console.log(`  SIN FICHA ${entrante} · gestión ${d.id}`);
        continue;
      }
      if (r.data.reemplazo_origen) { yaEstaban++; continue; }

      console.log(`  ${entrante} sustituye a ${saliente} · gestión ${d.id} · entrega ${orden || "—"} · contrato ${it.contrato_id || "sin contrato"}`);
      if (!apply) continue;
      await r.ref.set({
        reemplaza_a: pool.normSerial(saliente),
        reemplazo_origen: {
          gestion_id: d.id,
          saliente: pool.normSerial(saliente),
          orden_entrega_id: orden,
          contrato_doc_id: it.contrato_doc_id || null,
          contrato_id: it.contrato_id || null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      escritas++;
    }
  }
  console.log(`\n${apply ? "APLICADO" : "DRY-RUN"}: ${items} ítem(s) de reemplazo, ${escritas} ficha(s) explicadas, ${yaEstaban} ya lo tenían, ${sinFicha} sin ficha en el pool.`);
})().catch((e) => { console.error(e); process.exit(1); });
