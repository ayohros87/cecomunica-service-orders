// Reposición de un equipo NO DEVUELTO (2026-10-15, pedido de Solangel,
// decisión de Alberto).
//
// EL HUECO. El radio que el cliente no devuelve entra a la bandeja "Equipos
// no devueltos" (cobros_equipos) y de ahí va directo a cobranza y factura. El
// taller, en cambio, primero le manda al cliente la cotización del valor de
// reposición, espera el visto bueno y después factura — y eso lo hacía en
// Excel porque el sistema no tenía ese paso.
//
// EL CAMINO (reusa las máquinas que ya existen, igual que el daño):
//   1. En la bandeja, "Cotizar la reposición" deja `cotizacion_pedida` en el
//      renglón. onCobroEquipoWrite llama a crearCotizacionNoDevuelto: nace la
//      MISMA cotización de taller que arma el daño (lib/reposicionDano), en
//      borrador, firmada por la jefatura de taller, con `cobro_equipo_id` en
//      vez de `gestion_id`. El renglón la enlaza.
//   2. El taller la envía; "El cliente aceptó" abre la fila de Facturación
//      pendiente (lib/facturacionCotizacion) y el renglón queda "aceptada".
//      No hay bodega que avisar: no se entrega radio alguno.
//   3. Recepción marca QBO → onCotizacionFacturada → alFacturarse: el renglón
//      se cierra como facturado con el número y la ficha del pool pasa a
//      "vendido" (lo que hacía a mano el botón Facturar de la bandeja).
//   4. El cliente NO acepta → el renglón sigue abierto y pasa a cobranza, que
//      es la bandeja que ya se persigue a diario.
//
// Las funciones puras van exportadas para los tests; las que escriben reciben
// ids y releen en transacción.
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const RD = require("./reposicionDano");

