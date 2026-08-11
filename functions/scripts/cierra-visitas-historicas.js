/**
 * cierra-visitas-historicas.js — Lleva a su terminal propio, CERRADA (VISITA),
 * las VISITA TÉCNICA que se quedaron en "COMPLETADO (EN OFICINA)" porque ese
 * terminal no existía todavía.
 *
 * CONTEXTO (2026-08-11). Una visita técnica ocurre en las instalaciones del
 * cliente y se cierra en sitio, con firma. Su terminal, CERRADA (VISITA), llegó
 * el 2026-07-28; las anteriores se quedaron en "COMPLETADO (EN OFICINA)" porque
 * no había otro botón. El corte es limpio y verificado: las 21 paradas se
 * completaron entre el 2026-02-03 y el 2026-07-17, y NINGUNA es posterior al
 * terminal. Mientras tanto ensucian dos sitios: la cola de "esperando QC" del
 * recordatorio diario al taller (recordatorioOperativo, sección D) y el
 * inventario, dejando `orden_actual_id` colgando.
 *
 * QUÉ TOCA: solo `estado_reparacion` (+ marca y log).
 * QUÉ NO:
 *   · Inventario: onOrdenWritePool manda las VISITA a su rama `esVisita`, que
 *     solo limpia `orden_actual_id` — nunca mueve una unidad. El radio del
 *     cliente jamás salió de sus instalaciones.
 *   · Estadísticas del técnico y correo: los estampa onComplete, que SÍ cuenta
 *     CERRADA (VISITA). Sin freno mandaría 21 correos al taller y a ventas
 *     sobre visitas de hace meses, y sumaría una segunda marca a cada técnico
 *     —ya contaron al pasar por COMPLETADO—. Por eso se estampa
 *     `correccion_terminal: true`, que onComplete respeta.
 *
 * ⚠️ REQUIERE FUNCTIONS DESPLEGADO con el guard de `correccion_terminal` en
 *    onComplete.js. Si se corre antes, los 21 correos salen igual.
 *    Comprobar:  firebase deploy --only functions:onComplete
 *
 * USAGE (desde functions/):
 *   node scripts/cierra-visitas-historicas.js            # dry-run
 *   node scripts/cierra-visitas-historicas.js --write
 * Idempotente: una visita ya cerrada se salta.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const dryRun = !process.argv.includes("--write");
const DESTINO = "CERRADA (VISITA)";
const ORIGEN  = "COMPLETADO (EN OFICINA)";
// El terminal existe desde esta fecha: lo posterior que siga parado NO es un
// hueco histórico, es trabajo real, y se revisa a mano.
const CORTE   = "2026-07-28";
const AUTOR   = "script:cierra-visitas-historicas";
const iso = (t) => {
  const d = t?.toDate ? t.toDate() : null;
  return d && !isNaN(d) ? d.toISOString().slice(0, 10) : "";
};

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const snap = await db.collection("ordenes_de_servicio").get();
  const objetivo = [];
  let fueraDeCorte = 0;
  snap.forEach((d) => {
    const v = d.data();
    if (v.eliminado === true) return;
    if (!/VISITA/i.test(v.tipo_de_servicio || "")) return;
    if ((v.estado_reparacion || "").toUpperCase().trim() !== ORIGEN) return;
    const fecha = iso(v.fecha_completado) || iso(v.fecha_creacion);
    if (!fecha || fecha >= CORTE) { fueraDeCorte++; return; }
    objetivo.push({
      id: d.id, orden: v.numero_orden || d.id,
      cliente: v.cliente_nombre || "", fecha,
      equipos: (v.equipos || []).filter((e) => e && !e.eliminado).length,
    });
  });

  objetivo.sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  console.log(`--- ${objetivo.length} VISITA TÉCNICA en "${ORIGEN}" anteriores a ${CORTE} ---`);
  objetivo.forEach((o) =>
    console.log(`  ${String(o.orden).padEnd(12)} ${o.fecha}  ${String(o.equipos).padStart(3)} equipo(s)  ${o.cliente}`));
  if (fueraDeCorte) console.log(`\n(${fueraDeCorte} posteriores al corte — se revisan a mano)`);

  let batch = db.batch(), ops = 0;
  for (const o of objetivo) {
    if (dryRun) continue;
    batch.update(db.collection("ordenes_de_servicio").doc(o.id), {
      estado_reparacion: DESTINO,
      // Lo leen onComplete (sin stats ni correo) y onOrdenWritePool.
      correccion_terminal: true,
      correccion_terminal_at: admin.firestore.FieldValue.serverTimestamp(),
      correccion_terminal_de: ORIGEN,
      os_logs: admin.firestore.FieldValue.arrayUnion({
        action: "CORREGIR_TERMINAL", from: ORIGEN, to: DESTINO, by: AUTOR,
      }),
    });
    ops++;
    if (ops >= 400) { await batch.commit(); batch = db.batch(); ops = 0; }
  }
  if (ops && !dryRun) await batch.commit();

  console.log(`\n=== ${objetivo.length} visita(s) ${dryRun ? "por cerrar" : "cerradas"} → "${DESTINO}" ===`);
  console.log("(sin correo, sin estadísticas dobles y sin tocar inventario)");
  if (dryRun) console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
