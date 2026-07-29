/**
 * alta-bases-por-conteo.js — Da de alta en bodega una lista de seriales de un
 * modelo, RESPETANDO el failsafe de colisión de serial.
 *
 * Kenwood reutiliza series entre modelos distintos (NX-420 portátil vs NX-920
 * base), así que el mismo serial puede ser dos radios físicos diferentes. El
 * sistema ya lo contempla: `pool.resolver()` detecta que el serial existe bajo
 * OTRO modelo y devuelve un ref sufijado (`SERIAL__modelokey`), y las dos
 * fichas quedan marcadas `serial_compartido: true`. Este script NO repunta la
 * ficha existente — crea la que falta y deja las dos convivir, que es la
 * decisión de negocio (2026-07-29).
 *
 * USAGE (desde functions/):
 *   node scripts/alta-bases-por-conteo.js <archivo.txt> <modelo_id> [--write] [--email=..]
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
  || "script:alta-bases-por-conteo";

(async () => {
  if (!ARCHIVO || !MODELO_ID) throw new Error("USAGE: <archivo.txt> <modelo_id> [--write]");

  const ms = await db.collection("modelos").doc(MODELO_ID).get();
  if (!ms.exists) throw new Error(`El modelo ${MODELO_ID} no existe`);
  const mv = ms.data();
  const LABEL = `${mv.marca || ""} ${mv.modelo || ""}`.trim();
  const COND  = (mv.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo";
  console.log(`Modelo: ${LABEL} (${MODELO_ID}) · tipo ${mv.tipo} · estado ${mv.estado} → condicion "${COND}"`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { limpias: 0, colision: 0, actualizadas: 0, sinCambio: 0 };
  const colisiones = [];

  const docNuevo = (serialNorm, compartido) => ({
    serial: serialNorm, serial_norm: serialNorm, serial_compartido: !!compartido,
    modelo_id: MODELO_ID, modelo_label: LABEL, condicion: COND,
    propiedad: "cecomunica", estado: pool.ESTADOS.EN_BODEGA,
    asignacion: null, poc_device_id: null, orden_actual_id: null,
    origen: "toma_fisica", verificado: true,   // la contó una persona en el estante
    ingreso_bodega_at: null, proveedor: "", notas: "", baja_motivo: null,
    created_at: admin.firestore.FieldValue.serverTimestamp(),
    creado_por_uid: null, creado_por_email: EMAIL,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_by: null, updated_by_email: EMAIL,
  });

  for (const norm of seriales) {
    const { ref, data, colisionConId } = await pool.resolver(norm, MODELO_ID, LABEL);

    // Ficha de ESTA unidad ya existe → solo asegurar bodega/verificado.
    if (data) {
      const yaOk = data.estado === pool.ESTADOS.EN_BODEGA && !data.asignacion
        && data.verificado === true && data.modelo_id === MODELO_ID;
      if (yaOk) { r.sinCambio++; continue; }
      if (!dryRun) {
        await ref.set({
          modelo_id: MODELO_ID, modelo_label: LABEL, condicion: COND,
          estado: pool.ESTADOS.EN_BODEGA, asignacion: null, orden_actual_id: null,
          verificado: true,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          updated_by_email: EMAIL,
        }, { merge: true });
        await ref.collection("movimientos").doc().set({
          at: admin.firestore.FieldValue.serverTimestamp(),
          por: "system", por_email: EMAIL,
          tipo: "conteo_fisico", de_estado: data.estado || null,
          a_estado: pool.ESTADOS.EN_BODEGA, ref: null,
          notas: "Conteo físico de bodega: la unidad está en el estante"
            + (data.asignacion?.cliente_nombre ? ` — liberada de ${data.asignacion.cliente_nombre}` : ""),
        });
      }
      r.actualizadas++;
      continue;
    }

    // No existe ficha de esta unidad. Con colisión, la nueva va sufijada y las
    // dos quedan marcadas como serial compartido (dos radios, misma serie).
    if (!dryRun) {
      await ref.set(docNuevo(norm, !!colisionConId));
      await ref.collection("movimientos").doc().set({
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: EMAIL,
        tipo: "alta_manual", de_estado: null, a_estado: pool.ESTADOS.EN_BODEGA, ref: null,
        notas: `Alta por conteo físico de bodega${colisionConId ? " — serie compartida con otro modelo Kenwood" : ""}`,
      });
      if (colisionConId) {
        await db.collection("equipos_pool").doc(colisionConId)
          .set({ serial_compartido: true }, { merge: true });
      }
    }
    if (colisionConId) {
      r.colision++;
      const otra = await db.collection("equipos_pool").doc(colisionConId).get();
      colisiones.push(`${norm}  ficha nueva: ${ref.id}  ·  ya existía como ${otra.exists ? otra.data().modelo_label : "?"}`);
    } else {
      r.limpias++;
    }
  }

  if (colisiones.length) {
    console.log(`--- ${colisiones.length} series compartidas (dos radios distintos) ---`);
    colisiones.forEach((c) => console.log("  " + c));
  }
  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`fichas creadas limpias:      ${r.limpias}`);
  console.log(`fichas creadas por colision: ${r.colision}`);
  console.log(`fichas ya existentes movidas: ${r.actualizadas}`);
  console.log(`sin cambio:                  ${r.sinCambio}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
