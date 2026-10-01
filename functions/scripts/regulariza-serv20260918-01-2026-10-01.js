/**
 * regulariza-serv20260918-01-2026-10-01.js — Cierra los dos cabos que dejó el
 * reemplazo de 22806A0291/0294 en SERV20260918-01 (INNOVACION & LOGISTICA
 * ALIMENTARIA), reportado por Zuleika el 2026-09-30.
 *
 * CONTEXTO. Los dos radios fallaron en la programación del propio contrato
 * (daño lógico, motivo dano_no_reparable) y se reemplazaron con GR20260918-01
 * y -02. La entrega del contrato los marcó en_cliente (arreglado en 80d10ef) y
 * bodega los corrigió a mano a en_bodega: desde el 18-sep figuran DISPONIBLES
 * para alquilar, siendo los radios que salieron por daño.
 *
 *   1) 22806A0291 y 22806A0294: en_bodega → devuelto_revision (que el taller
 *      decida si sirven, se reparan o se dan de baja). Solo si siguen en
 *      bodega y sin asignación — si alguien ya los tomó, no se tocan.
 *   2) SERV20260918-01 se anuló por sustitución SIN indicar sustituto
 *      ("sin contrato sustituto indicado"). Se liga a SERV20260928-01, donde
 *      ya están los 5 radios que siguieron con el cliente, y se retira la
 *      marca de pendiente. El contrato vigente no se toca.
 *
 * USAGE (desde functions/):
 *   node scripts/regulariza-serv20260918-01-2026-10-01.js            # dry-run
 *   node scripts/regulariza-serv20260918-01-2026-10-01.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");
const ANULADO = "3TVHAFv0mRwlXG9Yj6SP"; // SERV20260918-01
const SUSTITUTO = "Y9oxj2a1COgME0gytLqz"; // SERV20260928-01
const SALIENTES = [
  { serial: "22806A0291", gid: "GR20260918-01", entrante: "24220A2196" },
  { serial: "22806A0294", gid: "GR20260918-02", entrante: "22806A0297" },
];

(async () => {
  console.log(`Modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);

  // ── 1) Radios dañados fuera de "disponible" ──────────────────────────────
  for (const s of SALIENTES) {
    const d = (await db.doc(`equipos_pool/${s.serial}`).get()).data();
    const listo = d && d.estado === pool.ESTADOS.EN_BODEGA && !d.asignacion;
    console.log(`  ${s.serial}: ${d?.estado} asignacion=${JSON.stringify(d?.asignacion || null)} → ${listo ? "devuelto_revision" : "NO SE TOCA"}`);
    if (!listo || !EXECUTE) continue;
    const r = await pool.transicionar(s.serial, d.modelo_id || null, d.modelo_label || "", {
      aEstado: pool.ESTADOS.DEVUELTO,
      soloDesde: [pool.ESTADOS.EN_BODEGA],
      condicion: (doc) => !doc.asignacion,
      tipo: "reemplazo",
      refMov: { tipo: "gestion", id: s.gid, label: s.gid },
      notas: `Salió por daño lógico en el reemplazo ${s.gid} (lo sustituyó ${s.entrante}) y había quedado disponible en bodega por una corrección manual. Pasa a revisión del taller (regularización 2026-10-01, Alberto).`,
    });
    console.log(`    → ${r}`);
  }

  // ── 2) Vínculo de la sustitución ─────────────────────────────────────────
  const [a, b] = await Promise.all([db.doc(`contratos/${ANULADO}`).get(), db.doc(`contratos/${SUSTITUTO}`).get()]);
  const A = a.data(); const B = b.data();
  const chequeos = [
    [A.estado === "anulado" && A.anulacion_tipo === "sustitucion", "el origen está anulado por sustitución"],
    [!A.sustituido_por_id, "el origen no tiene sustituto indicado todavía"],
    [B.estado !== "anulado" && B.deleted !== true, `el sustituto está vivo (${B.estado})`],
    [A.cliente_id === B.cliente_id, "mismo cliente"],
  ];
  const continuan = ["22610A4037", "22806A0254", "22806A0258", "22806A0270", "24708A1176"];
  for (const s of continuan) {
    const d = (await db.doc(`equipos_pool/${s}`).get()).data();
    chequeos.push([d?.asignacion?.contrato_doc_id === SUSTITUTO, `${s} ya está en ${B.contrato_id}`]);
  }
  let ok = true;
  console.log(`\n  ${A.contrato_id} → ${B.contrato_id}`);
  for (const [pasa, desc] of chequeos) { console.log(`  ${pasa ? "✓" : "✗"} ${desc}`); if (!pasa) ok = false; }
  if (!ok) { console.error("\nPremisas rotas en el vínculo — no se escribe."); process.exit(1); }

  if (EXECUTE) {
    await a.ref.set({
      sustituido_por_id: SUSTITUTO,
      sustituido_por_contrato_id: B.contrato_id,
      sustitucion_vinculo_pendiente: admin.firestore.FieldValue.delete(),
      sustitucion_vinculo_motivo: admin.firestore.FieldValue.delete(),
      sustitucion_pendientes: admin.firestore.FieldValue.delete(),
      sustitucion_traspasados: continuan.length,
      sustitucion_reparado_at: admin.firestore.FieldValue.serverTimestamp(),
      sustitucion_reparado_por: "script:regulariza-serv20260918-01-2026-10-01",
      sustitucion_reparado_nota: `Ligado a ${B.contrato_id}: los ${continuan.length} radios que siguieron ya estaban asignados ahí; 22806A0291/0294 eran salientes de reemplazo (no siguen con el cliente).`,
    }, { merge: true });
    console.log("  vínculo escrito");
  }
  console.log(EXECUTE ? "\nListo." : "\ndry-run: nada escrito.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
