/**
 * limpia-incidencia-entrada-23905A0441-2026-09-30.js — Quita de la ENTRADA
 * 2026082605 (COMPAÑÍA GOLY) la incidencia "sin_ficha" del 23905A0441.
 *
 * QUÉ PASÓ (consulta de Brenda, 2026-09-30). La fila de la entrada quedó con el
 * modelo_id de PNC360S-R (el texto dice PNC460S-R; la ficha es PNC460-R): el
 * cierre del 27-ago no la encontró y anotó "sin_ficha". José Solís la mandó a
 * bodega a mano 20 minutos después; el 28-sep bodega la asignó al reemplazo
 * GR20260928-01 y el 29-sep se entregó a SEPROSA. La ficha está bien
 * (en_cliente, SEPROSA, reemplaza a 24O22A0053), pero el correo diario seguía
 * diciendo "no existe en inventario".
 *
 * QUÉ HACE: borra cierre_entrada_con_incidencias / cierre_entrada_incidencias
 * en la misma escritura, así el trigger no reintenta (reintentar mandaría a
 * bodega el radio que tiene SEPROSA). No toca la ficha ni la fila del equipo.
 *
 * USAGE (desde functions/):
 *   node scripts/limpia-incidencia-entrada-23905A0441-2026-09-30.js            # dry-run
 *   node scripts/limpia-incidencia-entrada-23905A0441-2026-09-30.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const ORDEN = "2026082605";

(async () => {
  const ref = db.collection("ordenes_de_servicio").doc(ORDEN);
  const o = (await ref.get()).data() || {};
  const inc = o.cierre_entrada_incidencias || [];
  console.log("incidencias:", JSON.stringify(inc));
  if (inc.length !== 1 || inc[0].serial !== "23905A0441") { console.log("No es el estado esperado; no se toca."); return; }
  const f = (await db.collection("equipos_pool").doc("23905A0441").get()).data() || {};
  console.log("ficha:", f.estado, f.modelo_label, f.asignacion && f.asignacion.cliente_nombre);
  if (f.estado !== "en_cliente") { console.log("La ficha no está en_cliente; no se toca."); return; }
  if (!EXECUTE) { console.log("dry-run: agrega --execute"); return; }
  await ref.set({
    cierre_entrada_con_incidencias: admin.firestore.FieldValue.delete(),
    cierre_entrada_incidencias: admin.firestore.FieldValue.delete(),
  }, { merge: true });
  console.log("Limpia.");
})();
