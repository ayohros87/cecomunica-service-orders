/**
 * revierte-0741-fetrateda-2026-10-20.js — deshace la corrección del 2026-10-06
 * que devolvió a FETRATEDA el radio 24813A0741.
 *
 * CASO (Zuleika, 2026-10-20): 24813A0741 es el SALIENTE del REEMP20260618-01.
 * Volvió con la ENTRADA 2026062903 (29-jun), el taller lo descartó el 01-jul
 * (humedad y corrosión; el daño se le facturó al cliente) y el cierre del
 * 07-ago lo dejó en bodega — bien. El 06-oct
 * `repara-radios-sacados-por-entrada-2026-10-06.js` lo devolvió al cliente: su
 * "prueba" de que el radio había vuelto a salir era la asignación del backfill
 * del 15-jul (en_poc → en_cliente, auto-match por fecha) al MISMO contrato del
 * reemplazo, que ya existía antes de la ENTRADA. No era una salida: era el
 * registro de dónde estaba antes de volver. De los 37 radios de esa reparación
 * es el único así (revisado el 2026-10-20; 26123A0725 de PANAMA JET parecía
 * igual, pero es un radio nuevo entregado el 30-jun y la ENTRADA tiene el
 * serial mal tecleado en un campo).
 *
 * Vuelve al estado que dejó el cierre: en_bodega, sin asignación. Si tiene
 * ficha de POC reabierta por la reparación del 06-oct, solo se informa.
 *
 * USAGE (desde functions/):
 *   node scripts/revierte-0741-fetrateda-2026-10-20.js            # informe
 *   node scripts/revierte-0741-fetrateda-2026-10-20.js --aplicar
 */
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "cecomunica-service-orders" });
const pool = require("../src/domain/equiposPool");

const db = admin.firestore();
const APLICAR = process.argv.includes("--aplicar");
const SERIAL = "24813A0741";
const E = pool.ESTADOS;

(async () => {
  const ref = db.collection("equipos_pool").doc(SERIAL);
  const u = (await ref.get()).data();
  if (!u) return console.log(`${SERIAL}: no existe`);
  console.log(`${SERIAL}: hoy ${u.estado} · ${u.asignacion?.cliente_nombre || "—"} · ${u.asignacion?.contrato_id || "—"}`);
  const poc = await db.collection("poc_devices").where("serial", "==", SERIAL).get();
  poc.docs.forEach((d) => {
    const f = d.data();
    console.log(`  POC ${d.id} unit ${f.unit_id || "—"} · ${f.cliente_nombre || f.cliente || ""} · activo ${f.activo} · deleted ${f.deleted} · revertida ${!!f.cierre_revertido}`);
  });
  if (u.estado !== E.EN_CLIENTE || u.asignacion?.contrato_id !== "REEMP20260618-01") {
    return console.log("No está como lo dejó la corrección del 06-oct: no se toca.");
  }
  if (!APLICAR) return console.log("\nSimulación. Corre con --aplicar para devolverlo a bodega.");
  const r = await pool.transicionarPorId(SERIAL, {
    aEstado: E.EN_BODEGA,
    soloDesde: [E.EN_CLIENTE],
    tipo: "correccion_reversion",
    refMov: { tipo: "orden", id: "2026062903", label: "2026062903" },
    notas: "Deshace la corrección del 2026-10-06: el radio volvió con la ENTRADA 2026062903 (29-jun) y el taller lo descartó el 01-jul. La asignación del 15-jul era el backfill al contrato del reemplazo, no una salida (Zuleika, 2026-10-20).",
    extra: { orden_actual_id: null, asignacion: null },
  });
  console.log(`${SERIAL}: ${r}`);
})();
