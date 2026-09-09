/* =============================================================
   GARANTÍA DE UN EQUIPO DEL POOL — una sola definición

   La cláusula 8 del contrato dice: los equipos ADQUIRIDOS por el cliente
   llevan doce (12) meses de garantía. En el sistema eso vivía nada más
   como `venta.garantia_vence` en la ficha del pool… y NADIE lo escribe:
   ni `vender()`, ni `estamparFacturaContrato()`, ni la importación. El
   resultado es que todo equipo propio se leía como "sin garantía" — y en
   el Centro eso significa pedir aprobación por excepción hasta para un
   radio facturado el mes pasado.

   Aquí se resuelve en un solo lugar, con la fecha DECLARADA por delante y
   la derivada de la factura como respaldo (marcada como tal: quien decide
   ve que es un estimado, no un dato capturado).

   Lo usan el módulo de propuestas del taller (ordenes-reemplazo.js) y la
   ficha del cliente (clientes-centro.js).
   ============================================================= */
(function (raiz) {
  const MESES_CLAUSULA_8 = 12;

  // Timestamp de Firestore | Date | string ISO | null → Date | null
  function _fecha(v) {
    if (!v) return null;
    const d = v?.toDate ? v.toDate() : (v instanceof Date ? v : new Date(v));
    return d && !isNaN(d) ? d : null;
  }

  function _masMeses(d, meses) {
    const out = new Date(d.getTime());
    out.setMonth(out.getMonth() + meses);
    return out;
  }

  /* Garantía de la unidad:
       { aplica, vence, derivada, vigente, fuente }
     · aplica  — false para equipo de alquiler (la garantía es del cliente
                 que COMPRÓ; el alquiler se reemplaza por contrato, no por
                 garantía) y para el comprado fuera de CECOMUNICA.
     · vence   — Date | null
     · derivada— true si sale de la factura + 12 meses, no de un dato capturado.
     · fuente  — 'declarada' | 'factura' | null                              */
  function garantia(ficha, { hoy = new Date() } = {}) {
    const nada = { aplica: false, vence: null, derivada: false, vigente: false, fuente: null };
    if (!ficha) return nada;
    if (ficha.propiedad !== 'cliente') return nada;   // alquiler / flota: no aplica
    const venta = ficha.venta;
    if (!venta) return nada;                           // comprado fuera de CECOMUNICA

    const declarada = _fecha(venta.garantia_vence);
    if (declarada) {
      return { aplica: true, vence: declarada, derivada: false, vigente: declarada > hoy, fuente: 'declarada' };
    }
    const facturada = _fecha(venta.at);
    if (facturada) {
      const vence = _masMeses(facturada, MESES_CLAUSULA_8);
      return { aplica: true, vence, derivada: true, vigente: vence > hoy, fuente: 'factura' };
    }
    return { aplica: true, vence: null, derivada: false, vigente: false, fuente: null };
  }

  function textoGarantia(g) {
    if (!g?.aplica) return '';
    if (!g.vence) return 'sin fecha de garantía';
    const f = g.vence.toLocaleDateString('es-PA', { month: 'short', year: 'numeric' });
    const suf = g.derivada ? ' (estimada: 12 meses desde la factura)' : '';
    return g.vigente ? `garantía hasta ${f}${suf}` : `garantía vencida en ${f}${suf}`;
  }

  /* ¿El reemplazo de este equipo propio va como EXCEPCIÓN por servicio al
     cliente (aprobación de administración)?

     Deliberadamente conservador: solo una garantía DECLARADA y vigente lo
     evita. La derivada de la factura sirve para que quien decide vea el
     dato — "lo compró en marzo, esto está en garantía" — pero no cambia por
     sí sola quién autoriza; para eso hay que capturar `venta.garantia_vence`.
     Si algún día se decide que la fecha derivada basta, es esta función la
     que cambia, y cambian las dos pantallas a la vez.                      */
  function requiereExcepcion(g) {
    return !(g?.aplica && g.vigente && g.fuente === 'declarada');
  }

  const api = { garantia, textoGarantia, requiereExcepcion, MESES_CLAUSULA_8 };
  if (raiz) raiz.GarantiaEquipo = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
