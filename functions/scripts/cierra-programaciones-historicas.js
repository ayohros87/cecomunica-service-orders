/**
 * cierra-programaciones-historicas.js — Cierra órdenes de PROGRAMACIÓN viejas
 * que quedaron en "COMPLETADO (EN OFICINA)" moviéndolas a su único terminal,
 * "ENTREGADO AL CLIENTE", y dejando en `os_logs` por qué se cerraron años
 * después.
 *
 * CONTEXTO (2026-08-10, Colón Container Terminal). Cinco PROGRAMACIÓN de
 * septiembre 2025 llevaban 11 meses en "COMPLETADO (EN OFICINA)" y sus radios
 * aparecieron en el conteo físico de bodega. Lectura del negocio: los equipos
 * SÍ se entregaron en su momento y después el cliente los devolvió — la
 * devolución nunca se registró porque **ese proceso no existía todavía** (la
 * orden de DEVOLUCIÓN es de julio 2026). O sea: el terminal "entregado" es
 * historicamente correcto; lo que faltaba era la vuelta, y esa ya la resolvió
 * el conteo dejando las unidades en bodega.
 *
 * NO se estampa `fecha_entrega`: la entrega fue en 2025 y su fecha exacta no
 * consta. Poner hoy sería afirmar una entrega de hoy — justo el tipo de dato
 * falso que este cierre viene a ordenar.
 *
 * POR QUÉ NO MUEVE INVENTARIO (verificado en código y en datos antes de correr):
 *   · onOrdenWritePool manda a `en_cliente` solo lo que está `en_taller` Y con
 *     `orden_actual_id === ordenId`; estas unidades quedaron `en_bodega`, con
 *     `orden_actual_id: null` y sin asignación.
 *   · onOrdenEntregada exige contrato vinculado; estas órdenes no lo tienen.
 *   · onComplete solo reacciona a COMPLETADO / CERRADA (VISITA), no a ENTREGADO.
 *   · el correo de entrega lo manda la pantalla, no un trigger.
 * Lo que SÍ movería inventario es agregar o quitar seriales de estas órdenes.
 *
 * USAGE (desde functions/):
 *   node scripts/cierra-programaciones-historicas.js <ordenId>[,<ordenId>...] [--write]
 *                                                    [--motivo="..."]
 * Idempotente: una orden ya entregada se salta.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const IDS = (process.argv[2] || "").split(",").map((s) => s.trim()).filter(Boolean);
const dryRun = !process.argv.includes("--write");
const MOTIVO = (process.argv.find((a) => a.startsWith("--motivo=")) || "").split("=").slice(1).join("=")
  || "Cierre histórico: el equipo se entregó en su momento y luego el cliente lo devolvió; "
   + "la devolución no se registró porque ese proceso no existía. Las unidades están en bodega "
   + "según el conteo físico del 2026-08-10.";
const POR = (process.argv.find((a) => a.startsWith("--por=")) || "").split("=")[1]
  || "admin-script-2026-08-10";

const ENTREGADO = "ENTREGADO AL CLIENTE";
const norm = (s) => String(s || "").trim().toUpperCase();

(async () => {
  if (!IDS.length) throw new Error("USAGE: <ordenId>[,<ordenId>...] [--write]");
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  let cerradas = 0, saltadas = 0;
  for (const id of IDS) {
    const ref = db.collection("ordenes_de_servicio").doc(id);
    const snap = await ref.get();
    if (!snap.exists) { console.log(`${id}: NO EXISTE`); saltadas++; continue; }
    const o = snap.data();
    const desde = o.estado_reparacion || "(vacío)";

    if (norm(desde) === ENTREGADO) {
      console.log(`${id}: ya estaba ENTREGADO AL CLIENTE — se salta`);
      saltadas++; continue;
    }
    if (!/PROGRAMA/i.test(String(o.tipo_de_servicio || ""))) {
      console.log(`${id}: tipo ${o.tipo_de_servicio || "?"} — NO es PROGRAMACIÓN, se salta`);
      saltadas++; continue;
    }

    console.log(`${id}: ${desde}  →  ${ENTREGADO}`
      + `  (${(o.equipos || []).length} equipos · ${o.cliente_nombre || "sin cliente"})`);
    if (!dryRun) {
      await ref.update({
        estado_reparacion: ENTREGADO,
        notas_entrega: MOTIVO,
        os_logs: admin.firestore.FieldValue.arrayUnion({
          action: "CIERRE_HISTORICO", from: desde, to: ENTREGADO, by: POR,
        }),
        actualizado_en: admin.firestore.FieldValue.serverTimestamp(),
        actualizado_por_email: POR,
      });
    }
    cerradas++;
  }

  console.log(`\n=== ${cerradas} cerrada(s) · ${saltadas} saltada(s) ===`);
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
