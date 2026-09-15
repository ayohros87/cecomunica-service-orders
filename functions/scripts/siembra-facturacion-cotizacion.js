/**
 * siembra-facturacion-cotizacion.js — la fila que el trigger ya no va a abrir
 * (2026-09-15)
 *
 * El circuito "cotización de taller → factura" se dispara en la TRANSICIÓN de
 * la orden (entrega en taller o cierre de visita en sitio). Las órdenes que ya
 * estaban cerradas cuando se desplegó no van a transicionar nunca más, así que
 * su cotización se queda fuera de la bandeja para siempre. Caso conocido al
 * desplegar: COT-2026-0083 ($75.33, SKY CHEFS), colgada de la visita
 * 2026090401 que cerró el 4-sep.
 *
 * NO REIMPLEMENTA NADA: invoca el trigger REAL (onOrdenEntregada.run) con un
 * `before` sintético que dice que la orden todavía no había salido. Si mañana
 * el trigger cambia, la siembra cambia con él — una copia de su lógica aquí
 * habría empezado a mentir el primer día.
 *
 * Es idempotente por lo mismo que lo es en producción: si la cotización ya
 * tiene `facturacion.aviso_id`, el trigger la salta.
 *
 * USAGE (desde functions/):
 *   node scripts/siembra-facturacion-cotizacion.js                  (dry-run, todas las elegibles)
 *   node scripts/siembra-facturacion-cotizacion.js --apply
 *   node scripts/siembra-facturacion-cotizacion.js --apply --cot COT-2026-0083
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const CS = require("../src/lib/cotizacionServicio");
const FA = require("../src/lib/facturacionAvisos");
const onEntregada = require("../src/triggers/ordenes/onOrdenEntregada");

const APPLY = process.argv.includes("--apply");
const i = process.argv.indexOf("--cot");
const SOLO = i > -1 ? process.argv[i + 1] : null;

// Los mismos estados terminales que el trigger considera "el trabajo salió".
const SALIO = ["ENTREGADO AL CLIENTE", "CERRADA (VISITA)"];
const norm = (s) => String(s || "").trim().toUpperCase();

(async () => {
  const snap = await db.collection("cotizaciones").get();
  const candidatas = [];

  for (const d of snap.docs) {
    const c = d.data();
    if (!CS.esFacturable(c)) continue;
    if (SOLO && c.cotizacion_id !== SOLO) continue;
    if (c.facturacion?.aviso_id) { console.log(`SALTA ${c.cotizacion_id}: ya tiene fila`); continue; }
    const o = await db.collection("ordenes_de_servicio").doc(String(c.orden_id)).get();
    if (!o.exists) { console.log(`SALTA ${c.cotizacion_id}: la orden ${c.orden_id} no existe`); continue; }
    const estado = norm(o.data().estado_reparacion);
    if (!SALIO.includes(estado)) {
      // El trigger la va a agarrar sola cuando la orden salga. Sembrarla ahora
      // sería facturar un trabajo que todavía está en el taller.
      console.log(`SALTA ${c.cotizacion_id}: la orden ${c.orden_id} sigue en "${estado}" — el trigger la tomará al salir`);
      continue;
    }
    candidatas.push({ cot: c, cotId: d.id, orden: o, estado });
  }

  if (!candidatas.length) { console.log("\nNo hay nada que sembrar."); return; }

  console.log(`\n${candidatas.length} fila(s) a sembrar:`);
  for (const x of candidatas) {
    const r = CS.resumenCotizacion(x.cot);
    console.log(`  ${x.cot.cotizacion_id} · ${x.cot.cliente_nombre} · $${r.total} · orden ${x.cot.orden_id} (${x.estado})`);
    console.log(`     → aviso ${FA.avisoId("cotizacion_servicio", x.cotId)}`);
  }

  if (!APPLY) { console.log("\n(dry-run — corre con --apply)"); return; }

  for (const x of candidatas) {
    // `before` sintético: la orden "todavía no había salido". Es lo único que
    // el trigger mira para decidir que hay transición.
    const before = { exists: true, data: () => ({ ...x.orden.data(), estado_reparacion: "ASIGNADO" }) };
    await onEntregada.run({ data: { before, after: x.orden }, params: { ordenId: String(x.cot.orden_id) } });
    const aviso = await db.collection("facturacion_avisos")
      .doc(FA.avisoId("cotizacion_servicio", x.cotId)).get();
    console.log(`\n${x.cot.cotizacion_id}: ${aviso.exists ? "FILA CREADA" : "NO se creó la fila"}`);
    if (aviso.exists) {
      const a = aviso.data();
      console.log(`  estado=${a.estado} total=$${a.resumen?.total} correo=${a.correo?.mail_queue_id || "(sin enlazar)"}`);
    }
  }
})().catch((e) => { console.error("FALLO:", e.message); process.exit(1); });
