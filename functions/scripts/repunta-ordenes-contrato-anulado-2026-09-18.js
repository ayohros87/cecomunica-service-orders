/**
 * repunta-ordenes-contrato-anulado-2026-09-18.js — pasa al contrato vivo las
 * órdenes que el backfill del 15-sep dejó SEÑALADAS esperando decisión humana.
 *
 * QUÉ PASÓ
 *   `resuelve-ordenes-de-contratos-anulados.js` no adivina el sustituto: cuando
 *   un contrato anulado no declara `sustituido_por_id` pero su orden trae
 *   equipos preparados, la estampa con `contrato_anulado_revisar` y la deja a la
 *   vista. El 15-sep quedaron tres así (CONCORD, SOC. ISRAELITA, MAGEN DAVID).
 *   Elvia/Brenda confirmaron dos por correo el 18-sep; la de MAGEN DAVID sigue
 *   abierta y NO entra aquí: su orden trae 10 HYT-P50 y el contrato vivo pide 5.
 *
 * QUÉ HACE
 *   Exactamente lo mismo que la PUERTA 1 de la UI
 *   (`OrdenesService.repuntarContratoOrden`, ordenesService.js): re-apunta
 *   `contrato`, deja el rastro del salto y apaga la marca del trigger. No toca
 *   el estado de la orden, ni sus equipos, ni el QC, ni el pool — repuntar solo
 *   cambia bajo qué papel se entregan los radios.
 *
 *   El traspaso de SERIALES es otra cosa y va por su propio camino
 *   (`reparar-sustitucion.js`): la subcolección del contrato vivo la escribe
 *   `traspasarASustituto`, no esto.
 *
 * USAGE (desde functions/):
 *   node scripts/repunta-ordenes-contrato-anulado-2026-09-18.js           # dry-run
 *   node scripts/repunta-ordenes-contrato-anulado-2026-09-18.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const POR = "script:repunta-ordenes-contrato-anulado-2026-09-18";

// Confirmados por correo el 2026-09-18 (Brenda, con Elvia en copia).
const CASOS = [
  {
    orden: "2026072805",
    de: "ALQ20260728-02",
    a: "ALQ20260826-02",
    motivo: "el contrato se emitió con ITBMS y el cliente es exento; confirmado por Brenda 18-sep",
  },
  {
    orden: "2026080705",
    de: "ALQ20260806-01",
    a: "ALQ20260810-01",
    motivo: "contrato rehecho por cambio de representante legal; los 15 seriales de la orden son los del contrato vivo",
  },
];

const key = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function buscarContrato(numero) {
  const q = await db.collection("contratos").where("contrato_id", "==", numero).limit(2).get();
  if (q.empty) throw new Error(`contrato ${numero} no encontrado`);
  if (q.size > 1) throw new Error(`${numero} identifica a más de un contrato`);
  return { id: q.docs[0].id, data: q.docs[0].data() || {} };
}

(async () => {
  console.log(`Modo: ${APPLY ? "APPLY" : "dry-run"}\n`);
  const plan = [];

  for (const c of CASOS) {
    const oRef = db.collection("ordenes_de_servicio").doc(c.orden);
    const oSnap = await oRef.get();
    if (!oSnap.exists) throw new Error(`orden ${c.orden} no existe`);
    const o = oSnap.data() || {};
    const destino = await buscarContrato(c.a);

    const equipos = (o.equipos || []).filter((e) => e && !e.eliminado);
    const seriales = new Set(equipos.map((e) => key(e.serial)).filter(Boolean));
    const sers = await db.collection("contratos").doc(destino.id).collection("seriales").get();
    const delContrato = new Set(sers.docs.map((d) => key(d.data().serial)).filter(Boolean));
    const cubiertos = [...seriales].filter((s) => delContrato.has(s));
    const huerfanos = [...seriales].filter((s) => !delContrato.has(s));

    // Candados. Repuntar a un contrato equivocado cambia qué se factura.
    const chequeos = [
      [o.contrato?.contrato_id === c.de, `la orden cuelga hoy de ${c.de} (está en ${o.contrato?.contrato_id || "—"})`],
      [o.contrato?.contrato_doc_id !== destino.id, "la orden no está ya bajo el contrato destino"],
      [o.eliminado !== true, "la orden no está eliminada"],
      [destino.data.estado !== "anulado", `el destino no está anulado (es ${destino.data.estado})`],
      [destino.data.deleted !== true, "el destino no está borrado"],
      [destino.data.cliente_id === (o.cliente_id || o.cliente?.id), "mismo cliente en la orden y en el destino"],
      [huerfanos.length === 0, `los ${equipos.length} equipos de la orden están en el contrato destino`],
    ];

    console.log(`── orden ${c.orden} · ${o.cliente?.nombre || o.cliente_nombre || "—"}`);
    console.log(`   ${c.de} → ${c.a} (${destino.id}) · estado orden: ${o.estado_reparacion || "—"}`);
    console.log(`   equipos: ${equipos.length} · en el contrato destino: ${cubiertos.length}`);
    if (huerfanos.length) console.log(`   ⚠ fuera del contrato: ${huerfanos.join(", ")}`);
    let ok = true;
    for (const [pasa, desc] of chequeos) {
      console.log(`   ${pasa ? "✓" : "✗"} ${desc}`);
      if (!pasa) ok = false;
    }
    if (!ok) throw new Error(`orden ${c.orden}: no pasa los candados — nada escrito`);
    console.log("");
    plan.push({ ...c, oRef, anterior: o.contrato?.contrato_id || o.contrato?.contrato_doc_id || "—", destino });
  }

  if (!APPLY) { console.log("dry-run: nada escrito. Corre con --apply para aplicar."); return; }

  for (const p of plan) {
    await p.oRef.update({
      contrato: {
        aplica: true,
        contrato_doc_id: p.destino.id,
        contrato_id: p.a,
        motivo_no_aplica: null,
      },
      contrato_repuntado_desde: p.anterior,
      contrato_repuntado_at: admin.firestore.FieldValue.serverTimestamp(),
      // La marca del trigger se apaga: ya se decidió.
      contrato_anulado_revisar: admin.firestore.FieldValue.delete(),
      os_logs: admin.firestore.FieldValue.arrayUnion({
        action: "REPUNTAR_CONTRATO",
        by: POR,
        at: admin.firestore.Timestamp.now(),
        nota: `De ${p.anterior} a ${p.a} — ${p.motivo}`,
      }),
    });
    console.log(`✓ ${p.orden}: ${p.anterior} → ${p.a}`);
  }
  console.log("\nHECHO.");
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
