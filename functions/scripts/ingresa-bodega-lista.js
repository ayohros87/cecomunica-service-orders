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
 * La PROPIEDAD no se toca por defecto: un radio del cliente puede estar
 * legítimamente guardado en nuestra bodega. Se corrige solo si se pide con
 * `--propiedad=` — el caso típico es una devolución vieja que el backfill
 * clasificó como "cliente" porque entró únicamente por una orden de servicio
 * (regla 4 de backfill-propiedad.js) sin contrato que la amparara.
 *
 * SERIALES COMPARTIDOS ENTRE MODELOS (Kenwood NX-420 / NX-920 y compañía): un
 * serial puede tener DOS fichas, una por modelo, y son dos radios distintos.
 * Contar el estante del modelo A no dice nada del radio del modelo B, así que
 * cuando el serial trae varias fichas solo se toca la que ya es de este modelo
 * y las demás se reportan intactas. Sin este filtro el conteo de NX-420-R del
 * 2026-08-06 habría repuntado a NX-420-R la ficha NX-920-R de B3900146 —
 * borrando de la flota 920 un radio que nadie contó.
 *
 * USAGE (desde functions/):
 *   node scripts/ingresa-bodega-lista.js <archivo.txt> <modelo_id> [--write] [--email=..]
 *                                        [--propiedad=cecomunica|cliente|desconocida]
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
const PROPIEDAD = (process.argv.find((a) => a.startsWith("--propiedad=")) || "").split("=")[1] || "";
const VIGENTES  = new Set(["activo", "aprobado"]);
const PROPIEDADES = new Set(["cecomunica", "cliente", "desconocida"]);

(async () => {
  if (!ARCHIVO || !MODELO_ID) throw new Error("USAGE: <archivo.txt> <modelo_id> [--write]");
  if (PROPIEDAD && !PROPIEDADES.has(PROPIEDAD)) {
    throw new Error(`--propiedad debe ser una de: ${[...PROPIEDADES].join(", ")}`);
  }

  const m = await db.collection("modelos").doc(MODELO_ID).get();
  if (!m.exists) throw new Error(`El modelo ${MODELO_ID} no existe en el catálogo`);
  const mv = m.data();
  const LABEL = `${mv.marca || ""} ${mv.modelo || ""}`.trim();
  // La condición la impone la fila del catálogo, igual que en la pantalla de
  // captura: estado R → reuso.
  const COND = (mv.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo";
  console.log(`Modelo: ${LABEL} (${MODELO_ID}) · estado ${mv.estado} → condicion "${COND}"`);
  console.log(PROPIEDAD ? `Propiedad: se fuerza a "${PROPIEDAD}"` : "Propiedad: se respeta la que ya tiene");
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { creadas: 0, movidas: 0, soloModelo: 0, sinCambio: 0, otroModelo: 0,
    ambiguos: [], contratos: new Map() };
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
          propiedad: PROPIEDAD || "cecomunica", estado: pool.ESTADOS.EN_BODEGA,
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

    // Solo es de este conteo la ficha que YA es de este modelo (o la que no
    // tiene modelo: adoptar > duplicar). Si ninguna lo es, nadie puede decidir
    // desde aquí cuál era el radio que estaba en el estante.
    //
    // El filtro corre SIEMPRE, no solo cuando el serial trae varias fichas: una
    // ficha ÚNICA de otro modelo es el caso más peligroso, porque repuntarla la
    // borra de su flota y nadie se entera. Con el candado puesto solo para
    // `snap.size > 1`, el conteo de NX-420-R del 2026-08-11 se habría llevado
    // por delante 15 fichas NX-920-R que estaban en bodega — la colisión
    // Kenwood 420/920 es real (portátil vs base) y solo la resuelve quien tiene
    // el radio en la mano.
    const propias = snap.docs.filter((d) => pool.mismoModelo(d.data(), MODELO_ID, LABEL));
    if (!propias.length) {
      r.ambiguos.push({ serial: norm,
        fichas: snap.docs.map((d) => `${d.data().modelo_label || "(sin modelo)"} [${d.id}] ${d.data().estado || ""}`) });
      continue;
    }
    r.otroModelo += snap.size - propias.length;
    const docs = propias;

    for (const doc of docs) {
      const v = doc.data();
      const asig = v.asignacion || null;
      const yaOk = v.modelo_id === MODELO_ID && v.condicion === COND
        && v.estado === pool.ESTADOS.EN_BODEGA && !v.asignacion && v.verificado === true
        && (!PROPIEDAD || v.propiedad === PROPIEDAD);
      if (yaOk) { r.sinCambio++; continue; }

      const moviendo = v.estado !== pool.ESTADOS.EN_BODEGA;
      if (!dryRun) {
        batch.update(doc.ref, {
          modelo_id: MODELO_ID, modelo_label: LABEL, condicion: COND,
          estado: pool.ESTADOS.EN_BODEGA,
          ...(PROPIEDAD ? { propiedad: PROPIEDAD } : {}),
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
  if (r.otroModelo) console.log(`fichas de OTRO modelo (mismo serial), intactas: ${r.otroModelo}`);
  if (r.ambiguos.length) {
    console.log(`\nseriales con fichas SOLO de otros modelos — sin tocar, revisar a mano:`);
    r.ambiguos.forEach((a) => console.log(`  ${a.serial}: ${a.fichas.join(" | ")}`));
  }
  console.log(`contratos VIGENTES marcados para cancelar: ${marcados}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
