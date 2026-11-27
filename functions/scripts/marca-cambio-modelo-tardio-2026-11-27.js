/**
 * marca-cambio-modelo-tardio-2026-11-27.js
 *
 * Correo de Brenda (2026-11-27, "Consulta Sobre Gestiones de Reemplazo Por
 * Cambio de Modelo"): GR20261125-01 MEDICINA LEGAL cambió un P50PRO por un
 * PNC460-R y el correo de programación decía "la facturación no cambia".
 *
 * El cambio pedido por el VENDEDOR no se detectaba: se medía contra el modelo
 * pedido y no contra el del radio que sale. Desde hoy se mide contra el
 * saliente (lib/gestiones.cambiosDeModelo). Este script marca los reemplazos
 * que ya salieron de aprobación con un cambio así SIN decisión de tarifa:
 * `cambio_modelo.{serial entrante}` = pendiente + `tardio: true`. No toca el
 * estado ni el radio; administración decide la tarifa en el Centro
 * ("Decidir la tarifa del cambio de modelo…") y recepción recibe el aviso.
 *
 * USAGE (desde functions/):
 *   node scripts/marca-cambio-modelo-tardio-2026-11-27.js          # dry-run
 *   node scripts/marca-cambio-modelo-tardio-2026-11-27.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const { db } = require("../src/lib/admin");
const G = require("../src/lib/gestiones");

const WRITE = process.argv.includes("--write");

(async () => {
  const snap = await db.collection("gestiones").where("tipo", "==", "reemplazo").get();
  let n = 0;
  for (const d of snap.docs) {
    const g = d.data();
    if (g.deleted || ["anulada", "pendiente_aprobacion"].includes(g.estado)) continue;
    const { sinDecidir } = G.estadoCambiosModelo(g);
    // Lo que está esperando de verdad (pendiente con ese modelo) no se re-marca.
    const faltan = sinDecidir.filter(c => !(g.cambio_modelo?.[c.clave]?.estado === "pendiente" && g.cambio_modelo[c.clave].a_id === c.a_id));
    if (!faltan.length) continue;
    n++;
    console.log(`${WRITE ? "✔" : "[dry]"} ${d.id} · ${g.estado} · ${g.cliente_nombre} · `
      + faltan.map(c => `${c.saliente} (${c.de}) → ${c.serial} (${c.a}) [${c.origen}]`).join("; "));
    if (!WRITE) continue;
    const patch = {};
    for (const c of faltan) {
      const t = await G.tarifasContrato(c.contrato_doc_id, c.de_id, c.a_id);
      patch[c.clave] = {
        estado: "pendiente", tardio: true, serial: c.serial, saliente: c.saliente,
        de: c.de, de_id: c.de_id, a: c.a, a_id: c.a_id, origen: c.origen, motivo: c.motivo,
        tarifa_de: t[c.de_id] ?? null, tarifa_a: t[c.a_id] ?? null,
        contrato_doc_id: c.contrato_doc_id,
        propuesto_at: admin.firestore.FieldValue.serverTimestamp(),
      };
    }
    await d.ref.set({ cambio_modelo: patch }, { merge: true });
    await G.registrarEvento(d.id, "cambio_modelo",
      `Cambio de modelo detectado después de programar: ${faltan.map(c => `${c.saliente} (${c.de}) → ${c.serial} (${c.a})`).join("; ")}. `
      + "Nadie había decidido la tarifa: queda pendiente para administración (no cambia el estado ni el radio).");
  }
  console.log(`\n${n} gestión(es) ${WRITE ? "marcadas" : "por marcar (dry-run)"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
