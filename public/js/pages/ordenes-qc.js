// @ts-nocheck
/* ========================================
 * ORDENES QC - Control de calidad del taller
 * Checklist de QC (jefe_taller/admin) sobre órdenes en COMPLETADO (EN
 * OFICINA), previo a la entrega. Checklist según tipo_de_servicio
 * (programación vs reparación), aprobación con todos los ítems marcados
 * (OK o N/A) o rechazo con motivo → la orden vuelve a ASIGNADO para que
 * el técnico corrija. El resultado vive en `qc` (último) + `qc_historial`
 * (todas las pasadas, base de métricas por técnico/motivo).
 * `qc_requerido: true` lo estampa completeOrder: órdenes completadas
 * ANTES del despliegue no lo tienen y quedan exentas del candado
 * (corte legacy, mismo patrón que seriales).
 * Modal dinámico (patrón ordenes-visita.js).
 * ======================================== */

(function () {
  const esc = (s) => escapeHtml(String(s ?? ''));

  // Checklists por tipo — espejo del proceso validado con la jefa de
  // taller (correo QC jul-2026). Las keys son estables: alimentan
  // qc.checklist y las métricas; no renombrar sin migrar.
  const QC_CHECKLISTS = {
    programacion: [
      { key: 'programacion_verificada', label: 'Programación cargada y verificada en el equipo' },
      { key: 'grupos_ok',               label: 'Grupos correctamente configurados' },
      { key: 'gps_ok',                  label: 'GPS funcionando correctamente' },
      { key: 'estado_fisico',           label: 'Estado físico del equipo revisado' },
      { key: 'limpieza',                label: 'Limpieza y presentación (pantalla y exterior)' },
    ],
    reparacion: [
      { key: 'enciende_opera',  label: 'El equipo enciende y opera correctamente' },
      { key: 'falla_resuelta',  label: 'La falla reportada quedó resuelta' },
      { key: 'componentes_ok',  label: 'Componentes físicos completos y en buen estado' },
      { key: 'limpieza',        label: 'Limpieza del equipo' },
    ],
  };

  // Categorías de motivo de rechazo — chips de un tap; alimentan las
  // métricas de rechazo por motivo (fase 2).
  const MOTIVOS_RECHAZO = [
    { key: 'programacion', label: 'Programación' },
    { key: 'grupos',       label: 'Grupos' },
    { key: 'gps',          label: 'GPS' },
    { key: 'falla',        label: 'Falla no resuelta' },
    { key: 'fisico',       label: 'Físico / componentes' },
    { key: 'limpieza',     label: 'Limpieza' },
    { key: 'otro',         label: 'Otro' },
  ];

  // Suplencia: además de admin/jefe_taller, los emails habilitados en
  // empresa/config.qc_revisores_extra pueden firmar QC (mismo patrón que
  // seriales_editores_extra). Sin esto la cola de entregas se detiene
  // cuando la jefa de taller no está — hoy firma el 100% de los QC.
  // Se precarga una vez porque puedeHacerQc() se llama desde el render
  // síncrono de botones; falla cerrado si la config no se puede leer.
  let _revisoresExtra = null;
  async function precargarRevisoresExtra() {
    if (_revisoresExtra) return _revisoresExtra;
    let lista = [];
    try {
      if (typeof EmpresaService !== 'undefined') {
        const cfg = await EmpresaService.getConfig();
        lista = Array.isArray(cfg.qc_revisores_extra) ? cfg.qc_revisores_extra : [];
      }
    } catch (e) { console.warn('[OrdenesQC] no se pudo leer qc_revisores_extra:', e); }
    _revisoresExtra = new Set(lista.map(e => String(e).toLowerCase()));
    return _revisoresExtra;
  }

  // Tipo de checklist según tipo_de_servicio (misma normalización que
  // tipoChip en ordenes-state.js). Mantenimiento y tipos sin clasificar
  // usan el checklist de reparación (cubre lo esencial: opera + físico).
  function qcTipoDe(orden) {
    const t = String(orden?.tipo_de_servicio || '').toUpperCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '');
    return t.includes('PROGRAM') ? 'programacion' : 'reparacion';
  }

  // El estado del QC (aprobado / caducado / pendiente) vive en
  // PendientesDomain (js/domain/pendientes.js), espejo del módulo del
  // servidor con test de sincronía. Estas funciones eran una de las CUATRO
  // copias del mismo criterio — y la caducidad por sustitución de serial
  // había nacido solo en esta, invisible para el cron y las señales. Ahora
  // solo delegan; el porqué de cada regla está documentado en el dominio.
  function qcRequerido(orden) {
    return orden?.qc_requerido === true;
  }
  function qcAprobado(orden) {
    return PendientesDomain.qcAprobado(orden);
  }
  function qcCaducado(orden) {
    return PendientesDomain.qcCaducado(orden);
  }
  function qcPendiente(orden) {
    return PendientesDomain.qcPendiente(orden);
  }
  function puedeHacerQc(rol) {
    if (rol === ROLES.ADMIN || rol === ROLES.JEFE_TALLER) return true;
    const email = String(firebase.auth().currentUser?.email || '').toLowerCase();
    return !!email && !!_revisoresExtra && _revisoresExtra.has(email);
  }

  // Correo de rechazo al técnico asignado — best-effort: si falla (sin
  // email, sin permisos, red) el rechazo ya quedó guardado y el técnico
  // igual lo ve en su cola (botón "Rechazo QC" en ASIGNADO).
  async function _notificarRechazo(ordenId, orden, { motivos, observaciones, equipos }) {
    try {
      if (!orden.tecnico_uid || typeof MailService === 'undefined') return;
      const uDoc = await firebase.firestore().collection('usuarios').doc(orden.tecnico_uid).get();
      const email = uDoc.exists ? (uDoc.data().email || '') : '';
      if (!email) return;

      const motivosLbl = (motivos || [])
        .map(k => (MOTIVOS_RECHAZO.find(m => m.key === k) || { label: k }).label)
        .join(', ');

      // Qué radio hay que corregir, y por qué. Antes el correo decía "QC
      // rechazado" para toda la orden: con 10 equipos el técnico no sabía cuál
      // revisar y tenía que abrirlos uno a uno.
      const pe = equipos?.por_equipo || null;
      const denegados = pe ? Object.values(pe).filter(d => d.resultado === 'denegado') : [];
      const descartados = pe ? Object.values(pe).filter(d => d.resultado === 'descartado') : [];
      const listaHtml = (arr, titulo, color) => arr.length ? `
        <p style="margin-bottom:4px;"><strong style="color:${color};">${titulo}</strong></p>
        <ul style="margin-top:0;">${arr.map(d => `
          <li><strong>${escapeHtml(d.serial || '(sin serial)')}</strong>${d.modelo ? ' · ' + escapeHtml(d.modelo) : ''}
          ${d.nota ? ' — ' + escapeHtml(d.nota) : ''}</li>`).join('')}</ul>` : '';

      await MailService.enqueue({
        to: email,
        subject: `QC rechazado — Orden ${ordenId}`,
        preheader: denegados.length
          ? `${denegados.length} equipo(s) por corregir en la orden ${ordenId}`
          : `La orden ${ordenId} volvió a tu cola por control de calidad`,
        bodyContent: `
          <p>Hola ${escapeHtml(orden.tecnico_asignado || '')},</p>
          <p>El control de calidad de la orden <strong>${escapeHtml(ordenId)}</strong> fue
          <strong>rechazado</strong> y la orden volvió a tu cola (ASIGNADO) para corrección.</p>
          ${listaHtml(denegados, 'Equipos por corregir:', '#991B1B')}
          ${listaHtml(descartados, 'Equipos descartados (no los trabajes, ya salieron de circulación):', '#991B1B')}
          ${motivosLbl ? `<p><strong>Motivo:</strong> ${escapeHtml(motivosLbl)}</p>` : ''}
          ${observaciones ? `<p><strong>Observaciones:</strong> ${escapeHtml(observaciones)}</p>` : ''}
          <p>Cuando corrijas, marca la orden como completada para que pase de nuevo por QC.</p>`,
        ctaUrl: `${window.location.origin}/ordenes/index.html`,
        ctaLabel: 'Ver mis órdenes'
      });
    } catch (e) {
      console.warn('[OrdenesQC] correo de rechazo no enviado:', e);
    }
  }

  function _itemRowHtml(item, valor, eqKey = '') {
    // valor: 'ok' | 'na' | '' — chips mutuamente excluyentes por ítem.
    // eqKey: clave del equipo al que pertenece la fila (vacío = checklist de
    // orden, el camino legacy para órdenes sin equipos).
    return `
      <div class="qc-item-row" data-key="${esc(item.key)}" data-eq="${esc(eqKey)}"
           style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--line,#eee);">
        <span style="flex:1 1 auto;">${esc(item.label)}</span>
        <div style="display:flex;gap:6px;flex:0 0 auto;">
          <button type="button" class="btn ${valor === 'ok' ? 'btn-primary' : 'btn-secondary'} qc-chip" data-valor="ok"
                  style="padding:6px 14px;">OK</button>
          <button type="button" class="btn ${valor === 'na' ? 'btn-primary' : 'btn-secondary'} qc-chip" data-valor="na"
                  style="padding:6px 10px;" title="No aplica a este equipo">N/A</button>
        </div>
      </div>`;
  }

  // Clave estable de un equipo dentro de la orden. `id` es un UUID que ponen
  // los tres puntos de alta (agregar-equipo, nuevo-batch, nueva-orden), pero
  // las órdenes viejas traen equipos sin él: para esas se cae al índice, que
  // es estable dentro de UNA pasada de QC (que es lo único que hace falta —
  // el registro guarda además el serial).
  function _eqKey(eq, i) {
    return String(eq?.id || `idx_${i}`);
  }

  // Los tres desenlaces posibles de un equipo. Son excluyentes a propósito:
  // "descartado" no es "denegado con una nota", es una salida distinta (el
  // radio no vuelve al técnico, se da por perdido y entra al registro de
  // descartados que consulta bodega).
  const RESULTADOS_EQUIPO = [
    { key: 'aprobado',   label: 'Aprobado',   clase: 'btn-primary',
      title: 'El equipo pasa el control y puede entregarse' },
    { key: 'denegado',   label: 'Denegado',   clase: 'btn-danger',
      title: 'No pasa: la orden vuelve al técnico para corregir este equipo' },
    { key: 'descartado', label: 'Descartado', clase: 'btn-danger',
      title: 'El equipo no tiene arreglo. Queda registrado por serial y se alertará si alguien lo vuelve a ingresar' },
  ];

  // Tarjeta de un equipo: contexto (serial, modelo, intervención del técnico),
  // su checklist propio y su desenlace. Antes esto era UNA sola lista para toda
  // la orden: con 10 radios, la firma decía "aprobado" sin poder decir qué se
  // revisó en cada uno.
  function _equipoCardHtml(eq, key, items, idx, condReg = null) {
    const serial = String(eq.numero_de_serie || eq.serial || '').trim();
    const t = (eq.trabajo_tecnico || '').trim();
    const nd = eq.intervencion_no_disponible;
    const detalle = nd
      ? `<span style="color:#92400E;">no disponible${eq.motivo_no_disponible ? ': ' + esc(eq.motivo_no_disponible) : ''}</span>`
      : (t ? esc(t.length > 160 ? t.slice(0, 160) + '…' : t)
           : '<span style="color:#B91C1C;font-weight:600;">SIN intervención registrada</span>');

    // Condición particular (petición Solangel 2026-09-04). Dos cosas distintas:
    //   · la YA registrada por serial (condReg) — se muestra resaltada y se
    //     puede levantar si en esta orden se resolvió;
    //   · la que el técnico marcó en ESTA orden (eq.condicion_especial) — viene
    //     pre-marcada para que quien firma la confirme; al firmar "aprobado"
    //     queda registrada por serial.
    const marcada = !!(eq.condicion_especial && String(eq.condicion_texto || '').trim());
    const bannerReg = condReg ? `
        <div class="qc-eq-cond-reg" style="margin:4px 0 6px;font-size:12px;background:#FFFBEB;border:1px solid #FCD34D;color:#92400E;border-radius:6px;padding:6px 8px;line-height:1.45;">
          ⚠ <b>Condición registrada:</b> ${esc(condReg.condicion || '')}
          <span style="opacity:.8;"> · ${esc([condReg.por_email, condReg.orden_id ? 'orden ' + condReg.orden_id : ''].filter(Boolean).join(' · '))}</span>
          <label style="display:flex;align-items:center;gap:6px;margin-top:5px;cursor:pointer;">
            <input type="checkbox" class="qc-eq-cond-levantar"> Se resolvió en esta orden — levantar la condición al firmar
          </label>
        </div>` : '';
    const condBlock = `
        <div class="qc-eq-cond-wrap" style="margin-top:8px;">
          <label style="display:flex;align-items:center;gap:6px;font-size:12.5px;cursor:pointer;color:#92400E;">
            <input type="checkbox" class="qc-eq-cond-chk" ${marcada ? 'checked' : ''}>
            <span>Funciona, pero con una condición particular${marcada ? ' <span class="muted">(la marcó el técnico)</span>' : ''}</span>
          </label>
          <input type="text" class="form-input qc-eq-cond-txt" style="font-size:13px;margin-top:4px;${marcada ? '' : 'display:none;'}"
                 value="${esc(marcada ? eq.condicion_texto : '')}"
                 placeholder="Cuál (obligatorio) — queda pegada al serial y avisa en bodega, taller y contratos">
        </div>`;

    return `
      <div class="qc-equipo-card" data-eq="${esc(key)}"
           style="border:1px solid var(--line,#E5E7EB);border-radius:10px;padding:10px 12px;margin-bottom:10px;">
        <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;">
          <div style="font-size:13px;">
            <span class="muted">#${idx + 1}</span>
            <span style="font-family:var(--font-mono,monospace);font-weight:700;color:var(--accent,#0091D7);">${esc(serial || '(sin serial)')}</span>
            ${eq.modelo ? `<span class="muted"> · ${esc(eq.modelo)}</span>` : ''}
          </div>
          <button type="button" class="btn btn-secondary btn-sm qc-eq-todo-ok" style="padding:4px 10px;font-size:12px;"
                  title="Marca todos los puntos de ESTE equipo como OK y lo deja aprobado">Todo OK</button>
        </div>
        <div style="font-size:12px;line-height:1.45;margin:4px 0 6px;">${detalle}</div>
        ${bannerReg}

        <div class="qc-eq-checklist">
          ${items.map(it => _itemRowHtml(it, '', key)).join('')}
        </div>

        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:8px;">
          <span style="font-size:12px;font-weight:600;">Resultado:</span>
          ${RESULTADOS_EQUIPO.map(r => `
            <button type="button" class="btn btn-secondary qc-eq-resultado" data-resultado="${r.key}"
                    title="${esc(r.title)}" style="padding:5px 12px;font-size:12.5px;">${r.label}</button>`).join('')}
        </div>

        <div class="qc-eq-nota-wrap" style="display:none;margin-top:8px;">
          <input type="text" class="form-input qc-eq-nota" style="font-size:13px;"
                 placeholder="Motivo (obligatorio) — qué falló o por qué se descarta">
        </div>
        ${condBlock}
      </div>`;
  }

  // Checklist de ORDEN derivado del de cada equipo. No es decorativo: la regla
  // qcAprobadoTraeChecklist() de firestore.rules cuenta las claves de
  // qc.checklist (≥5 programación, ≥4 reparación) y progreso-tecnicos.js lee
  // ese mismo mapa plano. Mantenerlo evita migrar reglas y tablero a la vez.
  // Criterio: 'na' solo si TODOS los equipos que marcaron ese punto lo pusieron
  // N/A; en cualquier otro caso 'ok'. El detalle fiel vive en qc.por_equipo —
  // este mapa es el resumen, no la fuente de verdad.
  function _rollupChecklist(items, porEquipo, eqs) {
    const out = {};
    items.forEach(it => {
      const vals = eqs.map(({ key }) => porEquipo[key]?.checklist?.[it.key]).filter(Boolean);
      out[it.key] = (!vals.length || vals.every(v => v === 'na')) ? 'na' : 'ok';
    });
    return out;
  }

  // Escribe en el registro de descartados los equipos marcados como tales.
  // A diferencia del correo de rechazo, esto NO es best-effort silencioso: si
  // falla, bodega no recibe la alerta y el radio vuelve a circular. Devuelve
  // los seriales que no se pudieron registrar para avisarlo en pantalla.
  async function _registrarDescartes(ordenId, orden, porEquipoDoc) {
    if (typeof EquiposDescartadosService === 'undefined') return [];
    const fallos = [];
    for (const d of Object.values(porEquipoDoc || {})) {
      if (d.resultado !== 'descartado') continue;
      try {
        await EquiposDescartadosService.registrar({
          serial: d.serial,
          modelo: d.modelo,
          orden_id: ordenId,
          equipo_id: d.equipo_id,
          cliente: orden.cliente_nombre || orden.cliente || orden.nombre_cliente || '',
          motivo: d.nota,
          checklist: d.checklist,
        });
        // El chip del campo de serial cachea 60 s: sin esto, quien teclee el
        // serial en el minuto siguiente no vería la alerta recién creada.
        if (window.SerialField) SerialField.invalidar(d.serial);
      } catch (e) {
        console.error('[OrdenesQC] no se registró el descarte de', d.serial, e);
        fallos.push(d.serial || '(sin serial)');
      }
    }
    return fallos;
  }

  // Escribe en el registro por serial las condiciones particulares de los
  // equipos APROBADOS (y levanta las que se marcaron como resueltas). Mismo
  // fail-soft que los descartes: devuelve los seriales que no se pudieron
  // registrar para avisarlo en pantalla.
  async function _registrarCondiciones(ordenId, orden, porEquipoDoc) {
    if (typeof EquiposCondicionesService === 'undefined') return [];
    const fallos = [];
    for (const d of Object.values(porEquipoDoc || {})) {
      if (d.resultado !== 'aprobado' || !d.serial) continue;
      if (!d.condicion && !d.levantar_condicion) continue;
      try {
        if (d.condicion) {
          await EquiposCondicionesService.registrar({
            serial: d.serial,
            condicion: d.condicion,
            modelo: d.modelo,
            orden_id: ordenId,
            equipo_id: d.equipo_id,
            cliente: orden.cliente_nombre || orden.cliente || orden.nombre_cliente || '',
            origen: 'qc',
          });
        } else {
          await EquiposCondicionesService.levantar(d.serial, `Resuelta en la orden ${ordenId} (control de calidad)`);
        }
        if (window.SerialField) SerialField.invalidar(d.serial);
      } catch (e) {
        console.error('[OrdenesQC] no se registró la condición de', d.serial, e);
        fallos.push(d.serial);
      }
    }
    return fallos;
  }

  // Resumen por equipo de una pasada ya firmada (modo consulta).
  function _porEquipoResumenHtml(qc) {
    const pe = qc?.por_equipo;
    if (!pe || !Object.keys(pe).length) return '';
    const items = QC_CHECKLISTS[qc.tipo === 'programacion' ? 'programacion' : 'reparacion'];
    const ICONO = { aprobado: '✅', denegado: '❌', descartado: '⛔' };
    const filas = Object.values(pe).map(d => {
      const marcas = items.map(it => {
        const v = (d.checklist || {})[it.key];
        return `<span title="${esc(it.label)}">${v === 'ok' ? '✅' : (v === 'na' ? '·' : '—')}</span>`;
      }).join(' ');
      return `<div style="padding:6px 0;border-bottom:1px solid var(--line,#eee);font-size:12.5px;">
          <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
            <span>
              <span style="font-family:var(--font-mono,monospace);font-weight:700;">${esc(d.serial || '(sin serial)')}</span>
              ${d.modelo ? `<span class="muted"> · ${esc(d.modelo)}</span>` : ''}
            </span>
            <span><span style="letter-spacing:2px;">${marcas}</span>
              &nbsp;<b>${ICONO[d.resultado] || ''} ${esc(d.resultado || '')}</b></span>
          </div>
          ${d.nota ? `<div class="muted" style="color:#991B1B;">${esc(d.nota)}</div>` : ''}
          ${d.condicion ? `<div class="muted" style="color:#92400E;">⚠ Con condición: ${esc(d.condicion)}</div>` : ''}
          ${d.levantar_condicion ? '<div class="muted" style="color:#065F46;">✓ Condición levantada en esta orden</div>' : ''}
        </div>`;
    }).join('');
    return `
      <div style="margin-bottom:10px;">
        <div style="font-weight:600;font-size:13px;margin-bottom:4px;">Revisión por equipo (${Object.keys(pe).length})</div>
        <div style="border:1px solid var(--line,#eee);border-radius:8px;padding:6px 10px;">${filas}</div>
        <div class="muted" style="font-size:11.5px;margin-top:4px;">
          Orden de los puntos: ${items.map(it => esc(it.label)).join(' · ')}
        </div>
      </div>`;
  }

  function _resumenQcHtml(qc) {
    const tipo = qc.tipo === 'programacion' ? 'programacion' : 'reparacion';
    const items = QC_CHECKLISTS[tipo];
    const filas = items.map(it => {
      const v = (qc.checklist || {})[it.key];
      const chip = v === 'na'
        ? '<span class="muted">N/A</span>'
        : (v === 'ok' ? '✅' : '—');
      return `<div style="display:flex;justify-content:space-between;gap:8px;padding:4px 0;">
                <span>${esc(it.label)}</span><span>${chip}</span>
              </div>`;
    }).join('');
    const fecha = qc.fecha?.toDate ? qc.fecha.toDate().toLocaleString('es-PA') : (qc.fecha_iso || '');
    const motivosLbl = (qc.motivos || [])
      .map(k => (MOTIVOS_RECHAZO.find(m => m.key === k) || { label: k }).label)
      .join(', ');
    // Qué unidades cubrió la firma — el checklist es por orden, así que sin
    // esta lista una aprobación sobre 10 radios no dice cuáles se revisaron.
    const seriales = Array.isArray(qc.seriales) ? qc.seriales : [];
    // Con revisión por equipo, el detalle por radio ES el resumen; el checklist
    // plano de abajo queda como derivado y sobra en pantalla.
    const detallePorEquipo = _porEquipoResumenHtml(qc);
    if (detallePorEquipo) {
      return `
      ${detallePorEquipo}
      ${motivosLbl ? `<div style="margin-bottom:8px;color:#991b1b;"><b>Motivo del rechazo:</b> ${esc(motivosLbl)}</div>` : ''}
      ${qc.observaciones ? `<div class="muted" style="margin-bottom:8px;"><b>Observaciones:</b> ${esc(qc.observaciones)}</div>` : ''}
      <div class="muted" style="font-size:12px;">Revisado por ${esc(qc.por_email || '')}${fecha ? ` · ${esc(fecha)}` : ''}</div>`;
    }
    return `
      <div style="border:1px solid var(--line,#eee);border-radius:8px;padding:10px 12px;margin-bottom:10px;">
        ${filas}
      </div>
      ${motivosLbl ? `<div style="margin-bottom:8px;color:#991b1b;"><b>Motivo del rechazo:</b> ${esc(motivosLbl)}</div>` : ''}
      ${qc.observaciones ? `<div class="muted" style="margin-bottom:8px;"><b>Observaciones:</b> ${esc(qc.observaciones)}</div>` : ''}
      ${seriales.length ? `<div class="muted" style="margin-bottom:8px;font-size:12px;">
        <b>Equipos cubiertos (${seriales.length}):</b> ${esc(seriales.join(', '))}</div>` : ''}
      <div class="muted" style="font-size:12px;">Revisado por ${esc(qc.por_email || '')}${fecha ? ` · ${esc(fecha)}` : ''}</div>`;
  }

  // Pasadas anteriores. El resumen de arriba solo pinta `qc` (la última), así
  // que sobre una orden rechazada y luego aprobada el rechazo desaparecía de
  // la vista aunque siguiera en qc_historial.
  function _historialHtml(orden) {
    const hist = Array.isArray(orden?.qc_historial) ? orden.qc_historial : [];
    if (hist.length < 2) return '';
    const filas = hist.slice().reverse().map(h => {
      const f = h.fecha_iso ? new Date(h.fecha_iso).toLocaleString('es-PA') : '';
      const motivos = (h.motivos || [])
        .map(k => (MOTIVOS_RECHAZO.find(m => m.key === k) || { label: k }).label)
        .join(', ');
      return `<div style="padding:6px 0;border-bottom:1px solid var(--line,#eee);font-size:12px;">
          <b>${h.resultado === 'aprobado' ? '✅ Aprobado' : '❌ Rechazado'}</b>
          <span class="muted"> · ${esc(f)} · ${esc(h.por_email || '')}</span>
          ${motivos ? `<div style="color:#991b1b;">${esc(motivos)}</div>` : ''}
          ${h.observaciones ? `<div class="muted">${esc(h.observaciones)}</div>` : ''}
        </div>`;
    }).join('');
    return `
      <details style="margin-top:10px;">
        <summary style="cursor:pointer;font-weight:600;">Historial de QC (${hist.length} pasadas)</summary>
        <div style="margin-top:6px;">${filas}</div>
      </details>`;
  }

  async function abrir(ordenId, { forzarEdicion = false } = {}) {
    let orden;
    try {
      await precargarRevisoresExtra();
      orden = await OrdenesService.getOrder(ordenId);
    } catch (e) {
      console.error('[OrdenesQC.abrir]', e);
      Toast.show('Error cargando la orden', 'bad');
      return;
    }
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }

    const rol = APP.state.userRole || '';
    const estado = String(orden.estado_reparacion || '').toUpperCase();
    // Solo se ejecuta QC sobre COMPLETADO y con rol autorizado; en cualquier
    // otro caso el modal es de consulta (muestra el último resultado).
    // Con una aprobación VIGENTE el modal también abre en consulta —el botón
    // dice "Ver QC"— y repetirla es un acto explícito ("Repetir QC"), no un
    // checklist en blanco que aparece sin pedirlo.
    const puedeEjecutar = puedeHacerQc(rol) && estado === 'COMPLETADO (EN OFICINA)';
    const soloLectura = !puedeEjecutar || (qcAprobado(orden) && !forzarEdicion);

    const tipo = qcTipoDe(orden);
    const items = QC_CHECKLISTS[tipo];
    const qcPrev = orden.qc || null;
    const rechazoPrevio = qcPrev && qcPrev.resultado === 'rechazado';
    const caducado = qcCaducado(orden);
    const equiposAhora = Array.isArray(orden.equipos) ? orden.equipos.length : 0;

    // Los equipos a revisar, uno por uno. `eliminado` es borrado lógico: no se
    // revisa lo que ya no sale de taller. Si la orden no tiene equipos (o son
    // todos eliminados) se cae al checklist plano de siempre — hay órdenes así
    // y dejarlas sin forma de firmar QC bloquearía la entrega.
    const eqs = (orden.equipos || [])
      .filter(x => !x.eliminado)
      .map((eq, i) => ({ eq, key: _eqKey(eq, i) }));
    const porEquipoUI = eqs.length > 0;

    // Condiciones YA registradas por serial (equipos_condiciones): quien
    // firma la salida de taller tiene que verlas resaltadas en la tarjeta de
    // cada radio (petición Solangel 2026-09-04). Best-effort.
    let condiciones = new Map();
    if (typeof EquiposCondicionesService !== 'undefined' && eqs.length) {
      try {
        condiciones = await EquiposCondicionesService.buscarVarios(
          eqs.map(({ eq }) => String(eq.numero_de_serie || eq.serial || '')));
      } catch (e) { condiciones = new Map(); }
    }
    const condRegDe = (eq) => typeof EquiposCondicionesService === 'undefined' ? null
      : (condiciones.get(EquiposCondicionesService.normalizar(String(eq.numero_de_serie || eq.serial || ''))) || null);

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9500';

    const tituloTipo = tipo === 'programacion' ? 'Programación' : 'Reparación';

    overlay.innerHTML = `
      <div class="modal" style="max-width:560px;width:min(94vw,560px);">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;">
            <i data-lucide="clipboard-check"></i> Control de calidad — Orden ${esc(ordenId)}
          </h3>
          <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:12px 14px;max-height:72vh;overflow:auto;">
          <div class="muted" style="margin-bottom:10px;display:flex;gap:10px;flex-wrap:wrap;">
            <span><b>Tipo:</b> ${esc(orden.tipo_de_servicio || tituloTipo)}</span>
            ${orden.tecnico_asignado ? `<span><b>Técnico:</b> ${esc(orden.tecnico_asignado)}</span>` : ''}
          </div>

          ${(() => {
            // Contexto (auditoría órdenes P1.11): el jefe revisaba A CIEGAS —
            // el modal no mostraba equipos ni intervenciones y había que
            // alternar con la fila expandida detrás.
            // En modo edición este bloque sobra: cada tarjeta de equipo ya trae
            // su serial, su modelo y su intervención encima del checklist.
            if (!soloLectura && porEquipoUI) return '';
            if (!eqs.length) return '';
            return `
            <details open style="margin-bottom:10px;border:1px solid var(--line,#E5E7EB);border-radius:8px;padding:8px 10px;">
              <summary style="cursor:pointer;font-weight:600;font-size:13px;">Equipos e intervenciones (${eqs.length})</summary>
              <div style="margin-top:6px;display:flex;flex-direction:column;gap:6px;max-height:180px;overflow:auto;">
                ${eqs.map(({ eq }) => {
                  const t = (eq.trabajo_tecnico || '').trim();
                  const nd = eq.intervencion_no_disponible;
                  const detalle = nd
                    ? `<span style="color:#92400E;">no disponible${eq.motivo_no_disponible ? ': ' + esc(eq.motivo_no_disponible) : ''}</span>`
                    : (t ? esc(t.length > 120 ? t.slice(0, 120) + '…' : t)
                         : '<span style="color:#B91C1C;font-weight:600;">SIN intervención registrada</span>');
                  return `<div style="font-size:12.5px;line-height:1.45;">
                    <span style="font-family:var(--font-mono,monospace);font-weight:600;color:var(--accent,#0091D7);">${esc(eq.numero_de_serie || eq.serial || '-')}</span>
                    ${eq.modelo ? ' · ' + esc(eq.modelo) : ''} — ${detalle}
                  </div>`;
                }).join('')}
              </div>
            </details>`;
          })()}

          ${soloLectura && qcPrev ? `
            <div style="margin-bottom:8px;font-weight:600;">
              Resultado: ${qcPrev.resultado === 'aprobado' ? '✅ Aprobado' : '❌ Rechazado'}
              ${caducado ? ' <span style="color:#92400e;">(caducado — cambiaron los equipos)</span>' : ''}
            </div>
            ${_resumenQcHtml(qcPrev)}
            ${_historialHtml(orden)}
          ` : soloLectura ? `
            <div class="muted">Esta orden no tiene control de calidad registrado.</div>
          ` : `
            ${caducado ? `
              <div style="background:#fffbeb;border:1px solid #fcd34d;color:#92400e;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:13px;">
                <b>El QC aprobado caducó.</b> La orden tenía ${esc(qcPrev.equipos_n)} equipo(s)
                cuando se firmó y ahora tiene ${esc(equiposAhora)}. Repita el control
                para cubrir los equipos que se agregaron o quitaron.
              </div>` : ''}
            ${rechazoPrevio ? `
              <div style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:13px;">
                <b>Rechazada anteriormente</b>${qcPrev.observaciones ? `: ${esc(qcPrev.observaciones)}` : ''}.
                Verifique de nuevo el checklist completo.
              </div>` : ''}

            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;">
              <span style="font-weight:600;font-size:13px;">
                ${porEquipoUI ? `Revisión equipo por equipo (${eqs.length})` : 'Checklist de la orden'}
              </span>
              <button type="button" class="btn btn-secondary btn-sm" id="qcTodoOkBtn"
                      title="${porEquipoUI
                        ? 'Marca TODOS los equipos como aprobados con el checklist completo en OK'
                        : 'Marca todos los puntos del checklist como OK — el registro queda igual de completo'}">
                <i data-lucide="check-check"></i> ${porEquipoUI ? 'Aprobar todos' : 'Marcar todo OK'}
              </button>
            </div>
            <div id="qcChecklist">
              ${porEquipoUI
                ? eqs.map(({ eq, key }, i) => _equipoCardHtml(eq, key, items, i, condRegDe(eq))).join('')
                : items.map(it => _itemRowHtml(it, '')).join('')}
            </div>

            <div id="qcResumenSel" class="muted" style="font-size:12.5px;margin-top:2px;"></div>

            <div class="form-field" style="margin-top:12px;">
              <label class="form-label">Motivo del rechazo <span class="muted" style="font-weight:400;">(solo si rechaza)</span></label>
              <div id="qcMotivos" style="display:flex;gap:6px;flex-wrap:wrap;">
                ${MOTIVOS_RECHAZO.map(m => `
                  <button type="button" class="btn btn-secondary qc-motivo-chip" data-motivo="${m.key}"
                          style="padding:6px 12px;">${m.label}</button>`).join('')}
              </div>
            </div>

            <div class="form-field" style="margin-top:10px;">
              <label class="form-label" for="qcObservaciones">Observaciones</label>
              <textarea class="form-input form-textarea" id="qcObservaciones" rows="3"
                placeholder="Observaciones para el técnico o para el registro (obligatorias al rechazar si no marca motivo)"></textarea>
            </div>
          `}
        </div>
        <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
          <button class="btn btn-secondary" data-close="1">${soloLectura ? 'Cerrar' : 'Cancelar'}</button>
          ${soloLectura && puedeEjecutar ? `
            <button class="btn btn-secondary" id="qcRepetirBtn"><i data-lucide="rotate-ccw"></i> Repetir QC</button>
          ` : ''}
          ${soloLectura ? '' : `
            <button class="btn btn-danger" id="qcRechazarBtn"><i data-lucide="x-circle"></i> Rechazar</button>
            <button class="btn btn-primary" id="qcAprobarBtn" disabled
                    title="Marque todos los puntos (OK o N/A) para aprobar">
              <i data-lucide="check-circle"></i> Aprobar QC
            </button>
          `}
        </div>
      </div>`;

    const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
    const kb = e => { if (e.key === 'Escape') cleanup(); };
    document.addEventListener('keydown', kb);

    // Estado del formulario. `checklist` es el camino legacy (orden sin
    // equipos); con equipos manda `porEquipo`, y el checklist de orden se
    // deriva de él al guardar (ver _rollupChecklist) para no romper ni la
    // regla de Firestore ni las métricas por técnico, que siguen leyendo
    // qc.checklist como un mapa plano.
    const checklist = {};   // key → 'ok' | 'na'
    const porEquipo = {};   // eqKey → { checklist:{}, resultado:'', nota:'', conCondicion, condicion, levantar }
    eqs.forEach(({ eq, key }) => {
      // La condición que el técnico marcó en la intervención viene pre-cargada
      // para que quien firma la confirme (o la quite si no aplica).
      const marcada = !!(eq.condicion_especial && String(eq.condicion_texto || '').trim());
      porEquipo[key] = {
        checklist: {}, resultado: '', nota: '',
        conCondicion: marcada,
        condicion: marcada ? String(eq.condicion_texto || '').trim() : '',
        levantar: false,   // "se resolvió en esta orden" sobre una condición ya registrada
      };
    });
    const motivosSel = new Set();

    // Un equipo está resuelto cuando tiene desenlace y el respaldo que ese
    // desenlace exige: aprobar pide el checklist completo (es lo que certifica
    // la firma); denegar y descartar piden el motivo escrito (es lo que lee
    // después el técnico o bodega). Exigir el checklist completo para descartar
    // un radio que ni enciende sería puro ritual.
    function _equipoResuelto(key) {
      const st = porEquipo[key];
      if (!st || !st.resultado) return false;
      if (st.resultado === 'aprobado') {
        const checklistOk = items.every(it => st.checklist[it.key] === 'ok' || st.checklist[it.key] === 'na');
        // "Con condición" sin decir cuál no sirve de nada a bodega.
        return checklistOk && (!st.conCondicion || !!st.condicion.trim());
      }
      return !!st.nota.trim();
    }

    const _refrescarEstado = () => {
      const btnOk = overlay.querySelector('#qcAprobarBtn');
      const btnNo = overlay.querySelector('#qcRechazarBtn');
      const resumen = overlay.querySelector('#qcResumenSel');

      if (!porEquipoUI) {
        if (btnOk) btnOk.disabled = !items.every(it => checklist[it.key] === 'ok' || checklist[it.key] === 'na');
        return;
      }

      const estados = eqs.map(({ key }) => porEquipo[key].resultado);
      const aprobados   = estados.filter(r => r === 'aprobado').length;
      const denegados   = estados.filter(r => r === 'denegado').length;
      const descartados = estados.filter(r => r === 'descartado').length;
      const conCond     = eqs.filter(({ key }) => porEquipo[key].resultado === 'aprobado' && porEquipo[key].conCondicion).length;
      const pendientes  = eqs.filter(({ key }) => !_equipoResuelto(key)).length;

      if (resumen) {
        resumen.innerHTML = pendientes
          ? `<span style="color:#92400E;">Faltan ${pendientes} equipo(s) por resolver.</span>`
          : `${aprobados} aprobado(s)`
            + (conCond ? ` · <b style="color:#92400E;">${conCond} con condición</b>` : '')
            + (denegados ? ` · <b style="color:#991B1B;">${denegados} denegado(s)</b>` : '')
            + (descartados ? ` · <b style="color:#991B1B;">${descartados} descartado(s)</b>` : '');
      }

      if (btnOk) {
        // Un solo equipo denegado manda la orden entera de vuelta al técnico:
        // no se puede firmar "aprobado" sobre una orden con trabajo pendiente.
        // Los descartados NO bloquean — ese equipo ya no vuelve al técnico.
        btnOk.disabled = pendientes > 0 || denegados > 0;
        btnOk.title = denegados
          ? 'Hay equipos denegados: la orden tiene que volver al técnico (Rechazar)'
          : (pendientes ? 'Resuelva todos los equipos para aprobar' : 'Firmar el control de calidad');
      }
      if (btnNo) {
        btnNo.classList.toggle('btn-danger', true);
        btnNo.style.outline = denegados ? '2px solid #991B1B' : '';
      }
    };
    // Alias conservado: había llamadas al nombre viejo en los handlers.
    const _refreshAprobar = _refrescarEstado;

    function _pintarItem(row, valor) {
      row.querySelectorAll('.qc-chip').forEach(b => {
        const activo = b.dataset.valor === valor;
        b.classList.toggle('btn-primary', activo);
        b.classList.toggle('btn-secondary', !activo);
      });
    }

    function _pintarResultado(eqKey) {
      const card = overlay.querySelector(`.qc-equipo-card[data-eq="${CSS.escape(eqKey)}"]`);
      if (!card) return;
      const sel = porEquipo[eqKey].resultado;
      card.querySelectorAll('.qc-eq-resultado').forEach(b => {
        const r = RESULTADOS_EQUIPO.find(x => x.key === b.dataset.resultado);
        const activo = b.dataset.resultado === sel;
        b.classList.toggle('btn-secondary', !activo);
        b.classList.toggle('btn-primary', activo && r.clase === 'btn-primary');
        b.classList.toggle('btn-danger', activo && r.clase === 'btn-danger');
      });
      // El motivo solo se pide cuando hay algo que explicar.
      const wrap = card.querySelector('.qc-eq-nota-wrap');
      const pide = sel === 'denegado' || sel === 'descartado';
      wrap.style.display = pide ? '' : 'none';
      const inp = wrap.querySelector('.qc-eq-nota');
      inp.placeholder = sel === 'descartado'
        ? 'Motivo del descarte (obligatorio) — quedará en el registro que consulta bodega'
        : 'Qué debe corregir el técnico (obligatorio)';
      // Aviso explícito: descartar deja huella fuera de esta orden.
      let aviso = card.querySelector('.qc-eq-aviso-descarte');
      if (sel === 'descartado' && !aviso) {
        aviso = document.createElement('div');
        aviso.className = 'qc-eq-aviso-descarte';
        aviso.style.cssText = 'margin-top:6px;font-size:12px;background:#FEF2F2;border:1px solid #FECACA;color:#991B1B;border-radius:6px;padding:6px 8px;';
        aviso.textContent = 'Al firmar, este serial queda en el registro de equipos descartados: si alguien lo teclea en bodega o taller, saltará una alerta.';
        wrap.appendChild(aviso);
      } else if (sel !== 'descartado' && aviso) {
        aviso.remove();
      }
      // El verde señala RESUELTO, no "elegí aprobado": marcar el desenlace sin
      // completar el checklist dejaba la tarjeta en verde mientras el resumen
      // de abajo seguía diciendo que faltaba resolverla.
      card.style.borderColor = _equipoResuelto(eqKey) ? '#86EFAC'
        : (pide || sel ? '#FCD34D' : 'var(--line,#E5E7EB)');
    }

    // El motivo por equipo se teclea, no se clickea: va por 'input'.
    overlay.addEventListener('input', (e) => {
      const nota = e.target.closest('.qc-eq-nota');
      const cond = e.target.closest('.qc-eq-cond-txt');
      if (!nota && !cond) return;
      const eqK = e.target.closest('.qc-equipo-card').dataset.eq;
      if (nota) porEquipo[eqK].nota = nota.value;
      else porEquipo[eqK].condicion = cond.value;
      _pintarResultado(eqK);   // el motivo escrito es lo que resuelve la tarjeta
      _refrescarEstado();
    });

    // Condición particular: marcarla y "se resolvió" a la vez se contradicen,
    // así que una desmarca la otra.
    overlay.addEventListener('change', (e) => {
      const chk = e.target.closest('.qc-eq-cond-chk');
      const lev = e.target.closest('.qc-eq-cond-levantar');
      if (!chk && !lev) return;
      const card = e.target.closest('.qc-equipo-card');
      const eqK = card.dataset.eq;
      const st = porEquipo[eqK];
      const txt = card.querySelector('.qc-eq-cond-txt');
      if (chk) {
        st.conCondicion = chk.checked;
        if (txt) txt.style.display = chk.checked ? '' : 'none';
        if (chk.checked) {
          st.condicion = txt ? txt.value : '';
          const l = card.querySelector('.qc-eq-cond-levantar');
          if (l) { l.checked = false; st.levantar = false; }
          setTimeout(() => txt?.focus(), 0);
        }
      } else {
        st.levantar = lev.checked;
        if (lev.checked) {
          const c = card.querySelector('.qc-eq-cond-chk');
          if (c && c.checked) { c.checked = false; st.conCondicion = false; if (txt) txt.style.display = 'none'; }
        }
      }
      _pintarResultado(eqK);
      _refrescarEstado();
    });

    overlay.addEventListener('click', async (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }

      // "Todo OK" / "Aprobar todos" (auditoría P1.11): con 0 rechazos en 33
      // firmas, marcar los ítems uno a uno era ritual — un click deja el
      // registro igual de completo; denegar y descartar siguen exigiendo motivo.
      // Con N equipos el ahorro es N veces mayor, así que aquí también deja
      // cada equipo en "aprobado".
      if (e.target.closest('#qcTodoOkBtn')) {
        overlay.querySelectorAll('.qc-item-row').forEach(row => {
          const eqK = row.dataset.eq;
          if (eqK && porEquipo[eqK]) porEquipo[eqK].checklist[row.dataset.key] = 'ok';
          else checklist[row.dataset.key] = 'ok';
          _pintarItem(row, 'ok');
        });
        if (porEquipoUI) {
          eqs.forEach(({ key }) => {
            porEquipo[key].resultado = 'aprobado';
            _pintarResultado(key);
          });
        }
        _refrescarEstado();
        return;
      }

      // "Todo OK" de UN equipo — el caso común es 9 radios bien y 1 con falla.
      const todoOkEq = e.target.closest('.qc-eq-todo-ok');
      if (todoOkEq) {
        const card = todoOkEq.closest('.qc-equipo-card');
        const eqK = card.dataset.eq;
        card.querySelectorAll('.qc-item-row').forEach(row => {
          porEquipo[eqK].checklist[row.dataset.key] = 'ok';
          _pintarItem(row, 'ok');
        });
        porEquipo[eqK].resultado = 'aprobado';
        _pintarResultado(eqK);
        _refrescarEstado();
        return;
      }

      const chip = e.target.closest('.qc-chip');
      if (chip) {
        const row = chip.closest('.qc-item-row');
        const key = row.dataset.key;
        const eqK = row.dataset.eq;
        const valor = chip.dataset.valor;
        if (eqK && porEquipo[eqK]) porEquipo[eqK].checklist[key] = valor;
        else checklist[key] = valor;
        _pintarItem(row, valor);
        _refrescarEstado();
        return;
      }

      // Desenlace de un equipo. Al marcar denegado/descartado aparece el campo
      // de motivo: sin él no se puede cerrar la pasada (lo exige _equipoResuelto).
      const res = e.target.closest('.qc-eq-resultado');
      if (res) {
        const card = res.closest('.qc-equipo-card');
        const eqK = card.dataset.eq;
        // Segundo click sobre el mismo desenlace lo deselecciona — arrepentirse
        // no debería obligar a elegir otro para poder volver atrás.
        porEquipo[eqK].resultado = porEquipo[eqK].resultado === res.dataset.resultado
          ? '' : res.dataset.resultado;
        _pintarResultado(eqK);
        _refrescarEstado();
        return;
      }

      const motivo = e.target.closest('.qc-motivo-chip');
      if (motivo) {
        const k = motivo.dataset.motivo;
        if (motivosSel.has(k)) motivosSel.delete(k); else motivosSel.add(k);
        motivo.classList.toggle('btn-primary', motivosSel.has(k));
        motivo.classList.toggle('btn-secondary', !motivosSel.has(k));
        return;
      }
    });

    const btnAprobar  = overlay.querySelector('#qcAprobarBtn');
    const btnRechazar = overlay.querySelector('#qcRechazarBtn');
    const btnRepetir  = overlay.querySelector('#qcRepetirBtn');

    // Repetir sobre una aprobación vigente: reabre el mismo modal en modo
    // edición con el checklist en blanco (una pasada nueva se verifica entera).
    if (btnRepetir) btnRepetir.onclick = () => { cleanup(); abrir(ordenId, { forzarEdicion: true }); };

    // Arma el bloque por equipo que se guarda en `qc.por_equipo` y las listas
    // de seriales por desenlace (lo que permite decir CUÁLES se aprobaron y
    // cuáles se descartaron sin abrir la orden).
    function _payloadEquipos() {
      if (!porEquipoUI) return null;
      const por_equipo = {};
      const aprobados = [], denegados = [], descartados = [], con_condicion = [];
      eqs.forEach(({ eq, key }) => {
        const st = porEquipo[key];
        const serial = String(eq.numero_de_serie || eq.serial || '').trim();
        // La condición solo cuenta sobre un radio APROBADO: uno denegado
        // vuelve al técnico y se registra en la pasada siguiente.
        const condicion = st.resultado === 'aprobado' && st.conCondicion ? st.condicion.trim() : '';
        por_equipo[key] = {
          equipo_id: String(eq.id || ''),
          serial,
          modelo: String(eq.modelo || ''),
          checklist: { ...st.checklist },
          resultado: st.resultado,
          nota: st.nota.trim(),
          condicion,
          levantar_condicion: st.resultado === 'aprobado' && !condicion && !!st.levantar,
        };
        if (!serial) return;
        if (st.resultado === 'aprobado') aprobados.push(serial);
        else if (st.resultado === 'denegado') denegados.push(serial);
        else if (st.resultado === 'descartado') descartados.push(serial);
        if (condicion) con_condicion.push(serial);
      });
      return {
        por_equipo, aprobados, denegados, descartados, con_condicion,
        equipos_revisados_n: eqs.length,
        checklist: _rollupChecklist(items, porEquipo, eqs),
      };
    }

    if (btnAprobar) btnAprobar.onclick = async () => {
      const obs = overlay.querySelector('#qcObservaciones').value.trim();
      const pe = _payloadEquipos();
      // Descartar equipos es irreversible de hecho (el radio se da por perdido
      // y bodega quedará avisada), así que se confirma aparte de la firma.
      if (pe && pe.descartados.length) {
        // Modal.confirm inserta `message` como HTML (no lo escapa): el salto va
        // con <br> y los seriales pasan por esc().
        const ok = await Modal.confirm({
          message: `Se descartarán ${pe.descartados.length} equipo(s): <b>${esc(pe.descartados.join(', '))}</b>.<br><br>`
            + 'Quedarán registrados por serial y saltará una alerta si alguien los vuelve a ingresar en bodega o taller. ¿Continuar?',
          danger: true
        });
        if (!ok) return;
      }
      btnAprobar.disabled = true;
      btnAprobar.textContent = 'Guardando…';
      try {
        await OrdenesService.saveQcAprobado(ordenId, {
          tipo,
          checklist: pe ? pe.checklist : { ...checklist },
          observaciones: obs,
          equipos: pe,
        });
        const fallos = pe ? await _registrarDescartes(ordenId, orden, pe.por_equipo) : [];
        const fallosCond = pe ? await _registrarCondiciones(ordenId, orden, pe.por_equipo) : [];
        cleanup();
        if (fallos.length) {
          Toast.show(`QC aprobado, pero NO se registró el descarte de ${fallos.join(', ')}. Regístrelo a mano en Inventario · Descartados.`, 'bad');
        } else if (fallosCond.length) {
          Toast.show(`QC aprobado, pero NO se registró la condición de ${fallosCond.join(', ')}. Regístrala a mano desde la ficha del equipo.`, 'bad');
        } else if (pe && pe.con_condicion.length) {
          Toast.show(`✅ QC aprobado — ${pe.con_condicion.length} equipo(s) con condición quedaron registrados por serial`, 'ok');
        } else {
          Toast.show('✅ Control de calidad aprobado — la orden puede entregarse', 'ok');
        }
      } catch (err) {
        console.error('[OrdenesQC] aprobar', err);
        Toast.show('❌ Error al guardar el QC: ' + err.message, 'bad');
        btnAprobar.disabled = false;
        btnAprobar.innerHTML = '<i data-lucide="check-circle"></i> Aprobar QC';
        APP.utils.lucideRefresh(btnAprobar);
      }
    };

    if (btnRechazar) btnRechazar.onclick = async () => {
      const obs = overlay.querySelector('#qcObservaciones').value.trim();
      const pe = _payloadEquipos();
      // Con revisión por equipo, el motivo ya está escrito en cada radio
      // denegado; exigir además un motivo de orden sería pedirlo dos veces.
      const hayMotivoPorEquipo = !!(pe && pe.denegados.length);
      if (!motivosSel.size && !obs && !hayMotivoPorEquipo) {
        Toast.show('Indique el motivo del rechazo (marque los equipos denegados, o use los chips/observaciones)', 'bad');
        return;
      }
      const detalle = pe && pe.denegados.length
        ? `<br><br>Equipos denegados: <b>${esc(pe.denegados.join(', '))}</b>.` : '';
      const detalleDesc = pe && pe.descartados.length
        ? `<br><br>Además se descartarán ${pe.descartados.length} equipo(s): <b>${esc(pe.descartados.join(', '))}</b> — quedarán registrados por serial con alerta al reingresarlos.`
        : '';
      const ok = await Modal.confirm({
        message: `¿Rechazar el QC de la orden ${ordenId}? Volverá al técnico${orden.tecnico_asignado ? ` (${orden.tecnico_asignado})` : ''} para corrección.${detalle}${detalleDesc}`,
        danger: true
      });
      if (!ok) return;
      btnRechazar.disabled = true;
      btnRechazar.textContent = 'Guardando…';
      try {
        const payload = {
          tipo,
          checklist: pe ? pe.checklist : { ...checklist },
          motivos: [...motivosSel],
          observaciones: obs,
          equipos: pe,
        };
        await OrdenesService.saveQcRechazado(ordenId, payload);
        const fallos = pe ? await _registrarDescartes(ordenId, orden, pe.por_equipo) : [];
        // Los radios APROBADOS dentro de un rechazo sí registran su condición:
        // ya no vuelven al técnico.
        const fallosCond = pe ? await _registrarCondiciones(ordenId, orden, pe.por_equipo) : [];
        await _notificarRechazo(ordenId, orden, payload);
        cleanup();
        if (fallos.length) {
          Toast.show(`Orden devuelta al técnico, pero NO se registró el descarte de ${fallos.join(', ')}. Regístrelo a mano en Inventario · Descartados.`, 'bad');
        } else if (fallosCond.length) {
          Toast.show(`Orden devuelta al técnico, pero NO se registró la condición de ${fallosCond.join(', ')}. Regístrala a mano desde la ficha del equipo.`, 'bad');
        } else {
          Toast.show('Orden devuelta al técnico con el motivo del rechazo', 'ok');
        }
      } catch (err) {
        console.error('[OrdenesQC] rechazar', err);
        Toast.show('❌ Error al guardar el rechazo: ' + err.message, 'bad');
        btnRechazar.disabled = false;
        btnRechazar.innerHTML = '<i data-lucide="x-circle"></i> Rechazar';
        APP.utils.lucideRefresh(btnRechazar);
      }
    };

    document.body.appendChild(overlay);
    // Pinta de una vez "Faltan N equipo(s) por resolver": sin esto el modal
    // abre mudo y no se ve por qué "Aprobar QC" está deshabilitado.
    if (!soloLectura) _refrescarEstado();
    APP.utils.lucideRefresh(overlay);
  }

  window.OrdenesQC = {
    abrir, qcTipoDe, qcRequerido, qcAprobado, qcCaducado, qcPendiente,
    puedeHacerQc, precargarRevisoresExtra,
    // Expuestos para functions/test/qcPorEquipo.test.js: el roll-up alimenta
    // una regla de Firestore que cuenta claves, y los checklists fijan ese
    // mínimo. Son el acoplamiento que el test congela.
    QC_CHECKLISTS, RESULTADOS_EQUIPO, _rollupChecklist,
  };
})();
