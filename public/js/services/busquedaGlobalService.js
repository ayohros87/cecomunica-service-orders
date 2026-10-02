/**
 * busquedaGlobalService.js — cross-collection search for the admin cmd-K palette.
 *
 * Searches the 5 most-used collections in parallel and returns grouped results:
 *  - clientes        (índice searchTokens; escaneo de respaldo)
 *  - ordenes         (via OrdenesService.searchOrders with searchTokens index)
 *  - contratos       (índice searchTokens; escaneo de respaldo)
 *  - cotizaciones    (escaneo: sus searchTokens aún no están en producción)
 *  - poc_devices     (escaneo: serial, unit_id, radio_name, sim)
 *  - equipos_pool    (rango por prefijo de serial_norm: una lectura por hit,
 *                     sin escaneo; auditoría de módulos 2026-09-30, 08 P5 —
 *                     bodega no encontraba un radio del pool con Ctrl+K)
 *
 * Índice primero (P2 auditoría UX 2026-09-28, §4.1 #14): clientes, contratos
 * y órdenes ya llevan `searchTokens` (prefijos de palabra / número completo /
 * sufijos de serial, según la colección) y un `array-contains` por token cuesta
 * ~60 lecturas en vez de 500. El escaneo de los 500 más recientes queda de
 * respaldo: documentos viejos sin tokens, un término que no tiene la forma
 * de los tokens, o el índice caído. Cotizaciones pasa a índice con la misma
 * llamada (_indexadoOEscaneo) cuando su trigger de tokens esté desplegado y
 * la colección rellenada.
 */
