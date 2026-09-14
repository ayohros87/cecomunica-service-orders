/**
 * rescata-numero-factura.js — F3 de docs/plans/PLAN_COMISIONES.md.
 *
 * QUÉ ARREGLA
 *   El paso `qbo` tenía un solo campo, "Referencia (opcional)", con el
 *   placeholder "N.° de factura o nota": pedía dos cosas a la vez. Recepción
 *   —que lo viene llenando por su cuenta desde agosto, sin que nadie se lo
 *   pidiera— escribió tres formatos distintos en cuatro registros:
 *
 *     "Factura N° 10791"
 *     "Factura N° 10527"
 *     "FACTURA SIN FISCALIZAR CREADA EN QUICKBOOK BAJO EL N° 10429."
 *
 *   La verificación automática del pago consulta
 *   `select * from Invoice where DocNumber = '10791'`: necesita el número
 *   solo. La raíz se arregló separando los campos en la UI (2026-09-14); este
 *   script rescata lo que ya estaba escrito, a `pasos.qbo.factura`.
 *
 *   El texto original NO se toca: `pasos.qbo.ref` queda como estaba. Si el
 *   parseo se equivoca, la fuente sigue ahí para corregir.
 *
 * NO ADIVINA EN SILENCIO: cuando el texto tiene más de un número y ninguna
 * palabra que diga cuál es, lo saca aparte en una lista de REVISAR y no lo
 * escribe. La bandeja deja anotarlo a mano desde la fila.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/rescata-numero-factura.js            # dry-run
 *   node scripts/rescata-numero-factura.js --apply
 *   node scripts/rescata-numero-factura.js --apply --dudosos   # escribe también los ambiguos
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const FA = require("../src/lib/facturacionAvisos");

const APPLY = process.argv.includes("--apply");
const DUDOSOS = process.argv.includes("--dudosos");

(async () => {
  const snap = await db.collection("facturacion_avisos").get();
  const claros = [], dudosos = [], sinNumero = [], yaTienen = [];

  for (const d of snap.docs) {
    const a = d.data() || {};
    const q = a.pasos?.qbo;
    if (!q?.hecho) continue;
    const etiqueta = `${a.contrato_id || a.gestion_id || d.id} · ${a.cliente_nombre || "—"}`;
    if (q.factura) { yaTienen.push(etiqueta); continue; }
    if (!q.ref) { sinNumero.push({ etiqueta, por: q.por_email || q.fuente || "—" }); continue; }

    const r = FA.numeroFactura(q.ref);
    const fila = { ref: d.ref, etiqueta, texto: q.ref, ...r };
    if (!r.numero) sinNumero.push({ etiqueta, por: q.por_email || "—", texto: q.ref });
    // Con marcador o con un solo número no hay nada que adivinar.
    else if (r.fuente === "marcador" || r.fuente === "unico" || r.fuente === "limpio") claros.push(fila);
    else dudosos.push(fila);
  }

  console.log(`Pasos QBO marcados que ya traen número: ${yaTienen.length}`);
  console.log(`Sin nada que rescatar (el campo venía vacío): ${sinNumero.length}\n`);

  if (claros.length) {
    console.log(`CLAROS — ${claros.length}:`);
    claros.forEach(f => console.log(`  ${f.etiqueta}\n     "${f.texto}"  →  ${f.numero}   (${f.fuente})`));
  }
  if (dudosos.length) {
    console.log(`\nREVISAR — ${dudosos.length} (más de un número y ninguna palabra que diga cuál):`);
    dudosos.forEach(f => console.log(`  ${f.etiqueta}\n     "${f.texto}"  →  candidatos: ${f.candidatos.join(", ")}  (elegiría ${f.numero})`));
    console.log("  Se pueden anotar a mano desde la bandeja, o correr con --dudosos para aceptar la elección.");
  }
  const conTexto = sinNumero.filter(s => s.texto);
  if (conTexto.length) {
    console.log(`\nCON TEXTO PERO SIN NÚMERO — ${conTexto.length}:`);
    conTexto.forEach(s => console.log(`  ${s.etiqueta}: "${s.texto}"`));
  }

  const aEscribir = DUDOSOS ? claros.concat(dudosos) : claros;
  if (!aEscribir.length) { console.log("\nNada que escribir."); process.exit(0); }
  if (!APPLY) { console.log(`\nDRY-RUN. Con --apply se escriben ${aEscribir.length}.`); process.exit(0); }

  console.log("");
  let lote = db.batch();
  for (const f of aEscribir) {
    lote.set(f.ref, {
      pasos: { qbo: { factura: f.numero, factura_fuente: `rescate_${f.fuente}` } },
      historial: admin.firestore.FieldValue.arrayUnion({
        accion: "qbo_factura",
        detalle: `Número de factura rescatado del texto libre: ${f.numero} (de "${f.texto}")`,
        fecha_iso: new Date().toISOString(), por_email: null,
      }),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log(`  + ${f.etiqueta}: ${f.numero}`);
  }
  await lote.commit();
  console.log(`\nListo — ${aEscribir.length} escritos.`);
  process.exit(0);
})().catch((e) => { console.error("FALLO:", e.stack || e); process.exit(1); });
