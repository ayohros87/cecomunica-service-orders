/**
 * resuelve-ordenes-de-contratos-anulados.js — aplica a los contratos YA
 * anulados lo que a partir de ahora hace solo el trigger de la anulación
 * (functions/src/lib/ordenesDeContratoAnulado.js).
 *
 * El trigger dispara en la TRANSICIÓN a 'anulado', así que los 90 contratos que
 * ya estaban anulados el 2026-09-15 no lo vieron nunca: 24 órdenes colgaban de
 * ellos y 4 seguían vivas, tres COMPLETADAS con 15, 10 y 1 radio esperando una
 * entrega imposible desde julio y agosto.
 *
 * Hace exactamente lo mismo que el trigger, ni un paso más:
 *   · orden viva SIN un solo serial            → ANULADA
 *   · orden viva CON equipos preparados        → se SEÑALA (contrato_anulado_revisar)
 *   · contrato con sustituto declarado         → se REPUNTA al sustituto
 *   · orden ya entregada / cerrada / eliminada → no se toca
 *
 * Lo que NO hace, a propósito: adivinar el contrato sustituto. En los 4 casos
 * reales el cliente SÍ tenía un contrato nuevo, pero ninguno estaba declarado en
 * `sustituido_por_id` — y repuntar una orden a un contrato inferido cambia bajo
 * qué papel se entregan los radios y qué se factura. Eso lo decide una persona:
 * el script lo deja señalado y lo dice en el resumen.
 *
 * USAGE (desde functions/):
 *   node scripts/resuelve-ordenes-de-contratos-anulados.js            # simulacro
 *   node scripts/resuelve-ordenes-de-contratos-anulados.js --write    # aplica
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const { planOrdenes } = require("../src/domain/ordenesAnulacion");

const WRITE = process.argv.includes("--write");

(async () => {
  const contratos = await db.collection("contratos").where("estado", "==", "anulado").get();
  console.log(`Contratos anulados: ${contratos.size}${WRITE ? "" : "  (SIMULACRO — usa --write para aplicar)"}\n`);

  const total = { anular: [], revisar: [], repuntar: [], intactas: 0 };

  for (const c of contratos.docs) {
    const data = c.data();
    const numero = data.contrato_id || c.id;
    const os = await db.collection("ordenes_de_servicio")
      .where("contrato.contrato_doc_id", "==", c.id).get();
    if (os.empty) continue;

    const plan = planOrdenes(os.docs.map(d => ({ id: d.id, data: d.data() || {} })), {
      sustitutoId: data.sustituido_por_id || null,
      sustitutoNumero: data.sustituido_por_contrato_id || "",
    });
    total.intactas += plan.intactas.length;
    if (!plan.anular.length && !plan.revisar.length && !plan.repuntar.length) continue;

    console.log(`${numero} (${data.cliente_nombre || "—"}) — anulado: ${String(data.anulado_motivo || "sin motivo").slice(0, 70)}`);
    for (const o of plan.repuntar) {
      console.log(`   REPUNTAR  ${o.id} → ${o.sustitutoNumero || o.sustitutoId}`);
      total.repuntar.push(o.id);
    }
    for (const o of plan.anular) {
      console.log(`   ANULAR    ${o.id} (${o.data.estado_reparacion}) — sin equipos`);
      total.anular.push(o.id);
    }
    for (const o of plan.revisar) {
      console.log(`   REVISAR   ${o.id} (${o.data.estado_reparacion}) — ${o.equipos_n} equipo(s) preparados: decide una persona`);
      total.revisar.push(`${o.id} (${o.equipos_n} eq, ${data.cliente_nombre || "—"})`);
    }

    if (WRITE) {
      const { cerrarOrdenesDeContratoAnulado } = require("../src/lib/ordenesDeContratoAnulado");
      const r = await cerrarOrdenesDeContratoAnulado(c.id, data);
      console.log(`   → aplicado: ${r.anuladas.length} anulada(s), ${r.repuntadas.length} repuntada(s), ${r.revisar.length} señalada(s)`);
    }
  }

  console.log(`\nRESUMEN${WRITE ? "" : " (simulacro)"}`);
  console.log(`  anular:   ${total.anular.length}${total.anular.length ? " → " + total.anular.join(", ") : ""}`);
  console.log(`  repuntar: ${total.repuntar.length}${total.repuntar.length ? " → " + total.repuntar.join(", ") : ""}`);
  console.log(`  intactas (ya entregadas o cerradas): ${total.intactas}`);
  if (total.revisar.length) {
    console.log(`\n  NECESITAN UNA DECISIÓN (${total.revisar.length}) — quedan señaladas, no se tocan:`);
    total.revisar.forEach(t => console.log(`    · ${t}`));
    console.log(`  Si el cliente firmó un contrato nuevo, hay que pasarlas a ese contrato;`);
    console.log(`  si no, anularlas a mano. Mientras tanto no se pueden entregar.`);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
