// Ficha del cliente — edición individual (piloto del kit de formularios,
// 2026-09-03). Sustituye al modo edición de contratos/nuevo-cliente.html en
// los caminos cotidianos (menú del Centro y buscador global); el formulario
// viejo queda para el alta y para el bloque IP.
//
// Patrón (ver formKit.js): guardado explícito con barra pegajosa, validación
// de formato al salir del campo, guardia de salida, campos auditados con
// evidencia adjunta, y regreso al origen vía ?from=.
// @ts-nocheck
window.FichaCliente = {
  cliente: null,
  rol: null,
  uid: null,
  fk: null,
  vendedores: [],

  // Solo estos roles editan; el resto (vendedor incluido) ve en solo lectura.
  // El piso real sigue en rules — esto es UI (ver memoria clientes-access-control).
  _puedeEditar() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE].includes(this.rol); },

  esc(v) { return FMT.esc(v == null ? '' : String(v)); },

  async init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { location.href = '../login.html'; return; }
      this.uid = user.uid;
      try {
        const u = await UsuariosService.getUsuario(user.uid);
        this.rol = u && u.rol ? u.rol : ROLES.VISTA;
      } catch (e) { this.rol = ROLES.VISTA; }

      const id = new URLSearchParams(location.search).get('id');
      if (!id) { Toast.show('Falta el id del cliente.', 'bad'); return; }
      await this.cargar(id);
    });
  },

  async cargar(id) {
    const db = firebase.firestore();
    let snap = await db.collection('clientes').doc(id).get();
    // Persistencia multi-pestaña: si vino del caché, releer del servidor
    // (patrón del Centro, 8a7ba6d) — una ficha vieja aquí se EDITA y se pisa.
    if (snap.metadata && snap.metadata.fromCache) {
      try { snap = await db.collection('clientes').doc(id).get({ source: 'server' }); } catch (e) { /* offline: caché */ }
    }
    if (!snap.exists) { Toast.show('Cliente no encontrado.', 'bad'); return; }
    this.cliente = { id: snap.id, ...snap.data() };

    await this.cargarVendedores();
    this.pintar();
    this.armarKit();
    this.cargarChips();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  async cargarVendedores() {
    try {
      const snap = await UsuariosService.getVendedores();
      this.vendedores = snap.map(d => ({ id: d.id, email: d.email || d.id, nombre: d.nombre || null }));
    } catch (e) { this.vendedores = []; }
  },

  pintar() {
    const c = this.cliente;
    const ini = (c.nombre || '?').trim().split(/\s+/).map(p => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
    document.getElementById('fkAvatar').textContent = ini || '?';
    document.getElementById('fkNombre').textContent = c.nombre || '(sin nombre)';
    document.getElementById('fkMeta').textContent = [
      c.rucdv_norm ? `RUC ${c.rucdv_norm}` : null,
      c.vendedor_email ? `Vendedor: ${c.vendedor_email}` : null,
    ].filter(Boolean).join(' · ') || '—';
    document.getElementById('chipActivo').outerHTML = c.activo !== false
      ? '<span class="fk-chip ok" id="chipActivo">Activo</span>'
      : '<span class="fk-chip off" id="chipActivo">Inactivo</span>';

    // Campos (los ids calzan con los nombres de campo del doc).
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? '' : v; };
    set('nombre', c.nombre); set('ruc', c.ruc); set('dv', c.dv);
    set('representante', c.representante);
    set('representante_cedula', c.representante_cedula || c.cedula_representante);
    set('representante_email', c.representante_email);
    set('telefono', c.telefono); set('email', c.email); set('email_acuses', c.email_acuses);
    set('direccion', c.direccion); set('direccion_facturacion', c.direccion_facturacion);
    set('itbms_motivo_exencion', c.itbms_motivo_exencion);
    document.getElementById('itbms_exento').value = c.itbms_exento ? 'true' : 'false';
    document.getElementById('activo').checked = c.activo !== false;
    this._syncMotivo();

    // Vendedor asignado
    const sel = document.getElementById('vendedor');
    sel.innerHTML = '<option value="">— Sin asignar —</option>' + this.vendedores.map(v =>
      `<option value="${this.esc(v.id)}" ${c.vendedor_asignado === v.id ? 'selected' : ''}>${this.esc(v.nombre ? `${v.nombre} (${v.email})` : v.email)}</option>`).join('');

    // IP (solo lectura aquí; se gestiona en el formulario completo)
    const ipRow = document.getElementById('ipRow');
    if (c.ip) {
      ipRow.innerHTML = `Bloque IP: <span class="cg-mono">${this.esc(c.ip)}</span> — se cambia desde el
        <a href="../contratos/nuevo-cliente.html?id=${encodeURIComponent(c.id)}&from=centro">formulario completo</a>.`;
      ipRow.style.display = '';
    }

    // Solo lectura para roles sin edición.
    if (!this._puedeEditar()) {
      document.getElementById('fkRoot').classList.add('fk-solo-lectura');
      document.querySelectorAll('#fkRoot input, #fkRoot select').forEach(el => { el.disabled = true; });
      document.getElementById('notaSoloLectura').style.display = '';
    }
  },

  armarKit() {
    const root = document.getElementById('fkRoot');
    this.fk = FormKit.crear({ root, onGuardar: (cambios) => this.guardar(cambios) });

    document.getElementById('itbms_exento').addEventListener('change', () => this._syncMotivo());
    document.getElementById('itbms_exento').addEventListener('fk:restaurado', () => this._syncMotivo());

    // Evidencia del representante → documentos del cliente (PII, URL firmada).
    const zona = document.getElementById('zonaEvidencia');
    const file = document.getElementById('fileEvidencia');
    zona.addEventListener('click', () => file.click());
    zona.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); } });
    file.addEventListener('change', () => {
      const f = file.files && file.files[0];
      if (!f) return;
      const prog = zona.querySelector('.prog');
      prog.textContent = '0%';
      ClienteDocumentosService.upload({
        clienteId: this.cliente.id, tipo: 'otro', file: f,
        onProgress: (p) => { prog.textContent = p + '%'; },
        onDone: () => { prog.textContent = ''; file.value = ''; Toast.show('Evidencia adjuntada a los documentos del cliente.', 'ok'); },
        onError: (e) => { prog.textContent = ''; Toast.show('No se pudo subir: ' + (e?.message || e), 'bad'); },
      });
    });
  },

  _syncMotivo() {
    const exento = document.getElementById('itbms_exento').value === 'true';
    document.getElementById('wrapMotivo').style.display = exento ? '' : 'none';
  },

  // ¿Otro cliente vivo ya usa este valor normalizado? (excluyendo al propio)
  async _duplicado(campo, valor) {
    if (!valor) return false;
    const snap = await firebase.firestore().collection('clientes')
      .where(campo, '==', valor).where('deleted', '==', false).limit(2).get();
    return snap.docs.some(d => d.id !== this.cliente.id);
  },

  async guardar(cambios) {
    const g = (id) => document.getElementById(id);
    const raw = {
      ...this.cliente,
      nombre: g('nombre').value, ruc: g('ruc').value, dv: g('dv').value,
      representante: g('representante').value,
      representante_cedula: g('representante_cedula').value,
      representante_email: g('representante_email').value,
      telefono: g('telefono').value, email: g('email').value, email_acuses: g('email_acuses').value,
      direccion: g('direccion').value, direccion_facturacion: g('direccion_facturacion').value,
      itbms_exento: g('itbms_exento').value === 'true',
      itbms_motivo_exencion: g('itbms_motivo_exencion').value,
      activo: g('activo').checked,
    };
    const vend = this.vendedores.find(v => v.id === g('vendedor').value);
    raw.vendedor_asignado = vend ? vend.id : null;
    raw.vendedor_email = vend ? vend.email : null;

    const user = firebase.auth().currentUser;
    const payload = ClientesService.buildClientePayload(raw, { user });

    // Reglas de negocio al guardar (banner arriba, con nombre del campo).
    const errores = [];
    if (payload.nombre_norm !== this.cliente.nombre_norm && await this._duplicado('nombre_norm', payload.nombre_norm)) {
      errores.push('Ya existe otro cliente con ese nombre.');
    }
    if (payload.ruc_norm && payload.ruc_norm !== this.cliente.ruc_norm && await this._duplicado('ruc_norm', payload.ruc_norm)) {
      errores.push('Ya existe otro cliente con ese RUC.');
    }
    const banner = document.getElementById('bannerErrores');
    if (errores.length) {
      banner.innerHTML = errores.map(e => this.esc(e)).join('<br>');
      banner.style.display = '';
      banner.scrollIntoView({ block: 'center', behavior: 'smooth' });
      throw new Error(errores[0]);
    }
    banner.style.display = 'none';

    await ClientesService.updateCliente(this.cliente.id, payload);
    this.cliente = { ...this.cliente, ...payload };
    this.pintar();
    const n = Object.keys(cambios).length;
    Toast.show(`Cambios guardados — ${n === 1 ? '1 campo' : n + ' campos'} al historial`, 'ok');
  },

  async volver() {
    if (this.fk && !(await this.fk.confirmarSalida())) return;
    if (this.fk) this.fk.soltarGuardia();
    const p = new URLSearchParams(location.search);
    const from = p.get('from');
    if (from === 'clientes') { location.href = './index.html'; return; }
    const id = this.cliente?.id || p.get('id') || '';
    location.href = id ? `./centro.html?id=${encodeURIComponent(id)}` : './centro.html';
  },

  // ── Chips del expediente (agregaciones: 1 lectura cada una) ──
  async cargarChips() {
    const db = firebase.firestore();
    const cuenta = async (q) => {
      try { const s = await q.count().get(); return s.data().count; } catch (e) { return null; }
    };
    const nCon = await cuenta(db.collection('contratos').where('cliente_id', '==', this.cliente.id));
    if (nCon != null) document.getElementById('chipContratos').textContent =
      `${nCon} contrato${nCon === 1 ? '' : 's'}`;
    const nHist = await cuenta(db.collection('clientes').doc(this.cliente.id).collection('historial'));
    if (nHist != null) {
      document.getElementById('tarjHistN').textContent = nHist;
      document.getElementById('chipHistorial').textContent =
        `${nHist} cambio${nHist === 1 ? '' : 's'} en el historial`;
    }
  },

  // ── Historial (mismo formato que el modal del Centro) ──
  HIST_LABELS: {
    nombre: 'Nombre', ruc: 'RUC', dv: 'DV',
    representante: 'Representante legal', representante_cedula: 'Cédula del representante',
    representante_email: 'Correo del representante',
    telefono: 'Teléfono', email: 'Correo', email_acuses: 'Correo de acuses',
    direccion: 'Dirección', direccion_facturacion: 'Dirección de facturación',
    itbms_exento: 'ITBMS exento', itbms_motivo_exencion: 'Motivo de exención',
    tags: 'Etiquetas', vendedor_asignado: 'Vendedor (uid)', vendedor_email: 'Vendedor',
    activo: 'Activo', deleted: 'Eliminado', ip: 'IP',
    qbo_customer_id: 'QuickBooks (id)', qbo_customer_name: 'QuickBooks (cliente)',
  },
  _histVal(v) {
    if (v === null || v === undefined || v === '') return '—';
    if (v === true) return 'Sí';
    if (v === false) return 'No';
    if (Array.isArray(v)) return v.join(', ') || '—';
    return String(v);
  },
  async verHistorial() {
    const m = document.getElementById('modalHist');
    const bd = document.getElementById('modalHistBody');
    m.style.display = 'grid';
    bd.innerHTML = '<div style="padding:14px; color:var(--fg-3); text-align:center;">Cargando…</div>';
    let filas = [];
    try {
      const snap = await firebase.firestore().collection('clientes').doc(this.cliente.id)
        .collection('historial').orderBy('at', 'desc').limit(50).get();
      filas = snap.docs.map(d => d.data());
    } catch (e) { console.warn('[ficha] historial no disponible:', e?.message || e); }
    if (!filas.length) {
      bd.innerHTML = `<div style="padding:14px; color:var(--fg-3); text-align:center;">Sin cambios registrados.
        El historial arrancó el 2 sep 2026.</div>`;
      return;
    }
    bd.innerHTML = filas.map(h => {
      const quien = this.esc(h.por_email || h.por_uid || 'sistema / script');
      const d = h.at?.toDate ? h.at.toDate() : null;
      const cuando = d ? d.toLocaleString('es-PA', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
      let cuerpo;
      if (h.tipo === 'alta') {
        cuerpo = `<div style="font-size:13px;">Alta del cliente${h.nombre ? ` — <b>${this.esc(h.nombre)}</b>` : ''}</div>`;
      } else if (h.tipo === 'borrado_fisico') {
        cuerpo = `<div style="font-size:13px; color:#A03030;">Borrado físico del documento</div>`;
      } else {
        cuerpo = `<ul style="margin:4px 0 0; padding-left:18px; font-size:13px;">` +
          Object.entries(h.cambios || {}).map(([campo, c]) => `
            <li style="margin:2px 0;"><b>${this.esc(this.HIST_LABELS[campo] || campo)}</b>:
              <span style="color:#A03030; text-decoration:line-through;">${this.esc(this._histVal(c?.antes))}</span>
              <span style="color:var(--fg-4);">→</span>
              <span style="color:#17714B; font-weight:600;">${this.esc(this._histVal(c?.despues))}</span></li>`).join('') +
          `</ul>`;
      }
      return `<div style="border-bottom:1px solid var(--border-subtle); padding:10px 2px;">
        <div style="font-size:12px; color:var(--fg-3);">${this.esc(cuando)} · ${quien}</div>${cuerpo}</div>`;
    }).join('');
  },
  cerrarHistorial() { document.getElementById('modalHist').style.display = 'none'; },
};
