/**
 * fix-reemplazo-ligo-23905A0437-2026-09-29.js — Pone en_cliente el radio de
 * reemplazo que TRANSPORTE LIGO ya tiene y el pool decía "en bodega".
 *
 * QUÉ PASÓ (reporte de José Solís, 2026-09-29). Gestión GR20260923-01: el
 * PNC550-R 21708A0008 (dañado, facturado 10837) se reemplazó por el PNC460-R
 * 23905A0437. El ítem de la gestión llevaba el modelo SOLICITADO (PNC550-R),
 * y la orden de programación 2026092403 nació con ese modelo_id. resolver()
 * no casó el serial con su ficha real (PNC460-R, otra familia) y partió una
 * ficha fantasma "23905A0437__h71xBSqhTKCGX1zkOrzC" (PNC550-R, en_taller con
 * LIGO), que es la que siguió el flujo de la orden.
 *
 * Solís resolvió el conflicto quedándose con la ficha correcta (PNC460-R,
 * flota Cecomunica) — bien hecho. Pero fusionarPoolFicha conserva el ESTADO
 * de la ficha elegida: quedó en_bodega, sin orden ni asignación. Al entregar
 * la orden (2026-09-25 20:21) el trigger solo mueve desde en_taller con
 * orden_actual_id == la orden → rebotó en silencio. Resultado: el radio está
 * con el cliente y el inventario lo ofrece como disponible.
 *
 * QUÉ HACE: en_bodega → en_cliente, con la asignación que tenía la ficha
 * fantasma (cliente LIGO, gestión GR20260923-01, sin contrato) y movimiento
 * en el kardex. No toca la orden ni la gestión (están cerradas; su modelo_id
 * PNC550-R queda como registro de lo que se pidió).
 *
 * USAGE (desde functions/):
 *   node scripts/fix-reemplazo-ligo-23905A0437-2026-09-29.js            # dry-run
 *   node scripts/fix-reemplazo-ligo-23905A0437-2026-09-29.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const DOC_ID = "23905A0437";
const ASIGNACION = {
  contrato_doc_id: null,
  contrato_id: null,
  cliente_id: "y4v9MaOjuH7GA6LevRHt",
  cliente_nombre: "TRANSPORTE LIGO, S.A.",
  gestion_doc_id: "GR20260923-01",
};

(async () => {
  const snap = await db.collection("equipos_pool").doc(DOC_ID).get();
  if (!snap.exists) throw new Error(`No existe la ficha ${DOC_ID}`);
  const d = snap.data();
  console.log(`Ficha ${DOC_ID}: ${d.modelo_label} · estado=${d.estado} · orden=${d.orden_actual_id} · asignacion=${JSON.stringify(d.asignacion)}`);
  // Paso 2 (idempotente): el linaje que la entrega no estampó porque tampoco
  // encontró la ficha (onOrdenWriteGestion.estamparLinaje).
  if (!d.reemplazo_origen) {
    const origen = {
      gestion_id: "GR20260923-01", saliente: "21708A0008", orden_entrega_id: "2026092403",
      contrato_doc_id: null, contrato_id: null,
      at: admin.firestore.Timestamp.fromDate(new Date("2026-09-25T20:21:57Z")),
    };
    console.log(`→ reemplazo_origen ${JSON.stringify({ ...origen, at: "2026-09-25T20:21:57Z" })}`);
    if (EXECUTE) {
      await snap.ref.set({ reemplaza_a: "21708A0008", reemplazo_origen: origen,
        updated_at: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    }
  }
  if (d.estado !== pool.ESTADOS.EN_BODEGA) {
    console.log("No está en_bodega — nada más que corregir (¿ya se corrigió o alguien la movió?).");
    return;
  }
  console.log(`→ ${pool.ESTADOS.EN_CLIENTE} con asignación ${JSON.stringify(ASIGNACION)}`);
  if (!EXECUTE) { console.log("\nDRY-RUN. Corre con --execute para aplicar."); return; }

  const r = await pool.transicionarPorId(DOC_ID, {
    aEstado: pool.ESTADOS.EN_CLIENTE,
    soloDesde: [pool.ESTADOS.EN_BODEGA],
    tipo: "correccion",
    refMov: { tipo: "orden", id: "2026092403", label: "2026092403" },
    notas: "Entregado a TRANSPORTE LIGO el 2026-09-25 (orden 2026092403, gestión GR20260923-01, "
      + "reemplaza a 21708A0008). La fusión del conflicto dejó la ficha en bodega y la entrega "
      + "no la movió — corrección 2026-09-29 por reporte de José Solís.",
    extra: { asignacion: ASIGNACION, orden_actual_id: null, reemplaza_a: "21708A0008" },
  });
  console.log("Resultado:", r);
})().catch((e) => { console.error(e); process.exit(1); });
