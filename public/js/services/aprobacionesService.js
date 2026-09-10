// Fuente compartida del home y la bandeja. Solo aprobación comercial:
// firma del cliente, validación del firmante y bodega tienen otras colas.
window.AprobacionesService = {
  _filtros(tipo) {
    if (!['gestiones', 'contratos'].includes(tipo)) throw new Error('Cola desconocida');
    const filtros = [['estado', '==', 'pendiente_aprobacion']];
    // Administración y gerencia aprueban CUALQUIER gestión — es lo que dicen
    // las reglas (esAprobacionGestion) y no había motivo para que la cola de
    // gerencia escondiera los reemplazos. Desde 2026-09-10 además pasan por
    // aquí TODOS, no solo la excepción de equipo propio sin garantía, así que
    // esconderlos dejaba media cola invisible para media aprobación.
    return filtros;
  },

  _query(tipo) {
    // La lista usa el índice de estado existente. Filtrar tipo en navegador
    // evita exigir un índice compuesto nuevo para la bandeja de gerencia.
    return this._filtros(tipo).reduce((q, f) => q.where(...f), firebase.firestore().collection(tipo));
  },

  async contar(tipo) {
    const filtros = this._filtros(tipo);
    if (window.FbAgg?.disponible) {
      try {
        const [total, borrados] = await Promise.all([
          window.FbAgg.count(tipo, filtros),
          window.FbAgg.count(tipo, [...filtros, ['deleted', '==', true]]),
        ]);
        return Math.max(0, total - borrados);
      } catch (e) { console.warn('[aprobaciones] conteo alternativo:', e?.code || e); }
    }
    // Sin agregados, recorrer SOLO los pendientes, por páginas. No presentar
    // el límite de una primera página como si fuera el total de aprobaciones.
    let total = 0, cursor = null;
    do {
      const pagina = await this.listar(tipo, { cursor });
      total += pagina.docs.length;
      cursor = pagina.cursor;
    } while (cursor);
    return total;
  },

  async listar(tipo, { cursor = null, limit = 50 } = {}) {
    let q = this._query(tipo).orderBy(firebase.firestore.FieldPath.documentId());
    if (cursor) q = q.startAfter(cursor);
    // No confundir un resultado viejo de IndexedDB con una cola vacía/actual.
    const snap = await q.limit(limit).get({ source: 'server' });
    return {
      docs: snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(d => d.deleted !== true),
      cursor: snap.size === limit ? snap.docs[snap.docs.length - 1] : null,
    };
  },

  enlace(tipo, registro) {
    if (!registro.cliente_id) return null;
    const params = new URLSearchParams({
      id: registro.cliente_id,
      [tipo === 'gestiones' ? 'g' : 'contrato']: registro.id,
      aprobaciones: tipo,
    });
    return `?${params}`;
  },

  invalidarHome() {
    try {
      Object.keys(sessionStorage).filter(k => k.startsWith('ccHomeSignals:'))
        .forEach(k => sessionStorage.removeItem(k));
    } catch (e) { /* El home también revalida estas dos señales al volver. */ }
  },
};
