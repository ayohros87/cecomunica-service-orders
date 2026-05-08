// @ts-nocheck
// nuevo-contrato form logic: badges, equipment table, totals, renewal UI
window.NCForm = {

  updateContratoBadges() {
    const clienteId = document.getElementById('cliente').value;
    const badgeCliente = document.getElementById('badgeCliente');
    if (clienteId) { badgeCliente.textContent = 'Listo';    badgeCliente.className = 'badge ready'; }
    else           { badgeCliente.textContent = 'Pendiente'; badgeCliente.className = 'badge pending'; }

    const tipoContrato = document.getElementById('tipo_contrato').value;
    const accion       = document.getElementById('accion').value;
    const duracion     = document.getElementById('duracion').value;
    const badgeDetalles = document.getElementById('badgeDetalles');
    if (tipoContrato && accion && duracion) { badgeDetalles.textContent = 'Listo';    badgeDetalles.className = 'badge ready'; }
    else                                    { badgeDetalles.textContent = 'Pendiente'; badgeDetalles.className = 'badge pending'; }

    const filas       = document.querySelectorAll('#tablaEquipos tbody tr');
    const badgeEquipos = document.getElementById('badgeEquipos');
    if (filas.length > 0) { badgeEquipos.textContent = `${filas.length} equipo${filas.length !== 1 ? 's' : ''}`; badgeEquipos.className = 'badge info'; }
    else                  { badgeEquipos.textContent = 'Pendiente'; badgeEquipos.className = 'badge pending'; }
  },

  syncAccionForTipoContrato() {
    const tipoContrato = document.getElementById('tipo_contrato').value;
    const accionSel    = document.getElementById('accion');
    if (!accionSel) return;

    const isDemoOrTemp = tipoContrato === 'DEMO' || tipoContrato === 'TEMP';
    if (isDemoOrTemp) {
      if (!accionSel.dataset.prevValue) accionSel.dataset.prevValue = accionSel.value || '';
      accionSel.value = 'No Aplica';
      accionSel.disabled = true;
      accionSel.classList.add('is-locked');
    } else {
      if (accionSel.disabled) {
        accionSel.disabled = false;
        accionSel.classList.remove('is-locked');
        if (accionSel.dataset.prevValue !== undefined) accionSel.value = accionSel.dataset.prevValue;
      }
    }
    this.refreshRenovacionModeUI();
    this.updateContratoBadges();
  },

  refreshRenovacionModeUI() {
    const accion            = document.getElementById('accion')?.value;
    const box               = document.getElementById('renovacionModeBox');
    const checkbox          = document.getElementById('renovacion_sin_equipo');
    const refurbishedBox    = document.getElementById('renovacionRefurbishedBox');
    const refurbishedCb     = document.getElementById('renovacion_refurbished_componentes');
    const badge             = document.getElementById('badgeRenovacionModo');
    if (!box || !checkbox || !badge || !refurbishedBox || !refurbishedCb) return;

    const esRenovacion = accion === 'Renovación';
    if (!esRenovacion) {
      box.style.display = 'none';
      checkbox.checked = false; checkbox.disabled = true;
      refurbishedBox.style.display = 'none';
      refurbishedCb.checked = false; refurbishedCb.disabled = true;
      badge.textContent = 'Renovación con equipo'; badge.className = 'badge info';
      return;
    }

    box.style.display = 'block'; checkbox.disabled = false;
    if (checkbox.checked) {
      refurbishedBox.style.display = 'block'; refurbishedCb.disabled = false;
      badge.textContent = 'Renovación sin equipo'; badge.className = 'badge ready';
    } else {
      refurbishedBox.style.display = 'none';
      refurbishedCb.checked = false; refurbishedCb.disabled = true;
      badge.textContent = 'Renovación con equipo'; badge.className = 'badge info';
    }
  },

  toggleOtraDuracion(valor) {
    document.getElementById('otraDuracionLabel').style.display = (valor === 'Otro') ? 'block' : 'none';
  },

  agregarFilaEquipo() {
    const tbody = document.querySelector('#tablaEquipos tbody');
    const fila  = document.createElement('tr');
    fila.classList.add('fila-equipo', 'highlight');

    const modeloSelect = NC.modelosDisponibles.map(m =>
      `<option value="${m.modelo_id}">${NC.escapeHtml(m.modelo)}</option>`
    ).join('');

    fila.innerHTML = `
      <td>
        <div style="display:flex;align-items:center;gap:6px;">
          <select class="modelo">${modeloSelect}</select>
        </div>
      </td>
      <td><input type="text" class="descripcion" value="Equipos de Comunicación"></td>
      <td><input type="number" class="cantidad input-cantidad" min="1" value="1"></td>
      <td><input type="number" class="precio input-precio" step="0.01" min="0" value="0.00"></td>
      <td class="totalFila">$0.00</td>
      <td><button type="button" class="btn-del-fila">❌</button></td>
    `;
    tbody.appendChild(fila);
    setTimeout(() => fila.classList.remove('highlight'), 600);

    const self = this;
    const onChangeFila = () => { self.actualizarTotalDeFila(fila); self.recalcularTotalesContrato(); self.updateContratoBadges(); };
    fila.querySelectorAll('.input-cantidad, .input-precio').forEach(i => {
      i.addEventListener('input', onChangeFila);
      i.addEventListener('change', onChangeFila);
    });
    fila.querySelector('.btn-del-fila').addEventListener('click', () => {
      fila.remove(); self.recalcularTotalesContrato(); self.updateContratoBadges();
    });

    this.actualizarTotalDeFila(fila);
    setTimeout(() => { const c = fila.querySelector('.input-cantidad'); if (c) { c.focus(); c.select(); } }, 100);
    this.updateContratoBadges();
  },

  actualizarTotalDeFila(tr) {
    const cant   = parseFloat(tr.querySelector('.input-cantidad')?.value || 0);
    const precio = parseFloat(tr.querySelector('.input-precio')?.value   || 0);
    const celda  = tr.querySelector('.totalFila');
    if (celda) celda.textContent = `$${FMT.round2(cant * precio).toFixed(2)}`;
  },

  calcularSubtotalDesdeFilas() {
    let sub = 0;
    document.querySelectorAll('.fila-equipo').forEach(row => {
      sub += Number(row.querySelector('.input-cantidad')?.value || 0) *
             Number(row.querySelector('.input-precio')?.value   || 0);
    });
    return FMT.round2(sub);
  },

  recalcularTotalesContrato() {
    const subtotal    = this.calcularSubtotalDesdeFilas();
    const itbmsAplica = (document.getElementById('itbms_aplica')?.value ?? 'true') === 'true';
    const tot         = ContractTotals.compute(subtotal, itbmsAplica);
    document.getElementById('itbms_label').textContent             = tot.itbmsLabel;
    document.getElementById('subtotal_view').textContent           = FMT.money(tot.subtotal);
    document.getElementById('itbms_view').textContent              = FMT.money(tot.itbmsMonto);
    document.getElementById('total_con_itbms_view').textContent    = FMT.money(tot.totalConITBMS);
    return tot;
  },

  calcularTotal() {
    document.querySelectorAll('#tablaEquipos tbody tr.fila-equipo').forEach(r => this.actualizarTotalDeFila(r));
    this.recalcularTotalesContrato();
  },

  init() {
    const self = this;
    window.addEventListener('DOMContentLoaded', () => {
      self.recalcularTotalesContrato();
      self.updateContratoBadges();
      self.syncAccionForTipoContrato();

      document.getElementById('tipo_contrato')?.addEventListener('change', () => self.syncAccionForTipoContrato());
      document.getElementById('accion')?.addEventListener('change', () => {
        const sel = document.getElementById('accion');
        if (sel && !sel.disabled) sel.dataset.prevValue = sel.value || '';
        self.refreshRenovacionModeUI();
        self.updateContratoBadges();
      });
      document.getElementById('renovacion_sin_equipo')?.addEventListener('change', () => self.refreshRenovacionModeUI());
      document.getElementById('renovacion_refurbished_componentes')?.addEventListener('change', () => self.refreshRenovacionModeUI());
      document.getElementById('duracion')?.addEventListener('change', () => self.updateContratoBadges());
      document.getElementById('itbms_aplica')?.addEventListener('change', () => self.recalcularTotalesContrato());
    });

    document.addEventListener('input', e => {
      if (!e.target.matches('.input-cantidad, .input-precio')) return;
      const tr = e.target.closest('tr.fila-equipo');
      if (tr) self.actualizarTotalDeFila(tr);
      self.recalcularTotalesContrato();
    });
  }
};

NCForm.init();
