/**
 * rescata-cierre-fichas-poc-2026-09-16.js — le devuelve a las fichas YA
 * cerradas la foto de lo que tenían (SIM, teléfono, operador, motivo, orden).
 *
 * POR QUÉ
 *   Cerrar la ficha limpia el SIM de POC (vuelve al pool) y eso está bien…
 *   salvo que ese es justo el dato con el que recepción pide la desconexión
 *   del airtime DESPUÉS de la devolución (Brenda, 2026-09-16: "busco el serial
 *   en PoC para enviárselo al Sr. Mariche y ya no aparece"). Desde hoy el
 *   cierre guarda esa foto en `cierre` (src/lib/pocCierre.js); este script la
 *   reconstruye para las fichas que se cerraron ANTES, leyendo el `antes` que
 *   el propio log de cierre guardó en poc_logs.
 *
 * QUÉ TOCA
 *   Solo fichas con deleted:true y SIN campo `cierre`. Escribe únicamente
 *   `cierre` — no reabre nada, no toca el SIM del pool, no cambia `activo`.
 *   Sin log de borrado con datos → se cuenta y se deja quieta.
 *
 * USAGE (desde functions/):
 *   node scripts/rescata-cierre-fichas-poc-2026-09-16.js            # informe
 *   node scripts/rescata-cierre-fichas-poc-2026-09-16.js --aplicar  # escribe
 */
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "cecomunica-service-orders" });

const db = admin.firestore();
const APLICAR = process.argv.includes("--aplicar");

const ms = (ts) => (ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : 0));
const txt = (v) => (v == null ? "" : String(v));

(async () => {
  // 1. Fichas cerradas sin foto.
  const cerradas = await db.collection("poc_devices").where("deleted", "==", true).get();
  const pendientes = new Map();
  cerradas.forEach(d => { if (!d.data().cierre) pendientes.set(d.id, d.data()); });
  console.log(`Fichas cerradas: ${cerradas.size} · sin foto de cierre: ${pendientes.size}`);
  if (!pendientes.size) return;

  // 2. El último log de borrado de cada una: ahí quedó el doc completo.
  const logs = await db.collection("poc_logs").where("accion", "==", "eliminar").get();
  const mejor = new Map();
  logs.forEach(l => {
    const x = l.data();
    if (!pendientes.has(x.equipo_id)) return;
    const prev = mejor.get(x.equipo_id);
    if (!prev || ms(x.fecha) > ms(prev.fecha)) mejor.set(x.equipo_id, x);
  });
  console.log(`Logs de borrado leídos: ${logs.size} · fichas con log: ${mejor.size}`);

  // 3. Reconstruir. `antes` es el doc tal como estaba al cerrarse.
  let conSim = 0, sinLog = 0, escritas = 0;
  let lote = db.batch(), enLote = 0;
  for (const [id, ficha] of pendientes) {
    const log = mejor.get(id);
    const antes = log?.cambios?.antes || {};
    if (!log) { sinLog++; continue; }
    const cierre = {
      at: log.fecha || ficha.updated_at || null,
      motivo: txt(log.motivo) || "Cerrada antes del 2026-09-16 (reconstruido del log)",
      ref: log.ref || null,
      // La ficha viva puede conservar el SIM (los borrados desde la pantalla de
      // POC no lo limpian); el log manda solo si ella ya no lo tiene.
      sim_number: txt(ficha.sim_number) || txt(antes.sim_number),
      sim_phone: txt(ficha.sim_phone) || txt(antes.sim_phone),
      operador: txt(ficha.operador) || txt(antes.operador),
      reconstruido: true,
    };
    if (cierre.sim_number) conSim++;
    if (APLICAR) {
      lote.set(db.collection("poc_devices").doc(id), { cierre }, { merge: true });
      if (++enLote >= 400) { await lote.commit(); lote = db.batch(); enLote = 0; }
    }
    escritas++;
  }
  if (APLICAR && enLote) await lote.commit();

  console.log(`\n${APLICAR ? "Escritas" : "Se escribirían"}: ${escritas} · con SIM recuperado: ${conSim} · sin log (se dejan quietas): ${sinLog}`);
  if (!APLICAR) console.log("Informe solamente. Corre con --aplicar para escribir.");
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
