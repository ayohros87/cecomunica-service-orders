/**
 * fetrateda-renovacion-con-reemplazo-2026-10-22.js — pasa SERV20261020-01
 * (FETRATEDA) de "renovación sin equipo" a renovación CON reemplazo de los 12.
 *
 * CASO (Alberto, 2026-10-22): Zuleika llenó la renovación con los 12
 * PNC360S-R en "continúa", pero se reemplazan TODOS por 12 PNC360S-R (mismo
 * modelo y precio de la línea). Se aprobó así el 20-oct: no se pidieron
 * seriales a bodega, el contrato quedó "asignados" con los 12 viejos y
 * recepción abrió la PROGRAMACIÓN 2026102101 con esos 12 — que siguen con el
 * cliente (no los han traído). El cliente NO ha firmado: se corrige, no se anula.
 *
 * Qué hace, en este orden (el orden importa para que los triggers no muevan
 * los radios viejos a bodega):
 *   1. Los 12 viejos vuelven a CUSTODIA: en_cliente, FETRATEDA, sin contrato,
 *      sin orden (estaban en_taller por la 2026102101).
 *   2. La orden 2026102101 (se abrió para adelantar los NUEVOS, pero jaló los
 *      viejos) se vacía y queda POR ASIGNAR; onOrdenWritePool no los toca.
 *   3. El plan: los 12 → "reemplaza" (mismo modelo); modalidad con equipo; la
 *      señal de seriales vuelve a "pendiente" y se borra el sello del PDF a
 *      activaciones (el que salió decía "sin equipo"). onPlanRenovacion quita
 *      las 12 filas del contrato.
 *   4. Solicitud de seriales a bodega: 12 PNC360S-R.
 *
 * Lo que queda al sistema: bodega asigna en Almacén · Asignar → activaciones
 * recibe el contrato con los seriales nuevos → recepción jala los nuevos en la PROGRAMACIÓN 2026102101
 * → al confirmarse la entrega, onEntregaTransicion crea la orden de DEVOLUCIÓN
 * ligada al contrato con los 12 viejos, pareados con los nuevos.
 *
 * USAGE (desde functions/):
 *   node scripts/fetrateda-renovacion-con-reemplazo-2026-10-22.js            # informe
 *   node scripts/fetrateda-renovacion-con-reemplazo-2026-10-22.js --aplicar
 */
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp({ projectId: "cecomunica-service-orders" });
const { APP_BASE_URL, inventarioEmailTo } = require("../src/lib/inventario");

