// @ts-nocheck
// Detalle de cotización — vista de lectura con timeline derivado del estado.
(() => {
  let cot = null;
  let rawDoc = null;       // doc Firestore crudo (para enqueueAprobacionMail)
  let catalogos = null;
  let userRol = null;
  let soloLectura = false; // supervisor (allowlist) viendo una cotización ajena: sin acciones
  let policyCfg = null;    // { descuentoMaxPct, totalMax } desde empresa/config
  let polEnvio = { requiere: false, motivos: [] }; // recalculado en cada render()

  const $ = (id) => document.getElementById(id);
  const esc = FMT.esc; // helper canónico (core/formatting.js)
  const T = window.CotizacionTotales;

  function fmtFechaCorta(iso) { return FMT.dateShort(iso); } // delega en el helper canónico

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

  function estadoChipHtml(estado, doc = cot) {
    const e = CotState.ESTADOS[estado] || CotState.ESTADOS.borrador;
    return `<span class="chip-estado ${e.chip}">${esc(CotState.estadoLabel(estado, doc))}</span>`;
  }

  const esTaller = () => CotizacionTaller.esTaller(cot);

  // Pasos de una cotización de TALLER, a la vista arriba del detalle: dónde
  // está parada y qué sigue, sin tener que leer el historial. El que sigue
  // es el único que se marca como "estás aquí".
  function pasosTallerHtml() {
    const pasos = CotizacionTaller.pasos(cot);
    const iNext = pasos.findIndex(p => !p.done && !p.cortada);
    const cerrada = ['rechazada', 'descartada', 'vencida'].includes(cot.estado);
    return `
      <div class="cc-panel" style="margin-bottom:var(--sp-4);">
        <div class="cc-panel-body" style="display:flex; gap:6px; flex-wrap:wrap; align-items:stretch;">
          ${pasos.map((p, i) => {
            const aqui = i === iNext;
            const bg = p.done ? 'var(--ok-soft, #E7F6EE)' : aqui ? 'var(--warn-soft, #FFF7E6)' : 'var(--bg-2, #F5F7FA)';
            const fg = p.done ? 'var(--ok-deep, #17714B)' : aqui ? 'var(--warn-deep, #8A5A00)' : 'var(--fg-3)';
            return `<div style="flex:1 1 150px; min-width:140px; padding:10px 12px; border-radius:8px; background:${bg}; color:${fg};${p.cortada ? ' opacity:.55; text-decoration:line-through;' : ''}">
              <div style="font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase;">${p.done ? '✓ Hecho' : aqui ? '● Estás aquí' : 'Pendiente'}</div>
              <div style="font-size:13.5px; font-weight:600; margin-top:2px;">${esc(p.t)}</div>
            </div>`;
          }).join('')}
        </div>
        ${cerrada ? `<div class="cc-panel-body" style="padding-top:0; font-size:12.5px; color:var(--fg-3);">
          Cerrada como <b>${esc(CotState.estadoLabel(cot.estado, cot))}</b>${cot.cierre_motivo ? ' — ' + esc(cot.cierre_motivo) : ''}. ${cot.estado === 'vencida' && !cot.gestion_id
            ? 'Si ya corresponde facturarla, usa <b>Respuesta del cliente</b> → <b>Pasar a facturar sin respuesta del cliente</b>.'
            : 'No va a facturación.'}</div>` : ''}
        ${cot.gestion_id ? `<div class="cc-panel-body" style="padding-top:0; font-size:12.5px; color:var(--fg-2);">
          <b>Reposición por daño</b> · gestión <span style="font-family:var(--font-mono);">${esc(cot.gestion_id)}</span>.
          Al aceptarla, Bodega recibe el aviso para asignar el radio de reposición; si el cliente no la acepta, el caso pasa a cobranza.</div>` : ''}
      </div>`;
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
      // aprobado_por_email existe desde 2026-07-17; docs previos no lo traen
      // y no se inventa el rol (antes decía "por administrador" fijo aunque
      // aprobara jefe de taller o administración).
      h.push({
        act: 'Aprobada internamente',
        meta: fmtFechaAny(cot.fecha_aprobacion) + (cot.aprobado_por_email ? ' · por ' + cot.aprobado_por_email : ''),
      });
    }
    if (cot.enviada_en) {
      const dest = cot.dirigido_email || cliente.email || '—';
      h.push({
        act: 'Enviada al cliente',
        meta: fmtFechaAny(cot.enviada_en) + ' · por correo a ' + dest,
      });
    }
    // Respondida por el cliente desde el enlace (responderCotizacionPublica):
    // quién firmó con su nombre es lo que más importa de esa línea.
    const rc = cot.respuesta_cliente || null;
    const porEnlace = rc ? ' · desde el enlace, por ' + rc.nombre : '';
    if (cot.fecha_conversion) {
      // En el taller no hay "venta": el cliente aceptó la reparación, y lo
      // que importa es CÓMO lo dijo (correo, teléfono…) y quién lo anotó.
      const ac = cot.aceptacion;
      h.push(CotizacionTaller.esTaller(cot)
        ? {
            act: CotizacionTaller.sinRespuesta(cot)
              ? 'Pasó a facturación sin respuesta del cliente'
              : 'Aceptada por el cliente · pasó a facturación',
            meta: fmtFechaAny(cot.fecha_conversion)
              + (ac ? ' · ' + CotizacionTaller.medioLabel(ac.medio) + (ac.nota ? ' — ' + ac.nota : '') : '')
              + (ac?.por_email ? ' · anotado por ' + ac.por_email : ''),
          }
        : {
            // "Orden de venta" no existe como documento (glosario T2, auditoría UX 2026-09-28).
            act: 'Aceptada por el cliente',
            meta: fmtFechaAny(cot.fecha_conversion) + (rc?.respuesta === 'aceptada'
              ? porEnlace + (rc.comentario ? ' — ' + rc.comentario : '') : ' · venta cerrada'),
          });
    }
    if (cot.facturacion?.estado === 'facturada') {
      h.push({
        act: 'Facturada',
        meta: fmtFechaAny(cot.facturacion.facturada_at) + (cot.facturacion.factura ? ' · factura ' + cot.facturacion.factura : ''),
      });
    }
    if (cot.fecha_rechazo) {
      // El rechazo del APROBADOR no es el cliente declinando (auditoría UX
      // 2026-09-28, P0 #17): se dice quién y por qué.
      h.push(cot.rechazo_origen === 'aprobador'
        ? {
            act: 'Rechazada por ' + (cot.rechazado_por_email || 'el aprobador') + (cot.rechazo_motivo ? ': ' + cot.rechazo_motivo : ''),
            meta: fmtFechaAny(cot.fecha_rechazo) + ' · no se envió al cliente',
          }
        : {
            act: 'Rechazada',
            meta: fmtFechaAny(cot.fecha_rechazo) + ' · el cliente declinó'
              + (rc?.respuesta === 'rechazada' ? porEnlace : '')
              + ((cot.rechazo_motivo || cot.cierre_motivo) ? ' — ' + (cot.rechazo_motivo || cot.cierre_motivo) : ''),
          });
    }
    if (cot.fecha_descarte || cot.estado === 'descartada') {
      // El motivo lo escribió el vendedor al cerrar (cerrarPrompt → 'Otro
      // motivo'); es la única pista de por qué murió esta cotización, así que
      // va en la línea del historial, no escondido en el documento.
      h.push({
        act: 'Descartada',
        meta: fmtFechaAny(cot.fecha_descarte) + (cot.cierre_motivo ? ' · ' + cot.cierre_motivo : ''),
      });
    }
    // El servidor la regresó a borrador (onCotizacionPolitica): se marcó como
    // enviada/aprobada fuera de política y sin aprobación. El motivo va en la
    // línea, igual que un rechazo del aprobador.
    const bp = rawDoc?.bloqueada_por_politica;
    if (bp && cot.estado === 'borrador') {
      h.push({
        act: 'Devuelta a borrador por el sistema: requiere aprobación',
        meta: fmtFechaAny(bp.at) + (bp.motivo ? ' · ' + bp.motivo : ''),
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

  // Botón principal del header para un borrador, según rol + política de envío:
  //  · aprobador (admin/jefe taller) → "Aprobar y enviar" (revisa cualquier cotización)
  //  · vendedor + dentro de política  → "Enviar al cliente" (envío directo, sin aprobación)
  //  · vendedor + fuera de política   → "Solicitar aprobación" (notifica al aprobador)
  function botonAccionPrincipal(estado) {
    if (estado !== 'borrador') return '';
    if (puedeAprobarCotizacion(userRol, cot)) {
      return '<button class="btn btn-secondary" id="btnAprobar" style="background:#065F46; color:#fff; border-color:#065F46;"><i data-lucide="check-circle"></i> Aprobar y enviar</button>';
    }
    if (canRole(userRol, 'enviar-cotizacion') && !polEnvio.requiere) {
      return '<button class="btn btn-secondary" id="btnEnviarDirecto" style="background:#065F46; color:#fff; border-color:#065F46;"><i data-lucide="send"></i> Enviar al cliente</button>';
    }
    if (canRole(userRol, 'enviar-cotizacion') && polEnvio.requiere) {
      return '<button class="btn btn-secondary" id="btnSolicitar"><i data-lucide="shield-check"></i> Solicitar aprobación</button>';
    }
    return '';
  }

  // Aviso de que el SERVIDOR devolvió la cotización a borrador
  // (onCotizacionPolitica): pasó a enviada/aprobada fuera de política y sin
  // aprobación registrada. Ofrece el mismo "Solicitar aprobación" del header;
  // a un aprobador le basta "Aprobar y enviar".
  function bloqueoPoliticaHtml() {
    const bp = rawDoc?.bloqueada_por_politica;
    if (!bp || cot.estado !== 'borrador') return '';
    const motivos = Array.isArray(bp.motivos) && bp.motivos.length ? bp.motivos : [bp.motivo || 'fuera de la política de envío'];
    const puedeSolicitar = !soloLectura && !puedeAprobarCotizacion(userRol, cot) && canRole(userRol, 'enviar-cotizacion');
    return `
      <div class="cc-panel" role="alert" style="margin-bottom:var(--sp-4); border-left:4px solid var(--warn-deep, #8A5A00);">
        <div class="cc-panel-body" style="display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap;">
          <div style="flex:1 1 320px; font-size:13px; line-height:1.5;">
            <b>El servidor devolvió esta cotización a borrador: requiere aprobación.</b>
            <div style="margin-top:4px; color:var(--fg-2);">Se marcó como <b>${esc(bp.estado_previo || 'enviada')}</b> sin aprobación registrada${bp.at ? ' el ' + esc(fmtFechaAny(bp.at)) : ''}. Motivo:</div>
            <ul style="margin:4px 0 0; padding-left:18px;">${motivos.map(m => '<li>' + esc(m) + '</li>').join('')}</ul>
          </div>
          ${puedeSolicitar ? '<button class="btn btn-secondary" id="btnSolicitarBloqueo"><i data-lucide="shield-check"></i> Solicitar aprobación</button>' : ''}
        </div>
      </div>`;
  }

  // Importe para encabezados y avisos de una línea. Una cotización mixta no
  // tiene UN importe: se enseñan los dos en vez de un total proyectado que el
  // cliente nunca va a ver en la propuesta.
  function resumenImporte(t) {
    if (!t.hayAlquiler) return FMT.money(t.venta.total);
    if (!t.hayVenta) return FMT.money(t.alquiler.total) + '/mes';
    return FMT.money(t.venta.total) + ' + ' + FMT.money(t.alquiler.total) + '/mes';
  }

  function render() {
    const cli = (catalogos.clientesById[cot.clienteId]) || { razon: cot.cliente_nombre, ruc: cot.cliente_ruc, email: cot.cliente_email, representante: '' };
    const ej = catalogos.ejecutivos.find(e => e.id === cot.ejecutivoId)
      || { nombre: cot.ejecutivo_nombre || '—', rol: cot.ejecutivo_cargo || '', email: cot.ejecutivo_email || '', tel: '' };
    const dirigidoA = cot.dirigido_a || cli.representante || '';
    const dirigidoEmail = cot.dirigido_email || cli.email || '';
    const t = T.calcTotales(cot);
    // evaluarPolitica recalcula desde el documento: entran el descuento por
    // renglón (A10) y la proyección del alquiler a 12 meses sin que este
    // llamador tenga que armar el input — armarlo a mano fue lo que hizo que
    // el header ofreciera "Enviar al cliente" para un borrador que el editor
    // ya había mandado a aprobación.
    polEnvio = T.evaluarPolitica(cot, policyCfg);
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
          <p>${esTaller() ? `<b>Servicio técnico</b> · orden ${esc(cot.orden_id || '—')} · ` : ''}${esc(cli.razon || '—')} · ${resumenImporte(t)} · ${cot.items.length} renglones</p>
        </div>
        <div class="app-page-header-actions">
          ${soloLectura ? '' : botonAccionPrincipal(cot.estado)}
          ${soloLectura ? '' : '<button class="btn btn-ghost" id="btnDuplicar"><i data-lucide="copy"></i> Duplicar</button>'}
          ${!soloLectura && (cot.estado === 'aprobada' || cot.estado === 'enviada' || cot.estado === 'convertida') ? '<button class="btn btn-ghost" id="btnEnviar"><i data-lucide="send"></i> Reenviar al cliente</button>' : ''}
          ${!soloLectura && (cot.estado === 'aprobada' || cot.estado === 'enviada' || (esTaller() && cot.estado === 'vencida' && !cot.gestion_id)) ? (esTaller()
            ? '<button class="btn btn-secondary" id="btnCerrar" style="background:#065F46; color:#fff; border-color:#065F46;"><i data-lucide="circle-check"></i> Respuesta del cliente</button>'
            : '<button class="btn btn-secondary" id="btnCerrar" style="background:#0B2A47; color:#fff; border-color:#0B2A47;"><i data-lucide="flag"></i> Cerrar cotización</button>') : ''}
          ${!soloLectura && CotState.esEditable(cot.estado) ? '<button class="btn btn-secondary" id="btnEditar"><i data-lucide="pencil"></i> Editar</button>' : ''}
          <button class="btn btn-primary" id="btnImprimir"><i data-lucide="printer"></i> Imprimir / PDF</button>
        </div>
      </div>

      ${bloqueoPoliticaHtml()}

      ${esTaller() ? pasosTallerHtml() : ''}

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
                    ${t.hayAlquiler ? '<th style="width:88px; text-align:center;">Modalidad</th>' : ''}
                    <th style="width:100px; text-align:right;">P. unit.</th>
                    <th style="width:110px; text-align:right;">Total</th></tr>
                </thead>
                <tbody>
                  ${cot.items.map((it, i) => {
                    // La columna de modalidad solo aparece si la cotización
                    // mezcla: en una de pura venta sería una columna con el
                    // mismo valor en todas las filas.
                    const esAlq = T.esAlquiler(it);
                    return `
                    <tr>
                      <td class="td-muted">${String(i + 1).padStart(2, '0')}</td>
                      <td>
                        <div style="font-weight:600; color:var(--fg-1);">${esc(it.nombre)}</div>
                        <div style="font-size:11.5px; color:var(--fg-3);">${esc(it.spec || '')}${it.modelo ? ' · ' + esc(it.modelo) : ''}${it.desc > 0 ? ' · desc ' + it.desc + '%' : ''}</div>
                      </td>
                      <td style="text-align:center; font-family:var(--font-mono);">${esc(it.cant)}</td>
                      ${t.hayAlquiler ? `<td style="text-align:center;"><span class="cc-mod-chip ${esAlq ? 'es-alquiler' : 'es-venta'}">${esAlq ? 'Alquiler' : 'Venta'}</span></td>` : ''}
                      <td style="text-align:right; font-family:var(--font-mono);">${FMT.money(it.precio)}${esAlq ? '<span class="cc-per">/mes</span>' : ''}</td>
                      <td style="text-align:right; font-family:var(--font-mono); font-weight:600; color:var(--fg-1);">${FMT.money(T.lineTotal(it))}${esAlq ? '<span class="cc-per">/mes</span>' : ''}</td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table>
            </div>
          </div>

          ${cot.condiciones.length ? `
          <!-- Condiciones (una de taller sin condiciones no pinta el bloque) -->
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="clipboard-check"></i> Condiciones</h3></div>
            <div class="cc-panel-body">
              <dl class="cc-kv">
                ${cot.condiciones.map(c => `<dt>${esc(c.k)}</dt><dd>${esc(c.v)}</dd>`).join('')}
              </dl>
            </div>
          </div>` : ''}

          ${(cot.adjuntos && cot.adjuntos.length) ? `
          <!-- Adjuntos (viajan con la propuesta) -->
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="paperclip"></i> Adjuntos</h3></div>
            <div class="cc-panel-body">
              <ul style="list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px;">
                ${cot.adjuntos.map(a => `
                  <li style="display:flex; align-items:center; gap:8px;">
                    <i data-lucide="${a.content_type === 'application/pdf' ? 'file-text' : 'image'}" style="color:var(--fg-3);"></i>
                    ${a.url
                      ? `<a href="${esc(a.url)}" target="_blank" rel="noopener" style="color:var(--accent); text-decoration:none;">${esc(a.nombre)}</a>`
                      : esc(a.nombre)}
                  </li>`).join('')}
              </ul>
              <p style="font-size:11.5px; color:var(--fg-3); margin:12px 0 0;">Estos archivos se envían junto con la cotización al cliente.</p>
            </div>
          </div>` : ''}
        </div>

        <!-- Sidebar -->
        <div>
          <div class="cc-panel">
            <div class="cc-panel-head"><h3><i data-lucide="calculator"></i> Totales</h3></div>
            <div class="cc-panel-body">
              ${CotState.bloqueTotalesHtml(t, cot)}
              <dl class="cc-kv" style="margin-top:18px; gap:8px 14px;">
                <dt>Emitida</dt><dd>${esc(fmtFechaCorta(cot.fecha))}</dd>
                <dt>Vence</dt><dd>${esc(fmtFechaCorta(vence))}</dd>
                <dt>${esTaller() ? 'Firma' : 'Vendedor'}</dt><dd>${esc(ej.nombre)}<div style="font-size:12px; color:var(--fg-3);">${esc(CotizacionTaller.cargoFirmante(cot, ej))}</div></dd>
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
              <div id="cotAperturas" style="display:none; margin:0 0 10px; padding:8px 10px; border-radius:8px; background:var(--accent-soft, #E6F4FA); font-size:13px;"></div>
              <ul class="cc-timeline">
                ${historial(cot, cli).map(h => `<li><div class="cc-tl-act">${esc(h.act)}</div><div class="cc-tl-meta">${esc(h.meta)}</div></li>`).join('')}
              </ul>
            </div>
          </div>
        </div>
      </div>
    `;

    // Aperturas del cliente (auditoría): el dato SIEMPRE existió en
    // cotizacion_verificaciones/{docId} (opens_count / last_opened_at, los
    // escribe el trigger onOpened) pero ninguna pantalla interna lo leía —
    // el vendedor tenía que ir a buscar el correo de aviso a su bandeja.
    // Es la pregunta nº1 del seguimiento: "¿la abrió?".
    (async () => {
      try {
        const snap = await firebase.firestore()
          .collection('cotizacion_verificaciones').doc(cot._docId).get();
        const v = snap.exists ? snap.data() : null;
        const el = document.getElementById('cotAperturas');
        if (!el) return;
        if (v && Number(v.opens_count) > 0) {
          const cuando = v.last_opened_at?.toDate
            ? v.last_opened_at.toDate().toLocaleString('es-PA', { dateStyle: 'medium', timeStyle: 'short' })
            : '';
          el.innerHTML = `<i data-lucide="eye" style="width:14px;height:14px;vertical-align:-2px;"></i> ` +
            `El cliente la abrió <b>${Number(v.opens_count)}</b> ${Number(v.opens_count) === 1 ? 'vez' : 'veces'}` +
            (cuando ? ` · última: ${esc(cuando)}` : '');
          el.style.display = '';
        } else if (v && (cot.estado === 'enviada' || cot.estado === 'convertida')) {
          el.innerHTML = `<i data-lucide="eye-off" style="width:14px;height:14px;vertical-align:-2px;"></i> Sin aperturas registradas del cliente todavía.`;
          el.style.display = '';
        }
        if (el.style.display !== 'none' && typeof lucide !== 'undefined') lucide.createIcons();
      } catch (e) { /* señal opcional: sin red o sin espejo no rompe el detalle */ }
    })();

    const btnDup = $('btnDuplicar');
    if (btnDup) btnDup.addEventListener('click', duplicar);
    const btnEnv = $('btnEnviar');
    if (btnEnv) btnEnv.addEventListener('click', () => enviarPorCorreo(cli, ej, btnEnv));
    const btnCer = $('btnCerrar');
    if (btnCer) btnCer.addEventListener('click', () => cerrarCotizacion(cli));
    // "Aprobar y enviar": el panel compartido (cot-aprobacion.js) se abre EN
    // SITIO — antes redirigía a la lista y cargaba 30 docs (auditoría UX 2026-09-28, #11).
    const btnAp = $('btnAprobar');
    if (btnAp) btnAp.addEventListener('click', abrirAprobacion);
    // Envío directo del vendedor (cotización dentro de política).
    const btnDir = $('btnEnviarDirecto');
    if (btnDir) btnDir.addEventListener('click', () => enviarPorCorreo(cli, ej, btnDir));
    // Solicitar aprobación (cotización fuera de política).
    const btnSol = $('btnSolicitar');
    if (btnSol) btnSol.addEventListener('click', solicitarAprobacion);
    const btnSolBloq = $('btnSolicitarBloqueo');
    if (btnSolBloq) btnSolBloq.addEventListener('click', solicitarAprobacion);
    const btnEd = $('btnEditar');
    if (btnEd) btnEd.addEventListener('click', () => { location.href = 'editar-cotizacion.html?id=' + encodeURIComponent(cot._docId); });
    $('btnImprimir').addEventListener('click', () => { window.open('imprimir-cotizacion.html?id=' + encodeURIComponent(cot._docId), '_blank'); });

    renderTransiciones();
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // Relee el documento y repinta (tras aprobar/rechazar en sitio).
  async function recargar() {
    const doc = await CotizacionesService.getCotizacion(cot._docId);
    if (!doc) return;
    rawDoc = doc;
    cot = CotState.toUi(doc);
    render();
  }

  function abrirAprobacion() {
    return CotAprobacion.abrir(cot._docId, {
      rol: userRol,
      uid: firebase.auth().currentUser?.uid || null,
      policy: policyCfg,
      onDone: recargar,
    });
  }

  // Candado estándar (js/ui/busy.js); sin él, la acción corre igual.
  function conCandado(btn, fn, opts = {}) {
    if (typeof window.withBusy === 'function') return window.withBusy(btn, fn, { toast: false, rethrow: false, ...opts });
    return fn();
  }

  // ── Transiciones de estado ────────────────────────────────────
  // borrador → aprobada (admin aprueba) → enviada (auto al cliente) → convertida
  // Borrador YA NO tiene salto directo a "enviada": antes ese atajo permitía
  // marcar como enviada sin pasar por aprobación y luego el admin no podía
  // aprobar (estado ya no era borrador). La salida correcta de borrador es
  // el botón "Aprobar y enviar" del header (solo admin), que sí envía correo.
  // Aceptada/Rechazada ya NO se marcan desde aquí: el único camino es
  // "Cerrar cotización", que pide el desenlace y el motivo (auditoría UX 2026-09-28, T1/#12).
  // "Vencida" tampoco se marca desde aquí: vive en "Cerrar cotización" como
  // "Validez vencida" (remate de la auditoría: un solo camino para cerrar).
  const TRANSICIONES = {
    borrador:   [],
    aprobada:   ['enviada'],
    enviada:    [],
    rechazada:  ['borrador'],
    // 'descartada' no ofrece atajo a convertida/rechazada: el desenlace real
    // se marca con "Cerrar cotización" (que sí pide el motivo). Aquí solo se
    // permite devolverla a borrador para rehacerla — el caso típico.
    descartada: ['borrador'],
    vencida:    ['enviada', 'borrador'],
    convertida: [],
  };

  function renderTransiciones() {
    const cont = $('panelTransiciones');
    if (soloLectura) {
      cont.innerHTML = '<p style="font-size:12.5px; color:var(--fg-3); margin:0;">Vista de supervisión — solo lectura.</p>';
      return;
    }
    if (cot.estado === 'borrador') {
      let txt;
      if (puedeAprobarCotizacion(userRol, cot)) {
        txt = 'Esta cotización está en borrador. Usa <b>Aprobar y enviar</b> arriba para revisar y enviar al cliente.';
      } else if (canRole(userRol, 'enviar-cotizacion') && !polEnvio.requiere) {
        txt = 'Esta cotización está dentro de los límites de envío directo. Puedes enviarla al cliente con <b>Enviar al cliente</b> arriba.';
      } else if (canRole(userRol, 'enviar-cotizacion') && polEnvio.requiere) {
        txt = 'Esta cotización supera los límites para envío directo y requiere aprobación:<br>· ' +
          polEnvio.motivos.map(esc).join('<br>· ') +
          '<br>Usa <b>Solicitar aprobación</b> arriba.';
      } else {
        txt = 'Esta cotización está en borrador, pendiente de aprobación.';
      }
      cont.innerHTML = '<p style="font-size:12.5px; color:var(--fg-3); margin:0; line-height:1.5;">' + txt + '</p>';
      return;
    }
    // En el taller 'convertida' (Aceptada) solo se marca con "Respuesta del
    // cliente": es el paso que pregunta cómo aceptó y abre la facturación. Un
    // "Marcar Aceptada" suelto en este panel se saltaría esa pregunta.
    const opts = (TRANSICIONES[cot.estado] || []).filter(e => !(esTaller() && e === 'convertida'));
    if (!opts.length) {
      cont.innerHTML = '<p style="font-size:12.5px; color:var(--fg-3); margin:0;">Estado final — sin transiciones disponibles.</p>';
      return;
    }
    cont.innerHTML = '<div style="display:flex; flex-wrap:wrap; gap:8px;">' +
      opts.map(e => {
        const label = CotState.estadoLabel(e, cot);
        const danger = (e === 'rechazada' || e === 'vencida');
        return `<button class="btn btn-${danger ? 'ghost' : 'secondary'} btn-sm" data-estado="${e}">Marcar ${label}</button>`;
      }).join('') + '</div>';
    cont.querySelectorAll('button[data-estado]').forEach(b => {
      b.addEventListener('click', () => cambiarEstado(b.dataset.estado));
    });
  }

  async function cerrarCotizacion(cli) {
    const t = T.calcTotales(cot);
    const cierre = await CotState.cerrarPrompt({
      cotizacionId: cot.id,
      // El importe real, no el proyectado a 12 meses: quien cierra reconoce la
      // cotización por lo que se le cotizó al cliente.
      totalTexto: resumenImporte(t),
      cliente: cli?.razon || cot.cliente_nombre || '',
      taller: esTaller(),
      reposicion: !!cot.gestion_id,
      vencida: cot.estado === 'vencida',
    });
    if (!cierre) return;
    const desenlace = cierre.estado;
    try {
      const patch = CotState.patchCierre(desenlace, cierre.motivo, firebase.auth().currentUser?.uid || null, cierre.aceptacion || null);
      await CotizacionesService.updateCotizacion(cot._docId, patch);
      // Se mezcla el patch completo (no solo el estado) para que el historial
      // recién renderizado muestre la fecha y el motivo sin recargar.
      Object.assign(cot, patch);
      Toast.show(CotState.cierreToast(desenlace, { taller: esTaller(), sinRespuesta: cierre.aceptacion?.medio === 'sin_respuesta' }), desenlace === 'convertida' ? 'ok' : 'warn');
      render();
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cerrar: ' + (e?.message || e), 'bad');
    }
  }

  async function cambiarEstado(nuevo) {
    // "Marcar Enviada" desde este panel solo registra el estado (p.ej. la
    // propuesta salió por otro canal) — NO envía correo. Se advierte para
    // que nadie lo confunda con "Reenviar al cliente".
    const msg = nuevo === 'enviada'
      ? 'Esto SOLO registra el estado "Enviada" — no envía ningún correo al cliente. Para enviar de verdad usa "Reenviar al cliente". ¿Continuar?'
      : `¿Cambiar el estado a "${CotState.ESTADOS[nuevo].label}"?`;
    const ok = await Modal.confirm({ title: 'Cambiar estado', message: msg, danger: nuevo === 'enviada' });
    if (!ok) return;
    try {
      const uid = firebase.auth().currentUser?.uid || null;
      const now = firebase.firestore.Timestamp.now();
      const patch = {
        estado: nuevo,
        fecha_modificacion: firebase.firestore.FieldValue.serverTimestamp(),
      };
      // Trazabilidad: estampar los mismos sellos que los flujos dedicados
      // (cerrarCotizacion / aprobar-y-enviar) para que el historial y los
      // reportes no pierdan los eventos hechos desde este panel.
      if (nuevo === 'convertida') { patch.fecha_conversion = now; patch.convertida_por_uid = uid; }
      if (nuevo === 'rechazada')  { patch.fecha_rechazo = now;    patch.rechazado_por_uid = uid; }
      if (nuevo === 'vencida')    { patch.fecha_vencimiento = now; patch.vencida_manual = true; }
      if (nuevo === 'enviada')    { patch.enviada_en = now;        patch.enviada_manual = true; }
      // Reabrir a borrador: limpiar los sellos del desenlace anterior para
      // que el borrador reabierto no siga mostrando "Rechazada"/"Vencida".
      if (nuevo === 'borrador') {
        const del = firebase.firestore.FieldValue.delete();
        patch.fecha_rechazo = del; patch.rechazado_por_uid = del;
        patch.rechazado_por_email = del; patch.rechazo_origen = del; patch.rechazo_motivo = del;
        patch.fecha_vencimiento = del; patch.vencida_auto = del; patch.vencida_manual = del;
      }
      await CotizacionesService.updateCotizacion(cot._docId, patch);
      cot.estado = nuevo;
      if (nuevo === 'convertida') { cot.fecha_conversion = now; }
      if (nuevo === 'rechazada')  { cot.fecha_rechazo = now; }
      if (nuevo === 'vencida')    { cot.fecha_vencimiento = now; }
      if (nuevo === 'enviada')    { cot.enviada_en = now; }
      if (nuevo === 'borrador')   { ['fecha_rechazo', 'rechazado_por_email', 'rechazo_origen', 'rechazo_motivo', 'fecha_vencimiento', 'vencida_auto', 'vencida_manual'].forEach(k => { delete cot[k]; }); }
      Toast.show('Estado actualizado', 'ok');
      render();
    } catch (err) {
      Toast.show('Error: ' + (err?.message || err), 'bad');
    }
  }

  // ── Enviar por correo (panel con preview) ─────────────────────
  // Candado + "Preparando…" mientras se genera el link (auditoría UX 2026-09-28, #8).
  function enviarPorCorreo(cli, ej, btn) {
    return conCandado(btn, () => _enviarPorCorreo(cli, ej), { label: 'Preparando envío…' });
  }

  async function _enviarPorCorreo(cli, ej) {
    const t = T.calcTotales(cot);
    // Escribe (o reescribe) el espejo público con la decisión de carta VIGENTE.
    // Se llama otra vez si el panel de envío cambia la casilla: el link es el
    // mismo, lo que cambia es el contenido que abre el cliente.
    const generarLink = async () => {
      // El espejo público muestra lo que PAGA el cliente (los dos totales
      // reales y el plazo) y, en el taller, que es un servicio técnico.
      const snapshot = CotState.snapshotPublico(cot, t, cli, ej);
      const result = await CotizacionesService.ensureVerificacionPublica(cot._docId, {
        cotizacion_id: cot.id,
        cliente_nombre: cli.razon || '',
        dirigido_a: cot.dirigido_a, dirigido_email: cot.dirigido_email,
        ejecutivo_nombre: ej.nombre || '',
        creado_por_uid: cot.creado_por_uid, creado_por_email: cot.creado_por_email,
        total: t.total, moneda: cot.moneda, fecha: cot.fecha, validezDias: cot.validezDias,
        // Se congela junto al resto: el link ya enviado no cambia de contenido
        // aunque después se edite la casilla. Un reenvío sí lo regenera.
        lleva_carta: CotState.llevaCarta(cot),
        snapshot, emisor: catalogos.emisor,
      });
      return result.url;
    };

    // Generar link público antes de abrir el panel.
    let link;
    try { link = await generarLink(); }
    catch (e) { Toast.show('No se pudo generar el link público: ' + (e?.message || e), 'bad'); return; }

    const cartaAplica = !CotState.esCotizacionDeTaller(cot);
    const payload = await CotState.reenviarPrompt({
      cotizacionId: cot.id,
      clienteNombre: cli.razon || '',
      // Al cliente se le escribe lo que paga, no el valor evaluado interno.
      totalTexto: resumenImporte(t),
      dirigidoA: cot.dirigido_a || '',
      defaultDest: cot.dirigido_email || cli.email || '',
      ccEmail: cot.creado_por_email || '',
      intro: cot.intro || '',
      validezDias: cot.validezDias || 15,
      ejecutivo: ej.nombre || cot.ejecutivo_nombre || '',
      ejecutivoCargo: CotizacionTaller.cargoFirmante(cot, ej),
      doc: cot,
      link,
      adjuntos: cot.adjuntos || [],
      llevaCarta: cartaAplica ? CotState.llevaCarta(cot) : null,
    });
    if (!payload) return;

    // La casilla del panel manda sobre lo guardado: se persiste en la cotización
    // (para el próximo envío) y se reescribe el espejo antes de mandar el correo.
    if (cartaAplica && payload.llevaCarta !== CotState.llevaCarta(cot)) {
      const anterior = cot.incluye_carta;
      try {
        cot.incluye_carta = payload.llevaCarta;
        await CotizacionesService.updateCotizacion(cot._docId, { incluye_carta: payload.llevaCarta });
        await generarLink();
      } catch (e) {
        cot.incluye_carta = anterior;
        Toast.show('No se pudo aplicar el cambio de carta de presentación: ' + (e?.message || e), 'bad');
        return;
      }
    }

    try {
      await CotizacionesService.enviarPorCorreo(cot._docId, {
        to: payload.dest,
        cc: cot.creado_por_email || null,
        subject: payload.subject,
        html: payload.html,
        attachments: CotState.adjuntosToAttachments(cot.adjuntos),
        replyTo: CotState.replyToDe({ ejecutivoEmail: ej.email || cot.ejecutivo_email, creadoPorEmail: cot.creado_por_email }),
      });
      cot.estado = 'enviada';
      Toast.show('Cotización enviada a ' + payload.dest, 'ok');
      render();
    } catch (err) {
      Toast.show('Error al enviar: ' + (err?.message || err), 'bad');
    }
  }

  // Notifica al aprobador (correo a ventas@/config) que un borrador fuera de
  // política espera revisión. Reusa el mismo correo que se encola al crear/duplicar.
  async function solicitarAprobacion() {
    const ok = await Modal.confirm({
      title: 'Solicitar aprobación',
      message: 'Esta cotización supera los límites para envío directo:\n\n• ' +
        polEnvio.motivos.join('\n• ') +
        '\n\nSe notificará a un aprobador para que la revise y la envíe al cliente.',
    });
    if (!ok) return;
    try {
      await CotState.enqueueAprobacionMail({
        doc: rawDoc, docId: cot._docId, user: firebase.auth().currentUser,
      });
      Toast.show('Solicitud de aprobación enviada.', 'ok');
    } catch (e) {
      Toast.show('No se pudo enviar la solicitud: ' + (e?.message || e), 'bad');
    }
  }

  // Duplicar: una sola implementación compartida con la lista (CotState.duplicar,
  // auditoría UX 2026-09-28 §4.5 #12), con su candado anti doble-click.
  function duplicar() {
    return CotState.duplicar({ ui: cot, raw: rawDoc, rol: userRol, policy: policyCfg, catalogos });
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) { location.href = '../login.html'; return; }
    verificarAccesoYAplicarVisibilidad(async (rol) => {
      userRol = rol;
      // Supervisores (empresa/config.cotizaciones_supervisores): pueden abrir
      // cualquier cotización sin importar su rol, en solo-lectura.
      const cfg = window.EMPRESA_CONFIG || await EmpresaService.getConfig();
      const esSupervisor = (cfg.cotizaciones_supervisores || [])
        .some(e => String(e).toLowerCase() === (user.email || '').toLowerCase());
      const permitidos = [ROLES.ADMIN, ROLES.VENDEDOR, ROLES.JEFE_TALLER, ROLES.RECEPCION, ROLES.GERENTE];
      if (!permitidos.includes(rol) && !esSupervisor) { Toast.show('Sin acceso', 'bad'); location.href = '../index.html'; return; }

      const params = new URLSearchParams(location.search);
      const docId = params.get('id');
      if (!docId) { Toast.show('Falta id', 'bad'); location.href = 'index.html'; return; }
      // Catálogos en paralelo con el documento (2026-09-30), como ya hacía
      // imprimir-cotizacion: antes esperaban a que llegara la cotización.
      const catalogosEnVuelo = CotState.bootstrapCatalogos();
      catalogosEnVuelo.catch(() => {});
      const doc = await CotizacionesService.getCotizacion(docId);
      if (!doc) { Toast.show('No encontrada', 'bad'); location.href = 'index.html'; return; }

      // Vendedor solo ve las propias (un supervisor sí ve las ajenas)
      if (rol === ROLES.VENDEDOR && !esSupervisor && doc.creado_por_uid && doc.creado_por_uid !== user.uid) {
        Toast.show('Solo el creador o un administrador puede ver esta cotización.', 'bad');
        location.href = 'index.html';
        return;
      }

      // Modo supervisión: una cotización ajena abierta gracias a la allowlist se
      // muestra sin acciones — las reglas de Firestore denegarían la escritura.
      soloLectura = esSupervisor
        && ![ROLES.ADMIN, ROLES.JEFE_TALLER].includes(rol)
        && doc.creado_por_uid !== user.uid;

      catalogos = await catalogosEnVuelo;
      rawDoc = doc;
      try { policyCfg = T.policyFromConfig(cfg); }
      catch (e) { policyCfg = T.POLICY_DEFAULT; }
      cot = CotState.toUi(doc);
      render();

      // ?enviar=1 (el editor lo pone al guardar dentro de política, auditoría
      // UX 2026-09-28 #10): abrir el envío de una vez y limpiar la URL para que
      // un recargar no lo vuelva a abrir.
      if (params.get('enviar') === '1') {
        const url = new URL(window.location);
        url.searchParams.delete('enviar');
        window.history.replaceState({}, document.title, url.toString());
        const b = $('btnEnviarDirecto') || $('btnAprobar') || $('btnEnviar');
        if (b) b.click();
      }
    });
  });
})();
