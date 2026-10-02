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
  // Helpers transversales: esta página NO carga ordenes-state.js, así que
  // `escapeHtml` y `APP.utils.lucideRefresh` NO existen aquí. Usar los
  // canónicos que sí están en el HTML: FMT.esc (core/formatting.js) e
  // Icons.pintar (core/icons.js). Antes reventaba en el primer render.
  const esc = (s) => FMT.esc(s);
  const _pintarIconos = (scope) => { if (window.Icons) Icons.pintar(scope); };

  let _filas = [];
  let _verRevocados = false;
  let _rol = '';

  function _fecha(ts, iso) {
    const d = ts?.toDate ? ts.toDate() : (iso ? new Date(iso) : null);
    return d ? d.toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  // Solo admin puede borrar de verdad; revocar lo puede hacer quien firma QC.
  function _puedeRevocar() {
    return _rol === ROLES.ADMIN || _rol === ROLES.JEFE_TALLER;
  }

  // Quién puede dar de ALTA un descarte: los mismos roles que firestore.rules
  // deja escribir en equipos_descartados (admin, jefe_taller, recepción y
  // técnicos; los revisores QC extra no se conocen desde aquí). El rol
  // inventario NO está en esas reglas: hasta que se le abra, el botón no le
  // sale para no ofrecer algo que las reglas van a negar (auditoría UX 2026-09-28).
  function _puedeRegistrar() {
    return [ROLES.ADMIN, ROLES.JEFE_TALLER, ROLES.RECEPCION, ROLES.TECNICO, ROLES.TECNICO_OPERATIVO, ROLES.INVENTARIO].includes(_rol);
  }

  async function _registrar(prefill = '') {
    const r = await Modal.sheet({
      title: 'Registrar descarte', icon: 'ban', size: 'sm',
      html: `
        <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
          El serial quedará marcado como <b>no usable</b>: sale la alerta al teclearlo y
          Recibir, el importador y Asignar lo bloquean. Si fue un error, se revoca después.</p>
        <label class="form-label" for="dscNSerial">Serial</label>
        <input id="dscNSerial" class="form-input" autocomplete="off" style="font-family:var(--font-mono, monospace);" placeholder="Escanea o escribe el serial">
        <label class="form-label" for="dscNMotivo" style="margin-top:10px;">Motivo</label>
        <textarea id="dscNMotivo" class="form-input" rows="3" placeholder="Qué tiene el equipo (obligatorio)"></textarea>
        <label class="form-label" for="dscNOrden" style="margin-top:10px;">Orden (opcional)</label>
        <input id="dscNOrden" class="form-input" autocomplete="off" placeholder="Nº de la orden donde se detectó">
        <div id="dscNError" style="display:none; margin-top:10px; color:#b91c1c; font-size:13px;"></div>`,
      buttons: [
        { action: 'cancel', label: 'Cancelar' },
        { action: 'ok', label: 'Registrar descarte', primary: true, icon: 'ban' },
      ],
      onMount(root) {
        const s = root.querySelector('#dscNSerial');
        if (prefill) s.value = prefill;
        setTimeout(() => s && s.focus(), 50);
        // Lector de barras: Enter en el serial pasa al motivo.
        s.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); root.querySelector('#dscNMotivo').focus(); } });
      },
      async onAction(action, root) {
        if (action !== 'ok') return undefined;
        const err = root.querySelector('#dscNError');
        const serial = root.querySelector('#dscNSerial').value.trim();
        const motivo = root.querySelector('#dscNMotivo').value.trim();
        const orden_id = root.querySelector('#dscNOrden').value.trim();
        const falla = (m) => { err.textContent = m; err.style.display = ''; return false; };
        const norm = EquiposDescartadosService.normalizar(serial);
        if (!norm || !EquiposDescartadosService.esSerialValido(norm)) return falla('Escribe un serial válido (3-30 letras o números, con al menos un dígito).');
        if (!motivo) return falla('El motivo es obligatorio: es lo que verá quien teclee el serial.');
        const btn = root.querySelector('[data-sheet-action="ok"]');
        if (window.withBusy?.esta?.(btn)) return false;   // doble clic: sigue el primero
        try {
          await window.withBusy(btn, () => EquiposDescartadosService.registrarManual({ serial, motivo, orden_id }), { label: 'Registrando…', silencioso: true });
        } catch (e) {
          console.error('[Descartados] registrar', e);
          return falla(e?.code === 'permission-denied'
            ? 'Tu rol no puede registrar descartes. Pídeselo al jefe de taller o a recepción.'
            : 'No se pudo registrar: ' + (e?.message || e));
        }
        return norm;
      },
    });
    if (!r || r === 'cancel') return;
    if (window.SerialField) SerialField.invalidar(r);
    Toast.show(`Descarte de ${r} registrado.`, 'ok');
    await cargar();
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
      _pintarIconos(vacio);
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
            ? `<a href="../ordenes/index.html?ids=${encodeURIComponent(r.orden_id)}">${esc(r.orden_id)}</a>`
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

  // Arranque rápido (2026-09-29): antes la página esperaba la lectura del rol
  // (usuarios/{uid}, un viaje al servidor) y DESPUÉS pedía la lista (otro
  // viaje). Ahora el rol sale de Sesion (sessionStorage; sin red en
  // navegaciones tibias) EN PARALELO con la lista, y la lista se pinta
  // primero desde la caché local de Firestore mientras llega el servidor.
  let _servidorListo = false;
  async function cargar() {
    const loader = document.getElementById('loader');
    loader.style.display = '';
    // Adelanto desde la caché local: pinta lo último visto mientras responde
    // el servidor. Si el servidor ya llegó, o no hay caché, no hace nada.
    EquiposDescartadosService.listar({ incluirRevocados: true, limite: 1000, source: 'cache' })
      .then(rows => { if (!_servidorListo && rows.length) { _filas = rows; render(); } })
      .catch(() => { /* sin caché todavía */ });
    try {
      _filas = await EquiposDescartadosService.listar({ incluirRevocados: true, limite: 1000 });
      _servidorListo = true;
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
    document.getElementById('dscRegistrar').addEventListener('click', () => _registrar());
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
      // El rol solo gobierna si aparecen "Revocar" y "Registrar" (las reglas
      // mandan de verdad): sale de Sesion (caché de sesión, compartida con el
      // rail) y en paralelo con la lista, no antes.
      const rolP = Sesion.rol(user.uid)
        .then(r => { _rol = r || ''; })
        .catch(e => { console.warn('[Descartados] no se pudo leer el rol:', e); })
        .then(() => {
          window.userRole = _rol;   // la ficha del equipo lee este
          document.getElementById('dscRegistrar').style.display = _puedeRegistrar() ? '' : 'none';
          // Si la lista ya se pintó (caché o servidor) antes de saber el rol,
          // se repinta para que salgan los botones que dependen de él.
          if (_filas.length) render();
        });
      // ?registrar=SERIAL (o =1): llega desde el aviso del cierre de ENTRADA.
      await Promise.all([rolP, cargar()]);
      const pre = new URLSearchParams(location.search).get('registrar');
      if (_puedeRegistrar() && pre != null) _registrar(pre === '1' ? '' : pre);
    });
  });

  window.DescartadosPage = { recargar: cargar };
})();
