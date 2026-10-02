// @ts-nocheck
// Centro de gestión de clientes — Ficha 360.
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Ficha 360 ═════════ */

  volver({ push = true } = {}) {
    this._pararEscucha();
    this.cliente = null;
    document.getElementById('vistaFicha').classList.add('hidden');
    document.getElementById('vistaLista').classList.remove('hidden');
    const cola = window.CentroAprobaciones?.tipo;
    // El filtro de regularización sobrevive al ir y volver de una ficha.
    const qs = this.filtroReg ? '?filtro=regularizacion' : (cola ? `?aprobaciones=${cola}` : '');
    if (push) history.pushState({}, '', location.pathname + qs);
    window.CentroAprobaciones?.refrescar();
    if (!document.querySelector('#cgLista .cg-row')) this.cargarLista(true);
  },

  async abrir(clienteId, { push = true } = {}) {
    try {
      window.AprobacionesService?.invalidarHome();
      // Contratos, flota, catálogo y gestiones solo necesitan el id: se piden
      // AL MISMO TIEMPO que el cliente (2026-09-29). Antes esperaban a que
      // llegara el doc del cliente: un viaje entero de más antes de la ficha.
      const db = firebase.firestore();
      const enVuelo = Promise.all([
        db.collection('contratos').where('cliente_id', '==', clienteId).get(),
        EquiposPoolService.listarPorCliente(clienteId),
        // Catálogo → ModeloFamilia: el pareo equipo↔línea (tarifa, vencimiento,
        // Anexo A) se decide por familia N/R, no por texto.
        (window.ModelosService?.catalogo ? ModelosService.catalogo().catch(e => { console.warn('[centro] catálogo no disponible:', e?.message || e); return null; }) : null),
        GestionesService.listarPorCliente(clienteId).catch(e => {
          console.warn('[centro] gestiones no disponibles:', e?.message || e);
          return [];
        }),
        // Órdenes del cliente para la franja de contexto (auditoría de módulos
        // 2026-09-30, 08 P8): la ficha decía "11 equipos en taller" y no
        // enlazaba ninguna orden. El estado se filtra en el servidor: con
        // limit(80) a secas, un cliente con 106 órdenes (SEPROSA) perdía la
        // abierta más reciente. Igualdad + `in` se sirve mezclando índices de
        // un campo (sin compuesto); si falla, la ficha sigue.
        db.collection('ordenes_de_servicio').where('cliente_id', '==', clienteId)
          .where('estado_reparacion', 'in', ['POR ASIGNAR', 'RECIBIDO EN MOSTRADOR', 'ASIGNADO', 'COMPLETADO (EN OFICINA)']).limit(80).get()
          .catch(e => { console.warn('[centro] órdenes del cliente no disponibles:', e?.message || e); return null; }),
      ]);
      enVuelo.catch(() => {}); // si el cliente no existe, nadie espera esto
      const c = await ClientesService.getCliente(clienteId);
      if (!c || c.deleted) { Toast.show('Cliente no encontrado', 'bad'); return; }
      // Candado de cartera: un vendedor no abre clientes ajenos ni por deep-link.
      if (this.esVendedor() && c.vendedor_asignado !== this.uid) {
        Toast.show('Este cliente no está en tu cartera', 'bad');
        this.volver({ push: true });
        return;
      }
      this.cliente = c;
      if (push) history.pushState({}, '', `?id=${encodeURIComponent(clienteId)}`);
      document.getElementById('vistaLista').classList.add('hidden');
      document.getElementById('vistaFicha').classList.remove('hidden');
      window.scrollTo(0, 0);

      this._pintarEncabezado(c);

      // Skeletons mientras cargan contratos/flota/gestiones (la ficha antes
      // aparecía a saltos, sección por sección).
      const skel = (n, h) => Array.from({ length: n }, () =>
        `<div class="cg-skel" style="height:${h}px; margin-bottom:8px;"></div>`).join('');
      document.getElementById('fAhora').innerHTML = skel(1, 64);
      document.getElementById('fResumen').innerHTML = '';
      document.getElementById('fContratos').innerHTML = skel(3, 38);
      document.getElementById('fEquipos').innerHTML = skel(3, 38);
      document.getElementById('fGestiones').innerHTML = skel(2, 46);

      // Contratos + flota + gestiones ya venían en vuelo desde arriba. Las
      // gestiones NO tumban la ficha si fallan (p. ej. reglas aún sin
      // desplegar en un entorno): el cliente completo vale más que esa sección.
      const [conSnap, equipos, , gestiones, osSnap] = await enVuelo;
      this.contratos = this._mapContratos(conSnap);
      this.equipos = Array.isArray(equipos) ? equipos : [];
      this.gestiones = gestiones;
      const ABIERTAS = ['POR ASIGNAR', 'RECIBIDO EN MOSTRADOR', 'ASIGNADO', 'COMPLETADO (EN OFICINA)'];
      this.ordenesAbiertas = osSnap ? osSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        .filter(o => o.eliminado !== true && ABIERTAS.includes(String(o.estado_reparacion || '').toUpperCase()))
        .sort((a, b) => String(b.id).localeCompare(String(a.id))) : [];

      this.pintarKpis();
      this.pintarSenales();
      this.pintarAcciones();
      this.pintarContratos();
      this.pintarEquipos();
      this.pintarGestiones();
      this.armarMenu();
      // No bloquea la ficha: se pinta sola cuando llega (repinta "Ahora").
      this.ordenesPorDecidir = [];
      this._cargarOrdenesPorDecidir().catch(e => console.warn('[centro] ordenes por decidir:', e?.message || e));
      this._abrirBloques(clienteId);
      if (window.lucide?.createIcons) lucide.createIcons();
      if (this.cSel) {
        const cid = this.cSel; this.cSel = null;
        history.replaceState({}, '', `?id=${encodeURIComponent(clienteId)}`);
        if (this.contratos.some(x => x.id === cid)) this.verContrato(cid);
      }
      // Escucha en vivo: los triggers escriben el avance ~1-2s después de
      // cada acción y la página lo adivinaba con setTimeout — ahora el
      // expediente se repinta cuando el dato REAL llega.
      this._escucharGestiones(clienteId);
      this._escucharCliente(clienteId);
      // Con la persistencia multi-pestaña, la pestaña que abre el deep-link
      // del correo entra como SECUNDARIA: si la primaria está congelada por
      // el navegador, estos get() resuelven del caché de IndexedDB y la
      // ficha sale vieja hasta el F5 (reporte 2026-09-02). Si este pintado
      // salió del caché, se relee del servidor en background y se repinta.
      if (conSnap.metadata && conSnap.metadata.fromCache) this._revalidarFicha(clienteId);
      // Deep-link desde correo (?g=): aterrizar EN el expediente, no arriba
      // de la página (pedido 2026-08-27).
      if (this.gSel) {
        setTimeout(() => document.getElementById(`grow-${this.gSel}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 200);
      }
    } catch (e) { console.error(e); Toast.show('No se pudo abrir el cliente', 'bad'); }
  },

  _pintarEncabezado(c) {
    document.getElementById('fAvatar').textContent = this._iniciales(c.nombre);
    document.getElementById('fNombre').textContent = c.nombre || '(sin nombre)';
    // Meta en piezas (2026-09-28): en escritorio una línea con " · " (CSS);
    // en el teléfono cada pieza es una línea corta y el vendedor va sin dominio.
    const ident = [this._rucLegible(c), c.telefono || null].filter(Boolean);
    const [vUser, vDom] = String(c.vendedor_email || '').split('@');
    const meta = [
      ident.length ? `<span class="m">${this.esc(ident.join(' · '))}</span>` : '',
      c.email ? `<span class="m">${this.esc(c.email)}</span>` : '',
      c.vendedor_email ? `<span class="m">Vendedor: ${this.esc(vUser)}${vDom ? `<span class="dom">@${this.esc(vDom)}</span>` : ''}</span>` : '',
    ].filter(Boolean);
    document.getElementById('fMeta').innerHTML = meta.join('') || '—';
    this._pintarChipReg(c);
  },
});
