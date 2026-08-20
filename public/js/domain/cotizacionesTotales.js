// Cotizaciones — totales y helpers de fecha (puros, sin DOM ni Firestore)
// API: CotizacionTotales.{lineTotal, calcTotales, cuenta, addDays, validezVence,
//                         modalidadDe, esAlquiler, evaluarPolitica,
//                         agruparPorEquipo, tituloEquipo, trabajoEquipo}
//
// MODALIDAD POR RENGLÓN. Cada renglón se vende (pago único) o se alquila
// (mensualidad). Un renglón sin `modalidad` es VENTA — así toda cotización
// anterior a este cambio sigue calculando exactamente igual.
//
// Eso obliga al documento a llevar DOS totales que no se suman: `venta.total`
// es un pago único y `alquiler.total` es por mes. Para que exista un número
// comparable (el listado, los KPI y la política de envío necesitan uno solo),
// se proyecta el alquiler a un máximo de 12 meses — ver `valorEvaluado`.
window.CotizacionTotales = {
  // Tope de meses de alquiler que entran en el número comparable. Un contrato
  // de flota a 36 meses compromete mucho más que su mensualidad, pero medirlo
  // por el plazo completo mandaría a aprobación casi cualquier alquiler serio.
  MESES_TECHO: 12,

  // Modalidad de un renglón. Ausente = 'venta' (retrocompatible).
  modalidadDe(it) {
    return it?.modalidad === 'alquiler' ? 'alquiler' : 'venta';
  },

  esAlquiler(it) {
    return this.modalidadDe(it) === 'alquiler';
  },

  // Total de un renglón: cant * precio * (1 - desc/100). Redondea a 2 dec.
  // En alquiler el resultado es POR MES; la fórmula es la misma.
  lineTotal(it) {
    const bruto = Number(it?.cant || 0) * Number(it?.precio || 0);
    const neto = bruto * (1 - Number(it?.desc || 0) / 100);
    return FMT.round2(neto);
  },

  // Totales de UN bucket de renglones (todos de la misma modalidad).
  // `bruto` y `descLineas` existen para que las pantallas puedan MOSTRAR el
  // descuento por renglón: el subtotal ya viene neto de él, así que sin estos
  // dos campos un 20% por línea es invisible en cualquier bloque de totales.
  _bucket(items, descPct, itbmsPct) {
    const lista = Array.isArray(items) ? items : [];
    const bruto = FMT.round2(lista.reduce(
      (s, it) => s + Number(it?.cant || 0) * Number(it?.precio || 0), 0));
    const subtotal = FMT.round2(lista.reduce((s, it) => s + this.lineTotal(it), 0));
    const descLineas = FMT.round2(bruto - subtotal);
    const descGlobal = FMT.round2(subtotal * Number(descPct || 0) / 100);
    const base = FMT.round2(subtotal - descGlobal);
    const itbms = FMT.round2(base * Number(itbmsPct || 0) / 100);
    const total = FMT.round2(base + itbms);
    return { bruto, descLineas, subtotal, descGlobal, base, itbms, total, n: lista.length };
  },

  // Plazo del alquiler, en meses. Vive en el DOCUMENTO, no en el renglón:
  // una cotización es un solo acuerdo con un solo plazo.
  plazoDe(cot) {
    const n = Math.round(Number(cot?.plazoMeses || 0));
    return Number.isFinite(n) && n > 0 ? n : 0;
  },

  // Totales completos. Devuelve los dos buckets por separado MÁS un juego de
  // campos planos (subtotal/base/itbms/total/…) que son la proyección a 12
  // meses — la forma que ya consumen el listado, Finanzas, la búsqueda global
  // y firestore.rules. Para una cotización de pura venta los planos son
  // idénticos a lo que devolvía la versión anterior: sin migración.
  calcTotales(cot) {
    const items = Array.isArray(cot?.items) ? cot.items : [];
    const descPct = Number(cot?.descuentoPct || 0);
    const itbmsPct = Number(cot?.itbmsPct || 0);

    const venta = this._bucket(items.filter(it => !this.esAlquiler(it)), descPct, itbmsPct);
    const alquiler = this._bucket(items.filter(it => this.esAlquiler(it)), descPct, itbmsPct);

    const hayAlquiler = alquiler.n > 0;
    const plazoMeses = this.plazoDe(cot);
    // Sin plazo declarado pero con renglones de alquiler se asume el tope: es
    // el lado conservador (cuenta un año completo contra el techo) y evita que
    // olvidar el plazo abra un hueco por el que pase cualquier mensualidad.
    const mesesComputables = hayAlquiler
      ? Math.min(plazoMeses || this.MESES_TECHO, this.MESES_TECHO)
      : 0;

    // Compromiso REAL del plazo acordado — informativo, nunca se compara
    // contra el techo.
    const compromiso = FMT.round2(alquiler.total * plazoMeses);

    // Proyección: cada componente del alquiler entra multiplicado por los
    // meses computables, así `base + itbms = total` se sigue cumpliendo.
    const proy = (v) => FMT.round2(v * mesesComputables);
    const planos = {
      bruto:      FMT.round2(venta.bruto      + proy(alquiler.bruto)),
      descLineas: FMT.round2(venta.descLineas + proy(alquiler.descLineas)),
      subtotal:   FMT.round2(venta.subtotal   + proy(alquiler.subtotal)),
      descGlobal: FMT.round2(venta.descGlobal + proy(alquiler.descGlobal)),
      base:       FMT.round2(venta.base       + proy(alquiler.base)),
      itbms:      FMT.round2(venta.itbms      + proy(alquiler.itbms)),
      total:      FMT.round2(venta.total      + proy(alquiler.total)),
    };

    return {
      ...planos,
      venta,
      alquiler,
      hayVenta: venta.n > 0,
      hayAlquiler,
      esMixta: venta.n > 0 && hayAlquiler,
      plazoMeses,
      mesesComputables,
      compromiso,
      // Alias explícito de `total` para el código nuevo: deja claro que ese
      // número es la proyección y no "lo que paga el cliente".
      valorEvaluado: planos.total,
    };
  },

  // Cuenta de unidades (suma de cantidades).
  cuenta(items) {
    return (items || []).reduce((s, it) => s + Number(it?.cant || 0), 0);
  },

  // Suma días a una fecha ISO YYYY-MM-DD y devuelve otra ISO YYYY-MM-DD.
  addDays(iso, days) {
    if (!iso) return iso;
    const d = new Date(iso + 'T00:00:00');
    d.setDate(d.getDate() + Number(days || 0));
    return d.toISOString().slice(0, 10);
  },

  // Devuelve la fecha ISO de vencimiento de la cotización (fecha + validezDias).
  validezVence(cot) {
    return this.addDays(cot?.fecha, cot?.validezDias);
  },

  // ── Política de envío (por excepción) ─────────────────────────────────────
  // Dentro de límites, el vendedor envía la cotización él mismo; fuera de
  // límites, requiere aprobación. Umbrales configurables en empresa/config;
  // los defaults se mantienen aquí para sobrevivir una caída de Firestore.
  // Se dejan por debajo de los valores vivos a propósito: ante una caída de
  // Firestore la política falla CERRADA (más aprobaciones, nunca menos).
  POLICY_DEFAULT: { descuentoMaxPct: 15, totalMax: 5000 },

  // Mapea el doc empresa/config (EmpresaService.getConfig) a la forma de política.
  policyFromConfig(cfg) {
    const d = this.POLICY_DEFAULT;
    return {
      descuentoMaxPct: cfg && cfg.cotizacion_descuento_max_pct != null
        ? Number(cfg.cotizacion_descuento_max_pct) : d.descuentoMaxPct,
      totalMax: cfg && cfg.cotizacion_total_max != null
        ? Number(cfg.cotizacion_total_max) : d.totalMax,
    };
  },

  // ¿La cotización excede la política de envío directo?
  // input: { total, descuentoPct, items?, mesesComputables?, alquilerMensual? }
  // `total` debe ser el VALOR EVALUADO (calcTotales().total ya lo es).
  // Devuelve { requiere, motivos }.
  requiereAprobacion(input, policy) {
    const pol = { ...this.POLICY_DEFAULT, ...(policy || {}) };
    const total = Number(input?.total || 0);
    const desc = Number(input?.descuentoPct || 0);
    const motivos = [];
    if (pol.descuentoMaxPct != null && desc > Number(pol.descuentoMaxPct)) {
      motivos.push(`Descuento ${desc}% supera el máximo para envío directo (${pol.descuentoMaxPct}%).`);
    }
    // Descuento POR LÍNEA (auditoría A10): antes no contaba para el umbral y
    // además REDUCE el total — 40% en cada línea con total $4,900 salía sin
    // aprobación. Manda el MAYOR descuento (global o de línea).
    const maxLinea = (Array.isArray(input?.items) ? input.items : [])
      .reduce((m, it) => Math.max(m, Number(it?.desc || 0)), 0);
    if (pol.descuentoMaxPct != null && maxLinea > Number(pol.descuentoMaxPct)) {
      motivos.push(`Hay renglones con ${maxLinea}% de descuento — supera el máximo para envío directo (${pol.descuentoMaxPct}%).`);
    }
    if (pol.totalMax != null && total > Number(pol.totalMax)) {
      // Con alquiler el motivo enseña la CUENTA, no solo el veredicto: si no,
      // el vendedor ve un número que no aparece por ninguna parte del documento.
      const meses = Number(input?.mesesComputables || 0);
      const mensual = Number(input?.alquilerMensual || 0);
      const detalle = meses > 0 && mensual > 0
        ? ` (${FMT.money(Number(input?.ventaTotal || 0))} de venta + ${FMT.money(mensual)}/mes × ${meses} ${meses === 1 ? 'mes' : 'meses'})`
        : '';
      motivos.push(
        `El total ${FMT.money(total)}${detalle} supera el máximo para envío directo (${FMT.money(Number(pol.totalMax))}).`);
    }
    return { requiere: motivos.length > 0, motivos };
  },

  /**
   * Agrupa los renglones de una cotización POR EQUIPO.
   *
   * Reporte de la jefa de taller (2026-08-19), punto 4: la cotización que ve el
   * cliente era un solo bloque plano, con el contexto del radio repetido en
   * gris debajo de cada fila. Debe verse separada por modelo de radio y
   * trabajos realizados, parecido a lo que el técnico ve al capturarla.
   *
   * Tres orígenes de agrupación, en orden de confianza:
   *   1. `it.equipo` (objeto) — lo estampa cotizar-orden.js desde 2026-08-20.
   *   2. `it.spec` (string "Equipo: Serie … · Modelo …") — cotizaciones ya
   *      emitidas antes de ese cambio. Se agrupa por el string tal cual, que
   *      es exactamente lo que ya hacía el correo de aprobación.
   *   3. Sin ninguno (cotización comercial) — un único grupo sin encabezado.
   *
   * Conserva el orden de aparición: el técnico captura equipo por equipo y ese
   * orden es el que tiene sentido para quien lee.
   * @param {Array} items
   * @returns {Array<{key:string, equipo:Object|null, spec:string, items:Array}>}
   */
  agruparPorEquipo(items) {
    const grupos = new Map();
    (items || []).forEach((it) => {
      const eq = it.equipo || null;
      // La clave prefiere el id del equipo, pero cae al par serial+modelo: los
      // equipos de órdenes viejas no siempre traen id (ver prepararEquipos).
      const key = eq
        ? `eq:${eq.id || `${eq.serial || ''}|${eq.modelo || ''}`}`
        : `spec:${String(it.spec || '').trim()}`;
      if (!grupos.has(key)) {
        grupos.set(key, { key, equipo: eq, spec: String(it.spec || '').trim(), items: [] });
      }
      grupos.get(key).items.push(it);
    });
    return [...grupos.values()];
  },

  /**
   * Título del grupo tal como lo ve EL CLIENTE: modelo del radio y su serie.
   * Sin SKU ni piezas — el desglose interno no es asunto suyo.
   * Devuelve '' cuando no hay equipo identificable (cotización comercial),
   * y entonces el grupo se pinta sin encabezado, como siempre.
   */
  tituloEquipo(grupo) {
    const eq = grupo?.equipo;
    if (eq) {
      const modelo = String(eq.modelo || '').trim();
      const serial = String(eq.serial || '').trim();
      const marca  = String(eq.marca  || '').trim();
      const nombre = [marca, modelo].filter(Boolean).join(' ') || 'Equipo';
      return serial ? `${nombre} · Serie ${serial}` : nombre;
    }
    // Legacy: `spec` ya viene con el texto "Equipo: Serie X · Modelo Y ·
    // Intervención: …". Se corta la intervención, que va aparte.
    const spec = String(grupo?.spec || '').trim();
    if (!spec) return '';
    return spec.split(' · Intervención:')[0].replace(/^Equipo:\s*/, '');
  },

  /** Trabajo realizado en ese equipo, para mostrárselo al cliente. */
  trabajoEquipo(grupo) {
    if (grupo?.equipo) return String(grupo.equipo.intervencion || '').trim();
    const m = String(grupo?.spec || '').match(/ · Intervención:\s*([\s\S]*)$/);
    return m ? m[1].trim() : '';
  },

  /**
   * Cuerpo de la tabla de renglones del documento que ve EL CLIENTE, agrupado
   * por equipo. Lo comparten la vista pública (verify/cotizacion.html) y la
   * impresión/PDF (cotizaciones/imprimir-cotizacion.html) — eran dos copias del
   * mismo `<tbody>` y ya habían empezado a divergir.
   *
   * Cada grupo abre con una fila de encabezado: modelo y serie del radio, y
   * debajo el trabajo realizado. Antes ese contexto se repetía en gris bajo
   * CADA fila (`cq-spec`), que es lo que hacía que la cotización se leyera como
   * un bloque plano. Dentro del grupo, el renglón ya no repite el equipo.
   *
   * Deliberadamente NO incluye el resumen interno de piezas: ese es el conteo
   * que va a bodega para reponer inventario, no algo que el cliente deba ver.
   *
   * @param {Array} items
   * @param {{hayAlquiler:boolean}} opts
   * @returns {string} HTML de las filas (sin <tbody>)
   */
  filasPorEquipoHtml(items, { hayAlquiler = false } = {}) {
    const esc = (v) => FMT.esc(v);
    const grupos = this.agruparPorEquipo(items);
    // Columnas: # · Descripción · Cant. · [Modalidad] · Precio unit. · Total
    const cols = hayAlquiler ? 6 : 5;
    let n = 0;

    return grupos.map((g) => {
      const titulo = this.tituloEquipo(g);
      const trabajo = this.trabajoEquipo(g);
      // Un grupo sin equipo identificable (cotización comercial) se pinta sin
      // encabezado: exactamente como se veía antes de este cambio.
      const header = titulo ? `
        <tr class="cq-grp">
          <td colspan="${cols}">
            <div class="cq-grp-t">${esc(titulo)}</div>
            ${trabajo ? `<div class="cq-grp-w"><b>Trabajo realizado:</b> ${esc(trabajo)}</div>` : ''}
          </td>
        </tr>` : '';

      const filas = g.items.map((it) => {
        const esAlq = this.esAlquiler(it);
        n++;
        return `
        <tr>
          <td class="idx">${String(n).padStart(2, '0')}</td>
          <td>
            <div class="cq-desc">${esc(it.nombre)}</div>
            ${it.modelo ? `<div class="cq-spec"><span class="cq-model">${esc(it.modelo)}</span></div>` : ''}
          </td>
          <td class="qty">${esc(it.cant)}</td>
          ${hayAlquiler ? `<td class="c cq-mod">${esAlq ? 'Alquiler' : 'Venta'}</td>` : ''}
          <td class="num r">${FMT.money(it.precio)}${esAlq ? '<span class="cq-per">/mes</span>' : ''}</td>
          <td class="num r">${FMT.money(this.lineTotal(it))}${esAlq ? '<span class="cq-per">/mes</span>' : ''}</td>
        </tr>`;
      }).join('');

      return header + filas;
    }).join('');
  },

  // Atajo: calcula totales y evalúa la política en un paso.
  // Existe para que ningún llamador vuelva a armar el input a mano — olvidar
  // `items` fue justo el bug que hacía que el listado y el detalle ofrecieran
  // "Enviar al cliente" para un borrador que el editor ya había marcado.
  evaluarPolitica(cot, policy) {
    const t = this.calcTotales(cot);
    // Manda el MAYOR entre lo recalculado y el `total` que traiga el doc.
    // Recalcular es lo correcto cuando hay renglones —así entran el descuento
    // por línea y la proyección del alquiler—, pero un doc sin `items` (una
    // lectura parcial, un objeto armado a mano) recalcularía 0 y dejaría pasar
    // cualquier monto. Con el máximo, la política falla CERRADA en los dos
    // casos: nunca menos aprobaciones de las que tocan.
    const total = Math.max(t.total, Number(cot?.total || 0));
    const pol = this.requiereAprobacion({
      total,
      descuentoPct: cot?.descuentoPct,
      items: cot?.items,
      mesesComputables: t.mesesComputables,
      alquilerMensual: t.alquiler.total,
      ventaTotal: t.venta.total,
    }, policy);
    return { ...pol, totales: t };
  },
};
