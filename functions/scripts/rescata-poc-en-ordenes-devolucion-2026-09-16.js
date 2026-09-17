/**
 * rescata-poc-en-ordenes-devolucion-2026-09-16.js — le pone a las devoluciones
 * ya hechas los datos de POC de los equipos que recibieron.
 *
 * POR QUÉ
 *   Desde hoy, recibir una unidad deja en la orden `devolucion.poc[serial_norm]`
 *   = {unit_id, radio_name, sim…} para pedir la desconexión del airtime sin
 *   volver a buscar en POC (onOrdenDevolucionWrite). Mariche desconecta con el
 *   Unit ID y el nombre del radio. Las devoluciones que ya cerraron no lo
 *   tienen — y son justamente las que están pendientes de desconexión (HASDAY,
 *   Einstein, AB SECURITY). Se reconstruye del log de cierre, que guardó la
 *   ficha completa. Volver a correrlo es inofensivo: reescribe el mismo mapa.
 *
 * QUÉ TOCA
 *   Solo `devolucion.poc` de las órdenes que nombra un log de POC con
 *   origen 'devolucion'. Con merge: no toca esperados, acuses ni estado.
 *
 * USAGE (desde functions/):
 *   node scripts/rescata-poc-en-ordenes-devolucion-2026-09-16.js            # informe
 *   node scripts/rescata-poc-en-ordenes-devolucion-2026-09-16.js --aplicar
 */
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "cecomunica-service-orders" });

const db = admin.firestore();
const APLICAR = process.argv.includes("--aplicar");
const norm = (s) => (s ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const txt = (v) => (v == null ? "" : String(v));

(async () => {
  const logs = await db.collection("poc_logs").where("origen", "==", "devolucion").get();
  const porOrden = new Map();
  logs.forEach(l => {
    const x = l.data();
    const ordenId = x.ref?.tipo === "orden" ? x.ref.id : null;
    const antes = x.cambios?.antes || {};
    const serial = norm(antes.serial);
    if (!ordenId || !serial) return;
    const m = porOrden.get(ordenId) || {};
    m[serial] = {
      serial: txt(antes.serial), unit_id: txt(antes.unit_id),
      radio_name: txt(antes.radio_name),
      sim_number: txt(antes.sim_number), sim_phone: txt(antes.sim_phone),
      operador: txt(antes.operador), ip: txt(antes.ip),
      ficha_id: x.equipo_id || null, at: x.fecha || null,
    };
    porOrden.set(ordenId, m);
  });

  console.log(`Logs de cierre por devolución: ${logs.size} · órdenes involucradas: ${porOrden.size}`);
  let escritas = 0, sinOrden = 0;
  for (const [ordenId, poc] of porOrden) {
    const ref = db.collection("ordenes_de_servicio").doc(ordenId);
    const snap = await ref.get();
    if (!snap.exists) { sinOrden++; continue; }
    const seriales = Object.keys(poc);
    const conNombre = seriales.filter(s => poc[s].unit_id && poc[s].radio_name).length;
    console.log(`  ${ordenId} · ${snap.data().cliente_nombre || ""} · ${seriales.length} equipo(s), ${conNombre} con Unit ID y nombre`);
    if (APLICAR) await ref.set({ devolucion: { poc } }, { merge: true });
    escritas++;
  }
  console.log(`\n${APLICAR ? "Escritas" : "Se escribirían"}: ${escritas} órdenes · sin orden en el sistema: ${sinOrden}`);
  if (!APLICAR) console.log("Informe solamente. Corre con --aplicar para escribir.");
})().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