const COL = "cobros_equipos";
const ABIERTAS = ["pendiente", "en_cobranza"];
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Lo que se cotiza: el monto por unidad del renglón (el que fijó quien lo
// registró, o el del catálogo) por la cantidad. null = sin monto: no se inventa.
function montoNoDevuelto(row) {
  const unit = Number(row?.monto_unit);
  if (!Number.isFinite(unit) || unit <= 0) return null;
  const qty = row?.serial_norm ? 1 : Math.max(1, Number(row?.cantidad) || 1);
  return { unit: r2(unit), qty, total: r2(unit * qty) };
}

function descripcionEquipo(row) {
  const modelo = row?.modelo_label || "equipo";
  const m = montoNoDevuelto(row) || { qty: 1 };
  return row?.serial ? `el radio ${row.serial} (${modelo})` : `${m.qty} × ${modelo}`;
}

// El renglón que ve el cliente: mismo formato que cotizar-orden y que el daño
// (`equipo` estructurado + `spec` de texto) para que el documento agrupe igual.
function renglonNoDevuelto(row) {
  const m = montoNoDevuelto(row) || { unit: 0, qty: 1 };
  const modelo = row?.modelo_label || "equipo";
  const intervencion = `Equipo no devuelto`
    + (row?.orden_devolucion_id ? ` (devolución ${row.orden_devolucion_id})` : "")
    + (row?.motivo_detalle ? ` — ${String(row.motivo_detalle).trim()}` : "");
  return {
    id: "nd1",
    modelo: String(row?.modelo_id || row?.modelo_label || "").slice(0, 60),
    nombre: `Reposición de equipo ${modelo} no devuelto`,
    spec: `Equipo: Serie ${row?.serial || "—"} · Modelo ${modelo} · Intervención: ${intervencion}`,
    equipo: { id: row?.pool_doc_id || null, serial: row?.serial || "", modelo, marca: "", intervencion },
    cant: m.qty,
    precio: m.unit,
    desc: 0,
    modalidad: "venta",
  };
}

function introNoDevuelto(row) {
  return `Cotización de la reposición de ${descripcionEquipo(row)}, no devuelto al cierre del servicio`
    + (row?.orden_devolucion_id ? ` (devolución ${row.orden_devolucion_id})` : "")
    + ". Al aceptarla se factura el valor de reposición y el equipo queda a nombre del cliente.";
}

/**
 * La cotización de la reposición, lista para escribir. Es la MISMA cotización
 * de taller del daño con otra introducción, otro renglón y el enlace al
 * renglón de cobro (`cobro_equipo_id`) en lugar de la gestión.
 */
function docCotizacionNoDevuelto({ rowId, row, cliente = {}, firmante = {}, cotizacionId, fechaIso, validezDias = 15 }) {
  const m = montoNoDevuelto(row);
  if (!m) throw new Error("El renglón no tiene monto");
  const gLike = {
    cliente_id: row.cliente_id || "",
    cliente_nombre: row.cliente_nombre || cliente.nombre || "",
    items: [{ serial_saliente: row.serial || "", modelo: row.modelo_label || "", modelo_codigo: row.modelo_id || "" }],
    origen: { orden_id: row.orden_devolucion_id || row.orden_id || "" },
  };
  return RD.docCotizacionReposicion(
    { gid: "", g: gLike, cliente, firmante, cotizacionId, fechaIso, validezDias, monto: m.total },
    {
      intro: introNoDevuelto(row),
      renglon: renglonNoDevuelto(row),
      extra: {
        gestion_id: "",
        cobro_equipo_id: rowId,
        generada_por: "sistema:no_devuelto",
        orden_id: row.orden_devolucion_id || row.orden_id || "",
      },
    },
  );
}

const traza = (accion, detalle, por_email = "system") => ({
  accion, detalle, fecha_iso: new Date().toISOString(), por_uid: "system", por_email,
});

/**
 * "Cotizar la reposición" → se arma la cotización. Idempotente: el candado
 * `cotizacion_en_curso` se reserva en transacción ANTES de crear nada.
 * @returns {Promise<{docId, cotizacionId}|null>}
 */
async function crearCotizacionNoDevuelto(rowId) {
  const ref = db.collection(COL).doc(rowId);
  const row = await db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return null;
    const d = s.data();
    if (!d.cotizacion_pedida || d.cotizacion_doc_id || d.cotizacion_en_curso) return null;
    if (!ABIERTAS.includes(d.etapa)) return null;
    tx.update(ref, { cotizacion_en_curso: true });
    return d;
  });
  if (!row) return null;

  const pedidaPor = row.cotizacion_pedida?.por_email || "system";
  try {
    if (!montoNoDevuelto(row)) throw new Error("El renglón no tiene monto");
    const [cliSnap, cfgSnap, firmante, cotizacionId] = await Promise.all([
      row.cliente_id ? db.collection("clientes").doc(row.cliente_id).get().catch(() => null) : null,
      db.collection("empresa").doc("config").get().catch(() => null),
      RD.firmanteTaller(),
      RD.siguienteCotizacionId(),
    ]);
    const cliente = cliSnap?.exists ? cliSnap.data() : {};
    const validez = Number(cfgSnap?.exists ? cfgSnap.data().cotizacion_validez_dias : 0) || 15;
    const doc = docCotizacionNoDevuelto({
      rowId, row, cliente, firmante, cotizacionId, fechaIso: RD.hoyPanamaIso(), validezDias: validez,
    });
    const cref = await db.collection("cotizaciones").add({
      ...doc,
      fecha_creacion: admin.firestore.FieldValue.serverTimestamp(),
      fecha_modificacion: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.update({
      cotizacion_doc_id: cref.id,
      cotizacion_id: cotizacionId,
      cotizacion_estado: "borrador",
      cotizacion_en_curso: admin.firestore.FieldValue.delete(),
      updated_at: admin.firestore.FieldValue.serverTimestamp(),
      historial: admin.firestore.FieldValue.arrayUnion(traza("cotizacion_creada",
        `Cotización ${cotizacionId} de la reposición creada en borrador ($${montoNoDevuelto(row).total.toFixed(2)} + ITBMS si aplica). La envía la jefatura de taller.`, pedidaPor)),
    });
    return { docId: cref.id, cotizacionId };
  } catch (e) {
    await ref.update({
      cotizacion_en_curso: admin.firestore.FieldValue.delete(),
      cotizacion_pedida: admin.firestore.FieldValue.delete(),
      historial: admin.firestore.FieldValue.arrayUnion(traza("cotizacion_error",
        `No se pudo armar la cotización de la reposición: ${e.message}. Vuelve a pedirla o cotízala a mano.`, pedidaPor)),
    }).catch(() => {});
    logger.error("[reposicionNoDevuelto] cotización NO creada", { rowId, error: e.message });
    return null;
  }
}

// Solo sobre la cotización VIGENTE del renglón: una copia vieja no mueve nada.
async function _rowDe(cot, docId) {
  const rowId = String(cot?.cobro_equipo_id || "");
  if (!rowId) return null;
  const ref = db.collection(COL).doc(rowId);
  const s = await ref.get();
  if (!s.exists) return null;
  const d = s.data();
  if (d.cotizacion_doc_id && d.cotizacion_doc_id !== docId) return null;
  return { ref, d, rowId };
}

/** El cliente aceptó: el renglón lo dice y espera la factura. */
async function alAceptarse(docId, cot) {
  const x = await _rowDe(cot, docId);
  if (!x) return null;
  await x.ref.update({
    cotizacion_estado: "aceptada",
    cotizacion_aceptada_at: admin.firestore.FieldValue.serverTimestamp(),
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    historial: admin.firestore.FieldValue.arrayUnion(traza("cotizacion_aceptada",
      `El cliente aceptó la cotización ${cot.cotizacion_id || docId}: pasa a Facturación pendiente. Al marcar QBO este renglón se cierra.`,
      cot.aceptacion?.por_email || "system")),
  });
  return { ok: true };
}

/** El cliente NO aceptó: el renglón sigue abierto y pasa a cobranza. */
async function alRechazarse(docId, cot) {
  const x = await _rowDe(cot, docId);
  if (!x) return null;
  const patch = {
    cotizacion_estado: "rechazada",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    historial: admin.firestore.FieldValue.arrayUnion(traza("cotizacion_rechazada",
      `El cliente rechazó la cotización ${cot.cotizacion_id || docId}: el cobro pasa a cobranza.`,
      cot.rechazado_por_email || "system")),
  };
  if (x.d.etapa === "pendiente") {
    patch.etapa = "en_cobranza";
    patch.escalado_at = admin.firestore.FieldValue.serverTimestamp();
  }
  await x.ref.update(patch);
  return { ok: true, etapa: patch.etapa || x.d.etapa };
}

// La ficha del pool pasa a "vendido" (espejo server-side de
// CobrosEquiposService._moverFicha): best-effort, un renglón sin serial no
// tiene ficha, y que falle el pool no puede dejar la deuda sin cerrar.
async function _ficharVendido(d, { factura, porEmail }) {
  const poolId = d.pool_doc_id || d.serial_norm;
  if (!poolId) return false;
  const pref = db.collection("equipos_pool").doc(poolId);
  try {
    await db.runTransaction(async (tx) => {
      const s = await tx.get(pref);
      if (!s.exists) return;
      const de = s.data().estado || null;
      if (de === "vendido") return;
      tx.update(pref, {
        estado: "vendido", propiedad: "cliente",
        venta: {
          factura: factura || "", motivo: "no_devuelto",
          cliente_id: d.cliente_id || "", cliente_nombre: d.cliente_nombre || "",
          cliente_excepcion: false, orden_programacion_id: null,
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_by: "system", updated_by_email: porEmail || null,
      });
      tx.set(pref.collection("movimientos").doc(), {
        at: admin.firestore.FieldValue.serverTimestamp(),
        por: "system", por_email: porEmail || null,
        tipo: "cobro_no_devuelto", de_estado: de, a_estado: "vendido",
        ref: d.orden_devolucion_id ? { tipo: "orden", id: d.orden_devolucion_id, label: `DEVOLUCIÓN ${d.orden_devolucion_id}` } : null,
        notas: `No devuelto, cotizado y facturado — factura QBO ${factura || "(sin número)"}`,
      });
    });
    return true;
  } catch (e) {
    logger.warn("[reposicionNoDevuelto] la ficha del pool no pasó a vendido", { poolId, error: e.message });
    return false;
  }
}

/**
 * Recepción marcó QBO en la fila de facturación: el renglón se cierra como
 * facturado con el número (si llegó) y la ficha pasa a vendido. Si el número
 * llega después (segunda llamada), solo se anota.
 */
async function alFacturarse(rowId, { cotDocId, cotizacionId, factura = "", porEmail = null, at = null, montoTotal = null } = {}) {
  const ref = db.collection(COL).doc(rowId);
  const s = await ref.get();
  if (!s.exists) return null;
  const d = s.data();
  if (d.cotizacion_doc_id && cotDocId && d.cotizacion_doc_id !== cotDocId) return null;
  const fact = String(factura || "").trim();
  if (!ABIERTAS.includes(d.etapa)) {
    // Ya cerrado por esta vía: solo el número que faltaba.
    if (d.etapa === "facturado" && fact && !d.factura_ref) {
      await ref.update({
        factura_ref: fact, updated_at: admin.firestore.FieldValue.serverTimestamp(),
        historial: admin.firestore.FieldValue.arrayUnion(traza("factura_numero", `Factura QBO ${fact}`, porEmail || "system")),
      });
    }
    return { ok: true, ya: true };
  }
  await _ficharVendido(d, { factura: fact, porEmail });
  const monto = Number(montoTotal) > 0 ? Number(montoTotal) : Number(d.monto_total || 0);
  await ref.update({
    etapa: "facturado",
    factura_ref: fact,
    facturado_at: at || admin.firestore.FieldValue.serverTimestamp(),
    facturado_por_email: porEmail || "system",
    cotizacion_estado: "facturada",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    por_uid: "system", por_email: porEmail || "system",
    historial: admin.firestore.FieldValue.arrayUnion(traza("facturado",
      `Factura QBO ${fact || "(sin número todavía)"} — $${monto.toFixed(2)} · cotización ${cotizacionId || cotDocId || ""} aceptada por el cliente`,
      porEmail || "system")),
  });
  return { ok: true };
}

/** Recepción deshizo el paso QBO: el renglón vuelve a abierto (la ficha se queda). */
async function alDesfacturarse(rowId, cotDocId) {
  const ref = db.collection(COL).doc(rowId);
  const s = await ref.get();
  if (!s.exists) return null;
  const d = s.data();
  if (d.etapa !== "facturado" || d.cotizacion_estado !== "facturada") return null;
  if (d.cotizacion_doc_id && cotDocId && d.cotizacion_doc_id !== cotDocId) return null;
  await ref.update({
    etapa: "pendiente", factura_ref: "", facturado_at: null, facturado_por_email: "",
    cotizacion_estado: "aceptada",
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    historial: admin.firestore.FieldValue.arrayUnion(traza("factura_deshecha",
      "Recepción deshizo el paso QBO: el renglón vuelve a pendiente. Revisa la ficha del equipo si ya quedó en vendido.")),
  });
  return { ok: true };
}

module.exports = {
  COL, ABIERTAS, montoNoDevuelto, renglonNoDevuelto, introNoDevuelto, docCotizacionNoDevuelto,
  crearCotizacionNoDevuelto, alAceptarse, alRechazarse, alFacturarse, alDesfacturarse,
};
