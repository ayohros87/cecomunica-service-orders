/**
 * une-reposiciones-westin-2026111702.js — Las cuatro reposiciones por daño de
 * la orden 2026111702 (EUROLATIN HOSPITALITY CORP - WESTIN PLAYA BONITA) pasan
 * a cobrarse en la cotización que el taller ya le había enviado al cliente, y
 * las cuatro cotizaciones automáticas se descartan por duplicadas (correo de
 * Solangel del 19-nov-2026).
 *
 * QUÉ PASÓ. El QC descartó los cuatro radios por humedad. Solangel le envió al
 * cliente la COT-2026-0253 con los cuatro ($150 c/u, $642.00 con ITBMS) y
 * después propuso el reemplazo por daño de cada uno. Al aprobarse con cargo,
 * cada gestión armó su propia cotización (COT-2026-0255 a 0258), que ella se
 * autoenvió para poder seguir. Quedaban cinco cotizaciones vivas por el mismo
 * cobro y cuatro gestiones en `pendiente_cliente` amarradas a las que NO se
 * van a facturar.
 *
 *   COT-2026-0253  enviada al cliente   4 radios   ← la que se factura
 *   COT-2026-0255  GR20261119-01  23418A0383       ← duplicada
 *   COT-2026-0256  GR20261119-02  24220A2258       ← duplicada
 *   COT-2026-0257  GR20261119-03  23418A0384       ← duplicada
 *   COT-2026-0258  GR20261119-04  23418A0382       ← duplicada
 *
 * QUÉ HACE (lib/reposicionDano.unirACotizacion, la misma función probada en
 * functions/test-emulator/taller-reposicion.js, recorrido F):
 *   · las cuatro gestiones apuntan a la COT-2026-0253 y siguen esperando al
 *     cliente (NO se cierran, NO pasan a cobranza);
 *   · la COT-2026-0253 queda con `gestion_ids`: cuando Solangel marque
 *     "Respuesta del cliente → aceptó", las cuatro pasan a bodega y se abre
 *     UNA fila de facturación por $642.00;
 *   · las cuatro automáticas quedan "descartada" con el motivo (descartar no
 *     es rechazar: no dispara cobranza). No se borra nada.
 *
 * OJO, no lo decide este script: administración aprobó $180 por radio y la
 * cotización que recibió el cliente dice $150. Las gestiones conservan su
 * `cobro.monto` aprobado; lo que se factura es lo que el cliente acepte.
 *
 * Requiere desplegado el commit 6f9855c5 (los triggers leen `gestion_ids`).
 *
 * USAGE (desde functions/):
 *   node scripts/une-reposiciones-westin-2026111702.js            # ensayo
 *   node scripts/une-reposiciones-westin-2026111702.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const RD = require("../src/lib/reposicionDano");

const EXECUTE = process.argv.includes("--execute");
const ORDEN = "2026111702";
const CLIENTE = "l393CCQu7xqyQELqLQWr";
const DESTINO = { docId: "Phv2CR9fLuOlXJiya9TM", id: "COT-2026-0253" };
const ORIGEN = [
  { docId: "jOplv4HqW0t4Qbt0ONPM", id: "COT-2026-0255", gid: "GR20261119-01", serial: "23418A0383" },
  { docId: "FddxzrNXryT1lBTvTz9O", id: "COT-2026-0256", gid: "GR20261119-02", serial: "24220A2258" },
  { docId: "cV2u2Wz1QPOfkawmbH8d", id: "COT-2026-0257", gid: "GR20261119-03", serial: "23418A0384" },
  { docId: "n6ajhJlMFswOs8QmQfFW", id: "COT-2026-0258", gid: "GR20261119-04", serial: "23418A0382" },
];

(async () => {
  const exigir = (cond, msg) => { if (!cond) { console.error("ALTO: " + msg); process.exit(1); } };
  const cot = async (docId) => { const s = await db.doc(`cotizaciones/${docId}`).get(); return s.exists ? s.data() : null; };

  // Candados: el script solo corre sobre el caso exacto que se revisó.
  const dest = await cot(DESTINO.docId);
  exigir(dest && dest.cotizacion_id === DESTINO.id && dest.orden_id === ORDEN && dest.clienteId === CLIENTE, "la cotización de destino no es la COT-2026-0253 de la orden");
  if ((dest.gestion_ids || []).length === 4) { console.log("La COT-2026-0253 ya cobra las cuatro gestiones. Nada que hacer."); process.exit(0); }
  exigir(dest.estado === "enviada" && !dest.gestion_id && !(dest.gestion_ids || []).length, `la COT-2026-0253 no está como se revisó (${dest.estado})`);
  const serialesDest = (dest.items || []).map((i) => i.equipo?.serial).sort();
  exigir(JSON.stringify(serialesDest) === JSON.stringify(ORIGEN.map((o) => o.serial).sort()), "la COT-2026-0253 no cobra exactamente los cuatro radios");
  exigir(dest.total_con_itbms === 642, `el total de la COT-2026-0253 cambió (${dest.total_con_itbms})`);
  for (const o of ORIGEN) {
    const c = await cot(o.docId);
    exigir(c && c.cotizacion_id === o.id && c.gestion_id === o.gid && c.orden_id === ORDEN, `${o.id} no es la reposición de ${o.gid}`);
    exigir(c.estado === "enviada" && c.generada_por === "sistema:reposicion_dano" && !c.facturacion?.aviso_id, `${o.id} no está como se revisó (${c.estado})`);
    exigir(String(c.dirigido_email || "").endsWith("@cecomunica.com"), `${o.id} salió a un correo que no es interno (${c.dirigido_email}): revisar antes de descartarla`);
    exigir((c.items || []).length === 1 && c.items[0].equipo?.serial === o.serial, `${o.id} no es del radio ${o.serial}`);
    const g = (await db.doc(`gestiones/${o.gid}`).get()).data();
    exigir(g && g.estado === "pendiente_cliente" && g.cobro?.cotizacion_doc_id === o.docId, `${o.gid} no está esperando al cliente con ${o.id}`);
  }

  const r = await RD.unirACotizacion({
    origenDocIds: ORIGEN.map((o) => o.docId), destinoDocId: DESTINO.docId,
    porEmail: "script:une-reposiciones-westin-2026111702", execute: EXECUTE,
  });
  console.log(EXECUTE ? "HECHO:" : "ENSAYO (sin --execute no se escribe nada):");
  console.log("  se cobra en ........", r.destino, `· $${dest.total_con_itbms.toFixed(2)} con ITBMS`);
  console.log("  gestiones ..........", r.gestiones.join(", "));
  console.log("  descartadas ........", r.descartadas.join(", "));

  if (EXECUTE) {
    const d2 = await cot(DESTINO.docId);
    console.log("\nVerificación:");
    console.log("  COT-2026-0253 →", d2.estado, "· gestion_ids:", (d2.gestion_ids || []).join(", "));
    for (const o of ORIGEN) {
      const c = await cot(o.docId);
      const g = (await db.doc(`gestiones/${o.gid}`).get()).data();
      console.log(`  ${o.id} → ${c.estado} · ${o.gid} → ${g.estado}, cobra en ${g.cobro.cotizacion_id} (monto aprobado $${g.cobro.monto})`);
    }
    const cob = await db.collection("cobros_equipos").where("orden_id", "==", ORDEN).get();
    console.log("  renglones de cobranza de la orden:", cob.size, "(debe ser 0)");
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