const BusquedaGlobalService = {

  MAX_PER_COLLECTION: 5,
  SCAN_LIMIT: 500,
  IDX_LIMIT: 60,

  _norm(s) {
    return (s || '').toString().toLowerCase()
      .normalize('NFD').replace(/\p{Diacritic}/gu, '').trim();
  },

  _match(text, q) {
    return this._norm(text).includes(q);
  },

  // Todas las palabras tecleadas, en cualquier orden, sobre cualquiera de los
  // campos (como EntityCombo.filtrar): "gamboa hotel" encuentra "Hotel Gamboa".
  _matchTodas(campos, q) {
    const heno = campos.map(c => this._norm(c)).join(' ');
    return q.split(/\s+/).filter(Boolean).every(w => heno.includes(w));
  },

  // Token con que se consulta el índice: el mismo tokenizador de quien lo
  // escribe (ClientesService.buildSearchTokens / ContratosService.buildSearchTokens):
  // prefijos de palabra de ≥2 letras; RUC, cédula y teléfono en dígitos.
  _tokenDe(q) {
    const digitos = q.replace(/\D/g, '');
    if (/^[\d\s.\-]+$/.test(q) && digitos.length >= 3) return digitos;
    return q.split(/[^a-z0-9]+/).filter(w => w.length >= 2)[0] || '';
  },

  // Índice primero; escaneo si el índice falla o no trae nada. `indexado`
  // devuelve hits ya mapeados (o [] si no hay token consultable).
  async _indexadoOEscaneo(nombre, indexado, escaneo) {
    try {
      const hits = await indexado();
      if (hits.length) return hits;
    } catch (e) { console.warn(`[busqueda] índice ${nombre}, cae al escaneo:`, e?.message || e); }
    return escaneo();
  },

  // Rol del usuario, síncrono: lo deja firebase-init en window.userRole; antes
  // de que llegue, la caché anónima de sesión. Solo decide DESTINOS y qué
  // colecciones vale la pena consultar — el piso de permisos es firestore.rules.
  _rol() {
    return window.userRole || (window.Sesion?.cacheAnonima?.()?.rol) || null;
  },
  // Mismo criterio que el guard de almacen/index.html (almacen-hoy.js):
  // operan admin/inventario, lee gerencia, y quien gestiona seriales.
  _puedeAbrirAlmacen(rol) {
    return ['administrador', 'inventario', 'gerente'].includes(rol)
      || (typeof canRole === 'function' && canRole(rol, 'gestionar-seriales'));
  },
  // Mismo criterio que el guard de clientes/centro.html (centro-core.js).
  _puedeAbrirCentro(rol) {
    return ['administrador', 'gerente', 'vendedor', 'recepcion', 'inventario', 'contabilidad'].includes(rol);
  },

  async searchAll(query) {
    const q = this._norm(query);
    if (q.length < 2) return { query, results: {} };

    // Colecciones que las reglas le niegan a este rol (bodega y contabilidad
    // no listan cotizaciones): el palette lo dice en vez de callar.
    const sinPermiso = [];
    const permiso = (nombre) => (e) => {
      if (e?.code === 'permission-denied') sinPermiso.push(nombre);
      else console.warn(`[busqueda] ${nombre}`, e);
      return [];
    };
    const [clientes, ordenes, contratos, cotizaciones, poc, pool] = await Promise.all([
      this._searchClientes(q).catch(permiso('clientes')),
      this._searchOrdenes(query).catch(permiso('ordenes')),
      this._searchContratos(q).catch(permiso('contratos')),
      this._searchCotizaciones(q).catch(permiso('cotizaciones')),
      this._searchPoc(q).catch(permiso('poc')),
      this._searchPool(query).catch(permiso('pool')),
    ]);

    return {
      query,
      results: { clientes, ordenes, contratos, cotizaciones, poc, pool },
      total: clientes.length + ordenes.length + contratos.length + cotizaciones.length + poc.length + pool.length,
      sinPermiso,
    };
  },

  // Pool de equipos por serial: el doc ID es el serial normalizado y el campo
  // serial_norm es el índice, así que un rango por prefijo cuesta lo que
  // devuelve (misma consulta que Almacén · Avanzado, EquiposPoolService
  // .buscarPorPrefijoSerial; aquí sin depender de que ese servicio esté
  // cargado). Solo para quien puede abrir Almacén: el resultado aterriza en
  // Existencias con la ficha del serial encima (?serial=, almacen-hoy.js).
  async _searchPool(query) {
    if (!this._puedeAbrirAlmacen(this._rol())) return [];
    const norm = (query || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    // Un serial lleva dígito; un nombre de cliente no — sin esto cada palabra
    // tecleada costaría una consulta al pool que no va a dar nada.
    if (norm.length < 4 || !/\d/.test(norm)) return [];
    const db = firebase.firestore();
    const snap = await db.collection('equipos_pool')
      .where('serial_norm', '>=', norm)
      .where('serial_norm', '<', norm + '')
      .limit(this.MAX_PER_COLLECTION).get();
    const labels = (window.EquiposPoolService && EquiposPoolService.ESTADO_LABELS) || {};
    return snap.docs.map(d => {
      const u = d.data() || {};
      const serial = u.serial || u.serial_norm || d.id;
      return {
        id: d.id,
        title: serial,
        subtitle: [u.modelo_label, labels[u.estado] || u.estado, u.asignacion?.cliente_nombre].filter(Boolean).join(' · '),
        link: `/almacen/index.html?tab=existencias&serial=${encodeURIComponent(serial)}`,
      };
    });
  },

  async _searchClientes(q) {
    const db = firebase.firestore();
    const pasa = (c) => c.deleted !== true &&
      this._matchTodas([c.nombre, c.empresa, c.email, c.correo, c.ruc, c.telefono, c.cedula], q);
    // El cliente abre en el Centro de gestión, su pantalla de trabajo y la
    // única entrada al mundo clientes desde el home (2026-09-03). Antes iba a
    // clientes/editar.html → redirección → ficha de solo lectura: dos cargas
    // para no llegar a donde se trabaja (auditoría 2026-09-30, 08 C6). Los
    // roles que el Centro no admite siguen a la ficha.
    const alCentro = this._puedeAbrirCentro(this._rol());
    const aHit = (d) => {
      const c = d.data();
      return {
        id: d.id,
        title: c.nombre || c.empresa || '(sin nombre)',
        subtitle: [c.email || c.correo, c.ruc, c.telefono].filter(Boolean).join(' · '),
        link: alCentro
          ? `/clientes/centro.html?id=${encodeURIComponent(d.id)}`
          : `/clientes/editar.html?id=${encodeURIComponent(d.id)}`,
      };
    };
    return this._indexadoOEscaneo('clientes', async () => {
      const tok = this._tokenDe(q);
      if (!tok) return [];
      // Mismo índice que ClientesService.searchByToken (array-contains + deleted).
      const snap = await db.collection('clientes')
        .where('searchTokens', 'array-contains', tok)
        .where('deleted', '==', false)
        .limit(this.IDX_LIMIT).get();
      return snap.docs.filter(d => pasa(d.data())).slice(0, this.MAX_PER_COLLECTION).map(aHit);
    }, async () => {
      const snap = await db.collection('clientes')
        .orderBy('updated_at', 'desc').limit(this.SCAN_LIMIT).get()
        .catch(() => db.collection('clientes').limit(this.SCAN_LIMIT).get());
      return snap.docs.filter(d => pasa(d.data())).slice(0, this.MAX_PER_COLLECTION).map(aHit);
    });
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
      link: `/ordenes/index.html?ids=${encodeURIComponent(o.ordenId)}`,
    }));
  },

  async _searchContratos(q) {
    const db = firebase.firestore();
    const pasa = (c) => c.deleted !== true &&
      this._matchTodas([c.contrato_id, c.cliente_nombre, c.clienteNombre], q);
    const aHit = (d) => {
      const c = d.data();
      return {
        id: d.id,
        title: c.contrato_id || d.id,
        subtitle: [c.cliente_nombre || c.clienteNombre, c.estado].filter(Boolean).join(' · '),
        link: `/contratos/index.html?buscar=${encodeURIComponent(c.contrato_id || d.id)}`,
      };
    };
    return this._indexadoOEscaneo('contratos', async () => {
      // Tokens del contrato: prefijos del nombre del cliente y el número
      // COMPLETO en minúsculas (ContratosService.buildSearchTokens). Con
      // dígitos en el término se prueba el número tal cual; un número a
      // medias no es token y cae al escaneo, que sí hace subcadena.
      const tok = /\d/.test(q) ? q.replace(/\s+/g, '') : this._tokenDe(q);
      if (!tok || tok.length < 2) return [];
      const snap = await db.collection('contratos')
        .where('searchTokens', 'array-contains', tok)
        .limit(this.IDX_LIMIT).get();
      return snap.docs.filter(d => pasa(d.data())).slice(0, this.MAX_PER_COLLECTION).map(aHit);
    }, async () => {
      const snap = await db.collection('contratos')
        .where('deleted', '!=', true)
        .orderBy('deleted')
        .orderBy('fecha_creacion', 'desc')
        .limit(this.SCAN_LIMIT)
        .get()
        .catch(() => db.collection('contratos').limit(this.SCAN_LIMIT).get());
      return snap.docs.filter(d => pasa(d.data())).slice(0, this.MAX_PER_COLLECTION).map(aHit);
    });
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
          this._match(c.cotizacion_id,  q) ||
          this._match(c.numero,         q)) {
        hits.push({
          id: d.id,
          title: c.cotizacion_id || c.numero || d.id,
          subtitle: [c.cliente_nombre || c.clienteNombre, c.estado].filter(Boolean).join(' · '),
          link: `/cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(d.id)}`,
        });
      }
    });
    return hits.slice(0, this.MAX_PER_COLLECTION);
  },

  // PoC busca por campo (serial, unit_id, sim…), no por docId: el enlace lleva
  // el campo que coincidió + su valor para que poc-list.js filtre, y el docId
  // para resaltar la fila exacta (auditoría UX 2026-09-28, P0 #5).
  _linkPoc(docId, p, q) {
    const campos = ['serial', 'unit_id', 'sim_number', 'sim_phone', 'ip', 'radio_name'];
    let campo = campos.find(c => this._match(p[c], q));
    if (!campo) campo = p.serial ? 'serial' : (p.unit_id ? 'unit_id' : 'serial');
    const valor = String(p[campo] ?? docId);
    return `/POC/index.html?focus=${encodeURIComponent(valor)}&campo=${encodeURIComponent(campo)}&id=${encodeURIComponent(docId)}`;
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
          this._match(p.sim_number, q) ||
          this._match(p.sim_phone,  q) ||
          this._match(p.ip,         q) ||
          this._match(p.cliente,    q)) {
        hits.push({
          id: d.id,
          title: p.radio_name || p.unit_id || p.serial || d.id,
          subtitle: [p.serial, p.sim_number, p.cliente].filter(Boolean).join(' · '),
          link: this._linkPoc(d.id, p, q),
        });
      }
    });
    return hits.slice(0, this.MAX_PER_COLLECTION);
  },
};

window.BusquedaGlobalService = BusquedaGlobalService;
