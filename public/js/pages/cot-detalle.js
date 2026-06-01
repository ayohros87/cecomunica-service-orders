// @ts-nocheck
// Detalle de cotización — vista de lectura con timeline derivado del estado.
(() => {
  let cot = null;
  let catalogos = null;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const T = window.CotizacionTotales;

  function fmtFechaCorta(iso) {
    if (!iso) return '—';
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
  }

  function estadoChipHtml(estado) {
    const e = CotState.ESTADOS[estado] || CotState.ESTADOS.borrador;
    return `<span class="chip-estado ${e.chip}">${e.label}</span>`;
  }

  function historial(cot, cliente) {
    const h = [{ act: 'Cotización creada', meta: fmtFechaCorta(cot.fecha) + ' · ' + (cot.ejecutivo_nombre || '—') }];
    const fechaEnvio = T.addDays(cot.fecha, 1);
    if (['enviada', 'aprobada', 'rechazada', 'vencida', 'convertida'].includes(cot.estado)) {
      h.push({ act: 'Enviada al cliente', meta: fmtFechaCorta(fechaEnvio) + ' · por correo a ' + (cliente.email || '—') });
    }
    if (cot.estado === 'aprobada' || cot.estado === 'convertida') {
      h.push({ act: 'Aprobada por el cliente', meta: fmtFechaCorta(T.addDays(cot.fecha, 5)) + ' · orden de compra recibida' });
    }
    if (cot.estado === 'convertida') {
      h.push({ act: 'Convertida a orden de venta', meta: fmtFechaCorta(T.addDays(cot.fecha, 6)) });
    }
    if (cot.estado === 'rechazada') {
      h.push({ act: 'Rechazada por el cliente', meta: fmtFechaCorta(T.addDays(cot.fecha, 4)) });
    }
    if (cot.estado === 'vencida') {
      h.push({ act: 'Validez vencida', meta: fmtFechaCorta(T.validezVence(cot)) + ' · sin respuesta del cliente' });
    }
    return h.reverse();
  }

  function render() {
    const cli = (catalogos.clientesById[cot.clienteId]) || { razon: cot.cliente_nombre, ruc: cot.cliente_ruc, email: cot.cliente_email, representante: '' };
    const ej = catalogos.ejecutivos.find(e => e.id === cot.ejecutivoId) || { nombre: cot.ejecutivo_nombre || '—' };
    const dirigidoA = cot.dirigido_a || cli.representante || '';
    const dirigidoEmail = cot.dirigido_email || cli.email || '';
    const t = T.calcTotales(cot);
    const vence = T.validezVence(cot);

    $('detalleMount').innerHTML = `
      <nav class="app-breadcrumbs" aria-label="Breadcrumb">
        <a href="index.html">Cotizaciones</a>
        <span class="app-breadcrumbs-sep"><i data-lucide="chevron-right"></i></span>
        <span class="app-breadcrumbs-current">${esc(cot.id)}</span>
      </nav>

      <div class="app-page-header">
        <div>
          <h1 style="display:flex; align-items:center; gap:12px;">${esc(cot.id)} ${estadoChipHtml(cot.estado)}</h1>
          <p>${esc(cli.razon || '—')} · ${FMT.money(t.total)} · ${cot.items.length} renglones</p>
        </div>
        <div class="app-page-header-actions">
          <button class="btn btn-ghost" id="btnDuplicar"><i data-lucide="copy"></i> Duplicar</button>
          ${(cot.estado === 'aprobada' || cot.estado === 'enviada' || cot.estado === 'convertida') ? '<button class="btn btn-ghost" id="btnEnviar"><i data-lucide="send"></i> Reenviar al cliente</button>' : ''}
          <button class="btn btn-secondary" id="btnEditar"><i data-lucide="pencil"></i> Editar</button>
          <button class="btn btn-primary" id="btnImprimir"><i data-lucide="printer"></i> Imprimir / PDF</button>
        </div>
      </div>

      <div class="cc-detail-grid">
        <div>
          <!-- Cliente -->
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="building-2"></i> Cliente</h3></div>
            <div class="cc-panel-body">
              <dl class="cc-kv">
                <dt>Razón social</dt><dd>${esc(cli.razon || '—')}</dd>
                ${cli.representante ? `<dt>Representante legal</dt><dd>${esc(cli.representante)}</dd>` : ''}
                <dt>Dirigido a</dt><dd>${esc(dirigidoA || '—')}</dd>
                <dt>Email destinatario</dt><dd>${esc(dirigidoEmail || '—')}</dd>
                <dt>RUC</dt><dd style="font-family:var(--font-mono);">${esc(cli.ruc || '—')}</dd>
                <dt>Teléfono</dt><dd style="font-family:var(--font-mono);">${esc(cli.tel || '—')}</dd>
                <dt>Correo cliente</dt><dd>${esc(cli.email || '—')}</dd>
              </dl>
            </div>
          </div>

          <!-- Renglones -->
          <div class="cc-panel">
            <div class="cc-panel-head">
              <h3><i data-lucide="list"></i> Renglones</h3>
              <span style="font-size:12px; color:var(--fg-3);">${T.cuenta(cot.items)} unidades</span>
            </div>
            <div style="padding:0 4px 4px;">
              <table class="app-table">
                <thead>
                  <tr><th style="width:40px;">#</th><th>Descripción</th>
                    <th style="width:70px; text-align:center;">Cant.</th>
                    <th style="width:100px; text-align:right;">P. unit.</th>
                    <th style="width:110px; text-align:right;">Total</th></tr>
                </thead>
                <tbody>
                  ${cot.items.map((it, i) => `
                    <tr>
                      <td class="td-muted">${String(i + 1).padStart(2, '0')}</td>
                      <td>
                        <div style="font-weight:600; color:var(--fg-1);">${esc(it.nombre)}</div>
                        <div style="font-size:11.5px; color:var(--fg-3);">${esc(it.spec || '')}${it.modelo ? ' · ' + esc(it.modelo) : ''}${it.desc > 0 ? ' · desc ' + it.desc + '%' : ''}</div>
                      </td>
                      <td style="text-align:center; font-family:var(--font-mono);">${esc(it.cant)}</td>
                      <td style="text-align:right; font-family:var(--font-mono);">${FMT.money(it.precio)}</td>
                      <td style="text-align:right; font-family:var(--font-mono); font-weight:600; color:var(--fg-1);">${FMT.money(T.lineTotal(it))}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
            </div>
          </div>

          <!-- Condiciones -->
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="clipboard-check"></i> Condiciones</h3></div>
            <div class="cc-panel-body">
              <dl class="cc-kv">
                ${cot.condiciones.map(c => `<dt>${esc(c.k)}</dt><dd>${esc(c.v)}</dd>`).join('')}
              </dl>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div>
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="calculator"></i> Totales</h3></div>
            <div class="cc-panel-body">
              <div class="cc-sum-row"><span>Subtotal</span><span class="v">${FMT.money(t.subtotal)}</span></div>
              ${cot.descuentoPct > 0 ? `<div class="cc-sum-row disc"><span>Descuento (${cot.descuentoPct}%)</span><span class="v">−${FMT.money(t.descGlobal)}</span></div>` : ''}
              <div class="cc-sum-row"><span>ITBMS (${cot.itbmsPct}%)</span><span class="v">${FMT.money(t.itbms)}</span></div>
              <div class="cc-sum-total"><span class="lbl">Total</span><span class="v">${FMT.money(t.total)}</span></div>
              <dl class="cc-kv" style="margin-top:18px; gap:8px 14px;">
                <dt>Emitida</dt><dd>${esc(fmtFechaCorta(cot.fecha))}</dd>
                <dt>Vence</dt><dd>${esc(fmtFechaCorta(vence))}</dd>
                <dt>Ejecutivo</dt><dd>${esc(ej.nombre)}</dd>
              </dl>
            </div>
          </div>

          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="zap"></i> Cambiar estado</h3></div>
            <div class="cc-panel-body" id="panelTransiciones"></div>
          </div>

          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="history"></i> Historial</h3></div>
            <div class="cc-panel-body">
              <ul class="cc-timeline">
                ${historial(cot, cli).map(h => `<li><div class="cc-tl-act">${esc(h.act)}</div><div class="cc-tl-meta">${esc(h.meta)}</div></li>`).join('')}
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;

    $('btnDuplicar').addEventListener('click', duplicar);
    const btnEnv = $('btnEnviar');
    if (btnEnv) btnEnv.addEventListener('click', () => enviarPorCorreo(cli, ej));
    $('btnEditar').addEventListener('click', () => { location.href = 'editar-cotizacion.html?id=' + encodeURIComponent(cot._docId); });
    $('btnImprimir').addEventListener('click', () => { window.open('imprimir-cotizacion.html?id=' + encodeURIComponent(cot._docId), '_blank'); });

    renderTransiciones();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Transiciones de estado ────────────────────────────────────
  const TRANSICIONES = {
    borrador:   ['enviada'],
    enviada:    ['aprobada', 'rechazada', 'vencida'],
    aprobada:   ['convertida', 'rechazada'],
    rechazada:  ['borrador'],
    vencida:    ['enviada', 'borrador'],
    convertida: [],
  };

  function renderTransiciones() {
    const cont = $('panelTransiciones');
    const opts = TRANSICIONES[cot.estado] || [];
    if (!opts.length) {
      cont.innerHTML = '<p style="font-size:12.5px; color:var(--fg-3); margin:0;">Estado final — sin transiciones disponibles.</p>';
      return;
    }
    cont.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:8px;">' +
      opts.map(e => {
        const label = CotState.ESTADOS[e].label;
        const danger = (e === 'rechazada' || e === 'vencida');
        return `<button class="btn btn-${danger ? 'ghost' : 'secondary'} btn-sm" data-estado="${e}">Marcar ${label}</button>`;
      }).join('') + '</div>';
    cont.querySelectorAll('button[data-estado]').forEach(b => {
      b.addEventListener('click', () => cambiarEstado(b.dataset.estado));
    });
  }

  async function cambiarEstado(nuevo) {
    const ok = await Modal.confirm({
      title: 'Cambiar estado',
      message: `¿Cambiar el estado a "${CotState.ESTADOS[nuevo].label}"?`,
    });
    if (!ok) return;
    try {
      await CotizacionesService.updateCotizacion(cot._docId, {
        estado: nuevo,
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp(),
      });
      cot.estado = nuevo;
      Toast.show('Estado actualizado', 'ok');
      render();
    } catch (err) {
      Toast.show('Error: ' + (err?.message || err), 'bad');
    }
  }

  // ── Enviar por correo ─────────────────────────────────────────
  async function enviarPorCorreo(cli, ej) {
    const defaultDest = cot.dirigido_email || cli.email || '';
    const dest = await Modal.prompt({
      title: 'Enviar cotización por correo',
      message: 'Correo del destinatario:',
      defaultValue: defaultDest,
      placeholder: 'destinatario@empresa.com',
    });
    if (!dest) return;

    const emisor = catalogos.emisor;
    const t = T.calcTotales(cot);
    const html = `
      <div style="font-family:Arial, sans-serif; color:#111;">
        <p>Estimados señores,</p>
        <p>${esc(cot.intro || 'Adjuntamos la cotización solicitada.')}</p>
        <p><b>Cotización:</b> ${esc(cot.id)}<br>
        <b>Total:</b> ${FMT.money(t.total)}<br>
        <b>Validez:</b> ${cot.validezDias} días</p>
        <p>Para imprimir o descargar la cotización en PDF, abra el siguiente enlace:</p>
        <p><a href="${location.origin}/cotizaciones/imprimir-cotizacion.html?id=${encodeURIComponent(cot._docId)}">Ver cotización ${esc(cot.id)}</a></p>
        <p>Atentamente,<br>
        ${esc(ej.nombre || '')}<br>
        ${esc(ej.rol || '')}<br>
        ${esc(emisor.razon)}<br>
        ${esc(emisor.tel)} · ${esc(emisor.email)}</p>
      </div>
    `;
    try {
      await CotizacionesService.enviarPorCorreo(cot._docId, {
        to: dest,
        subject: 'Cotización ' + cot.id + ' · ' + emisor.razon,
        html,
      });
      cot.estado = 'enviada';
      Toast.show('Cotización enviada a ' + dest, 'ok');
      render();
    } catch (err) {
      Toast.show('Error al enviar: ' + (err?.message || err), 'bad');
    }
  }

  async function duplicar() {
    const nuevoId = await CotState.nextCotizacionId();
    const copia = CotState.toDoc({ ...cot, id: nuevoId, estado: 'borrador', fecha: new Date().toISOString().slice(0, 10) }, { catalogos });
    copia.fecha_creacion = firebase.firestore.FieldValue.serverTimestamp();
    const ref = await CotizacionesService.addCotizacion(copia);
    Toast.show('Cotización duplicada como ' + nuevoId, 'ok');
    location.href = 'editar-cotizacion.html?id=' + encodeURIComponent(ref.id);
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    verificarAccesoYAplicarVisibilidad(async (rol) => {
      const permitidos = [ROLES.ADMIN, ROLES.VENDEDOR];
      if (!permitidos.includes(rol)) { Toast.show('Sin acceso', 'bad'); location.href = '../index.html'; return; }

      const params = new URLSearchParams(location.search);
      const docId = params.get('id');
      if (!docId) { Toast.show('Falta id', 'bad'); location.href = 'index.html'; return; }
      const doc = await CotizacionesService.getCotizacion(docId);
      if (!doc) { Toast.show('No encontrada', 'bad'); location.href = 'index.html'; return; }

      // Vendedor solo ve las propias
      if (rol === ROLES.VENDEDOR && doc.creado_por_uid && doc.creado_por_uid !== user.uid) {
        Toast.show('Solo el creador o un administrador puede ver esta cotización.', 'bad');
        location.href = 'index.html';
        return;
      }

      catalogos = await CotState.bootstrapCatalogos();
      cot = CotState.toUi(doc);
      render();
    });
  });
})();
