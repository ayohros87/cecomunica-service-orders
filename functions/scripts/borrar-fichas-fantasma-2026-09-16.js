/**
 * borrar-fichas-fantasma-2026-09-16.js
 *
 * Tres fichas del pool que NUNCA existieron como radios: las creó el camino
 * viejo de "editar serial" dentro de una orden (2026-09-15), probando la
 * función sobre la OS 2026091504 de R. SMITH ALTA PLAZA. Al teclear un serial
 * inventado, `onOrdenWritePool` lo daba de alta por contacto
 * (origen: migracion_orden) y la ficha quedaba `en_cliente` — inflando la
 * flota del cliente. Ese camino ya se cerró para órdenes de gestión.
 *
 * ANTES de borrar comprueba que nadie las referencie: órdenes, gestiones y
 * seriales de contrato. Si alguna aparece, NO se borra — una ficha citada en
 * algún sitio no es basura, es un dato que hay que entender primero.
 *
 * USAGE (desde functions/):
 *   node scripts/borrar-fichas-fantasma-2026-09-16.js            # dry-run
 *   node scripts/borrar-fichas-fantasma-2026-09-16.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const N = (s) => (s ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const FANTASMA = ["18607A05001", "18607A0500123", "18607A05123"];

async function referencias(serial) {
  const n = N(serial);
  const refs = [];

  const ordenes = await db.collection("ordenes_de_servicio")
    .where("cliente_id", "==", "katEufVrQ8SJwMOwujNR").get();
  ordenes.forEach((d) => {
    if ((d.data().equipos || []).some((e) => N(e.serial) === n || N(e.numero_de_serie) === n)) {
      refs.push(`orden ${d.id}`);
    }
    if ((d.data().devolucion?.esperados || []).some((e) => N(e.serial) === n)) {
      refs.push(`devolución de la orden ${d.id}`);
    }
  });

  const gs = await db.collection("gestiones").where("seriales_norm", "array-contains", n).get();
  gs.forEach((d) => refs.push(`gestión ${d.id}`));

  // Por los contratos DEL CLIENTE, no por collectionGroup: esa consulta pide
  // un índice de grupo que no existe (y no vale la pena crearlo para esto).
  // Una ficha fantasma solo pudo llegar a los seriales de este cliente.
  const contratos = await db.collection("contratos")
    .where("cliente_id", "==", "katEufVrQ8SJwMOwujNR").get();
  for (const c of contratos.docs) {
    const se = await c.ref.collection("seriales").get();
    if (se.docs.some((x) => N(x.data()?.serial) === n)) {
      refs.push(`seriales del contrato ${c.data().contrato_id || c.id}`);
    }
  }

  return refs;
}

async function borrarConSubcolecciones(ref) {
  for (const sub of await ref.listCollections()) {
    const docs = await sub.get();
    for (const d of docs.docs) await d.ref.delete();
  }
  await ref.delete();
}

(async () => {
  let borradas = 0;
  for (const serial of FANTASMA) {
    const ref = db.collection("equipos_pool").doc(serial);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`${serial}: ya no existe`); continue; }
    const d = snap.data();
    const refs = await referencias(serial);
    console.log(`\n${serial} | ${d.estado} | origen=${d.origen || "-"} | cliente=${d.asignacion?.cliente_nombre || "-"}`);
    if (refs.length) {
      console.log(`  ⚠ NO se borra: la citan ${refs.join(", ")}`);
      continue;
    }
    console.log("  ✓ sin referencias en órdenes, gestiones ni contratos");
    if (!dryRun) { await borrarConSubcolecciones(ref); console.log("  borrada"); }
    borradas++;
  }
  console.log(`\n${dryRun ? "[dry-run] " : ""}${borradas} ficha(s) ${dryRun ? "a borrar" : "borradas"}.`);
  if (dryRun) console.log("Nada escrito. Corre con --write para aplicar.");
  process.exit(0);
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
