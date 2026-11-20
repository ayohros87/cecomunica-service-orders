/**
 * libera-20-radios-copasecuva-2026081205.js
 *
 * Correo de Brenda (2026-11-20, "Solicitud de Liberación de Radios – OS
 * 2026081205"): la orden de PROGRAMACIÓN 2026081205 de COPASECUVA tiene 82
 * radios reservados desde el 12 de agosto para el contrato ALQ20260723-01, que
 * sigue aprobado y SIN FIRMA (dormido). Pide soltar 20 para poder asignarlos a
 * otros clientes.
 *
 * Decisión de Alberto (2026-11-20): el contrato SIGUE EN 82. No se toca el
 * documento (líneas, monto, firma): solo quedan 62 de 82 seriales registrados y
 * bodega asigna otros 20 cuando el cliente avance.
 *
 * Por qué hace falta script: quitar el radio de la orden lo devuelve a
 * "asignado al contrato" (no a bodega), y los seriales del contrato tienen
 * candado desde que quedaron asignados. Hay que sacarlo de los DOS lados, en
 * este orden:
 *   1. Fuera de contratos/{cid}/seriales (+ seriales_historial). onSerialWrite
 *      suelta la asignación; el radio sigue en_taller porque la orden lo tiene.
 *   2. Fuera de equipos[] de la orden. onOrdenWritePool lo saca del taller y,
 *      como ya no tiene contrato, cae en en_bodega con verificado:false.
 * Al revés quedaría "asignado" y onSerialWrite ya no lo vuelve a mirar: por eso
 * el paso 2 espera a que el pool confirme el paso 1.
 *
 * NO cambia `seriales_estado` (sigue 'asignados'): devolverlo a 'pendiente'
 * prendería el recordatorio semanal a bodega/activaciones pidiendo asignar 20
 * radios a un contrato dormido — justo lo contrario de lo que se pidió. El
 * faltante queda a la vista en el contador (62/82) y en el historial.
 * No manda correos. Idempotente: lo ya hecho se salta.
 *
 * USAGE (desde functions/):
 *   node scripts/libera-20-radios-copasecuva-2026081205.js          # dry-run
 *   node scripts/libera-20-radios-copasecuva-2026081205.js --write
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const { db } = require("../src/lib/admin");
const pool = require("../src/domain/equiposPool");

const WRITE = process.argv.includes("--write");
const ORDEN = "2026081205";
const CONTRATO_DOC = "1lFLvkupr4WL8GU6mdLB";
const CONTRATO_ID = "ALQ20260723-01";
const POR = "script:libera-20-radios-copasecuva-2026081205";
const NOTA = "Liberados a pedido de recepción (correo de Brenda, 2026-11-20) para asignarlos a otros clientes. "
  + "El contrato sigue en 82 equipos, sin firma: faltan 20 seriales por asignar cuando el cliente avance.";
const SERIALES = [
  "22610A4040", "22610A4041", "22610A4044", "22610A4106", "22610A4107",
  "22610A4108", "22610A4112", "22610A4113", "22610A4114", "22610A4115",
  "22610A4116", "22806A0222", "22806A0231", "22806A0237", "22806A0265",
  "22N22A0173", "22N22A0197", "22N22A0204", "22N22A0205", "22N22A0206",
];
const PEDIDOS = new Set(SERIALES.map((s) => pool.normSerial(s)));
const serialDe = (e) => String((e && (e.numero_de_serie || e.serial)) || "").trim();
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function fichas() {
  const out = [];
  for (const s of SERIALES) {
    const r = await pool.resolver(s, null, "PNC360S-R");
    out.push({ serial: s, ref: r.ref, f: r.data || null });
  }
  return out;
}
const resumen = (x) => !x.f ? "sin ficha"
  : `${x.f.estado} · orden=${x.f.orden_actual_id || "—"} · contrato=${x.f.asignacion?.contrato_id || "—"}`;

// Espera a que TODAS las fichas cumplan `ok`; devuelve las que no llegaron.
async function esperar(ok, etiqueta, intentos = 40) {
  let faltan = [];
  for (let i = 0; i < intentos; i++) {
    faltan = (await fichas()).filter((x) => !ok(x));
    if (!faltan.length) return [];
    process.stdout.write(`   … ${etiqueta}: faltan ${faltan.length}\r`);
    await espera(3000);
  }
  return faltan;
}

(async () => {
  const oRef = db.collection("ordenes_de_servicio").doc(ORDEN);
  const cRef = db.collection("contratos").doc(CONTRATO_DOC);
  const [oSnap, cSnap, serSnap] = await Promise.all([oRef.get(), cRef.get(), cRef.collection("seriales").get()]);
  if (!oSnap.exists || !cSnap.exists) throw new Error("No existe la orden o el contrato");
  const o = oSnap.data();
  const c = cSnap.data();
  if (c.contrato_id !== CONTRATO_ID) throw new Error(`El contrato no es ${CONTRATO_ID}: ${c.contrato_id}`);
  if (o.contrato?.contrato_doc_id !== CONTRATO_DOC) throw new Error("La orden no cuelga de ese contrato");
  if (o.eliminado === true || o.estado_reparacion !== "POR ASIGNAR" || o.tecnico_uid) {
    throw new Error(`La orden ya no está en POR ASIGNAR sin técnico (${o.estado_reparacion}): se revisa a mano`);
  }
  if (c.firmado === true || c.entrega_confirmada === true || c.estado !== "aprobado") {
    throw new Error(`El contrato cambió (estado ${c.estado}, firmado ${c.firmado}, entregado ${c.entrega_confirmada}): se revisa a mano`);
  }

  const filas = serSnap.docs.filter((d) => PEDIDOS.has(pool.normSerial(d.data()?.serial || "")));
  const enOrden = (o.equipos || []).filter((e) => PEDIDOS.has(pool.normSerial(serialDe(e))));
  const antes = await fichas();

  console.log(`Orden ${ORDEN} · ${o.estado_reparacion} · ${(o.equipos || []).length} radios — de los 20, siguen en la orden: ${enOrden.length}`);
  console.log(`Contrato ${CONTRATO_ID} · ${c.estado} · ${serSnap.size} seriales (pide ${c.total_equipos}) — de los 20, siguen en el contrato: ${filas.length}\n`);
  antes.forEach((x) => console.log(`   ${x.serial}  ${resumen(x)}`));

  // Solo se sigue si cada ficha está donde se espera: en el taller POR ESTA
  // orden, o ya suelta en bodega. Cualquier otra cosa (otra orden, otro
  // contrato, vendido…) no es de este saneo.
  const raros = antes.filter((x) => !x.f
    || (x.f.asignacion?.contrato_doc_id && x.f.asignacion.contrato_doc_id !== CONTRATO_DOC)
    || !((x.f.estado === pool.ESTADOS.EN_TALLER && x.f.orden_actual_id === ORDEN)
      || (x.f.estado === pool.ESTADOS.EN_BODEGA && !x.f.orden_actual_id)));
  if (raros.length) throw new Error(`Fichas en un estado que no espero: ${raros.map((x) => `${x.serial} (${resumen(x)})`).join(", ")}`);

  if (!filas.length && !enOrden.length) { console.log("\nYa estaba hecho: no queda nada que liberar."); process.exit(0); }
  if (!WRITE) {
    console.log(`\nDRY-RUN — con --write:\n   1. salen ${filas.length} filas de seriales del contrato (queda en ${serSnap.size - filas.length} de ${c.total_equipos}) + nota en el historial`);
    console.log(`   2. salen ${enOrden.length} radios de la orden (queda en ${(o.equipos || []).length - enOrden.length})`);
    console.log("   3. el pool los deja en bodega, sin contrato, por verificar");
    process.exit(0);
  }

  // ── 1. Fuera del contrato ────────────────────────────────────────────────
  if (filas.length) {
    const ahora = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    filas.forEach((d) => batch.delete(d.ref));
    batch.set(cRef.collection("seriales_historial").doc(), {
      at: ahora, por: null, por_email: POR, estado: "asignados", nota: NOTA,
      contrato_id: CONTRATO_ID, cliente_id: c.cliente_id || "", cliente_nombre: c.cliente_nombre || "",
      agregados: [],
      eliminados: filas.map((d) => ({ serial: d.data().serial, modelo: d.data().modelo || "" })),
    });
    await batch.commit();
    console.log(`\n1. ${filas.length} seriales fuera del contrato. Esperando a que el pool suelte la reserva…`);
  }
  const conReserva = await esperar((x) => !x.f?.asignacion?.contrato_doc_id, "reserva del contrato");
  if (conReserva.length) {
    throw new Error(`El pool no soltó la reserva de: ${conReserva.map((x) => x.serial).join(", ")}. NO se tocó la orden; vuelve a correr el script.`);
  }
  console.log("   reserva suelta en las 20 fichas.                    ");

  // ── 2. Fuera de la orden ─────────────────────────────────────────────────
  const quitados = await db.runTransaction(async (tx) => {
    const s = await tx.get(oRef);
    const d = s.data();
    if (d.estado_reparacion !== "POR ASIGNAR" || d.tecnico_uid) throw new Error("La orden cambió de estado mientras corría el script");
    const quedan = (d.equipos || []).filter((e) => !PEDIDOS.has(pool.normSerial(serialDe(e))));
    const n = (d.equipos || []).length - quedan.length;
    if (!n) return 0;
    tx.update(oRef, {
      equipos: quedan,
      os_logs: admin.firestore.FieldValue.arrayUnion({
        action: "LIBERAR_EQUIPOS", by: POR, at: admin.firestore.Timestamp.now(),
        nota: `${n} radios liberados a bodega a pedido de recepción (correo de Brenda, 2026-11-20). La orden queda en ${quedan.length}; el contrato sigue en 82.`,
      }),
    });
    return n;
  });
  console.log(`2. ${quitados} radios fuera de la orden. Esperando a que el pool los lleve a bodega…`);
  const noLlegaron = await esperar((x) => x.f && x.f.estado === pool.ESTADOS.EN_BODEGA && !x.f.orden_actual_id
    && !x.f.asignacion?.contrato_doc_id, "a bodega");
  console.log("                                                       ");

  // ── Resultado ────────────────────────────────────────────────────────────
  const [o2, c2, ser2] = await Promise.all([oRef.get(), cRef.get(), cRef.collection("seriales").get()]);
  (await fichas()).forEach((x) => console.log(`   ${x.serial}  ${resumen(x)}${x.f?.verificado === false ? " · por verificar" : ""}`));
  console.log(`\nOrden ${ORDEN}: ${(o2.data().equipos || []).length} radios · Contrato ${CONTRATO_ID}: ${ser2.size} seriales (seriales_count ${c2.data().seriales_count}) de ${c2.data().total_equipos} · seriales_estado ${c2.data().seriales_estado}`);
  if (noLlegaron.length) {
    console.log(`\n⚠ NO quedaron en bodega: ${noLlegaron.map((x) => `${x.serial} (${resumen(x)})`).join(", ")}`);
    process.exit(1);
  }
  console.log("\n✔ Los 20 quedaron en bodega, sin contrato y sin orden.");
  process.exit(0);
})().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
