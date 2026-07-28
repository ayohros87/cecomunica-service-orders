/**
 * correr-conciliacion.js — Re-corre la conciliación del pool a demanda y
 * reescribe admin_reportes/conciliacion_pool. Misma lógica que el cron del
 * lunes (src/domain/conciliacionPool.js): sirve para ver el efecto de una
 * limpieza sin esperar una semana a que el reporte deje de mentir.
 *
 * Es de SOLO LECTURA sobre el pool y las fuentes — lo único que escribe es el
 * documento del reporte.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/correr-conciliacion.js
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const conciliacion = require("../src/domain/conciliacionPool");

(async () => {
  const R = await conciliacion.ejecutar();
  const fila = (label, n) => console.log(`  ${String(n).padStart(5)}  ${label}`);
  console.log(`Fichas en el pool: ${R.fichas_total}\n`);
  fila("A · serial de contrato vigente sin ficha (o de otro contrato)", R.A_contrato_sin_ficha);
  fila("B · en taller con la orden ya cerrada", R.B_taller_orden_cerrada);
  fila("C1 · device POC activo sin NINGUNA ficha del serial", R.C_poc_sin_ficha);
  fila("C2 · device POC activo con ficha, pero sin enlace", R.C_poc_sin_enlace);
  fila("D · asignada a contrato ANULADO sin devolución", R.D_asignada_a_anulado);
  fila("E · vendido con enlace de orden colgante", R.E_vendido_orden_cerrada);
  fila("F · mismo serial ACTIVO con dos clientes", R.F_serial_dos_clientes);
  console.log(`\n  TOTAL: ${R.total}   (devices apagados ignorados: ${R.poc_apagados_ignorados})`);
  for (const [k, v] of Object.entries(R)) {
    if (!Array.isArray(v) || !v.length) continue;
    console.log(`\n${k}:`);
    v.slice(0, 8).forEach((x) => console.log("   " + JSON.stringify(x)));
  }
})().catch((e) => { console.error("FATAL", e); process.exit(1); });
