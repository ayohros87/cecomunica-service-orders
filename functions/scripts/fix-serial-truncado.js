/**
 * fix-serial-truncado.js — Corrige un serial mal digitado en la orden que lo
 * introdujo y arrastra la ficha del pool que nació de ese error.
 *
 * Un dígito de menos al teclear no crea un problema de un solo lado: la fila de
 * la orden queda con el serial malo, la siembra le abrió ficha propia y el radio
 * real aparece como "sin ficha". Corregir solo el pool deja la orden lista para
 * volver a parirla; corregir solo la orden deja el fantasma en_cliente sumando
 * stock que no existe. Por eso este script hace las dos cosas en la misma pasada.
 *
 * Por cada par viejo:nuevo
 *   · reescribe numero_de_serie en las filas de la orden (y `serial` si la fila
 *     lo trae, que es la pareja que sincroniza updateEquipmentField);
 *   · si el serial correcto ya tiene ficha, le copia el kardex del fantasma
 *     (marcado fusionado_de) y borra el fantasma;
 *   · si no la tiene, renombra: crea la ficha correcta con los mismos datos,
 *     se lleva el kardex y borra la vieja — el doc ID del pool ES el serial, no
 *     se puede editar en sitio.
 * En ambos casos deja un movimiento que explica la corrección.
 *
 * NO decide estado ni propiedad: eso lo fija después quien corresponda
 * (ingresa-bodega-lista.js si el radio se contó físicamente).
 *
 * USAGE (desde functions/):
 *   node scripts/fix-serial-truncado.js <ordenId> <viejo:nuevo>[,<viejo:nuevo>...] [--write]
 * Idempotente: si el viejo ya no existe en ningún lado, no hace nada.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const ORDEN_ID = process.argv[2];
const PARES = (process.argv[3] || "").split(",").map((p) => {
  const [viejo, nuevo] = p.split(":").map((s) => (s || "").trim());
  return { viejo, nuevo, vNorm: pool.normSerial(viejo), nNorm: pool.normSerial(nuevo) };
}).filter((p) => p.viejo && p.nuevo);
const dryRun = !process.argv.includes("--write");
const EMAIL = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:fix-serial-truncado";

const mov = (extra) => ({
  at: admin.firestore.FieldValue.serverTimestamp(),
  por: "system", por_email: EMAIL, ref: null, ...extra,
});

(async () => {
  if (!ORDEN_ID || !PARES.length) throw new Error("USAGE: <ordenId> <viejo:nuevo>[,...] [--write]");
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const ordenRef = db.collection("ordenes_de_servicio").doc(ORDEN_ID);
  const ordenSnap = await ordenRef.get();
  if (!ordenSnap.exists) throw new Error(`La orden ${ORDEN_ID} no existe`);
  const equipos = Array.isArray(ordenSnap.data().equipos) ? ordenSnap.data().equipos : [];

  let filasTocadas = 0;
  const equiposNuevos = equipos.map((e) => {
    const par = PARES.find((p) => pool.normSerial(e.numero_de_serie || "") === p.vNorm);
    if (!par) return e;
    filasTocadas++;
    console.log(`orden ${ORDEN_ID}: fila "${e.numero_de_serie}" → "${par.nuevo}"`);
    return {
      ...e, numero_de_serie: par.nuevo,
      ...(e.serial !== undefined ? { serial: par.nuevo } : {}),
    };
  });

  for (const par of PARES) {
    console.log(`\n### ${par.viejo} → ${par.nuevo}`);
    const viejaSnap = await db.collection("equipos_pool").where("serial_norm", "==", par.vNorm).get();
    if (viejaSnap.empty) { console.log("  (sin ficha fantasma — nada que arrastrar)"); continue; }

    for (const vieja of viejaSnap.docs) {
      const v = vieja.data();
      const movs = await vieja.ref.collection("movimientos").orderBy("at", "asc").get();
      const buenaSnap = await db.collection("equipos_pool").where("serial_norm", "==", par.nNorm).get();
      const destinoRef = buenaSnap.empty
        ? db.collection("equipos_pool").doc(par.nNorm)
        : buenaSnap.docs[0].ref;
      const renombrando = buenaSnap.empty;
      console.log(`  ficha ${vieja.id} (${v.estado}, ${v.propiedad}) → ` +
        `${renombrando ? `RENOMBRAR a ${destinoRef.id}` : `FUSIONAR en ${destinoRef.id}`}` +
        ` · ${movs.size} movimiento(s) de kardex`);

      if (dryRun) continue;
      const batch = db.batch();
      if (renombrando) {
        batch.set(destinoRef, {
          ...v, serial: par.nuevo, serial_norm: par.nNorm,
          updated_at: admin.firestore.FieldValue.serverTimestamp(), updated_by_email: EMAIL,
        });
      }
      movs.forEach((m) => batch.set(destinoRef.collection("movimientos").doc(),
        { ...m.data(), fusionado_de: vieja.id }));
      batch.set(destinoRef.collection("movimientos").doc(), mov({
        tipo: "correccion_serial", de_estado: v.estado || null, a_estado: v.estado || null,
        notas: `Serial mal digitado en la orden ${ORDEN_ID}: "${par.viejo}" era "${par.nuevo}".` +
          ` Ficha ${renombrando ? "renombrada" : `fusionada en ${destinoRef.id}`}.`,
      }));
      batch.delete(vieja.ref);
      await batch.commit();
      // Las subcolecciones no se borran con el doc: el kardex ya viajó, este es el rastro viejo.
      const restos = await vieja.ref.collection("movimientos").get();
      if (restos.size) {
        const b2 = db.batch();
        restos.forEach((m) => b2.delete(m.ref));
        await b2.commit();
      }
    }
  }

  if (filasTocadas && !dryRun) {
    await ordenRef.set({ equipos: equiposNuevos }, { merge: true });
  }
  console.log(`\n=== filas de la orden corregidas: ${filasTocadas} ===`);
  if (dryRun) console.log("*** DRY-RUN — volver a correr con --write para aplicar ***");
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
