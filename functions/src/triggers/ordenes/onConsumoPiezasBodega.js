// Piezas registradas DESPUÉS de cerrar → bodega se entera igual (2026-11-19).
//
// El técnico no siempre registra todo antes de cerrar: en la visita 2026111802
// agregó una pieza sin costo al día siguiente del cierre. El aviso del cierre
// (onOrdenCompletada → lib/piezasBodega) ya había salido —o no había nada que
// avisar— y esa pieza no llegaba a ningún papel de bodega.
//
// Este trigger escucha la subcolección `consumos`. Si la orden todavía se está
// trabajando no hace nada (el aviso sale al completar). Si el trabajo ya se
// hizo, espera a que el técnico termine de tocar las piezas y manda UN aviso
// con el conteo final, marcado como actualización.
//
// LA ESPERA. Registrar seis piezas son seis escrituras; sin espera serían seis
// correos. Cada evento deja su id como "último cambio", duerme, y al despertar
// solo sigue si nadie escribió después (rebote de cola). La huella de
// lib/piezasBodega corta lo que quede: el mismo conteo nunca sale dos veces.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../../lib/admin");
const PB = require("../../lib/piezasBodega");

// Los tests la bajan a 0 con PIEZAS_BODEGA_ESPERA_MS.
const esperaMs = () => {
  const v = Number(process.env.PIEZAS_BODEGA_ESPERA_MS);
  return Number.isFinite(v) && v >= 0 ? v : 75000;
};
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = onDocumentWritten(
  {
    document: "ordenes_de_servicio/{ordenId}/consumos/{consumoId}",
    region: "us-central1",
    timeoutSeconds: 180,
  },
  async (event) => {
    const ordenId = event.params.ordenId;
    const oSnap = await db.collection("ordenes_de_servicio").doc(ordenId).get();
    if (!oSnap.exists) return null;
    if (!PB.trabajoHecho(oSnap.data())) return null; // aún en el taller: avisa el cierre

    const marca = event.id || `${event.params.consumoId}:${Date.now()}`;
    const ref = PB.refEstado(ordenId);
    await ref.set({
      ultimo_cambio: marca,
      ultimo_cambio_at: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const ms = esperaMs();
    if (ms) await dormir(ms);

    const est = await ref.get();
    if (est.data()?.ultimo_cambio !== marca) return null; // hubo otro cambio después: avisa ese

    try {
      const r = await PB.avisarPiezasABodega({ ordenId, momento: "consumo" });
      if (r.enviado) logger.info("[onConsumoPiezasBodega] piezas tardías avisadas a bodega", { ordenId, unidades: r.unidades });
    } catch (e) {
      logger.error("[onConsumoPiezasBodega] aviso de piezas a bodega falló", { message: e.message, ordenId });
    }
    return null;
  }
);
