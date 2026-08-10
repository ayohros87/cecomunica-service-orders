/**
 * fix-adicion-devolucion-falsa.js — Deshace las órdenes de DEVOLUCIÓN que
 * nacieron de una ADICIÓN.
 *
 * Hasta el 2026-08-10, `onEntregaTransicion` metía `accion === 'Adición'` en el
 * mismo saco que Renovación/Reemplazo: al confirmarse la entrega reclamaba
 * TODAS las unidades del contrato original. Pero una adición AGREGA equipo a un
 * contrato que sigue vigente — el cliente conserva lo de antes y recibe lo
 * nuevo. El resultado fueron órdenes pidiendo equipo que el cliente tiene con
 * todo derecho (NADCAR ALQ20260803-01: 8 radios añadidos, el sistema reclamó
 * los 10 del original, que sigue ACTIVO).
 *
 * Qué deshace, por cada orden afectada:
 *   1. Borra los mapeos auto (`auto: true`) del contrato de la adición.
 *      onMapeoWrite revierte al borrarlos: limpia `pendiente_devolucion` y
 *      `reemplaza_a` en las fichas del pool. Ese es el camino diseñado.
 *   2. Soft-delete de la orden (`eliminado: true`), con nota en os_logs.
 *   3. Quita el tiquete del espejo del contrato y recalcula los derivados; si
 *      no queda ninguno, borra los campos para que la fila no muestre chip.
 *   4. Limpia `transicion_auto_at` / `transicion_auto_unidades`.
 *
 * SOLO toca órdenes SIN NINGUNA resolución de check-in. Si alguien ya empezó a
 * recibir equipo contra la orden, se reporta y NO se toca: ahí hubo movimiento
 * físico real y deshacerlo a ciegas sería peor que el bug.
 *
 * USAGE (desde functions/, PowerShell con $env:NODE_PATH):
 *   node scripts/fix-adicion-devolucion-falsa.js            # dry-run
 *   node scripts/fix-adicion-devolucion-falsa.js --execute
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const { derivarEstadoDevolucion } = require("../src/lib/devolucion");

const EXECUTE = process.argv.includes("--execute");

(async () => {
  const snap = await db.collection("ordenes_de_servicio")
    .where("tipo_de_servicio", "==", "DEVOLUCION").get();

  const afectadas = [];
  for (const d of snap.docs) {
    const o = d.data();
    if (o.eliminado === true) continue;
    const cid = o.contrato?.contrato_doc_id;
    if (!cid) continue;
    // La firma del bug son DOS cosas juntas: la orden la creó
    // onEntregaTransicion (origen.tipo === 'renovacion') Y el contrato es una
    // Adición. Filtrar solo por `accion === 'Adición'` barría también órdenes
    // legítimas nacidas de una ANULACIÓN sobre un contrato que resulta ser
    // adición — pasó en el dry-run con DESARROLLO ACQUA TRES (2026080605).
    if (o.devolucion?.origen?.tipo !== "renovacion") continue;
    const c = await db.collection("contratos").doc(cid).get();
    if (!c.exists || c.data().accion !== "Adición") continue;
    afectadas.push({ id: d.id, orden: o, cid, contrato: c.data() });
  }

  console.log(`Órdenes de DEVOLUCIÓN nacidas de una ADICIÓN: ${afectadas.length} · modo: ${EXECUTE ? "EXECUTE" : "dry-run"}\n`);
  if (!afectadas.length) { console.log("Nada que hacer."); process.exit(0); }

  let deshechas = 0, saltadas = 0;

  for (const { id, orden, cid, contrato } of afectadas) {
    const esperados = orden.devolucion?.esperados || [];
    const resueltos = esperados.filter(e => e.resolucion);
    console.log(`── ${id} → ${contrato.contrato_id} (${contrato.cliente_nombre})`);
    console.log(`   ${esperados.length} esperado(s), ${resueltos.length} ya resuelto(s), estado ${orden.estado_reparacion}`);

    if (resueltos.length) {
      console.log(`   SALTADA: ya hubo check-in (${resueltos.map(e => e.serial + ':' + e.resolucion).join(", ")}) — revisar a mano`);
      saltadas++;
      continue;
    }

    const mapeos = await db.collection("contratos").doc(cid).collection("mapeos").where("auto", "==", true).get();
    console.log(`   mapeos auto a borrar: ${mapeos.size} (onMapeoWrite limpia pendiente_devolucion en el pool)`);
    console.log(`   seriales liberados: ${esperados.map(e => e.serial).join(", ")}`);
    deshechas++;
    if (!EXECUTE) continue;

    // 1) Mapeos → el trigger revierte las fichas del pool.
    for (const m of mapeos.docs) await m.ref.delete();

    // 2) La orden.
    await db.collection("ordenes_de_servicio").doc(id).set({
      eliminado: true,
      fecha_eliminacion: admin.firestore.FieldValue.serverTimestamp(),
      os_logs: admin.firestore.FieldValue.arrayUnion({
        action: "ELIMINAR",
        by: "system:fix-adicion-devolucion-falsa",
        nota: "Orden creada por error: una Adición no devuelve el equipo del contrato original",
      }),
    }, { merge: true });

    // 3) Espejo del contrato (y de los orígenes, si los tuviera).
    const destinos = [cid, ...(orden.contrato?.contrato_origen_ids || [])];
    for (const destino of new Set(destinos)) {
      const ref = db.collection("contratos").doc(destino);
      const doc = await ref.get();
      if (!doc.exists) continue;
      const tiquetes = { ...(doc.data().devolucion_tiquetes || {}) };
      if (!(id in tiquetes)) continue;
      delete tiquetes[id];
      if (Object.keys(tiquetes).length) {
        const { pendientes, esperado, estado } = derivarEstadoDevolucion(tiquetes);
        await ref.set({
          devolucion_tiquetes: tiquetes, devolucion_pendientes: pendientes,
          devolucion_esperado: esperado, devolucion_estado: estado,
          devolucion_actualizado_at: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        const del = admin.firestore.FieldValue.delete();
        await ref.set({
          devolucion_tiquetes: del, devolucion_pendientes: del,
          devolucion_esperado: del, devolucion_estado: del,
          devolucion_actualizado_at: del,
        }, { merge: true });
      }
    }

    // 4) Marcas de "ya corrió el auto-registro": con la Adición fuera del
    //    predicado no volverá a dispararse, pero dejarlas mentiría en la ficha.
    await db.collection("contratos").doc(cid).set({
      transicion_auto_at: admin.firestore.FieldValue.delete(),
      transicion_auto_unidades: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    console.log(`   deshecha`);
  }

  console.log(`\n${EXECUTE ? "Deshechas" : "Se desharían"}: ${deshechas} · saltadas por tener check-in: ${saltadas}`);
  if (EXECUTE) console.log("Los triggers de mapeos tardan unos segundos en limpiar el pool — verificar después.");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
