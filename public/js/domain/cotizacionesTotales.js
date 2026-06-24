// Cotizaciones — totales y helpers de fecha (puros, sin DOM ni Firestore)
// API: CotizacionTotales.{lineTotal, calcTotales, cuenta, addDays, validezVence}
window.CotizacionTotales = {
  // Total de un renglón: cant * precio * (1 - desc/100). Redondea a 2 dec.
  lineTotal(it) {
    const bruto = Number(it?.cant || 0) * Number(it?.precio || 0);
    const neto = bruto * (1 - Number(it?.desc || 0) / 100);
    return FMT.round2(neto);
  },

  // Totales completos de una cotización: subtotal, descuento global, ITBMS y total.
  calcTotales(cot) {
    const items = Array.isArray(cot?.items) ? cot.items : [];
    const subtotal = FMT.round2(items.reduce((s, it) => s + this.lineTotal(it), 0));
    const descPct = Number(cot?.descuentoPct || 0);
    const itbmsPct = Number(cot?.itbmsPct || 0);
    const descGlobal = FMT.round2(subtotal * descPct / 100);
    const base = FMT.round2(subtotal - descGlobal);
    const itbms = FMT.round2(base * itbmsPct / 100);
    const total = FMT.round2(base + itbms);
    return { subtotal, descGlobal, base, itbms, total };
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

  // ¿La cotización excede la política de envío directo? input: { total, descuentoPct }.
  // Devuelve { requiere: bool, motivos: [string] } para poder explicar el porqué en UI.
  requiereAprobacion(input, policy) {
    const pol = { ...this.POLICY_DEFAULT, ...(policy || {}) };
    const total = Number(input?.total || 0);
    const desc = Number(input?.descuentoPct || 0);
    const motivos = [];
    if (pol.descuentoMaxPct != null && desc > Number(pol.descuentoMaxPct)) {
      motivos.push(`Descuento ${desc}% supera el máximo para envío directo (${pol.descuentoMaxPct}%).`);
    }
    if (pol.totalMax != null && total > Number(pol.totalMax)) {
      motivos.push(`El total ${FMT.money(total)} supera el máximo para envío directo (${FMT.money(Number(pol.totalMax))}).`);
    }
    return { requiere: motivos.length > 0, motivos };
  },
};
