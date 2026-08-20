/**
 * fix-serial-til-b8c10697.js — Un radio NX-420-R de la devolución de TIL PANAMA
 * quedó con el serial mal transcrito en DOS sitios distintos, y por eso nunca
 * llegó a bodega.
 *
 * Qué pasó (verificado 2026-08-20 contra producción):
 *   · La DEVOLUCIÓN 2026081102 registró el radio como "B8C10597" y con ese
 *     nombre le abrió ficha en el pool (devuelto_revision, 2026-08-11).
 *   · La ENTRADA 2026081103, que nació de esa devolución, quedó con la fila
 *     escrita como "B8C1697" — un serial que no existe en ninguna otra parte
 *     del sistema.
 *   · El serial real es "B8C10697".
 *   · Al cerrar la ENTRADA (2026-08-19), onOrdenWritePool recorrió los equipos
 *     de la orden y trató de transicionar "B8C1697". No hay ficha con ese
 *     nombre, así que la transición no encontró a quién mover: sus 13 hermanos
 *     de tanda pasaron a en_bodega y este se quedó en devuelto_revision —
 *     invisible para el inventario disponible.
 *
 * Este script cierra las tres puntas en una sola pasada:
 *   1. renombra la ficha del pool B8C10597 → B8C10697 (el doc ID ES el serial,
 *      no se edita en sitio) arrastrando el kardex completo;
 *   2. le aplica el cierre_entrada que se perdió: devuelto_revision → en_bodega
 *      con la misma forma exacta que dejó el trigger en los 13 hermanos
 *      (verificado:true, orden_actual_id:null, asignacion:null);
 *   3. corrige el serial en la fila de la ENTRADA 2026081103 y en el esperado
 *      de la DEVOLUCIÓN 2026081102.
 *
 * Escribir la orden vuelve a disparar onOrdenWritePool, pero es inofensivo: el
 * bloque de cierre exige que el estado ACABE de cambiar a CERRADA (ENTRADA) y
 * aquí ya estaba cerrada, así que cae en la rama de inspección, que solo suelta
 * orden_actual_id de la ficha.
 *
 * USAGE (desde functions/):
 *   node scripts/fix-serial-til-b8c10697.js [--write] [--email=quien@corre.esto]
 * Idempotente: si los seriales viejos ya no están, no hace nada.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ORDEN_ENTRADA = "2026081103";
const ORDEN_DEVOLUCION = "2026081102";
const EN_ENTRADA = "B8C1697";   // como quedó escrito en la fila de la ENTRADA
const EN_POOL = "B8C10597";     // como lo registró el check-in de la DEVOLUCIÓN
const CORRECTO = "B8C10697";

const nEntrada = pool.normSerial(EN_ENTRADA);
const nPool = pool.normSerial(EN_POOL);
const nOk = pool.normSerial(CORRECTO);

const dryRun = !process.argv.includes("--write");
const EMAIL = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:fix-serial-til-b8c10697";

const mov = (extra) => ({
  at: admin.firestore.FieldValue.serverTimestamp(),
  por: "system", por_email: EMAIL, ref: null, ...extra,
});

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  // ── 1 + 2. Pool: renombrar y aterrizar en bodega ─────────────────────────
  const viejaRef = db.collection("equipos_pool").doc(nPool);
  const buenaRef = db.collection("equipos_pool").doc(nOk);
  const [vieja, buena] = await Promise.all([viejaRef.get(), buenaRef.get()]);

  if (buena.exists) {
    throw new Error(`equipos_pool/${nOk} YA existe (${buena.data().estado}) — ` +
      "esto ya no es un renombrado, hay que fusionar a mano.");
  }
  if (!vieja.exists) {
    console.log(`  pool: equipos_pool/${nPool} no existe — nada que renombrar (¿ya se corrió?)`);
  } else {
    const v = vieja.data();
    const movs = await viejaRef.collection("movimientos").orderBy("at", "asc").get();
    console.log(`  pool: ${nPool} (${v.estado}, ${v.propiedad}, ${v.modelo_label}) ` +
      `→ RENOMBRAR a ${nOk} · ${movs.size} movimiento(s) de kardex`);
    console.log(`        estado ${v.estado} → ${pool.ESTADOS.EN_BODEGA} (cierre_entrada perdido)`);

    if (!dryRun) {
      const batch = db.batch();
      batch.set(buenaRef, {
        ...v,
        serial: CORRECTO,
        serial_norm: nOk,
        // El cierre de la ENTRADA que nunca lo alcanzó, con la forma que el
        // trigger dejó en los 13 hermanos de la misma tanda.
        estado: pool.ESTADOS.EN_BODEGA,
        verificado: true,
        orden_actual_id: null,
        asignacion: null,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by_email: EMAIL,
      });
      movs.forEach((m) => batch.set(buenaRef.collection("movimientos").doc(),
        { ...m.data(), fusionado_de: nPool }));
      batch.set(buenaRef.collection("movimientos").doc(), mov({
        tipo: "correccion_serial",
        de_estado: v.estado || null, a_estado: v.estado || null,
        notas: `Serial mal transcrito: la DEVOLUCIÓN ${ORDEN_DEVOLUCION} lo registró como ` +
          `"${EN_POOL}" y la ENTRADA ${ORDEN_ENTRADA} como "${EN_ENTRADA}". ` +
          `El serial real es "${CORRECTO}". Ficha renombrada de ${nPool} a ${nOk}.`,
      }));
      batch.set(buenaRef.collection("movimientos").doc(), mov({
        tipo: "cierre_entrada",
        de_estado: v.estado || null, a_estado: pool.ESTADOS.EN_BODEGA,
        ref: { tipo: "orden", id: ORDEN_ENTRADA, label: ORDEN_ENTRADA },
        notas: "Entrada cerrada: el equipo queda disponible en bodega. " +
          `Se aplica ahora porque el 2026-08-19 el trigger buscó "${EN_ENTRADA}", ` +
          "que no tenía ficha, y esta unidad se quedó en cuarentena.",
      }));
      batch.delete(viejaRef);
      await batch.commit();

      // Borrar el doc no borra su subcolección: el kardex ya viajó, esto es el rastro.
      const restos = await viejaRef.collection("movimientos").get();
      if (restos.size) {
        const b2 = db.batch();
        restos.forEach((m) => b2.delete(m.ref));
        await b2.commit();
      }
    }
  }

  // ── 3a. Fila de la ENTRADA ───────────────────────────────────────────────
  const entRef = db.collection("ordenes_de_servicio").doc(ORDEN_ENTRADA);
  const ent = await entRef.get();
  if (!ent.exists) throw new Error(`La orden ${ORDEN_ENTRADA} no existe`);
  const equipos = Array.isArray(ent.data().equipos) ? ent.data().equipos : [];
  let filasTocadas = 0;
  const equiposNuevos = equipos.map((e) => {
    const s = pool.normSerial(e.numero_de_serie || e.serial || "");
    if (s !== nEntrada && s !== nPool) return e;
    filasTocadas++;
    console.log(`  orden ${ORDEN_ENTRADA}: fila "${e.numero_de_serie}" → "${CORRECTO}"`);
    return {
      ...e,
      numero_de_serie: CORRECTO,
      ...(e.serial !== undefined ? { serial: CORRECTO } : {}),
    };
  });

  // ── 3b. Esperado de la DEVOLUCIÓN ────────────────────────────────────────
  const devRef = db.collection("ordenes_de_servicio").doc(ORDEN_DEVOLUCION);
  const dev = await devRef.get();
  if (!dev.exists) throw new Error(`La orden ${ORDEN_DEVOLUCION} no existe`);
  const esperados = Array.isArray((dev.data().devolucion || {}).esperados)
    ? dev.data().devolucion.esperados : [];
  let esperadosTocados = 0;
  const esperadosNuevos = esperados.map((e) => {
    const s = pool.normSerial(e.serial || "");
    if (s !== nPool && s !== nEntrada) return e;
    esperadosTocados++;
    console.log(`  orden ${ORDEN_DEVOLUCION}: esperado "${e.serial}" → "${CORRECTO}"`);
    return { ...e, serial: CORRECTO };
  });

  if (!dryRun) {
    const log = {
      action: "CORREGIR_SERIAL",
      by: EMAIL,
      detalle: `${EN_ENTRADA} / ${EN_POOL} → ${CORRECTO}`,
    };
    if (filasTocadas) {
      await entRef.update({
        equipos: equiposNuevos,
        os_logs: admin.firestore.FieldValue.arrayUnion(log),
      });
    }
    if (esperadosTocados) {
      // Ruta anidada por update(): un set(merge) con `devolucion` completo
      // pisaría lo que no viene en este objeto.
      await devRef.update({
        "devolucion.esperados": esperadosNuevos,
        os_logs: admin.firestore.FieldValue.arrayUnion(log),
      });
    }
  }

  console.log(`\n=== filas de orden corregidas: ${filasTocadas} · esperados corregidos: ${esperadosTocados} ===`);
  if (dryRun) console.log("*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
