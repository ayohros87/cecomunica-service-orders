// @ts-nocheck
// Detalle de cotización — vista de lectura con timeline derivado del estado.
(() => {
  let cot = null;
  let catalogos = null;
  let userRol = null;

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

  // Acepta string ISO, Date o Firestore Timestamp y lo formatea como "2 Jun 2026".
  // El historial guarda Timestamps (Firestore) y fechas ISO (campo `fecha`);
  // unificamos en una sola función para evitar fechas futuras inventadas.
  function fmtFechaAny(v) {
    if (!v) return '—';
    let d = null;
    if (typeof v === 'string') {
      d = new Date(v.length === 10 ? v + 'T00:00:00' : v);
    } else if (v?.toDate) {
      d = v.toDate();
    } else if (v instanceof Date) {
      d = v;
    }
    if (!d || isNaN(d.getTime())) return '—';
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
  }

  function estadoChipHtml(estado) {
    const e = CotState.ESTADOS[estado] || CotState.ESTADOS.borrador;
    return `<span class="chip-estado ${e.chip}">${e.label}</span>`;
  }

  // Historial reconstruido a partir de los timestamps reales del documento.
  // Antes se derivaban "+1 día / +5 días / +6 días" desde `fecha` y aparecían
  // fechas futuras (la conversión decía 8 Jun aunque se cerró el 2 Jun).
  function historial(cot, cliente) {
    const h = [{
      act: 'Cotización creada',
      meta: fmtFechaAny(cot.fecha_creacion || cot.fecha) + ' · ' + (cot.ejecutivo_nombre || '—'),
    }];
    if (cot.fecha_aprobacion) {
      h.push({
        act: 'Aprobada internamente',
        meta: fmtFechaAny(cot.fecha_aprobacion) + ' · por administrador',
      });
    }
    if (cot.enviada_en) {
      const dest = cot.dirigido_email || cliente.email || '—';
      h.push({
        act: 'Enviada al cliente',
        meta: fmtFechaAny(cot.enviada_en) + ' · por correo a ' + dest,
      });
    }
    if (cot.fecha_conversion) {
      h.push({
        act: 'Convertida a orden de venta',
        meta: fmtFechaAny(cot.fecha_conversion) + ' · venta cerrada',
      });
    }
    if (cot.fecha_rechazo) {
      h.push({
        act: 'Rechazada',
        meta: fmtFechaAny(cot.fecha_rechazo) + ' · cliente declinó',
      });
    }
    if (cot.estado === 'vencida') {
      h.push({
        act: 'Validez vencida',
        meta: fmtFechaAny(T.validezVence(cot)) + ' · sin respuesta del cliente',
      });
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
          ${(cot.estado === 'borrador' && canRole(userRol, 'aprobar-cotizacion')) ? '<button class="btn btn-secondary" id="btnAprobar" style="background:#065F46; color:#fff; border-color:#065F46;"><i data-lucide="check-circle"></i> Aprobar y enviar</button>' : ''}
          <button class="btn btn-ghost" id="btnDuplicar"><i data-lucide="copy"></i> Duplicar</button>
          ${(cot.estado === 'aprobada' || cot.estado === 'enviada' || cot.estado === 'convertida') ? '<button class="btn btn-ghost" id="btnEnviar"><i data-lucide="send"></i> Reenviar al cliente</button>' : ''}
          ${(cot.estado === 'aprobada' || cot.estado === 'enviada') ? '<button class="btn btn-secondary" id="btnCerrar" style="background:#0B2A47; color:#fff; border-color:#0B2A47;"><i data-lucide="flag"></i> Cerrar cotización</button>' : ''}
          ${CotState.esEditable(cot.estado) ? '<button class="btn btn-secondary" id="btnEditar"><i data-lucide="pencil"></i> Editar</button>' : ''}
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
              <div class="cc-sum-row"><span>${cot.itbmsPct > 0 ? 'ITBMS (' + cot.itbmsPct + '%)' : 'ITBMS exento'}</span><span class="v">${FMT.money(t.itbms)}</span></div>
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
    const btnCer = $('btnCerrar');
    if (btnCer) btnCer.addEventListener('click', () => cerrarCotizacion(cli));
    // "Aprobar y enviar" (admin + borrador): la lógica vive en el listado
    // — redirigimos con ?aprobar=<docId> y allí se abre el panel de aprobación.
    const btnAp = $('btnAprobar');
    if (btnAp) btnAp.addEventListener('click', () => {
      location.href = 'index.html?aprobar=' + encodeURIComponent(cot._docId);
    });
    const btnEd = $('btnEditar');
    if (btnEd) btnEd.addEventListener('click', () => { location.href = 'editar-cotizacion.html?id=' + encodeURIComponent(cot._docId); });
    $('btnImprimir').addEventListener('click', () => { window.open('imprimir-cotizacion.html?id=' + encodeURIComponent(cot._docId), '_blank'); });

    renderTransiciones();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Transiciones de estado ────────────────────────────────────
  // borrador → aprobada (admin aprueba) → enviada (auto al cliente) → convertida
  // Borrador YA NO tiene salto directo a "enviada": antes ese atajo permitía
  // marcar como enviada sin pasar por aprobación y luego el admin no podía
  // aprobar (estado ya no era borrador). La salida correcta de borrador es
  // el botón "Aprobar y enviar" del header (solo admin), que sí envía correo.
  const TRANSICIONES = {
    borrador:   [],
    aprobada:   ['enviada', 'convertida', 'rechazada'],
    enviada:    ['convertida', 'rechazada', 'vencida'],
    rechazada:  ['borrador'],
    vencida:    ['enviada', 'borrador'],
    convertida: [],
  };

  function renderTransiciones() {
    const cont = $('panelTransiciones');
    if (cot.estado === 'borrador') {
      const txt = canRole(userRol, 'aprobar-cotizacion')
        ? 'Esta cotización está en borrador. Usa <b>Aprobar y enviar</b> arriba para revisar y enviar al cliente.'
        : 'Esta cotización está en borrador, pendiente de aprobación por un administrador o jefe de taller.';
      cont.innerHTML = '<p style="font-size:12.5px; color:var(--fg-3); margin:0; line-height:1.5;">' + txt + '</p>';
      return;
    }
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

  async function cerrarCotizacion(cli) {
    const t = T.calcTotales(cot);
    const desenlace = await CotState.cerrarPrompt({
      cotizacionId: cot.id,
      total: t.total,
      cliente: cli?.razon || cot.cliente_nombre || '',
    });
    if (!desenlace) return;
    try {
      const patch = { estado: desenlace };
      if (desenlace === 'convertida') {
        patch.fecha_conversion = firebase.firestore.Timestamp.now();
        patch.convertida_por_uid = firebase.auth().currentUser?.uid || null;
      } else {
        patch.fecha_rechazo = firebase.firestore.Timestamp.now();
        patch.rechazado_por_uid = firebase.auth().currentUser?.uid || null;
      }
      await CotizacionesService.updateCotizacion(cot._docId, patch);
      cot.estado = desenlace;
      Toast.show(desenlace === 'convertida' ? '🏆 Convertida a venta' : 'Cotización rechazada', desenlace === 'convertida' ? 'ok' : 'warn');
      render();
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cerrar: ' + (e?.message || e), 'bad');
    }
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

  // ── Enviar por correo (panel con preview) ─────────────────────
  async function enviarPorCorreo(cli, ej) {
    const t = T.calcTotales(cot);
    // Generar link público antes de abrir el panel.
    let link;
    try {
      const snapshot = {
        id: cot.id, estado: cot.estado, fecha: cot.fecha, validezDias: cot.validezDias,
        moneda: cot.moneda, descuentoPct: cot.descuentoPct, itbmsPct: cot.itbmsPct,
        intro: cot.intro, items: cot.items, condiciones: cot.condiciones,
        subtotal: t.subtotal, descGlobal: t.descGlobal, itbms: t.itbms, total: t.total,
        cliente: { razon: cli.razon, ruc: cli.ruc, tel: cli.tel, email: cli.email, representante: cli.representante },
        ejecutivo: { nombre: ej.nombre, rol: ej.rol, email: ej.email, tel: ej.tel },
      };
      const result = await CotizacionesService.ensureVerificacionPublica(cot._docId, {
        cotizacion_id: cot.id,
        cliente_nombre: cli.razon || '',
        dirigido_a: cot.dirigido_a, dirigido_email: cot.dirigido_email,
        ejecutivo_nombre: ej.nombre || '',
        creado_por_uid: cot.creado_por_uid, creado_por_email: cot.creado_por_email,
        total: t.total, moneda: cot.moneda, fecha: cot.fecha, validezDias: cot.validezDias,
        snapshot, emisor: catalogos.emisor,
      });
      link = result.url;
    } catch (e) { Toast.show('No se pudo generar el link público: ' + (e?.message || e), 'bad'); return; }

    const payload = await CotState.reenviarPrompt({
      cotizacionId: cot.id,
      clienteNombre: cli.razon || '',
      total: t.total,
      dirigidoA: cot.dirigido_a || '',
      defaultDest: cot.dirigido_email || cli.email || '',
      ccEmail: cot.creado_por_email || '',
      intro: cot.intro || '',
      validezDias: cot.validezDias || 15,
      ejecutivo: ej.nombre || '',
      link,
    });
    if (!payload) return;

    try {
      await CotizacionesService.enviarPorCorreo(cot._docId, {
        to: payload.dest,
        cc: cot.creado_por_email || null,
        subject: payload.subject,
        html: payload.html,
      });
      cot.estado = 'enviada';
      Toast.show('Cotización enviada a ' + payload.dest, 'ok');
      render();
    } catch (err) {
      Toast.show('Error al enviar: ' + (err?.message || err), 'bad');
    }
  }

  async function duplicar() {
    const nuevoId = await CotState.nextCotizacionId();
    const user = firebase.auth().currentUser;
    const copia = CotState.toDoc(
      { ...cot, id: nuevoId, estado: 'borrador', fecha: new Date().toISOString().slice(0, 10),
        creado_por_uid: user?.uid || null, creado_por_email: user?.email || null },
      { catalogos }
    );
    copia.fecha_creacion = firebase.firestore.FieldValue.serverTimestamp();
    copia.fecha_modificacion = firebase.firestore.FieldValue.serverTimestamp();
    const ref = await CotizacionesService.addCotizacion(copia);
    // La cotización duplicada nace en borrador → notificar a ventas igual que una nueva.
    try { await CotState.enqueueAprobacionMail({ doc: copia, docId: ref.id, user }); }
    catch (e) { console.warn('No se pudo encolar correo de aprobación al duplicar:', e); }
    Toast.show('Cotización duplicada como ' + nuevoId + ' · solicitud enviada a ventas@cecomunica.com', 'ok');
    location.href = 'editar-cotizacion.html?id=' + encodeURIComponent(ref.id);
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    verificarAccesoYAplicarVisibilidad(async (rol) => {
      userRol = rol;
      const permitidos = [ROLES.ADMIN, ROLES.VENDEDOR, ROLES.JEFE_TALLER, ROLES.RECEPCION];
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
