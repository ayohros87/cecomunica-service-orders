/**
 * _pareo-huecos.js — criterio COMPARTIDO entre analiza-huecos-seriales.js (que
 * reporta) y parea-huerfanas-contrato.js (que escribe). Vive aquí y no en
 * src/lib porque es herramienta de saneo, no código de producción — pero tiene
 * que ser UNO: un reporte que promete 147 pareos y un escritor que hace otra
 * cosa es peor que no tener reporte.
 *
 * EL PROBLEMA QUE RESUELVE
 *   Las migraciones (POC y órdenes) dejaron 1,776 fichas `en_cliente` con
 *   cliente conocido pero SIN contrato. Al mismo tiempo, contratos vigentes
 *   declaran equipos que no tienen ninguna ficha ligada. Muchas de esas dos
 *   listas son la misma cosa vista por dos lados.
 */
"use strict";

const ESTADOS_CON_CLIENTE = ["asignado_contrato", "en_cliente"];

// Clave tolerante de modelo: minúsculas, sin puntuación, sin el sufijo -R.
const key = (s) => (s || "").toString().toLowerCase().normalize("NFD")
  .replace(/[^a-z0-9]+/g, "").replace(/r$/, "");

// ¿Esta huérfana puede llenar este hueco?
//
// `modelo_id` distinto NO descarta: el catálogo tiene la fila normal y la "-R"
// (refurbished) como dos modelos con id propio a propósito —el inventario
// necesita los dos buckets— pero físicamente son el mismo radio, y un contrato
// que dice "PNC360S" se satisface con una ficha "PNC360S-R". Cortar en el id
// descartaba esos pares: 355 pareos contra 410 cayendo al texto.
function casan(a, b) {
  if (a.mid && b.mid && a.mid === b.mid) return true;
  const x = a.mk, y = b.mk;
  if (!x || !y) return false;
  return x === y || (x.length >= 4 && y.includes(x)) || (y.length >= 4 && x.includes(y));
}

/**
 * Contratos vigentes con equipo declarado.
 * @param {FirebaseFirestore.QuerySnapshot} snap — colección `contratos` completa
 */
function contratosVigentes(snap) {
  const out = [];
  snap.forEach((d) => {
    const c = d.data();
    if (c.deleted) return;
    if (!["activo", "aprobado"].includes(c.estado)) return;
    if (c.vencimiento_estado === "vencido") return;
    out.push({ id: d.id, ...c });
  });
  return out;
}

/**
 * Del pool: cuántas unidades tiene ligadas cada contrato, y qué fichas están
 * con un cliente pero sin contrato (las huérfanas, candidatas a parear).
 * @param {FirebaseFirestore.QuerySnapshot} snap — colección `equipos_pool`
 * @returns {{asignadas:Map<string,number>, huerfanas:Map<string,Array>, nombre:Map<string,string>}}
 */
function leerPool(snap) {
  const asignadas = new Map();
  const huerfanas = new Map();
  const nombre = new Map();
  snap.forEach((d) => {
    const u = d.data();
    if (!ESTADOS_CON_CLIENTE.includes(u.estado)) return;
    const cid = u.asignacion && u.asignacion.contrato_doc_id;
    if (cid) { asignadas.set(cid, (asignadas.get(cid) || 0) + 1); return; }
    const cli = (u.asignacion && u.asignacion.cliente_id) || null;
    if (!cli) return;                    // sin cliente no hay a quién pareárselo
    nombre.set(cli, (u.asignacion && u.asignacion.cliente_nombre) || cli);
    if (!huerfanas.has(cli)) huerfanas.set(cli, []);
    huerfanas.get(cli).push({
      id: d.id,
      serial: u.serial || u.serial_norm || d.id,
      mid: u.modelo_id || null,
      mk: key(u.modelo_label || u.modelo),
      modelo: u.modelo_label || u.modelo || "",
      estado: u.estado,
      propiedad: u.propiedad || null,
      usada: false,
    });
  });
  return { asignadas, huerfanas, nombre };
}

/**
 * Los huecos: por cada contrato, las líneas de `equipos[]` que su cupo de
 * unidades ya ligadas no alcanza a cubrir. El cupo se consume por CONTRATO, no
 * por modelo — si tiene 3 ligadas y 5 declaradas, faltan 2, y cuáles son se
 * decide por el orden de las líneas.
 */
function huecosPorCliente(vigentes, asignadas, nombre) {
  const huecos = new Map();
  for (const c of vigentes) {
    let cupo = asignadas.get(c.id) || 0;
    for (const e of (c.equipos || [])) {
      let n = Number(e.cantidad || 0);
      if (n <= 0) continue;
      const usa = Math.min(n, cupo); cupo -= usa; n -= usa;
      if (n <= 0) continue;
      const cli = c.cliente_id;
      if (!cli) continue;
      nombre.set(cli, c.cliente_nombre || cli);
      if (!huecos.has(cli)) huecos.set(cli, []);
      for (let i = 0; i < n; i++) {
        huecos.get(cli).push({
          mid: e.modelo_id || null,
          mk: key(e.modelo_label || e.modelo),
          modelo: e.modelo_label || e.modelo || "—",
          contrato: c.contrato_id || c.id,
          contrato_doc_id: c.id,
          seriales_estado: c.seriales_estado || "—",
          candidato: null,
        });
      }
    }
  }
  return huecos;
}

/**
 * Asigna huérfanas a huecos DENTRO de un cliente. Muta los items: les pone
 * `candidato`.
 *
 * DOS pasadas y el orden importa: primero los que casan por `modelo_id`
 * exacto, después los tolerantes por texto. En una sola pasada un hueco
 * ambiguo se lleva la huérfana que otro necesitaba en exacto, y el total sale
 * peor.
 * @returns {number} cuántos se parearon
 */
function parear(items, disponibles) {
  let n = 0;
  for (const it of items) {
    const h = disponibles.find((x) => !x.usada && it.mid && x.mid && it.mid === x.mid);
    if (h) { h.usada = true; it.candidato = h; n++; }
  }
  for (const it of items) {
    if (it.candidato) continue;
    const h = disponibles.find((x) => !x.usada && casan(it, x));
    if (h) { h.usada = true; it.candidato = h; n++; }
  }
  return n;
}

module.exports = { ESTADOS_CON_CLIENTE, key, casan, contratosVigentes, leerPool, huecosPorCliente, parear };
