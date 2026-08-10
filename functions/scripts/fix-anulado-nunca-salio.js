/**
 * fix-anulado-nunca-salio.js — Suelta a bodega las unidades RESERVADAS para un
 * contrato anulado que nunca se entregó.
 *
 * Regla nueva (2026-08-10, ya en onAnnulment): si la ficha está en
 * `asignado_contrato` —reservada, no entregada— y el contrato anulado nunca
 * confirmó entrega, el equipo jamás cruzó la puerta. No hay devolución que
 * confirmar: vuelve a bodega y punto. El check-in humano se reserva para lo que
 * sí salió (`en_cliente` o entrega confirmada).
 *
 * Este script aplica esa regla a lo ya ocurrido, y de paso cierra la orden de
 * DEVOLUCIÓN que se hubiera creado para confirmarlas — si nadie la ha tocado.
 *
 * NO toca:
 *   · unidades `en_cliente` (el equipo salió: alguien debe verificar que volvió)
 *   · unidades propiedad del cliente (esas las degrada onAnnulment a custodia)
 *   · órdenes con algún check-in ya resuelto
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/fix-anulado-nunca-salio.js            # dry-run
 *   node scripts/fix-anulado-nunca-salio.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const pool = require("../src/domain/equiposPool");

const EXECUTE = process.argv.includes("--execute");

(async () => {
  const snap = await db.collection("contratos").where("estado", "==", "anulado").get();
  console.log(`Contratos anulados: ${snap.size} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);

  let unidades = 0, contratos = 0, ordenesCerradas = 0;

  for (const d of snap.docs) {
    const x = d.data();
    if (x.deleted === true) continue;
    if (x.entrega_confirmada === true) continue;      // sí salió: no aplica

    const fichas = await db.collection("equipos_pool")
      .where("asignacion.contrato_doc_id", "==", d.id).get();
    const candidatas = fichas.docs.filter((f) => {
      const u = f.data();
      return u.estado === pool.ESTADOS.ASIGNADO && u.propiedad !== "cliente";
    });
    if (!candidatas.length) continue;

    console.log(`── ${x.contrato_id || d.id} (${x.cliente_nombre || "?"}) · ${candidatas.length} unidad(es) reservadas y nunca entregadas`);
    candidatas.forEach(f => console.log(`     ${f.data().serial || f.id} [${f.data().estado}] → en_bodega`));
    contratos++;
    unidades += candidatas.length;

    if (EXECUTE) {
      for (const f of candidatas) {
        const r = await pool.transicionarPorId(f.id, {
          aEstado: pool.ESTADOS.EN_BODEGA,
          soloDesde: [pool.ESTADOS.ASIGNADO],
          tipo: "liberacion",
          refMov: { tipo: "contrato", id: d.id, label: x.contrato_id || d.id },
          notas: "Contrato anulado sin entrega confirmada — la unidad nunca salió: vuelve a bodega",
          extra: { asignacion: null },
        });
        if (r !== "transicion") console.log(`     ! ${f.data().serial || f.id}: ${r}`);
      }
    }

    // Si tras liberar no queda NADA nuestro colgando, el contrato tiene su
    // respuesta: "no aplica" verificado, no el gris de "no se sabe".
    if (EXECUTE) {
      const resto = fichas.docs.filter((f) => {
        const u = f.data();
        if (candidatas.some(c => c.id === f.id)) return false;   // ya liberada
        return ["asignado_contrato", "en_cliente"].includes(u.estado) && u.propiedad !== "cliente";
      });
      if (!resto.length) {
        await d.ref.set({
          devolucion_estado: "no_aplica",
          devolucion_no_aplica_motivo: "nada_que_recuperar",
          devolucion_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        console.log(`     contrato marcado "no aplica" (verificado: nada nuestro colgando)`);
      } else {
        console.log(`     OJO: quedan ${resto.length} unidad(es) nuestras colgando — el contrato sigue en gris`);
      }
    }

    // La orden de DEVOLUCIÓN que existía solo para confirmar esto ya no hace falta.
    const ordId = x.orden_devolucion_id;
    if (!ordId) continue;
    const oSnap = await db.collection("ordenes_de_servicio").doc(ordId).get();
    if (!oSnap.exists) continue;
    const o = oSnap.data();
    if (o.eliminado === true) continue;
    const resueltos = (o.devolucion?.esperados || []).filter(e => e.resolucion);
    if (resueltos.length) {
      console.log(`     orden ${ordId}: ya tiene ${resueltos.length} check-in(s) — se deja como está`);
      continue;
    }
    console.log(`     orden ${ordId}: sin check-in → se elimina (las unidades ya están en bodega)`);
    ordenesCerradas++;
    if (!EXECUTE) continue;
    await oSnap.ref.set({
      eliminado: true,
      fecha_eliminacion: admin.firestore.FieldValue.serverTimestamp(),
      os_logs: admin.firestore.FieldValue.arrayUnion({
        action: "ELIMINAR",
        by: "system:fix-anulado-nunca-salio",
        nota: "Las unidades nunca se entregaron: se liberaron a bodega sin confirmación",
      }),
    }, { merge: true });
  }

  console.log(`\n${EXECUTE ? "Liberadas" : "Se liberarían"}: ${unidades} unidad(es) en ${contratos} contrato(s) · órdenes eliminadas: ${ordenesCerradas}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
