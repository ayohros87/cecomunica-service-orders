// @ts-nocheck
// Cargos no-equipo del contrato (activación, instalación, etc.). Aditivo: vive
// aparte de la tabla de equipos y NO altera los totales de equipos. Se guarda
// como contrato.cargos[] para el documento y la facturación futura.
window.NCCargos = {
  agregarFila(c = {}) {
    const tbody = document.querySelector('#tablaCargos tbody');
    if (!tbody) return;
    const tr = document.createElement('tr');
    tr.classList.add('fila-cargo');
    const concepto = String(c.concepto || '').replace(/"/g, '&quot;');
    const recurrente = c.recurrente === true;
    tr.innerHTML = `
      <td><input type="text" class="cargo-concepto" placeholder="Ej. Activación" value="${concepto}"></td>
      <td><input type="number" class="cargo-monto" step="0.01" min="0" value="${Number.isFinite(c.monto) ? c.monto : ''}" placeholder="0.00"></td>
      <td><select class="cargo-tipo form-select" style="height:32px;">
            <option value="unico"${recurrente ? '' : ' selected'}>Único</option>
            <option value="recurrente"${recurrente ? ' selected' : ''}>Mensual</option>
          </select></td>
      <td><button type="button" class="btn-del-fila cargo-del">❌</button></td>`;
    tbody.appendChild(tr);
    tr.querySelector('.cargo-del').addEventListener('click', () => tr.remove());
    setTimeout(() => { const i = tr.querySelector('.cargo-concepto'); if (i) i.focus(); }, 50);
  },

  // Carga inicial (editar contrato): pinta las filas existentes.
  cargar(cargos) {
    const tbody = document.querySelector('#tablaCargos tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    (cargos || []).forEach(c => this.agregarFila(c));
  },

  // Lee las filas válidas para guardar.
  leer() {
    return [...document.querySelectorAll('#tablaCargos tbody tr.fila-cargo')].map(tr => ({
      concepto: (tr.querySelector('.cargo-concepto')?.value || '').trim(),
      monto: Math.max(0, Number(tr.querySelector('.cargo-monto')?.value || 0)),
      recurrente: tr.querySelector('.cargo-tipo')?.value === 'recurrente',
    })).filter(c => c.concepto && c.monto > 0);
  },
};
