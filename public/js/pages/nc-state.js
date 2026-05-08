// @ts-nocheck
// Shared mutable state for nuevo-contrato page
window.NC = {
  listaClientes:    {},
  modelosDisponibles: [],
  previewDraft:     null,
  guardando:        false,
  currentUser:      null,

  escapeHtml(s = '') {
    return String(s).replace(/[&<>"'`=/]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;',
      "'": '&#39;', '/': '&#x2F;', '`': '&#x60;', '=': '&#x3D;'
    }[ch] || ch));
  }
};
