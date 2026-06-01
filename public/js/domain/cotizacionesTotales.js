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
};
