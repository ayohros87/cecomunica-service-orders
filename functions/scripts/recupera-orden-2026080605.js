/**
 * recupera-orden-2026080605.js — Devuelve a la vista la orden de DEVOLUCIÓN
 * 2026080605, que `fix-anulado-nunca-salio.js` eliminó mientras una persona la
 * estaba trabajando (incidente 2026-08-10, reportado por Brenda).
 *
 * Qué pasó, en segundos:
 *   14:32:39Z  el script liberó a bodega las 4 unidades reservadas del contrato
 *              anulado PROP20260805-02 (nunca se entregaron)
 *   14:32:40Z  el mismo script eliminó la orden que existía para confirmarlas
 *   (en ese momento Brenda estaba registrando los 4 seriales → "No se encuentra
 *    la orden", y al refrescar la orden ya no aparecía)
 *
 * NO se restaura vacía: pedirle que vuelva a teclear los 4 seriales sería
 * hacerle repetir trabajo para llegar al mismo sitio. El kardex ya prueba que
 * las unidades nunca salieron (en_bodega → asignado_contrato → en_bodega, nunca
 * en_cliente), así que la orden se restaura con las 4 resoluciones puestas en
 * `nunca_salio` —que es la verdad física— y CERRADA, atribuidas al sistema para
 * que la auditoría no diga que las confirmó una persona.
 *
 * Efectos colaterales, verificados antes de correr:
 *   · el pool NO se mueve: transicionarPorId con soloDesde=[asignado, en_cliente]
 *     sobre unidades ya en_bodega devuelve "sin-cambio" sin escribir kardex
 *   · NO se crea orden de ENTRADA: solo la generan las resoluciones `recibido`,
 *     y aquí no hay ninguna (nada que inspeccionar, el equipo no salió)
 *   · el espejo del contrato pasa de `no_aplica` a `completa`, más preciso
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/recupera-orden-2026080605.js            # dry-run
 *   node scripts/recupera-orden-2026080605.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const EXECUTE = process.argv.includes("--execute");
const ORDEN_ID = "2026080605";
const NOTA = "Resuelto automáticamente el 2026-08-10: el contrato se anuló sin "
  + "entrega confirmada y el kardex prueba que la unidad nunca salió de bodega. "
  + "La orden se había eliminado por error mientras se trabajaba en ella.";

(async () => {
  const ref = db.collection("ordenes_de_servicio").doc(ORDEN_ID);
  const snap = await ref.get();
  if (!snap.exists) { console.log(`La orden ${ORDEN_ID} no existe.`); process.exit(1); }
  const o = snap.data();

  console.log(`Orden ${ORDEN_ID} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}`);
  console.log(`  eliminado actual: ${o.eliminado} · estado: ${o.estado_reparacion}`);

  const esperados = (o.devolucion?.esperados || []).map((e) => {
    if (e.resolucion) return e;          // respeta cualquier check-in real
    return {
      ...e,
      resolucion: "nunca_salio",
      motivo_codigo: null,
      motivo_detalle: null,
      resuelto_at: admin.firestore.Timestamp.now(),
      resuelto_por: "system:recupera-orden-2026080605",
    };
  });
  esperados.forEach(e => console.log(`  ${e.serial} → ${e.resolucion} (${e.resuelto_por || "check-in real"})`));

  console.log(`  se restaura visible y CERRADA (DEVOLUCION); sin ENTRADA (no hay 'recibido')`);
  if (!EXECUTE) { console.log("\ndry-run: nada escrito."); process.exit(0); }

  // OJO: `update()`, no `set(merge)`. Solo update() interpreta "a.b" como RUTA
  // de campo; set(merge) lo toma como un nombre literal y crea un campo basura
  // llamado "devolucion.esperados" al lado del objeto real — pasó en el primer
  // intento y dejó la orden cerrada con 4 pendientes fantasma.
  await ref.update({
    eliminado: false,
    fecha_eliminacion: admin.firestore.FieldValue.delete(),
    estado_reparacion: "CERRADA (DEVOLUCION)",
    "devolucion.esperados": esperados,
    "devolucion.cierre_nota": NOTA,
    // Limpieza del intento fallido, si quedó.
    ["devolucion.esperados".replace(/\./g, "\\.")]: admin.firestore.FieldValue.delete(),
    ["devolucion.cierre_nota".replace(/\./g, "\\.")]: admin.firestore.FieldValue.delete(),
    os_logs: admin.firestore.FieldValue.arrayUnion({
      action: "RESTAURAR",
      by: "system:recupera-orden-2026080605",
      nota: NOTA,
    }),
  });

  console.log("\nRestaurada y cerrada. Las 4 unidades ya estaban en bodega — el pool no se toca.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
