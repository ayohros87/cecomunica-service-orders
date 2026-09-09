// @ts-nocheck
/* =============================================================
   ¿Qué "papel" es el contrato? — ESPEJO EXACTO de
   functions/src/lib/documentoContrato.js. Los dos tienen que dar la MISMA
   respuesta: el trigger decide qué PDF adjunta el correo a activaciones y el
   navegador decide a qué página lleva "Ver documento". Si se separan,
   Recepción recibe un papel y el cliente firma otro (fue exactamente el
   reclamo del 2026-09-04).

   Si cambias la regla aquí, cámbiala allá — y corre
   functions/test/documentoContrato.test.js.
   ============================================================= */
window.DocumentoContrato = {
  // 2026-09-09 00:00 hora de Panamá (UTC-5). A partir del corte, TODO
  // contrato nuevo usa el documento v2, lo estampe quien lo estampe. Lo de
  // antes conserva el formato anterior: es el que el cliente tiene firmado.
  CORTE_V2: Date.parse('2026-09-09T00:00:00-05:00'),

  _millis(v) {
    if (!v) return 0;
    if (typeof v.toMillis === 'function') return v.toMillis();
    if (v instanceof Date) return v.getTime();
    if (typeof v === 'number') return v;
    if (typeof v.seconds === 'number') return v.seconds * 1000;
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  },

  esV2(c) {
    if (!c) return false;
    if (c.documento_version === 'v1') return false;
    if (c.documento_version === 'v2') return true;
    if (c.codigo_tipo === 'SERV' || c.tipo_contrato === 'Servicio') return true;
    if (c.firma_solicitud_id || c.firmado_tipo === 'digital') return true;
    return this._millis(c.fecha_creacion) >= this.CORTE_V2;
  },

  // A dónde lleva "Ver documento" desde cualquier lista.
  urlDocumento(docId, c, { base = '' } = {}) {
    const pag = this.esV2(c) ? 'documento.html' : 'imprimir-contrato.html';
    return `${base}${pag}?id=${encodeURIComponent(docId)}`;
  },

  // Etiqueta para la columna "Papel" del archivo.
  papel(c) { return this.esV2(c) ? 'v2' : 'clásico'; },
};
