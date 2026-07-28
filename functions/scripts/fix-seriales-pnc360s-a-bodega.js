/**
 * fix-seriales-pnc360s-a-bodega.js — Fuerza a `en_bodega` las unidades de una
 * lista que el pool tenía en otra ubicación.
 *
 * Contexto (2026-07-28): bodega verificó los estantes de la hoja de 99 seriales
 * HYTERA PNC360S y confirmó que las 99 unidades están físicamente en bodega.
 * El pool tenía 39 en otra parte (en_cliente, devuelto_revision, en_taller).
 *
 * ADVERTENCIA — esto NO es una devolución. Salta el flujo de orden de
 * DEVOLUCIÓN → ENTRADA: no genera tiquete, no avisa a facturación y no cierra
 * el contrato. Las unidades con contrato vigente quedan liberadas del contrato
 * en el inventario mientras el contrato sigue vivo y facturándose. Se ejecuta
 * por decisión explícita de negocio; el contrato del que se liberó cada unidad
 * queda en el movimiento para poder reconstruirlo.
 *
 * Sigue la convención del resto del sistema al entrar a bodega:
 *   asignacion → null, verificado → false, pendiente_devolucion → borrado.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-seriales-pnc360s-a-bodega.js <archivo.txt>           # dry-run
 *   node scripts/fix-seriales-pnc360s-a-bodega.js <archivo.txt> --write
 * Idempotente.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO = process.argv[2];
const dryRun  = !process.argv.includes("--write");
const AUTOR   = "script:fix-seriales-pnc360s-a-bodega";
const MOTIVO  = "Verificación física de bodega 2026-07-28: la unidad está en el estante";

(async () => {
  if (!ARCHIVO) throw new Error("Falta el archivo de seriales");
  const seriales = fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => s.trim()).filter(Boolean);

  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const r = { yaEnBodega: 0, movidos: 0, sinFicha: 0, liberadosDeContrato: 0 };
  const detalle = [];
  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const raw of seriales) {
    const norm = pool.normSerial(raw);
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    if (snap.empty) { r.sinFicha++; console.log(`!! sin ficha: ${raw}`); continue; }

    for (const doc of snap.docs) {
      const v = doc.data();
      const de = v.estado || "";
      if (de === pool.ESTADOS.EN_BODEGA) { r.yaEnBodega++; continue; }

      const asig = v.asignacion || null;
      const ref = asig
        ? `${asig.cliente_nombre || "cliente sin nombre"}${asig.contrato_id ? ` (${asig.contrato_id})` : " (sin contrato)"}`
        : "";
      if (asig && (asig.contrato_doc_id || asig.cliente_id)) r.liberadosDeContrato++;

      const cambios = {
        estado: pool.ESTADOS.EN_BODEGA,
        asignacion: null,            // convención del sistema al entrar a bodega
        verificado: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by_email: AUTOR,
      };
      if (v.pendiente_devolucion) cambios.pendiente_devolucion = admin.firestore.FieldValue.delete();
      // Salir de taller deja el vínculo a la orden obsoleto.
      if (de === pool.ESTADOS.EN_TALLER && v.orden_actual_id) cambios.orden_actual_id = null;

      if (!dryRun) {
        batch.update(doc.ref, cambios);
        batch.set(doc.ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: AUTOR,
          tipo: "ajuste_inventario",
          de_estado: de, a_estado: pool.ESTADOS.EN_BODEGA, ref: null,
          notas: [MOTIVO,
            ref ? `Liberada de ${ref} SIN pasar por orden de devolución — el contrato sigue vigente` : "",
            de === pool.ESTADOS.EN_TALLER && v.orden_actual_id ? `Se soltó la orden ${v.orden_actual_id}` : "",
          ].filter(Boolean).join(" — "),
        });
        ops += 2;
      }
      r.movidos++;
      detalle.push({ serial: raw, de, ref: ref || "(sin asignación)" });
      if (ops >= 400) await flush();
    }
  }
  await flush();

  console.log(`--- ${detalle.length} unidades a mover a bodega ---`);
  detalle.forEach((d) => console.log(`  ${d.serial.padEnd(12)} ${d.de.padEnd(20)} liberada de: ${d.ref}`));
  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`ya en bodega:            ${r.yaEnBodega}`);
  console.log(`movidos a bodega:        ${r.movidos}`);
  console.log(`  de ellos, con contrato/cliente asignado: ${r.liberadosDeContrato}`);
  if (r.sinFicha) console.log(`sin ficha (revisar):     ${r.sinFicha}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
