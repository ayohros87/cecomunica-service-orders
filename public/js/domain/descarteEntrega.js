// Equipos DESCARTADOS en el control de calidad y la entrega — predicados puros.
//
// Petición de Solangel (2026-10-08): cuando una reparación trae un radio que
// el QC descartó, el cliente firmaba la entrega por TODOS los equipos,
// incluido el que no se lleva. Recepción lo resolvía eliminando el serial de
// la orden y abriendo una ENTRADA aparte — y esa ENTRADA, sin la marca de
// descarte, dejaba el radio disponible en bodega y marcado refurbished (caso
// ANATI 24O31A0889, orden 2026100605 → ENTRADA 2026100804).
//
// Ahora quien firma el QC dice, además del motivo, el DESTINO del descartado:
//   · 'cecomunica' — se queda en Cecomunica (radio nuestro, o propio que el
//                    cliente nos deja). NO sale en lo que firma el cliente, y
//                    al entregar la orden va a cuarentena, no a en_cliente.
//   · 'cliente'    — se le devuelve al cliente SIN REPARAR (radio propio que
//                    no quiere reparar). Sale en la entrega, marcado.
// y la CAUSA ('garantia' | 'dano_cliente'), que es lo que decide si el
// reemplazo es gratis o se cotiza (gestión GR, ver ordenes-reemplazo.js).
//
// Los descartes anteriores a esto no traen destino: se leen como
// 'cecomunica', que es el caso normal (decisión de Alberto, 2026-10-08).
//
// La fuente es la ÚLTIMA pasada de QC (`orden.qc.por_equipo`), que es la que
// manda sobre la entrega. Los descartes de la revisión de ENTRADA
// (`descartado_revision`) no pasan por aquí: una ENTRADA no se entrega.
//
// Espejo del servidor: functions/src/domain/descarteEntrega.js (lo usa el
// trigger del pool al entregar). Si cambia el criterio, cambian los dos.
//
// Consumidores: entregaTandas (pendientes), ordenes-flujo (resumen, tablet,
// nota y correo de entrega), imprimir-orden, ordenes-equipos (tarjeta) y
// ordenes-qc (que es quien escribe destino y causa).
(function (root) {

  const DESTINOS = {
    cecomunica: 'Se queda en Cecomunica',
    cliente: 'Se devuelve al cliente sin reparar',
  };
  const CAUSAS = {
    garantia: 'Falla del equipo (garantía)',
    dano_cliente: 'Daño causado por el cliente',
  };

  const normSerial = (s) => String(s == null ? '' : s).trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Índice de los descartes de la última pasada de QC: por id del equipo
  // dentro de la orden y, como red, por serial (equipos legacy sin id).
  function _indice(orden) {
    const porId = new Map();
    const porSerial = new Map();
    const pe = orden && orden.qc && orden.qc.por_equipo;
    if (!pe || typeof pe !== 'object') return { porId, porSerial };
    for (const d of Object.values(pe)) {
      if (!d || d.resultado !== 'descartado') continue;
      const info = {
        destino: d.destino === 'cliente' ? 'cliente' : 'cecomunica',
        causa: d.causa === 'dano_cliente' || d.causa === 'garantia' ? d.causa : '',
        nota: String(d.nota || ''),
        serial: String(d.serial || ''),
      };
      if (d.equipo_id) porId.set(String(d.equipo_id), info);
      const s = normSerial(d.serial);
      if (s) porSerial.set(s, info);
    }
    return { porId, porSerial };
  }

  /** El descarte de ESE equipo en la última pasada de QC, o null. */
  function descarteDe(orden, equipo, _idx) {
    if (!equipo) return null;
    const idx = _idx || _indice(orden);
    if (equipo.id && idx.porId.has(String(equipo.id))) return idx.porId.get(String(equipo.id));
    const s = normSerial(equipo.numero_de_serie || equipo.serial || equipo.SERIAL);
    return (s && idx.porSerial.get(s)) || null;
  }

  /** ¿Este equipo se queda en Cecomunica? (no sale en la entrega) */
  function seQueda(orden, equipo, _idx) {
    const d = descarteDe(orden, equipo, _idx);
    return !!d && d.destino === 'cecomunica';
  }

  /** ¿Este equipo vuelve al cliente sin reparar? (sale, marcado) */
  function sinReparar(orden, equipo, _idx) {
    const d = descarteDe(orden, equipo, _idx);
    return !!d && d.destino === 'cliente';
  }

  /**
   * Parte una lista de equipos en lo que se entrega y lo que se queda.
   * `equipos` por defecto son los vivos de la orden.
   */
  function separar(orden, equipos) {
    const idx = _indice(orden);
    const lista = Array.isArray(equipos) ? equipos
      : (Array.isArray(orden && orden.equipos) ? orden.equipos : []).filter((e) => e && !e.eliminado);
    const salen = [], seQuedan = [];
    for (const e of lista) (seQueda(orden, e, idx) ? seQuedan : salen).push(e);
    return { salen, seQuedan };
  }

  /** Lo que el cliente sí recibe (y firma). */
  function equiposQueSalen(orden, equipos) {
    return separar(orden, equipos).salen;
  }

  const api = {
    DESTINOS, CAUSAS, normSerial,
    descarteDe, seQueda, sinReparar, separar, equiposQueSalen,
  };
  root.DescarteEntrega = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
