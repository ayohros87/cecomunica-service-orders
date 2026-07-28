/**
 * ingresa-bodega-lista.js — Toma una lista de seriales verificados FÍSICAMENTE
 * en bodega y deja el pool acorde: modelo, condición, ubicación y verificado.
 *
 * Por cada serial:
 *   · si no tiene ficha, la crea (el radio existe: bodega lo tiene en la mano);
 *   · fija modelo_id/modelo_label del catálogo y la condición que impone la fila;
 *   · lo pasa a en_bodega soltando la asignación (convención del sistema al
 *     entrar a bodega) y lo marca verificado: lo contó una persona.
 *
 * Si la unidad venía asignada a un contrato VIGENTE, se le estampa al contrato
 * `cancelacion_pendiente` — el equipo volvió pero el contrato sigue vivo, así
 * que aparece en el panel "Contratos por cancelar" del home en vez de quedar
 * en el aire. NO se cancela solo (decisión 2026-07-28).
 *
 * USAGE (desde functions/):
 *   node scripts/ingresa-bodega-lista.js <archivo.txt> <modelo_id> [--write] [--email=..]
 * Idempotente.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO   = process.argv[2];
const MODELO_ID = process.argv[3];
const dryRun    = !process.argv.includes("--write");
const EMAIL     = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:ingresa-bodega-lista";
const VIGENTES  = new Set(["activo", "aprobado"]);

(async () => {
  if (!ARCHIVO || !MODELO_ID) throw new Error("USAGE: <archivo.txt> <modelo_id> [--write]");

  const m = await db.collection("modelos").doc(MODELO_ID).get();
  if (!m.exists) throw new Error(`El modelo ${MODELO_ID} no existe en el catálogo`);
  const mv = m.data();
  const LABEL = `${mv.marca || ""} ${mv.modelo || ""}`.trim();
  // La condición la impone la fila del catálogo, igual que en la pantalla de
  // captura: estado R → reuso.
  const COND = (mv.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo";
  console.log(`Modelo: ${LABEL} (${MODELO_ID}) · estado ${mv.estado} → condicion "${COND}"`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { creadas: 0, movidas: 0, soloModelo: 0, sinCambio: 0, contratos: new Map() };
  const detalle = [];
  let batch = db.batch(), ops = 0;
  const flush = async () => { if (ops && !dryRun) await batch.commit(); batch = db.batch(); ops = 0; };

  for (const norm of seriales) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();

    if (snap.empty) {
      const ref = db.collection("equipos_pool").doc(norm);
      if (!dryRun) {
        batch.set(ref, {
          serial: norm, serial_norm: norm, serial_compartido: false,
          modelo_id: MODELO_ID, modelo_label: LABEL, condicion: COND,
          propiedad: "cecomunica", estado: pool.ESTADOS.EN_BODEGA,
          asignacion: null, poc_device_id: null, orden_actual_id: null,
          origen: "toma_fisica", verificado: true,
          ingreso_bodega_at: null, proveedor: "", notas: "", baja_motivo: null,
          created_at: admin.firestore.FieldValue.serverTimestamp(),
          creado_por_uid: null, creado_por_email: EMAIL,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by: null, updated_by_email: EMAIL,
        });
        batch.set(ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: EMAIL,
          tipo: "alta_manual", de_estado: null, a_estado: pool.ESTADOS.EN_BODEGA, ref: null,
          notas: "Alta por conteo físico de bodega",
        });
        ops += 2;
      }
      r.creadas++;
      detalle.push({ serial: norm, accion: "CREADA", antes: "(no existia)" });
      if (ops >= 400) await flush();
      continue;
    }

    for (const doc of snap.docs) {
      const v = doc.data();
      const asig = v.asignacion || null;
      const yaOk = v.modelo_id === MODELO_ID && v.condicion === COND
        && v.estado === pool.ESTADOS.EN_BODEGA && !v.asignacion && v.verificado === true;
      if (yaOk) { r.sinCambio++; continue; }

      const moviendo = v.estado !== pool.ESTADOS.EN_BODEGA;
      if (!dryRun) {
        batch.update(doc.ref, {
          modelo_id: MODELO_ID, modelo_label: LABEL, condicion: COND,
          estado: pool.ESTADOS.EN_BODEGA,
          asignacion: null, orden_actual_id: null,
          verificado: true,               // lo contó una persona en el estante
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by_email: EMAIL,
        });
        batch.set(doc.ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: EMAIL,
          tipo: moviendo ? "conteo_fisico" : "correccion_modelo",
          de_estado: v.estado || null, a_estado: pool.ESTADOS.EN_BODEGA, ref: null,
          notas: "Conteo físico de bodega: la unidad está en el estante"
            + (asig?.cliente_nombre ? ` — liberada de ${asig.cliente_nombre}${asig.contrato_id ? ` (${asig.contrato_id})` : ""}` : ""),
        });
        ops += 2;
      }
      if (moviendo) r.movidas++; else r.soloModelo++;
      detalle.push({ serial: norm, accion: moviendo ? "A BODEGA" : "solo modelo",
        antes: `${v.modelo_label || "(sin modelo)"} / ${v.estado}` });

      if (asig?.contrato_doc_id) {
        const lista = r.contratos.get(asig.contrato_doc_id) || { id: asig.contrato_id || "", cliente: asig.cliente_nombre || "", seriales: [] };
        lista.seriales.push(norm);
        r.contratos.set(asig.contrato_doc_id, lista);
      }
      if (ops >= 400) await flush();
    }
  }
  await flush();

  // Contratos vigentes que se quedaron sin ese equipo → a la bandeja del home.
  let marcados = 0;
  for (const [docId, info] of r.contratos) {
    const cs = await db.collection("contratos").doc(docId).get();
    if (!cs.exists) continue;
    const estado = String(cs.data().estado || "").toLowerCase();
    if (!VIGENTES.has(estado)) continue;
    marcados++;
    if (!dryRun) {
      await db.collection("contratos").doc(docId).set({
        cancelacion_pendiente: {
          orden_entrada_id: "", orden_numero: "conteo físico de bodega",
          cliente_nombre: info.cliente, seriales: info.seriales,
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
      }, { merge: true });
    }
    console.log(`  contrato ${info.id || docId} (${info.cliente}): ${info.seriales.length} unidad(es) liberadas`);
  }

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`fichas creadas:        ${r.creadas}`);
  console.log(`movidas a bodega:      ${r.movidas}`);
  console.log(`solo modelo/verificado: ${r.soloModelo}`);
  console.log(`sin cambio:            ${r.sinCambio}`);
  console.log(`contratos VIGENTES marcados para cancelar: ${marcados}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
