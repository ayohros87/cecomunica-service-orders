// @ts-nocheck
// Equipos section — peek tooltip, equipos modal, trabajo panel, backfill
window.ContratosEquipos = {
  _cache:       new Map(),   // contratoDocId → { html, hasOrders, fetchedAt }
  _tipEl:       null,
  _activePeek:  null,
  _panelRows:   [],

  // ── Icon rendering in the list table ───────────────────────────
  cargarIconos() {
    document.querySelectorAll('tbody tr[data-contrato-doc-id]').forEach(fila => {
      const id     = fila.getAttribute('data-contrato-doc-id');
      const celda  = fila.querySelector('td[data-contrato-equipos]');
      if (!celda || !id) return;

      const c = CS.contratos.find(x => x.id === id);
      if (!c) { celda.innerHTML = '<span style="opacity:0.3;">—</span>'; return; }

      const osLinked = !!(c.os_linked || c.tiene_os || (c.os_count ?? 0) > 0);
      const osCount  = Number(c.os_count || 0);
      const serials  = c.os_serials_preview || [];

      if (osLinked) {
        const display = osCount > 1 ? `📦${osCount}` : '📦';
        celda.innerHTML = `<span class="equipos-peek" data-contrato-doc="${id}">${display}</span>`;
      } else {
        celda.innerHTML = '<span style="opacity:0.3;" title="Sin órdenes asociadas">⬜</span>';
      }
    });
  },

  // ── Tooltip ─────────────────────────────────────────────────────
  async _fetchPreview(id) {
    const cached = this._cache.get(id);
    if (cached && (Date.now() - cached.fetchedAt < 60000)) return cached;
    const esc = CS.esc.bind(CS);
    try {
      const ordenes = await ContratosService.getOrdenesDeContrato(id, { limit: 5 });
      let totalOrdenes = 0, totalEquipos = 0;
      const lines = [];
      for (const x of ordenes) {
        const orden = await OrdenesService.getOrder(x.id);
        if (!orden || orden.eliminado === true) continue;
        totalOrdenes++;
        const count = Number(x.equipos_count || 0);
        totalEquipos += count;
        const sample = (x.serials || []).slice(0, 3).join(', ');
        lines.push(`<div class="tooltip-line"><strong>OS ${esc(x.numero_orden)}</strong>: ${count} equipos${sample ? ' · ' + esc(sample) : ''}</div>`);
      }
      const html = ordenes.length === 0
        ? `<div class="tooltip-line">No hay órdenes asociadas.</div>`
        : `<div class="tooltip-line"><strong>${totalOrdenes}</strong> órdenes · <strong>${totalEquipos}</strong> equipos (últimas 5)</div>
           ${lines.join('')}
           <div class="tooltip-line" style="margin-top:8px; opacity:.8;">Click para ver detalle</div>`;
      const result = { html, hasOrders: ordenes.length > 0, fetchedAt: Date.now() };
      this._cache.set(id, result);
      return result;
    } catch (err) {
      console.error('Error cargando preview de equipos:', err);
      return { html: `<div class="tooltip-line" style="color:red;">Error al cargar equipos</div>`, hasOrders: false, fetchedAt: Date.now() };
    }
  },

  _showTip(html, x, y) {
    if (!this._tipEl) {
      this._tipEl = document.createElement('div');
      this._tipEl.id = 'equiposTooltip';
      document.body.appendChild(this._tipEl);
    }
    this._tipEl.innerHTML = html;
    this._tipEl.style.left    = Math.min(x + 12, window.innerWidth  - 440) + 'px';
    this._tipEl.style.top     = Math.min(y + 12, window.innerHeight - 220) + 'px';
    this._tipEl.style.display = 'block';
  },

  _hideTip() {
    if (this._tipEl) this._tipEl.style.display = 'none';
  },

  // ── Equipos modal ───────────────────────────────────────────────
  async abrirModal(id) {
    const esc = CS.esc.bind(CS);
    try {
      const ordenes = await ContratosService.getOrdenesDeContratoCompleto(id);
      const rows = [];
      for (const x of ordenes) {
        const orden = await OrdenesService.getOrder(x.id);
        if (!orden || orden.eliminado === true) continue;
        (x.equipos || []).forEach(eq => {
          rows.push(`
            <tr>
              <td style="border:1px solid var(--line); padding:6px;">${esc(x.numero_orden || '')}</td>
              <td style="border:1px solid var(--line); padding:6px;">${esc(eq.serial || '')}</td>
              <td style="border:1px solid var(--line); padding:6px;">${esc(eq.modelo || '')}</td>
              <td style="border:1px solid var(--line); padding:6px;">${esc(eq.observaciones ?? eq.descripcion ?? '')}</td>
            </tr>`);
        });
      }
      document.getElementById('modalEquiposBody').innerHTML = `
        <div style="margin-bottom:10px; font-weight:700;">Equipos asociados (${rows.length})</div>
        <div class="table-scroll">
          <table style="width:100%; border-collapse:collapse; font-size:14px; min-width:720px;">
            <thead style="background:#f5f5f5;">
              <tr>
                <th style="border:1px solid var(--line); padding:6px;">OS</th>
                <th style="border:1px solid var(--line); padding:6px;">Serial</th>
                <th style="border:1px solid var(--line); padding:6px;">Modelo</th>
                <th style="border:1px solid var(--line); padding:6px;">Observaciones</th>
              </tr>
            </thead>
            <tbody>${rows.join('') || `<tr><td colspan="4" style="padding:10px; text-align:center;">No hay equipos.</td></tr>`}</tbody>
          </table>
        </div>`;
      Modal.open('overlayEquiposContrato');
    } catch (err) {
      console.error('Error abriendo modal de equipos:', err);
      alert('Error al cargar equipos: ' + err.message);
    }
  },

  cerrarModal() { Modal.close('overlayEquiposContrato'); },

  // ── Trabajo panel ────────────────────────────────────────────────
  async abrirPanel(id) {
    const esc = CS.esc.bind(CS);
    try {
      const contrato = await ContratosService.getContrato(id);
      if (!contrato) { alert('Contrato no encontrado.'); return; }
      const contratoIdVisible = contrato.contrato_id || id;
      const equipos = Array.isArray(contrato.equipos) ? contrato.equipos : [];
      this._panelRows = equipos.map(eq => ({
        contratoId: contratoIdVisible,
        modelo:     String(eq?.modelo || '-').trim() || '-',
        cantidad:   Number(eq?.cantidad || 0),
        precio:     Number(eq?.precio   || 0)
      }));
      const rowsHtml = this._panelRows.map((row, idx) => `
        <tr>
          <td style="border:1px solid var(--line); padding:6px;">${esc(row.contratoId)}</td>
          <td style="border:1px solid var(--line); padding:6px;">${esc(row.modelo)}</td>
          <td style="border:1px solid var(--line); padding:6px; text-align:right;">${row.cantidad}</td>
          <td style="border:1px solid var(--line); padding:6px; text-align:right;">$${row.precio.toFixed(2)}</td>
          <td style="border:1px solid var(--line); padding:6px; text-align:center;">
            <button class="btn" onclick="ContratosEquipos.copiarFila(${idx})" title="Copiar fila">📋</button>
          </td>
        </tr>`).join('');
      document.getElementById('panelTrabajoBody').innerHTML = `
        <div style="margin-bottom:10px; font-weight:700;">Panel de trabajo (${this._panelRows.length} fila${this._panelRows.length === 1 ? '' : 's'})</div>
        <div class="table-scroll">
          <table style="width:100%; border-collapse:collapse; font-size:14px; min-width:760px;">
            <thead style="background:#f5f5f5;">
              <tr>
                <th style="border:1px solid var(--line); padding:6px;">ID del contrato</th>
                <th style="border:1px solid var(--line); padding:6px;">Modelo</th>
                <th style="border:1px solid var(--line); padding:6px;">Cantidad</th>
                <th style="border:1px solid var(--line); padding:6px;">Precio Unitario</th>
                <th style="border:1px solid var(--line); padding:6px;">Acción</th>
              </tr>
            </thead>
            <tbody>${rowsHtml || `<tr><td colspan="5" style="padding:10px; text-align:center;">No hay equipos en este contrato.</td></tr>`}</tbody>
          </table>
        </div>`;
      Modal.open('overlayPanelTrabajo');
    } catch (err) {
      console.error('Error abriendo panel de trabajo:', err);
      alert('No se pudo abrir el panel de trabajo.');
    }
  },

  async copiarFila(idx) {
    const row = this._panelRows[idx];
    if (!row) return;
    const texto = `${row.contratoId}\t${row.modelo}\t${row.cantidad}\t${row.precio.toFixed(2)}`;
    try {
      await navigator.clipboard.writeText(texto);
      Toast.show('✅ Fila copiada al portapapeles.', 'ok');
    } catch {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      Toast.show('✅ Fila copiada al portapapeles.', 'ok');
    }
  },

  cerrarPanel() { Modal.close('overlayPanelTrabajo'); },
  limpiarCache() { this._cache.clear(); alert('✅ Caché de equipos limpiado.'); this.cargarIconos(); },

  // ── Backfill (admin only) ────────────────────────────────────────
  async _backfillContrato(id) {
    const subcDocs = await ContratosService.getOrdenesDeContratoCompleto(id, { limit: 200 });
    let procesadas = 0;
    for (const cacheDoc of subcDocs) {
      const orden = await OrdenesService.getOrder(cacheDoc.id);
      if (!orden || orden.eliminado === true) continue;
      const equipos = Array.isArray(orden.equipos) ? orden.equipos.filter(e => !e.eliminado) : [];
      const serials = equipos.map(e => (e?.serial || e?.SERIAL || '').toString().trim()).filter(Boolean);
      await ContratosService.linkOrden(id, cacheDoc.id, {
        numero_orden: cacheDoc.id,
        cliente_id: orden.cliente_id || null,
        cliente_nombre: orden.cliente_nombre || null,
        tipo_de_servicio: orden.tipo_de_servicio || null,
        estado_reparacion: orden.estado_reparacion || null,
        fecha_creacion: orden.fecha_creacion || null,
        equipos: equipos.map(e => ({
          serial:      (e?.serial || e?.SERIAL || e?.numero_de_serie || '').toString().trim(),
          modelo:      e?.modelo || e?.MODEL || e?.modelo_nombre || '',
          descripcion: e?.observaciones || e?.descripcion || e?.nombre || '',
          unit_id:     e?.unit_id || e?.unitId || '',
          sim:         e?.sim || e?.simcard || ''
        })),
        equipos_count: equipos.length,
        serials,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      procesadas++;
    }
    return procesadas;
  },

  async backfillTodos() {
    if (!AUTH.is(ROLES.ADMIN)) { alert('❌ Solo administradores pueden ejecutar esta acción.'); return; }
    if (!confirm('🔄 Esta operación re-sincronizará los equipos de TODOS los contratos.\n\nPuede tardar varios segundos.\n\n¿Continuar?')) return;
    const btn = document.getElementById('btnBackfillEquipos');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ Procesando...'; }
    try {
      const contratos = await ContratosService.getContratosActivosAprobados();
      let totalContratos = 0, totalOrdenes = 0;
      for (const c of contratos) { totalOrdenes += await this._backfillContrato(c.id); totalContratos++; }
      alert(`✅ Backfill completado\n\nContratos procesados: ${totalContratos}\nÓrdenes actualizadas: ${totalOrdenes}`);
      this._cache.clear();
      await ContratosLista.cargar(true);
    } catch (err) {
      console.error('Error en backfill global:', err);
      alert('❌ Error durante el backfill: ' + err.message);
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Re-sincronizar equipos (admin)'; }
    }
  },

  // ── Event wiring ────────────────────────────────────────────────
  init() {
    const self = this;

    document.addEventListener('pointerover', async (e) => {
      const el = e.target.closest('.equipos-peek');
      if (!el) return;
      self._activePeek = el;
      const id = el.getAttribute('data-contrato-doc');
      const result = await self._fetchPreview(id);
      if (self._activePeek !== el) return;
      self._showTip(result.html, e.clientX, e.clientY);
    });

    document.addEventListener('pointermove', (e) => {
      if (!self._activePeek || !self._tipEl || self._tipEl.style.display !== 'block') return;
      self._tipEl.style.left = Math.min(e.clientX + 12, window.innerWidth  - 440) + 'px';
      self._tipEl.style.top  = Math.min(e.clientY + 12, window.innerHeight - 220) + 'px';
    });

    document.addEventListener('pointerout', (e) => {
      const leaving = e.target.closest('.equipos-peek');
      if (!leaving) return;
      if (e.relatedTarget?.closest?.('.equipos-peek')) return;
      if (self._activePeek === leaving) self._activePeek = null;
      self._hideTip();
    });

    window.addEventListener('scroll',   () => { self._activePeek = null; self._hideTip(); }, { passive: true });
    window.addEventListener('blur',     () => { self._activePeek = null; self._hideTip(); });
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.equipos-peek')) { self._activePeek = null; self._hideTip(); }
    });

    document.addEventListener('click', async (e) => {
      const el = e.target.closest('.equipos-peek');
      if (!el) return;
      self._hideTip();
      await self.abrirModal(el.getAttribute('data-contrato-doc'));
    });
  }
};

ContratosEquipos.init();
