/**
 * backfill-expediente-clientes.js — el resumen del expediente legal en la
 * ficha de los clientes que YA tenían documentos.
 *
 * Contexto (2026-11-25): clientes/{id}.expediente lo mantiene el trigger
 * onClienteDocumentoWrite, que corre cuando se escribe un documento. Los
 * clientes que subieron documentos ANTES de ese trigger no tienen el campo, y
 * sin campo la ficha y el directorio los leen como "faltan los tres".
 *
 * QUÉ TOCA — solo clientes con algún doc en clientes/{id}/documentos (21 al
 * 2026-11-25). A cada uno le escribe `expediente` con la misma función que usa
 * el trigger (recalcular). No toca documentos, ni Storage, ni ningún otro
 * campo de la ficha; `expediente` no es campo auditado, así que no deja línea
 * en el historial. Volver a correrlo no cambia nada (si el resumen es el
 * mismo, no escribe).
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-expediente-clientes.js             ensayo (no escribe)
 *   node scripts/backfill-expediente-clientes.js --aplicar   escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const E = require("../src/domain/expedienteCliente");
const { recalcular } = require("../src/triggers/clientes/onClienteDocumentoWrite")._interno;

const aplicar = process.argv.includes("--aplicar");

(async () => {
  const snap = await db.collectionGroup("documentos").get();
  const porCliente = new Map();
  snap.forEach((d) => {
    const padre = d.ref.parent.parent;
    if (!padre || padre.parent.id !== "clientes") return;
    if (!porCliente.has(padre.id)) porCliente.set(padre.id, []);
    porCliente.get(padre.id).push(d.data() || {});
  });
  console.log(`${porCliente.size} clientes con documentos (${snap.size} docs, eliminados incluidos)\n`);

  let escritos = 0, iguales = 0, sinCliente = 0;
  for (const [cid, docs] of porCliente) {
    const cSnap = await db.collection("clientes").doc(cid).get();
    if (!cSnap.exists) { sinCliente++; console.log(`  ?  ${cid} — el cliente no existe`); continue; }
    const r = E.resumen(docs);
    const actual = cSnap.data().expediente;
    const igual = actual && E.mismoResumen(actual, r);
    const linea = `${(cSnap.data().nombre || cid).slice(0, 44).padEnd(44)} ${r.completo ? "COMPLETO " : `faltan ${r.faltan.length}`}${r.por_revisar ? ` · ${r.por_revisar} por revisar` : ""}`;
    if (igual) { iguales++; console.log(`  =  ${linea}`); continue; }
    if (aplicar) {
      const res = await recalcular(cid);
      if (res.escrito) escritos++;
      console.log(`  ${res.escrito ? "✓" : "·"}  ${linea}`);
    } else {
      escritos++;
      console.log(`  →  ${linea}`);
    }
  }
  console.log(`\n${aplicar ? "Escritos" : "Se escribirían"}: ${escritos} · ya al día: ${iguales} · sin cliente: ${sinCliente}`);
  if (!aplicar) console.log("Ensayo: no se escribió nada. Repetir con --aplicar.");
  process.exit(0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
