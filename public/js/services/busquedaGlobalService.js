/**
 * busquedaGlobalService.js — cross-collection search for the admin cmd-K palette.
 *
 * Searches the 5 most-used collections in parallel and returns grouped results:
 *  - clientes        (nombre, email, ruc, telefono)
 *  - ordenes         (via OrdenesService.searchOrders with searchTokens index)
 *  - contratos       (contrato_id, cliente_nombre)
 *  - cotizaciones    (id, cliente_nombre)
 *  - poc_devices     (serial, unit_id, radio_name, sim)
 *
 * For collections without searchTokens, falls back to scanning the most
 * recent 500 docs. Cubre el 95% de las búsquedas reales sin destruir el
 * quota (ver PLAN §13.1.1).
 */
const BusquedaGlobalService = {

  MAX_PER_COLLECTION: 5,
  SCAN_LIMIT: 500,

  _norm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  },

  _match(text, q) {
    return this._norm(text).includes(q);
  },

  async searchAll(query) {
    const q = this._norm(query);
    if (q.length < 2) return { query, results: {} };

    const [clientes, ordenes, contratos, cotizaciones, poc] = await Promise.all([
      this._searchClientes(q).catch(e => { console.warn('[busqueda] clientes', e); return []; }),
      this._searchOrdenes(query).catch(e => { console.warn('[busqueda] ordenes', e); return []; }),
      this._searchContratos(q).catch(e => { console.warn('[busqueda] contratos', e); return []; }),
      this._searchCotizaciones(q).catch(e => { console.warn('[busqueda] cotizaciones', e); return []; }),
      this._searchPoc(q).catch(e => { console.warn('[busqueda] poc', e); return []; }),
    ]);

    return {
      query,
      results: { clientes, ordenes, contratos, cotizaciones, poc },
      total: clientes.length + ordenes.length + contratos.length + cotizaciones.length + poc.length,
    };
  },

  async _searchClientes(q) {
    const db = firebase.firestore();
    const snap = await db.collection('clientes')
      .orderBy('updated_at', 'desc').limit(this.SCAN_LIMIT).get()
      .catch(() => db.collection('clientes').limit(this.SCAN_LIMIT).get());
    const hits = [];
    snap.forEach(d => {
      const c = d.data();
      if (this._match(c.nombre,   q) ||
          this._match(c.empresa,  q) ||
          this._match(c.email,    q) ||
          this._match(c.correo,   q) ||
          this._match(c.ruc,      q) ||
          this._match(c.telefono, q) ||
          this._match(c.cedula,   q)) {
        hits.push({
          id: d.id,
          title: c.nombre || c.empresa || '(sin nombre)',
          subtitle: [c.email || c.correo, c.ruc, c.telefono].filter(Boolean).join(' · '),
          link: `../clientes/editar.html?id=${encodeURIComponent(d.id)}`,
        });
      }
    });
    return hits.slice(0, this.MAX_PER_COLLECTION);
  },

  async _searchOrdenes(query) {
    // Indexed first via searchTokens (see ARQUITECTURA §5.6); fallback on
    // empty result handled by OrdenesService.searchOrders itself.
    if (typeof OrdenesService === 'undefined' || !OrdenesService.searchOrders) return [];
    const items = await OrdenesService.searchOrders({
      filtroOrden:  query,
      filtroCliente: query,
      filtroSerial:  query,
      quickSearch:   true,
    });
    return (items || []).slice(0, this.MAX_PER_COLLECTION).map(o => ({
      id: o.ordenId,
      title: o.numero_orden || o.ordenId,
      subtitle: [o.cliente_nombre || o.clienteNombre, o.estado_reparacion].filter(Boolean).join(' · '),
      link: `../ordenes/editar-orden.html?id=${encodeURIComponent(o.ordenId)}`,
    }));
  },

  async _searchContratos(q) {
    const db = firebase.firestore();
    const snap = await db.collection('contratos')
      .where('deleted', '!=', true)
      .orderBy('deleted')
      .orderBy('fecha_creacion', 'desc')
      .limit(this.SCAN_LIMIT)
      .get()
      .catch(() => db.collection('contratos').limit(this.SCAN_LIMIT).get());
    const hits = [];
    snap.forEach(d => {
      const c = d.data();
      if (this._match(c.contrato_id,    q) ||
          this._match(c.cliente_nombre, q) ||
          this._match(c.clienteNombre,  q)) {
        hits.push({
          id: d.id,
          title: c.contrato_id || d.id,
          subtitle: [c.cliente_nombre || c.clienteNombre, c.estado].filter(Boolean).join(' · '),
          link: `../contratos/editar-contrato.html?id=${encodeURIComponent(d.id)}`,
        });
      }
    });
    return hits.slice(0, this.MAX_PER_COLLECTION);
  },

  async _searchCotizaciones(q) {
    const db = firebase.firestore();
    const snap = await db.collection('cotizaciones')
      .orderBy('fecha_creacion', 'desc')
      .limit(this.SCAN_LIMIT).get();
    const hits = [];
    snap.forEach(d => {
      const c = d.data();
      if (c.deleted === true) return;
      if (this._match(d.id,             q) ||
          this._match(c.cliente_nombre, q) ||
          this._match(c.clienteNombre,  q) ||
          this._match(c.numero,         q)) {
        hits.push({
          id: d.id,
          title: c.numero || d.id,
          subtitle: [c.cliente_nombre || c.clienteNombre, c.estado].filter(Boolean).join(' · '),
          link: `../cotizaciones/editar-cotizacion.html?id=${encodeURIComponent(d.id)}`,
        });
      }
    });
    return hits.slice(0, this.MAX_PER_COLLECTION);
  },

  async _searchPoc(q) {
    const db = firebase.firestore();
    const snap = await db.collection('poc_devices')
      .orderBy('created_at', 'desc')
      .limit(this.SCAN_LIMIT).get()
      .catch(() => db.collection('poc_devices').limit(this.SCAN_LIMIT).get());
    const hits = [];
    snap.forEach(d => {
      const p = d.data();
      if (p.deleted === true) return;
      if (this._match(p.serial,     q) ||
          this._match(p.unit_id,    q) ||
          this._match(p.radio_name, q) ||
          this._match(p.sim,        q) ||
          this._match(p.telefono,   q) ||
          this._match(p.ip,         q) ||
          this._match(p.cliente,    q)) {
        hits.push({
          id: d.id,
          title: p.radio_name || p.unit_id || p.serial || d.id,
          subtitle: [p.serial, p.sim, p.cliente].filter(Boolean).join(' · '),
          link: `../POC/index.html?focus=${encodeURIComponent(d.id)}`,
        });
      }
    });
    return hits.slice(0, this.MAX_PER_COLLECTION);
  },
};

window.BusquedaGlobalService = BusquedaGlobalService;
