/**
 * purgar-pool-no-seriales.js — Borra de equipos_pool las fichas cuyo "serial"
 * no es un serial: texto sin un solo dígito ("CONSOLA", "GPS", "DEMO",
 * "MICROFONO", "CARGADORESYFUENTE", "CELULARCLIENTE"…).
 *
 * El campo serial se usa como cajón de sastre para lo que no es radio. El pool
 * los daba de alta y, peor, COLAPSABA en una sola ficha equipos de clientes
 * distintos: "CONSOLA" aparece en 55 devices POC de 36 clientes. Desde
 * 2026-07-27 esSerialValido exige un dígito y ya no entran; esto limpia el
 * rezago. NO se toca el documento de origen: la línea del equipo sigue viva en
 * su orden, contrato o device POC — solo desaparece la ficha derivada.
 *
 * Aborta la ficha (y avisa) si alguna orden de DEVOLUCIÓN la referencia por
 * pool_doc_id: ahí el borrado rompería el check-in.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/purgar-pool-no-seriales.js            # dry-run
 *   node scripts/purgar-pool-no-seriales.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  const [poolSnap, ordSnap] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("ordenes_de_servicio").get(),
  ]);

  // Fichas referenciadas por el check-in de una devolución (pool_doc_id).
  const referenciadas = new Map();
  for (const d of ordSnap.docs) {
    const o = d.data();
    if (o.eliminado === true) continue;
    for (const e of (o.devolucion?.esperados || [])) {
      if (e && e.pool_doc_id) referenciadas.set(e.pool_doc_id, d.id);
    }
  }

  const victimas = poolSnap.docs.filter((d) => {
    const n = d.data().serial_norm || d.id.split("__")[0];
    return n.length >= 3 && !/\d/.test(n);
  });

  console.log(`Fichas cuyo "serial" no lleva ningún dígito: ${victimas.length} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);
  let borradas = 0, protegidas = 0;
  for (const d of victimas) {
    const u = d.data();
    const movs = await d.ref.collection("movimientos").get();
    const ref = referenciadas.get(d.id);
    const linea = `  ${d.id.padEnd(34)} "${u.modelo_label || "sin modelo"}" · ${u.estado}`
      + ` · ${u.asignacion?.cliente_nombre || "sin asignación"} · ${movs.size} movimiento(s)`;
    if (ref) {
      console.log(`${linea}  ⟵ NO SE BORRA: la orden ${ref} la referencia`);
      protegidas++;
      continue;
    }
    console.log(linea);
    borradas++;
    if (!EXECUTE) continue;
    // El kardex es subcolección: se borra con la ficha.
    while (true) {
      const lote = await d.ref.collection("movimientos").limit(300).get();
      if (lote.empty) break;
      const b = db.batch();
      lote.docs.forEach((m) => b.delete(m.ref));
      await b.commit();
    }
    await d.ref.delete();
  }
  console.log(`\n${EXECUTE ? "ESCRITURA" : "DRY-RUN"} — fichas borradas: ${borradas} · protegidas por referencia: ${protegidas}`);
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
