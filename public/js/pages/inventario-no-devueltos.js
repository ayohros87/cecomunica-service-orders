// @ts-nocheck
/* ========================================
 * EQUIPOS NO DEVUELTOS — la bandeja de cobro
 * Plan: docs/plans/PLAN_EQUIPOS_NO_DEVUELTOS.md.
 *
 * Cada fila es un equipo que un cliente no devolvió y que hay que cobrarle.
 * Los renglones nacen en dos sitios: la resolución "No se devuelve" de una
 * devolución (trigger onOrdenDevolucionWrite) y el cierre de una devolución con
 * faltantes sin lista por serial (ordenes-devolucion.js).
 *
 * La razón de existir de esta página: antes el dato se escribía y nadie lo
 * leía. `devolucion_excepcion` no tenía UNA sola referencia en el frontend, y
 * los faltantes de un contrato de papel eran un contador más una frase en
 * observaciones. Así se perdieron los 4 radios del finiquito de TIL PANAMA.
 * ======================================== */

(function () {
  const esc = (s) => escapeHtml(String(s ?? ''));

  let _filas = [];
  let _verCerrados = false;

  const $ = (id) => document.getElementById(id);
  const dinero = (n) => `$${(Number(n) || 0).toFixed(2)}`;

  function _fecha(ts) {
    const d = ts?.toDate ? ts.toDate() : null;
    return d ? d.toLocaleDateString('es-PA', { dateStyle: 'medium' }) : '';
  }

  const S = () => window.CobrosEquiposService;

  function _abierto(r) { return S().ABIERTAS.includes(r.etapa); }

  // Qué es el equipo: un serial cuando se conoce, o "N × modelo" cuando el
  // faltante viene de un contrato de papel donde nadie llegó a registrarlo.
  function _equipoHtml(r) {
    if (r.serial_norm) {
      return `<span class="nd-serial" data-serial="${esc(r.serial_norm)}" title="Ver la ficha del equipo">${esc(r.serial || r.serial_norm)}</span>
              <div class="nd-meta">${esc(r.modelo_label || '—')}</div>`;
    }
    return `<b>${Number(r.cantidad) || 1} ×</b> ${esc(r.modelo_label || 'equipo')}
            <div class="nd-meta">sin serial — nunca se registró en la devolución</div>`;
  }

  function _filtrar() {
    const q = ($('ndBuscar').value || '').trim().toLowerCase();
    return _filas.filter(r => {
      if (!_verCerrados && !_abierto(r)) return false;
      if (!q) return true;
      return [r.cliente_nombre, r.serial, r.serial_norm, r.modelo_label,
              r.orden_devolucion_id, r.factura_ref, r.motivo_detalle]
        .some(v => String(v || '').toLowerCase().includes(q));
    });
  }

  function _kpis() {
    const abiertos = _filas.filter(_abierto);
    const deuda = abiertos.reduce((s, r) => s + (Number(r.monto_total) || 0), 0);
    const dias = abiertos.map(r => S().diasAbierto(r));
    const masViejo = dias.length ? Math.max(...dias) : 0;
    const enCobranza = abiertos.filter(r => r.etapa === S().ETAPAS.EN_COBRANZA).length;
    const porAprobar = abiertos.filter(r => r.requiere_aprobacion).length;
    const sinPrecio = abiertos.filter(r => r.sin_referencia || !(Number(r.monto_unit) > 0)).length;

    const kpi = (n, label, mod) =>
      `<div class="nd-kpi ${mod || ''}"><div class="nd-kpi-n">${n}</div><div class="nd-kpi-l">${label}</div></div>`;

    $('ndKpis').innerHTML =
      kpi(abiertos.length, 'equipos por cobrar') +
      kpi(dinero(deuda), 'deuda registrada', 'nd-kpi--deuda') +
      kpi(`${masViejo} d`, 'el más viejo', 'nd-kpi--viejo') +
      (enCobranza ? kpi(enCobranza, 'ya en cobranza') : '') +
      (porAprobar ? kpi(porAprobar, 'esperan aprobación') : '') +
      (sinPrecio ? kpi(sinPrecio, 'sin precio puesto') : '');
  }

  function render() {
    const tbody = $('ndTabla');
    const vacio = $('ndVacio');
    const rows = _filtrar();
    _kpis();

    const abiertos = _filas.filter(_abierto).length;
    $('ndResumen').textContent = `${abiertos} renglón(es) abierto(s)`
      + (_verCerrados ? ` · ${_filas.length - abiertos} cerrado(s)` : '');

    if (!rows.length) {
      tbody.innerHTML = '';
      vacio.style.display = '';
      vacio.querySelector('p').textContent = _filas.length
        ? 'Ningún renglón coincide con la búsqueda.'
        : 'Ningún equipo pendiente de cobro. Todo lo que salió, volvió.';
      if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(vacio);
      return;
    }
    vacio.style.display = 'none';

    const gestiona = S().puedeGestionar();
    const aprueba  = S().puedeAprobarDescuento();
    const condona  = S().puedeCondonar();

    tbody.innerHTML = rows.map(r => {
      const abierto = _abierto(r);
      const dias = S().diasAbierto(r);
      const restan = S().DIAS_A_COBRANZA - dias;
      const cat = r.monto_catalogo_unit;
      const desc = Number(r.descuento_pct) || 0;

      const acciones = !abierto || !gestiona ? '' : `
        <button class="btn btn-secondary btn-sm nd-monto-btn" data-id="${esc(r.id)}"
                title="Cambiar lo que se le va a cobrar">Monto</button>
        ${r.requiere_aprobacion && aprueba
          ? `<button class="btn btn-secondary btn-sm nd-aprobar" data-id="${esc(r.id)}"
                     title="Aprobar el descuento para poder facturar">Aprobar</button>` : ''}
        <button class="btn btn-primary btn-sm nd-facturar" data-id="${esc(r.id)}"
                title="Registrar el número de la factura emitida en QuickBooks">Facturar</button>
        <button class="btn btn-secondary btn-sm nd-recuperar" data-id="${esc(r.id)}"
                title="El equipo apareció: vuelve a bodega">Apareció</button>
        ${condona
          ? `<button class="btn btn-secondary btn-sm nd-condonar" data-id="${esc(r.id)}"
                     title="No se le cobra al cliente (solo administración)">Condonar</button>` : ''}`;

      return `
      <tr>
        <td>
          ${esc(r.cliente_nombre || '—')}
          ${r.orden_devolucion_id
            ? `<div class="nd-meta"><a href="../ordenes/editar-orden.html?id=${encodeURIComponent(r.orden_devolucion_id)}">devolución ${esc(r.orden_devolucion_id)}</a></div>`
            : ''}
        </td>
        <td>${_equipoHtml(r)}</td>
        <td>
          <div style="font-size:12.5px;">${esc(r.motivo_codigo || '—')}</div>
          ${r.motivo_detalle ? `<div class="nd-meta">${esc(r.motivo_detalle)}</div>` : ''}
        </td>
        <td style="text-align:right;">
          <b>${dias}</b>
          <div class="nd-meta">${abierto
            ? (restan > 0 ? `${restan} d para cobranza` : 'vencido')
            : esc(_fecha(r.desde))}</div>
        </td>
        <td class="nd-monto">
          ${cat === null || cat === undefined
            ? '<span class="nd-meta">sin precio<br>en catálogo</span>'
            : dinero(cat)}
        </td>
        <td class="nd-monto">
          <b>${dinero(r.monto_total)}</b>
          ${desc > 0 ? `<div class="nd-meta">${desc}% desc.</div>` : ''}
          ${r.requiere_aprobacion ? '<div><span class="nd-aprob">requiere aprobación</span></div>' : ''}
          ${r.aprobado_at ? `<div class="nd-meta">aprobó ${esc(r.aprobado_por_email || '')}</div>` : ''}
        </td>
        <td>
          <span class="nd-etapa nd-etapa-${esc(r.etapa)}">${esc(S().ETAPA_LABELS[r.etapa] || r.etapa)}</span>
          ${r.factura_ref ? `<div class="nd-meta">factura ${esc(r.factura_ref)}</div>` : ''}
          ${!abierto && r.cerrado_motivo ? `<div class="nd-meta">${esc(r.cerrado_motivo)}</div>` : ''}
        </td>
        <td><div class="nd-acciones">${acciones}</div></td>
      </tr>`;
    }).join('');

    if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(tbody);
  }

  // ── Acciones ─────────────────────────────────────────────────────────

  const _fila = (id) => _filas.find(r => r.id === id);

  async function _ajustarMonto(id) {
    const r = _fila(id);
    if (!r) return;
    const cat = r.monto_catalogo_unit;
    const val = await Modal.prompt({
      title: 'Cuánto se le cobra',
      message: `${r.modelo_label || 'Equipo'}${r.serial_norm ? ` (${r.serial_norm})` : ` × ${r.cantidad}`}. `
        + (cat === null || cat === undefined
          ? 'Este modelo no tiene precio de venta en el catálogo: el monto lo pones tú.'
          : `Precio de catálogo: ${dinero(cat)} c/u. Un descuento mayor al ${S().DESCUENTO_LIBRE_PCT}% necesitará aprobación antes de facturar.`),
      defaultValue: String(Number(r.monto_unit) || 0),
      placeholder: 'Monto por unidad',
    });
    if (val === null) return;
    const n = Number(String(val).replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(n) || n < 0) { Toast.show('Escribe un monto válido.', 'warn'); return; }
    try {
      await S().ajustarMonto(id, n, '');
      Toast.show('Monto actualizado.', 'ok');
      await cargar();
    } catch (e) {
      console.error('[NoDevueltos] monto', e);
      Toast.show('No se pudo cambiar el monto: ' + (e.message || e), 'bad');
    }
  }

  async function _aprobar(id) {
    const r = _fila(id);
    if (!r) return;
    const ok = await Modal.confirm({
      title: 'Aprobar el descuento',
      message: `Se cobrarán <b>${dinero(r.monto_total)}</b> en vez de `
        + `${dinero((Number(r.monto_catalogo_unit) || 0) * (Number(r.cantidad) || 1))} `
        + `(${r.descuento_pct}% de descuento). Queda registrado a tu nombre.`,
      confirmLabel: 'Aprobar',
    });
    if (!ok) return;
    try {
      await S().aprobarDescuento(id);
      Toast.show('Descuento aprobado.', 'ok');
      await cargar();
    } catch (e) {
      Toast.show('No se pudo aprobar: ' + (e.message || e), 'bad');
    }
  }

  async function _facturar(id) {
    const r = _fila(id);
    if (!r) return;
    if (r.requiere_aprobacion) {
      Toast.show(`El descuento de ${r.descuento_pct}% necesita aprobación antes de facturar.`, 'warn');
      return;
    }
    if (!(Number(r.monto_total) > 0)) {
      Toast.show('Ponle monto al renglón antes de facturarlo.', 'warn');
      return;
    }
    const fact = await Modal.prompt({
      title: 'Registrar la factura',
      message: `La factura se emite en QuickBooks — aquí se guarda su número para cerrar el círculo. `
        + `Se cobrarán ${dinero(r.monto_total)}`
        + `${r.serial_norm ? `. El equipo ${r.serial_norm} pasará a "Vendido".` : '.'}`,
      placeholder: 'Nº de factura de QuickBooks',
    });
    if (!fact) return;
    try {
      await S().facturar(id, fact, firebase.auth().currentUser);
      Toast.show('Cobro registrado.', 'ok');
      await cargar();
    } catch (e) {
      console.error('[NoDevueltos] facturar', e);
      Toast.show('No se pudo registrar: ' + (e.message || e), 'bad');
    }
  }

  async function _condonar(id) {
    const r = _fila(id);
    if (!r) return;
    const motivo = await Modal.prompt({
      title: 'Condonar el cobro',
      message: `Se dejan de cobrar ${dinero(r.monto_total)} y el equipo se da de baja del inventario. `
        + 'Explica por qué: es la justificación de no cobrar y queda a tu nombre.',
      placeholder: 'Motivo de la condonación (obligatorio)',
      multiline: true,
    });
    if (!motivo || !motivo.trim()) return;
    try {
      await S().condonar(id, motivo, firebase.auth().currentUser);
      Toast.show('Cobro condonado.', 'ok');
      await cargar();
    } catch (e) {
      console.error('[NoDevueltos] condonar', e);
      Toast.show('No se pudo condonar: ' + (e.message || e), 'bad');
    }
  }

  async function _recuperar(id) {
    const r = _fila(id);
    if (!r) return;
    const motivo = await Modal.prompt({
      title: 'El equipo apareció',
      message: `El renglón se cierra sin cobro`
        + `${r.serial_norm ? ` y ${r.serial_norm} vuelve a bodega` : ''}. ¿Dónde estaba?`,
      placeholder: 'Dónde apareció (opcional)',
    });
    if (motivo === null) return;
    try {
      await S().recuperar(id, motivo, firebase.auth().currentUser);
      Toast.show('Equipo recuperado.', 'ok');
      await cargar();
    } catch (e) {
      console.error('[NoDevueltos] recuperar', e);
      Toast.show('No se pudo cerrar: ' + (e.message || e), 'bad');
    }
  }

  // Estado de cuenta en texto plano, agrupado por cliente. Es el entregable
  // real mientras no se facture desde la plataforma: esto se le pasa a quien
  // emite en QuickBooks, o al cliente para discutir el finiquito.
  async function copiarEstadoCuenta() {
    const rows = _filtrar().filter(_abierto);
    if (!rows.length) { Toast.show('No hay renglones abiertos que copiar.', 'warn'); return; }
    const porCliente = new Map();
    rows.forEach(r => {
      const k = r.cliente_nombre || '(sin cliente)';
      if (!porCliente.has(k)) porCliente.set(k, []);
      porCliente.get(k).push(r);
    });
    const lineas = ['EQUIPOS NO DEVUELTOS — ESTADO DE CUENTA',
                    new Date().toLocaleDateString('es-PA', { dateStyle: 'long' }), ''];
    let granTotal = 0;
    porCliente.forEach((rs, cliente) => {
      lineas.push(cliente.toUpperCase());
      let sub = 0;
      rs.forEach(r => {
        const qty = Number(r.cantidad) || 1;
        const det = r.serial_norm ? r.serial_norm : `${qty} unidad(es)`;
        sub += Number(r.monto_total) || 0;
        lineas.push(`  · ${(r.modelo_label || 'equipo').padEnd(20)} ${det.padEnd(14)} ` +
          `${dinero(r.monto_unit)} c/u   ${dinero(r.monto_total)}` +
          `${Number(r.descuento_pct) > 0 ? `   (${r.descuento_pct}% desc.)` : ''}` +
          `${r.orden_devolucion_id ? `   [devolución ${r.orden_devolucion_id}]` : ''}`);
      });
      lineas.push(`  Subtotal: ${dinero(sub)}`, '');
      granTotal += sub;
    });
    lineas.push(`TOTAL: ${dinero(granTotal)}`);
    const texto = lineas.join('\n');
    try {
      await navigator.clipboard.writeText(texto);
      Toast.show('Estado de cuenta copiado al portapapeles.', 'ok');
    } catch (e) {
      // Sin permiso de portapapeles (http, o el navegador lo bloquea): al menos
      // que el texto sea recuperable en vez de perderse.
      console.log(texto);
      Toast.show('No se pudo copiar — el detalle quedó en la consola del navegador.', 'warn');
    }
  }

  async function cargar() {
    const loader = $('loader');
    loader.style.display = '';
    try {
      _filas = await S().listar({ incluirCerrados: true, limite: 1000 });
      render();
    } catch (e) {
      console.error('[NoDevueltos] cargar', e);
      Toast.show('No se pudo cargar la bandeja: ' + (e.message || e), 'bad');
    } finally {
      loader.style.display = 'none';
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('ndBuscar').addEventListener('input', render);
    $('ndVerCerrados').addEventListener('change', (e) => {
      _verCerrados = e.target.checked;
      render();
    });

    $('ndTabla').addEventListener('click', (e) => {
      const b = (cls) => e.target.closest(cls);
      if (b('.nd-monto-btn')) return _ajustarMonto(b('.nd-monto-btn').dataset.id);
      if (b('.nd-aprobar'))   return _aprobar(b('.nd-aprobar').dataset.id);
      if (b('.nd-facturar'))  return _facturar(b('.nd-facturar').dataset.id);
      if (b('.nd-condonar'))  return _condonar(b('.nd-condonar').dataset.id);
      if (b('.nd-recuperar')) return _recuperar(b('.nd-recuperar').dataset.id);
      const ser = b('.nd-serial');
      if (ser && window.EquipoFicha) EquipoFicha.abrir(ser.dataset.serial);
    });

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = '../login.html'; return; }
      try {
        // El rol gobierna qué botones se pintan; las rules son las que mandan
        // de verdad (condonar es solo-admin también en el servidor).
        const snap = await firebase.firestore().collection('usuarios').doc(user.uid).get();
        window.userRole = snap.exists ? (snap.data().rol || '') : '';
      } catch (e) { console.warn('[NoDevueltos] no se pudo leer el rol:', e); }
      await cargar();
    });
  });

  window.NoDevueltosPage = { recargar: cargar, copiarEstadoCuenta };
})();
