/**
 * regulariza-cambio-modelo-ligo-2026-09-29.js — Deja registrado, en la cuenta
 * de TRANSPORTE LIGO, que el reemplazo GR20260923-01 se entregó con OTRO
 * modelo y que administración lo validó con la tarifa sin cambio.
 *
 * CONTEXTO. El reemplazo se aprobó con un PNC550-R (el modelo del radio
 * dañado 21708A0008); bodega puso el PNC460-R 23905A0437 porque no había
 * PNC550 en buen estado ("Excepción de modelo" en la bitácora, 2026-09-24).
 * Nadie decidió la tarifa. Alberto, 2026-09-29: "con LIGO sí va a seguir
 * pagando la misma tarifa, pero sí debe haber una validación de esto y
 * arreglo de la información que queda registrada para el cliente".
 *
 * La validación (cambio_modelo en onGestionWrite + Centro) no existía cuando
 * esto pasó: aquí se registra A POSTERIORI con la misma forma que usa hoy,
 * para que el expediente se lea igual que uno nuevo. Corrige además los tres
 * lugares que decían PNC550-R para el radio que entró:
 *   · gestión: items[0] (modelo_id_nuevo/modelo_nuevo) + cambio_modelo
 *   · gestión/mapeos: el mapeo automático de la entrega
 *   · orden 2026092403: equipos[0].modelo_id (el texto ya decía PNC460-R)
 * y deja el evento en la bitácora. El contrato no se toca: el reemplazo no
 * toca el contrato firmado, y LIGO no tiene esa línea en un contrato del
 * sistema (la devolución dice "contrato de papel").
 *
 * USAGE (desde functions/):
 *   node scripts/regulariza-cambio-modelo-ligo-2026-09-29.js            # dry-run
 *   node scripts/regulariza-cambio-modelo-ligo-2026-09-29.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const GID = "GR20260923-01";
const OS = "2026092403";
const SERIAL = "23905A0437";
const PNC460 = { id: "6tdGBjLOmq567GJRTMbQ", label: "HYTERA PNC460-R" };
const MOTIVO_BODEGA = "EL REMPLAZO ES POR UN PNC460 YA QUE NO HAY RADIO PNC550 EN BUENAS CONDICIONES";
const ALBERTO = { uid: "aYV7NGmUHBY3lJv3uaBZD1LqFGs2", email: "alberto.yohros@cecomunica.com" };

(async () => {
  const gRef = db.collection("gestiones").doc(GID);
  const g = (await gRef.get()).data();
  const it = (g.items || [])[0] || {};
  if (String(it.serial_nuevo || "").toUpperCase() !== SERIAL) throw new Error(`El ítem de ${GID} no es ${SERIAL}`);

  const items = (g.items || []).map((x, i) => i !== 0 ? x : {
    ...x, modelo_id_nuevo: PNC460.id, modelo_nuevo: PNC460.label, cambio_modelo_motivo: MOTIVO_BODEGA,
  });
  const decision = {
    estado: "aprobado", serial: SERIAL, saliente: it.serial_saliente || null,
    de: it.modelo_solicitado || it.modelo || "", de_id: it.modelo_solicitado_id || it.modelo_id || null,
    a: PNC460.label, a_id: PNC460.id, motivo: MOTIVO_BODEGA,
    tarifa_de: null, tarifa_a: null, contrato_doc_id: null,
    tarifa: "se_mantiene",
    nota: "Validado a posteriori (2026-09-29): el cliente sigue pagando la misma tarifa.",
    decidido_por_uid: ALBERTO.uid, decidido_por_email: ALBERTO.email,
    decidido_at: admin.firestore.FieldValue.serverTimestamp(),
    regularizado: true,
  };
  console.log(`Gestión ${GID}: ítem → ${PNC460.label}; cambio_modelo.${SERIAL} = aprobado, tarifa se mantiene`
    + (g.cambio_modelo?.[SERIAL] ? " (YA EXISTE — se reescribe igual)" : ""));

  const maps = await gRef.collection("mapeos").get();
  const mapeos = maps.docs.filter(d => String(d.data().entrante || "").toUpperCase() === SERIAL && d.data().modelo_id !== PNC460.id);
  console.log(`Mapeos a corregir: ${mapeos.length}`);

  const oRef = db.collection("ordenes_de_servicio").doc(OS);
  const o = (await oRef.get()).data();
  const equipos = (o.equipos || []).map(e => String(e.serial || "").toUpperCase() === SERIAL
    ? { ...e, modelo_id: PNC460.id, modelo: PNC460.label } : e);
  const tocaOrden = (o.equipos || []).some(e => String(e.serial || "").toUpperCase() === SERIAL && e.modelo_id !== PNC460.id);
  console.log(`Orden ${OS} (${o.estado_reparacion}): ${tocaOrden ? "modelo_id → PNC460-R" : "ya correcta"}`);

  if (!EXECUTE) { console.log("\nDRY-RUN. Corre con --execute para aplicar."); return; }

  await gRef.update({ items, [`cambio_modelo.${SERIAL}`]: decision });
  for (const m of mapeos) await m.ref.update({ modelo_id: PNC460.id, modelo: PNC460.label });
  if (tocaOrden) {
    await oRef.update({
      equipos,
      os_logs: admin.firestore.FieldValue.arrayUnion({
        action: "CORREGIR_MODELO", by: "script:regulariza-cambio-modelo-ligo", by_email: null,
        at_iso: new Date().toISOString(), de: "PNC550-R (id)", a: PNC460.label,
        motivo: `El radio ${SERIAL} es ${PNC460.label}; la orden nació con el modelo aprobado en ${GID}`,
      }),
    });
  }
  await gRef.collection("eventos").add({
    accion: "cambio_modelo",
    detalle: `Cambio de modelo APROBADO a posteriori (${SERIAL}: ${decision.de} → ${PNC460.label}). Tarifa: se mantiene — `
      + "el cliente sigue pagando lo mismo. Se corrigió el modelo del radio que entró en la gestión, el mapeo y la orden "
      + `${OS}. (La validación de cambio de modelo no existía cuando se entregó.)`,
    at: admin.firestore.FieldValue.serverTimestamp(),
    por_uid: ALBERTO.uid, por_email: ALBERTO.email,
  });
  console.log("Aplicado.");
})().catch((e) => { console.error(e); process.exit(1); });
