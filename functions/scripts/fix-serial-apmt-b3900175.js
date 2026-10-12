/**
 * fix-serial-apmt-b3900175.js
 *
 * Cierra lo que dejó pendiente fix-seriales-apmt-2026100101.js (2026-10-09):
 * el taller (Solangel, 2026-10-12) miró la etiqueta y confirmó que el radio
 * de la OS 2026100101 es B3900175. El contrato ALQ20260514-02 lo tiene como
 * B3800175 desde la programación 2026051801 (dedazo al programar; la fila del
 * contrato salió de ahí por auto-match). Es el mismo radio: mismo modelo
 * (NX-420-R), misma posición en la visita 2026071402 que en la programación.
 *
 * Efecto del dedazo: la OS 2026100101 no tiene contrato ligado, así que
 * onOrdenWritePool dio de alta B3900175 como ficha nueva "del cliente, sin
 * factura", y ordenes-reemplazo `situacion()` dice "No adquirido en
 * CECOMUNICA". Mientras, B3800175 es una ficha fantasma en_cliente que nadie
 * tiene físicamente.
 *
 * Qué hace (pool primero, documentos después — misma regla que
 * lib/correccionGestion.js: el entrante toma el lugar EXACTO del saliente):
 *   1. B3900175 (ficha real, en_taller por la OS): hereda la asignación del
 *      contrato y pasa a propiedad 'cecomunica' (alquiler); verificado:true
 *      porque el taller ya miró la etiqueta. Movimiento en el kardex.
 *   2. B3800175 (fantasma): se borra con sus movimientos. Nadie más la cita
 *      (ni gestiones ni órdenes vivas); la traza queda en seriales_historial
 *      del contrato y en el kardex de B3900175.
 *   3. Fila del contrato: B3800175 → B3900175 (+ seriales_historial).
 *      onSerialWrite recuenta (sigue en 58) y sobre B3900175 solo refresca la
 *      asignación (en_taller está en noTocarDesde); sobre B3800175 ya no hay
 *      ficha, así que no hace nada.
 *   4. Programación 2026051801 (ENTREGADA): se corrige la fila para que el
 *      historial diga el serial real. onOrdenWritePool no toca una orden ya
 *      entregada.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-serial-apmt-b3900175.js          # dry-run
 *   node scripts/fix-serial-apmt-b3900175.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const WRITE = process.argv.includes("--write");
const EMAIL = "script:fix-serial-apmt-b3900175";
const MAL = "B3800175", BIEN = "B3900175";
const CID = "t3jYy6rnGi4pf2y4mDMl", CONTRATO_ID = "ALQ20260514-02";
const FILA = "1ku5FYYHT2QaD53YeI0d";
const OS_TALLER = "2026100101", OS_PROG = "2026051801";
const NX420_ID = "68N7zR5APzO3xIaJCZCU";
const NOTA = `Serial mal digitado en la programación ${OS_PROG}: el contrato decía ${MAL} y el radio es ${BIEN} (confirmado por el taller mirando la etiqueta, 2026-10-12).`;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function borrar(ref) {
  const movs = await ref.collection("movimientos").get();
  const b = db.batch();
  movs.docs.forEach((m) => b.delete(m.ref));
  b.delete(ref);
  await b.commit();
}

(async () => {
  console.log(WRITE ? "*** ESCRIBIENDO ***\n" : "*** DRY-RUN ***\n");
  const pool = db.collection("equipos_pool");
  const refBien = pool.doc(BIEN), refMal = pool.doc(MAL);
  const bien = (await refBien.get()).data();
  const mal = (await refMal.get()).data();
  const contrato = (await db.collection("contratos").doc(CID).get()).data();
  const filaRef = db.collection("contratos").doc(CID).collection("seriales").doc(FILA);
  const fila = (await filaRef.get()).data();
  const progRef = db.collection("ordenes_de_servicio").doc(OS_PROG);
  const prog = (await progRef.get()).data();

  // ── Salvaguardas ────────────────────────────────────────────────────────
  if (!bien) throw new Error(`${BIEN} no existe en el pool`);
  if (bien.propiedad !== "cliente" || bien.venta || bien.origen !== "migracion_orden"
      || bien.orden_actual_id !== OS_TALLER || bien.estado !== "en_taller" || bien.modelo_id !== NX420_ID) {
    throw new Error(`${BIEN} no tiene la forma esperada (ficha fantasma 'del cliente' en taller por la OS ${OS_TALLER})`);
  }
  if (bien.asignacion?.contrato_doc_id) throw new Error(`${BIEN} ya tiene contrato: ${bien.asignacion.contrato_id}`);
  if (mal) {
    if (mal.estado !== "en_cliente" || mal.asignacion?.contrato_doc_id !== CID || mal.orden_actual_id
        || mal.origen !== "migracion_orden" || mal.venta) {
      throw new Error(`${MAL} no tiene la forma de ficha fantasma del contrato`);
    }
  }
  if (contrato?.contrato_id !== CONTRATO_ID) throw new Error("El contrato no es ALQ20260514-02");
  if (!fila || fila.serial !== MAL) throw new Error(`La fila ${FILA} no dice ${MAL}: ${fila?.serial}`);
  const otras = (await db.collection("contratos").doc(CID).collection("seriales").get()).docs
    .filter((d) => [MAL, BIEN].includes(String(d.data().serial || "").toUpperCase()) && d.id !== FILA);
  if (otras.length) throw new Error(`Hay otras filas con esos seriales: ${otras.map((d) => d.id)}`);
  const gs = await db.collection("gestiones").where("seriales_norm", "array-contains-any", [MAL, BIEN]).get();
  if (gs.size) throw new Error(`Hay gestiones que citan los seriales: ${gs.docs.map((d) => d.id)}`);
  const filaProg = (prog?.equipos || []).filter((e) => e.numero_de_serie === MAL || e.serial === MAL);
  if (filaProg.length !== 1) throw new Error(`La programación ${OS_PROG} tiene ${filaProg.length} filas con ${MAL}`);
  if (String(prog.estado_reparacion).toUpperCase() !== "ENTREGADO AL CLIENTE") throw new Error(`${OS_PROG} está '${prog.estado_reparacion}'`);
  console.log("Salvaguardas OK.\n");

  // ── 1. B3900175 real: hereda la asignación, pasa a alquiler ─────────────
  const asignacion = {
    contrato_doc_id: CID, contrato_id: CONTRATO_ID,
    cliente_id: contrato.cliente_id || "", cliente_nombre: contrato.cliente_nombre || "",
  };
  console.log(`  pool ${BIEN}: propiedad cliente → cecomunica, asignación ${CONTRATO_ID}, verificado:true (sigue en_taller por la OS ${OS_TALLER})`);
  if (WRITE) {
    const b = db.batch();
    b.set(refBien, {
      propiedad: "cecomunica", propiedad_fuente: "correccion_serial_contrato_2026-10-12",
      asignacion, verificado: true, serial_compartido: false,
      updated_at: FV.serverTimestamp(), updated_by_email: EMAIL,
    }, { merge: true });
    b.set(refBien.collection("movimientos").doc(), {
      tipo: "correccion", de_estado: "en_taller", a_estado: "en_taller",
      ref: { tipo: "contrato", id: CID, label: CONTRATO_ID },
      notas: `${NOTA} Hereda el lugar de ${MAL} en el contrato; propiedad corregida: cliente → cecomunica.`,
      at: FV.serverTimestamp(), por: "system", por_email: EMAIL,
    });
    await b.commit();
  }

  // ── 2. B3800175 fantasma ────────────────────────────────────────────────
  if (mal) {
    console.log(`  pool ${MAL}: BORRAR (${mal.modelo_label}, ${mal.propiedad}, ${mal.estado}) — nunca existió físicamente`);
    if (WRITE) await borrar(refMal);
  } else {
    console.log(`  pool ${MAL}: ya no existe`);
  }

  // ── 3. Fila del contrato ────────────────────────────────────────────────
  console.log(`  contrato ${CONTRATO_ID} fila ${FILA}: ${MAL} → ${BIEN} (+ seriales_historial)`);
  if (WRITE) {
    const b = db.batch();
    b.update(filaRef, { serial: BIEN, updated_at: FV.serverTimestamp(), updated_by: EMAIL, corregido_por: EMAIL });
    b.set(db.collection("contratos").doc(CID).collection("seriales_historial").doc(), {
      origen: "saneo_serial_mal_digitado",
      at: FV.serverTimestamp(), por: EMAIL,
      estado: contrato.seriales_estado || null,
      contrato_id: CONTRATO_ID, cliente_id: contrato.cliente_id || "", cliente_nombre: contrato.cliente_nombre || "",
      agregados: [{ serial: BIEN, modelo: fila.modelo || "NX-420-R" }],
      eliminados: [{ serial: MAL, modelo: fila.modelo || "NX-420-R" }],
      nota: NOTA,
    });
    await b.commit();
  }

  // ── 4. Programación 2026051801 (historial) ──────────────────────────────
  const equipos = prog.equipos.map((e) => (e.numero_de_serie === MAL || e.serial === MAL)
    ? { ...e, serial: BIEN, numero_de_serie: BIEN } : e);
  console.log(`  orden ${OS_PROG}: fila ${MAL} → ${BIEN}`);
  if (WRITE) {
    await progRef.update({
      equipos,
      os_logs: FV.arrayUnion({ action: "CORREGIR_SERIALES", by: EMAIL, at_iso: new Date().toISOString(), nota: NOTA }),
    });
  }

  if (!WRITE) { console.log("\nDRY-RUN. Corre con --write."); process.exit(0); }

  // ── Verificación ───────────────────────────────────────────────────────
  console.log("\nEsperando a que onSerialWrite asiente (25s)...");
  await dormir(25000);
  const cFin = (await db.collection("contratos").doc(CID).get()).data();
  const bFin = (await refBien.get()).data();
  const mFin = await refMal.get();
  console.log(`  contrato seriales_count=${cFin.seriales_count} (esperado 58)`);
  console.log(`  ${BIEN}: estado=${bFin.estado} propiedad=${bFin.propiedad} contrato=${bFin.asignacion?.contrato_id} orden=${bFin.orden_actual_id} verificado=${bFin.verificado}`);
  console.log(`  ${MAL}: ${mFin.exists ? "OJO: volvió a existir (" + mFin.data().estado + ")" : "no existe"}`);
  if (cFin.seriales_count !== 58 || bFin.propiedad !== "cecomunica" || bFin.estado !== "en_taller" || bFin.asignacion?.contrato_doc_id !== CID || mFin.exists) {
    console.log("OJO: algo no quedó como se esperaba — revisar logs de onSerialWrite.");
  } else {
    console.log("\nListo.");
  }
  process.exit(0);
})().catch((e) => { console.error("ABORTADO:", e.message); process.exit(1); });
