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
  email: null,
  fk: null,
  vendedores: [],
  // Modo alta (?nuevo=1): el MISMO formulario crea el cliente. Antes el alta
  // vivía en contratos/nuevo-cliente.html — otro formulario, sin vendedor
  // asignado ni correo de acuses, y por eso el cliente nacía sin dueño.
  esNuevo: false,

  // Solo estos roles editan; el resto (vendedor incluido) ve en solo lectura.
  // El piso real sigue en rules — esto es UI (ver memoria clientes-access-control).
  _puedeEditar() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE].includes(this.rol); },
  // Crear SÍ lo puede el vendedor: su cliente nuevo entra a su cartera. Lo que
  // no puede es EDITAR fichas ajenas (eso lo hace cobros).
  _puedeCrear() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE, ROLES.VENDEDOR].includes(this.rol); },
  // ¿El usuario actual puede figurar como vendedor de una cuenta?
  _yoVendo() { return this.vendedores.some(v => v.id === this.uid); },

  esc(v) { return FMT.esc(v == null ? '' : String(v)); },

  async init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { location.href = '../login.html'; return; }
      this.uid = user.uid;
      this.email = user.email || null;
      try {
        const u = await UsuariosService.getUsuario(user.uid);
        this.rol = u && u.rol ? u.rol : ROLES.VISTA;
      } catch (e) { this.rol = ROLES.VISTA; }

      const p = new URLSearchParams(location.search);
      const id = p.get('id');
      if (!id && p.get('nuevo') === '1') { await this.cargarAlta(); return; }
      if (!id) { Toast.show('Falta el id del cliente.', 'bad'); return; }
      await this.cargar(id);
    });
  },

  // ── Alta ──────────────────────────────────────────────────────────────
  async cargarAlta() {
    if (!this._puedeCrear()) {
      document.body.innerHTML = "<h3 style='color:#A03030;text-align:center;margin-top:100px;'>Tu rol no crea clientes.</h3>";
      return;
    }
    this.esNuevo = true;
    this.cliente = { id: null, activo: true };
    await this.cargarVendedores();

    document.title = 'Nuevo cliente - Cecomunica';
    const t = document.querySelector('.topbar-title');
    if (t) t.innerHTML = '<i data-lucide="user-plus"></i> Nuevo cliente';

    this.pintar();
    this.armarKit('Crear cliente');
    await this.cargarIPs('');
    if (window.lucide?.createIcons) lucide.createIcons();
    document.getElementById('nombre')?.focus();
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
    await this.cargarIPs(this.cliente.ip || '');
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // ── Bloque IP (empresa/IPs) ───────────────────────────────────────────
  // Vivía solo en contratos/nuevo-cliente.html; se trajo aquí para que esta
  // ficha sea el formulario completo y no haya que saltar a otra pantalla.
  async cargarIPs(valorActual = '') {
    const sel = document.getElementById('ip');
    if (!sel) return;
    let lista = [];
    try {
      const snap = await EmpresaService.getDoc('IPs');
      lista = (snap && Array.isArray(snap.list)) ? snap.list.slice() : [];
    } catch (e) { console.warn('[ficha] empresa/IPs no disponible:', e?.code || e); }
    lista.sort((a, b) => String(a).localeCompare(String(b), 'es', { sensitivity: 'base' }));
    sel.innerHTML = '<option value="">Sin IP asignado</option>';
    for (const ip of lista) sel.appendChild(new Option(ip, ip));
    if (valorActual && !lista.includes(valorActual)) sel.appendChild(new Option(valorActual, valorActual));
    sel.value = valorActual || '';
    // El kit tomó la foto de originales antes de poblar el select: re-tomarla
    // para que un IP ya guardado no cuente como "cambio sin guardar".
    if (this.fk) this.fk.setLimpio();
  },

  async agregarIP() {
    const nuevo = ((await Modal.prompt({ title: 'Nuevo bloque IP', confirmLabel: 'Agregar', message: 'Nuevo bloque IP (ej. cliente.cecomunica.net):' })) || '').trim();
    if (!nuevo) return;
    try {
      const snap = await EmpresaService.getDoc('IPs');
      const lista = snap && Array.isArray(snap.list) ? snap.list : [];
      if (!lista.includes(nuevo)) { lista.push(nuevo); await EmpresaService.setDoc('IPs', { list: lista }); }
    } catch (e) { Toast.show('No se pudo guardar el bloque IP: ' + (e?.message || e), 'bad'); return; }
    const sel = document.getElementById('ip');
    if (![...sel.options].some(o => o.value === nuevo)) sel.appendChild(new Option(nuevo, nuevo));
    sel.value = nuevo;
    sel.dispatchEvent(new Event('change'));
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
    document.getElementById('fkAvatar').textContent = this.esNuevo ? '+' : (ini || '?');
    document.getElementById('fkNombre').textContent = this.esNuevo ? 'Nuevo cliente' : (c.nombre || '(sin nombre)');
    document.getElementById('fkMeta').textContent = this.esNuevo
      ? 'Al crearlo entra a la cartera del vendedor que elijas abajo'
      : ([
          c.rucdv_norm ? `RUC ${c.rucdv_norm}` : null,
          c.vendedor_email ? `Vendedor: ${c.vendedor_email}` : null,
        ].filter(Boolean).join(' · ') || '—');
    document.getElementById('chipActivo').outerHTML = c.activo !== false
      ? '<span class="fk-chip ok" id="chipActivo">Activo</span>'
      : '<span class="fk-chip off" id="chipActivo">Inactivo</span>';

    // En alta no hay expediente todavía: fuera historial, chips, evidencia y
    // la tarjeta "Del expediente" (no existe id de cliente al que colgarlos).
    if (this.esNuevo) {
      for (const id of ['chipContratos', 'chipHistorial', 'seccionExpediente', 'zonaEvidencia']) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
      }
      document.querySelector('.fk-acciones')?.style.setProperty('display', 'none');
    }

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

    // Vendedor asignado. En alta se preselecciona al usuario si él mismo
    // vende: es el caso normal (el vendedor da de alta a su propio cliente) y
    // sin dueño el cliente nace invisible para él.
    const sel = document.getElementById('vendedor');
    const elegido = this.esNuevo
      ? (this._yoVendo() ? this.uid : '')
      : (c.vendedor_asignado || '');
    sel.innerHTML = '<option value="">— Sin asignar —</option>' + this.vendedores.map(v =>
      `<option value="${this.esc(v.id)}" ${elegido === v.id ? 'selected' : ''}>${this.esc(v.nombre ? `${v.nombre} (${v.email})` : v.email)}</option>`).join('');

    // Solo lectura para roles sin edición (no aplica al alta: quien llega aquí
    // en modo alta ya pasó por _puedeCrear).
    if (!this.esNuevo && !this._puedeEditar()) {
      document.getElementById('fkRoot').classList.add('fk-solo-lectura');
      document.querySelectorAll('#fkRoot input, #fkRoot select').forEach(el => { el.disabled = true; });
      document.getElementById('notaSoloLectura').style.display = '';
    }
  },

  armarKit(textoGuardar = 'Guardar cambios') {
    const root = document.getElementById('fkRoot');
    this.fk = FormKit.crear({ root, textoGuardar, onGuardar: (cambios) => this.guardar(cambios) });

    document.getElementById('itbms_exento').addEventListener('change', () => this._syncMotivo());
    document.getElementById('itbms_exento').addEventListener('fk:restaurado', () => this._syncMotivo());
    document.getElementById('addIP')?.addEventListener('click', () => this.agregarIP());

    // Evidencia del representante → documentos del cliente (PII, URL firmada).
    // En alta no hay cliente al que colgarla: la zona está oculta.
    if (this.esNuevo) return;
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
      ip: g('ip') ? g('ip').value : this.cliente.ip,
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
    const payload = ClientesService.buildClientePayload(raw, { user, isCreate: this.esNuevo });

    // Reglas de negocio al guardar (banner arriba, con nombre del campo).
    const errores = [];
    if (!payload.nombre) errores.push('El nombre no puede quedar vacío.');
    if (payload.nombre.includes('/')) errores.push("El nombre no puede contener '/'.");
    if (payload.nombre_norm !== this.cliente.nombre_norm && await this._duplicado('nombre_norm', payload.nombre_norm)) {
      errores.push('Ya existe otro cliente con ese nombre.');
    }
    if (payload.ruc_norm && payload.ruc_norm !== this.cliente.ruc_norm && await this._duplicado('ruc_norm', payload.ruc_norm)) {
      errores.push('Ya existe otro cliente con ese RUC.');
    }
    if (payload.rucdv_norm && payload.dv_norm && payload.rucdv_norm !== this.cliente.rucdv_norm
        && await this._duplicado('rucdv_norm', payload.rucdv_norm)) {
      errores.push('Ya existe otro cliente con ese RUC + DV.');
    }
    const banner = document.getElementById('bannerErrores');
    if (errores.length) {
      banner.innerHTML = errores.map(e => this.esc(e)).join('<br>');
      banner.style.display = '';
      banner.scrollIntoView({ block: 'center', behavior: 'smooth' });
      throw new Error(errores[0]);
    }
    banner.style.display = 'none';

    if (this.esNuevo) {
      const nuevoId = await ClientesService.createCliente(payload);
      this.cliente = { id: nuevoId, ...payload };
      Toast.show('Cliente creado.', 'ok');
      if (this.fk) this.fk.soltarGuardia();
      setTimeout(() => { location.href = this._destinoTrasAlta(nuevoId); }, 500);
      return;
    }

    await ClientesService.updateCliente(this.cliente.id, payload);
    this.cliente = { ...this.cliente, ...payload };
    this.pintar();
    const n = Object.keys(cambios).length;
    Toast.show(`Cambios guardados — ${n === 1 ? '1 campo' : n + ' campos'} al historial`, 'ok');
  },

  // A dónde sigue el alta (convención ?from= compartida con el form viejo).
  _destinoTrasAlta(id) {
    const from = new URLSearchParams(location.search).get('from');
    if (from === 'clientes')   return './index.html';
    if (from === 'cotizacion') return `../cotizaciones/nueva-cotizacion.html?cliente_id=${encodeURIComponent(id)}`;
    return `./centro.html?id=${encodeURIComponent(id)}`;
  },

  async volver() {
    if (this.fk && !(await this.fk.confirmarSalida())) return;
    if (this.fk) this.fk.soltarGuardia();
    const p = new URLSearchParams(location.search);
    const from = p.get('from');
    if (from === 'clientes') { location.href = './index.html'; return; }
    if (from === 'cotizacion' && this.esNuevo) { location.href = '../cotizaciones/nueva-cotizacion.html'; return; }
    const id = this.cliente?.id || p.get('id') || '';
    location.href = id ? `./centro.html?id=${encodeURIComponent(id)}` : './centro.html';
  },

  // ── Chips del expediente ──
  // El SDK compat NO trae count() (verificado 2026-09-02, ver
  // firebase-aggregates.js): los conteos van por FbAgg (SDK modular, 1 lectura
  // facturada c/u). Sin FbAgg (módulo bloqueado / sesión modular aún
  // restaurando) los chips se esconden — nunca se bajan documentos solo para
  // pintar un número.
  async cargarChips() {
    const id = this.cliente.id;
    // FbAgg.disponible se enciende cuando el auth modular restaura la sesión;
    // suele tardar <1s tras el login compat. Espera corta, sin bloquear nada.
    for (let i = 0; i < 20 && !(window.FbAgg && FbAgg.disponible); i++) {
      await new Promise(r => setTimeout(r, 150));
    }
    const chipC = document.getElementById('chipContratos');
    const chipH = document.getElementById('chipHistorial');
    if (!(window.FbAgg && FbAgg.disponible)) { chipC.style.display = 'none'; chipH.style.display = 'none'; return; }
    if (this.cliente.id !== id) return; // navegó a otro cliente mientras tanto

    try {
      const nCon = await FbAgg.count('contratos', [['cliente_id', '==', id]]);
      chipC.textContent = `${nCon} contrato${nCon === 1 ? '' : 's'}`;
    } catch (e) { chipC.style.display = 'none'; }
    try {
      const nHist = await FbAgg.count(`clientes/${id}/historial`, []);
      document.getElementById('tarjHistN').textContent = nHist;
      chipH.textContent = `${nHist} cambio${nHist === 1 ? '' : 's'} en el historial`;
    } catch (e) { chipH.style.display = 'none'; }
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