const db = admin.firestore();
const FV = admin.firestore.FieldValue;
const APLICAR = process.argv.includes("--aplicar");
const CID = "OgSsD0qYF4kIhaz5Liz3";
const CONTRATO = "SERV20261020-01";
const ORDEN = "2026102101";
const NOTA = "Renovación con reemplazo de los 12 radios (mismo modelo y precio); se llenó como sin equipo (Alberto, 2026-10-22).";

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const cRef = db.collection("contratos").doc(CID);
  const c = (await cRef.get()).data();
  if (!c || c.contrato_id !== CONTRATO) return console.log("Contrato no encontrado");
  const unidades = c.transicion_plan?.unidades || [];
  const seriales = unidades.map((u) => u.pool_id || u.serial_norm || u.serial);
  console.log(`${CONTRATO}: ${c.estado} · ${c.renovacion_modalidad} · seriales ${c.seriales_estado} · plan ${unidades.map((u) => u.destino).join(",")}`);
  if (c.firma_cliente_at || c.firmado_at || c.firma_solicitud_estado === "firmado") return console.log("El cliente ya firmó: no se toca.");
  if (unidades.length !== 12 || unidades.some((u) => u.destino !== "continua")) {
    return console.log("El plan no está como lo dejó la venta (12 'continúa'): no se toca.");
  }

  // 1. Radios viejos
  const fichas = [];
  for (const s of seriales) {
    const ref = db.collection("equipos_pool").doc(s);
    const u = (await ref.get()).data();
    console.log(`  ${s}: ${u?.estado} · ${u?.asignacion?.contrato_id || "—"} · orden ${u?.orden_actual_id || "—"} · pend.dev ${!!u?.pendiente_devolucion}`);
    fichas.push({ ref, u });
  }
  const malos = fichas.filter(({ u }) => !u || u.asignacion?.cliente_id !== c.cliente_id || !["en_taller", "en_cliente"].includes(u.estado));
  if (malos.length) return console.log(`${malos.length} ficha(s) no están como se esperaba: no se toca.`);

  const o = (await db.collection("ordenes_de_servicio").doc(ORDEN).get()).data();
  console.log(`Orden ${ORDEN}: ${o?.tipo_de_servicio} · ${o?.estado_reparacion} · ${(o?.equipos || []).length} equipos · técnico ${o?.tecnico_asignado || "—"}`);
  if (!o || o.estado_reparacion !== "POR ASIGNAR") return console.log("La orden ya no está POR ASIGNAR: no se toca.");

  if (!APLICAR) return console.log("\nSimulación. Corre con --aplicar.");

  for (const { ref, u } of fichas) {
    await ref.set({
      estado: "en_cliente",
      asignacion: { contrato_doc_id: null, contrato_id: "", cliente_id: c.cliente_id, cliente_nombre: c.cliente_nombre },
      orden_actual_id: null,
      updated_at: FV.serverTimestamp(),
    }, { merge: true });
    await ref.collection("movimientos").add({
      at: FV.serverTimestamp(), por: "system", por_email: null, tipo: "correccion_reversion",
      de_estado: u.estado, a_estado: "en_cliente",
      ref: { tipo: "contrato", id: CID, label: CONTRATO },
      notas: `Sigue con el cliente hasta que se le entregue su reemplazo — ${NOTA}`,
    });
  }
  console.log("1. 12 radios en custodia del cliente");

  // 2. La orden se abrió para adelantar la programación de los NUEVOS, pero
  //    jaló los seriales viejos del contrato: se vacía y queda POR ASIGNAR
  //    para que recepción jale los nuevos cuando bodega los asigne.
  await db.collection("ordenes_de_servicio").doc(ORDEN).update({
    equipos: [],
    serials: [],
    equipos_count: 0,
    observaciones: `${CONTRATO}: Renovación con reemplazo — programar los 12 PNC360S-R NUEVOS (jalar del contrato cuando bodega los asigne).`,
    os_logs: FV.arrayUnion({ action: "EDITAR", by: "script", at: admin.firestore.Timestamp.now(),
      nota: `Se quitaron los 12 seriales viejos (siguen con el cliente). ${NOTA}` }),
  });
  console.log(`2. Orden ${ORDEN}: sin los 12 viejos, POR ASIGNAR`);

  // 3. Plan + señal de seriales
  const plan = {
    ...c.transicion_plan,
    unidades: unidades.map((u) => ({ ...u, destino: "reemplaza" })),
    por_modelo: [{ modelo_id: "x7hlVuYhyf22JhzR4hqz", modelo: "HYTERA PNC360S-R", continuan: 0, devuelven: 0, reemplazan: 12, no_tienen: 0, total: 12 }],
    corregido_nota: NOTA,
  };
  await cRef.collection("seriales_estado").doc("current").set({
    estado: "pendiente", omisiones: [], por: "script", at: FV.serverTimestamp(),
  });
  await cRef.update({
    transicion_plan: plan,
    renovacion_sin_equipo: false,
    renovacion_modalidad: "Renovación con equipo",
    seriales_estado: "pendiente",
    seriales_asignados_at: FV.delete(),
    seriales_asignados_por: FV.delete(),
    seriales_pdf_enviado_at: FV.delete(),
    transicion_plan_actualizado_at: FV.serverTimestamp(),
    transicion_plan_actualizado_por_uid: "script",
    fecha_modificacion: new Date(),
  });
  console.log("3. Plan → 12 'reemplaza'; seriales pendientes");

  for (let i = 0; i < 20; i++) {
    await esperar(3000);
    const n = (await cRef.collection("seriales").get()).size;
    const pa = (await cRef.get()).data().plan_aplicado;
    if (n === 0 && pa?.motivo === "correccion") { console.log(`   filas del contrato: 0 · plan_aplicado quitadas ${pa.quitadas}`); break; }
    if (i === 19) console.log(`   OJO: quedan ${n} filas — revisar onPlanRenovacion`);
  }

  // 4. Bodega
  const to = await inventarioEmailTo();
  const cc = (await db.collection("usuarios").doc(c.creado_por_uid).get()).data()?.email || null;
  await db.collection("mail_queue").add({
    to, ...(cc ? { cc } : {}),
    subject: `Solicitud de seriales: ${CONTRATO} – ${c.cliente_nombre}`,
    preheader: `Asigna los seriales del contrato ${CONTRATO}`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Solicitud de seriales</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">Asigna <b>12 HYTERA PNC360S-R</b> al contrato
        <b>${CONTRATO}</b> de <b>${c.cliente_nombre}</b>.</p>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">La renovación se aprobó como "sin equipo" por error:
        en realidad se le reemplazan los 12 radios. Los viejos siguen con el cliente y se recogen después de entregar los nuevos.
        La orden de programación 2026102101 sigue abierta para los radios nuevos.</p>`,
    ctaUrl: `${APP_BASE_URL}/almacen/index.html?tab=asignar&contrato=${encodeURIComponent(CID)}`,
    ctaLabel: "Asignar seriales",
    meta: { source: "script:fetrateda-renovacion-con-reemplazo", contrato_id: CONTRATO },
    createdAt: FV.serverTimestamp(),
  });
  console.log(`4. Solicitud a bodega encolada → ${to}${cc ? ` (cc ${cc})` : ""}`);
})();
