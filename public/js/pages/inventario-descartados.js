// @ts-nocheck
/* ========================================
 * EQUIPOS DESCARTADOS — listado consultable
 * El apartado que pidió la jefa de taller: qué radios se declararon
 * inservibles en control de calidad, con qué motivo y en qué orden. El
 * registro lo escribe ordenes-qc.js al marcar un equipo como "Descartado";
 * la alerta al teclear el serial la pinta SerialField en todos los puntos de
 * captura (bodega, taller, contratos, POC).
 * Revocar NO borra: deja el doc con `revocado: true` y su traza, así que un
 * descarte puesto por error se puede deshacer sin perder la auditoría.
 * ======================================== */

(function () {
  const esc = (s) => escapeHtml(String(s ?? ''));

  let _filas = [];
  let _verRevocados = false;

  function _fecha(ts, iso) {
    const d = ts?.toDate ? ts.toDate() : (iso ? new Date(iso) : null);
    return d ? d.toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  // Solo admin puede borrar de verdad; revocar lo puede hacer quien firma QC.
  function _puedeRevocar() {
    const rol = APP.state.userRole || '';
    return rol === ROLES.ADMIN || rol === ROLES.JEFE_TALLER;
  }

  function _filtrar() {
    const q = (document.getElementById('dscBuscar').value || '').trim().toLowerCase();
    return _filas.filter(r => {
      if (!_verRevocados && r.revocado === true) return false;
      if (!q) return true;
      return [r.serial, r.serial_norm, r.modelo, r.orden_id, r.cliente, r.motivo, r.por_email]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function render() {
    const tbody = document.getElementById('dscTabla');
    const vacio = document.getElementById('dscVacio');
    const resumen = document.getElementById('dscResumen');
    const rows = _filtrar();

    const activos = _filas.filter(r => r.revocado !== true).length;
    resumen.textContent = `${activos} equipo(s) descartado(s) vigentes`
      + (_verRevocados ? ` · ${_filas.length - activos} revocado(s)` : '');

    if (!rows.length) {
      tbody.innerHTML = '';
      vacio.style.display = '';
      // El vacío por búsqueda no es el mismo mensaje que "no hay descartados".
      vacio.querySelector('p').textContent = _filas.length
        ? 'Ningún equipo coincide con la búsqueda.'
        : 'Ningún equipo descartado. Nada que vigilar.';
      APP.utils.lucideRefresh(vacio);
      return;
    }
    vacio.style.display = 'none';

    tbody.innerHTML = rows.map(r => {
      const revocado = r.revocado === true;
      return `
      <tr class="${revocado ? 'dsc-revocado' : ''}">
        <td>
          <span class="dsc-serial" data-serial="${esc(r.serial || r.serial_norm)}"
                title="Ver la ficha del equipo">${esc(r.serial || r.serial_norm)}</span>
          ${revocado ? '<span class="badge revocado">revocado</span>' : ''}
        </td>
        <td>${esc(r.modelo || '—')}</td>
        <td class="dsc-motivo">
          ${esc(r.motivo || '—')}
          ${revocado && r.revocado_motivo
            ? `<div class="dsc-meta">Revocado: ${esc(r.revocado_motivo)} · ${esc(r.revocado_por_email || '')}</div>`
            : ''}
        </td>
        <td>
          ${r.orden_id
            ? `<a href="../ordenes/editar-orden.html?id=${encodeURIComponent(r.orden_id)}">${esc(r.orden_id)}</a>`
            : '—'}
          ${r.cliente ? `<div class="dsc-meta">${esc(r.cliente)}</div>` : ''}
        </td>
        <td class="dsc-meta">
          ${esc(r.por_email || '')}<br>${esc(_fecha(r.descartado_at))}
        </td>
        <td style="text-align:right;">
          ${!revocado && _puedeRevocar()
            ? `<button class="btn btn-secondary btn-sm dsc-revocar" data-serial="${esc(r.serial_norm || r.id)}"
                       title="El equipo no estaba para descartar: quita la alerta y deja la traza">Revocar</button>`
            : ''}
        </td>
      </tr>`;
    }).join('');
  }

  async function cargar() {
    const loader = document.getElementById('loader');
    loader.style.display = '';
    try {
      _filas = await EquiposDescartadosService.listar({ incluirRevocados: true, limite: 1000 });
      render();
    } catch (e) {
      console.error('[Descartados] cargar', e);
      Toast.show('No se pudo cargar el listado: ' + e.message, 'bad');
    } finally {
      loader.style.display = 'none';
    }
  }

  async function _revocar(serialNorm) {
    const motivo = await Modal.prompt({
      title: 'Revocar el descarte',
      message: `El serial ${serialNorm} dejará de mostrar la alerta al teclearlo. `
        + 'El registro no se borra: queda la traza de quién lo revocó y por qué.',
      placeholder: 'Motivo de la revocación (obligatorio)',
    });
    // Cancelar devuelve null; aceptar en blanco devuelve '' — en ambos casos no
    // se revoca, porque sin motivo el registro pierde su valor de auditoría.
    if (!motivo || !motivo.trim()) return;
    try {
      await EquiposDescartadosService.revocar(serialNorm, motivo);
      if (window.SerialField) SerialField.invalidar(serialNorm);
      Toast.show('Descarte revocado', 'ok');
      await cargar();
    } catch (e) {
      console.error('[Descartados] revocar', e);
      Toast.show('No se pudo revocar: ' + e.message, 'bad');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('dscBuscar').addEventListener('input', render);
    document.getElementById('dscVerRevocados').addEventListener('change', (e) => {
      _verRevocados = e.target.checked;
      render();
    });
    document.getElementById('dscTabla').addEventListener('click', (e) => {
      const rev = e.target.closest('.dsc-revocar');
      if (rev) { _revocar(rev.dataset.serial); return; }
      const ser = e.target.closest('.dsc-serial');
      if (ser && window.EquipoFicha) EquipoFicha.abrir(ser.dataset.serial);
    });

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = '../login.html'; return; }
      try {
        // Lectura directa: esta página no carga ordenesService y el rol solo
        // gobierna si aparece el botón "Revocar" (las reglas mandan de verdad).
        const snap = await firebase.firestore().collection('usuarios').doc(user.uid).get();
        APP.state.userRole = snap.exists ? (snap.data().rol || '') : '';
      } catch (e) { console.warn('[Descartados] no se pudo leer el rol:', e); }
      await cargar();
    });
  });

  window.DescartadosPage = { recargar: cargar };
})();
