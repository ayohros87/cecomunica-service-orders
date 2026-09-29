// Bandeja global de administración/gerencia, independiente del directorio.
//
// 2026-09-29 (Alberto: "no sé si deberían ser dos alertas separadas… esos
// cuadrados no se ven bien"): UNA sola bandeja con el kit del home
// (js/ui/bandeja.js), no dos pestañas con conteo. Gestiones y contratos
// pendientes van mezclados en una lista, los que más días llevan esperando
// arriba, con chip de tipo, cliente, antigüedad y "Revisar". El deep-link
// ?aprobaciones=gestiones|contratos (correos) sigue vivo como filtro.
window.CentroAprobaciones = {
  rol: null,
  filtro: null,          // 'gestiones' | 'contratos' | null (todas)
  _version: 0,
  _items: [],
  _cursores: { gestiones: null, contratos: null },
  _verTodo: false,
  MAX_VISIBLES: 5,

  init(rol) {
    this.rol = rol;
    this.mount = document.getElementById('cgAprobaciones');
    if (!this.mount || !['administrador', 'gerente'].includes(rol)) return;
    this.mount.classList.remove('hidden');
    this.mount.addEventListener('click', e => {
      if (e.target.closest('[data-aprobaciones-refresh]')) { e.preventDefault(); this.refrescar(); return; }
      if (e.target.closest('[data-aprobaciones-mas]')) { this._verTodo = true; this.pintar(); return; }
      if (e.target.closest('[data-aprobaciones-menos]')) { this._verTodo = false; this.pintar(); return; }
      if (e.target.closest('[data-aprobaciones-cargar]')) { this.cargar(false); return; }
      const f = e.target.closest('[data-aprobaciones-filtro]');
      if (f) { this.filtrar(f.dataset.aprobacionesFiltro || null); }
    });
    const tipo = new URLSearchParams(location.search).get('aprobaciones');
    if (['gestiones', 'contratos'].includes(tipo)) this.filtro = tipo;
    this.refrescar();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !document.getElementById('vistaLista').classList.contains('hidden')) this.refrescar();
    });
  },

  // Compat con los deep-links viejos que llamaban seleccionar(tipo).
  seleccionar(tipo) { this.filtrar(['gestiones', 'contratos'].includes(tipo) ? tipo : null); },

  filtrar(tipo) {
    this.filtro = tipo;
    const url = new URL(location.href);
    if (tipo) url.searchParams.set('aprobaciones', tipo); else url.searchParams.delete('aprobaciones');
    history.replaceState({}, '', url);
    this.pintar();
  },

  async refrescar() {
    if (!this.mount || !['administrador', 'gerente'].includes(this.rol)) return;
    window.AprobacionesService.invalidarHome();
    await this.cargar(true);
  },

  // Trae UNA página de cada cola (gestiones y contratos) y las mezcla.
  async cargar(reset) {
    const version = reset ? ++this._version : this._version;
    if (reset) { this._items = []; this._cursores = { gestiones: null, contratos: null }; }
    this._cargando = true;
    this._error = false;
    this.pintar();
    try {
      await Promise.all(['gestiones', 'contratos'].map(async tipo => {
        // En la primera carga se piden las dos; en "cargar más" solo las que
        // todavía tienen cursor.
        if (!reset && !this._cursores[tipo]) return;
        let pagina;
        let cursor = this._cursores[tipo];
        // Una página de documentos eliminados no debe parecer el fin de la cola.
        do {
          pagina = await window.AprobacionesService.listar(tipo, { rol: this.rol, cursor });
          if (version !== this._version) return;
          cursor = pagina.cursor;
        } while (!pagina.docs.length && cursor);
        this._cursores[tipo] = cursor;
        this._items.push(...pagina.docs.map(r => this._item(tipo, r)));
      }));
    } catch (e) {
      if (version !== this._version) return;
      this._error = true;
    } finally {
      if (version === this._version) { this._cargando = false; this.pintar(); }
    }
  },

  _item(tipo, r) {
    const esGestion = tipo === 'gestiones';
    const clase = esGestion ? GestionesService.tipoLabel(r.tipo)
      : (r.accion === 'Renovación' ? 'Renovación' : 'Contrato nuevo');
    const fecha = esGestion ? (r.fecha_solicitud || r.created_at) : (r.fecha_creacion || r.created_at);
    const ms = fecha?.toDate ? fecha.toDate().getTime() : (fecha ? new Date(fecha).getTime() : null);
    return {
      tipo, id: r.id,
      referencia: esGestion ? r.id : (r.contrato_id || r.id),
      cliente: r.cliente_nombre || 'Cliente sin nombre',
      clase,
      // Gestión = aviso (alguien la propuso y espera); contrato = info.
      tono: esGestion ? 'aviso' : 'info',
      at: ms,
      enlace: window.AprobacionesService.enlace(tipo, r),
      detalle: esGestion
        ? [r.solicitante_email ? `de ${r.solicitante_email.split('@')[0]}` : '', r.items?.length ? `${r.items.length} serial(es)` : '']
        : [r.equipos?.length ? `${r.equipos.reduce((s, e) => s + (Number(e.cantidad) || 0), 0)} equipo(s)` : '',
           r.total_mensual ? `$${Number(r.total_mensual).toFixed(2)}/mes` : ''],
    };
  },

  pintar() {
    if (!this.mount) return;
    const B = window.Bandeja;
    const esc = (B && B.esc) || window.Centro.esc;
    const todos = this._items.slice().sort((a, b) => (a.at || Infinity) - (b.at || Infinity)); // más viejo arriba
    const nG = todos.filter(x => x.tipo === 'gestiones').length;
    const nC = todos.length - nG;
    const lista = this.filtro ? todos.filter(x => x.tipo === this.filtro) : todos;
    const hayMasServidor = Object.values(this._cursores).some(Boolean);
    const vis = this._verTodo ? lista : lista.slice(0, this.MAX_VISIBLES);

    const filtroBtn = (tipo, label, n) => `<button type="button" class="bj-cta bj-cta--plano${this.filtro === tipo ? ' is-on' : ''}"
        data-aprobaciones-filtro="${tipo || ''}" aria-pressed="${this.filtro === tipo}">${esc(label)}${n != null ? ` <span class="bj-n">${n}</span>` : ''}</button>`;
    const filtros = (nG && nC) ? `<div class="cg-aprob-filtros">
        ${filtroBtn(null, 'Todas', null)}${filtroBtn('gestiones', 'Gestiones', nG)}${filtroBtn('contratos', 'Contratos', nC)}
      </div>` : (this.filtro ? `<div class="cg-aprob-filtros">${filtroBtn(null, 'Ver todas', null)}</div>` : '');

    const filas = vis.map(x => B
      ? B.fila({
          chip: x.clase, tono: x.tono,
          txt: `<b>${esc(x.cliente)}</b> <span class="bj-id">${esc(x.referencia)}</span>${x.detalle.filter(Boolean).length ? ' · ' + x.detalle.filter(Boolean).map(esc).join(' · ') : ''}`,
          at: x.at, clase: 'cola',
          ctaHtml: x.enlace ? B.cta({ href: x.enlace, label: 'Revisar', plano: true })
            : `<span class="bj-tag bj-chip--malo" title="El registro no tiene cliente vinculado">Sin cliente</span>`,
          data: { tipo: x.tipo, id: x.id },
        })
      : `<div class="cg-aprobacion-row"><div><b>${esc(x.cliente)}</b><span>${esc(x.referencia)} · ${esc(x.clase)}</span></div>
           ${x.enlace ? `<a class="btn btn-ghost" href="${esc(x.enlace)}">Revisar</a>` : ''}</div>`).join('');

    let cuerpo;
    if (this._cargando && !todos.length) cuerpo = `<div class="bj-vacio">Cargando pendientes…</div>`;
    else if (this._error && !todos.length) cuerpo = `<div class="bj-vacio">No se pudieron cargar los pendientes. <a href="#" data-aprobaciones-refresh>Reintentar</a></div>`;
    else if (!lista.length) cuerpo = `<div class="bj-vacio">${this.filtro ? `No hay ${this.filtro} pendientes por aprobar.` : 'Nada pendiente por aprobar. Todo al día.'}</div>`;
    else cuerpo = filas;

    const pie = [];
    if (lista.length > this.MAX_VISIBLES && !this._verTodo) pie.push(`<button type="button" class="bj-cta bj-cta--plano" data-aprobaciones-mas>Ver ${lista.length - this.MAX_VISIBLES} más</button>`);
    if (this._verTodo && lista.length > this.MAX_VISIBLES) pie.push(`<button type="button" class="bj-cta bj-cta--plano" data-aprobaciones-menos>Ver menos</button>`);
    if (hayMasServidor && this._verTodo) pie.push(`<button type="button" class="bj-cta bj-cta--plano" data-aprobaciones-cargar${this._cargando ? ' disabled' : ''}>Cargar más pendientes</button>`);

    const n = this._cargando && !todos.length ? '…' : String(todos.length);
    this.mount.innerHTML = `
      <div class="bj-panel cg-aprob">
        <div class="bj-panel-h">Pendientes por aprobar <span class="bj-n" title="${esc(`${nG} gestión(es) y ${nC} contrato(s)`)}">${esc(n)}</span>
          ${filtros}
          <a href="#" data-aprobaciones-refresh title="Volver a consultar">${this._cargando ? 'Actualizando…' : 'Actualizar'}</a>
        </div>
        ${cuerpo}
        ${pie.length ? `<div class="bj-pie">${pie.join(' · ')}</div>` : ''}
      </div>`;
    if (window.lucide?.createIcons) { try { lucide.createIcons({ root: this.mount }); } catch (_) {} }
  },

  // Compat: algunas pruebas y páginas viejas llamaban fila(tipo, r) directo.
  fila(tipo, r) {
    const x = this._item(tipo, r);
    const esc = window.Centro.esc;
    return `<div class="cg-aprobacion-row"><div><b>${esc(x.cliente)}</b>
        <span>${esc(x.referencia)} · ${esc(x.clase)}</span></div>
      ${x.enlace ? `<a class="btn btn-ghost" href="${esc(x.enlace)}">Revisar</a>` : '<span class="cg-aprobacion-error">Sin cliente vinculado</span>'}
    </div>`;
  },
};
