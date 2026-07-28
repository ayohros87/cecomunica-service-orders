/**
 * marca-contratos-por-cancelar.js — Siembra la bandeja "Contratos por cancelar"
 * del home con los casos que ya existían antes del mecanismo.
 *
 * El trigger `onOrdenWritePool` solo estampa `cancelacion_pendiente` cuando se
 * CIERRA una ENTRADA nueva, así que todo lo anterior quedó fuera. Este script
 * mete dos grupos:
 *
 *   1. EXPLICITOS — contratos vigentes cuyo equipo se liberó a mano el
 *      2026-07-28 al reclasificar los 99 seriales PNC360S.
 *   2. TEMPORALES VENCIDOS — TEMP/DEMO vigentes de más de 60 días y SIN una
 *      sola unidad asignada en el pool. Son temporales por definición: uno
 *      viejo y todavía abierto casi seguro terminó sin cerrarse, porque el
 *      ciclo DEVOLUCION → ENTRADA no existía antes del 2026-07-21.
 *
 * OJO con el grupo 2: "sin equipo asignado" puede significar que el equipo
 * volvió, o que los seriales de ese contrato nunca entraron al pool (legacy).
 * Por eso NO se cancela nada — solo se pone en la bandeja para que un humano
 * lo mire.
 *
 * USAGE (desde functions/):
 *   node scripts/marca-contratos-por-cancelar.js [--write]
 * Idempotente: no repisa una marca existente.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const HOY = new Date("2026-07-28");
const DIAS_MIN = 60;
const VIGENTES = new Set(["activo", "aprobado"]);

// Grupo 1: liberados a mano el 2026-07-28 (ver project_reclasificacion_pnc360s).
const EXPLICITOS = {
  "TEMP20260505-01": ["23706A0392", "24O31A0942", "22610A4012", "23706A0409", "23706A0432", "25219A0943", "23706A0390", "23706A0406"],
  "ALQ20260226-01":  ["24220A2281", "24220A2292", "24220A2282", "24220A2284"],
  "DEMO20260203-01": ["22610A3974"],
  "ALQ20260527-01":  ["22806A0232"],
  "DEMO20251003-01": ["24708A1331"],
  "DEMO20260507-02": ["23706A0614"],
  "TEMP20260310-01": ["22610A4023"],
  "TEMP20260609-02": ["22610A4057"],
};

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const enPool = new Map();
  (await db.collection("equipos_pool").get()).forEach((d) => {
    const c = d.data()?.asignacion?.contrato_doc_id;
    if (c) enPool.set(c, (enPool.get(c) || 0) + 1);
  });

  const marcar = [];   // {docId, cid, cliente, motivo, seriales, dias}
  const snap = await db.collection("contratos").get();
  snap.forEach((d) => {
    const v = d.data();
    if (v.deleted === true) return;
    if (!VIGENTES.has(String(v.estado || "").toLowerCase())) return;
    if (v.cancelacion_pendiente) return;           // ya está en la bandeja
    const cid = v.contrato_id || d.id;
    const base = { docId: d.id, cid, cliente: v.cliente_nombre || "" };

    if (EXPLICITOS[cid]) {
      marcar.push({ ...base, motivo: "conteo_bodega", seriales: EXPLICITOS[cid], dias: null });
      return;
    }
    const tipo = (cid.match(/^[A-Z]+/) || ["?"])[0];
    if (!["TEMP", "DEMO"].includes(tipo)) return;
    if ((enPool.get(d.id) || 0) > 0) return;        // todavía tiene equipo
    const f = v.fecha_creacion?.toDate ? v.fecha_creacion.toDate() : null;
    if (!f) return;
    const dias = Math.floor((HOY - f) / 86400000);
    if (dias <= DIAS_MIN) return;
    marcar.push({ ...base, motivo: "temporal_vencido", seriales: [], dias });
  });

  for (const m of marcar) {
    if (!dryRun) {
      await db.collection("contratos").doc(m.docId).set({
        cancelacion_pendiente: {
          orden_entrada_id: "", orden_numero: "",
          motivo: m.motivo,
          dias_sin_cerrar: m.dias || null,
          cliente_nombre: m.cliente,
          seriales: m.seriales,
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
    }
    console.log(`  ${m.cid.padEnd(18)} ${m.motivo.padEnd(18)} ${m.dias ? String(m.dias).padStart(4) + "d " : "        "}${m.cliente}`);
  }

  const porMotivo = {};
  marcar.forEach((m) => { porMotivo[m.motivo] = (porMotivo[m.motivo] || 0) + 1; });
  console.log(`\n=== ${marcar.length} contratos a marcar ===`);
  Object.entries(porMotivo).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
