// @ts-nocheck
// Modal de aprobación de cotizaciones, compartido por la lista y el detalle.
// Auditoría UX 2026-09-28 (#11): aprobar desde el detalle redirigía a la lista
// (?aprobar=) y cargaba 30 documentos solo para abrir este panel. Ahora vive
// aquí y cada página lo abre en sitio. También aquí (#2) el rechazo del
// APROBADOR, que se registraba igual que "el cliente declinó".
//
// Uso: CotAprobacion.abrir(docId, { rol, uid, policy, onDone(resultado) })
//   resultado: 'aprobada' | 'enviada' | 'rechazada'
// Depende de: CotizacionesService, CotState, CotizacionTotales, CotizacionTaller,
// MailService, Modal, Toast, FMT, puedeAprobarCotizacion/esCotizacionServicio (roles.js).
(() => {
  let _ctx = null; // { docId, rol, uid, policy, onDone }
  const esc = (v) => (window.FMT && FMT.esc) ? FMT.esc(v) : String(v == null ? '' : v);

  // El panel es una hoja del kit (Modal.sheet): la lista y el detalle
  // comparten el mismo marcado sin copiarlo en dos HTML, y el fondo, el foco y
  // Escape los pone el kit (guardia K11 de kitBandejaModal.test.js).
  let _api = null;   // api de la hoja abierta ({ close, root })

  // Candado estándar (js/ui/busy.js); respaldo mínimo si el entry no lo cargó.
  async function conCandado(btn, fn, label) {
    if (typeof window.withBusy === 'function') return window.withBusy(btn, fn, { label, toast: false });
    if (btn && btn.disabled) return;
    if (btn) btn.disabled = true;
    try { return await fn(); } finally { if (btn) btn.disabled = false; }
  }

  // ── Espejo público (link que recibe el cliente) ───────────────
  async function ensureLinkPublico(docId) {
    const doc = await CotizacionesService.getCotizacion(docId);
    if (!doc) throw new Error('Cotización no encontrada');
    const ui = CotState.toUi(doc);
    const cat = await CotState.bootstrapCatalogos();
    const cli = cat.clientesById[ui.clienteId] || {};
    // Fallback al nombre guardado en el doc: el firmante puede ser un supervisor
    // de taller (jefe_taller), que no está en el catálogo de vendedores.
    const ej = cat.ejecutivos.find(e => e.id === ui.ejecutivoId)
      || { nombre: doc.ejecutivo_nombre || '', rol: doc.ejecutivo_cargo || '', email: doc.ejecutivo_email || '', tel: '' };
    const t = window.CotizacionTotales.calcTotales(ui);
    const snapshot = CotState.snapshotPublico(ui, t, cli, ej);
    const { url } = await CotizacionesService.ensureVerificacionPublica(docId, {
      cotizacion_id: ui.id,
      cliente_nombre: cli.razon || doc.cliente_nombre || '',
      dirigido_a: doc.dirigido_a,
      dirigido_email: doc.dirigido_email,
      ejecutivo_nombre: ej.nombre || doc.ejecutivo_nombre || '',
      creado_por_uid: doc.creado_por_uid,
      creado_por_email: doc.creado_por_email,
      total: t.total, moneda: ui.moneda, fecha: ui.fecha, validezDias: ui.validezDias,
      lleva_carta: CotState.llevaCarta(doc),
      snapshot, emisor: cat.emisor,
    });
    return url;
  }

  // ── Abrir ─────────────────────────────────────────────────────
  async function abrir(docId, ctx = {}) {
    if (_api) return;   // ya hay una abierta
    const T = window.CotizacionTotales;
    const doc = await CotizacionesService.getCotizacion(docId);
    if (!doc) { Toast.show('Cotización no encontrada', 'bad'); return; }
    // Permiso según TIPO: servicio → jefe de mantenimiento (o admin);
    // comercial → administración (D11, 2026-10-01: no hay gerentes).
    if (!puedeAprobarCotizacion(ctx.rol, doc)) {
      Toast.show(esCotizacionServicio(doc)
        ? 'Las cotizaciones de servicio las aprueba el jefe de mantenimiento o un administrador.'
        : 'Las cotizaciones comerciales las aprueba administración.', 'warn');
      return;
    }
    _ctx = { ...ctx, docId };
    const policyCfg = ctx.policy || T.POLICY_DEFAULT;
    const ui = CotState.toUi(doc);
    const tot = T.calcTotales(ui);
    const fechaTxt = ui.fecha || '—';
    // El descuento por renglón es la razón más común por la que una cotización
    // pequeña cae en aprobación (política A10).
    const maxDescLinea = (ui.items || []).reduce((m, it) => Math.max(m, Number(it.desc || 0)), 0);

    // POR QUÉ está aquí esta cotización.
    const polAprob = T.evaluarPolitica(ui, policyCfg);
    const motivosHtml = polAprob.motivos.length ? `
      <div style="margin:10px 0 4px; padding:10px 12px; border-left:3px solid #B45309; background:#FFFBEB; border-radius:4px; font-size:13px; line-height:1.5;">
        <b>Motivo de la aprobación</b>
        <ul style="margin:6px 0 0; padding-left:18px;">
          ${polAprob.motivos.map(m => `<li>${esc(m)}</li>`).join('')}
        </ul>
      </div>` : '';

    const bloque = (titulo, b, sufijo, mostrarTitulo) => {
      if (!b.n) return '';
      return `
        ${mostrarTitulo ? `<div style="font-size:10px; font-weight:700; letter-spacing:.09em; text-transform:uppercase; color:var(--fg-4); margin:6px 0 4px;">${titulo}</div>` : ''}
        ${b.descLineas > 0 ? `
        <div style="display:flex; justify-content:space-between;"><span>Precio de lista</span><strong>${FMT.money(b.bruto)}</strong></div>
        <div style="display:flex; justify-content:space-between;"><span>Descuento por renglón (máx ${maxDescLinea}%)</span><strong>−${FMT.money(b.descLineas)}</strong></div>` : ''}
        <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><strong>${FMT.money(b.subtotal)}</strong></div>
        ${ui.descuentoPct > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Descuento global (${ui.descuentoPct}%)</span><strong>−${FMT.money(b.descGlobal)}</strong></div>` : ''}
        <div style="display:flex; justify-content:space-between;"><span>ITBMS (${ui.itbmsPct}%)</span><strong>${FMT.money(b.itbms)}</strong></div>
        <div style="border-top:1px solid var(--border-default); margin-top:6px; padding-top:6px; display:flex; justify-content:space-between;">
          <span><b>Total${mostrarTitulo ? (sufijo ? ' mensual' : ' venta') : ''}</b></span><strong>${FMT.money(b.total)}${sufijo}</strong>
        </div>`;
    };

    // El aviso "sale al cliente de inmediato" vale para TODAS (auditoría UX
    // 2026-09-28, #9): antes solo lo veían las comerciales, junto a la carta.
    const avisoEnvio = CotState.esCotizacionDeTaller(doc)
      ? `<div style="margin:10px 0 4px; padding:10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md); background:#F5F7FA; font-size:13px; line-height:1.5;">
           <b>Al aprobar, la cotización sale al cliente de inmediato</b> por correo${doc.dirigido_email ? ' a ' + esc(doc.dirigido_email) : ''}.
         </div>`
      : `<div style="margin:10px 0 4px; padding:10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md); background:#F5F7FA;">
            <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; line-height:1.5;">
              <input type="checkbox" id="chkCartaAprob" ${CotState.llevaCarta(doc) ? 'checked' : ''} style="width:18px; height:18px; flex:none; margin-top:2px;">
              <span><b>Enviar con carta de presentación</b><br>
                <span style="font-size:12px; color:var(--fg-3);">Al aprobar, la cotización sale al cliente de inmediato. Estas 2 páginas institucionales van antes del documento.</span>
              </span>
            </label>
          </div>`;

    const html = `
      <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-4); margin-bottom:var(--sp-3);">
        <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="file-text"></i> Detalles de la cotización</legend>
        <div style="font-size:14px;">
          <p style="margin:4px 0;"><b>Cotización:</b> ${esc(ui.id)}</p>
          <p style="margin:4px 0;"><b>Cliente:</b> ${esc(doc.cliente_nombre || '—')}</p>
          <p style="margin:4px 0;"><b>Dirigido a:</b> ${esc(doc.dirigido_a || '—')}</p>
          <p style="margin:4px 0;"><b>Email destinatario:</b> ${esc(doc.dirigido_email || '—')}</p>
          <p style="margin:4px 0;"><b>Vendedor:</b> ${esc(doc.ejecutivo_nombre || '—')}</p>
          <p style="margin:4px 0;"><b>Fecha:</b> ${esc(fechaTxt)} · <b>Validez:</b> ${esc(ui.validezDias)} días</p>
          <p style="margin:4px 0;"><b>Introducción:</b> ${esc(doc.intro || '—')}</p>
          ${avisoEnvio}
          ${motivosHtml}
          <div style="margin-top:8px; padding:8px; border:1px dashed var(--border-default); border-radius:8px; max-width:420px;">
            ${bloque('Venta · pago único', tot.venta, '', tot.hayAlquiler && tot.hayVenta)}
            ${tot.hayAlquiler ? bloque('Alquiler · por mes', tot.alquiler, '/mes', true) : ''}
            ${tot.hayAlquiler ? `
            <div style="border-top:1px solid var(--border-default); margin-top:8px; padding-top:8px; font-size:12.5px; color:var(--fg-3);">
              <div style="display:flex; justify-content:space-between;"><span>Plazo acordado</span><strong>${tot.plazoMeses > 0 ? tot.plazoMeses + ' meses' : 'sin declarar'}</strong></div>
              ${tot.plazoMeses > 0 ? `<div style="display:flex; justify-content:space-between;"><span>Compromiso del plazo</span><strong>${FMT.money(tot.compromiso)}</strong></div>` : ''}
              <div style="display:flex; justify-content:space-between; margin-top:6px; color:var(--fg-2);">
                <span><b>Valor evaluado a ${tot.mesesComputables} meses</b></span><strong>${FMT.money(tot.total)}</strong>
              </div>
              <div style="font-family:var(--font-mono); font-size:11px; margin-top:2px;">
                ${FMT.money(tot.venta.total)} + ${FMT.money(tot.alquiler.total)} × ${tot.mesesComputables}
              </div>
            </div>` : ''}
          </div>
        </div>
      </fieldset>
      <fieldset style="border:1px solid var(--border-subtle); border-radius:var(--radius-md); padding:var(--sp-3);">
        <legend style="padding:0 var(--sp-2); font-weight:bold;"><i data-lucide="list"></i> Renglones</legend>
        <table class="app-table" style="font-size:13px; min-width:520px;">
          <thead>
            <tr><th>Descripción</th><th style="text-align:center;">Cant.</th>
              ${tot.hayAlquiler ? '<th style="text-align:center;">Modalidad</th>' : ''}
              <th style="text-align:right;">P. unit.</th><th style="text-align:right;">Desc.</th><th style="text-align:right;">Total</th></tr>
          </thead>
          <tbody>
            ${ui.items.map(it => {
              const esAlq = T.esAlquiler(it);
              return `
              <tr>
                <td>${esc(it.nombre || '—')}${it.modelo ? ' · ' + esc(it.modelo) : ''}</td>
                <td style="text-align:center;">${esc(it.cant)}</td>
                ${tot.hayAlquiler ? `<td style="text-align:center;"><span class="cc-mod-chip ${esAlq ? 'es-alquiler' : 'es-venta'}">${esAlq ? 'Alquiler' : 'Venta'}</span></td>` : ''}
                <td style="text-align:right;">${FMT.money(it.precio)}${esAlq ? '<span class="cc-per">/mes</span>' : ''}</td>
                <td style="text-align:right;${Number(it.desc || 0) > Number(policyCfg?.descuentoMaxPct ?? T.POLICY_DEFAULT.descuentoMaxPct) ? ' color:#B91C1C; font-weight:600;' : ''}">${Number(it.desc || 0) > 0 ? Number(it.desc) + '%' : '—'}</td>
                <td style="text-align:right;">${FMT.money(T.lineTotal(it))}${esAlq ? '<span class="cc-per">/mes</span>' : ''}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </fieldset>
    `;

    let ocupado = false;
    const resultado = await Modal.sheet({
      title: 'Aprobación de cotización',
      icon: 'check-circle',
      size: 'lg',
      html,
      // Mientras aprueba/envía no se cierra (Escape, X o clic fuera).
      closable: () => !ocupado,
      buttons: [
        { action: 'cancelar', label: 'Cancelar', icon: 'x-circle' },
        { action: 'rechazar', label: 'Rechazar', danger: true, icon: 'x' },
        // "Aprobar y enviar": aprobar SALE al cliente en el acto (auditoría UX 2026-09-28, #9).
        { action: 'aprobar', label: 'Aprobar y enviar', primary: true, icon: 'send' },
      ],
      onMount: (root, api) => {
        _api = api;
        // La casilla se persiste al momento: aprobar relee el documento para
        // armar el espejo público; cambiarla solo en pantalla no tendría efecto.
        const chkCarta = root.querySelector('#chkCartaAprob');
        if (chkCarta) {
          chkCarta.addEventListener('change', async (e) => {
            const val = e.target.checked;
            e.target.disabled = true;
            try {
              await CotizacionesService.updateCotizacion(docId, { incluye_carta: val });
              Toast.show(val ? 'Se enviará con carta de presentación.' : 'Se enviará sin carta de presentación.', 'ok');
            } catch (err) {
              e.target.checked = !val;
              Toast.show('No se pudo cambiar la carta: ' + (err?.message || err), 'bad');
            } finally {
              e.target.disabled = false;
            }
          });
        }
        // El kit enfoca el primer botón de peligro/primario (Rechazar): el
        // foco inicial va a Cancelar para que un Enter distraído no decida nada.
        setTimeout(() => root.querySelector('[data-sheet-action="cancelar"]')?.focus(), 60);
      },
      onAction: async (action, root) => {
        if (action === 'cancelar') return null;
        const btn = root.querySelector(`[data-sheet-action="${action}"]`);
        ocupado = true;
        try {
          const r = action === 'aprobar'
            ? await conCandado(btn, _confirmar, 'Aprobando y enviando…')
            : await conCandado(btn, _rechazar, 'Rechazando…');
          return r || false;   // sin resultado (canceló el motivo, no era borrador…) la hoja sigue abierta
        } catch (e) {
          console.error(e);
          Toast.show((action === 'aprobar' ? 'No se pudo aprobar: ' : 'No se pudo rechazar: ') + (e?.message || e), 'bad');
          return false;
        } finally {
          ocupado = false;
        }
      },
    });
    _api = null;
    const ctxFin = _ctx;
    _ctx = null;
    if (resultado && ctxFin && typeof ctxFin.onDone === 'function') {
      try { await ctxFin.onDone(resultado); } catch (e) { console.warn('[CotAprobacion] onDone falló', e); }
    }
  }

  function cerrar() {
    if (_api) _api.close(null);
  }

  // ── Aprobar y enviar ──────────────────────────────────────────
  // Devuelve 'aprobada' | 'enviada', o undefined si no hizo nada.

  async function _confirmar() {
    const docId = _ctx.docId;
    const uid = _ctx.uid || firebase.auth().currentUser?.uid || null;
    const doc = await CotizacionesService.getCotizacion(docId);
    if (!doc) { Toast.show('No encontrada', 'bad'); return; }
    if ((doc.estado || 'borrador') !== 'borrador') {
      Toast.show('Solo se pueden aprobar cotizaciones en borrador.', 'bad'); return;
    }

    // 1) Marcar como aprobada (el email queda para el historial).
    await CotizacionesService.updateCotizacion(docId, {
      estado: 'aprobada',
      fecha_aprobacion: firebase.firestore.Timestamp.now(),
      aprobado_por_uid: uid,
      aprobado_por_email: firebase.auth().currentUser?.email || null,
    });

    // 2) Link público + correo al cliente (con copia al vendedor).
    let resultado = 'aprobada';
    try {
      const link = await ensureLinkPublico(docId);
      let dest = doc.dirigido_email;
      if (!dest) {
        // Sin destinatario la cotización quedaba "aprobada" durmiente.
        const email = await Modal.prompt({
          title: 'Falta el email del destinatario',
          message: 'La cotización no tiene "Email destinatario". Escríbelo para enviarla ahora, o cancela para dejarla aprobada sin enviar.',
        });
        const limpio = (email || '').trim();
        if (limpio && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio)) {
          dest = limpio;
          await CotizacionesService.updateCotizacion(docId, { dirigido_email: dest });
          doc.dirigido_email = dest;
        } else if (limpio) {
          Toast.show('Email inválido: quedó aprobada sin enviar.', 'warn');
        }
      }
      if (!dest) {
        Toast.show('Aprobada, pero falta "Email destinatario" para enviar. Usa "Reenviar al cliente" desde el detalle cuando lo tengas.', 'warn');
      } else {
        const attachments = CotState.adjuntosToAttachments(doc.adjuntos);
        const { subject, html } = CotState.correoCliente({
          doc,
          cotizacionId: doc.cotizacion_id,
          clienteNombre: doc.cliente_nombre || '',
          total: Number(doc.total || 0),
          dirigidoA: doc.dirigido_a || '',
          intro: doc.intro || '',
          validezDias: doc.validezDias || 15,
          ejecutivo: doc.ejecutivo_nombre || '',
          ejecutivoCargo: CotizacionTaller.cargoFirmante(doc, null),
          link,
          adjuntos: attachments,
        });
        const replyTo = CotState.replyToDe({ ejecutivoEmail: doc.ejecutivo_email, creadoPorEmail: doc.creado_por_email });
        await MailService.enqueue({
          to: dest,
          cc: doc.creado_por_email || null,
          bcc: await CotizacionesService.bccSupervision(),
          subject,
          html,
          attachments,
          ...(replyTo ? { replyTo } : {}),
          meta: { tipo: 'cotizacion_aprobada', cotizacion_id: doc.cotizacion_id, doc_id: docId },
        });
        await CotizacionesService.updateCotizacion(docId, {
          estado: 'enviada',
          enviada_en: firebase.firestore.FieldValue.serverTimestamp(),
        });
        resultado = 'enviada';
        Toast.show('Aprobada y enviada a ' + dest, 'ok');
      }
    } catch (e2) {
      console.warn('No se pudo encolar correo de aprobación:', e2);
      Toast.show('Aprobada, pero no se pudo enviar el correo automático.', 'warn');
    }
    return resultado;
  }

  // ── Rechazo del aprobador ─────────────────────────────────────
  // Auditoría UX 2026-09-28 (P0 #17): el rechazo del aprobador quedaba como
  // "Rechazada · cliente declinó", sin motivo ni aviso, y contaba como
  // oportunidad perdida del vendedor. Ahora pide el motivo (obligatorio),
  // marca rechazo_origen:'aprobador' y avisa al vendedor por correo.
  async function _pedirMotivo() {
    let aviso = '';
    for (;;) {
      const r = await Modal.prompt({
        title: 'Rechazar cotización',
        message: (aviso ? aviso + '\n\n' : '') +
          'Escribe el motivo del rechazo. Le llega al vendedor por correo y queda en el historial. ' +
          'La cotización NO sale al cliente; el vendedor puede reabrirla a borrador y corregirla.',
        placeholder: 'Ej.: el descuento de 25% no se justifica; máximo 15%.',
        confirmLabel: 'Rechazar',
        multiline: true,
      });
      if (r === null || r === undefined) return null; // canceló
      const limpio = String(r).trim();
      if (limpio) return limpio;
      aviso = 'El motivo es obligatorio.';
    }
  }

  async function _rechazar() {
    const docId = _ctx.docId;
    const motivo = await _pedirMotivo();
    if (!motivo) return;
    const user = firebase.auth().currentUser;
    const doc = await CotizacionesService.getCotizacion(docId);
    if (!doc) { Toast.show('No encontrada', 'bad'); return; }
    if ((doc.estado || 'borrador') !== 'borrador') {
      Toast.show('Solo se puede rechazar una cotización en borrador.', 'bad'); return;
    }
    await CotizacionesService.updateCotizacion(docId, {
      estado: 'rechazada',
      fecha_rechazo: firebase.firestore.Timestamp.now(),
      rechazado_por_uid: _ctx.uid || user?.uid || null,
      rechazado_por_email: user?.email || null,
      rechazo_origen: 'aprobador',
      rechazo_motivo: motivo,
    });

    // Aviso al vendedor (mismo mail_queue que la solicitud de aprobación).
    // Best-effort: el rechazo ya quedó registrado aunque el correo falle.
    const to = doc.creado_por_email || doc.ejecutivo_email || null;
    let avisado = false;
    if (to) {
      try {
        const cc = [doc.ejecutivo_email].filter(e => e && e.toLowerCase() !== to.toLowerCase()).join(',') || null;
        await MailService.enqueue({
          to,
          cc,
          subject: `Cotización rechazada por el aprobador: ${doc.cotizacion_id} – ${doc.cliente_nombre || ''}`,
          preheader: `No se aprobó ${doc.cotizacion_id}: ${motivo.slice(0, 80)}`,
          bodyContent: `
            <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">La cotización no se aprobó</h2>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              ${esc(user?.email || 'El aprobador')} rechazó la cotización <b>${esc(doc.cotizacion_id)}</b>
              para <b>${esc(doc.cliente_nombre || '-')}</b>. <b>No se envió al cliente.</b>
            </p>
            <div style="margin:0 0 14px;padding:10px 12px;border-left:3px solid #B91C1C;background:#FEF2F2;font:14px/1.5 Arial,sans-serif;">
              <b>Motivo</b><br>${esc(motivo)}
            </div>
            <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
              Para corregirla, ábrela, usa <b>Marcar Borrador</b> en "Cambiar estado", ajústala y vuelve a pedir aprobación.
            </p>`,
          ctaUrl: `${location.origin}/cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(docId)}`,
          ctaLabel: 'Ver la cotización',
          meta: {
            created_by: user?.uid || null,
            source: 'cotizacion-rechazo-aprobador',
            cotizacion_id: doc.cotizacion_id,
            doc_id: docId,
          },
          status: 'queued',
        });
        avisado = true;
      } catch (e) {
        console.warn('No se pudo encolar el aviso de rechazo al vendedor:', e);
      }
    }
    Toast.show(avisado ? 'Cotización rechazada. Se avisó al vendedor por correo.'
      : 'Cotización rechazada. No se pudo avisar al vendedor por correo: díselo tú.', 'warn');
    return 'rechazada';
  }

  window.CotAprobacion = { abrir, cerrar, ensureLinkPublico };
})();
