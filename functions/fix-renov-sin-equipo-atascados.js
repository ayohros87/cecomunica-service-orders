/**
 * One-off: destraba contratos "Renovación sin equipo" que quedaron con
 * seriales pendientes porque el flujo viejo pedía seriales a inventario
 * aunque no hubiera equipo físico que entregar (caso Silverking
 * ALQ20260713-04, 2026-07-13).
 *
 * Para cada contrato aprobado/activo con accion === 'Renovación',
 * renovacion_sin_equipo === true y seriales_estado === 'pendiente':
 *   - escribe contratos/{id}/seriales_estado/current = { estado: 'asignados', por: 'system' }
 *     → esto dispara onSerialesAsignadasSendPdf, que envía a ACTIVACIONES el
 *       correo "Contrato APROBADO" con el banner de modalidad de renovación y
 *       el PDF adjunto (idempotente: si ya se envió, el trigger lo omite).
 *   - limpia los contadores de recordatorio a inventario.
 *
 * Auth: Application Default Credentials (gcloud auth application-default login
 * o firebase login + firebase use <project>).
 *
 * Usage:
 *   node fix-renov-sin-equipo-atascados.js                 # dry-run (no escribe)
 *   node fix-renov-sin-equipo-atascados.js --apply         # aplica
 *   node fix-renov-sin-equipo-atascados.js --id=<docId>    # solo ese contrato
 *   node fix-renov-sin-equipo-atascados.js --project=<id>
 */

const admin = require('firebase-admin');

const projectArg = process.argv.find(a => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : undefined;
admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const idArg = process.argv.find(a => a.startsWith('--id='));
const ONLY_ID = idArg ? idArg.split('=')[1] : null;

async function main() {
  let docs;
  if (ONLY_ID) {
    const snap = await db.collection('contratos').doc(ONLY_ID).get();
    if (!snap.exists) { console.error('No existe contratos/' + ONLY_ID); process.exit(1); }
    docs = [snap];
  } else {
    const snap = await db.collection('contratos')
      .where('seriales_estado', '==', 'pendiente')
      .get();
    docs = snap.docs;
  }

  let candidatos = 0;
  for (const doc of docs) {
    const c = doc.data() || {};
    const esRenovSinEquipo = c.accion === 'Renovación' && !!c.renovacion_sin_equipo;
    const elegible = !c.deleted
      && ['aprobado', 'activo'].includes(c.estado)
      && c.seriales_estado === 'pendiente'
      && (ONLY_ID ? true : esRenovSinEquipo);

    if (!elegible) {
      if (ONLY_ID) console.log(`SKIP ${doc.id} (${c.contrato_id}): estado=${c.estado} seriales=${c.seriales_estado} renovSinEquipo=${esRenovSinEquipo}`);
      continue;
    }

    candidatos++;
    console.log(`${APPLY ? 'FIX ' : 'DRY '} ${doc.id} — ${c.contrato_id} · ${c.cliente_nombre} (${c.renovacion_modalidad || 'sin modalidad'})`);

    if (APPLY) {
      await doc.ref.collection('seriales_estado').doc('current').set({
        estado: 'asignados',
        omisiones: [],
        por: 'system',
        at: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await doc.ref.set({
        seriales_recordatorio_count: admin.firestore.FieldValue.delete(),
        seriales_recordatorio_at: admin.firestore.FieldValue.delete(),
      }, { merge: true });
    }
  }

  console.log(`\n${candidatos} contrato(s) ${APPLY ? 'destrabado(s)' : 'por destrabar (dry-run — corre con --apply)'}.`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
