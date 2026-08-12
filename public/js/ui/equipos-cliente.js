// Flota del cliente — panel de SOLO LECTURA con todas las unidades del pool
// asignadas a un cliente, agrupadas por contrato, abrible desde cualquier
// página (mismo patrón de overlay que EquipoFicha).
//
// Motivación (informe docs/INFORME_TRACKING_SERIAL_2026-08-12.md, P4.1): el
// panel de equipos existía en el CONTRATO pero no había forma de responder
// "¿qué tiene este cliente?" — y esa es la pregunta de una renovación. La
// Fase A.3 del plan del ciclo de vida lo pedía y quedó sin aterrizar.
//
// API:
//   EquiposCliente.abrir(clienteId, clienteNombre?)
//
// Dependencias: firebase compat, EquiposPoolService, EquipoFicha (opcional,
// para el drill-down por serial), clases .eqpool-* de ceco-ui.css.
window.EquiposCliente = {

  _esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, m => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;',
    }[m]));
  },

  async abrir(clienteId, clienteNombre = '') {
    if (!clienteId) return;
    let unidades = [];
    try { unidades = await EquiposPoolService.listarPorCliente(clienteId); }
    catch (e) { unidades = []; }

    const esc = this._esc.bind(this);
    if (!unidades.length) {
      this._render(clienteNombre, `
        <div style="padding:18px 6px; text-align:center; color:var(--fg-3); line-height:1.6;">
          Este cliente no tiene equipos asignados en el pool.<br>
          Las unidades aparecen aquí cuando un contrato, una orden o POC las vincula.
        </div>`);
      return;
    }

    // Agrupar por contrato; la custodia sin contrato va en su propio grupo al
    // final — es la brecha B4 del informe y verla aquí es parte del arreglo.
    const grupos = new Map();
    for (const u of unidades) {
      const k = u.asignacion?.contrato_id || '';
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(u);
    }
    const ordenGrupos = [...grupos.entries()]
      .sort((a, b) => (a[0] === '' ? 1 : b[0] === '' ? -1 : b[1].length - a[1].length));

    const resumen = (() => {
      const porEstado = new Map();
      unidades.forEach(u => porEstado.set(u.estado, (porEstado.get(u.estado) || 0) + 1));
      return [...porEstado.entries()]
        .map(([est, n]) => `<span style="white-space:nowrap;"><b>${n}</b> ${EquiposPoolService.chipEstadoHtml(est)}</span>`)
        .join(' <span style="color:var(--fg-3);">·</span> ');
    })();

    const seccion = (contratoId, us) => {
      const titulo = contratoId
        ? `<a href="/contratos/index.html?buscar=${encodeURIComponent(contratoId)}">${esc(contratoId)}</a>`
        : '<span title="La unidad está con el cliente pero ningún contrato la respalda — regularizar al renovar o con la ficha">Sin contrato (custodia)</span>';
      const filas = us.map(u => `
        <tr>
          <td style="padding:5px 8px; border-bottom:1px solid var(--border-subtle); font-family:var(--font-mono,monospace);">
            <a class="eq-link" href="${EquiposPoolService.kardexUrl(u.serial || u.serial_norm)}"
               onclick="if(window.EquipoFicha){event.preventDefault();EquipoFicha.abrir('${esc(u.serial || u.serial_norm)}');}">${esc(u.serial || u.serial_norm)}</a>
          </td>
          <td style="padding:5px 8px; border-bottom:1px solid var(--border-subtle);">${esc(u.modelo_label || '—')}</td>
          <td style="padding:5px 8px; border-bottom:1px solid var(--border-subtle);">
            ${EquiposPoolService.chipEstadoHtml(u.estado)}
            ${typeof EquiposPoolService.chipPendienteDevolucionHtml === 'function' ? EquiposPoolService.chipPendienteDevolucionHtml(u) : ''}
          </td>
          <td style="padding:5px 8px; border-bottom:1px solid var(--border-subtle); color:var(--fg-3);">${u.propiedad === 'cliente' ? 'Del cliente' : u.propiedad === 'cecomunica' ? 'Alquiler' : '—'}</td>
        </tr>`).join('');
      return `
        <div style="margin:14px 0 6px; font-weight:600; font-size:13px;">${titulo}
          <span style="color:var(--fg-3); font-weight:400;">· ${us.length} unidad${us.length === 1 ? '' : 'es'}</span></div>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:13px; min-width:480px;">
            <tbody>${filas}</tbody>
          </table>
        </div>`;
    };

    this._render(clienteNombre, `
      <div style="font-size:13px; margin-bottom:4px;">${resumen}</div>
      ${ordenGrupos.map(([cid, us]) => seccion(cid, us)).join('')}`);
  },

  _render(clienteNombre, bodyHtml) {
    document.getElementById('equiposClienteOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'equiposClienteOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:680px; width:min(680px, 94vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;">Equipos del cliente${clienteNombre ? ` — ${this._esc(clienteNombre)}` : ''}</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:14px 12px; max-height:70vh; overflow-y:auto;">${bodyHtml}</div>
        <div class="footer" style="display:flex; justify-content:flex-end; gap:8px;">
          <button class="btn btn-primary" data-action="cerrar">Cerrar</button>
        </div>
      </div>`;
    const cerrar = () => {
      overlay.remove();
      document.body.style.overflow = '';
      document.removeEventListener('keydown', kb);
    };
    const kb = (e) => { if (e.key === 'Escape') cerrar(); };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-action="cerrar"]')) cerrar();
    });
    document.addEventListener('keydown', kb);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  },
};
