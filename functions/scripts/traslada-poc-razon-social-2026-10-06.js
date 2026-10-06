/**
 * traslada-poc-razon-social-2026-10-06.js — pasa las fichas de POC de dos
 * cuentas a su razón social actual.
 *
 *   MORENO SECURITY GROUP      → ASESORIA EN PROTECCION, S.A.
 *     El cliente pidió facturar a la nueva razón social el 2026-06-02 y ya se
 *     factura así. La ficha de cliente existía desde el 2026-07-08 (la abrió la
 *     ENTRADA 2026070806 del 23914A0966, un radio de la serie de Moreno) como
 *     "ASESORIA EN PROTECTION", sin RUC y sin un solo radio en POC.
 *
 *   SECURITY MANAGEMENT CORP   → CORPORACION DE VIGILANCIA Y PROTECCION, S.A.
 *     El cambio es de 2023 (notas de crédito 1049/1050 sobre las facturas
 *     1814/1815). Los 32 radios del import POC de 2025-07 quedaron con el
 *     nombre viejo y SIN cliente_id; la ficha de CVP ya existe con RUC y hasta
 *     tiene la OS 2026042917 (REEMPLAZO) con el 26123A0605, que es el COBRA 27
 *     de esta misma cuenta.
 *
 * Es un cambio de nombre de la cuenta, no un re-registro: mismo radio, mismo
 * Unit ID, mismo SIM. La ficha se actualiza en sitio (a diferencia del batch,
 * que cierra la vieja y crea otra) y deja su `poc_logs` con el antes/después.
 * En el pool solo se cambia la custodia que nombraba a la cuenta vieja.
 *
 * NO se mueven las fichas de Moreno cuyo radio el pool tiene en bodega o con
 * OTRO cliente: esas no son "radios activos" de la cuenta y moverlas solo
 * pasaría el desorden al cliente nuevo. Se listan para confirmarlas.
 *
 * El historial (órdenes, facturas) se queda con el nombre que tenía: es
 * historia. MORENO SECURITY GROUP ya estaba `activo: false`.
 *
 * USAGE (desde functions/):
 *   node scripts/traslada-poc-razon-social-2026-10-06.js            # simula
 *   node scripts/traslada-poc-razon-social-2026-10-06.js --aplicar
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const FV = admin.firestore.FieldValue;

const APLICAR = process.argv.includes("--aplicar");
const USUARIO = "script:traslada-poc-razon-social-2026-10-06";
const normSerial = (s) => (s ?? "").toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, "");

const TRASLADOS = [
  {
    viejo: { id: "WqwErE7XQIHwazkuDHXN", nombre: "MORENO SECURITY GROUP" },
    nuevo: { id: "QZYArwM26mQ7WiiFq7QS", nombre: "ASESORIA EN PROTECCION, S.A." },
    // La ficha nueva no tenía nada: hereda lo OPERATIVO (servidor, grupos,
    // vendedor). Dirección, correo y RUC van al contrato y salen de los
    // documentos de la nueva razón social, no de la vieja.
    heredarDelViejo: ["ip", "poc_grupos", "vendedor_asignado", "vendedor_email"],
  },
  {
    viejo: { id: null, nombre: "SECURITY MANAGEMENT CORP" },
    nuevo: { id: "Ehr8EAnUKx1zIA4uc4GZ", nombre: "CORPORACION DE VIGILANCIA Y PROTECCION, S.A." },
    heredarDelViejo: [],
    ipSiFalta: "main.cecomunica.net",
    gruposSiFalta: ["SMC"],
  },
];

async function fichasVivas(viejo) {
  const q = viejo.id
    ? db.collection("poc_devices").where("cliente_id", "==", viejo.id)
    : db.collection("poc_devices").where("cliente", "==", viejo.nombre);
  return (await q.get()).docs.filter((d) => d.data().deleted !== true);
}

// La custodia del pool nombra a la cuenta vieja (por id o, si no hay id, por nombre).
const custodiaDelViejo = (a, viejo) =>
  !!a && ((viejo.id && a.cliente_id === viejo.id) ||
    (!a.cliente_id && (a.cliente_nombre || "").trim().toUpperCase() === viejo.nombre));

(async () => {
  const pendientes = [];
  for (const t of TRASLADOS) {
    const { viejo, nuevo } = t;
    console.log(`\n=== ${viejo.nombre} → ${nuevo.nombre}`);
    const fichas = await fichasVivas(viejo);
    const pool = fichas.length ? await db.getAll(...fichas.map((f) => db.doc(`equipos_pool/${normSerial(f.data().serial) || "_"}`))) : [];

    const mover = [], dejar = [];
    fichas.forEach((f, i) => {
      const p = pool[i].exists ? pool[i].data() : null;
      // Sin ficha de pool (la consola) o con la custodia de esta cuenta → se mueve.
      const ok = !p || (["por_clasificar", "en_cliente"].includes(p.estado) &&
        (custodiaDelViejo(p.asignacion, viejo) || !p.asignacion || !p.asignacion.cliente_nombre));
      (ok ? mover : dejar).push({ f, p, poolRef: pool[i].ref });
    });

    console.log(`fichas vivas ${fichas.length} · se mueven ${mover.length} · quedan para confirmar ${dejar.length}`);
    dejar.forEach(({ f, p }) => {
      const x = f.data();
      const donde = !p ? "sin pool" : `${p.estado}${p.asignacion?.cliente_nombre ? " con " + p.asignacion.cliente_nombre : ""}`;
      console.log(`  QUEDA  ${x.serial}  ${x.radio_name}  unit ${x.unit_id}  — pool: ${donde}`);
      pendientes.push({ cuenta: viejo.nombre, serial: x.serial, radio: x.radio_name, donde });
    });

    // Ficha de cliente nueva: nombre correcto + lo que la vieja sabía de POC.
    const nuevoRef = db.doc(`clientes/${nuevo.id}`);
    const nuevoDoc = (await nuevoRef.get()).data();
    const viejoDoc = viejo.id ? (await db.doc(`clientes/${viejo.id}`).get()).data() : {};
    const cambiosCliente = {};
    if (nuevoDoc.nombre !== nuevo.nombre) {
      cambiosCliente.nombre = nuevo.nombre;
      cambiosCliente.nombreLower = nuevo.nombre.toLowerCase();
      cambiosCliente.nombre_norm = nuevo.nombre.toLowerCase();
    }
    for (const k of t.heredarDelViejo) {
      const vacio = nuevoDoc[k] == null || nuevoDoc[k] === "" || (Array.isArray(nuevoDoc[k]) && !nuevoDoc[k].length);
      if (vacio && viejoDoc[k] != null && viejoDoc[k] !== "") cambiosCliente[k] = viejoDoc[k];
    }
    if (t.ipSiFalta && !nuevoDoc.ip) cambiosCliente.ip = t.ipSiFalta;
    if (t.gruposSiFalta && !(nuevoDoc.poc_grupos || []).length) cambiosCliente.poc_grupos = t.gruposSiFalta;
    console.log(`cliente ${nuevo.id}:`, Object.keys(cambiosCliente).length ? cambiosCliente : "(sin cambios)");
    if (!nuevoDoc.ruc) console.log("  OJO: la ficha nueva no tiene RUC — falta para el contrato.");

    if (!APLICAR) continue;

    if (Object.keys(cambiosCliente).length) {
      await nuevoRef.update({ ...cambiosCliente, updated_at: FV.serverTimestamp(), updated_by_email: USUARIO });
    }

    for (let i = 0; i < mover.length; i += 150) {
      const batch = db.batch();
      for (const { f, p, poolRef } of mover.slice(i, i + 150)) {
        const antes = { cliente: f.data().cliente || "", cliente_id: f.data().cliente_id || "" };
        const despues = { cliente: nuevo.nombre, cliente_id: nuevo.id };
        batch.update(f.ref, { ...despues, cliente_anterior: antes.cliente, updated_at: FV.serverTimestamp(), updated_by_email: USUARIO });
        batch.set(db.collection("poc_logs").doc(), {
          equipo_id: f.id, fecha: FV.serverTimestamp(), usuario: USUARIO, accion: "editar", origen: "sistema",
          motivo: `Cambio de razón social: ${viejo.nombre} → ${nuevo.nombre}`, cambios: { antes, despues },
        });
        if (p && custodiaDelViejo(p.asignacion, viejo)) {
          batch.update(poolRef, {
            "asignacion.cliente_id": nuevo.id, "asignacion.cliente_nombre": nuevo.nombre,
            updated_at: FV.serverTimestamp(), updated_by_email: USUARIO,
          });
        }
      }
      await batch.commit();
    }
    console.log(`APLICADO: ${mover.length} fichas movidas.`);
  }
  if (!APLICAR) console.log("\nSimulación. Corre con --aplicar para escribirlo.");
})().catch((e) => { console.error(e); process.exit(1); });
