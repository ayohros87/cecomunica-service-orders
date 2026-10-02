// Dos arreglos del catálogo de modelos (decisión de Alberto 2026-10-02,
// auditoría de módulos, Almacén y catálogo):
//
// 1. SEPURA SC2020. El modelo salía como "1-19000-00011 SC2020": el número de
//    parte de Sepura estaba en `marca`. Queda marca SEPURA, modelo SC2020.
//    - El catálogo NO tiene campo de número de parte (los campos de `modelos`
//      son marca/modelo/tipo/estado/notas/descripcion/aliases/precios/QBO…),
//      así que no se inventa uno: el número queda escrito en `notas` y el label
//      viejo como alias, para que un texto "1-19000-00011 SC2020" (kardex,
//      cotizaciones viejas) siga resolviendo a la misma fila en ModeloFamilia.
//    - La marca no es parte de ninguna clave: modeloKey() usa modelo_id cuando
//      existe (las 12 fichas del pool lo tienen), y el ID del doc del pool es
//      el serial. Lo que sí arrastra la marca es el label denormalizado
//      `modelo_label` de las fichas del pool y de agregados_pool: se alinea a
//      "SEPURA SC2020" (el trigger onPoolAgregado refresca el agregado solo; se
//      escribe igual para no depender de él). El kardex y las cotizaciones no se
//      tocan: son historia y documentos ya emitidos.
//
// 2. HYTERA NO APLICA. Se retira de lo que se puede elegir con `activo:false`
//    (el campo que ya respetan los selectores). Los contratos, órdenes y fichas
//    que lo traen se quedan como están.
//
// Por defecto SOLO MUESTRA lo que haría. Correr desde functions/:
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NODE_PATH=./node_modules node ../tools/catalogo-sc2020-y-no-aplica.js
//   … --aplicar                 escribe (en el emulador)
//   … --aplicar --produccion    escribe en PRODUCCIÓN (sin FIRESTORE_EMULATOR_HOST). Solo con el OK de Alberto.
const admin = require('firebase-admin');
const args = process.argv.slice(2);
const APLICAR = args.includes('--aplicar');
const PRODUCCION = args.includes('--produccion');
if (!process.env.FIRESTORE_EMULATOR_HOST && !PRODUCCION) {
  console.error('Sin FIRESTORE_EMULATOR_HOST. Para producción hay que pasar --produccion explícitamente (y tener el OK de Alberto).');
  process.exit(2);
}
if (PRODUCCION && process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('--produccion con FIRESTORE_EMULATOR_HOST puesto: quita uno de los dos.');
  process.exit(2);
}
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const USUARIO = 'sistema (catálogo SC2020 / NO APLICA)';

const PARTE = '1-19000-00011';
const LABEL_VIEJO = `${PARTE} SC2020`;
const LABEL_NUEVO = 'SEPURA SC2020';

async function filaUnica(desc, consultas) {
  const vistos = new Map();
  for (const q of consultas) (await q.get()).docs.forEach(d => vistos.set(d.id, d));
  const docs = [...vistos.values()];
  if (docs.length > 1) throw new Error(`${desc}: ${docs.length} filas candidatas (${docs.map(d => d.id).join(', ')}); no se adivina.`);
  return docs[0] || null;
}

