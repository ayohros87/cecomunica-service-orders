// Lectura de la familia de una orden dividida (madre + todas sus
// descendientes). La lógica pura está en domain/ordenDividida.js.
const { db } = require("./admin");
const D = require("../domain/ordenDividida");

const COL = "ordenes_de_servicio";
const MAX_SALTOS = 6;

/**
 * Sube hasta la raíz por `dividida_de` y baja por `dividida_en`.
 * Devuelve [] si la orden no está dividida (sin lecturas).
 * @param {string} ordenId
 * @param {Object|null} data  el doc ya en mano (evita releerlo)
 * @returns {Promise<Array<{id:string, data:Object|null}>>}
 */
async function familiaDe(ordenId, data) {
  if (!D.estaDividida(data)) return [];
  const leidas = new Map([[ordenId, data]]);
  const leer = async (id) => {
    if (leidas.has(id)) return leidas.get(id);
    const s = await db.collection(COL).doc(id).get();
    const d = s.exists ? s.data() : null;
    leidas.set(id, d);
    return d;
  };
  // Raíz.
  let raizId = ordenId;
  let raiz = data;
  for (let i = 0; i < MAX_SALTOS && raiz && raiz.dividida_de; i++) {
    const padreId = String(raiz.dividida_de);
    const padre = await leer(padreId);
    if (!padre) break;
    raizId = padreId;
    raiz = padre;
  }
  // Descendientes (BFS).
  const familia = new Map([[raizId, raiz]]);
  const cola = [raizId];
  while (cola.length) {
    const id = cola.shift();
    const d = familia.get(id);
    for (const hId of (d && Array.isArray(d.dividida_en) ? d.dividida_en : [])) {
      const hijaId = String(hId);
      if (familia.has(hijaId)) continue;
      const h = await leer(hijaId);
      familia.set(hijaId, h);
      if (h) cola.push(hijaId);
    }
  }
  if (!familia.has(ordenId)) familia.set(ordenId, data);
  return [...familia].map(([id, d]) => ({ id, data: d }));
}

/**
 * Ids de las hermanas de `ordenId` que todavía no llegaron a un terminal.
 * [] si la orden no está dividida o si es la última en entregar.
 */
async function hermanasPendientes(ordenId, data) {
  const familia = await familiaDe(ordenId, data);
  return { familia, pendientes: D.hermanasPendientes(familia, ordenId) };
}

module.exports = { familiaDe, hermanasPendientes };
