/**
 * sanea-demos-temps-reemps.js — Saneo del overhang de contratos (Alberto
 * 2026-08-28, caso SEPROSA):
 *
 *   1. DEMO y TEMP vigentes NO se renuevan: se cierran con la recuperación
 *      del equipo. Este script VERIFICA por serial contra el pool (la verdad
 *      agregada de las órdenes de ENTRADA/DEVOLUCIÓN y las asignaciones
 *      posteriores) y cierra (estado 'vencido') SOLO los contratos cuyos
 *      equipos ya regresaron a CECOMUNICA o fueron asignados después a otro
 *      cliente — es decir, sin NINGUNA unidad del pool que siga colgando de
 *      ellos. Los que aún retienen unidades quedan listados: a esos les toca
 *      orden de DEVOLUCIÓN, no cierre. Excluido: el demo de MEDICINA LEGAL
 *      creado hoy. Nada se borra; queda estado_previo + evidencia.
 *
 *   2. REEMP vigentes SIN duración parseable → duración '18 meses'
 *      (+duracion_meses). El vencimiento lo estampa backfill-vencimiento.
 *
 * USAGE (desde functions/):
 *   node scripts/sanea-demos-temps-reemps.js [--write]
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const VIG = require("../src/lib/vigencia");
const pool = require("../src/domain/equiposPool");

const WRITE = process.argv.includes("--write");
const HOY = new Date(); HOY.setHours(0, 0, 0, 0);
const aDate = (t) => (t?.toDate ? t.toDate() : (t ? new Date(t) : null));

(async () => {
  const [conSnap, poolSnap] = await Promise.all([
    db.collection("contratos").get(),
    db.collection("equipos_pool").get(),
  ]);

  // Índices del pool: unidades que cuelgan de cada contrato, y ficha por serial.
  const porContrato = new Map();
  const fichaPorNorm = new Map();
  poolSnap.forEach((d) => {
    const u = { id: d.id, ...d.data() };
    const norm = u.serial_norm || d.id.split("__")[0];
    if (!fichaPorNorm.has(norm)) fichaPorNorm.set(norm, []);
    fichaPorNorm.get(norm).push(u);
    const cid = u.asignacion?.contrato_doc_id;
    if (cid && ["asignado_contrato", "en_cliente", "en_demo"].includes(u.estado)) {
      if (!porContrato.has(cid)) porContrato.set(cid, []);
      porContrato.get(cid).push(u);
    }
  });

  const cerrar = [], retienen = [], excluidos = [], reemps = [];

  for (const d of conSnap.docs) {
    const c = d.data();
    if (c.deleted || !["activo", "aprobado"].includes(c.estado)) continue;
    const cod = VIG.codigoTipo(c);

    if (cod === "DEMO" || cod === "TEMP") {
      // Candados contra cierres indebidos (lección DEMO20260827-01, que se
      // cerró cuando la exclusión "de hoy" caducó con el cambio de día y sus
      // radios en_taller eran PREPARACIÓN, no retorno): exclusión explícita
      // por número + nunca cerrar contratos con menos de 30 días (pueden
      // estar en vuelo — radios en taller alistándose para salir).
      const EXCLUIR = new Set(["DEMO20260827-01"]); // Medicina Legal, vivo
      const creado = aDate(c.fecha_creacion);
      const dias = creado ? (Date.now() - creado.getTime()) / 86400000 : null;
      if (EXCLUIR.has(c.contrato_id) || (dias !== null && dias < 30)) {
        excluidos.push(c); continue;
      }
      const colgando = porContrato.get(d.id) || [];
      // Evidencia por serial declarado en el contrato: dónde está HOY cada uno.
      const sers = await db.collection("contratos").doc(d.id).collection("seriales").get();
      const evidencia = [];
      sers.forEach((s) => {
        const norm = pool.normSerial(s.data().serial || s.id);
        const fichas = fichaPorNorm.get(norm) || [];
        if (!fichas.length) { evidencia.push(`${s.data().serial || s.id}: sin ficha`); return; }
        const f = fichas[0];
        const donde = f.asignacion?.contrato_doc_id === d.id
          ? `AÚN EN ESTE CONTRATO (${f.estado})`
          : f.asignacion?.cliente_nombre
            ? `reasignado a ${f.asignacion.cliente_nombre} (${f.asignacion.contrato_id || "s/contrato"})`
            : `en CECOMUNICA (${f.estado})`;
        evidencia.push(`${f.serial || norm}: ${donde}`);
      });
      const fila = { id: d.id, ref: d.ref, c, colgando, evidencia };
      (colgando.length ? retienen : cerrar).push(fila);
    }

    if (cod === "REEMP" && !VIG.parseDuracionMeses(c.duracion)) {
      reemps.push({ id: d.id, ref: d.ref, c });
    }
  }

  console.log(`\n── 1a) DEMO/TEMP CERRABLES (0 unidades colgando — recuperadas o reasignadas): ${cerrar.length} ──`);
  cerrar.forEach(({ c, evidencia }) => {
    console.log(`  ${(c.contrato_id || "?").padEnd(18)} [${c.estado}] ${c.cliente_nombre || "?"}`);
    evidencia.slice(0, 6).forEach((e) => console.log(`      · ${e}`));
  });

  console.log(`\n── 1b) DEMO/TEMP que AÚN RETIENEN equipos (les toca DEVOLUCIÓN, no cierre): ${retienen.length} ──`);
  retienen.forEach(({ c, colgando }) => {
    console.log(`  ${(c.contrato_id || "?").padEnd(18)} [${c.estado}] ${c.cliente_nombre || "?"} → ${colgando.map((u) => `${u.serial}(${u.estado})`).join(", ")}`);
  });
  console.log(`  EXCLUIDOS (Medicina Legal, hoy): ${excluidos.map((c) => c.contrato_id).join(", ") || "—"}`);

  console.log(`\n── 2) REEMP sin duración → '18 meses': ${reemps.length} ──`);
  reemps.forEach(({ c }) => console.log(`  ${(c.contrato_id || "?").padEnd(18)} [${c.estado}] dur=${JSON.stringify(c.duracion ?? null)} ${c.cliente_nombre || "?"}`));

  if (!WRITE) { console.log("\nDRY-RUN — nada escrito. Repite con --write."); return; }

  const FV = admin.firestore.FieldValue;
  for (const { ref, c, evidencia } of cerrar) {
    await ref.update({
      estado: "vencido",
      estado_previo: c.estado,
      vencido_at: FV.serverTimestamp(),
      vencido_motivo: "Saneo 2026-08-28: DEMO/TEMP terminado — equipos verificados de vuelta en CECOMUNICA o reasignados (instrucción de Alberto)",
      vencido_evidencia: evidencia.slice(0, 40),
      fecha_modificacion: new Date(),
    });
  }
  for (const { ref } of reemps) {
    await ref.update({ duracion: "18 meses", duracion_meses: 18, fecha_modificacion: new Date() });
  }
  console.log(`\nOK: ${cerrar.length} DEMO/TEMP cerrados · ${reemps.length} REEMP → 18 meses.`);
  console.log("Ahora corre: node scripts/backfill-vencimiento.js --write");
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
