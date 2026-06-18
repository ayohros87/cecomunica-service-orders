// @ts-nocheck
// Cancelaciones de equipos — solicitud + cola + aprobación + historial.
window.Cancelaciones = {
  rol: null,
  filtro: 'pendiente',
  contratoDocId: null,
  contratoActual: null,

  esAprobador() { return this.rol === ROLES.ADMIN || this.rol === ROLES.GERENTE; },

  async init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return (window.location.href = '../login.html');
      try {
        const u = await UsuariosService.getUsuario(user.uid);
        this.rol = u ? u.rol : null;
        const permitido = [ROLES.ADMIN, ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION];
        if (!u || !permitido.includes(this.rol)) {
          document.body.innerHTML = "<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>";
          return;
        }
        this.contratoDocId = new URLSearchParams(location.search).get('contrato');
        if (this.contratoDocId) await this.cargarSolicitud();
        this._wire();
        await this.cargarCola();
      } catch (e) { console.error(e); Toast.show('Error al iniciar', 'bad'); }
    });
  },

  _wire() {
    document.getElementById('termino')?.addEventListener('change', () => this.actualizarFinPreview());
    document.getElementById('fechaNota')?.addEventListener('change', () => this.actualizarFinPreview());
    document.getElementById('fechaOtra')?.addEventListener('change', () => this.actualizarFinPreview());
    document.getElementById('btnEnviar')?.addEventListener('click', () => this.enviar());
  },

  /* ===== Solicitud ===== */
  async cargarSolicitud() {
    const c = await ContratosService.getContrato(this.contratoDocId);
    if (!c) { Toast.show('Contrato no encontrado', 'bad'); return; }
    this.contratoActual = c;
    document.getElementById('solicitudWrap').style.display = '';
    document.getElementById('solSub').textContent =
      `${c.contrato_id || this.contratoDocId} · ${c.cliente_nombre || 'Cliente'}`;

    const eq = c.equipos || [];
    document.getElementById('solEquipos').innerHTML = eq.length
      ? `<table class="app-table"><thead><tr><th>Modelo</th><th>Contratados</th><th style="width:140px;">Cancelar</th></tr></thead><tbody>${
          eq.map((e, i) => `
            <tr>
              <td>${(e.modelo || '—')}</td>
              <td>${Number(e.cantidad || 0)}</td>
              <td><input type="number" class="form-input cancelar-cant" data-idx="${i}" min="0" max="${Number(e.cantidad || 0)}" value="0" style="height:32px;"></td>
            </tr>`).join('')
        }</tbody></table>`
      : '<p style="color:var(--fg-3);">Este contrato no tiene equipos.</p>';

    const hoy = new Date().toISOString().slice(0, 10);
    document.getElementById('fechaNota').value = hoy;
    this.actualizarFinPreview();
  },

  actualizarFinPreview() {
    const termino = document.getElementById('termino').value;
    document.getElementById('otraFechaWrap').style.display = termino === 'otro' ? '' : 'none';
    const fin = CancelacionesService.calcularFechaFin(
      termino, document.getElementById('fechaNota').value, document.getElementById('fechaOtra')?.value);
    document.getElementById('finPreview').innerHTML =
      `Se facturará hasta: <b>${fin.toLocaleDateString('es-PA')}</b> (el último tramo se prorratea).`;
  },

  async enviar() {
    const c = this.contratoActual;
    if (!c) return;
    const items = [...document.querySelectorAll('.cancelar-cant')]
      .map(inp => ({ idx: Number(inp.dataset.idx), cant: Number(inp.value || 0) }))
      .filter(x => x.cant > 0)
      .map(x => {
        const e = c.equipos[x.idx] || {};
        return { modelo_id: e.modelo_id || '', modelo: e.modelo || '', cantidad: Math.min(x.cant, Number(e.cantidad || 0)) };
      });
    if (!items.length) { Toast.show('Indica al menos un equipo a cancelar', 'warn'); return; }

    const termino = document.getElementById('termino').value;
    const fechaNota = document.getElementById('fechaNota').value || null;
    const fechaOtra = document.getElementById('fechaOtra')?.value || null;
    const fin = CancelacionesService.calcularFechaFin(termino, fechaNota, fechaOtra);

    const btn = document.getElementById('btnEnviar');
    btn.disabled = true;
    try {
      // Adjunto (opcional)
      let adjuntoUrl = '';
      const file = document.getElementById('notaArchivo').files[0];
      if (file) {
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
        const path = `cancelaciones_notas/${(c.contrato_id || this.contratoDocId)}_${Date.now()}.${ext}`;
        const ref = firebase.storage().ref(path);
        await ref.put(file, { contentType: file.type });
        adjuntoUrl = await ref.getDownloadURL();
      }
      const uid = firebase.auth().currentUser?.uid || null;
      let nombre = uid;
      try { const me = await UsuariosService.getUsuario(uid); nombre = me?.nombre || uid; } catch (e) {}

      await CancelacionesService.crear({
        contrato_doc_id: this.contratoDocId,
        contrato_id: c.contrato_id || '',
        cliente_nombre: c.cliente_nombre || '',
        items,
        termino,
        fecha_fin_facturacion: firebase.firestore.Timestamp.fromDate(fin),
        fecha_nota_cliente: fechaNota,
        adjunto_url: adjuntoUrl,
        motivo: (document.getElementById('motivo').value || '').trim(),
        solicitado_por: uid,
        solicitado_por_nombre: nombre,
      });
      Toast.show('Solicitud de baja enviada', 'ok');
      window.location.href = './cancelaciones.html';
    } catch (e) {
      console.error(e); Toast.show('No se pudo enviar: ' + e.message, 'bad'); btn.disabled = false;
    }
  },

  /* ===== Cola / historial ===== */
  setFiltro(estado) {
    this.filtro = estado;
    document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('is-on', b.dataset.estado === estado));
    this.cargarCola();
  },

  async cargarCola() {
    const cont = document.getElementById('colaLista');
    cont.innerHTML = '<p style="color:var(--fg-3);">Cargando…</p>';
    let rows;
    try { rows = await CancelacionesService.listar({ estado: this.filtro || null }); }
    catch (e) { console.error(e); cont.innerHTML = '<p style="color:#b91c1c;">Error al cargar.</p>'; return; }

    document.getElementById('colaResumen').textContent = `${rows.length} solicitud(es)`;
    if (!rows.length) { cont.innerHTML = '<p style="color:var(--fg-3);">No hay solicitudes.</p>'; return; }

    const pill = (est) => est === 'aprobada' ? '<span class="estado-pill e-aprob">Aprobada</span>'
      : est === 'rechazada' ? '<span class="estado-pill e-rech">Rechazada</span>'
      : '<span class="estado-pill e-pend">Pendiente</span>';
    const fdate = (ts) => ts?.toDate ? ts.toDate().toLocaleDateString('es-PA') : (ts ? new Date(ts).toLocaleDateString('es-PA') : '—');

    cont.innerHTML = rows.map(r => {
      const equipos = (r.items || []).map(i => `${i.modelo} ×${i.cantidad}`).join(', ');
      const acciones = (r.estado === 'pendiente' && this.esAprobador())
        ? `<div style="display:flex; gap:8px; margin-top:8px;">
             <button class="btn sm btn-primary" onclick="Cancelaciones.aprobar('${r.id}')"><i data-lucide="check"></i> Aprobar</button>
             <button class="btn sm btn-danger" onclick="Cancelaciones.rechazar('${r.id}')"><i data-lucide="x"></i> Rechazar</button>
           </div>` : '';
      return `
        <div class="ds-card baja-card" style="padding:var(--sp-4);">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:600;">${r.contrato_id || r.contrato_doc_id} · ${r.cliente_nombre || ''}</div>
              <div style="font-size:13px; color:var(--fg-2); margin-top:2px;">${equipos}</div>
              <div style="font-size:12px; color:var(--fg-3); margin-top:4px;">
                Término: ${this._terminoTxt(r.termino)} · Fin de facturación: <b>${fdate(r.fecha_fin_facturacion)}</b>
              </div>
              <div style="font-size:12px; color:var(--fg-3); margin-top:2px;">
                Solicitó: ${r.solicitado_por_nombre || '—'} · ${fdate(r.fecha_solicitud)}
                ${r.aprobado_por ? ` · ${r.estado === 'rechazada' ? 'Rechazó' : 'Aprobó'}: admin · ${fdate(r.fecha_aprobacion)}` : ''}
                ${r.adjunto_url ? ` · <a href="${r.adjunto_url}" target="_blank" rel="noopener">Ver nota</a>` : ''}
              </div>
              ${r.motivo ? `<div style="font-size:12px; color:var(--fg-3); margin-top:2px;">Obs.: ${r.motivo}</div>` : ''}
            </div>
            <div style="text-align:right;">${pill(r.estado)}${acciones}</div>
          </div>
        </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  _terminoTxt(t) {
    return t === 'fin_mes' ? 'Hasta fin de mes' : t === '30_dias' ? '30 días más' : t === '60_dias' ? '60 días más' : 'Otro';
  },

  async aprobar(id) {
    if (!this.esAprobador()) return;
    if (!window.confirm('¿Aprobar esta baja?')) return;
    try { await CancelacionesService.aprobar(id, firebase.auth().currentUser?.uid); Toast.show('Baja aprobada', 'ok'); this.cargarCola(); }
    catch (e) { console.error(e); Toast.show('No se pudo aprobar', 'bad'); }
  },

  async rechazar(id) {
    if (!this.esAprobador()) return;
    const motivo = window.prompt('Motivo del rechazo (opcional):') || '';
    try { await CancelacionesService.rechazar(id, firebase.auth().currentUser?.uid, motivo); Toast.show('Baja rechazada', 'ok'); this.cargarCola(); }
    catch (e) { console.error(e); Toast.show('No se pudo rechazar', 'bad'); }
  },
};

Cancelaciones.init();
