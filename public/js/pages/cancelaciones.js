// @ts-nocheck
// Enmiendas / terminaciones de contrato — solicitud + cola + aprobación + cierre.
window.Cancelaciones = {
  rol: null,
  filtro: 'pendiente',
  contratoDocId: null,
  contratoActual: null,

  esAprobador() { return this.rol === ROLES.ADMIN || this.rol === ROLES.GERENTE; },
  puedeCerrar() { return this.esAprobador() || this.rol === ROLES.RECEPCION; },

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
    document.getElementById('tipo')?.addEventListener('change', () => this.aplicarTipo());
    document.getElementById('aplicaPenalidad')?.addEventListener('change', (e) => {
      const m = document.getElementById('penalidadMonto'); m.disabled = !e.target.checked; if (!e.target.checked) m.value = '';
    });
    document.getElementById('depositoAccion')?.addEventListener('change', (e) => {
      const m = document.getElementById('depositoMonto'); m.disabled = (e.target.value === 'na'); if (e.target.value === 'na') m.value = '';
    });
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

    // Motivos tipificados.
    document.getElementById('motivoCodigo').innerHTML =
      CancelacionesService.MOTIVOS.map(m => `<option value="${m.codigo}">${m.label}</option>`).join('');

    // Prefill de términos del contrato si existen (gobernanza).
    if (Number(c.deposito_monto || 0) > 0) {
      document.getElementById('depositoAccion').value = 'devolver';
      const dm = document.getElementById('depositoMonto'); dm.disabled = false; dm.value = Number(c.deposito_monto);
    }

    // Bajas previas: aprobadas/cerradas reducen los activos; pendientes reservan.
    const aprob = {}, pend = {};
    try {
      const sols = await CancelacionesService.listarDeContrato(this.contratoDocId);
      for (const s of sols) {
        const bucket = (s.estado === 'aprobada' || s.estado === 'cerrada') ? aprob
          : s.estado === 'pendiente' ? pend : null;
        if (!bucket) continue;
        (s.items || []).forEach(it => {
          const key = String(it.modelo_id || it.modelo || '');
          bucket[key] = (bucket[key] || 0) + Number(it.cantidad || 0);
        });
      }
    } catch (e) { console.warn('No se pudieron leer enmiendas previas', e); }

    const eq = c.equipos || [];
    document.getElementById('solEquipos').innerHTML = eq.length
      ? `<table class="app-table"><thead><tr>
           <th>Modelo</th>
           <th style="text-align:center;">Contratados</th>
           <th style="text-align:center;">De baja</th>
           <th style="text-align:center;">Activos</th>
           <th style="width:210px;">Cancelar</th>
         </tr></thead><tbody>${
          eq.map((e, i) => {
            const key = String(e.modelo_id || e.modelo || '');
            const contratados = Number(e.cantidad || 0);
            const dadosBaja   = Number(aprob[key] || 0);
            const enPendiente = Number(pend[key] || 0);
            const activos     = Math.max(0, contratados - dadosBaja);
            const disponible  = Math.max(0, activos - enPendiente);
            const dis = disponible <= 0 ? 'disabled' : '';
            const nota = disponible <= 0
              ? (activos <= 0
                  ? '<span style="font-size:12px;color:#991b1b;">sin unidades activas</span>'
                  : `<span style="font-size:12px;color:#92400e;">${enPendiente} en solicitud pendiente</span>`)
              : (enPendiente > 0 ? `<span style="font-size:12px;color:#92400e;">${enPendiente} pendiente(s)</span>` : '');
            return `
            <tr>
              <td>${(e.modelo || '—')}</td>
              <td style="text-align:center;">${contratados}</td>
              <td style="text-align:center;">${dadosBaja || '—'}</td>
              <td style="text-align:center; font-weight:600;">${activos}</td>
              <td>
                <input type="number" class="form-input cancelar-cant" data-idx="${i}" data-activos="${activos}" data-disponible="${disponible}" min="0" max="${disponible}" value="0" style="height:32px; width:80px;" ${dis}>
                ${nota}
              </td>
            </tr>`;
          }).join('')
        }</tbody></table>`
      : '<p style="color:var(--fg-3);">Este contrato no tiene equipos.</p>';

    const hoy = new Date().toISOString().slice(0, 10);
    document.getElementById('fechaNota').value = hoy;
    this.aplicarTipo();
    this.actualizarFinPreview();
  },

  // Terminación total → todas las unidades activas (campos en máximo, bloqueados).
  aplicarTipo() {
    const total = document.getElementById('tipo')?.value === 'terminacion_total';
    document.querySelectorAll('.cancelar-cant').forEach(inp => {
      const activos = Number(inp.dataset.activos || 0);
      const disponible = Number(inp.dataset.disponible || 0);
      if (total) {
        inp.value = activos; inp.max = activos; inp.disabled = activos <= 0;
      } else {
        inp.max = disponible; inp.disabled = disponible <= 0; if (inp.value > disponible) inp.value = 0;
      }
    });
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
    const tipo = document.getElementById('tipo').value;
    const totalTerm = tipo === 'terminacion_total';
    const items = [...document.querySelectorAll('.cancelar-cant')]
      .map(inp => ({
        idx: Number(inp.dataset.idx),
        cant: Number(inp.value || 0),
        cap: totalTerm ? Number(inp.dataset.activos || 0) : Number(inp.dataset.disponible || 0),
      }))
      .filter(x => x.cant > 0)
      .map(x => {
        const e = c.equipos[x.idx] || {};
        return { modelo_id: e.modelo_id || '', modelo: e.modelo || '', cantidad: Math.min(x.cant, x.cap, Number(e.cantidad || 0)) };
      })
      .filter(x => x.cantidad > 0);
    if (!items.length) { Toast.show('Indica al menos un equipo activo a cancelar', 'warn'); return; }

    const termino = document.getElementById('termino').value;
    const fechaNota = document.getElementById('fechaNota').value || null;
    const fechaOtra = document.getElementById('fechaOtra')?.value || null;
    const fin = CancelacionesService.calcularFechaFin(termino, fechaNota, fechaOtra);

    const aplicaPenalidad = document.getElementById('aplicaPenalidad').checked;
    const penalidadMonto = aplicaPenalidad ? Number(document.getElementById('penalidadMonto').value || 0) : 0;
    const depositoAccion = document.getElementById('depositoAccion').value;
    const depositoMonto = depositoAccion === 'na' ? 0 : Number(document.getElementById('depositoMonto').value || 0);

    const btn = document.getElementById('btnEnviar');
    btn.disabled = true;
    try {
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
        tipo,
        contrato_doc_id: this.contratoDocId,
        contrato_id: c.contrato_id || '',
        cliente_nombre: c.cliente_nombre || '',
        items,
        termino,
        fecha_fin_facturacion: firebase.firestore.Timestamp.fromDate(fin),
        fecha_nota_cliente: fechaNota,
        adjunto_url: adjuntoUrl,
        motivo_codigo: document.getElementById('motivoCodigo').value || 'otro',
        motivo_detalle: (document.getElementById('motivoDetalle').value || '').trim(),
        aplica_penalidad: aplicaPenalidad,
        penalidad_monto: penalidadMonto,
        deposito_accion: depositoAccion,
        deposito_monto: depositoMonto,
        solicitado_por: uid,
        solicitado_por_nombre: nombre,
      });
      Toast.show('Solicitud enviada', 'ok');
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

    this._rows = rows; // para que cerrar() encuentre la solicitud sin re-consultar
    document.getElementById('colaResumen').textContent = `${rows.length} enmienda(s)`;
    if (!rows.length) { cont.innerHTML = '<p style="color:var(--fg-3);">No hay enmiendas.</p>'; return; }

    const pill = (est) => est === 'aprobada' ? '<span class="estado-pill e-aprob">Aprobada</span>'
      : est === 'cerrada' ? '<span class="estado-pill e-cerr">Cerrada</span>'
      : est === 'rechazada' ? '<span class="estado-pill e-rech">Rechazada</span>'
      : '<span class="estado-pill e-pend">Pendiente</span>';
    const fdate = (ts) => ts?.toDate ? ts.toDate().toLocaleDateString('es-PA') : (ts ? new Date(ts).toLocaleDateString('es-PA') : '—');
    const money = (n) => '$' + Number(n || 0).toFixed(2);

    cont.innerHTML = rows.map(r => {
      const equipos = (r.items || []).map(i => `${i.modelo} ×${i.cantidad}`).join(', ');
      const liquid = [];
      if (r.aplica_penalidad && Number(r.penalidad_monto || 0) > 0) liquid.push(`Penalidad: ${money(r.penalidad_monto)}`);
      if (r.deposito_accion && r.deposito_accion !== 'na') liquid.push(`Depósito: ${r.deposito_accion === 'devolver' ? 'devolver' : 'retener'} ${money(r.deposito_monto)}`);

      let acciones = '';
      if (r.estado === 'pendiente' && this.esAprobador()) {
        acciones = `<div style="display:flex; gap:8px; margin-top:8px;">
             <button class="btn sm btn-primary" onclick="Cancelaciones.aprobar('${r.id}')"><i data-lucide="check"></i> Aprobar</button>
             <button class="btn sm btn-danger" onclick="Cancelaciones.rechazar('${r.id}')"><i data-lucide="x"></i> Rechazar</button>
           </div>`;
      } else if (r.estado === 'aprobada' && this.puedeCerrar()) {
        acciones = `<div style="display:flex; gap:8px; margin-top:8px;">
             <button class="btn sm btn-primary" onclick="Cancelaciones.cerrar('${r.id}')"><i data-lucide="package-check"></i> Cerrar (equipos recibidos)</button>
           </div>`;
      }

      return `
        <div class="ds-card baja-card" style="padding:var(--sp-4);">
          <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap;">
            <div>
              <div style="font-weight:600;">${r.contrato_id || r.contrato_doc_id} · ${r.cliente_nombre || ''}
                <span style="font-weight:400; color:var(--fg-3); font-size:12px;">· ${CancelacionesService.tipoLabel(r.tipo || 'baja_parcial')}</span>
              </div>
              <div style="font-size:13px; color:var(--fg-2); margin-top:2px;">${equipos}</div>
              <div style="font-size:12px; color:var(--fg-3); margin-top:4px;">
                Motivo: ${CancelacionesService.motivoLabel(r.motivo_codigo)} · Fin de facturación: <b>${fdate(r.fecha_fin_facturacion)}</b>
              </div>
              ${liquid.length ? `<div style="font-size:12px; color:var(--fg-3); margin-top:2px;">${liquid.join(' · ')}</div>` : ''}
              <div style="font-size:12px; color:var(--fg-3); margin-top:2px;">
                Solicitó: ${r.solicitado_por_nombre || '—'} · ${fdate(r.fecha_solicitud)}
                ${r.aprobado_por ? ` · ${r.estado === 'rechazada' ? 'Rechazó' : 'Aprobó'}: admin · ${fdate(r.fecha_aprobacion)}` : ''}
                ${r.fecha_cierre ? ` · Cerró: admin · ${fdate(r.fecha_cierre)}` : ''}
                ${r.adjunto_url ? ` · <a href="${r.adjunto_url}" target="_blank" rel="noopener">Ver aviso</a>` : ''}
              </div>
              ${r.motivo_detalle ? `<div style="font-size:12px; color:var(--fg-3); margin-top:2px;">Obs.: ${r.motivo_detalle}</div>` : ''}
              ${r.condicion_notas ? `<div style="font-size:12px; color:var(--fg-3); margin-top:2px;">Condición: ${r.condicion_notas}</div>` : ''}
            </div>
            <div style="text-align:right;">${pill(r.estado)}${acciones}</div>
          </div>
        </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  async aprobar(id) {
    if (!this.esAprobador()) return;
    if (!window.confirm('¿Aprobar esta enmienda?')) return;
    try { await CancelacionesService.aprobar(id, firebase.auth().currentUser?.uid); Toast.show('Enmienda aprobada', 'ok'); this.cargarCola(); }
    catch (e) { console.error(e); Toast.show('No se pudo aprobar', 'bad'); }
  },

  async rechazar(id) {
    if (!this.esAprobador()) return;
    const motivo = window.prompt('Motivo del rechazo (opcional):') || '';
    try { await CancelacionesService.rechazar(id, firebase.auth().currentUser?.uid, motivo); Toast.show('Enmienda rechazada', 'ok'); this.cargarCola(); }
    catch (e) { console.error(e); Toast.show('No se pudo rechazar', 'bad'); }
  },

  // Cierre con registro de ENTRADA por serial: lista las unidades del pool
  // asignadas al contrato para marcar cuáles regresaron y en qué condición; el
  // trigger onCancelacionWrite las pasa a "Entrada — por inspeccionar"
  // (devuelto_revision) con Admin SDK. Contratos sin unidades en el pool
  // (p.ej. legacy sin seriales): cierre simple, como siempre.
  async cerrar(id) {
    if (!this.puedeCerrar()) return;
    const sol = (this._rows || []).find(r => r.id === id);
    let unidades = [];
    if (typeof EquiposPoolService !== 'undefined' && sol?.contrato_doc_id) {
      try {
        unidades = (await EquiposPoolService.listarPorContrato(sol.contrato_doc_id))
          .filter(u => u.estado === EquiposPoolService.ESTADOS.ASIGNADO
                    || u.estado === EquiposPoolService.ESTADOS.EN_CLIENTE);
      } catch (e) { console.warn('No se pudo consultar el pool para el cierre', e); }
    }
    if (!unidades.length) { await this._cerrarSimple(id); return; }
    this._abrirModalEntrada(id, sol, unidades);
  },

  async _cerrarSimple(id) {
    if (!window.confirm('¿Confirmas que los equipos fueron recuperados? Esto cierra la enmienda.')) return;
    const cond = window.prompt('Condición de los equipos recibidos (opcional):') || '';
    try { await CancelacionesService.cerrar(id, firebase.auth().currentUser?.uid, { equiposRecibidos: true, condicionNotas: cond }); Toast.show('Enmienda cerrada', 'ok'); this.cargarCola(); }
    catch (e) { console.error(e); Toast.show('No se pudo cerrar', 'bad'); }
  },

  _abrirModalEntrada(id, sol, unidades) {
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
    const esperadas = (sol.items || []).reduce((s, it) => s + Number(it.cantidad || 0), 0);
    const esTotal = sol.tipo === 'terminacion_total';

    const filas = unidades.map(u => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#eee);">
          <input type="checkbox" class="ent-check" value="${esc(u.id)}"
                 data-serial="${esc(u.serial || u.serial_norm)}" data-modelo="${esc(u.modelo_label || '')}"
                 data-modelo-id="${esc(u.modelo_id || '')}"
                 style="width:16px;height:16px;">
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#eee);font-family:var(--font-mono,monospace);">${esc(u.serial || u.serial_norm)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#eee);">${esc(u.modelo_label || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#eee);">${EquiposPoolService.chipEstadoHtml(u.estado)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#eee);">
          <select class="ent-cond form-select" disabled style="height:30px;font-size:12px;">
            <option value="bueno">Buen estado</option>
            <option value="danado">Dañado</option>
          </select>
        </td>
      </tr>`).join('');

    const overlay = document.createElement('div');
    overlay.id = 'overlayEntradaEquipos';
    overlay.className = 'modal-backdrop';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.innerHTML = `
      <div class="modal" style="max-width:680px;width:100%;">
        <div class="modal-header">
          <h3 class="modal-title"><i data-lucide="package-check"></i> Registrar entrada de equipos</h3>
          <button type="button" class="modal-close" data-ent="cancelar" aria-label="Cerrar"><i data-lucide="x" style="width:18px;height:18px;"></i></button>
        </div>
        <div class="modal-body" style="max-height:56vh;overflow:auto;">
          <p style="margin:0 0 10px;font-size:13px;color:var(--fg-3);">
            <b>${esc(sol.contrato_id || sol.contrato_doc_id)}</b> · ${esc(sol.cliente_nombre || '')} ·
            ${esTotal ? 'terminación total' : `baja parcial de <b>${esperadas}</b> unidad(es)`}.
            Marca las unidades que el cliente devolvió y su condición; pasarán a
            <b>"Entrada — por inspeccionar"</b> y se creará automáticamente una
            <b>orden de ENTRADA</b> en la cola del taller (recepción y el vendedor
            reciben el aviso por correo).
          </p>
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:560px;">
            <thead>
              <tr style="text-align:left;color:var(--fg-3);font-size:12px;">
                <th style="padding:6px 8px;"></th>
                <th style="padding:6px 8px;">Serial</th>
                <th style="padding:6px 8px;">Modelo</th>
                <th style="padding:6px 8px;">Estado</th>
                <th style="padding:6px 8px;">Condición</th>
              </tr>
            </thead>
            <tbody>${filas}</tbody>
          </table>
          <div style="margin-top:12px;">
            <label class="form-label" for="entNotas">Notas de la entrada (opcional)</label>
            <textarea id="entNotas" class="form-input" rows="2" placeholder="Ej: falta antena en una unidad, cargadores no devueltos…" style="width:100%;font-family:inherit;font-size:13px;"></textarea>
          </div>
        </div>
        <div class="modal-footer">
          <span id="entCount" class="ts" style="margin-right:auto;align-self:center;">0 de ${unidades.length} marcadas</span>
          <button type="button" class="btn btn-ghost" data-ent="cancelar">Cancelar</button>
          <button type="button" class="btn btn-primary" data-ent="confirmar"><i data-lucide="check"></i> Registrar entrada y cerrar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const refrescar = () => {
      const n = overlay.querySelectorAll('.ent-check:checked').length;
      const c = overlay.querySelector('#entCount');
      if (c) c.textContent = `${n} de ${unidades.length} marcadas` +
        (esperadas && !esTotal ? ` · la enmienda da de baja ${esperadas}` : '');
    };
    overlay.addEventListener('change', (e) => {
      if (!e.target.classList?.contains('ent-check')) return;
      const sel = e.target.closest('tr')?.querySelector('.ent-cond');
      if (sel) sel.disabled = !e.target.checked;
      refrescar();
    });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) { overlay.remove(); return; }
      const btn = e.target.closest('[data-ent]');
      if (!btn) return;
      if (btn.getAttribute('data-ent') === 'cancelar') { overlay.remove(); return; }
      if (btn.getAttribute('data-ent') === 'confirmar') this._confirmarEntrada(id);
    });
    if (window.lucide) lucide.createIcons();
  },

  async _confirmarEntrada(id) {
    const overlay = document.getElementById('overlayEntradaEquipos');
    if (!overlay) return;
    const entradas = [...overlay.querySelectorAll('.ent-check:checked')].map(c => ({
      pool_doc_id: c.value,
      serial: c.getAttribute('data-serial') || '',
      modelo: c.getAttribute('data-modelo') || '',
      modelo_id: c.getAttribute('data-modelo-id') || null,
      condicion: c.closest('tr')?.querySelector('.ent-cond')?.value || 'bueno',
    }));
    if (!entradas.length
        && !window.confirm('No marcaste ninguna unidad recibida. ¿Cerrar la enmienda sin registrar entradas?')) return;
    const notas = (overlay.querySelector('#entNotas')?.value || '').trim();
    const btn = overlay.querySelector('[data-ent="confirmar"]');
    if (btn) btn.disabled = true;
    try {
      await CancelacionesService.cerrar(id, firebase.auth().currentUser?.uid, {
        equiposRecibidos: entradas.length > 0,
        condicionNotas: notas,
        entradas,
      });
      overlay.remove();
      Toast.show(entradas.length
        ? `Enmienda cerrada. ${entradas.length} unidad(es) a inspección — se creó la orden de ENTRADA para el taller.`
        : 'Enmienda cerrada.', 'ok');
      this.cargarCola();
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cerrar', 'bad');
      if (btn) btn.disabled = false;
    }
  },
};

Cancelaciones.init();
