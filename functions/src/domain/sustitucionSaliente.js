/**
 * sustitucionSaliente — el radio que de verdad volvió no es el que el plan de
 * venta nombró.
 *
 * Caso REEMP20260814-01 (Hotel Gamboa): el plan puso B3700355 y el radio
 * dañado que salió del hotel era B3400055. Nada validaba que el serial elegido
 * en la venta fuera el que de verdad vuelve, y arreglarlo costó un script
 * (fix-reemp-gamboa-serial.js). Ahora el check-in de la DEVOLUCIÓN permite
 * "sustituir el esperado X por este" cuando el serial capturado pertenece al
 * mismo cliente, y la fila esperada guarda `serial_original`.
 *
 * Aquí viven las transformaciones PURAS que el trigger onOrdenDevolucionWrite
 * aplica al contrato cuando ve esa sustitución. Sin Firestore, para probarlas.
 */
const { normSerial } = require("./equiposPool");

/**
 * Filas esperadas cuyo serial cambió en ESTA escritura (llevan
 * `serial_original` y antes no lo llevaban, o el serial es otro).
 * @param {Map<string,Object>} antes  esperados previos por id
 * @param {Array<Object>} esperados   esperados después
 * @returns {Array<{id, serial, serial_norm, serial_original, original_norm,
 *   pool_doc_id, pool_doc_id_original, modelo, modelo_id}>}
 */
function detectarSustituciones(antes, esperados) {
  const out = [];
  for (const e of (esperados || [])) {
    if (!e || !e.serial_original) continue;
    const b = antes ? antes.get(e.id) : null;
    const yaEstaba = b && b.serial_original && normSerial(b.serial) === normSerial(e.serial);
    if (yaEstaba) continue;
    const original_norm = normSerial(e.serial_original);
    const serial_norm = normSerial(e.serial);
    if (!original_norm || !serial_norm || original_norm === serial_norm) continue;
    out.push({
      id: e.id,
      serial: String(e.serial).trim(), serial_norm,
      serial_original: String(e.serial_original).trim(), original_norm,
      pool_doc_id: e.pool_doc_id || null,
      pool_doc_id_original: e.pool_doc_id_original || (b && b.pool_doc_id) || null,
      modelo: e.modelo || "", modelo_id: e.modelo_id || null,
    });
  }
  return out;
}

const _esOriginal = (s, x) => {
  const n = normSerial(x && (x.serial_norm || x.serial));
  return !!n && n === s.original_norm;
};

/** `reemplaza_seriales` del contrato con el saliente corregido. */
function corregirReemplazaSeriales(lista, s) {
  if (!Array.isArray(lista)) return { lista, cambios: 0 };
  let cambios = 0;
  const out = lista.map((r) => {
    if (!_esOriginal(s, r)) return r;
    cambios++;
    return {
      ...r,
      serial: s.serial, serial_norm: s.serial_norm,
      pool_id: s.pool_doc_id || s.serial_norm,
      modelo: s.modelo || r.modelo || "", modelo_id: s.modelo_id || r.modelo_id || null,
      corregido_de: s.serial_original,
    };
  });
  return { lista: out, cambios };
}

/**
 * `transicion_plan` (nivel serial) con los destinos corregidos: el serial
 * nombrado por error pasa a 'continua' (sigue con el cliente) y el que volvió
 * pasa a 'reemplaza'. `por_modelo` se recalcula de las unidades.
 */
function corregirPlanSerial(plan, s, nota) {
  if (!plan || plan.nivel !== "serial" || !Array.isArray(plan.unidades)) return { plan, cambios: 0 };
  let cambios = 0;
  let unidades = plan.unidades.map((u) => {
    if (_esOriginal(s, u) && u.destino !== "continua") { cambios++; return { ...u, destino: "continua", corregido: true }; }
    return u;
  });
  const idx = unidades.findIndex((u) => normSerial(u.serial_norm || u.serial) === s.serial_norm);
  if (idx >= 0) {
    if (unidades[idx].destino !== "reemplaza") { cambios++; unidades[idx] = { ...unidades[idx], destino: "reemplaza", corregido: true }; }
  } else {
    cambios++;
    unidades = [...unidades, {
      pool_id: s.pool_doc_id || s.serial_norm, serial: s.serial, serial_norm: s.serial_norm,
      modelo_id: s.modelo_id || null, modelo: s.modelo || "", destino: "reemplaza", corregido: true,
    }];
  }
  if (!cambios) return { plan, cambios: 0 };

  const porModelo = new Map();
  for (const u of unidades) {
    const k = u.modelo_id || u.modelo || "";
    const m = porModelo.get(k) || { modelo_id: u.modelo_id || null, modelo: u.modelo || "", continuan: 0, devuelven: 0, reemplazan: 0, total: 0 };
    if (u.destino === "continua") m.continuan++;
    else if (u.destino === "devuelve") m.devuelven++;
    else if (u.destino === "reemplaza") m.reemplazan++;
    m.total++;
    porModelo.set(k, m);
  }
  return {
    plan: {
      ...plan, unidades, por_modelo: [...porModelo.values()],
      corregido_nota: [plan.corregido_nota, nota].filter(Boolean).join(" | "),
    },
    cambios,
  };
}

/** ¿Este mapeo de transición nombra al saliente equivocado? */
function mapeoNombraOriginal(m, s) {
  if (!m) return false;
  if (m.saliente_pool_id && s.pool_doc_id_original && String(m.saliente_pool_id) === String(s.pool_doc_id_original)) return true;
  return normSerial(m.saliente) === s.original_norm;
}

/** Campos a actualizar en ese mapeo (update, no create: onMapeoWrite ignora updates). */
function patchMapeo(s, nota) {
  return {
    saliente: s.serial,
    saliente_pool_id: s.pool_doc_id || s.serial_norm,
    modelo: s.modelo || "",
    modelo_id: s.modelo_id || null,
    corregido_de: s.serial_original,
    correccion: nota,
  };
}

function notaCorreccion(s, ordenId) {
  return `Serial del equipo saliente corregido en el check-in de la devolución ${ordenId}: `
    + `${s.serial_original} → ${s.serial} (el plan nombró un radio distinto al que volvió).`;
}

module.exports = {
  detectarSustituciones, corregirReemplazaSeriales, corregirPlanSerial,
  mapeoNombraOriginal, patchMapeo, notaCorreccion,
};
