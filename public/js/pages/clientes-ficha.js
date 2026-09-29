// Ficha del cliente — edición individual (piloto del kit de formularios,
// 2026-09-03). Es el ÚNICO formulario de cliente: alta (?nuevo=1), edición,
// bloque IP y, desde la auditoría UX 2026-09-28 (T9), los documentos del
// cliente (?seccion=documentos). contratos/nuevo-cliente.html solo redirige aquí.
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
        const u = await Sesion.miPerfil(user);
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
    this.montarDocumentos();
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // ── Documentos del cliente (PII) ──────────────────────────────────────
  // Vivían en contratos/nuevo-cliente.html?id= (cliente-documentos.js): se
  // trajeron aquí para que haya UN formulario de cliente (auditoría UX
  // 2026-09-28, T9). Mismos roles que antes: esa página solo la abrían
  // admin/gerencia/recepción, y la callable getClienteDocUrl solo les firma
  // la URL a ellos — al vendedor la sección ni se le pinta.
  _puedeVerDocs() { return [ROLES.ADMIN, 'admin', ROLES.RECEPCION, ROLES.GERENTE].includes(this.rol); },

  montarDocumentos() {
    const sec = document.getElementById('seccionDocumentos');
    if (!sec || this.esNuevo || !this.cliente?.id || !this._puedeVerDocs() || !window.ClienteDocumentosService) return;
    sec.style.display = '';
    const $tipo = document.getElementById('docTipo');
    if (!$tipo.options.length) {
      ClienteDocumentosService.TIPOS.forEach(t => $tipo.appendChild(new Option(t.label, t.value)));
    }
    if (!this._docsWired) {
      this._docsWired = true;
      document.getElementById('docBtnSubir').addEventListener('click', () => this.subirDocumento());
    }
    this.cargarDocumentos();
    // ?seccion=documentos: el Centro ("Cargar un documento") aterriza aquí.
    if (new URLSearchParams(location.search).get('seccion') === 'documentos') {
      setTimeout(() => sec.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150);
    }
  },

  _docFmtSize(bytes) {
    if (!bytes) return '';
    const kb = bytes / 1024;
    return kb < 1024 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
  },

  async cargarDocumentos() {
    const $list = document.getElementById('docList');
    if (!$list) return;
    $list.innerHTML = '<div style="color:var(--fg-3); font-size:13px;">Cargando…</div>';
    let docs = [];
    try { docs = await ClienteDocumentosService.list(this.cliente.id); }
    catch (err) {
      console.error('[ficha] documentos:', err);
      $list.innerHTML = '<div style="color:#A03030; font-size:13px;">No se pudieron cargar los documentos.</div>';
      return;
    }
    this._docs = docs;
    if (!docs.length) {
      $list.innerHTML = '<div style="color:var(--fg-3); font-size:13px;">No hay documentos cargados.</div>';
      return;
    }
    // 'image' NO está en el vendor a medida de lucide: por eso 'camera'.
    $list.innerHTML = docs.map(d => {
      const f = d.subido_en?.toDate ? d.subido_en.toDate().toLocaleString('es-PA', { hour12: false }) : '';
      const meta = [this.esc(d.nombre_archivo || ''), this._docFmtSize(d.size), this.esc(f)].filter(Boolean).join(' · ');
      return `<div class="doc-row" style="display:flex; align-items:center; gap:var(--sp-3); padding:var(--sp-2) 0; border-bottom:1px solid var(--border-subtle);">
        <i data-lucide="${(d.content_type || '').includes('pdf') ? 'file-text' : 'camera'}" style="width:18px; height:18px; color:var(--fg-3); flex:none;"></i>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:600; font-size:13.5px;">${this.esc(ClienteDocumentosService.labelFor(d.tipo))}</div>
          <div style="font-size:12px; color:var(--fg-3); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${meta}</div>
        </div>
        <button type="button" class="btn btn-ghost" onclick="FichaCliente.verDocumento('${this.esc(d.id)}', this)"><i data-lucide="eye"></i> Ver</button>
        <button type="button" class="btn btn-ghost" style="color:#A03030;" aria-label="Eliminar documento"
                onclick="FichaCliente.borrarDocumento('${this.esc(d.id)}')"><i data-lucide="trash-2"></i></button>
      </div>`;
    }).join('');
    if (window.lucide?.createIcons) lucide.createIcons();
  },

  // La pestaña se abre con el CLIC y recibe la URL firmada después: abrirla
  // ya firmada tras el await la trataría como popup (patrón del Centro).
  async verDocumento(docId, btn) {
    const tab = window.open('about:blank', '_blank');
    if (tab) { try { tab.opener = null; } catch (_) {} }
    if (btn) btn.disabled = true;
    try {
      const url = await ClienteDocumentosService.getViewUrl(this.cliente.id, docId);
      if (tab) tab.location.href = url; else window.open(url, '_blank', 'noopener');
    } catch (err) {
      if (tab) tab.close();
      Toast.show(err?.message || 'No se pudo abrir el documento.', 'bad');
    } finally { if (btn) btn.disabled = false; }
  },

  async borrarDocumento(docId) {
    const d = (this._docs || []).find(x => x.id === docId);
    const ok = await Modal.confirm({
      title: 'Eliminar documento',
      message: `¿Eliminar el documento "${this.esc(d?.nombre_archivo || '')}"? Sale del expediente; el archivo queda guardado para auditoría.`,
      confirmLabel: 'Eliminar', danger: true,
    });
    if (!ok) return;
    try {
      await ClienteDocumentosService.softDelete(this.cliente.id, docId);
      Toast.show('Documento eliminado.', 'ok');
      this.cargarDocumentos();
    } catch (err) { Toast.show('No se pudo eliminar: ' + (err?.message || err), 'bad'); }
  },

  subirDocumento() {
    const $file = document.getElementById('docFile');
    const $tipo = document.getElementById('docTipo');
    const $btn = document.getElementById('docBtnSubir');
    const $status = document.getElementById('docUploadStatus');
    const $pct = document.getElementById('docUploadPct');
    if ($btn.disabled) return; // candado contra el doble clic mientras sube
    const file = $file.files[0];
    if (!file) { Toast.show('Selecciona un archivo.', 'warn'); return; }
    const okType = file.type === 'application/pdf' || file.type.startsWith('image/');
    if (!okType) { Toast.show('Solo PDF o imágenes.', 'warn'); return; }
    if (file.size > 10 * 1024 * 1024) { Toast.show('El archivo supera 10 MB.', 'warn'); return; }
    const busy = (on) => { $btn.disabled = on; $tipo.disabled = on; $file.disabled = on; $status.style.display = on ? 'inline' : 'none'; };
    busy(true);
    $pct.textContent = '0%';
    ClienteDocumentosService.upload({
      clienteId: this.cliente.id, tipo: $tipo.value, file,
      onProgress: (p) => { $pct.textContent = p + '%'; },
      onError: (err) => { console.error('[ficha] subir documento:', err); Toast.show('Error al subir: ' + (err?.message || err), 'bad'); busy(false); },
      onDone: () => { Toast.show('Documento subido.', 'ok'); $file.value = ''; busy(false); this.cargarDocumentos(); },
    });
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
    set('nombre', c.nombre);
    // RUC por partes (js/ui/rucInput.js): lo guardado se muestra por partes
    // sin reescribirse; si está sucio (DV pegado, NT perdido) ofrece acomodarlo.
    if (window.RucInput && window.RucPanama) {
      this.rucW = this.rucW || RucInput.montar(document.getElementById('rucBloque'));
      this.rucW.cargar(c.ruc, c.ruc_tipo, c.dv);
    } else { set('ruc', c.ruc); set('ruc_tipo', c.ruc_tipo); set('dv', c.dv); }
    set('representante', c.representante);
    // El documento: QUÉ documento es lo contesta el vendedor en el selector.
    // Las fichas viejas que traen la palabra metida en el número ("PASAPORTE:
    // XDB367055") se acomodan solas al abrirlas — número en su casilla, tipo
    // en el selector — y quedan derechas en el primer guardado.
    const docCrudo = c.representante_cedula || c.cedula_representante || '';
    set('representante_cedula', window.DocIdentidad ? DocIdentidad.limpiar(docCrudo) : docCrudo);
    set('representante_doc_tipo', window.DocIdentidad
      ? DocIdentidad.tipo(docCrudo, c.representante_doc_tipo)
      : (c.representante_doc_tipo || 'cedula'));
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

    // Pegar "Pasaporte No. 150685537" en la casilla del número mueve el
    // selector, en vez de dejar la palabra dentro del número. Va en `input` y
    // no en `blur` a propósito: al salir del campo, FormKit ya le quitó la
    // palabra al valor y aquí no quedaría nada que leer.
    document.getElementById('representante_cedula').addEventListener('input', (e) => {
      if (window.DocIdentidad && DocIdentidad.traePalabraPasaporte(e.target.value)) {
        const sel = document.getElementById('representante_doc_tipo');
        if (sel.value !== 'pasaporte') {
          sel.value = 'pasaporte';
          sel.dispatchEvent(new Event('change'));
        }
      }
    });

    document.getElementById('itbms_exento').addEventListener('change', () => this._syncMotivo());
    document.getElementById('itbms_exento').addEventListener('fk:restaurado', () => this._syncMotivo());
    document.getElementById('addIP')?.addEventListener('click', () => this.agregarIP());
    if (this.esNuevo || this._puedeEditar()) this._montarAvisosDuplicado();

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
        onDone: () => {
          prog.textContent = ''; file.value = ''; Toast.show('Evidencia adjuntada a los documentos del cliente.', 'ok');
          if (document.getElementById('seccionDocumentos')?.style.display !== 'none') this.cargarDocumentos();
        },
        onError: (e) => { prog.textContent = ''; Toast.show('No se pudo subir: ' + (e?.message || e), 'bad'); },
      });
    });
  },

  _syncMotivo() {
    const exento = document.getElementById('itbms_exento').value === 'true';
    document.getElementById('wrapMotivo').style.display = exento ? '' : 'none';
  },

  // ¿Otro cliente vivo ya usa este valor normalizado? (excluyendo al propio)
  // Devuelve { id, nombre } del otro (o null) para poder enlazarlo
  // (auditoría UX 2026-09-28, #15: el banner no decía cuál era).
  async _duplicado(campo, valor) {
    if (!valor) return null;
    const snap = await firebase.firestore().collection('clientes')
      .where(campo, '==', valor).where('deleted', '==', false).limit(3).get();
    const otro = snap.docs.find(d => d.id !== this.cliente.id);
    return otro ? { id: otro.id, nombre: otro.data().nombre || '' } : null;
  },

  _linkExistente(dup) {
    if (!dup) return '';
    return ` <a href="./centro.html?id=${encodeURIComponent(dup.id)}" target="_blank" rel="noopener"
      style="color:inherit; text-decoration:underline;">Abrir el existente${dup.nombre ? ' (' + this.esc(dup.nombre) + ')' : ''}</a>`;
  },

  // Aviso NO bloqueante al salir del nombre o del RUC: el duplicado se ve
  // mientras se captura, no recién al guardar con 3 consultas (auditoría UX
  // 2026-09-28, #15). Consulta exacta sobre el valor normalizado.
  async _avisarDuplicado(tipo) {
    const g = (id) => document.getElementById(id);
    const cont = g(tipo === 'nombre' ? 'avisoDupNombre' : 'avisoDupRuc');
    if (!cont) return;
    let dup = null;
    try {
      if (tipo === 'nombre') {
        const n = ClientesService.norm(g('nombre').value || '');
        if (n && n !== this.cliente.nombre_norm) dup = await this._duplicado('nombre_norm', n);
      } else {
        const rn = ClientesService.rucNorm((g('ruc').value || '').trim());
        if (rn && rn !== this.cliente.ruc_norm) dup = await this._duplicado('ruc_norm', rn);
      }
    } catch (e) { console.warn('[ficha] no se pudo revisar duplicados', e); }
    if (!dup) { cont.style.display = 'none'; cont.innerHTML = ''; return; }
    cont.innerHTML = `Ya existe otro cliente con ${tipo === 'nombre' ? 'este nombre' : 'este RUC'}.` + this._linkExistente(dup)
      + ' Revisa antes de guardar: no se puede repetir.';
    cont.style.display = '';
  },

  _montarAvisosDuplicado() {
    if (this._avisosMontados) return;
    this._avisosMontados = true;
    const mk = (id, despuesDe) => {
      if (!despuesDe || document.getElementById(id)) return;
      const d = document.createElement('div');
      d.id = id;
      d.setAttribute('role', 'status');
      d.style.cssText = 'display:none; margin:6px 0 10px; padding:8px 10px; border-radius:6px; background:#FFF7E6; color:#8A5A00; font-size:13px;';
      despuesDe.insertAdjacentElement('afterend', d);
    };
    mk('avisoDupNombre', document.getElementById('nombre')?.closest('.form-field'));
    mk('avisoDupRuc', document.getElementById('rucBloque'));
    document.getElementById('nombre')?.addEventListener('blur', () => this._avisarDuplicado('nombre'));
    // El RUC son varias casillas: se revisa al salir del bloque entero.
    document.getElementById('rucBloque')?.addEventListener('focusout', (e) => {
      if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget)) return;
      this._avisarDuplicado('ruc');
    });
  },

  async guardar(cambios) {
    const g = (id) => document.getElementById(id);
    const raw = {
      ...this.cliente,
      ip: g('ip') ? g('ip').value : this.cliente.ip,
      nombre: g('nombre').value, ruc: g('ruc').value, ruc_tipo: g('ruc_tipo').value, dv: g('dv').value,
      representante: g('representante').value,
      representante_cedula: g('representante_cedula').value,
      representante_doc_tipo: g('representante_doc_tipo').value,
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
    // El RUC por partes: faltan partes, o el DV no cuadra con el de la DGI
    // (solo si el usuario tocó el RUC o el DV — lo viejo no tranca).
    const probRuc = this.rucW ? this.rucW.problema() : null;
    if (probRuc) errores.push(probRuc);
    if (!payload.nombre) errores.push('El nombre no puede quedar vacío.');
    if (payload.nombre.includes('/')) errores.push("El nombre no puede contener '/'.");
    // Cada error lleva, si aplica, el cliente con el que choca: el banner
    // enlaza "Abrir el existente" (auditoría UX 2026-09-28, #15).
    let dup = null;
    if (payload.nombre_norm !== this.cliente.nombre_norm && (dup = await this._duplicado('nombre_norm', payload.nombre_norm))) {
      errores.push({ t: 'Ya existe otro cliente con ese nombre.', dup });
    }
    if (payload.ruc_norm && payload.ruc_norm !== this.cliente.ruc_norm && (dup = await this._duplicado('ruc_norm', payload.ruc_norm))) {
      errores.push({ t: 'Ya existe otro cliente con ese RUC.', dup });
    }
    if (payload.rucdv_norm && payload.dv_norm && payload.rucdv_norm !== this.cliente.rucdv_norm
        && (dup = await this._duplicado('rucdv_norm', payload.rucdv_norm))) {
      errores.push({ t: 'Ya existe otro cliente con ese RUC + DV.', dup });
    }
    const banner = document.getElementById('bannerErrores');
    if (errores.length) {
      banner.innerHTML = errores.map(e => typeof e === 'string'
        ? this.esc(e)
        : this.esc(e.t) + this._linkExistente(e.dup)).join('<br>');
      banner.style.display = '';
      banner.scrollIntoView({ block: 'center', behavior: 'smooth' });
      throw new Error(typeof errores[0] === 'string' ? errores[0] : errores[0].t);
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

    // Desactivar CIERRA los contratos vigentes de la cuenta (regla 2026-09-14,
    // la aplica el trigger onClienteDesactivado). Se dice antes de guardar:
    // hasta hoy el ganchito se quitaba a ciegas y 24 de los 96 clientes
    // inactivos quedaron con contrato vigente y/o radios nuestros en campo.
    if (this.cliente.activo !== false && payload.activo === false) {
      let cons = { contratos: [], enCampo: 0 };
      try { cons = await ClientesService.consecuenciasDesactivar(this.cliente.id); }
      catch (e) { console.warn('[ficha] no se pudo calcular el efecto de desactivar', e); }
      const ok = await Modal.confirm({
        title: 'Desactivar el cliente',
        message: ClientesService.avisoDesactivar(cons, this.esc(payload.nombre || this.cliente.nombre || '')),
        confirmLabel: cons.contratos.length ? `Desactivar y cerrar ${cons.contratos.length} contrato(s)` : 'Desactivar',
        danger: true,
      });
      // FormKit prefija "No se pudo guardar: " — el texto se redacta para eso.
      if (!ok) throw new Error('cancelaste la desactivación del cliente');
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
    nombre: 'Nombre', ruc: 'RUC', ruc_tipo: 'Tipo de contribuyente', dv: 'DV',
    representante: 'Representante legal', representante_cedula: 'Documento del representante',
    representante_doc_tipo: 'Tipo de documento',
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
