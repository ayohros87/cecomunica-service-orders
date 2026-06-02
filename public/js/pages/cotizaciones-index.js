// @ts-nocheck
// Lista de cotizaciones — UI Kit (stats, segmented filter, sortable table)
(() => {
  let cotizaciones = [];
  let lastDoc = null;
  let isLoading = false;
  let filtroEstado = 'todas';
  let sortKey = 'fecha';
  let sortDir = 'desc';
  let userUid = null;
  let userRol = null;
  let soloMias = false;     // toggle "Solo mis cotizaciones" (admins; forzado para vendedores)

  const $ = (id) => document.getElementById(id);

  // ── Fecha helpers ─────────────────────────────────────────────
  function fechaIso(c) {
    // Esquema kit: campo `fecha` ISO YYYY-MM-DD.
    return c.fecha || (c.fecha_creacion?.toDate ? c.fecha_creacion.toDate().toISOString().slice(0, 10) : '');
  }
  function fmtFechaCorta(iso) {
    if (!iso) return '—';
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) return '—';
    return d.getDate() + ' ' + meses[d.getMonth()] + ' ' + d.getFullYear();
  }

  // ── Carga ─────────────────────────────────────────────────────
  async function cargarCotizaciones(esInicial = true) {
    if (isLoading) return;
    isLoading = true;
    const btn = $('btnCargarMas');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader"></i> Cargando...'; }
    if (esInicial) { cotizaciones = []; lastDoc = null; }

    const { docs, lastDoc: cursor } = await CotizacionesService.listCotizaciones({ lastDoc, limit: 30 });
    if (docs.length) { lastDoc = cursor; cotizaciones.push(...docs); }
    render();

    if (btn) {
      btn.disabled = false;
      btn.style.display = docs.length ? 'inline-flex' : 'none';
      btn.innerHTML = '<i data-lucide="chevron-down"></i> Cargar más';
    }
    isLoading = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Filtros / orden ───────────────────────────────────────────
  function getFiltradas() {
    const term = ($('filtroTexto').value || '').trim().toLowerCase();
    const mostrarEliminadas = $('toggleEliminadas').checked;
    let list = cotizaciones.slice();
    if (!mostrarEliminadas) list = list.filter(c => !c.deleted);
    // Vendedor solo ve las propias (forzado). Admin con toggle.
    if (soloMias) list = list.filter(c => c.creado_por_uid === userUid);
    if (filtroEstado !== 'todas') list = list.filter(c => (c.estado || 'borrador') === filtroEstado);
    if (term) {
      list = list.filter(c => {
        const blob = (c.cotizacion_id || '') + ' ' + (c.cliente_nombre || '') + ' ' + (c.ejecutivo_nombre || '');
        return blob.toLowerCase().includes(term);
      });
    }
    list.sort((a, b) => {
      let av, bv;
      if (sortKey === 'total') { av = Number(a.total || 0); bv = Number(b.total || 0); }
      else if (sortKey === 'cliente') { av = (a.cliente_nombre || '').toLowerCase(); bv = (b.cliente_nombre || '').toLowerCase(); }
      else if (sortKey === 'fecha') { av = fechaIso(a); bv = fechaIso(b); }
      else { av = a.cotizacion_id || ''; bv = b.cotizacion_id || ''; }
      const r = av > bv ? 1 : av < bv ? -1 : 0;
      return sortDir === 'asc' ? r : -r;
    });
    return list;
  }

  // ── Render ────────────────────────────────────────────────────
  function render() {
    const filtradas = getFiltradas();
    renderSegments();
    renderStats();
    renderTabla(filtradas);
    renderCards(filtradas);
    renderSortIcons();
    $('emptyState').style.display = filtradas.length ? 'none' : '';
    $('footerResumen').textContent = filtradas.length + ' de ' + cotizaciones.length + ' cotizaciones';
    $('headerSubtitle').textContent = cotizaciones.length + ' cotizaciones cargadas';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderSegments() {
    const wrap = $('segments');
    if (!wrap) return;
    const counts = { todas: cotizaciones.filter(c => !c.deleted).length };
    CotState.ESTADO_ORDEN.forEach(e => {
      counts[e] = cotizaciones.filter(c => !c.deleted && (c.estado || 'borrador') === e).length;
    });
    const segs = [
      { key: 'todas', label: 'Todas', count: counts.todas },
      ...CotState.ESTADO_ORDEN.map(e => ({ key: e, label: CotState.ESTADOS[e].label, count: counts[e] })),
    ];
    wrap.innerHTML = segs.map(s => `
      <button type="button" class="cc-seg${filtroEstado === s.key ? ' active' : ''}" data-estado="${s.key}">
        ${s.label} <span class="cc-seg-count">${s.count}</span>
      </button>
    `).join('');
  }

  function renderStats() {
    const visibles = cotizaciones.filter(c => !c.deleted);
    const enviadas = visibles.filter(c => c.estado === 'enviada').length;
    // "Monto cerrado": solo cotizaciones convertidas a venta efectiva.
    const montoCerrado = visibles
      .filter(c => c.estado === 'convertida')
      .reduce((s, c) => s + Number(c.total || 0), 0);
    // Tasa de cierre: convertidas / oportunidades activas (enviadas + convertidas + rechazadas + vencidas).
    // Excluye borrador (en proceso) y aprobada (aún no llegó al cliente).
    const convertidas = visibles.filter(c => c.estado === 'convertida').length;
    const oportunidades = visibles.filter(c => ['enviada', 'convertida', 'rechazada', 'vencida'].includes(c.estado)).length;
    const tasa = oportunidades > 0 ? Math.round(convertidas / oportunidades * 100) : 0;
    $('statTotal').textContent = visibles.length;
    $('statPendientes').textContent = enviadas;
    $('statMontoAprobado').textContent = FMT.money(montoCerrado);
    $('statTasa').textContent = tasa + '%';
  }

  function estadoChip(estado) {
    const e = CotState.ESTADOS[estado] || CotState.ESTADOS.borrador;
    return `<span class="chip-estado ${e.chip}">${e.label}</span>`;
  }

  function renderTabla(lista) {
    const tbody = $('tablaCotizaciones');
    if (!tbody) return;
    tbody.innerHTML = lista.map(c => {
      const id = c.cotizacion_id || c.id;
      const total = FMT.money(Number(c.total || 0));
      return `
        <tr data-id="${c.id}">
          <td><span class="cc-cell-num">${id}</span></td>
          <td>
            <div class="cc-cell-cliente">${c.cliente_nombre || '—'}</div>
            ${c.cliente_email ? '<div class="cc-aten">' + c.cliente_email + '</div>' : ''}
          </td>
          <td class="td-muted">${fmtFechaCorta(fechaIso(c))}</td>
          <td>${estadoChip(c.estado || 'borrador')}</td>
          <td style="font-size:13px;">${c.ejecutivo_nombre || '—'}</td>
          <td class="cc-cell-total">${total}</td>
          <td class="td-actions">
            <span class="cc-row-actions">
              ${(userRol === ROLES.ADMIN && (c.estado || 'borrador') === 'borrador') ? `<button class="btn btn-ghost btn-icon btn-sm" title="Aprobar" data-action="aprobar"><i data-lucide="check-circle"></i></button>` : ''}
              ${(c.estado === 'aprobada' || c.estado === 'enviada') ? `<button class="btn btn-ghost btn-icon btn-sm" title="Cerrar cotización" data-action="cerrar"><i data-lucide="flag"></i></button>` : ''}
              <button class="btn btn-ghost btn-icon btn-sm" title="Ver" data-action="detalle"><i data-lucide="eye"></i></button>
              <button class="btn btn-ghost btn-icon btn-sm" title="Editar" data-action="editar"><i data-lucide="pencil"></i></button>
              ${(c.estado === 'aprobada' || c.estado === 'enviada' || c.estado === 'convertida') ? `<button class="btn btn-ghost btn-icon btn-sm" title="Reenviar al cliente" data-action="enviar"><i data-lucide="send"></i></button>` : ''}
              <button class="btn btn-ghost btn-icon btn-sm" title="Duplicar" data-action="duplicar"><i data-lucide="copy"></i></button>
              <button class="btn btn-ghost btn-icon btn-sm" title="Imprimir / PDF" data-action="imprimir"><i data-lucide="printer"></i></button>
              <button class="btn btn-ghost btn-icon btn-sm" title="Eliminar" data-action="eliminar"><i data-lucide="trash-2"></i></button>
            </span>
          </td>
        </tr>
      `;
    }).join('');
  }

  function renderCards(lista) {
    const wrap = $('listaCotizacionesMovil');
    if (!wrap) return;
    wrap.innerHTML = lista.map(c => {
      const id = c.cotizacion_id || c.id;
      return `
        <div class="responsive-card" data-id="${c.id}">
          <div class="responsive-card-top">
            <div>
              <div class="responsive-card-title">${c.cliente_nombre || '—'}</div>
              <div class="responsive-card-sub"><span class="cc-cell-num">${id}</span> · ${fmtFechaCorta(fechaIso(c))}</div>
            </div>
            ${estadoChip(c.estado || 'borrador')}
          </div>
          <div class="responsive-card-meta">
            <span>${c.ejecutivo_nombre || '—'}</span>
            <span class="cc-cell-total">${FMT.money(Number(c.total || 0))}</span>
          </div>
          <div class="responsive-card-actions">
            <button class="btn btn-ghost btn-sm" data-action="detalle"><i data-lucide="eye"></i> Ver</button>
            <button class="btn btn-ghost btn-sm" data-action="editar"><i data-lucide="pencil"></i> Editar</button>
            <button class="btn btn-ghost btn-sm" data-action="imprimir"><i data-lucide="printer"></i> Imprimir</button>
          </div>
        </div>
      `;
    }).join('');
  }

  function renderSortIcons() {
    document.querySelectorAll('th.sortable').forEach(th => {
      const k = th.dataset.sort;
      const active = sortKey === k;
      const icon = th.querySelector('.sort-icon i');
      if (icon) {
        icon.setAttribute('data-lucide', active && sortDir === 'asc' ? 'chevron-up' : 'chevron-down');
        th.querySelector('.sort-icon').style.opacity = active ? '1' : '0.35';
      }
    });
  }

  // ── Acciones ──────────────────────────────────────────────────
  async function onAction(action, docId) {
    const cot = cotizaciones.find(c => c.id === docId);
    if (!cot) return;
    if (action === 'detalle')  { location.href = `detalle-cotizacion.html?id=${encodeURIComponent(docId)}`; return; }
    if (action === 'editar')   { location.href = `editar-cotizacion.html?id=${encodeURIComponent(docId)}`; return; }
    if (action === 'imprimir') { window.open(`imprimir-cotizacion.html?id=${encodeURIComponent(docId)}`, '_blank'); return; }
    if (action === 'duplicar') { return await duplicar(cot); }
    if (action === 'eliminar') { return await eliminar(cot); }
    if (action === 'enviar')   { return await enviar(cot); }
    if (action === 'aprobar')  { return openAprobacion(cot.id); }
    if (action === 'cerrar')   { return await cerrarDesdeLista(cot); }
  }

  async function cerrarDesdeLista(cot) {
    const desenlace = await CotState.cerrarPrompt({
      cotizacionId: cot.cotizacion_id || cot.id,
      total: Number(cot.total || 0),
      cliente: cot.cliente_nombre || '',
    });
    if (!desenlace) return;
    const patch = { estado: desenlace };
    if (desenlace === 'convertida') {
      patch.fecha_conversion = firebase.firestore.Timestamp.now();
      patch.convertida_por_uid = userUid;
    } else {
      patch.fecha_rechazo = firebase.firestore.Timestamp.now();
      patch.rechazado_por_uid = userUid;
    }
    try {
      await CotizacionesService.updateCotizacion(cot.id, patch);
      cot.estado = desenlace;
      Toast.show(desenlace === 'convertida' ? '🏆 Convertida a venta' : 'Cotización rechazada',
                 desenlace === 'convertida' ? 'ok' : 'warn');
      render();
    } catch (e) {
      Toast.show('No se pudo cerrar: ' + (e?.message || e), 'bad');
    }
  }

  async function enviar(cot) {
    // Pre-cargar link público (puede tardar un instante) antes de mostrar preview.
    let link;
    try { link = await ensureLinkPublico(cot.id); }
    catch (e) { Toast.show('No se pudo generar el link público: ' + (e?.message || e), 'bad'); return; }

    const payload = await CotState.reenviarPrompt({
      cotizacionId: cot.cotizacion_id || cot.id,
      clienteNombre: cot.cliente_nombre || '',
      total: Number(cot.total || 0),
      dirigidoA: cot.dirigido_a || '',
      defaultDest: cot.dirigido_email || cot.cliente_email || '',
      ccEmail: cot.creado_por_email || '',
      intro: cot.intro || '',
      validezDias: cot.validezDias || 15,
      ejecutivo: cot.ejecutivo_nombre || '',
      link,
    });
    if (!payload) return;
    try {
      await CotizacionesService.enviarPorCorreo(cot.id, {
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

  async function duplicar(src) {
    const nuevoId = await CotState.nextCotizacionId();
    const copia = { ...src };
    delete copia.id;
    copia.cotizacion_id = nuevoId;
    copia.estado = 'borrador';
    copia.fecha = new Date().toISOString().slice(0, 10);
    copia.deleted = false;
    copia.fecha_creacion = firebase.firestore.FieldValue.serverTimestamp();
    const ref = await CotizacionesService.addCotizacion(copia);
    Toast.show('Cotización duplicada como ' + nuevoId, 'ok');
    location.href = `editar-cotizacion.html?id=${encodeURIComponent(ref.id)}`;
  }

  async function eliminar(cot) {
    const ok = await Modal.confirm({
      title: 'Eliminar cotización',
      message: '¿Seguro que deseas eliminar ' + (cot.cotizacion_id || cot.id) + '? Podrá restaurarse desde "Mostrar eliminadas".',
      danger: true,
    });
    if (!ok) return;
    await CotizacionesService.softDelete(cot.id);
    cot.deleted = true;
    Toast.show('Cotización eliminada', 'warn');
    render();
  }

  // ── Helpers de envío público ──────────────────────────────────
  async function ensureLinkPublico(docId) {
    const doc = await CotizacionesService.getCotizacion(docId);
    if (!doc) throw new Error('Cotización no encontrada');
    const ui = CotState.toUi(doc);
    const cat = await CotState.bootstrapCatalogos();
    const cli = cat.clientesById[ui.clienteId] || {};
    const ej  = cat.ejecutivos.find(e => e.id === ui.ejecutivoId) || {};
    const t   = window.CotizacionTotales.calcTotales(ui);
    const snapshot = {
      id: ui.id, estado: ui.estado, fecha: ui.fecha, validezDias: ui.validezDias,
      moneda: ui.moneda, descuentoPct: ui.descuentoPct, itbmsPct: ui.itbmsPct,
      intro: ui.intro, items: ui.items, condiciones: ui.condiciones,
      subtotal: t.subtotal, descGlobal: t.descGlobal, itbms: t.itbms, total: t.total,
      cliente: { razon: cli.razon, ruc: cli.ruc, tel: cli.tel, email: cli.email, representante: cli.representante },
      ejecutivo: { nombre: ej.nombre, rol: ej.rol, email: ej.email, tel: ej.tel },
    };
    const { url } = await CotizacionesService.ensureVerificacionPublica(docId, {
      cotizacion_id: ui.id,
      cliente_nombre: cli.razon || doc.cliente_nombre || '',
      dirigido_a: doc.dirigido_a,
      dirigido_email: doc.dirigido_email,
      ejecutivo_nombre: ej.nombre || doc.ejecutivo_nombre || '',
      creado_por_uid: doc.creado_por_uid,
      creado_por_email: doc.creado_por_email,
      total: t.total, moneda: ui.moneda, fecha: ui.fecha, validezDias: ui.validezDias,
      snapshot, emisor: cat.emisor,
    });
    return url;
  }

  // ── Aprobación overlay (solo admin) ───────────────────────────
  const T = window.CotizacionTotales;
  let _aprobId = null;

  async function openAprobacion(docId) {
    if (userRol !== ROLES.ADMIN) { Toast.show('Solo un administrador puede aprobar.', 'warn'); return; }
    const doc = await CotizacionesService.getCotizacion(docId);
    if (!doc) { Toast.show('Cotización no encontrada', 'bad'); return; }
    _aprobId = docId;
    const ui = CotState.toUi(doc);
    const tot = T.calcTotales(ui);
    const fechaTxt = ui.fecha || '—';

    $('bodyCotAprobacion').innerHTML = `
      <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-4); margin-bottom:var(--sp-3);">
        <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="file-text"></i> Detalles de la cotización</legend>
        <div style="font-size:14px;">
          <p style="margin:4px 0;"><b>Cotización ID:</b> ${ui.id}</p>
          <p style="margin:4px 0;"><b>Cliente:</b> ${doc.cliente_nombre || '—'}</p>
          <p style="margin:4px 0;"><b>Dirigido a:</b> ${doc.dirigido_a || '—'}</p>
          <p style="margin:4px 0;"><b>Email destinatario:</b> ${doc.dirigido_email || '—'}</p>
          <p style="margin:4px 0;"><b>Ejecutivo:</b> ${doc.ejecutivo_nombre || '—'}</p>
          <p style="margin:4px 0;"><b>Fecha:</b> ${fechaTxt} · <b>Validez:</b> ${ui.validezDias} días</p>
          <p style="margin:4px 0;"><b>Introducción:</b> ${doc.intro || '—'}</p>
          <div style="margin-top:8px; padding:8px; border:1px dashed var(--border-default); border-radius:8px; max-width:420px;">
            <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><strong>${FMT.money(tot.subtotal)}</strong></div>
            ${ui.descuentoPct > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Descuento (${ui.descuentoPct}%)</span><strong>−${FMT.money(tot.descGlobal)}</strong></div>` : ''}
            <div style="display:flex; justify-content:space-between;"><span>ITBMS (${ui.itbmsPct}%)</span><strong>${FMT.money(tot.itbms)}</strong></div>
            <div style="border-top:1px solid var(--border-default); margin-top:6px; padding-top:6px; display:flex; justify-content:space-between;">
              <span><b>Total</b></span><strong>${FMT.money(tot.total)}</strong>
            </div>
          </div>
        </div>
      </fieldset>
      <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-3);">
        <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="list"></i> Renglones</legend>
        <table class="app-table" style="font-size:13px; min-width:520px;">
          <thead>
            <tr><th>Descripción</th><th style="text-align:center;">Cant.</th><th style="text-align:right;">P. unit.</th><th style="text-align:right;">Total</th></tr>
          </thead>
          <tbody>
            ${ui.items.map(it => `
              <tr>
                <td>${it.nombre || '—'}${it.modelo ? ' · ' + it.modelo : ''}</td>
                <td style="text-align:center;">${it.cant}</td>
                <td style="text-align:right;">${FMT.money(it.precio)}</td>
                <td style="text-align:right;">${FMT.money(T.lineTotal(it))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </fieldset>
    `;

    Modal.open('overlayCotAprobacion', { onEscape: true });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function cerrarAprobacion() {
    _aprobId = null;
    Modal.close('overlayCotAprobacion');
  }

  async function confirmarAprobacion() {
    if (!_aprobId) return;
    try {
      const doc = await CotizacionesService.getCotizacion(_aprobId);
      if (!doc) { Toast.show('No encontrada', 'bad'); return; }
      if ((doc.estado || 'borrador') !== 'borrador') {
        Toast.show('Solo se pueden aprobar cotizaciones en borrador.', 'bad'); return;
      }

      // 1) Marcar como aprobada
      await CotizacionesService.updateCotizacion(_aprobId, {
        estado: 'aprobada',
        fecha_aprobacion: firebase.firestore.Timestamp.now(),
        aprobado_por_uid: userUid,
      });

      // 2) Crear link público (mirror) + enviar correo a cliente y vendedor
      try {
        const link = await ensureLinkPublico(_aprobId);
        const dest = doc.dirigido_email;
        if (!dest) {
          Toast.show('✅ Aprobada, pero falta "Email destinatario" para enviar. Edita la cotización y agrégalo.', 'warn');
        } else {
          const subject = `Cotización ${doc.cotizacion_id} aprobada · CeComunica`;
          const intro = (doc.intro || 'Adjuntamos la cotización solicitada.')
            .replace(/[<>&]/g, s => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[s]));
          const totalTxt = FMT.money(Number(doc.total || 0));
          const dirA = doc.dirigido_a ? `<p style="margin:0 0 12px;">A la atención de: <b>${doc.dirigido_a}</b></p>` : '';
          const html = `
            <div style="font-family:Arial, sans-serif; color:#111; max-width:560px;">
              <h2 style="font:700 22px Arial,sans-serif; color:#0B2A47; margin:0 0 12px;">Cotización ${doc.cotizacion_id}</h2>
              <p style="margin:0 0 12px;">Estimados señores,</p>
              ${dirA}
              <p style="margin:0 0 12px;">${intro}</p>
              <p style="margin:0 0 4px;"><b>Total:</b> ${totalTxt}</p>
              <p style="margin:0 0 4px;"><b>Validez:</b> ${doc.validezDias || 15} días</p>
              <p style="margin:18px 0;">
                <a href="${link}" style="background:#0B2A47; color:#fff; padding:12px 18px; border-radius:6px; text-decoration:none; display:inline-block; font-weight:600;">
                  Ver y descargar cotización (PDF)
                </a>
              </p>
              <p style="font-size:12px; color:#6B7884; margin-top:24px;">
                Si tiene cualquier consulta, puede responder a este correo. Atentamente, ${doc.ejecutivo_nombre || 'CeComunica'}.
              </p>
            </div>
          `;
          await MailService.enqueue({
            to: dest,
            cc: doc.creado_por_email || null,
            subject,
            html,
            meta: { tipo: 'cotizacion_aprobada', cotizacion_id: doc.cotizacion_id, doc_id: _aprobId },
          });
          await CotizacionesService.updateCotizacion(_aprobId, {
            estado: 'enviada',
            enviada_en: firebase.firestore.FieldValue.serverTimestamp(),
          });
          Toast.show('✅ Aprobada y enviada a ' + dest, 'ok');
        }
      } catch (e2) {
        console.warn('No se pudo encolar correo de aprobación:', e2);
        Toast.show('✅ Aprobada, pero no se pudo enviar el correo automático.', 'warn');
      }

      cerrarAprobacion();
      await cargarCotizaciones(true);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo aprobar.', 'bad');
    }
  }

  async function rechazarAprobacion() {
    if (!_aprobId) return;
    const ok = await Modal.confirm({
      title: 'Rechazar cotización',
      message: '¿Confirmar el rechazo? El estado pasará a "Rechazada".',
      danger: true,
    });
    if (!ok) return;
    try {
      await CotizacionesService.updateCotizacion(_aprobId, {
        estado: 'rechazada',
        fecha_rechazo: firebase.firestore.Timestamp.now(),
        rechazado_por_uid: userUid,
      });
      Toast.show('Cotización rechazada', 'warn');
      cerrarAprobacion();
      await cargarCotizaciones(true);
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo rechazar.', 'bad');
    }
  }

  // ── Eventos ───────────────────────────────────────────────────
  function bindEvents() {
    $('filtroTexto').addEventListener('input', render);
    $('toggleEliminadas').addEventListener('change', render);
    $('toggleMias').addEventListener('change', (e) => { soloMias = e.target.checked; render(); });
    $('btnCargarMas').addEventListener('click', () => cargarCotizaciones(false));
    $('btnCerrarAprob').addEventListener('click', cerrarAprobacion);
    $('btnCancelarAprob').addEventListener('click', cerrarAprobacion);
    $('btnConfirmarAprob').addEventListener('click', confirmarAprobacion);
    $('btnRechazarAprob').addEventListener('click', rechazarAprobacion);

    $('segments').addEventListener('click', (e) => {
      const btn = e.target.closest('.cc-seg');
      if (!btn) return;
      filtroEstado = btn.dataset.estado;
      render();
    });

    document.querySelectorAll('th.sortable').forEach(th => {
      th.addEventListener('click', () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = (sortDir === 'asc' ? 'desc' : 'asc');
        else { sortKey = k; sortDir = 'asc'; }
        render();
      });
    });

    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const row = btn.closest('[data-id]');
      if (!row) return;
      onAction(btn.dataset.action, row.dataset.id);
    });

    // Click en fila (no en botones) → detalle
    document.querySelector('#tablaCotizaciones').addEventListener('click', (e) => {
      if (e.target.closest('[data-action]')) return;
      const row = e.target.closest('tr[data-id]');
      if (row) location.href = `detalle-cotizacion.html?id=${encodeURIComponent(row.dataset.id)}`;
    });
  }

  // ── Bootstrap ─────────────────────────────────────────────────
  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    userUid = user.uid;
    verificarAccesoYAplicarVisibilidad(async (rol) => {
      userRol = rol;
      const permitidos = [ROLES.ADMIN, ROLES.VENDEDOR];
      if (!permitidos.includes(rol)) { Toast.show('Sin acceso', 'bad'); location.href = '../index.html'; return; }

      // Vendedor: forzar "solo mías" y ocultar el toggle. Admin: mostrarlo.
      if (rol === ROLES.VENDEDOR) {
        soloMias = true;
        $('wrapToggleMias').style.display = 'none';
      } else {
        $('wrapToggleMias').style.display = '';
        soloMias = false;
      }

      bindEvents();
      await cargarCotizaciones(true);

      // Manejo de ?aprobar=<docId> (CTA desde correo de solicitud)
      const params = new URLSearchParams(location.search);
      const aprobarId = params.get('aprobar');
      if (aprobarId) {
        if (rol === ROLES.ADMIN) {
          openAprobacion(aprobarId);
          const url = new URL(window.location);
          url.searchParams.delete('aprobar');
          window.history.replaceState({}, document.title, url.toString());
        } else {
          Toast.show('Solo un administrador puede aprobar cotizaciones.', 'warn');
        }
      }
    });
  });
})();
