/**
 * corrige-devolucion-2026111703-duplicada.js — Deja sin efecto, con nota de
 * corrección, la DEVOLUCIÓN 2026111703 que Brenda registró el 17-nov-2026 a
 * nombre de MENZIES AVIATION por error (correo del 18-nov-2026).
 *
 * El radio 23706A0332 (PNC360S-R) era de EUROLATIN HOSPITALITY CORP - WESTIN
 * PLAYA BONITA: lo trajo el técnico Ovidio Adames el 16-nov. Brenda no pudo
 * eliminar la orden (se cerró sola al registrar el serial y el acuse) y rehízo
 * el caso bien:
 *
 *   2026111703  DEVOLUCIÓN  MENZIES    cerrada   ← el residuo (esto se corrige)
 *   2026111704  ENTRADA     MENZIES    eliminada por Brenda ("Cliente Errado.")
 *   2026111705  DEVOLUCIÓN  EUROLATIN  cerrada   ← la buena
 *   2026111706  ENTRADA     EUROLATIN  por asignar
 *
 * Por eso NO se le cambia el cliente a la 2026111703 (quedarían dos
 * devoluciones de Eurolatin por el mismo radio) ni se elimina (los saneos
 * cierran, no borran; y Brenda pidió poder reimprimirla con la nota). Se le
 * antepone la nota a `observaciones` (sale en la orden impresa), se guarda el
 * dato estructurado en `correccion` y queda la línea en os_logs.
 *
 * No toca el pool (23706A0332 ya está en devuelto_revision por la 2026111705),
 * ni la ficha de Menzies, ni las otras tres órdenes. El trigger
 * onOrdenDevolucionWrite corre con la escritura pero no tiene nada que hacer:
 * ninguna resolución cambia, no hay acuse nuevo y la orden ya está cerrada.
 *
 * USAGE (desde functions/):
 *   node scripts/corrige-devolucion-2026111703-duplicada.js            # dry-run
 *   node scripts/corrige-devolucion-2026111703-duplicada.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const FV = admin.firestore.FieldValue;
const ORIGEN = "script:corrige-devolucion-2026111703-duplicada";
const MALA = "2026111703";
const BUENA = "2026111705";
const ENTRADA_BUENA = "2026111706";
const SERIAL = "23706A0332";
const MENZIES = "hu6uM94Z4lVEAgaFg2F8";
const EUROLATIN = "l393CCQu7xqyQELqLQWr";

(async () => {
  const col = db.collection("ordenes_de_servicio");
  const [mala, buena, entrada] = (await Promise.all([MALA, BUENA, ENTRADA_BUENA].map(id => col.doc(id).get()))).map(s => (s.exists ? s.data() : null));

  // Candados: el script solo corre sobre el caso exacto que se revisó.
  const exigir = (cond, msg) => { if (!cond) { console.error("ALTO: " + msg); process.exit(1); } };
  exigir(mala && buena && entrada, "falta alguna de las tres órdenes");
  if (mala.correccion) { console.log(`La ${MALA} ya tiene la corrección (${mala.correccion.por}). Nada que hacer.`); process.exit(0); }
  exigir(mala.tipo_de_servicio === "DEVOLUCION" && mala.cliente_id === MENZIES && mala.estado_reparacion === "CERRADA (DEVOLUCION)" && mala.eliminado !== true,
    `la ${MALA} no está como se revisó (devolución cerrada de Menzies)`);
  const serialesDe = (o) => (o.devolucion?.esperados || []).map(e => e.serial);
  exigir(serialesDe(mala).length === 1 && serialesDe(mala)[0] === SERIAL, `la ${MALA} no es de un solo radio ${SERIAL}`);
  exigir(buena.tipo_de_servicio === "DEVOLUCION" && buena.cliente_id === EUROLATIN && buena.eliminado !== true && serialesDe(buena).includes(SERIAL),
    `la ${BUENA} no es la devolución de Eurolatin con el ${SERIAL}`);
  exigir(entrada.tipo_de_servicio === "ENTRADA" && entrada.cliente_id === EUROLATIN && entrada.eliminado !== true,
    `la ${ENTRADA_BUENA} no es la entrada viva de Eurolatin`);

  const nota = `CORRECCIÓN (18-nov-2026): esta devolución se registró por error a nombre de ${String(mala.cliente_nombre).replace(/\.$/, "")}. `
    + `El cliente correcto es ${buena.cliente_nombre}. El radio ${SERIAL} quedó registrado en la devolución ${BUENA} `
    + `(entrada ${ENTRADA_BUENA}). Esta orden queda sin efecto.`;
  const cambios = {
    observaciones: `${nota}\n\n${mala.observaciones || ""}`.trim(),
    correccion: {
      tipo: "duplicada_cliente_errado",
      cliente_correcto_id: EUROLATIN,
      cliente_correcto_nombre: buena.cliente_nombre,
      reemplazada_por: BUENA,
      entrada: ENTRADA_BUENA,
      nota,
      solicitada_por: "cecrecep@cecomunica.com",
      por: ORIGEN,
      at: FV.serverTimestamp(),
    },
    os_logs: FV.arrayUnion({ action: "CORRECCION", by: ORIGEN, at: admin.firestore.Timestamp.now(), nota }),
  };

  console.log(`${MALA} · ${mala.cliente_nombre} · ${mala.estado_reparacion}`);
  console.log("\nNota que se antepone a observaciones:\n  " + nota);
  console.log("\nObservaciones actuales (se conservan debajo):\n  " + String(mala.observaciones || "(vacías)").slice(0, 200) + "…");
  if (!EXECUTE) { console.log("\nDRY-RUN: no se escribió nada. Repite con --execute."); process.exit(0); }
  await col.doc(MALA).set(cambios, { merge: true });
  const d = (await col.doc(MALA).get()).data();
  console.log(`\nHECHO: correccion.reemplazada_por=${d.correccion.reemplazada_por} · estado=${d.estado_reparacion} · cliente=${d.cliente_nombre}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
