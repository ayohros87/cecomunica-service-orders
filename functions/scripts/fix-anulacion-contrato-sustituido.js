/**
 * fix-anulacion-contrato-sustituido.js — Corrige la anulación ADMINISTRATIVA de
 * ALQ20260715-01 (SOCIEDAD ISRAELITA), donde el contrato se re-hizo por un error
 * de precio y los equipos NUNCA se movieron.
 *
 * Qué pasó (verificado en datos, 2026-08-13):
 *   2026-07-15  ALQ20260715-01 aprobado con 32 seriales
 *   2026-07-24  ENTREGADO al cliente (orden 2026071703) → 32 fichas en_cliente
 *   2026-08-06  se ANULA "por error en el contrato (correo de Elvia 4/8/2026)":
 *               faltaba el ajuste de precio del micrófono de los HYT-P50
 *   2026-08-06  se aprueba ALQ20260806-03 — el MISMO cliente, los MISMOS 32
 *               equipos (12 HYT-P50 + 18 PNC360S-R + 2 PNC460-R), precio
 *               corregido ($755.42/mes) — pero se quedó sin seriales cargados
 *
 * El trigger onAnnulment hizo lo correcto: como las unidades estaban `en_cliente`
 * (salieron de verdad), abrió la orden de DEVOLUCIÓN 2026080602 para que un
 * humano confirmara el retorno. Pero no hay retorno que confirmar: los radios
 * siguen donde el cliente, ahora bajo el contrato sustituto. El sistema no sabe
 * distinguir "anulación con contrato sustituto" de una anulación de verdad.
 *
 * Qué NO se hace: mandar las 32 unidades a bodega. Están operando donde el
 * cliente (POC las reporta activas). Marcarlas en_bodega mentiría el inventario
 * y la conciliación semanal las cazaría como drift.
 *
 * Qué hace, en orden (el orden IMPORTA, ver comentarios de cada fase):
 *   1. ALQ20260806-03 ← entrega_confirmada + fecha de la entrega real
 *   2. copia los 32 seriales al contrato nuevo → onSerialWrite re-apunta cada
 *      ficha del pool vía upsertContacto, que con estado igual (en_cliente →
 *      en_cliente) igual escribe la asignación y estampa un movimiento
 *      `reasignacion` en el kardex (equiposPool.js:283-295)
 *   3. ALQ20260806-03 ← seriales_estado "asignados"
 *   4. orden 2026080602 → eliminado:true (cancelada); el propio
 *      onOrdenDevolucionWrite suelta el chip del contrato viejo
 *   5. ALQ20260715-01 ← devolucion_estado "no_aplica / contrato_sustituido"
 *
 * NO envía el PDF de seriales al cliente: ese correo lo dispara la subcolección
 * `seriales_estado/current`, y aquí solo se escribe el campo espejo del padre.
 * Es una corrección administrativa de un contrato ya entregado — si se quiere
 * el PDF, se manda desde la UI.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/fix-anulacion-contrato-sustituido.js            # dry-run
 *   node scripts/fix-anulacion-contrato-sustituido.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");

const VIEJO  = "156e3yjbTRPzAftFxytZ";   // ALQ20260715-01 (anulado)
const NUEVO  = "NfWZND4RjvQwlJ7y18qy";   // ALQ20260806-03 (aprobado)
const ORDEN  = "2026080602";             // DEVOLUCIÓN a cancelar
const BY     = "system:fix-anulacion-contrato-sustituido";

const NOTA = "Anulación administrativa: ALQ20260715-01 se re-hizo como "
  + "ALQ20260806-03 por el ajuste de precio del micrófono. Los 32 equipos nunca "
  + "se movieron — siguen con el cliente bajo el contrato sustituto. No hay "
  + "devolución que confirmar.";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log(`Modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);

  // ── Verificación de premisas ───────────────────────────────────────────────
  // Si algo de esto cambió desde el análisis, el script NO debe correr a ciegas.
  const viejoSnap = await db.collection("contratos").doc(VIEJO).get();
  const nuevoSnap = await db.collection("contratos").doc(NUEVO).get();
  const ordenSnap = await db.collection("ordenes_de_servicio").doc(ORDEN).get();
  if (!viejoSnap.exists || !nuevoSnap.exists || !ordenSnap.exists) {
    console.error("Falta alguno de los tres documentos. Abortado."); process.exit(1);
  }
  const viejo = viejoSnap.data(), nuevo = nuevoSnap.data(), orden = ordenSnap.data();

  const chequeos = [
    [viejo.estado === "anulado",            `contrato viejo anulado (es ${viejo.estado})`],
    [viejo.entrega_confirmada === true,     "el viejo tenía entrega confirmada"],
    [nuevo.estado === "aprobado",           `contrato nuevo aprobado (es ${nuevo.estado})`],
    [nuevo.cliente_id === viejo.cliente_id, "mismo cliente en ambos contratos"],
    [(nuevo.contrato_origen_ids || []).length === 0,
      "el nuevo NO tiene origen vinculado (si lo tuviera, la entrega dispararía onEntregaTransicion)"],
    [orden.eliminado !== true,              "la orden sigue viva"],
    [orden.tipo_de_servicio === "DEVOLUCION", "la orden es de DEVOLUCION"],
  ];
  // El candado que importa: si alguien ya hizo check-in de alguna unidad, hubo
  // trabajo humano real sobre este tiquete y este script no lo puede pisar.
  const esperados = orden.devolucion?.esperados || [];
  const resueltos = esperados.filter((e) => e.resolucion);
  chequeos.push([resueltos.length === 0,
    `la orden no tiene check-ins (tiene ${resueltos.length})`]);

  let ok = true;
  for (const [pasa, desc] of chequeos) {
    console.log(`  ${pasa ? "✓" : "✗"} ${desc}`);
    if (!pasa) ok = false;
  }
  if (!ok) { console.error("\nPremisas rotas. Abortado — revisar a mano."); process.exit(1); }

  // Los seriales del contrato viejo son la fuente: son los que están afuera.
  const serSnap = await db.collection("contratos").doc(VIEJO).collection("seriales").get();
  const seriales = serSnap.docs.filter((d) => (d.data().serial || "").trim());
  console.log(`\n  ✓ ${seriales.length} seriales en el contrato viejo`);

  // Y las fichas del pool tienen que seguir donde el análisis las dejó.
  const fichas = await db.collection("equipos_pool")
    .where("asignacion.contrato_doc_id", "==", VIEJO).get();
  const fuera = fichas.docs.filter((f) => f.data().estado === "en_cliente");
  console.log(`  ✓ ${fuera.length} de ${fichas.size} fichas del pool en_cliente`);
  if (fichas.size !== fuera.length) {
    console.error("Hay fichas en otro estado — revisar a mano. Abortado."); process.exit(1);
  }

  if (!EXECUTE) {
    console.log("\n── Se haría ──");
    console.log(`  1. ${nuevo.contrato_id}: entrega_confirmada=true, fecha_entrega_ultima=${viejo.fecha_entrega_ultima?.toDate?.().toISOString() || "?"}`);
    console.log(`  2. copiar ${seriales.length} seriales → contratos/${NUEVO}/seriales`);
    console.log(`     (onSerialWrite re-apunta las ${fuera.length} fichas del pool, sin moverlas de en_cliente)`);
    console.log(`  3. ${nuevo.contrato_id}: seriales_estado="asignados" (sin PDF al cliente)`);
    console.log(`  4. orden ${ORDEN}: eliminado=true (cancelada)`);
    console.log(`  5. ${viejo.contrato_id}: devolucion_estado="no_aplica" (contrato_sustituido)`);
    console.log("\ndry-run: nada escrito.");
    process.exit(0);
  }

  // ── 1. Entrega en el contrato nuevo ───────────────────────────────────────
  // ANTES de los seriales, a propósito: onSerialWrite decide en_cliente vs
  // asignado_contrato leyendo `entrega_confirmada` del contrato. Al revés, las
  // 32 fichas se degradarían a "reservadas" — diciendo que el equipo está en
  // bodega apartado cuando está con el cliente.
  // Dispara onEntregaPool (lee una subcolección de seriales todavía vacía →
  // no-op) y onEntregaTransicion (sin origen vinculado → sale en el guard).
  await db.collection("contratos").doc(NUEVO).set({
    entrega_confirmada: true,
    fecha_entrega_ultima: viejo.fecha_entrega_ultima || null,
    correccion_anulacion_at: admin.firestore.FieldValue.serverTimestamp(),
    correccion_anulacion_por: BY,
    correccion_anulacion_nota: NOTA,
    correccion_anulacion_sustituye_a: viejo.contrato_id || VIEJO,
  }, { merge: true });
  console.log(`\n1. ${nuevo.contrato_id}: entrega confirmada (fecha real de la entrega física)`);

  // ── 2. Seriales → re-apunte del pool por el camino oficial ────────────────
  // Se escriben de uno en uno: cada uno dispara onSerialWrite, que hace el
  // upsert en el pool. En lote (batch) el trigger igual corre, pero de a uno se
  // puede reportar el avance y se le da aire a las 32 transacciones del pool.
  let copiados = 0;
  for (const d of seriales) {
    const s = d.data();
    await db.collection("contratos").doc(NUEVO).collection("seriales").doc(d.id).set({
      ...s,
      contrato_doc_id: NUEVO,
      contrato_id: nuevo.contrato_id || "",
      source: "correccion-anulacion",
      created_by: BY,
      updated_by: BY,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      // De dónde salió esta fila, para que la auditoría no tenga que adivinar.
      migrado_de_contrato: VIEJO,
    });
    copiados++;
  }
  console.log(`2. ${copiados} seriales copiados a ${nuevo.contrato_id}`);

  // ── 3. Esperar a que los triggers re-apunten el pool ──────────────────────
  console.log("   esperando a onSerialWrite (re-apunte del pool)...");
  let reapuntadas = 0;
  for (let intento = 1; intento <= 12; intento++) {
    await sleep(5000);
    const q = await db.collection("equipos_pool")
      .where("asignacion.contrato_doc_id", "==", NUEVO).get();
    reapuntadas = q.size;
    const malEstado = q.docs.filter((f) => f.data().estado !== "en_cliente");
    console.log(`   intento ${intento}: ${reapuntadas}/${seriales.length} re-apuntadas`
      + (malEstado.length ? ` · OJO ${malEstado.length} fuera de en_cliente` : ""));
    if (reapuntadas >= seriales.length) break;
  }
  if (reapuntadas < seriales.length) {
    console.warn(`\n   ! Solo ${reapuntadas}/${seriales.length} re-apuntadas. Los triggers`
      + " pueden ir con retraso — verificar antes de continuar. NO se cancela la orden todavía.");
    console.warn("   Volver a correr el script (es idempotente) o revisar los logs de onSerialWrite.");
    process.exit(1);
  }

  // ── 4. Señal de seriales del contrato nuevo ───────────────────────────────
  // Campo del PADRE, no la subcolección `seriales_estado/current`: esa es la que
  // dispara onSerialesAsignadasSendPdf (correo con el PDF del contrato). Esto es
  // una corrección de datos de un contrato ya entregado, no una asignación
  // nueva — el cliente no debe recibir nada.
  await db.collection("contratos").doc(NUEVO).set({
    seriales_estado: "asignados",
    seriales_asignados_at: admin.firestore.FieldValue.serverTimestamp(),
    seriales_asignados_por: BY,
    seriales_omitidos_count: 0,
  }, { merge: true });
  console.log(`3. ${nuevo.contrato_id}: seriales_estado="asignados" (sin correo al cliente)`);

  // ── 5. Cancelar la orden de DEVOLUCIÓN ────────────────────────────────────
  // Soft delete, no cierre. Cerrarla exigiría poner una resolución por unidad y
  // ninguna dice la verdad: "recibido" las manda a cuarentena, "nunca_salio" las
  // manda a bodega (mentira: sí salieron), y "no_devuelve" les estampa
  // `devolucion_excepcion` — la marca de perdido/vendido, que estas 32 no son.
  // El tiquete simplemente no debió existir; es el mismo trato que recibieron
  // las devoluciones falsas de "Adición" el 2026-08-10.
  //
  // El doc NO se borra: queda con su historia y su explicación. Y
  // onOrdenDevolucionWrite, al ver eliminado:true, suelta el chip del contrato
  // viejo (estamparEspejo con borrada=true).
  await db.collection("ordenes_de_servicio").doc(ORDEN).update({
    eliminado: true,
    fecha_eliminacion: admin.firestore.FieldValue.serverTimestamp(),
    devolucion_cancelacion_nota: NOTA,
    os_logs: admin.firestore.FieldValue.arrayUnion({
      action: "ELIMINAR", by: BY, nota: NOTA,
    }),
  });
  console.log(`4. orden ${ORDEN}: cancelada (eliminado=true, con nota)`);

  // ── 6. Cerrar la fila del contrato viejo ──────────────────────────────────
  // Después de la cancelación a propósito: estamparEspejo BORRA los campos
  // devolucion_* al quitar el último tiquete. Si esto se escribiera antes, el
  // trigger lo pisaría y la fila quedaría en "sin registro" — que en este
  // sistema significa "no se sabe", no "no aplica".
  console.log("   esperando al espejo del contrato...");
  for (let intento = 1; intento <= 6; intento++) {
    await sleep(5000);
    const c = (await db.collection("contratos").doc(VIEJO).get()).data();
    if (!c.devolucion_tiquetes || !(ORDEN in c.devolucion_tiquetes)) {
      console.log(`   intento ${intento}: espejo liberado`);
      break;
    }
    console.log(`   intento ${intento}: el tiquete sigue en el contrato...`);
  }
  await db.collection("contratos").doc(VIEJO).set({
    devolucion_estado: "no_aplica",
    devolucion_no_aplica_motivo: "contrato_sustituido",
    devolucion_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
    correccion_anulacion_at: admin.firestore.FieldValue.serverTimestamp(),
    correccion_anulacion_por: BY,
    correccion_anulacion_nota: NOTA,
    correccion_anulacion_sustituido_por: nuevo.contrato_id || NUEVO,
  }, { merge: true });
  console.log(`5. ${viejo.contrato_id}: devolucion_estado="no_aplica" (contrato_sustituido)`);

  console.log("\nListo. Los 32 radios siguen en_cliente — ninguno se movió de sitio.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
