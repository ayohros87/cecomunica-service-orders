/**
 * alta-colision-lista.js — Da de alta en bodega una lista de seriales que YA
 * tienen ficha de OTRO modelo, creando el doc sufijado del failsafe.
 *
 * Es la contraparte de `ingresa-bodega-lista.js`: aquél se SALTA a propósito el
 * serial cuyas fichas son todas de otra familia, porque desde un archivo de
 * conteo no se puede saber si el radio del estante es el de la ficha existente
 * (y hay que repuntarla) o uno distinto que comparte numeración (y hay que
 * crearle la suya). Eso solo lo resuelve quien tiene los dos equipos a la vista.
 * Este script aplica esa respuesta cuando es "son distintos".
 *
 * El caso real es Kenwood: la serie se reusa entre el portátil (NX-420) y la
 * base/móvil (NX-920). Bodega lo confirmó con `B3900146` el 2026-08-07 y con
 * los 15 del conteo del 2026-08-11.
 *
 * Escribe exactamente lo que hace `EquiposPoolService.agregar` en su rama de
 * colisión (public/js/services/equiposPoolService.js): doc con ID
 * `${serial}__${modeloKey}`, `serial_compartido: true` en TODAS las fichas del
 * serial, y movimiento en el kardex. Se marca `verificado: true` porque el alta
 * viene de un conteo físico, no de una migración.
 *
 * NO toca la ficha existente más allá de `serial_compartido` — sacarla de su
 * flota es justo lo que este camino evita.
 *
 * Para cerrar además la cola de Conflictos: marca-radios-distintos.js.
 *
 * USAGE (desde functions/):
 *   node scripts/alta-colision-lista.js <archivo.txt> <modelo_id> [--write]
 *        [--propiedad=cecomunica|cliente|desconocida] [--motivo="..."] [--email=..]
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
const PROPIEDAD = (process.argv.find((a) => a.startsWith("--propiedad=")) || "").split("=")[1] || "cecomunica";
const MOTIVO    = (process.argv.find((a) => a.startsWith("--motivo=")) || "").split("=").slice(1).join("=")
  || "Alta por conteo físico: serial compartido entre modelos, son radios distintos";
const EMAIL     = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:alta-colision-lista";
const PROPIEDADES = new Set(["cecomunica", "cliente", "desconocida"]);

(async () => {
  if (!ARCHIVO || !MODELO_ID) throw new Error("USAGE: <archivo.txt> <modelo_id> [--write]");
  if (!PROPIEDADES.has(PROPIEDAD)) {
    throw new Error(`--propiedad debe ser una de: ${[...PROPIEDADES].join(", ")}`);
  }

  const m = await db.collection("modelos").doc(MODELO_ID).get();
  if (!m.exists) throw new Error(`El modelo ${MODELO_ID} no existe en el catálogo`);
  const mv = m.data();
  const LABEL = `${mv.marca || ""} ${mv.modelo || ""}`.trim();
  const COND = (mv.estado || "").toUpperCase() === "R" ? "reuso" : "nuevo";
  console.log(`Modelo a crear: ${LABEL} (${MODELO_ID}) · estado ${mv.estado} → condicion "${COND}"`);
  console.log(`Propiedad: ${PROPIEDAD} · Motivo: ${MOTIVO}`);
  console.log(dryRun ? "\n*** DRY-RUN — no se escribe nada ***\n" : "\n*** ESCRIBIENDO ***\n");

  const seriales = [...new Set(fs.readFileSync(ARCHIVO, "utf8").split(/\r?\n/)
    .map((s) => pool.normSerial(s.trim())).filter(Boolean))];

  const r = { creadas: 0, yaExistia: 0, sinColision: 0 };
  for (const norm of seriales) {
    const snap = await db.collection("equipos_pool").where("serial_norm", "==", norm).get();

    if (snap.empty) {
      // Sin ficha previa no hay colisión: esto es un alta normal y la hace
      // ingresa-bodega-lista.js, que además sabe soltar asignaciones.
      r.sinColision++;
      console.log(`!! ${norm}: sin ficha previa — no hay colisión, usar ingresa-bodega-lista.js`);
      continue;
    }
    if (snap.docs.some((d) => pool.mismoModelo(d.data(), MODELO_ID, LABEL))) {
      r.yaExistia++;
      console.log(`   ${norm}: ya tiene ficha de ${LABEL} — sin cambio`);
      continue;
    }

    const sufijado = `${norm}__${pool.modeloKey(MODELO_ID, LABEL)}`;
    const otras = snap.docs.map((d) => `${d.data().modelo_label || "(sin modelo)"} [${d.id}] ${d.data().estado || ""}`);
    console.log(`   ${norm} → crea [${sufijado}] ${LABEL} / ${COND} en bodega` +
      `   (convive con: ${otras.join(" | ")})`);

    if (!dryRun) {
      const batch = db.batch();
      const ref = db.collection("equipos_pool").doc(sufijado);
      batch.set(ref, {
        serial: norm, serial_norm: norm, serial_compartido: true,
        modelo_id: MODELO_ID, modelo_label: LABEL, condicion: COND,
        propiedad: PROPIEDAD, estado: pool.ESTADOS.EN_BODEGA,
        asignacion: null, poc_device_id: null, orden_actual_id: null,
        origen: "toma_fisica", verificado: true,
        ingreso_bodega_at: admin.firestore.FieldValue.serverTimestamp(),
        proveedor: "", notas: "", baja_motivo: null,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        creado_por_uid: null, creado_por_email: EMAIL,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: null, updated_by_email: EMAIL,
      });
      batch.set(ref.collection("movimientos").doc(), {
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: EMAIL,
        tipo: "ingreso_bodega", de_estado: null, a_estado: pool.ESTADOS.EN_BODEGA, ref: null,
        notas: `Alta con colisión de serial entre modelos. ${MOTIVO}`,
      });
      // El aviso "2+ MODELOS" tiene que salir en las DOS fichas, no solo en la
      // nueva: quien abra la vieja necesita saber que el serial está partido.
      snap.docs.forEach((d) => batch.update(d.ref, {
        serial_compartido: true,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by_email: EMAIL,
      }));
      await batch.commit();
    }
    r.creadas++;
  }

  console.log(`\n=== ${seriales.length} seriales ===`);
  console.log(`fichas creadas:      ${r.creadas}`);
  console.log(`ya tenían la ficha:  ${r.yaExistia}`);
  if (r.sinColision) console.log(`sin ficha previa:    ${r.sinColision}`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
