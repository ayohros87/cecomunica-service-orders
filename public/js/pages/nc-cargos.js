// @ts-nocheck
// Cargos no-equipo del contrato. Se ELIGEN del catálogo de Facturación
// (colección `cargos`, creado por contabilidad), no se escriben a mano.
// Aditivo: vive aparte de equipos y NO altera los totales de equipos.
window.NCCargos = {
  catalogo: [],
  _loaded: false,

  async _ensure() {
    if (this._loaded) return;
    try {
      const all = (typeof CargosService !== 'undefined') ? await CargosService.getCargos() : [];
      this.catalogo = (all || []).filter(c => c.activo !== false)
        .sort((a, b) => String(a.concepto || '').localeCompare(String(b.concepto || ''), 'es'));
    } catch (e) { console.error('cargos catálogo', e); this.catalogo = []; }
    this._loaded = true;
  },

  _opcionesHtml(selectedId) {
    if (!this.catalogo.length) return '<option value="">(no hay cargos — créalos en Facturación)</option>';
    const sid = selectedId == null ? '' : String(selectedId);
    const opts = ['<option value="">— elegir cargo —</option>'];
    this.catalogo.forEach(c => {
      const on = String(c.id) === sid ? ' selected' : '';
      const nombre = String(c.concepto || '').replace(/</g, '&lt;').replace(/"/g, '&quot;');
      opts.push(`<option value="${c.id}"${on} data-monto="${Number(c.monto_default) || 0}" data-rec="${c.recurrente ? 1 : 0}">${nombre}</option>`);
    });
    return opts.join('');
  },

  async agregarFila(c = {}) {
    await this._ensure();
    const tbody = document.querySelector('#tablaCargos tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.classList.add('fila-cargo');
    const rec = c.recurrente === true;
    tr.innerHTML = `
      <td><select class="cargo-sel">${this._opcionesHtml(c.cargo_id)}</select></td>
      <td><input type="number" class="cargo-monto" step="0.01" min="0" value="${Number.isFinite(c.monto) ? c.monto : ''}" placeholder="0.00"></td>
      <td><select class="cargo-tipo">
            <option value="unico"${rec ? '' : ' selected'}>Único</option>
            <option value="recurrente"${rec ? ' selected' : ''}>Mensual</option>
          </select></td>
      <td><button type="button" class="btn-del-fila cargo-del">❌</button></td>`;
    tbody.appendChild(tr);

    const sel = tr.querySelector('.cargo-sel');
    sel.addEventListener('change', () => {
      const opt = sel.selectedOptions[0];
      if (opt && opt.value) {
        const m = Number(opt.dataset.monto) || 0;
        if (m && !tr.querySelector('.cargo-monto').value) tr.querySelector('.cargo-monto').value = m;
        tr.querySelector('.cargo-tipo').value = opt.dataset.rec === '1' ? 'recurrente' : 'unico';
      }
    });
    tr.querySelector('.cargo-del').addEventListener('click', () => tr.remove());
  },

  async cargar(cargos) {
    await this._ensure();
    const tbody = document.querySelector('#tablaCargos tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    for (const c of (cargos || [])) await this.agregarFila(c);
  },

  leer() {
    return [...document.querySelectorAll('#tablaCargos tbody tr.fila-cargo')].map(tr => {
      const sel = tr.querySelector('.cargo-sel');
      const opt = sel?.selectedOptions[0];
      return {
        cargo_id: sel?.value || '',
        concepto: opt ? (opt.textContent || '').trim() : '',
        monto: Math.max(0, Number(tr.querySelector('.cargo-monto')?.value || 0)),
        recurrente: tr.querySelector('.cargo-tipo')?.value === 'recurrente',
      };
    }).filter(c => c.cargo_id && c.monto > 0);
  },
};
