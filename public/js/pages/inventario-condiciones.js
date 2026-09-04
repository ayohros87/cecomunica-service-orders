// @ts-nocheck
/* ========================================
 * EQUIPOS CON CONDICIÓN PARTICULAR — listado consultable
 * Petición de Solangel (2026-09-04): radios que funcionan pero arrastran una
 * limitación que el taller no puede resolver (auricular dañado que pide
 * microsoldadura, etc.). El registro por serial lo escriben la firma del QC
 * ("aprobado con condición"), el cierre de una ENTRADA o la ficha del equipo;
 * el aviso al teclear el serial lo pinta SerialField en todos los puntos de
 * captura (bodega, taller, contratos, POC) y el asignador lo muestra antes de
 * guardar.
 * Levantar NO borra: deja el doc con `vigente: false` y su traza, así que una
 * condición ya resuelta sigue siendo auditable.
 * ======================================== */

(function () {
  const esc = (s) => escapeHtml(String(s ?? ''));

  let _filas = [];
  let _verLevantadas = false;

  function _fecha(ts, iso) {
    const d = ts?.toDate ? ts.toDate() : (iso ? new Date(iso) : null);
    return d ? d.toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  // Levantar = afirmar que el radio ya no tiene la limitación: quien firma QC,
  // inventario y admin (las reglas mandan; esto solo pinta el botón).
  function _puedeLevantar() {
    const rol = APP.state.userRole || '';
    return rol === ROLES.ADMIN || rol === ROLES.JEFE_TALLER || rol === 'inventario';
  }

  function _filtrar() {
    const q = (document.getElementById('cndBuscar').value || '').trim().toLowerCase();
    return _filas.filter(r => {
      if (!_verLevantadas && r.vigente === false) return false;
      if (!q) return true;
      return [r.serial, r.serial_norm, r.modelo, r.orden_id, r.cliente, r.condicion, r.por_email]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function render() {
    const tbody = document.getElementById('cndTabla');
    const vacio = document.getElementById('cndVacio');
    const resumen = document.getElementById('cndResumen');
    const rows = _filtrar();

    const vigentes = _filas.filter(r => r.vigente !== false).length;
    resumen.textContent = `${vigentes} equipo(s) con condición vigente`
      + (_verLevantadas ? ` · ${_filas.length - vigentes} levantada(s)` : '');

    if (!rows.length) {
      tbody.innerHTML = '';
      vacio.style.display = '';
      vacio.querySelector('p').textContent = _filas.length
        ? 'Ningún equipo coincide con la búsqueda.'
        : 'Ningún equipo con condición particular.';
      APP.utils.lucideRefresh(vacio);
      return;
    }
    vacio.style.display = 'none';

    tbody.innerHTML = rows.map(r => {
      const levantada = r.vigente === false;
      return `
      <tr class="${levantada ? 'cnd-levantada' : ''}">
        <td>
          <span class="cnd-serial" data-serial="${esc(r.serial || r.serial_norm)}"
                title="Ver la ficha del equipo">${esc(r.serial || r.serial_norm)}</span>
          ${levantada ? '<span class="badge levantada">levantada</span>' : ''}
        </td>
        <td>${esc(r.modelo || '—')}</td>
        <td class="cnd-texto">
          ${esc(r.condicion || '—')}
          ${levantada && r.levantado_motivo
            ? `<div class="cnd-meta">Levantada: ${esc(r.levantado_motivo)} · ${esc(r.levantado_por_email || '')} · ${esc(_fecha(r.levantado_at))}</div>`
            : ''}
        </td>
        <td>
          ${r.orden_id
            ? `<a href="../ordenes/editar-orden.html?id=${encodeURIComponent(r.orden_id)}">${esc(r.orden_id)}</a>`
            : '—'}
          ${r.cliente ? `<div class="cnd-meta">${esc(r.cliente)}</div>` : ''}
        </td>
        <td class="cnd-meta">
          ${esc(r.por_email || '')}<br>${esc(_fecha(r.registrado_at))}
        </td>
        <td style="text-align:right;">
          ${!levantada && _puedeLevantar()
            ? `<button class="btn btn-secondary btn-sm cnd-levantar" data-serial="${esc(r.serial_norm || r.id)}"
                       title="El radio ya no tiene esta limitación: quita el aviso y deja la traza">Levantar</button>`
            : ''}
        </td>
      </tr>`;
    }).join('');
  }

  async function cargar() {
    const loader = document.getElementById('loader');
    loader.style.display = '';
    try {
      _filas = await EquiposCondicionesService.listar({ incluirLevantadas: true, limite: 1000 });
      render();
    } catch (e) {
      console.error('[Condiciones] cargar', e);
      Toast.show('No se pudo cargar el listado: ' + e.message, 'bad');
    } finally {
      loader.style.display = 'none';
    }
  }

  async function _levantar(serialNorm) {
    const motivo = await Modal.prompt({
      title: 'Levantar la condición',
      message: `El aviso sobre ${serialNorm} dejará de salir. `
        + 'El registro no se borra: queda quién la levantó y por qué.',
      placeholder: 'Motivo (obligatorio) — ej.: se cambió el conector fuera del taller',
    });
    if (!motivo || !motivo.trim()) return;
    try {
      await EquiposCondicionesService.levantar(serialNorm, motivo.trim());
      if (window.SerialField) SerialField.invalidar(serialNorm);
      Toast.show('Condición levantada', 'ok');
      await cargar();
    } catch (e) {
      console.error('[Condiciones] levantar', e);
      Toast.show('No se pudo levantar: ' + e.message, 'bad');
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('cndBuscar').addEventListener('input', render);
    document.getElementById('cndVerLevantadas').addEventListener('change', (e) => {
      _verLevantadas = e.target.checked;
      render();
    });
    document.getElementById('cndTabla').addEventListener('click', (e) => {
      const lev = e.target.closest('.cnd-levantar');
      if (lev) { _levantar(lev.dataset.serial); return; }
      const ser = e.target.closest('.cnd-serial');
      if (ser && window.EquipoFicha) EquipoFicha.abrir(ser.dataset.serial);
    });

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = '../login.html'; return; }
      try {
        const snap = await firebase.firestore().collection('usuarios').doc(user.uid).get();
        APP.state.userRole = snap.exists ? (snap.data().rol || '') : '';
        window.userRole = APP.state.userRole;   // la ficha del equipo lee este
      } catch (e) { console.warn('[Condiciones] no se pudo leer el rol:', e); }
      // La ficha re-pinta el listado cuando registra o levanta desde ahí.
      if (window.EquipoFicha) EquipoFicha.onCambio = cargar;
      await cargar();
    });
  });

  window.CondicionesPage = { recargar: cargar };
})();
