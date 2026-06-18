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
  // Devuelve además los campos de "Otros conceptos" con fallback: un contrato SIN
  // conceptos queda con cargos=[], cargos*=0, totalMensual=primerPago=totalConITBMS,
  // tieneCargos=false → los lectores que condicionan en tieneCargos se ven igual que hoy.
  fromDoc(c) {
    const tieneNuevos = typeof c.itbms_aplica !== 'undefined';
    const subtotal = FMT.round2(Number(c.subtotal ?? c.total ?? 0));
    const itbmsPorc = Number(c.itbms_porcentaje ?? FMT.ITBMS_RATE);
    let base;
    if (tieneNuevos) {
      const itbmsAplica = Boolean(c.itbms_aplica);
      const itbmsMonto = Number(c.itbms_monto ?? 0);
      const totalConITBMS = Number(c.total_con_itbms ?? subtotal + itbmsMonto);
      const itbmsLabel = itbmsAplica ? `ITBMS (${FMT.round2(itbmsPorc * 100)}%)` : 'ITBMS EXENTO';
      base = { subtotal, itbmsAplica, itbmsPorc, itbmsMonto, totalConITBMS, itbmsLabel };
    } else {
      // Legacy docs: no itbms_aplica field — assume 7% applied
      base = this.compute(subtotal, true, itbmsPorc);
    }
    // Otros conceptos (cargos)
    const cargos            = Array.isArray(c.cargos) ? c.cargos : [];
    const cargosRecurrente  = FMT.round2(Number(c.cargos_recurrente ?? 0));
    const cargosUnico       = FMT.round2(Number(c.cargos_unico ?? 0));
    const equiposSub        = FMT.round2(Number(c.subtotal_equipos ?? base.subtotal));
    const totalMensual      = base.totalConITBMS;
    const primerPago        = FMT.round2(Number(c.primer_pago ?? base.totalConITBMS));
    return {
      ...base,
      cargos, cargosRecurrente, cargosUnico, equiposSub, totalMensual, primerPago,
      tieneCargos: cargos.length > 0 || cargosRecurrente > 0 || cargosUnico > 0,
      tieneCargosUnicos: cargosUnico > 0,
    };
  }
};
