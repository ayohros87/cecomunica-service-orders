/**
 * reporta-propios-sin-factura.js — ¿qué ventas con contrato quedaron sin
 * factura asociada en la plataforma?
 *
 * CONTEXTO (Zuleika 2026-09-03). Cuando el contrato "Propio" nace primero y
 * bodega asigna los seriales, la factura QBO que Recepción emite después no
 * tenía dónde asociarse: el asistente de venta solo acepta unidades en bodega.
 * Desde el arreglo, la factura se registra en Contratos → Equipos →
 * "Registrar factura de venta" y se espeja en cada unidad del pool
 * (venta.factura). Este script lista el HISTÓRICO que quedó colgando antes del
 * arreglo, para cerrarlo a mano con Recepción desde esa misma pantalla.
 *
 * QUÉ HACE. Solo LEE (no escribe nada): recorre los contratos tipo "Propio" y
 * cruza sus unidades del pool. Reporta por contrato:
 *   · si el contrato tiene factura_venta registrada,
 *   · cuántas unidades asignadas tienen venta.factura y cuántas no.
 *
 *   node scripts/reporta-propios-sin-factura.js [--todos]
 *
 * Sin --todos solo imprime los contratos con algo pendiente (sin factura en el
 * contrato, o con unidades sin espejo); con --todos imprime todo el censo.
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();

const TODOS = process.argv.includes("--todos");

async function contratosPropios() {
  // Mismo criterio que onSerialWrite: tipo_contrato "Propio" o codigo_tipo
  // "PROP". Dos queries y merge por doc ID (Firestore no tiene OR entre campos
  // en este SDK sin índices extra).
  const porTipo   = await db.collection("contratos").where("tipo_contrato", "==", "Propio").get();
  const porCodigo = await db.collection("contratos").where("codigo_tipo", "==", "PROP").get();
  const map = new Map();
  [...porTipo.docs, ...porCodigo.docs].forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
  return [...map.values()];
}

(async () => {
  const contratos = await contratosPropios();
  console.log(`Contratos "Propio": ${contratos.length}\n`);

  let pendientes = 0, unidadesSinFactura = 0;
  const filas = [];
  for (const c of contratos) {
    const unidades = await db.collection("equipos_pool")
      .where("asignacion.contrato_doc_id", "==", c.id).get();
    const conFactura = unidades.docs.filter((d) => (d.data().venta?.factura || "").trim()).length;
    const sinFactura = unidades.size - conFactura;
    const facturaContrato = (c.factura_venta?.numero || "").trim();
    const pendiente = !facturaContrato || sinFactura > 0;
    if (pendiente) { pendientes++; unidadesSinFactura += sinFactura; }
    if (!pendiente && !TODOS) continue;
    filas.push({
      contrato: c.contrato_id || c.id,
      cliente: c.cliente_nombre || "—",
      estado: c.estado || "—",
      factura: facturaContrato || "(sin factura)",
      unidades: unidades.size,
      sin_espejo: sinFactura,
    });
  }

  filas.sort((a, b) => b.sin_espejo - a.sin_espejo || a.contrato.localeCompare(b.contrato));
  for (const f of filas) {
    console.log(
      `${f.contrato.padEnd(20)} ${f.estado.padEnd(10)} ${f.factura.padEnd(18)} ` +
      `unidades: ${String(f.unidades).padStart(3)}  sin espejo: ${String(f.sin_espejo).padStart(3)}  ${f.cliente}`);
  }
  console.log(`\n${pendientes} contrato(s) con la factura pendiente o sin espejar ` +
    `(${unidadesSinFactura} unidad(es) sin venta.factura).`);
  console.log('Se cierran desde la app: Contratos → Equipos → "Registrar factura de venta".');
})().catch((e) => { console.error(e); process.exit(1); });
