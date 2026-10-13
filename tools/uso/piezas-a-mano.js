// Piezas escritas A MANO en las cotizaciones de taller (origen 'orden') que
// no están en inventario_piezas, para dárselas a inventario y darlas de alta
// (Solangel, 2026-10-13: "no utilizo mucho el catálogo, faltan códigos").
// Lee PRODUCCIÓN, solo lectura (Admin SDK con ADC). Nunca escribe.
//   cd functions && NODE_PATH=./node_modules node ../tools/uso/piezas-a-mano.js [meses=6]
const admin = require('firebase-admin');
if (process.env.FIRESTORE_EMULATOR_HOST) { console.error('Quita FIRESTORE_EMULATOR_HOST: este script lee producción'); process.exit(2); }
admin.initializeApp({ projectId: 'cecomunica-service-orders' });
const db = admin.firestore();
const MESES = Number(process.argv[2] || 6);

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

(async () => {
  const desde = new Date(); desde.setMonth(desde.getMonth() - MESES);
  const [piezasSnap, cotSnap] = await Promise.all([
    db.collection('inventario_piezas').get(),
    // Solo igualdad (la fecha se filtra aquí): origen+fecha pediría un índice compuesto.
    db.collection('cotizaciones').where('origen', '==', 'orden').get(),
  ]);
  cotSnap.docs = cotSnap.docs.filter(d => { const f = d.data().fecha_creacion; return f?.toDate && f.toDate() >= desde; });
  const skus = new Set(), nombres = new Set();
  piezasSnap.docs.forEach(d => { const p = d.data(); if (p.sku) skus.add(norm(p.sku)); if (p.nombre) nombres.add(norm(p.nombre)); });

  // Agrupa por (sku, nombre) normalizados; cuenta cotizaciones y unidades.
  const aMano = new Map();
  let cots = 0, items = 0, enCatalogo = 0;
  for (const d of cotSnap.docs) {
    const c = d.data(); if (c.deleted === true) continue; cots++;
    for (const it of (c.items || [])) {
      items++;
      const sku = String(it.modelo || '').trim(), nombre = String(it.nombre || '').trim();
      if ((sku && skus.has(norm(sku))) || (!sku && nombre && nombres.has(norm(nombre)))) { enCatalogo++; continue; }
      const k = norm(sku) + '|' + norm(nombre);
      const g = aMano.get(k) || { sku, nombre, veces: 0, unidades: 0, precios: new Set(), modelos: new Set(), ultima: '' };
      g.veces++; g.unidades += Number(it.cant || 0); g.precios.add(Number(it.precio || 0).toFixed(2));
      if (it.equipo?.modelo) g.modelos.add(it.equipo.modelo);
      const f = c.fecha_creacion?.toDate ? c.fecha_creacion.toDate().toISOString().slice(0, 10) : '';
      if (f > g.ultima) g.ultima = f;
      aMano.set(k, g);
    }
  }
  const lista = [...aMano.values()].sort((a, b) => b.veces - a.veces || a.nombre.localeCompare(b.nombre));
  console.log(`\n== Cotizaciones de taller desde ${desde.toISOString().slice(0, 10)}: ${cots} · líneas ${items} · en catálogo ${enCatalogo} · a mano ${items - enCatalogo} (${lista.length} piezas distintas)`);
  console.log(`== Catálogo inventario_piezas: ${piezasSnap.size} piezas\n`);
  console.log('veces  unid  última      sku                 nombre  ·  precios  ·  modelos');
  for (const g of lista) {
    console.log(`${String(g.veces).padStart(5)}  ${String(g.unidades).padStart(4)}  ${g.ultima.padEnd(10)}  ${g.sku.padEnd(18).slice(0, 18)}  ${g.nombre}  ·  ${[...g.precios].join('/')}  ·  ${[...g.modelos].join(', ')}`);
  }
  // CSV para José (sin precios de venta: eso es de ventas).
  const fs = require('fs'), path = require('path');
  const out = path.join(__dirname, 'piezas-a-mano.csv');
  fs.writeFileSync(out, '﻿sku;nombre;veces;unidades;ultima_vez;modelos\n' + lista.map(g =>
    [g.sku, g.nombre, g.veces, g.unidades, g.ultima, [...g.modelos].join(', ')].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(';')).join('\n'), 'utf8');
  console.log(`\nCSV: ${out}`);
})().catch(e => { console.error(e); process.exit(1); });