(async () => {
  console.log(`${APLICAR ? 'APLICANDO' : 'VISTA PREVIA'} en ${PRODUCCION ? 'PRODUCCIÓN' : 'el emulador ' + process.env.FIRESTORE_EMULATOR_HOST}`);
  const M = db.collection('modelos');
  const escrituras = [];   // { ref, data, desc }

  // ── 1. SC2020 ──────────────────────────────────────────────────────────
  // Se busca por contenido (marca vieja) y, si ya se corrigió, por el nuevo:
  // el script es idempotente.
  const sc = await filaUnica('SC2020', [
    M.where('marca', '==', PARTE).where('modelo', '==', 'SC2020'),
    M.where('marca', '==', 'SEPURA').where('modelo', '==', 'SC2020'),
  ]);
  if (!sc) {
    console.log('SC2020: no hay fila en el catálogo; nada que hacer.');
  } else {
    const d = sc.data();
    console.log(`SC2020: modelos/${sc.id} hoy marca="${d.marca}" modelo="${d.modelo}" notas="${d.notas || ''}" aliases=${JSON.stringify(d.aliases || [])}`);
    const cambio = {};
    if (d.marca !== 'SEPURA') cambio.marca = 'SEPURA';
    const notas = String(d.notas || '');
    if (!notas.includes(PARTE)) cambio.notas = (notas ? notas + ' · ' : '') + `Nº de parte Sepura: ${PARTE}`;
    const aliases = Array.isArray(d.aliases) ? d.aliases : [];
    if (!aliases.includes(LABEL_VIEJO)) cambio.aliases = [...aliases, LABEL_VIEJO];
    if (Object.keys(cambio).length) {
      escrituras.push({ ref: sc.ref, desc: `modelos/${sc.id} ← ${JSON.stringify(cambio)}`,
        data: { ...cambio, actualizado_en: FV.serverTimestamp() } });
    } else console.log('  la fila ya está corregida.');

    // Label denormalizado en el pool (por modelo_id y, por si acaso, por el
    // label viejo sin modelo_id) y en el agregado.
    const pool = new Map();
    for (const q of [db.collection('equipos_pool').where('modelo_id', '==', sc.id),
                     db.collection('equipos_pool').where('modelo_label', '==', LABEL_VIEJO)]) {
      (await q.get()).docs.forEach(x => pool.set(x.id, x));
    }
    const porEstado = {};
    for (const x of pool.values()) {
      const e = x.data();
      porEstado[e.estado] = (porEstado[e.estado] || 0) + 1;
      if (e.modelo_label === LABEL_NUEVO && e.modelo_id === sc.id) continue;
      const data = { modelo_label: LABEL_NUEVO, updated_at: FV.serverTimestamp(), updated_by: null, updated_by_email: USUARIO };
      if (!e.modelo_id) data.modelo_id = sc.id;
      escrituras.push({ ref: x.ref, desc: `equipos_pool/${x.id} (${e.estado}) "${e.modelo_label || ''}" → "${LABEL_NUEVO}"${data.modelo_id ? ' + modelo_id' : ''}`, data });
    }
    console.log(`  fichas del pool de este modelo: ${pool.size} ${JSON.stringify(porEstado)}`);
    const ag = await db.collection('agregados_pool').doc(sc.id).get();
    if (ag.exists && ag.data().modelo_label !== LABEL_NUEVO) {
      escrituras.push({ ref: ag.ref, desc: `agregados_pool/${sc.id} "${ag.data().modelo_label}" → "${LABEL_NUEVO}"`,
        data: { modelo_label: LABEL_NUEVO } });
    }
  }

  // ── 2. HYTERA NO APLICA ────────────────────────────────────────────────
  const na = await filaUnica('HYTERA NO APLICA', [M.where('marca', '==', 'HYTERA').where('modelo', '==', 'NO APLICA')]);
  if (!na) {
    console.log('HYTERA NO APLICA: no hay fila en el catálogo; nada que hacer.');
  } else {
    const d = na.data();
    const [contratos, pool] = await Promise.all([
      db.collection('contratos').get(),
      db.collection('equipos_pool').where('modelo_id', '==', na.id).get(),
    ]);
    const nContratos = contratos.docs.filter(c => (c.data().equipos || []).some(e => e && e.modelo_id === na.id)).length;
    console.log(`HYTERA NO APLICA: modelos/${na.id} activo=${d.activo !== false} · contratos que lo traen: ${nContratos} · fichas del pool: ${pool.size} (no se tocan)`);
    if (d.activo !== false) {
      escrituras.push({ ref: na.ref, desc: `modelos/${na.id} ← activo:false`,
        data: { activo: false, actualizado_en: FV.serverTimestamp() } });
    } else console.log('  ya está retirado.');
  }

  console.log(`\nEscrituras: ${escrituras.length}`);
  escrituras.forEach(w => console.log('  ' + w.desc));
  if (!APLICAR) { console.log('\n(vista previa: no se escribió nada; pasa --aplicar)'); return; }
  for (let i = 0; i < escrituras.length; i += 400) {
    const b = db.batch();
    escrituras.slice(i, i + 400).forEach(w => b.update(w.ref, w.data));
    await b.commit();
  }
  console.log(`Aplicado: ${escrituras.length} docs.`);
})().catch(e => { console.error(e); process.exit(1); });
