/**
 * backfill-doc-tipo-representante.js — la palabra sale del número y pasa a ser
 * una respuesta.
 *
 * Contexto (2026-09-18): hasta hoy la ficha tenía UNA casilla para el documento
 * del representante, y quien tenía un pasaporte lo resolvía escribiendo la
 * palabra adentro: `representante_cedula: "PASAPORTE: XDB367055"`. Ahora el
 * formulario PREGUNTA (`representante_doc_tipo`), así que esas fichas se pueden
 * dejar derechas: el número en su casilla y el tipo en la suya.
 *
 * QUÉ TOCA — solo las fichas cuyo número TRAE UNA PALABRA adentro ("PASAPORTE:
 * X", "Céd. X"). Nada más:
 *   · Las que ya tienen un número limpio NO se tocan aunque les falte el tipo:
 *     sin respuesta, el contrato imprime "cédula", que es exactamente lo que
 *     imprimía antes. Escribirles el campo no cambiaría una coma y les
 *     ensuciaría el historial de la ficha a todas.
 *   · Las que tienen basura en la casilla (un nombre, un "-") tampoco: eso no
 *     lo arregla un script, lo arregla quien sepa cuál es el documento.
 *   · Los CONTRATOS ya emitidos no se tocan: son la prueba de lo que se firmó,
 *     y el documento que imprimen ya entiende la palabra vieja.
 *
 * Cada cambio queda en el historial de la ficha (trigger onClienteHistorial),
 * sin autor: no lo editó una persona.
 *
 * USAGE (desde functions/):
 *   node scripts/backfill-doc-tipo-representante.js             ensayo (no escribe)
 *   node scripts/backfill-doc-tipo-representante.js --aplicar   escribe
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const D = require("../../public/js/domain/docIdentidad.js");

const aplicar = process.argv.includes("--aplicar");

(async () => {
  const snap = await db.collection("clientes").get();
  const plan = [];
  snap.forEach((d) => {
    const c = d.data();
    const v = String(c.representante_cedula || c.cedula_representante || "").trim();
    if (!v) return;
    // ¿El número trae una palabra adentro? Se compara contra el mismo valor sin
    // la palabra: si cambia, es que la traía.
    const plano = v.replace(/\s+/g, " ").toUpperCase();
    const numero = D.limpiar(v);
    if (!numero || numero === plano) return;
    const tipo = D.tipo(v, undefined);
    if (c.representante_cedula === numero && c.representante_doc_tipo === tipo) return;
    plan.push({ id: d.id, nombre: c.nombre || "", antes: v, numero, tipo });
  });

  console.log(`clientes revisados: ${snap.size}`);
  console.log(`fichas a enderezar: ${plan.length}${aplicar ? "" : "  (ENSAYO — no se escribe nada)"}\n`);
  plan.forEach((p) => {
    console.log(`  ${p.nombre.slice(0, 44)}`);
    console.log(`    ${JSON.stringify(p.antes)}  →  numero=${JSON.stringify(p.numero)}  tipo=${p.tipo}`);
  });
  if (!plan.length || !aplicar) { process.exit(0); }

  console.log("\nescribiendo…");
  for (const p of plan) {
    await db.collection("clientes").doc(p.id).update({
      representante_cedula: p.numero,
      representante_doc_tipo: p.tipo,
    });
    console.log(`  OK ${p.id} — ${p.nombre.slice(0, 40)}`);
  }
  console.log(`\nlisto: ${plan.length} fichas.`);
  process.exit(0);
})().catch((e) => { console.error("FALLÓ:", e.message); process.exit(1); });
