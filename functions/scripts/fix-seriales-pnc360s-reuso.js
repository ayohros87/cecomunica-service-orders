/**
 * fix-seriales-pnc360s-reuso.js — Corrige modelo y condición de una lista de
 * seriales en equipos_pool para dejarlos en la variante de REUSO del catálogo
 * (fila con estado 'R'), que es la identidad real del equipo refurbished.
 *
 * Contexto (2026-07-28): bodega verificó los estantes de la hoja de 99 seriales
 * HYTERA PNC360S y confirmó que son equipos de reuso. Las fichas venían de
 * `migracion_poc`, que no trae modelo, o apuntaban a la fila NUEVA del catálogo.
 *
 * QUÉ TOCA:  modelo_id, modelo_label, condicion (+ movimiento de auditoría).
 * QUÉ NO:    `estado` ni `asignacion` — la ubicación y el contrato de cada
 *            unidad se mueven por sus flujos propios, no por una corrección de
 *            catálogo. Un serial sin ficha se crea en el estado que indique
 *            --estado-nuevos (por defecto en_bodega).
 *
 * USAGE (desde functions/):
 *   node scripts/fix-seriales-pnc360s-reuso.js <archivo.txt>           # dry-run
 *   node scripts/fix-seriales-pnc360s-reuso.js <archivo.txt> --write
 * Idempotente: correrlo dos veces no genera cambios la segunda vez.
 */
const fs = require("fs");
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ARCHIVO     = process.argv[2];
const dryRun      = !process.argv.includes("--write");
const MODELO_BASE = "PNC360S";
const ESTADO_NUEVOS = pool.ESTADOS.EN_BODEGA;
const AUTOR       = "script:fix-seriales-pnc360s-reuso";

const tight = (s) => (s || "").toString().toLowerCase()
  // eslint-disable-next-line no-control-regex -- intencional: recorta lo no-ASCII
  .normalize("NFD").replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "");

