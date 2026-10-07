/**
 * traslada-contrato-acodeco-a-apc-2026-10-07.js — el SERV20261007-02 se hizo
 * hoy a la ficha "ACODECO", pero el cliente es AUTORIDAD DE PROTECCION AL
 * CONSUMIDOR Y DEFENSA DE LA COMPETENCIA, que ya tenía su contrato:
 * SERV20260918-02 (activo, firmado el 2026-10-06, 22 HYTERA PNC360S-R propio
 * a $25 — los mismos 22 que la renovación de hoy) con los seriales pendientes.
 *
 * El traspaso automático de la anulación por sustitución no sirve: se niega
 * cuando el sustituto es de otro cliente (traspasarASustituto). Aquí se hace
 * en el mismo orden que él, a mano:
 *   1. copia las 22 filas a contratos/{APC}/seriales con `ya_en_cliente`
 *      (onSerialWrite reapunta el pool sin "des-entregarlos");
 *   2. espera a que el pool los tenga en el contrato de APC;
 *   3. escribe la señal seriales_estado/current → PDF a activaciones con el
 *      contrato correcto (el de hoy le llegó con el cliente equivocado);
 *   4. reapunta las fichas PoC que nombraran al contrato de hoy;
 *   5. ANULA el SERV20261007-02 (no se borra: queda a la vista con el motivo).
 *      Como para entonces ninguna ficha del pool cuelga de él, onAnnulment no
 *      abre devolución ni toca un solo radio.
 *
 * Las fichas PoC ya eran de APC. Los 2 MNC360-R (24605A0244/0249) que la
 * renovación soltó de la cuenta ACODECO NO se tocan aquí.
 *
 * USAGE (desde functions/):
 *   node scripts/traslada-contrato-acodeco-a-apc-2026-10-07.js            # simula
 *   node scripts/traslada-contrato-acodeco-a-apc-2026-10-07.js --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APLICAR = process.argv.includes("--aplicar");
const USUARIO = "script:traslada-contrato-acodeco-a-apc-2026-10-07";
const ORIGEN_ID = "LQsW594AMdagupK9XIMg";   // SERV20261007-02 · ACODECO
const DESTINO_ID = "Fj7rEnCAhhtQ5qFbWHf5";  // SERV20260918-02 · APC
const MOTIVO = "Contrato hecho a la ficha equivocada (ACODECO). El cliente es AUTORIDAD DE PROTECCION AL "
  + "CONSUMIDOR Y DEFENSA DE LA COMPETENCIA: sus 22 seriales pasan a SERV20260918-02.";
const norm = (s) => String(s || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const oRef = db.doc(`contratos/${ORIGEN_ID}`), dRef = db.doc(`contratos/${DESTINO_ID}`);
  const [oSnap, dSnap] = await Promise.all([oRef.get(), dRef.get()]);
  const o = oSnap.data(), d = dSnap.data();
  const oSer = (await oRef.collection("seriales").get()).docs.map((x) => x.data());
  const dSer = (await dRef.collection("seriales").get()).docs.map((x) => x.data());

  const chequeos = [
    [o.contrato_id === "SERV20261007-02" && o.estado === "aprobado", `origen ${o.contrato_id} aprobado (está ${o.estado})`],
    [d.contrato_id === "SERV20260918-02" && d.estado === "activo", `destino ${d.contrato_id} activo (está ${d.estado})`],
    [d.seriales_estado !== "asignados" && dSer.length === 0, `destino sin seriales (${dSer.length}, ${d.seriales_estado})`],
    [oSer.length === 22, `origen con 22 seriales (${oSer.length})`],
  ];
  const pool = await db.getAll(...oSer.map((s) => db.doc(`equipos_pool/${norm(s.serial)}`)));
  const fuera = pool.filter((p) => !p.exists || p.data().estado !== "en_cliente"
    || p.data().asignacion?.contrato_doc_id !== ORIGEN_ID);
  chequeos.push([fuera.length === 0, `los 22 en_cliente colgando del origen (${fuera.map((p) => p.id).join(",") || "ok"})`]);
  let ok = true;
  for (const [pasa, desc] of chequeos) { console.log(`  ${pasa ? "✓" : "✗"} ${desc}`); if (!pasa) ok = false; }
  if (!ok) { console.error("Premisas rotas. Abortado."); process.exit(1); }

  // Fichas PoC que nombren al contrato de hoy.
  const pocQ = await Promise.all([
    db.collection("poc_devices").where("contrato_doc_id", "==", ORIGEN_ID).get(),
    db.collection("poc_devices").where("contrato_id", "==", o.contrato_id).get(),
  ]);
  const pocs = new Map();
  pocQ.forEach((s) => s.forEach((x) => pocs.set(x.id, x)));
  console.log(`\n  copiar ${oSer.length} seriales → ${d.contrato_id} (${d.cliente_nombre})`);
  console.log(`  fichas PoC a reapuntar: ${pocs.size}`);
  console.log(`  anular ${o.contrato_id}: ${MOTIVO}`);
  if (!APLICAR) { console.log("\nSimulación. Corre con --aplicar para escribirlo."); return; }

  // 1. Filas de serial, una a una (cada una dispara onSerialWrite).
  for (const s of oSer) {
    await dRef.collection("seriales").add({
      serial: s.serial, modelo: s.modelo || "", modelo_id: s.modelo_id || null,
      contrato_doc_id: DESTINO_ID, contrato_id: d.contrato_id,
      cliente_id: d.cliente_id, cliente_nombre: d.cliente_nombre,
      ya_en_cliente: true,
      source: "traslado_cliente", migrado_de_contrato: ORIGEN_ID,
      created_by: USUARIO, updated_by: USUARIO,
      created_at: FV.serverTimestamp(), updated_at: FV.serverTimestamp(),
    });
  }
  console.log(`  ✓ ${oSer.length} filas copiadas`);

  // 2. El pool tiene que quedar en el contrato de APC antes de anular el viejo.
  let pend = [];
  for (let i = 0; i < 30; i++) {
    await sleep(4000);
    const ps = await db.getAll(...oSer.map((s) => db.doc(`equipos_pool/${norm(s.serial)}`)));
    pend = ps.filter((p) => p.data().asignacion?.contrato_doc_id !== DESTINO_ID).map((p) => p.id);
    if (!pend.length) break;
  }
  if (pend.length) { console.error(`  ✗ pool sin reapuntar: ${pend.join(", ")} — NO se anula. Revisar.`); process.exit(1); }
  console.log("  ✓ pool reapuntado a SERV20260918-02");

  // 3. Señal de seriales completos (PDF a activaciones) + campos del padre.
  await dRef.collection("seriales_estado").doc("current").set({
    estado: "asignados", omisiones: [], por: USUARIO, at: FV.serverTimestamp(),
  }, { merge: true });
  await dRef.set({
    seriales_estado: "asignados", seriales_asignados_at: FV.serverTimestamp(),
    seriales_asignados_por: USUARIO, seriales_omitidos_count: 0,
    seriales_traslado_de: o.contrato_id,
  }, { merge: true });
  console.log("  ✓ seriales_estado = asignados");

  // 4. PoC.
  if (pocs.size) {
    const b = db.batch();
    pocs.forEach((x) => b.set(x.ref, {
      contrato_doc_id: DESTINO_ID, contrato_id: d.contrato_id,
      contrato_vinculado_por: USUARIO, contrato_reapuntado_de: o.contrato_id,
      updated_at: FV.serverTimestamp(),
    }, { merge: true }));
    await b.commit();
  }
  console.log(`  ✓ ${pocs.size} fichas PoC reapuntadas`);

  // 5. Anular (mismos campos que el botón Anular y que anular-contrato.js).
  await oRef.set({
    estado: "anulado", anulado: true, anulado_motivo: MOTIVO,
    anulado_fecha: admin.firestore.Timestamp.now(), anulado_por_uid: null,
    anulado_ref: o.contrato_id, fecha_modificacion: admin.firestore.Timestamp.now(),
    anulado_traslado_a_id: DESTINO_ID, anulado_traslado_a: d.contrato_id,
  }, { merge: true });
  console.log(`  ✓ ${o.contrato_id} anulado`);
})().catch((e) => { console.error(e); process.exit(1); });
