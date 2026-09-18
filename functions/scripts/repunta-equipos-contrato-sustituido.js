/**
 * repunta-equipos-contrato-sustituido.js — Los equipos que siguen apuntando a
 * un contrato ANULADO POR SUSTITUCIÓN pasan al contrato que lo reemplazó.
 *
 * Por qué (auditoría 2026-09-17): anular ≠ terminar. Cuando un contrato se
 * rehace —el caso de SOCIEDAD ISRAELITA, anulado porque "se hizo en el 7 % y
 * ellos no lo pagan"— el papel viejo muere y nace otro, pero las unidades
 * siguieron apuntando al muerto: 32 radios con el cliente sin ningún contrato
 * vivo que los ampare, con su vigencia y su facturación calculándose contra un
 * documento anulado. Es lo primero que encuentra una auditoría porque se ve
 * solo: "equipo en la calle, contrato anulado".
 *
 * CÓMO repunta: agregando la fila a `contratos/{nuevo}/seriales`, NO tocando
 * el pool a mano. Ese es el camino de siempre (onSerialWrite es el único dueño
 * de pool←contrato) y así el papel nuevo queda listando sus equipos, que es la
 * mitad que de verdad falta. Las filas nacen con `ya_en_cliente: true`: son
 * radios que el cliente YA tiene, y sin eso `upsertContacto` los dejaría como
 * "asignado" — des-entregando en el sistema 32 radios que están en la calle.
 * (De todos modos `noTocarDesde` protege a los que están en_cliente.)
 *
 * NO toca el contrato anulado: sus filas son su historia. NO cierra ni anula
 * nada. NO repunta contratos vencidos sin sustituto declarado — ahí no hay a
 * dónde ir y la respuesta (renovar, recuperar o dar de baja) es comercial.
 *
 * Idempotente: salta los seriales que el contrato destino ya lista.
 *
 * USAGE (desde functions/):
 *   node scripts/repunta-equipos-contrato-sustituido.js            (dry-run)
 *   node scripts/repunta-equipos-contrato-sustituido.js --apply
 */
const admin = require("firebase-admin");
admin.initializeApp({ projectId: "cecomunica-service-orders" });
const db = admin.firestore();
const pool = require("../src/domain/equiposPool");

const apply = process.argv.includes("--apply");
const EN_CALLE = ["en_cliente", "asignado_contrato", "pendiente_cobro"];
const VIVOS = ["activo", "aprobado"];

/**
 * El contrato al que repuntar. De los sustitutos declarados en
 * `renovado_por_ids` se toma el que esté VIVO y declare al anulado entre sus
 * orígenes — la confirmación de que consumió a este contrato y no a otro.
 *
 * Un contrato rehecho puede tener DOS sustitutos y los dos declararlo: en
 * SOCIEDAD ISRAELITA, el alquiler nuevo (ALQ20260826-01) y un reemplazo de un
 * solo radio (REEMP20260807-01) nacieron del mismo anulado. Ahí no se adivina
 * por fecha ni por tipo: el que YA TIENE SUS EQUIPOS en el papel no recibe los
 * del otro. El reemplazo lista su único radio (1 de 1) y queda fuera; el
 * alquiler, con 0 de 33, es el que está esperando su flota.
 *
 * Si tras ese filtro sigue habiendo más de uno, se reporta y no se toca nada.
 */