(async () => {
  if (!ARCHIVO) throw new Error("Falta el archivo de seriales");
  const seriales = fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => s.trim()).filter(Boolean);

  // ── Catálogo: fila base (N) y su variante de reuso (R) ────────────────────
  const modelosSnap = await db.collection("modelos").get();
  const nombreDe = (m) => (m.nombre || m.modelo || m.label || m.descripcion || "").toString().trim();
  const modelos = [];
  modelosSnap.forEach((d) => modelos.push({ id: d.id, ...d.data() }));
  const base = modelos.find((m) =>
    tight(nombreDe(m)) === tight(MODELO_BASE) && (m.estado || "").toUpperCase() === "N");
  if (!base) throw new Error(`No hay fila NUEVA para ${MODELO_BASE} en el catálogo`);
  const variante = modelos.find((m) =>
    (m.estado || "").toUpperCase() === "R" && m.variante_de === base.id);
  if (!variante) throw new Error(`${MODELO_BASE} no tiene variante de reuso (variante_de → ${base.id})`);

  const MODELO_ID    = variante.id;
  const MODELO_LABEL = `HYTERA ${nombreDe(variante)}`;
  console.log(`Catalogo: ${nombreDe(base)} (${base.id}) → reuso ${nombreDe(variante)} (${MODELO_ID})`);
  console.log(`Destino:  modelo_id=${MODELO_ID} | modelo_label="${MODELO_LABEL}" | condicion=reuso`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  // ── Qué dice el contrato de cada serial (para ver si alineamos o divergimos) ─
  const contratoDice = new Map(); // serial_norm → Set(modelo)
  const serSnap = await db.collectionGroup("seriales").get();
  serSnap.forEach((d) => {
    const p = d.ref.parent.parent;
    if (!p || p.parent.id !== "contratos") return;
    const v = d.data();
    const n = pool.normSerial(v.serial);
    if (!n) return;
    if (!contratoDice.has(n)) contratoDice.set(n, new Set());
    if ((v.modelo || "").trim()) contratoDice.get(n).add((v.modelo || "").trim());
  });

  const r = { sinCambio: 0, corregidos: 0, creados: 0, alineaContrato: 0, divergeContrato: 0 };
  const detalle = [];
  let batch = db.batch(), ops = 0;
  const flush = async () => {
    if (ops && !dryRun) await batch.commit();
    batch = db.batch(); ops = 0;
  };

  for (const raw of seriales) {
    const norm = pool.normSerial(raw);
    if (!pool.esSerialValido(norm)) { console.log(`!! serial invalido: ${raw}`); continue; }

    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();
    const dice = [...(contratoDice.get(norm) || [])].join(" / ");

    // ── Sin ficha: se crea ─────────────────────────────────────────────────
    if (snap.empty) {
      const ref = db.collection("equipos_pool").doc(norm);
      const doc = {
        serial: raw, serial_norm: norm, serial_compartido: false,
        modelo_id: MODELO_ID, modelo_label: MODELO_LABEL, condicion: "reuso",
        propiedad: "cecomunica", estado: ESTADO_NUEVOS,
        asignacion: null, poc_device_id: null, orden_actual_id: null,
        origen: "verificacion_bodega", verificado: false,
        ingreso_bodega_at: null, proveedor: "", notas: "",
        baja_motivo: null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        creado_por_uid: null, creado_por_email: AUTOR,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: null, updated_by_email: AUTOR,
      };
      if (!dryRun) {
        batch.set(ref, doc);
        batch.set(ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: AUTOR,
          tipo: "alta_manual", de_estado: null, a_estado: ESTADO_NUEVOS, ref: null,
          notas: "Alta por verificación física de bodega (hoja PNC360S reuso, 2026-07-28)",
        });
        ops += 2;
      }
      r.creados++;
      detalle.push({ serial: raw, accion: "CREADA", antes: "(no existia)", contrato: dice });
      if (ops >= 400) await flush();
      continue;
    }

    // ── Ficha(s) existente(s) ──────────────────────────────────────────────
    for (const doc of snap.docs) {
      const v = doc.data();
      const yaOk = v.modelo_id === MODELO_ID
        && (v.modelo_label || "").trim() === MODELO_LABEL
        && (v.condicion || "").toLowerCase() === "reuso";
      const antes = `${(v.modelo_label || "(sin modelo)")} / ${v.condicion || "(sin condicion)"}`;

      if (yaOk) {
        r.sinCambio++;
        detalle.push({ serial: raw, accion: "sin cambio", antes, contrato: dice });
        continue;
      }

      // ¿La corrección acerca o aleja la ficha de lo que dice el contrato?
      if (dice) {
        if (/(-|\s)r\b/i.test(dice) || /r$/i.test(tight(dice))) r.alineaContrato++;
        else r.divergeContrato++;
      }

      if (!dryRun) {
        batch.update(doc.ref, {
          modelo_id: MODELO_ID, modelo_label: MODELO_LABEL, condicion: "reuso",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by_email: AUTOR,
        });
        batch.set(doc.ref.collection("movimientos").doc(), {
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: AUTOR,
          tipo: "correccion_modelo",
          de_estado: v.estado || null, a_estado: v.estado || null, ref: null,
          notas: `Reclasificado a ${MODELO_LABEL} (reuso) por verificación física de bodega. Antes: ${antes}`,
        });
        ops += 2;
      }
      r.corregidos++;
      detalle.push({ serial: raw, accion: "CORREGIDA", antes, contrato: dice });
      if (ops >= 400) await flush();
    }
  }
  await flush();

  // ── Salida ────────────────────────────────────────────────────────────────
  const cambios = detalle.filter((d) => d.accion !== "sin cambio");
  console.log(`--- ${cambios.length} fichas a cambiar ---`);
  cambios.forEach((d) => console.log(
    `${d.accion.padEnd(9)} ${d.serial.padEnd(12)} antes: ${String(d.antes).padEnd(34)} contrato dice: ${d.contrato || "(sin contrato)"}`));

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`ya correctos:      ${r.sinCambio}`);
  console.log(`fichas corregidas: ${r.corregidos}`);
  console.log(`fichas creadas:    ${r.creados}`);
  console.log(`\nde los corregidos, contra lo que dice su contrato:`);
  console.log(`  alinea con el contrato (contrato ya decia -R): ${r.alineaContrato}`);
  console.log(`  diverge del contrato (contrato dice nuevo):    ${r.divergeContrato}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");

  const out = process.env.OUT_CSV;
  if (out) {
    const csv = ["serial,accion,antes,contrato_dice"].concat(detalle.map((d) =>
      [d.serial, d.accion, d.antes, d.contrato].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))).join("\n");
    fs.writeFileSync(out, csv, "utf8");
    console.log(`\nCSV: ${out}`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
