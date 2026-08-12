/**
 * analiza-contratos-desalineados.js — SOLO LECTURA. Contratos vigentes donde la
 * subcolección de seriales y el pool no cuentan lo mismo, serial por serial y
 * con la causa de cada diferencia.
 *
 * CONTEXTO (informe docs/INFORME_TRACKING_SERIAL_2026-08-12.md, brecha B3):
 * 12 de 62 contratos vigentes daban respuestas distintas según se preguntara a
 * `contratos/{id}/seriales` o a `equipos_pool.asignacion`. Este script dice POR
 * QUÉ difiere cada serial, clasificado:
 *
 *   REASIGNADA      la unidad existe pero su asignación apunta a OTRO contrato
 *                   (¿traspaso legítimo o pisada accidental? decide un humano
 *                   con el kardex — el movimiento 'reasignacion' dice cuándo)
 *   SIN ASIGNACION  la unidad existe, está suelta — si su estado es en_cliente
 *                   o asignado_contrato, re-asignarla al contrato es seguro
 *                   (es lo que onSerialWrite habría hecho); en_bodega/en_taller
 *                   NO se re-asigna a ciegas (pudo volver de un demo)
 *   SIN FICHA       el serial del contrato no existe en el pool (typo o unidad
 *                   jamás dada de alta)
 *   HUERFANA        la unidad está asignada al contrato pero su serial YA NO
 *                   está en la subcolección (residuo de una edición)
 *
 * USAGE (desde functions/): node scripts/analiza-contratos-desalineados.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const nk = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

(async () => {
  const [pool, cs] = await Promise.all([
    db.collection("equipos_pool").get(),
    db.collection("contratos").get(),
  ]);
  const contratos = new Map();
  cs.forEach((d) => contratos.set(d.id, { id: d.id, ...d.data() }));

  const fichasPorSerial = new Map();      // serial_norm -> [fichas]
  const asignadasPorContrato = new Map(); // cid -> [fichas]
  pool.forEach((d) => {
    const u = { docId: d.id, ...d.data() };
    const s = nk(u.serial_norm || d.id.split("__")[0]);
    if (!fichasPorSerial.has(s)) fichasPorSerial.set(s, []);
    fichasPorSerial.get(s).push(u);
    const cid = u.asignacion?.contrato_doc_id;
    if (cid) {
      if (!asignadasPorContrato.has(cid)) asignadasPorContrato.set(cid, []);
      asignadasPorContrato.get(cid).push(u);
    }
  });

  const vigentes = [...contratos.values()]
    .filter((c) => !c.deleted && ["activo", "aprobado"].includes(c.estado) && c.seriales_estado !== "legacy");

  let desalineados = 0;
  const porCausa = new Map();
  for (const c of vigentes) {
    const sub = await db.collection("contratos").doc(c.id).collection("seriales").get();
    const serialesSub = new Map();
    sub.forEach((d) => {
      const s = nk(d.data().serial);
      if (s) serialesSub.set(s, d.data());
    });
    const asignadas = asignadasPorContrato.get(c.id) || [];
    const asignadasSet = new Set(asignadas.map((u) => nk(u.serial_norm || u.docId.split("__")[0])));

    const problemas = [];
    for (const [s] of serialesSub) {
      if (asignadasSet.has(s)) continue;
      const fichas = fichasPorSerial.get(s) || [];
      if (!fichas.length) { problemas.push({ serial: s, causa: "SIN FICHA", detalle: "no existe en el pool" }); continue; }
      const f = fichas[0];
      if (f.asignacion?.contrato_doc_id) {
        const otro = contratos.get(f.asignacion.contrato_doc_id);
        problemas.push({ serial: s, causa: "REASIGNADA",
          detalle: `→ ${f.asignacion.contrato_id || "?"} (${otro ? otro.estado : "no existe"}) · estado ${f.estado}` });
      } else {
        problemas.push({ serial: s, causa: "SIN ASIGNACION", detalle: `estado ${f.estado}${fichas.length > 1 ? ` · ${fichas.length} fichas` : ""}` });
      }
    }
    for (const u of asignadas) {
      const s = nk(u.serial_norm || u.docId.split("__")[0]);
      if (!serialesSub.has(s)) {
        problemas.push({ serial: s, causa: "HUERFANA", detalle: `asignada al contrato pero fuera de la subcolección · estado ${u.estado}` });
      }
    }
    if (!problemas.length) continue;
    desalineados++;
    console.log(`\n=== ${c.contrato_id}  (${(c.cliente_nombre || "").slice(0, 40)}) · sub:${serialesSub.size} pool:${asignadas.length} ===`);
    problemas.forEach((p) => {
      porCausa.set(p.causa, (porCausa.get(p.causa) || 0) + 1);
      console.log(`  ${p.causa.padEnd(15)} ${p.serial.padEnd(18)} ${p.detalle}`);
    });
  }

  console.log(`\n=== RESUMEN: ${desalineados} contrato(s) desalineado(s) de ${vigentes.length} vigentes no-legacy ===`);
  [...porCausa.entries()].sort((a, b) => b[1] - a[1]).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
  console.log("\nCómo se arregla cada causa: REASIGNADA → kardex decide (traspaso vs pisada);");
  console.log("SIN ASIGNACION en_cliente → tocar el serial en la página de seriales re-sincroniza;");
  console.log("SIN FICHA → typo (corregir serial) o alta en Inventario·Equipos; HUERFANA → quitar del pool o re-agregar al contrato.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
