// @ts-nocheck
// Validación del representante legal al confeccionar contratos — lógica PURA.
//
// El problema (Zuleika, 2026-09-03): contratos confeccionados y luego ANULADOS
// porque el representante legal registrado en la ficha ya no era el vigente.
// La vista previa del contrato ahora exige marcar que se validó con el
// cliente, y esta lógica arma la línea de contexto que hace útil ese check:
// cuándo fue la última validación o el último cambio registrado en la ficha.
//
// Fuentes de datos (las consultas viven en nc-preview; aquí solo se razona):
//   · cliente.representante_validacion — {valor, cedula, por_uid, por_email, at}
//     estampado por nc-guardar cada vez que un vendedor marca el check.
//   · clientes/{id}/historial — subcolección del trigger onClienteHistorial
//     (docs {tipo, campos[], por_email, at}, existe desde 2026-09-02).
window.RepValidacion = {
  CAMPOS: ['representante', 'representante_cedula'],

  _norm(s) { return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase(); },

  // `at` llega como Timestamp de Firestore (toMillis) o como ms en los tests.
  _ms(v) {
    if (!v) return null;
    if (typeof v.toMillis === 'function') return v.toMillis();
    const n = Number(v);
    return isFinite(n) && n > 0 ? n : null;
  },

  // Último evento del historial de la ficha que tocó al representante.
  // Espera los docs en orden at desc (así los trae la consulta).
  ultimoCambio(historialDocs) {
    for (const d of (historialDocs || [])) {
      if (!d || d.tipo !== 'edicion') continue;
      const campos = Array.isArray(d.campos) ? d.campos : [];
      if (!campos.some(c => this.CAMPOS.includes(c))) continue;
      return { atMs: this._ms(d.at), por_email: d.por_email || null };
    }
    return null;
  },

  // Última validación estampada en la ficha — solo cuenta si validó EL MISMO
  // nombre que está registrado hoy: si el representante cambió después, esa
  // validación ya no dice nada del valor actual.
  ultimaValidacion(cliente) {
    const v = cliente && cliente.representante_validacion;
    if (!v) return null;
    if (this._norm(v.valor) !== this._norm(cliente.representante)) return null;
    return { atMs: this._ms(v.at), por_email: v.por_email || null };
  },

  haceTexto(atMs, ahoraMs) {
    if (!atMs) return '';
    const dias = Math.floor((ahoraMs - atMs) / 86400000);
    if (dias <= 0) return 'hoy';
    if (dias === 1) return 'ayer';
    if (dias < 60) return `hace ${dias} días`;
    const meses = Math.floor(dias / 30);
    if (meses < 24) return `hace ${meses} meses`;
    return `hace ${Math.floor(meses / 12)} años`;
  },

  // La línea de contexto de la vista previa. La validación vigente manda;
  // sin ella, el último cambio registrado orienta; sin nada, se dice claro
  // que nadie lo ha validado nunca.
  resumen(cliente, historialDocs, ahoraMs) {
    const val = this.ultimaValidacion(cliente);
    if (val && val.atMs) {
      return {
        tono: 'ok',
        texto: `Validado por última vez ${this.haceTexto(val.atMs, ahoraMs)}`
          + (val.por_email ? ` (${val.por_email})` : '') + '.',
      };
    }
    const cam = this.ultimoCambio(historialDocs);
    if (cam && cam.atMs) {
      return {
        tono: 'info',
        texto: `Último cambio en la ficha: ${this.haceTexto(cam.atMs, ahoraMs)}`
          + (cam.por_email ? ` (${cam.por_email})` : '')
          + '. Nadie lo ha validado desde entonces.',
      };
    }
    return { tono: 'info', texto: 'Sin validaciones previas registradas — confírmalo con el cliente.' };
  },

  // El objeto que viaja al contrato y a la ficha cuando el vendedor marca el
  // check. `at` lo estampa quien escribe (new Date en el contrato,
  // serverTimestamp en la ficha).
  construir(cliente, user) {
    return {
      valor: ((cliente && cliente.representante) || '').trim(),
      cedula: ((cliente && cliente.representante_cedula) || '').trim(),
      por_uid: (user && user.uid) || null,
      por_email: (user && user.email) || null,
    };
  },
};
