/**
 * backfill-linaje-back-pointer.js — Estampa `renovado_por_ids` en los contratos
 * ORIGEN a partir del `contrato_origen_ids` que ya guardan los contratos nuevos.
 *
 * El vínculo de renovación/reemplazo solo existe hacia atrás (el contrato nuevo
 * apunta al viejo). El contrato viejo —el que tiene los equipos con el cliente—
 * no sabe que fue renovado, así que su propia fila no puede marcar que debería
 * estar devolviendo. onLinajeWrite mantiene el back-pointer de aquí en adelante;
 * esto lo aplica a lo ya existente.
 *
 * OJO: al 2026-08 solo ~5 de 232 contratos transicionables tienen el vínculo
 * registrado (ver colaInventarioService.js). Un resultado chico NO es un fallo
 * del script — es el tamaño real del hueco de datos.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/backfill-linaje-back-pointer.js            # dry-run
 *   node scripts/backfill-linaje-back-pointer.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const { origenIdsDe } = require("../src/lib/linaje");

const EXECUTE = process.argv.includes("--execute");

(async () => {
  const snap = await db.collection("contratos").get();
  console.log(`Contratos: ${snap.size} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}`);

  // origenId → Set(contratos nuevos que lo renuevan)
  const esperado = new Map();
  for (const d of snap.docs) {
    for (const origenId of origenIdsDe(d.data())) {
      if (origenId === d.id) continue;
      if (!esperado.has(origenId)) esperado.set(origenId, new Set());
      esperado.get(origenId).add(d.id);
    }
  }
  console.log(`Contratos con vínculo de origen: ${[...esperado.values()].reduce((s, v) => s + v.size, 0)}`);
  console.log(`Contratos origen a marcar:       ${esperado.size}`);

  const actual = new Map(snap.docs.map(d => [d.id, d.data()]));
  let tocados = 0, faltantes = 0;

  for (const [origenId, nuevos] of esperado) {
    const doc = actual.get(origenId);
    if (!doc) {
      // El origen puede ser un contrato borrado o un id inválido escrito a mano.
      console.log(`  ! ${origenId} — el contrato origen NO existe (referenciado por ${[...nuevos].join(", ")})`);
      faltantes++;
      continue;
    }
    const ya = new Set(Array.isArray(doc.renovado_por_ids) ? doc.renovado_por_ids : []);
    const agregar = [...nuevos].filter(id => !ya.has(id));
    if (!agregar.length) continue;

    console.log(`  ${doc.contrato_id || origenId} ← renovado por ${agregar.join(", ")}`);
    tocados++;
    if (!EXECUTE) continue;

    await db.collection("contratos").doc(origenId).set({
      renovado_por_ids: admin.firestore.FieldValue.arrayUnion(...agregar),
    }, { merge: true });
  }

  console.log(`\n${EXECUTE ? "Actualizados" : "Se actualizarían"}: ${tocados} contrato(s) origen`);
  if (faltantes) console.log(`Orígenes referenciados que no existen: ${faltantes} (revisar a mano)`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