function completo(c, enElPapel) {
  const piden = Number(c.equipos_total || 0)
    || (c.equipos || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
  return piden > 0 && enElPapel >= piden;
}

async function elegirDestino(anuladoId, candidatos) {
  const vivos = candidatos.filter(c => VIVOS.includes(String(c.data.estado || "").toLowerCase())
    && (c.data.contrato_origen_ids || []).includes(anuladoId));
  if (!vivos.length) return { ok: false, motivo: "ningún sustituto vivo lo declara como origen" };

  const conHueco = [];
  for (const c of vivos) {
    const n = (await db.collection("contratos").doc(c.id).collection("seriales").get()).size;
    if (completo(c.data, n)) {
      console.log(`    (descartado ${c.data.contrato_id}: ya lista sus ${n} equipo(s))`);
      continue;
    }
    conHueco.push(c);
  }
  if (conHueco.length === 1) return { ok: true, destino: conHueco[0] };
  if (!conHueco.length) return { ok: false, motivo: "todos los sustitutos ya tienen sus equipos" };
  return { ok: false, motivo: `${conHueco.length} sustitutos siguen esperando equipos: hay que decidir a mano` };
}

(async () => {
  const cSnap = await db.collection("contratos").get();
  const C = new Map(cSnap.docs.map(d => [d.id, d.data()]));

  // Equipos en la calle agrupados por el contrato ANULADO al que apuntan.
  const poolSnap = await db.collection("equipos_pool").where("estado", "in", EN_CALLE).get();
  const porAnulado = new Map();
  for (const d of poolSnap.docs) {
    const cid = d.data().asignacion?.contrato_doc_id;
    if (!cid) continue;
    const c = C.get(cid);
    if (!c || String(c.estado || "").toLowerCase() !== "anulado") continue;
    if (!porAnulado.has(cid)) porAnulado.set(cid, []);
    porAnulado.get(cid).push({ id: d.id, ...d.data() });
  }

  let movidos = 0, saltados = 0, sinDestino = 0;
  for (const [anuladoId, unidades] of porAnulado) {
    const anulado = C.get(anuladoId);
    const candidatos = (anulado.renovado_por_ids || [])
      .map(id => ({ id, data: C.get(id) })).filter(c => c.data);
    console.log(`\n=== ${anulado.contrato_id} (anulado) · ${unidades.length} equipo(s) · ${anulado.cliente_nombre}`);
    const r = await elegirDestino(anuladoId, candidatos);
    if (!r.ok) {
      sinDestino += unidades.length;
      console.log(`    SIN DESTINO CLARO: ${r.motivo}`);
      continue;
    }
    const destino = r.destino;
    console.log(`    -> ${destino.data.contrato_id} (${destino.data.estado})`);

    const ref = db.collection("contratos").doc(destino.id);
    const yaSnap = await ref.collection("seriales").get();
    const ya = new Set(yaSnap.docs.map(d => pool.normSerial(d.data()?.serial)).filter(Boolean));

    for (const u of unidades) {
      const serial = String(u.serial || u.id || "").trim();
      const norm = pool.normSerial(serial);
      if (!norm) continue;
      if (ya.has(norm)) { saltados++; console.log(`    = ${serial} ya está en el papel nuevo`); continue; }
      console.log(`    + ${serial} (${u.modelo_label || "?"}) · estado ${u.estado}`);
      if (!apply) { movidos++; continue; }
      await ref.collection("seriales").add({
        serial,
        modelo: u.modelo_label || "",
        modelo_id: u.modelo_id || null,
        contrato_doc_id: destino.id,
        contrato_id: destino.data.contrato_id || "",
        cliente_id: destino.data.cliente_id || anulado.cliente_id || "",
        cliente_nombre: destino.data.cliente_nombre || anulado.cliente_nombre || "",
        // El cliente YA tiene el radio: la fila no espera una entrega.
        ya_en_cliente: true,
        source: "repunte_sustitucion",
        repunte: {
          desde_contrato_doc_id: anuladoId,
          desde_contrato_id: anulado.contrato_id || "",
          motivo: "El contrato de origen se anuló por sustitución y el equipo nunca pasó al que lo reemplazó (auditoría 2026-09-17)",
          at: admin.firestore.FieldValue.serverTimestamp(),
        },
        created_by: "system", updated_by: "system",
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
      ya.add(norm);
      movidos++;
    }
  }
  console.log(`\n${apply ? "APLICADO" : "DRY-RUN"}: ${movidos} equipo(s) repuntado(s), ${saltados} ya estaban, ${sinDestino} sin destino claro.`);
  if (!apply) console.log("El pool lo mueve onSerialWrite al escribirse cada fila — aquí no se toca una sola ficha.");
})().catch((e) => { console.error(e); process.exit(1); });
