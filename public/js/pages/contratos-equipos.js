// @ts-nocheck
// Equipos section — peek tooltip, equipos modal, trabajo panel, backfill
window.ContratosEquipos = {
  _cache:       new Map(),   // contratoDocId → { html, hasOrders, fetchedAt }
  _tipEl:       null,
  _activePeek:  null,
  _panelRows:   [],

  // ── Icon rendering in the list table ───────────────────────────
  cargarIconos() {
    // Map por id (antes: CS.contratos.find() POR FILA — O(n²) sobre 40) y un
    // solo pintado de iconos al final (antes: createIcons({nodes}) POR FILA).
    const porId  = new Map(CS.contratos.map(x => [x.id, x]));
    const celdas = [];
    document.querySelectorAll('tbody tr[data-contrato-doc-id]').forEach(fila => {
      const id     = fila.getAttribute('data-contrato-doc-id');
      const celda  = fila.querySelector('td[data-contrato-equipos]');
      if (!celda || !id) return;

      const c = porId.get(id);
      if (!c) { celda.innerHTML = '<span style="opacity:0.3;">—</span>'; return; }

      // Conteo de unidades activas del contrato (contratado − dado de baja).
      const total   = (c.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0);
      const activos = Math.max(0, total - Number(c.baja_cancelado_total || 0));
      const countTxt = total > 0
        ? (activos < total
            ? `<span title="${activos} activos de ${total} contratados"><b>${activos}</b><span style="color:var(--fg-3);">/${total}</span></span>`
            : `<span title="${total} equipos contratados"><b>${total}</b></span>`)
        : '<span style="opacity:0.3;">—</span>';

      // Peek de órdenes vinculadas (secundario), conserva el tooltip al pasar el mouse.
      const osLinked = !!(c.os_linked || c.tiene_os || (c.os_count ?? 0) > 0);
      const peek = osLinked
        ? `<span class="equipos-peek" data-contrato-doc="${id}" title="Órdenes vinculadas" style="opacity:0.55;"><i data-lucide="package" style="width:14px;height:14px;"></i></span>`
        : '';

      // Grid 1fr/auto/1fr: el conteo queda SIEMPRE centrado en la celda; el
      // icono de órdenes vinculadas vive en la columna derecha y no descuadra
      // el número (antes el text-align:center centraba número+icono juntos).
      celda.innerHTML = `<span style="display:grid; grid-template-columns:1fr auto 1fr; align-items:center; width:100%;">
        <span></span>
        <span>${countTxt}</span>
        <span style="justify-self:start; margin-left:4px;">${peek}</span>
      </span>`;
      celdas.push(celda);
    });
    if (celdas.length) {
      if (window.Icons) Icons.pintar(celdas);
      else if (window.lucide) lucide.createIcons({ nodes: celdas });
    }
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
      this._tipEl.className = 'tooltip-floating';
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

  // Sección "unidades del pool": el estado FÍSICO actual de cada unidad
  // asignada a este contrato (equipos_pool), con serial → kardex. Best-effort:
  // si el servicio no está, el rol no puede leer el pool o la consulta falla,
  // simplemente no se muestra (el modal de órdenes sigue funcionando igual).
  async _fetchUnidades(id) {
    if (typeof EquiposPoolService === 'undefined') return [];
    try { return await EquiposPoolService.listarPorContrato(id); }
    catch (e) { return []; }
  },

  // Venta con contrato de servicio: el tipo "Propio" (mismo criterio que
  // functions/onSerialWrite — mantener sincronizados). En estos contratos los
  // radios se FACTURAN, y la factura QBO se asocia aquí (antes no había dónde:
  // el asistente de venta de bodega solo acepta unidades en_bodega, y con los
  // seriales ya asignados al contrato la venta quedaba sin registro).
  _esVentaPropio(c) {
    return !!c && (c.tipo_contrato === 'Propio' || c.codigo_tipo === 'PROP');
  },

  // "Ruta del equipo" (P5 auditoría 2026-07-24): responde "¿en qué paso va
  // esto?" sin ir al inventario — seriales → programación → entrega →
  // devolución. El paso pendiente que libera el ciclo queda señalado.
  _rutaHtml(contrato, ordenes, unidades) {
    if (!contrato) return '';
    const esc = CS.esc.bind(CS);
    const paso = (estado, titulo, detalle) => {
      const css = estado === 'done' ? 'color:#067647; border-color:#067647; background:#e9f7f0;'
        : estado === 'now' ? 'color:#92400e; border-color:#f59e0b; background:#fffbeb;'
        : 'color:var(--fg-3); border-color:var(--line);';
      const icono = estado === 'done' ? '✓ ' : estado === 'now' ? '● ' : '';
      return `<span style="display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600;
        padding:4px 11px; border:1px solid; border-radius:99px; white-space:nowrap; ${css}"
        title="${esc(detalle || '')}">${icono}${esc(titulo)}</span>`;
    };
    const flecha = '<span style="color:var(--fg-3); padding:0 5px;">→</span>';

    const total = Math.max(0, (contrato.equipos || []).reduce((s, e) => s + Number(e.cantidad || 0), 0)
      - Number(contrato.baja_cancelado_total || 0));
    const conSerial = Number(contrato.seriales_count || 0) + Number(contrato.seriales_omitidos_count || 0);
    const serialesOk = contrato.seriales_estado === 'asignados' || contrato.seriales_estado === 'legacy';
    const p1 = paso(serialesOk ? 'done' : (conSerial > 0 ? 'now' : 'now'),
      `Seriales ${Math.min(conSerial, total || conSerial)}/${total || '?'}`,
      serialesOk ? 'Seriales confirmados' : 'Se asignan en la página de Seriales del contrato');

    const ordenesVivas = (ordenes || []).length;
    const p2 = paso(ordenesVivas ? 'done' : (serialesOk ? 'now' : 'next'),
      ordenesVivas ? `Programación · ${ordenesVivas} orden(es)` : 'Programación',
      ordenesVivas ? 'Ya hay órdenes vinculadas' : 'Falta crear la orden de programación');

    const enCliente = (unidades || []).filter(u => u.estado === 'en_cliente').length;
    const entregaOk = contrato.entrega_confirmada === true;
    const p3 = paso(entregaOk ? 'done' : (ordenesVivas ? 'now' : 'next'),
      entregaOk ? 'Entrega registrada' : `Entrega ${enCliente}/${(unidades || []).length || total || '?'}`,
      entregaOk ? 'La orden se marcó ENTREGADO AL CLIENTE'
        : 'El paso que libera el ciclo: marcar la orden como ENTREGADO AL CLIENTE cuando el cliente reciba');

    const p4 = contrato.orden_devolucion_id
      ? flecha + paso('now', 'Devolución de salientes',
          `Tiquete DEVOLUCIÓN ${contrato.orden_devolucion_id} — pendiente de check-in`)
      : '';

    // Contratos "Propio": la venta debe quedar facturada. El paso va PRIMERO
    // (lo ideal es facturar antes de entregar — Zuleika 2026-09-03) pero no
    // bloquea nada: se puede registrar en cualquier momento.
    const fv = contrato.factura_venta;
    const p0 = this._esVentaPropio(contrato)
      ? paso(fv?.numero ? 'done' : 'now',
          fv?.numero ? `Factura ${fv.numero}` : 'Factura QBO',
          fv?.numero ? `Factura QBO registrada por ${fv.por_email || '—'}`
            : 'Venta sin factura asociada — regístrala con el botón "Registrar factura de venta"') + flecha
      : '';

    return `<div style="display:flex; align-items:center; flex-wrap:wrap; gap:4px; margin-bottom:16px;
      padding:10px 12px; border:1px solid var(--line); border-radius:8px; background:var(--bg-2, #fafafa);">
      ${p0}${p1}${flecha}${p2}${flecha}${p3}${p4}
    </div>`;
  },

  // Sección de la factura de venta (solo contratos "Propio"): estado + acción.
  // El botón se gatea por rol registrar-factura-venta (roles.js); el piso real
  // vive en rules (tocaFacturaVenta en contratos + puedeGestionarSeriales en el
  // pool).
  _seccionFacturaHtml(contrato) {
    if (!this._esVentaPropio(contrato)) return '';
    const esc = CS.esc.bind(CS);
    const fv = contrato.factura_venta || null;
    const puede = typeof canRole === 'function' && canRole(window.userRole, 'registrar-factura-venta');
    const fecha = fv?.at?.toDate ? ' · ' + fv.at.toDate().toLocaleDateString('es-PA') : '';
    const estadoTxt = fv?.numero
      ? `Factura QBO <b style="font-family:var(--font-mono,monospace);">${esc(fv.numero)}</b>
         <span style="color:var(--fg-3);">· registrada por ${esc(fv.por_email || '—')}${fecha}</span>`
      : `<span style="color:#92400e; font-weight:600;">Venta sin factura asociada.</span>
         <span style="color:var(--fg-3);">El número de la factura QBO queda en el contrato y en cada serial asignado.</span>`;
    const btn = puede
      ? `<button class="btn" onclick="ContratosEquipos.registrarFactura('${esc(contrato.id)}')">
           <i data-lucide="receipt"></i> ${fv?.numero ? 'Corregir factura' : 'Registrar factura de venta'}</button>`
      : '';
    return `<div style="display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap:wrap;
        margin-bottom:16px; padding:10px 12px; border:1px solid var(--line); border-radius:8px;
        background:${fv?.numero ? 'var(--bg-2, #fafafa)' : '#fffbeb'};">
      <div style="font-size:13px;">${estadoTxt}</div>${btn}
    </div>`;
  },

  // Registrar (o corregir) la factura QBO de la venta: escribe el contrato y
  // espeja en cada unidad del pool asignada, SIN tocar su estado. Los seriales
  // que bodega asigne después la heredan solos (onSerialWrite).
  async registrarFactura(id) {
    const esc = CS.esc.bind(CS);
    if (!(typeof canRole === 'function' && canRole(window.userRole, 'registrar-factura-venta'))) {
      Toast.show('Tu rol no puede registrar la factura de venta.', 'bad'); return;
    }
    try {
      const contrato = await ContratosService.getContrato(id);
      if (!contrato) { Toast.show('Contrato no encontrado.', 'bad'); return; }
      const actual = contrato.factura_venta?.numero || '';
      const numero = await Modal.prompt({
        title: actual ? 'Corregir factura de venta' : 'Registrar factura de venta',
        message: `Número de la factura de QuickBooks de la venta del contrato
          <b>${esc(contrato.contrato_id || id)}</b> (${esc(contrato.cliente_nombre || '—')}).`,
        defaultValue: actual,
        placeholder: '001-0000010274',
      });
      if (numero === null) return;
      const num = (numero || '').trim();
      if (!num) { Toast.show('Escribe el número de la factura.', 'bad'); return; }
      if (num === actual) { Toast.show('Ese número ya está registrado.', 'ok'); return; }

      const unidades = await this._fetchUnidades(id);
      const detalle = unidades.slice(0, 12)
        .map(u => `<span style="font-family:var(--font-mono,monospace);">${esc(u.serial || u.serial_norm)}</span>`)
        .join(', ') + (unidades.length > 12 ? ` … (+${unidades.length - 12})` : '');
      const msg = unidades.length
        ? `La factura <b>${esc(num)}</b> quedará asociada al contrato y a sus
           <b>${unidades.length}</b> unidad(es) del pool:<br><br>${detalle}`
        : `El contrato aún no tiene seriales en el pool: la factura <b>${esc(num)}</b>
           queda registrada en el contrato y se asociará sola a cada serial que bodega asigne.`;
      if (!await Modal.confirm({
        title: 'Confirmar factura de venta', message: msg,
        confirmLabel: actual ? 'Corregir' : 'Registrar',
      })) return;

      const user = firebase.auth().currentUser;
      await ContratosService.registrarFacturaVenta(id, { numero: num }, user);
      let ok = 0; const errores = [];
      for (const u of unidades) {
        try {
          await EquiposPoolService.estamparFacturaContrato(u.id, {
            factura: num,
            cliente_id:      contrato.cliente_id || '',
            cliente_nombre:  contrato.cliente_nombre || '',
            contrato_doc_id: id,
            contrato_id:     contrato.contrato_id || '',
          }, user);
          ok++;
        } catch (e) { errores.push(`${u.serial || u.id}: ${e.message || e}`); }
      }
      let fin = `Factura ${num} registrada en el contrato${unidades.length ? ` y en ${ok} unidad(es)` : ''}.`;
      if (errores.length) fin += ` ${errores.length} fallaron: ${errores.join(' · ')}`;
      Toast.show(fin, errores.length ? 'warn' : 'ok');
      await this.abrirModal(id); // repintar la ruta y la sección con la factura puesta
    } catch (e) {
      console.error('Error al registrar la factura de venta:', e);
      Toast.show('Error al registrar la factura: ' + (e.message || e), 'bad');
    }
  },

  _seccionPoolHtml(unidades) {
    if (!unidades.length) return '';
    const esc = CS.esc.bind(CS);

    // Resumen por estado ("2 en cliente · 1 en taller") antes del detalle.
    const porEstado = new Map();
    unidades.forEach(u => porEstado.set(u.estado, (porEstado.get(u.estado) || 0) + 1));
    const resumen = [...porEstado.entries()]
      .map(([est, n]) => `<span style="white-space:nowrap;"><b>${n}</b> ${EquiposPoolService.chipEstadoHtml(est)}</span>`)
      .join(' <span style="color:var(--fg-3);">·</span> ');

    const filas = unidades.map(u => `
      <tr>
        <td style="border:1px solid var(--line); padding:6px; font-family:var(--font-mono,monospace);">
          <a class="eq-link" href="${EquiposPoolService.kardexUrl(u.serial || u.serial_norm)}" title="Ver ficha del equipo" onclick="if(window.EquipoFicha){event.preventDefault();EquipoFicha.abrir('${esc(u.serial || u.serial_norm)}');}">${esc(u.serial || u.serial_norm)}</a>
          ${u.verificado === false ? '<span class="eqpool-noverif" title="Creado por migración automática — pendiente de confirmación">SIN VERIFICAR</span>' : ''}
        </td>
        <td style="border:1px solid var(--line); padding:6px;">${esc(u.modelo_label || '—')}</td>
        <td style="border:1px solid var(--line); padding:6px;">${EquiposPoolService.chipEstadoHtml(u.estado)} ${EquiposPoolService.chipPendienteDevolucionHtml(u)}</td>
        <td style="border:1px solid var(--line); padding:6px;">${u.condicion === 'reuso' ? 'Refurbished' : 'Nuevo'}</td>
      </tr>`).join('');

    return `
      <div style="margin-bottom:6px; font-weight:700;">Unidades del contrato — estado actual (${unidades.length})</div>
      <div style="margin-bottom:10px; font-size:13px;">${resumen}</div>
      <div class="table-scroll" style="margin-bottom:18px;">
        <table style="width:100%; border-collapse:collapse; font-size:14px; min-width:560px;">
          <thead style="background:#f5f5f5;">
            <tr>
              <th style="border:1px solid var(--line); padding:6px;">Serial</th>
              <th style="border:1px solid var(--line); padding:6px;">Modelo</th>
              <th style="border:1px solid var(--line); padding:6px;">Estado</th>
              <th style="border:1px solid var(--line); padding:6px;">Condición</th>
            </tr>
          </thead>
          <tbody>${filas}</tbody>
        </table>
      </div>`;
  },

  // ── Equipos modal ───────────────────────────────────────────────
  async abrirModal(id) {
    const esc = CS.esc.bind(CS);
    try {
      const [contrato, unidades, ordenes] = await Promise.all([
        ContratosService.getContrato(id).catch(() => null),
        this._fetchUnidades(id),
        ContratosService.getOrdenesDeContratoCompleto(id),
      ]);
      const seccionPool = this._seccionPoolHtml(unidades);
      const ruta = this._rutaHtml(contrato, ordenes, unidades);
      const seccionFactura = this._seccionFacturaHtml(contrato);
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
        ${ruta}
        ${seccionFactura}
        ${seccionPool}
        <div style="margin-bottom:10px; font-weight:700;">Equipos en órdenes vinculadas (${rows.length})</div>
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
      // El botón de la factura trae icono lucide; el resto del modal es texto.
      const body = document.getElementById('modalEquiposBody');
      if (window.Icons) Icons.pintar([body]);
      else if (window.lucide) lucide.createIcons({ nodes: [body] });
      Modal.open('overlayEquiposContrato');
    } catch (err) {
      console.error('Error abriendo modal de equipos:', err);
      Toast.show('Error al cargar equipos: ' + err.message, 'bad');
    }
  },

  cerrarModal() { Modal.close('overlayEquiposContrato'); },

  // ── Trabajo panel ────────────────────────────────────────────────
  async abrirPanel(id) {
    const esc = CS.esc.bind(CS);
    try {
      const contrato = await ContratosService.getContrato(id);
      if (!contrato) { Toast.show('Contrato no encontrado.', 'bad'); return; }
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
            <button class="btn" onclick="ContratosEquipos.copiarFila(${idx})" aria-label="Copiar fila" title="Copiar fila"><i data-lucide="clipboard"></i></button>
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
      if (window.lucide) lucide.createIcons({ nodes: [document.getElementById('panelTrabajoBody')] });
      Modal.open('overlayPanelTrabajo');
    } catch (err) {
      console.error('Error abriendo panel de trabajo:', err);
      Toast.show('No se pudo abrir el panel de trabajo.', 'bad');
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
  limpiarCache() { this._cache.clear(); Toast.show('Caché de equipos limpiado.', 'ok'); this.cargarIconos(); },

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
    if (!AUTH.is(ROLES.ADMIN)) { Toast.show('Solo administradores pueden ejecutar esta acción.', 'bad'); return; }
    if (!await Modal.confirm({ message: 'Esta operación re-sincronizará los equipos de TODOS los contratos. Puede tardar varios segundos. ¿Continuar?' })) return;
    const btn = document.getElementById('btnBackfillEquipos');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i data-lucide="loader"></i> Procesando...';
      if (window.lucide) lucide.createIcons({ nodes: [btn] });
    }
    try {
      const contratos = await ContratosService.getContratosActivosAprobados();
      let totalContratos = 0, totalOrdenes = 0;
      for (const c of contratos) { totalOrdenes += await this._backfillContrato(c.id); totalContratos++; }
      Toast.show(`Backfill completado. Contratos: ${totalContratos} | Órdenes: ${totalOrdenes}`, 'ok');
      this._cache.clear();
      await ContratosLista.cargar(true);
    } catch (err) {
      console.error('Error en backfill global:', err);
      Toast.show('Error durante el backfill: ' + err.message, 'bad');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="refresh-cw"></i> Re-sincronizar equipos (admin)';
        if (window.lucide) lucide.createIcons({ nodes: [btn] });
      }
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
