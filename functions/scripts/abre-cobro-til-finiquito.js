/**
 * abre-cobro-til-finiquito.js — Rescata del olvido los equipos que TIL PANAMA
 * no devolvió en su finiquito.
 *
 * El caso que originó el módulo de equipos no devueltos
 * (docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md):
 *   · La devolución 2026081102 dice, en `observaciones`:
 *       "El cliente debe devolver 29 equipos. El Mensajero trajo los 25
 *        equipos a oficina de los 29 en el finiquito."
 *   · Entre 2026081102 (14) y 2026081104 (11) se registraron los 25 que
 *     llegaron. Cuadra: 25 recibidos = 25 registrados.
 *   · Los 4 que faltan NO existen como registro en ninguna parte. Viven en esa
 *     frase y en dos contadores (`cierre_pendientes: 1` por orden, que además
 *     no suman 4 porque los totales declarados —15 y 12— tampoco cuadran con
 *     los 25 que llegaron ni con los 29 del finiquito).
 *
 * Este script abre UN renglón cobrable por esos 4 equipos. Va contra el
 * finiquito (29 − 25 = 4), que es la verdad contractual, no contra la suma de
 * los totales declarados a mano al abrir cada tiquete.
 *
 * El modelo NX-420-R no tiene `precio_venta` en el catálogo, así que el renglón
 * nace SIN monto y marcado `sin_referencia`: aparecerá en la bandeja y en el
 * correo diario como "sin precio puesto" hasta que alguien decida cuánto se
 * cobra. Eso es correcto — el precio es una decisión de negocio, no del script.
 *
 * NO toca el pool: esos 4 radios nunca tuvieron ficha (contrato de papel, nadie
 * llegó a registrarlos). El renglón ES su único registro.
 *
 * USAGE (desde functions/):
 *   node scripts/abre-cobro-til-finiquito.js [--write] [--email=quien@corre.esto]
 * Idempotente: si el renglón ya existe, no abre otro.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const cobros = require("../src/lib/cobrosEquipos");

const ORDEN = "2026081102";          // devolución donde quedó la nota del finiquito
const DEBIA = 29;                    // equipos del finiquito
const LLEGARON = 25;                 // los que trajo el mensajero (14 + 11)
const MODELO_ID = "68N7zR5APzO3xIaJCZCU";
const MODELO_LABEL = "NX-420-R";

const dryRun = !process.argv.includes("--write");
const EMAIL = (process.argv.find((a) => a.startsWith("--email=")) || "").split("=")[1]
  || "script:abre-cobro-til-finiquito";

(async () => {
  console.log(dryRun ? "*** DRY-RUN — no se escribe nada ***\n" : "*** ESCRIBIENDO ***\n");

  const snap = await db.collection("ordenes_de_servicio").doc(ORDEN).get();
  if (!snap.exists) throw new Error(`La orden ${ORDEN} no existe`);
  const o = snap.data();

  // Verificación en vivo: los 25 que dice la nota tienen que ser los que están
  // registrados. Si no cuadra, el faltante no son 4 y hay que mirarlo a mano.
  let registrados = 0;
  for (const id of [ORDEN, "2026081104"]) {
    const d = await db.collection("ordenes_de_servicio").doc(id).get();
    const esp = ((d.data() || {}).devolucion || {}).esperados || [];
    const n = esp.filter((e) => e.resolucion === "recibido").length;
    console.log(`  ${id}: ${n} recibido(s)`);
    registrados += n;
  }
  console.log(`  registrados en total: ${registrados} (la nota dice que llegaron ${LLEGARON})`);
  if (registrados !== LLEGARON) {
    throw new Error(`No cuadra: hay ${registrados} registrados y la nota dice ${LLEGARON}. ` +
      "Revisar a mano antes de abrir el cobro.");
  }

  const faltan = DEBIA - LLEGARON;
  console.log(`\n  finiquito ${DEBIA} − entregados ${LLEGARON} = ${faltan} equipo(s) por cobrar`);

  const ya = await db.collection(cobros.COL)
    .where("orden_devolucion_id", "==", ORDEN)
    .get();
  const abierto = ya.docs.find((d) => !d.data().serial_norm);
  if (abierto) {
    console.log(`  ya existe el renglón ${abierto.id} (${abierto.data().etapa}) — nada que hacer`);
    process.exit(0);
  }

  const precio = await cobros.precioCatalogo(MODELO_ID);
  console.log(`  precio de catálogo de ${MODELO_LABEL}: ${precio === null ? "SIN PRECIO (queda por definir)" : `$${precio}`}`);
  console.log(`  cliente: ${o.cliente_nombre} (${o.cliente_id || "sin id"})`);

  if (dryRun) {
    console.log("\n*** DRY-RUN — volver a correr con --write para aplicar ***");
    process.exit(0);
  }

  const id = await cobros.abrirCobro({
    cliente_id: o.cliente_id || "",
    cliente_nombre: o.cliente_nombre || "TIL PANAMA",
    orden_devolucion_id: ORDEN,
    modelo_id: MODELO_ID,
    modelo_label: MODELO_LABEL,
    cantidad: faltan,
    motivo_codigo: "perdido",
    motivo_detalle:
      `Finiquito: el cliente debía devolver ${DEBIA} equipos y el mensajero trajo ${LLEGARON} ` +
      `(devoluciones ${ORDEN} y 2026081104). Faltan ${faltan}. Sin seriales: el contrato era ` +
      "de papel y estas unidades nunca se registraron.",
    por_email: EMAIL,
  });

  console.log(`\n=== renglón abierto: ${id} — ${faltan} × ${MODELO_LABEL} ===`);
  console.log("Ponle precio desde Almacén · No devueltos antes de facturarlo.");
  process.exit(0);
})().catch((e) => { console.error(e.message || e); process.exit(1); });
