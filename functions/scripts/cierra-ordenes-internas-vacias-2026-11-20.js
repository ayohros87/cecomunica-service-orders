/**
 * cierra-ordenes-internas-vacias-2026-11-20.js
 *
 * Correo de Solangel (2026-11-20): las órdenes de maquillaje de C COMUNICA no
 * tenían cierre. Quedaron abiertas —"Completado", con el botón "Entregar"—
 * órdenes cuyos radios ya salieron todos por otro lado (bodega los liberó a
 * mano y después se vendieron, se entregaron o salieron a una visita).
 *
 * Desde hoy existe "Devolver a bodega" (callable devolverOrdenABodega →
 * CERRADA (A BODEGA)). Este script cierra con ESA MISMA función las órdenes
 * internas abiertas en las que YA NO QUEDA NINGÚN RADIO: es solo poner al día
 * el estado de la orden, no mueve inventario. Las que todavía tienen radios
 * adentro NO se tocan: las cierra quien sabe dónde están (recepción, taller o
 * bodega, con el botón).
 *
 * No manda correo (son cierres de papel, no hay nada que avisar).
 *
 * USAGE (desde functions/):
 *   node scripts/cierra-ordenes-internas-vacias-2026-11-20.js          # dry-run
 *   node scripts/cierra-ordenes-internas-vacias-2026-11-20.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const { db } = require("../src/lib/admin");
const pool = require("../src/domain/equiposPool");
const devolver = require("../src/callable/devolverOrdenABodega");
const { clienteInternoId } = require("../src/domain/clienteInterno");

const WRITE = process.argv.includes("--write");
const VIVOS = ["POR ASIGNAR", "RECIBIDO EN MOSTRADOR", "ASIGNADO", "COMPLETADO (EN OFICINA)"];
const MOTIVO = "Regularización 2026-11-20: los radios de esta orden ya habían salido (bodega los liberó a mano antes de existir este cierre).";
const serialDe = (e) => String((e && (e.numero_de_serie || e.serial)) || "").trim();

(async () => {
  const cid = await clienteInternoId();
  const snaps = await Promise.all(VIVOS.map((e) => db.collection("ordenes_de_servicio")
    .where("cliente_id", "==", cid).where("estado_reparacion", "==", e).get()));
  const ordenes = snaps.flatMap((q) => q.docs).sort((a, b) => a.id.localeCompare(b.id));
  let cerradas = 0, dejadas = 0;
  for (const d of ordenes) {
    const o = d.data();
    if (o.eliminado === true || !devolver.tipoAdmite(o)) { console.log(`· ${d.id} ${o.tipo_de_servicio} — no aplica (tipo con cierre propio o eliminada)`); continue; }
    const equipos = (o.equipos || []).filter((e) => e && !e.eliminado && serialDe(e));
    let adentro = 0;
    const donde = {};
    for (const e of equipos) {
      const r = await pool.resolver(serialDe(e), e.modelo_id || null, e.modelo || "");
      const f = r.data;
      const enEsta = f && f.estado === pool.ESTADOS.EN_TALLER && f.orden_actual_id === d.id;
      if (enEsta) adentro++;
      const k = !f ? "sin_ficha" : enEsta ? "EN ESTA ORDEN" : f.estado;
      donde[k] = (donde[k] || 0) + 1;
    }
    const resumen = `${d.id} · ${o.tipo_de_servicio} · ${o.estado_reparacion} · ${equipos.length} radios ${JSON.stringify(donde)} · "${String(o.observaciones || "").slice(0, 50)}"`;
    if (!equipos.length) { console.log(`· ${resumen} — sin radios: no se toca`); continue; }
    if (adentro > 0) { dejadas++; console.log(`✋ ${resumen} — quedan ${adentro} adentro: se deja para el botón`); continue; }
    if (!WRITE) { cerradas++; console.log(`→ ${resumen} — se cerraría`); continue; }
    const r = await devolver.ejecutar({ usuario: "script:cierra-ordenes-internas-vacias-2026-11-20", ordenId: d.id, motivo: MOTIVO, correo: false });
    cerradas++;
    console.log(`✔ ${resumen} — CERRADA (A BODEGA) · vuelven ${r.vuelven.length} · ya no estaban ${r.ya_no_estaban.length}`);
  }
  console.log(`\n${WRITE ? "Cerradas" : "Se cerrarían"}: ${cerradas} · con radios adentro (no se tocan): ${dejadas}${WRITE ? "" : "  — dry-run, usa --write"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
