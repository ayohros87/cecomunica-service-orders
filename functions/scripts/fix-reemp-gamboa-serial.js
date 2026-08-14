/**
 * fix-reemp-gamboa-serial.js — REEMP20260814-01 (TROPICAL RESORTS / HOTEL GAMBOA).
 *
 * CASO. El plan de la venta eligió el serial EQUIVOCADO como equipo a
 * reemplazar: puso B3700355 cuando el radio dañado que salió del hotel es el
 * B3400055 (confirmado por recepción, 2026-08-14). Consecuencias:
 *   · recepción registró la devolución REAL a mano (orden 2026081402, modo
 *     'sin_contrato' contra "ALQ20260806-02") 2h antes de que se confirmara la
 *     entrega — B3400055 quedó bien en devuelto_revision + ENTRADA 2026081403;
 *   · al confirmarse la entrega, onEntregaTransicion creó el tiquete automático
 *     2026081404 persiguiendo B3700355, un radio que sigue con el cliente y que
 *     nadie va a traer, y marcó su ficha `pendiente_devolucion`;
 *   · el linaje de la unidad entrante B5100042 quedó `reemplaza_a: B3700355`.
 *
 * QUÉ HACE (en este orden — el orden importa):
 *   1. Cancela (soft delete) la orden 2026081404. El espejo suelta el chip de
 *      devolución del contrato nuevo y del origen.
 *   2. BORRA el mapeo errado. onMapeoWrite revierte al borrar: quita
 *      `pendiente_devolucion` de B3700355 y `reemplaza_a` de B5100042.
 *   3. Espera a que el trigger asiente y CREA el mapeo correcto
 *      (B3400055 → B5100042). Estampa el linaje bueno. El
 *      `pendiente_devolucion` que deja en B3400055 es inocuo: recordatorio §C2
 *      solo mira unidades en_cliente/asignado_contrato, y el pool lo borra solo
 *      cuando la unidad entre a bodega tras la inspección.
 *   4. Re-liga la orden manual 2026081402 al contrato REAL (existe en el
 *      sistema; nació con `contrato.aplica:false` porque el formulario de
 *      recepción solo sabe crear devoluciones "de papel"). Así la columna
 *      Devolución de ALQ20260806-02 muestra la devolución que SÍ ocurrió.
 *      No re-aplica nada al pool: onOrdenDevolucionWrite solo procesa
 *      resoluciones que CAMBIAN en la escritura, y ninguna cambia.
 *   5. Corrige los destinos del `transicion_plan` (B3400055 pasa a 'reemplaza',
 *      B3700355 a 'continua') y deja marca de corrección.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-reemp-gamboa-serial.js            # DRY RUN (default)
 *   node scripts/fix-reemp-gamboa-serial.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const APPLY = process.argv.includes("--apply");
const CID_NUEVO  = "LsvR1NCKKD1uZwt7Z7Xs";  // REEMP20260814-01
const CID_ORIGEN = "Y2BUctodJnZMzbGp8Nqy";  // ALQ20260806-02
const ORDEN_AUTO = "2026081404";            // la que persigue el serial errado
const ORDEN_REAL = "2026081402";            // la que recepción hizo a mano
const SERIAL_MALO   = "B3700355";           // el que el plan eligió por error
const SERIAL_BUENO  = "B3400055";           // el que de verdad volvió
const SERIAL_NUEVO  = "B5100042";           // el entrante

const log = (...a) => console.log(APPLY ? "[APPLY]" : "[DRY] ", ...a);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log(APPLY ? "=== APLICANDO CAMBIOS ===\n" : "=== DRY RUN (nada se escribe) ===\n");

  // ── 0) Estado actual, para el diff ────────────────────────────────────────
  const fichas = {};
  for (const s of [SERIAL_MALO, SERIAL_BUENO, SERIAL_NUEVO]) {
    const d = await db.collection("equipos_pool").doc(s).get();
    fichas[s] = d.exists ? d.data() : null;
    console.log(`  ficha ${s}: estado=${fichas[s]?.estado} pendiente_devolucion=${fichas[s]?.pendiente_devolucion || false} reemplaza_a=${fichas[s]?.reemplaza_a || "—"}`);
  }
  console.log("");

  // ── 1) Cancelar la orden automática ───────────────────────────────────────
  const ordenAuto = await db.collection("ordenes_de_servicio").doc(ORDEN_AUTO).get();
  if (!ordenAuto.exists) {
    console.log(`  ! orden ${ORDEN_AUTO} no existe — se salta el paso 1`);
  } else if (ordenAuto.data().eliminado === true) {
    console.log(`  = orden ${ORDEN_AUTO} ya está cancelada`);
  } else {
    const nota = `CANCELADA: el serial es errado. El plan de venta puso ${SERIAL_MALO}, `
      + `pero el radio que el cliente devolvió es ${SERIAL_BUENO} — recibido en la orden ${ORDEN_REAL}.`;
    log(`1) orden ${ORDEN_AUTO} → eliminado:true (+ nota)`);
    if (APPLY) {
      await ordenAuto.ref.update({
        eliminado: true,
        observaciones: `${ordenAuto.data().observaciones || ""}\n\n${nota}`.trim(),
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "CANCELAR_DEVOLUCION", by: "script:fix-reemp-gamboa-serial",
        }),
      });
    }
  }

  // ── 2) Borrar el mapeo errado (el trigger revierte flag + linaje) ─────────
  const mapeos = await db.collection("contratos").doc(CID_NUEVO).collection("mapeos").get();
  const errado = mapeos.docs.find(d => (d.data().saliente || "").trim() === SERIAL_MALO);
  const original = errado ? errado.data() : null;
  if (!errado) {
    console.log(`  ! no hay mapeo con saliente ${SERIAL_MALO} — se saltan los pasos 2 y 3`);
  } else {
    log(`2) borrar mapeo ${errado.id} (saliente ${SERIAL_MALO} → entrante ${original.entrante})`);
    console.log(`     el trigger quitará pendiente_devolucion de ${SERIAL_MALO} y reemplaza_a de ${SERIAL_NUEVO}`);
    if (APPLY) {
      await errado.ref.delete();
      await sleep(8000); // que onMapeoWrite asiente antes de crear el nuevo
    }

    // ── 3) Crear el mapeo correcto ──────────────────────────────────────────
    log(`3) crear mapeo saliente ${SERIAL_BUENO} → entrante ${SERIAL_NUEVO}`);
    if (APPLY) {
      await db.collection("contratos").doc(CID_NUEVO).collection("mapeos").add({
        saliente: SERIAL_BUENO,
        saliente_pool_id: SERIAL_BUENO,
        entrante: original.entrante || SERIAL_NUEVO,
        entrante_pool_id: original.entrante_pool_id || SERIAL_NUEVO,
        modelo: original.modelo || "KENWOOD NX-420-R",
        modelo_id: original.modelo_id || null,
        contrato_id: original.contrato_id || "REEMP20260814-01",
        contrato_origen_id: original.contrato_origen_id || CID_ORIGEN,
        auto: true,
        correccion: `Reemplaza al mapeo automático: el plan de venta indicó ${SERIAL_MALO}, `
          + `pero el equipo devuelto fue ${SERIAL_BUENO} (confirmado por recepción 2026-08-14).`,
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "script:fix-reemp-gamboa-serial",
      });
      await sleep(5000);
    }
  }

  // ── 4) Re-ligar la orden manual al contrato real ──────────────────────────
  const ordenReal = await db.collection("ordenes_de_servicio").doc(ORDEN_REAL).get();
  if (!ordenReal.exists) {
    console.log(`  ! orden ${ORDEN_REAL} no existe — se salta el paso 4`);
  } else if (ordenReal.data().contrato?.contrato_doc_id === CID_ORIGEN) {
    console.log(`  = orden ${ORDEN_REAL} ya está ligada al contrato`);
  } else {
    log(`4) orden ${ORDEN_REAL} → contrato.aplica:true, contrato_doc_id:${CID_ORIGEN} (ALQ20260806-02)`);
    console.log(`     el espejo marcará la devolución REAL en la fila de ALQ20260806-02`);
    if (APPLY) {
      // update() con rutas anidadas: no pisa el resto del mapa `contrato`.
      await ordenReal.ref.update({
        "contrato.aplica": true,
        "contrato.contrato_doc_id": CID_ORIGEN,
        "contrato.contrato_id": "ALQ20260806-02",
        "contrato.motivo_no_aplica": null,
      });
      await sleep(5000);
    }
  }

  // ── 5) Corregir los destinos del plan de la venta ─────────────────────────
  const cNuevo = await db.collection("contratos").doc(CID_NUEVO).get();
  const plan = cNuevo.data().transicion_plan || null;
  if (!plan || !Array.isArray(plan.unidades)) {
    console.log("  ! sin transicion_plan nivel serial — se salta el paso 5");
  } else {
    const unidades = plan.unidades.map(u => {
      const s = (u.serial_norm || u.serial || "").trim();
      if (s === SERIAL_MALO)  return { ...u, destino: "continua" };
      if (s === SERIAL_BUENO) return { ...u, destino: "reemplaza" };
      return u;
    });
    const antesMalo  = plan.unidades.find(u => (u.serial_norm || u.serial) === SERIAL_MALO)?.destino;
    const antesBueno = plan.unidades.find(u => (u.serial_norm || u.serial) === SERIAL_BUENO)?.destino;
    log(`5) transicion_plan: ${SERIAL_MALO} '${antesMalo}'→'continua', ${SERIAL_BUENO} '${antesBueno}'→'reemplaza'`);
    if (APPLY) {
      await db.collection("contratos").doc(CID_NUEVO).update({
        "transicion_plan.unidades": unidades,
        "transicion_plan.corregido_at": admin.firestore.FieldValue.serverTimestamp(),
        "transicion_plan.corregido_nota": `Serial del equipo a reemplazar corregido: ${SERIAL_MALO} → ${SERIAL_BUENO} `
          + "(el plan de la venta señaló el radio equivocado; confirmado por recepción 2026-08-14).",
      });
    }
  }

  // ── Verificación ──────────────────────────────────────────────────────────
  if (APPLY) {
    await sleep(6000);
    console.log("\n=== ESTADO FINAL ===");
    for (const s of [SERIAL_MALO, SERIAL_BUENO, SERIAL_NUEVO]) {
      const u = (await db.collection("equipos_pool").doc(s).get()).data() || {};
      console.log(`  ${s}: estado=${u.estado} pendiente_devolucion=${u.pendiente_devolucion || false} reemplaza_a=${u.reemplaza_a || "—"}`);
    }
    for (const cid of [CID_NUEVO, CID_ORIGEN]) {
      const c = (await db.collection("contratos").doc(cid).get()).data() || {};
      console.log(`  contrato ${c.contrato_id}: devolucion_estado=${c.devolucion_estado} pendientes=${c.devolucion_pendientes} tiquetes=${JSON.stringify(c.devolucion_tiquetes || {})}`);
    }
    // Aviso: si B3700355 quedó con el flag, el trigger de borrado no corrió.
    const malo = (await db.collection("equipos_pool").doc(SERIAL_MALO).get()).data() || {};
    if (malo.pendiente_devolucion) {
      console.log(`\n  !! ${SERIAL_MALO} sigue con pendiente_devolucion — límpialo a mano o vuelve a correr.`);
    }
  } else {
    console.log("\nNada escrito. Para aplicar: node scripts/fix-reemp-gamboa-serial.js --apply");
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
