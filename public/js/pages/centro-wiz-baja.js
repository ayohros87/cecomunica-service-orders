// @ts-nocheck
// Centro de gestión de clientes — Wizard: baja por serial (Ola 3).
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Wizard: baja por serial (Ola 3) ═════════ */

  MOTIVOS_BAJA: [
    ['fin_necesidad', 'Fin de la necesidad'],
    ['precio', 'Precio'],
    ['servicio', 'Servicio'],
    ['fallas_equipo', 'Fallas de equipo'],
    ['cierre_operacion', 'Cierre de operación'],
    ['morosidad', 'Morosidad'],
    ['cambio_proveedor', 'Cambio de proveedor'],
    ['migracion', 'Migración'],
    ['otro', 'Otro'],
  ],

  // Liquidación de baja según el tramo de cada ítem (decisión §8.4, versión
  // final 2026-08-27): SIEMPRE equivale a 3 meses de la mensualidad de la
  // línea, cobrados de inmediato. La diferencia es qué recibe el cliente:
  // no vencido → penalidad pura; vencido → 60 días de preaviso CON SERVICIO
  // ACTIVO + 30 días de penalidad. El vencimiento se evalúa POR TRAMO del
  // ítem: la línea de un aumento tiene vigencia propia y puede seguir vigente
  // aunque el contrato base ya venció (y al revés).
  _penalidadBaja(items) {
    const por = new Map();
    for (const it of items) {
      const c = this.contratos.find(x => x.id === it.contrato_doc_id);
      if (!c) continue;
      const linea = (c.equipos || []).find(l => this._mismoModeloLinea(l, { modelo_id: it.modelo_id, modelo_label: it.modelo }));
      const precio = Number(linea?.precio || 0);
      const dias = this._diasA(linea?.vigencia?.fecha_vencimiento || c.fecha_vencimiento);
      const vencido = dias !== null && dias < 0;
      const cur = por.get(c.id) || { contrato_id: c.contrato_id || c.id, monto: 0, vencidas: 0, vigentes: 0, sinPrecio: false };
      cur.monto += precio * 3;   // 3 meses en cualquier caso, cobro inmediato
      if (vencido) cur.vencidas += 1; else cur.vigentes += 1;
      if (!precio) cur.sinPrecio = true;
      por.set(c.id, cur);
    }
    const lista = [...por.values()].map(p => {
      const partes = [];
      if (p.vigentes) partes.push(`${p.vigentes} no vencida(s): 3 meses de penalidad`);
      if (p.vencidas) partes.push(`${p.vencidas} vencida(s): 60 días de preaviso (servicio activo) + 30 de penalidad`);
      return {
        contrato_id: p.contrato_id,
        monto: Math.round(p.monto * 100) / 100,
        detalle: `${p.vigentes + p.vencidas} unid. · ${partes.join(' · ')}${p.sinPrecio ? ' · ⚠ línea sin precio' : ''}`,
      };
    });
    return { por_contrato: lista, total: Math.round(lista.reduce((s, p) => s + p.monto, 0) * 100) / 100 };
  },

  // Terminación de la CUENTA (decisión 2026-08-28): el cliente cancela el
  // servicio — se terminan TODOS los contratos renovables en una sola gestión
  // (una carta, una aprobación con el desglose, una devolución de toda la
  // flota incluida la custodia). Lo parcial es la Baja por serial.
  wizTerminacionCuenta() {
    const est = this._cuentaEstado();
    if (!est.renovables.length) { Toast.show('El cliente no tiene contratos vigentes que terminar', 'warn'); return; }
    this.wizBaja({ terminacionCuenta: true });
  },
  // Compat: terminación de UN contrato (ya no se ofrece en el menú).
  wizTerminacion(contratoDocId) {
    if (contratoDocId) this.wizBaja({ terminacionDe: contratoDocId });
    else this.wizTerminacionCuenta();
  },

  // opts.pre: ids del pool marcados en la pestaña Equipos de la ficha (2026-10-08).
  wizBaja(opts = {}) {
    this._cerrarModal();
    this.cerrarMenu?.();
    const termCuenta = !!opts.terminacionCuenta;
    const termDe = opts.terminacionDe || null;
    const contratoTerm = termDe ? this.contratos.find(c => c.id === termDe) : null;
    // Contratos que la terminación cancela (se guarda para crearBaja).
    this._wbTermIds = termCuenta
      ? this._cuentaEstado().renovables.map(c => c.id)
      : (termDe ? [termDe] : []);
    const esTerm = this._wbTermIds.length > 0;
    const elegibles = this.equipos.filter(e => {
      if (!['en_cliente', 'asignado_contrato'].includes(e.estado)) return false;
      if (termCuenta) return this._wbTermIds.includes(e.asignacion?.contrato_doc_id)
        || !e.asignacion?.contrato_doc_id;   // la custodia también se recupera
      if (termDe) return e.asignacion?.contrato_doc_id === termDe;
      return !!e.asignacion?.contrato_doc_id;
    });
    const finMes = (() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); })();
    // Selector compartido (P4): buscador + un grupo por contrato. En la
    // terminación todo va marcado y deshabilitado, igual que antes.
    this._ssReset('wb');
    const { barra, cuerpo } = this._ssHtml('wb', elegibles.map((e) => ({
      grupo: e.asignacion?.contrato_doc_id || '__sin', grupoLabel: e.asignacion?.contrato_id || 'Sin contrato',
      ok: true, busca: `${e.serial || e.id} ${e.modelo_label || ''} ${e.asignacion?.contrato_id || ''}`,
      celdas: `
          <td><input type="checkbox" data-bsel="${this.equipos.indexOf(e)}" ${esTerm ? 'checked disabled' : ''} onchange="Centro._bajaPreview()"></td>
          <td class="cg-mono">${this.esc(e.serial || e.id)}</td>
          <td>${this.esc(e.modelo_label || '—')}</td>
          <td class="cg-mono" style="font-size:12px;">${this.esc(e.asignacion?.contrato_id || 'sin contrato')}</td>
          <td style="font-size:12px;">${e.propiedad === 'cliente' ? 'del cliente <span style="color:var(--fg-4);">(no se recupera)</span>' : 'CECOMUNICA'}</td>`,
    })), { colspan: 5, marcarTodos: !esTerm });
    this._abrirModalA({
      titulo: termCuenta
        ? `Terminación de la cuenta — ${this.esc(this.cliente.nombre)}`
        : termDe
          ? `Terminación total — <span class="cg-mono">${this.esc(contratoTerm?.contrato_id || termDe)}</span>`
          : `Baja de equipos — ${this.esc(this.cliente.nombre)}`,
      cuerpo: `
      <p style="margin:0 0 12px; font-size:13px; color:var(--fg-3); max-width:70ch;">
        ${termCuenta
          ? `Cancela <b>los ${this._wbTermIds.length} contrato(s) vigente(s)</b> de la cuenta y recupera toda la flota en campo
             (incluidos los radios sin contrato formal). Una sola carta del cliente y una sola aprobación con el desglose;
             los equipos propios del cliente no se recuperan.`
          : termDe
          ? 'Se desconectan <b>todos</b> los seriales del contrato. Requiere la carta de cancelación del cliente; al aprobarse, la orden de devolución se crea de inmediato (los equipos propios del cliente no se recuperan).'
          : 'Marca los seriales a dar de baja (pueden ser de contratos distintos — una sola aprobación con el desglose). Requiere la carta de solicitud del cliente; al aprobarse, la orden de devolución se crea de inmediato.'}</p>
      ${elegibles.length ? barra : ''}
      <div class="cg-twrap" style="max-height:32vh; overflow:auto;"><table class="cg-tabla"><thead><tr>
        <th style="width:34px;"></th><th>Serial</th><th>Modelo</th><th>Contrato</th><th>Propiedad</th>
        </tr></thead><tbody data-sscuerpo="wb">
        ${cuerpo || '<tr><td colspan="5" class="cg-empty">Sin equipos en campo.</td></tr>'}
      </tbody></table></div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:12px;">
        <select class="form-select" id="wbMotivo" style="max-width:230px;">
          <option value="">— Motivo —</option>
          ${this.MOTIVOS_BAJA.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}
        </select>
        <input class="form-input" id="wbDet" style="flex:1; min-width:160px;" placeholder="Detalle (opcional)">
      </div>
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-top:10px; align-items:flex-end;">
        <div class="form-field" style="margin:0;">
          <label class="form-label">Carta del cliente (obligatoria)</label>
          <input class="form-input" type="file" id="wbCarta" accept="image/*,application/pdf" style="max-width:250px;"></div>
        <div class="form-field" style="margin:0;">
          <label class="form-label">Fecha de la nota</label>
          <input class="form-input" type="date" id="wbNota" style="width:150px;"></div>
        <div class="form-field" style="margin:0;">
          <label class="form-label">Término (referencial)</label>
          <select class="form-select" id="wbTermino" style="width:170px;" onchange="document.getElementById('wbFinWrap').classList.toggle('hidden', this.value!=='otro')">
            <option value="fin_mes">Hasta fin de mes</option>
            <option value="30_dias">30 días más</option>
            <option value="60_dias">60 días más</option>
            <option value="otro">Otro (fecha)</option>
          </select></div>
        <div class="form-field hidden" style="margin:0;" id="wbFinWrap">
          <label class="form-label">Fin (manual)</label>
          <input class="form-input" type="date" id="wbFin" value="${finMes}" style="width:150px;"></div>
        <div class="form-field" style="margin:0;">
          <label class="form-label">Depósito / garantía</label>
          <div style="display:flex; gap:6px;">
            <select class="form-select" id="wbDepAcc" style="width:120px;" onchange="document.getElementById('wbDepMonto').disabled=(this.value==='na')">
              <option value="na">No aplica</option><option value="devolver">Devolver</option><option value="retener">Retener</option>
            </select>
            <input class="form-input" type="number" id="wbDepMonto" min="0" step="0.01" placeholder="0.00" style="width:100px;" disabled></div></div>
      </div>
      <p style="font-size:11.5px; color:var(--fg-4); margin:6px 0 0;">El término de facturación es referencial:
        la facturación aún no corre en la plataforma — queda registrado para cuando corra y no bloquea el cierre.</p>
      <div id="wbPen" style="margin-top:12px;"></div>`,
      footer: `
        <span class="sep"></span>
        <button class="btn btn-ghost" onclick="Centro._cerrarModal()">Cancelar</button>
        <button class="${termCuenta || termDe ? 'btn-danger cg-act' : 'btn btn-primary'}" onclick="Centro.crearBaja(this)">Enviar a aprobación</button>`,
    });
    this._ssMontar('wb');
    if (esTerm) this._bajaPreview();
    else if (Array.isArray(opts.pre) && opts.pre.length) {
      this._ssPreMarcar('wb', opts.pre.map(pid => {
        const ix = this.equipos.findIndex(e => e.id === pid);
        return { inp: ix >= 0 ? document.querySelector(`#cgModal input[data-bsel="${ix}"]`) : null, on: null };
      }));
      this._bajaPreview();
    }
  },

  _bajaItemsSeleccion() {
    return [...document.querySelectorAll('input[data-bsel]:checked')].map(i => {
      const e = this.equipos[Number(i.dataset.bsel)];
      return {
        serial_saliente: e.serial || e.id,
        pool_doc_id_saliente: e.id,
        modelo: e.modelo_label || '',
        modelo_id: e.modelo_id || null,
        contrato_doc_id: e.asignacion?.contrato_doc_id || null,
        contrato_id: e.asignacion?.contrato_id || null,
        propiedad: e.propiedad || null,   // 'cliente' = propio: no se recupera
      };
    });
  },

  _finPorTermino() {
    const t = document.getElementById('wbTermino')?.value || 'fin_mes';
    const d = new Date();
    if (t === 'fin_mes') return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
    if (t === '30_dias') return FMT.fechaISOPanama(new Date(d.getTime() + 30 * 86400000));
    if (t === '60_dias') return FMT.fechaISOPanama(new Date(d.getTime() + 60 * 86400000));
    return document.getElementById('wbFin')?.value || '';
  },

  _bajaPreview() {
    const items = this._bajaItemsSeleccion();
    const pen = this._penalidadBaja(items);
    const todasPropias = items.length && items.every(i => i.propiedad === 'cliente');
    const sinContrato = items.filter(i => !i.contrato_doc_id).length;
    document.getElementById('wbPen').innerHTML = items.length ? `
      ${todasPropias ? '<div class="cg-senal info" style="margin-bottom:8px;">Equipos <b>propios del cliente</b>: la baja corta el servicio y la facturación — no se crea orden de recuperación.</div>' : ''}
      ${sinContrato ? `<div class="cg-senal warn" style="margin-bottom:8px;">${sinContrato} radio(s) <b>sin contrato formal</b>: se recuperan igual, pero no hay tarifa para estimar su liquidación — el monto exacto lo pone finanzas.</div>` : ''}
      <p style="font-size:13px; margin:0 0 4px;"><b>Liquidación estimada — 3 meses en cualquier caso, cobro inmediato</b>
        <span style="color:var(--fg-4);">(vencido: 60 días de preaviso con servicio activo + 30 de penalidad)</span></p>
      ${pen.por_contrato.map(p => `<div style="display:flex; gap:10px; font-size:13px; padding:2px 0;">
        <span class="cg-mono">${this.esc(p.contrato_id)}</span>
        <span style="color:var(--fg-3);">${this.esc(p.detalle)}</span>
        <b style="margin-left:auto;" class="num">$${p.monto.toFixed(2)}</b></div>`).join('')}
      <div style="display:flex; font-size:13.5px; border-top:1px solid var(--border-subtle); padding-top:4px;">
        <b>Total estimado</b><b style="margin-left:auto;" class="num">$${pen.total.toFixed(2)}</b></div>` : '';
  },

  // Candado contra el doble submit (auditoría UX 2026-09-28, P0 #10): cada
  // click consumía un correlativo y mandaba un correo de aprobación.
  crearBaja(btn) {
    return withBusy(btn || null, () => this._crearBaja(), { key: 'crearBaja', label: 'Enviando…', rethrow: false, intento: this._intento('crearBaja', 'Baja') });
  },
  async _crearBaja() {
    const termIds = Array.isArray(this._wbTermIds) ? this._wbTermIds : [];
    const base = this._bajaItemsSeleccion();
    if (!base.length) { Toast.show('Marca al menos un serial', 'warn'); return; }
    const motivo = document.getElementById('wbMotivo')?.value || '';
    if (!motivo) { Toast.show('Indica el motivo de la baja', 'warn'); return; }
    const carta = document.getElementById('wbCarta')?.files?.[0] || null;
    if (!carta) { Toast.show('Adjunta la carta de solicitud del cliente (obligatoria)', 'warn'); return; }
    const detalle = document.getElementById('wbDet')?.value.trim() || '';
    const fin = this._finPorTermino();
    const depAcc = document.getElementById('wbDepAcc')?.value || 'na';
    const items = base.map(it => ({ ...it, motivo_codigo: motivo, motivo_detalle: detalle, fecha_fin_facturacion: fin || null }));
    const pen = this._penalidadBaja(items);
    try {
      // La carta se sube ANTES de crear el doc (con el correlativo reservado):
      // el correo de aprobación sale en el onCreate y siempre decía "falta la
      // carta" aunque el wizard la adjuntara — ahora ya la ve adjunta.
      const gid = await GestionesService.reservarId('baja');
      let cartaPath = null;
      try {
        cartaPath = await GestionesService.subirCartaArchivo(gid, carta);
      } catch (e) {
        console.error(e);
        Toast.show('La carta NO subió — la gestión se crea igual: adjúntala desde el expediente', 'warn');
      }
      await GestionesService.crear({ ...Centro._estampaReg(),
        tipo: 'baja',
        cliente_id: this.cliente.id,
        cliente_nombre: this.cliente.nombre || '',
        estado: 'pendiente_aprobacion',
        origen: { tipo: 'vendedor' },
        items,
        cierre: {},
        aprobacion: { requiere: true },
        penalidad_estimada: pen,
        fecha_fin_facturacion: fin || null,
        motivo_codigo: motivo,
        termino: document.getElementById('wbTermino')?.value || 'fin_mes',
        fecha_nota_cliente: document.getElementById('wbNota')?.value || null,
        deposito: depAcc === 'na' ? null : { accion: depAcc, monto: Number(document.getElementById('wbDepMonto')?.value || 0) },
        ...(cartaPath ? { carta_path: cartaPath } : {}),
        ...(termIds.length ? { terminacion_total_de: termIds } : {}),
      }, { id: gid });
      this._cerrarModal();
      this.gSel = gid;
      Toast.show(`${termIds.length > 1 ? 'Terminación de la cuenta' : termIds.length ? 'Terminación total' : 'Baja'} ${gid} enviada a aprobación`, 'ok');
      await this.recargarGestiones();
    } catch (e) { console.error(e); Toast.show('No se pudo crear la baja', 'bad'); }
  },
});
