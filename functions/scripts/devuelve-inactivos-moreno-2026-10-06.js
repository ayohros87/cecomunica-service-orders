/**
 * devuelve-inactivos-moreno-2026-10-06.js — deshace dos fichas del traslado
 * MORENO SECURITY GROUP → ASESORIA EN PROTECCION, S.A.
 * (traslada-poc-razon-social-2026-10-06.js).
 *
 * Aquel script decidió qué mover solo por el pool (por_clasificar/en_cliente
 * con la custodia de Moreno) y no miró si la ficha del POC estaba ACTIVA. Así
 * pasaron a Asesoría dos radios apagados en el POC, sin orden de servicio:
 *   23914A0996 (A-0996, unit 1241) — inactivo desde antes de ene-2026
 *   23411A1036 (TAURO-C, unit 1011) — inactivo; tiene otra ficha vieja e
 *                                      inactiva en GAMBOA TOURS
 * Brenda (activaciones) lo vio en el Centro: 23 equipos donde la cuenta tiene
 * 21. Estos dos se suman a los 7 que quedaron en Moreno para confirmar: no son
 * radios activos de la cuenta nueva hasta que bodega diga dónde están.
 *
 * Se revierte ficha (cliente/cliente_id + poc_logs) y custodia del pool. El
 * cambio de asignacion.cliente_id marca las dos cuentas y el barrido de
 * regularización las recalcula.
 *
 * USAGE (desde functions/):
 *   node scripts/devuelve-inactivos-moreno-2026-10-06.js            # simula
 *   node scripts/devuelve-inactivos-moreno-2026-10-06.js --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APLICAR = process.argv.includes("--aplicar");
const USUARIO = "script:devuelve-inactivos-moreno-2026-10-06";
const VIEJO = { id: "WqwErE7XQIHwazkuDHXN", nombre: "MORENO SECURITY GROUP" };
const NUEVO = { id: "QZYArwM26mQ7WiiFq7QS", nombre: "ASESORIA EN PROTECCION, S.A." };
const SERIALES = ["23914A0996", "23411A1036"];

(async () => {
  const batch = db.batch();
  for (const s of SERIALES) {
    const fichas = (await db.collection("poc_devices").where("serial", "==", s).where("cliente_id", "==", NUEVO.id).get()).docs;
    if (fichas.length !== 1) throw new Error(`${s}: se esperaba 1 ficha en ${NUEVO.nombre}, hay ${fichas.length}`);
    const f = fichas[0];
    if (f.data().activo !== false) throw new Error(`${s}: la ficha está activa — no se toca`);
    console.log(`ficha ${f.id} ${s} ${f.data().radio_name} → ${VIEJO.nombre}`);
    const antes = { cliente: NUEVO.nombre, cliente_id: NUEVO.id };
    const despues = { cliente: VIEJO.nombre, cliente_id: VIEJO.id };
    batch.update(f.ref, { ...despues, cliente_anterior: FV.delete(), updated_at: FV.serverTimestamp(), updated_by_email: USUARIO });
    batch.set(db.collection("poc_logs").doc(), {
      equipo_id: f.id, fecha: FV.serverTimestamp(), usuario: USUARIO, accion: "editar", origen: "sistema",
      motivo: `Se revierte el traslado de razón social: la ficha está inactiva y queda en ${VIEJO.nombre} por confirmar`,
      cambios: { antes, despues },
    });

    const poolRef = db.doc(`equipos_pool/${s}`);
    const p = (await poolRef.get()).data();
    if (p?.asignacion?.cliente_id === NUEVO.id) {
      console.log(`  pool ${s} (${p.estado}) custodia → ${VIEJO.nombre}`);
      batch.update(poolRef, {
        "asignacion.cliente_id": VIEJO.id, "asignacion.cliente_nombre": VIEJO.nombre,
        updated_at: FV.serverTimestamp(), updated_by_email: USUARIO,
      });
    } else {
      console.log(`  pool ${s}: custodia ${p?.asignacion?.cliente_nombre || "(ninguna)"} — no se toca`);
    }
  }
  if (!APLICAR) { console.log("\nSimulación. Corre con --aplicar para escribirlo."); process.exit(0); }
  await batch.commit();
  console.log("APLICADO.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
