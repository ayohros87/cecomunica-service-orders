// Contract totals domain module — pure math, no DOM dependency
// API: ContractTotals.fromDoc(c)  ContractTotals.compute(subtotal, itbmsAplica, itbmsRate?)
// Both return { subtotal, itbmsAplica, itbmsPorc, itbmsMonto, totalConITBMS, itbmsLabel }
window.ContractTotals = {
  // Given raw values, compute the totals object
  compute(subtotal, itbmsAplica, itbmsRate = FMT.ITBMS_RATE) {
    const s = FMT.round2(Number(subtotal) || 0);
    const aplica = Boolean(itbmsAplica);
    const itbmsMonto = aplica ? FMT.round2(s * itbmsRate) : 0;
    const totalConITBMS = FMT.round2(s + itbmsMonto);
    const itbmsLabel = aplica ? `ITBMS (${FMT.round2(itbmsRate * 100)}%)` : 'ITBMS EXENTO';
    return { subtotal: s, itbmsAplica: aplica, itbmsPorc: itbmsRate, itbmsMonto, totalConITBMS, itbmsLabel };
  },

  // Normalize a persisted contract document (handles legacy field names + 7% fallback)
  fromDoc(c) {
    const tieneNuevos = typeof c.itbms_aplica !== 'undefined';
    const subtotal = FMT.round2(Number(c.subtotal ?? c.total ?? 0));
    const itbmsPorc = Number(c.itbms_porcentaje ?? FMT.ITBMS_RATE);
    if (tieneNuevos) {
      const itbmsAplica = Boolean(c.itbms_aplica);
      const itbmsMonto = Number(c.itbms_monto ?? 0);
      const totalConITBMS = Number(c.total_con_itbms ?? subtotal + itbmsMonto);
      const itbmsLabel = itbmsAplica ? `ITBMS (${FMT.round2(itbmsPorc * 100)}%)` : 'ITBMS EXENTO';
      return { subtotal, itbmsAplica, itbmsPorc, itbmsMonto, totalConITBMS, itbmsLabel };
    }
    // Legacy docs: no itbms_aplica field — assume 7% applied
    return this.compute(subtotal, true, itbmsPorc);
  }
};
