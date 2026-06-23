// calcularFacturaContrato — C1 del facturador. Calcula la factura de un contrato para
// un período (mes/año) SIN escribir a QuickBooks: prorrateo ÷30 por línea, desglose
// alquiler/frecuencia/mantenimiento desde el catálogo de modelos, cargos recurrentes
// e ITBMS del contrato. Sirve para validar el cálculo antes de empujar a QBO.
// Solo admin/contabilidad. Read-only.

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { db } = require("../lib/admin");

const norm = (s) => String(s || "").trim().toLowerCase();
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const toDate = (ts) => (ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null));

async function requireAdminOrContabilidad(uid) {
  if (!uid) throw new HttpsError("unauthenticated", "Inicia sesión.");
  const snap = await db.collection("usuarios").doc(uid).get();
  const d = snap.exists ? snap.data() : null;
  if (!d || !["administrador", "contabilidad"].includes(d.rol) || d.activo === false) {
    throw new HttpsError("permission-denied", "Solo administrador/contabilidad.");
  }
}

module.exports = onCall(
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 30 },
  async (request) => {
    await requireAdminOrContabilidad(request.auth?.uid);
    const { contratoId } = request.data || {};
    if (!contratoId) throw new HttpsError("invalid-argument", "Falta contratoId.");

    const snap = await db.collection("contratos").doc(contratoId).get();
    if (!snap.exists) throw new HttpsError("not-found", "Contrato no encontrado.");
    const c = snap.data();

    const hoy = new Date();
    const anio = Number(request.data.anio) || hoy.getFullYear();
    const mes = Number(request.data.mes) || (hoy.getMonth() + 1); // 1-12
    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0);
    const diasMes = finMes.getDate();

    // Catálogo de modelos (desglose).
    const modelosById = {}, modelosByName = {};
    (await db.collection("modelos").get()).forEach((d) => {
      const m = { id: d.id, ...d.data() };
      modelosById[m.id] = m;
      if (m.modelo) modelosByName[norm(m.modelo)] = m;
    });
    const modeloDe = (e) => (e.modelo_id && modelosById[e.modelo_id]) || modelosByName[norm(e.modelo)] || null;

    const itbmsAplica = (typeof c.itbms_aplica !== "undefined") ? !!c.itbms_aplica : true;
    const itbmsPorc = Number(c.itbms_porcentaje || 0.07);

    const lineas = [];
    const omitidas = [];
    for (const e of (c.equipos || [])) {
      const cantidad = Number(e.cantidad || 0);
      const precio = Number(e.precio || 0); // mensualidad por unidad
      if (cantidad <= 0 || precio <= 0) { continue; }

      // Ventana facturable de la línea dentro del período.
      const li = toDate(e.fecha_inicio_facturacion) || inicioMes;
      const lf = toDate(e.fecha_fin_facturacion) || finMes;
      if (li > finMes || lf < inicioMes) { omitidas.push({ modelo: e.modelo || "—", motivo: "fuera del período" }); continue; }
      const desde = li > inicioMes ? li : inicioMes;
      const hasta = lf < finMes ? lf : finMes;
      const dias = Math.floor((hasta - desde) / 86400000) + 1;
      const factor = dias >= diasMes ? 1 : r4(dias / 30); // prorrateo ÷30

      const mensual = r2(precio * cantidad);
      const importe = r2(mensual * factor);

      // Desglose por unidad (fijo desde el modelo) × cantidad × factor.
      const m = modeloDe(e);
      const alquilerU = m ? Number(m.precio_alquiler || 0) : 0;
      const frecU = m ? Number(m.precio_frecuencia || 0) : 0;
      const alquiler = r2(alquilerU * cantidad * factor);
      const frecuencia = r2(frecU * cantidad * factor);
      const mantenimiento = r2(importe - alquiler - frecuencia);

      lineas.push({
        tipo: "equipo",
        modelo: e.modelo || "—",
        modelo_id: e.modelo_id || "",
        cantidad, precio_unitario: precio,
        dias, factor, parcial: factor < 1,
        importe,
        desglose: { alquiler, frecuencia, mantenimiento },
        qbo_bundle_id: m ? (m.qbo_bundle_id || "") : "",
        mapeo_ok: !!(m && Number(m.precio_alquiler) > 0 && m.qbo_item_alquiler_id && m.qbo_bundle_id),
        advertencia: mantenimiento < 0 ? "mantenimiento negativo (alquiler+frecuencia > mensualidad)" : null,
      });
    }

    // Cargos recurrentes (mensuales). Los únicos se cobran solo en la 1ª factura (futuro).
    const cargos = [];
    for (const cg of (Array.isArray(c.cargos) ? c.cargos : [])) {
      if (!cg.recurrente) continue;
      cargos.push({ tipo: "cargo", concepto: cg.concepto || "Cargo", importe: r2(cg.monto), cargo_id: cg.cargo_id || "" });
    }

    const subtotalEquipos = r2(lineas.reduce((s, l) => s + l.importe, 0));
    const subtotalCargos = r2(cargos.reduce((s, l) => s + l.importe, 0));
    const subtotal = r2(subtotalEquipos + subtotalCargos);
    const itbms = itbmsAplica ? r2(subtotal * itbmsPorc) : 0;
    const total = r2(subtotal + itbms);

    logger.info("[calcularFacturaContrato]", { contratoId, anio, mes, lineas: lineas.length, total });

    return {
      contrato_id: c.contrato_id || contratoId,
      cliente_nombre: c.cliente_nombre || "",
      periodo: { anio, mes, inicio: inicioMes.toISOString().slice(0, 10), fin: finMes.toISOString().slice(0, 10), dias_mes: diasMes },
      lineas, cargos, omitidas,
      subtotal_equipos: subtotalEquipos,
      subtotal_cargos: subtotalCargos,
      subtotal,
      itbms_aplica: itbmsAplica, itbms_porc: itbmsPorc, itbms,
      total,
    };
  }
);
