// Bandeja global de administración/gerencia, independiente del directorio.
window.CentroAprobaciones = {
  rol: null,
  tipo: null,
  cursor: null,
  _version: 0,
  _conteo: 0,

  init(rol) {
    this.rol = rol;
    this.mount = document.getElementById('cgAprobaciones');
    if (!this.mount || !['administrador', 'gerente'].includes(rol)) return;
    this.mount.classList.remove('hidden');
    this.mount.addEventListener('click', e => {
      const tab = e.target.closest('[data-aprobaciones]');
      if (tab) this.seleccionar(tab.dataset.aprobaciones);
      if (e.target.closest('[data-aprobaciones-refresh]')) this.refrescar();
      if (e.target.closest('[data-aprobaciones-mas]')) this.cargar(false);
    });
    const tipo = new URLSearchParams(location.search).get('aprobaciones');
    if (['gestiones', 'contratos'].includes(tipo)) this.tipo = tipo;
    this.refrescar();
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && !document.getElementById('vistaLista').classList.contains('hidden')) this.refrescar();
    });
  },

  async refrescar() {
    if (!this.mount || !['administrador', 'gerente'].includes(this.rol)) return;
    const version = ++this._conteo;
    window.AprobacionesService.invalidarHome();
    for (const tipo of ['gestiones', 'contratos']) {
      this.mount.querySelector(`[data-aprobaciones-count="${tipo}"]`).textContent = '…';
    }
    if (this.tipo) this.seleccionar(this.tipo, false);
    await Promise.all(['gestiones', 'contratos'].map(async tipo => {
      const el = this.mount.querySelector(`[data-aprobaciones-count="${tipo}"]`);
      try {
        const n = await window.AprobacionesService.contar(tipo, this.rol);
        if (version !== this._conteo) return;
        el.textContent = n.toLocaleString('es-PA');
        el.title = `${n} pendientes por aprobar`;
      } catch (e) {
        if (version !== this._conteo) return;
        el.textContent = '—';
        el.title = 'No se pudo consultar. Pulsa Actualizar para reintentar.';
      }
    }));
  },

  seleccionar(tipo, push = true) {
    if (!['gestiones', 'contratos'].includes(tipo)) return;
    this.tipo = tipo;
    this.mount.querySelectorAll('[data-aprobaciones]').forEach(btn => {
      const activo = btn.dataset.aprobaciones === tipo;
      btn.classList.toggle('is-on', activo);
      btn.setAttribute('aria-expanded', String(activo));
    });
    if (push) {
      const url = new URL(location.href);
      url.searchParams.set('aprobaciones', tipo);
      history.replaceState({}, '', url);
    }
    this.cargar(true);
  },

  async cargar(reset) {
    const tipo = this.tipo;
    const version = reset ? ++this._version : this._version;
    const lista = this.mount.querySelector('[data-aprobaciones-lista]');
    const mas = this.mount.querySelector('[data-aprobaciones-mas]');
    const mensaje = this.mount.querySelector('[data-aprobaciones-mensaje]');
    if (reset) { this.cursor = null; lista.innerHTML = ''; }
    mas.disabled = true;
    mensaje.textContent = 'Cargando pendientes…';
    try {
      let pagina;
      // Una página de documentos eliminados no debe parecer el fin de la cola.
      do {
        pagina = await window.AprobacionesService.listar(tipo, { rol: this.rol, cursor: this.cursor });
        if (version !== this._version) return;
        this.cursor = pagina.cursor;
      } while (!pagina.docs.length && this.cursor);
      lista.insertAdjacentHTML('beforeend', pagina.docs.map(r => this.fila(tipo, r)).join(''));
      mensaje.textContent = lista.children.length ? '' : `No hay ${tipo} pendientes por aprobar.`;
      mas.classList.toggle('hidden', !this.cursor);
    } catch (e) {
      if (version !== this._version) return;
      mensaje.textContent = 'No se pudieron cargar los pendientes. Pulsa Actualizar para reintentar.';
      mas.classList.add('hidden');
    } finally {
      if (version === this._version) mas.disabled = false;
    }
  },

  fila(tipo, r) {
    const esc = window.Centro.esc;
    const enlace = window.AprobacionesService.enlace(tipo, r);
    const clase = tipo === 'gestiones' ? GestionesService.tipoLabel(r.tipo)
      : (r.accion === 'Renovación' ? 'Renovación de contrato' : 'Contrato');
    const referencia = tipo === 'contratos' ? r.contrato_id || r.id : r.id;
    return `<div class="cg-aprobacion-row">
      <div><b>${esc(r.cliente_nombre || 'Cliente sin nombre')}</b>
        <span>${esc(referencia)} · ${esc(clase)}</span></div>
      ${enlace ? `<a class="btn btn-ghost" href="${esc(enlace)}">Revisar</a>`
        : '<span class="cg-aprobacion-error">Sin cliente vinculado</span>'}
    </div>`;
  },
};
