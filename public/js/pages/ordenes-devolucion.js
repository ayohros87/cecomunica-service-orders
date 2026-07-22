// @ts-nocheck
// Check-in de órdenes de DEVOLUCIÓN — el tiquete de recuperar equipos que
// siguen con el cliente (renovación/baja) o de confirmar una anulación
// (¿los equipos salieron del taller o nunca?). Cada unidad esperada se
// resuelve con una de tres acciones:
//   Recibido      → mini-checklist (accesorios entregados + daño visible) y
//                   el backend (onOrdenDevolucionWrite) la manda a cuarentena;
//                   cada tanda alimenta al instante la ENTRADA de inspección.
//   Nunca salió   → (solo modo confirmación) vuelve a bodega directo.
//   No se devuelve→ excepción justificada (motivo obligatorio).
// ACUSE FIRMADO (2026-07-21): el cliente firma por tanda lo que entregó tal
// como quedó registrado (accesorios/daño), ANTES de la revisión técnica —
// devolucion.acuses[]. El backend copia el primer acuse a la ENTRADA como su
// recepción en mostrador ("Ver recepción" en la orden del taller).
// SIN CONTRATO (2026-07-22): devoluciones de contratos de papel (fuera del
// sistema) se crean a mano con `nueva()` (modo 'sin_contrato', sin esperados)
// y los seriales se capturan libres en este mismo check-in — el backend los
// da de alta en el pool vía upsertContacto (crea el doc si no existe).
// Las resoluciones son definitivas (el pool se mueve al instante); un error
// se corrige desde Inventario · Equipos por serial.
(function () {
  'use strict';

  const MOTIVOS = [
    ['parcial', 'Renovación parcial — sigue en servicio'],
    ['vendido', 'Se vendió al cliente'],
    ['perdido', 'Perdido — pendiente de cobro'],
    ['otro',    'Otro (detallar)'],
  ];
  const RES_LABEL = {
    recibido: '<span class="chip-estado chip-aprobada">Recibido</span>',
    nunca_salio: '<span class="chip-estado chip-entregada">Nunca salió</span>',
    no_devuelve: '<span class="chip-estado chip-espera">No se devuelve</span>',
  };
  // Checklist del acuse: qué entregó el cliente con cada unidad. Espeja los
  // booleanos de accesorios del equipo en la orden de ENTRADA (agregar-equipo).
  const ACCESORIOS = [
    ['bateria', 'Batería'], ['antena', 'Antena'], ['clip', 'Clip'],
    ['cargador', 'Cargador'], ['fuente', 'Fuente'], ['cubrepolvo', 'Cubrepolvo'],
  ];
  const esc = (v) => window.FMT ? FMT.esc(String(v ?? '')) : String(v ?? '');

  let _orden = null;      // copia fresca del doc
  let _ordenId = null;
  let _overlay = null;
  let _recibiendoId = null; // esperado con el mini-checklist abierto
  let _draftModelo = null;  // check-in por modelo/libre pendiente de confirmar {idx|null, serial, modelo, modelo_id}
  let _firmaAcuse = null;   // API del canvas del acuse (clear/isEmpty)
  let _modelos = null;      // catálogo para el datalist de la captura libre (lazy)

  function puedeOperar() {
    const rol = window.APP?.state?.userRole || '';
    return [ROLES.ADMIN, ROLES.RECEPCION, ROLES.JEFE_TALLER, ROLES.VENDEDOR, ROLES.TECNICO].includes(rol);
  }

  async function abrir(ordenId) {
    _ordenId = ordenId;
    _recibiendoId = null;
    _draftModelo = null;
    try {
      _orden = await OrdenesService.getOrder(ordenId);
    } catch (e) { Toast.show('No se pudo cargar la orden.', 'bad'); return; }
    if (!_orden || !_orden.devolucion) { Toast.show('La orden no tiene datos de devolución.', 'bad'); return; }
    // Captura libre (sin contrato): datalist de modelos del catálogo, para
    // que la unidad nazca con modelo_id cuando el operador elige uno conocido.
    if (_orden.devolucion.modo === 'sin_contrato' && !_modelos) {
      try {
        _modelos = (typeof ModelosService !== 'undefined')
          ? (await ModelosService.getModelos())
              .map(m => ({ id: m.id, nombre: (m.modelo || m.nombre || '').trim() }))
              .filter(m => m.nombre)
              .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }))
          : [];
      } catch (e) { _modelos = []; }
    }
    render();
  }

  function cerrarModal() {
    _overlay?.remove();
    _overlay = null;
    // Refresca la fila en la lista si la página de órdenes está montada.
    if (typeof window.cargarOrdenes === 'function') { try { window.cargarOrdenes(true); } catch (e) {} }
  }

  // Canvas de firma autocontenido — mismo patrón DPR/táctil que el cierre de
  // visita (ordenes-visita.js): el modal se crea y destruye dinámicamente.
  function _wireFirmaCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr  = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 300;
    const cssH = canvas.clientHeight || 140;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    let drawing = false;
    const getPos = e => {
      const r = canvas.getBoundingClientRect();
      if (e.touches) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
      return { x: e.offsetX, y: e.offsetY };
    };
    const start = e => { drawing = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move  = e => { if (!drawing) return; const p = getPos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); };
    const end   = e => { drawing = false; e.preventDefault(); };
    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end,   { passive: false });

    return {
      clear() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      },
      isEmpty() {
        return !ctx.getImageData(0, 0, canvas.width, canvas.height).data.some(v => v !== 255);
      }
    };
  }

  // Mini-checklist al recibir: qué entregó el cliente con la unidad + daño
  // obvio a la vista. Es lo que después firma en el acuse — se registra
  // ANTES de la revisión técnica.
  function miniFormHtml(serial) {
    return `
      <div style="border:1px solid #bae6fd;background:#eff6ff;border-radius:8px;padding:8px;max-width:440px;">
        <div style="font-size:12px;font-weight:600;margin-bottom:6px;">¿Qué entregó el cliente con ${esc(serial)}?</div>
        <div style="display:flex;gap:4px 12px;flex-wrap:wrap;font-size:12px;">
          ${ACCESORIOS.map(([k, l]) => `<label style="display:flex;align-items:center;gap:4px;margin:0;"><input type="checkbox" class="dev-acc" data-acc="${k}"> ${l}</label>`).join('')}
        </div>
        <input class="form-input" id="devDano" placeholder="Daño obvio a la vista (opcional) — ej.: carcasa rajada" style="height:30px;font-size:12px;margin-top:6px;width:100%;">
        <div style="display:flex;gap:6px;margin-top:8px;">
          <button type="button" class="btn btn-sm" id="devRecibidoConfirm" style="background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;">✓ Confirmar recibido</button>
          <button type="button" class="btn btn-sm" id="devRecibidoCancel">Cancelar</button>
        </div>
      </div>`;
  }

  // Detalle bajo el chip "Recibido": lo que quedó registrado en el check-in
  // (base del acuse firmado) y si la firma sigue pendiente.
  function detalleRecibido(e, editable) {
    if (e.resolucion !== 'recibido') return '';
    const det = [];
    if (e.accesorios) {
      const con = ACCESORIOS.filter(([k]) => e.accesorios[k]).map(([, l]) => l);
      det.push(con.length ? `Entregó: ${con.join(', ')}` : 'Sin accesorios');
    }
    if (e.dano_visible) det.push(`Daño: ${esc(e.dano_visible)}`);
    if (!e.acuse_id && editable) det.push('<b style="color:#92400e;">acuse pendiente de firma</b>');
    return det.length ? `<div style="font-size:11px;color:var(--fg-3,#6b7280);">${det.join(' · ')}</div>` : '';
  }

  function render() {
    const dev = _orden.devolucion || {};
    const esperados = dev.esperados || [];
    const porModelo = dev.esperados_por_modelo || [];
    const acuses = dev.acuses || [];
    const cerrada = (_orden.estado_reparacion || '').toUpperCase() === 'CERRADA (DEVOLUCION)';
    const editable = !cerrada && puedeOperar();
    const esConfirmacion = dev.modo === 'confirmacion';
    const esSinContrato = dev.modo === 'sin_contrato';

    const pendientes = esperados.filter(e => !e.resolucion).length;
    const modelosPend = porModelo.reduce((s, m) => s + Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0)), 0);
    const sinAcuse = esperados.filter(e => e.resolucion === 'recibido' && !e.acuse_id);

    const intro = esConfirmacion
      ? 'Anulación de contrato: lo usual es que los equipos <b>nunca hayan salido</b>. Confirma unidad por unidad — <b>Nunca salió</b> los regresa a bodega directo; <b>Recibido</b> los manda a inspección.'
      : esSinContrato
      ? 'Devolución <b>sin contrato en el sistema</b> (contrato de papel). Registra cada unidad al recibirla — serial + modelo — con su checklist de accesorios/daño y el <b>acuse firmado</b> del cliente. Las unidades quedan trackeadas en Equipos por serial y alimentan la orden de ENTRADA del taller.'
      : 'Estos equipos están <b>con el cliente</b>. Marca <b>Recibido</b> cuando cada unidad llegue físicamente: registra accesorios y daño visible, y el cliente <b>firma el acuse</b> de lo entregado (antes de la revisión técnica). Cada tanda alimenta al instante la orden de ENTRADA del taller.';

    const filas = esperados.map(e => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);font-family:var(--font-mono,monospace);">${esc(e.serial)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${esc(e.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">
          ${e.resolucion
            ? (RES_LABEL[e.resolucion] || esc(e.resolucion))
              + (e.motivo_codigo ? `<div style="font-size:11px;color:var(--fg-3,#6b7280);">${esc((MOTIVOS.find(([v]) => v === e.motivo_codigo) || [,''])[1])}${e.motivo_detalle ? ': ' + esc(e.motivo_detalle) : ''}</div>` : '')
              + detalleRecibido(e, editable)
            : (editable ? (_recibiendoId === e.id ? miniFormHtml(e.serial) : `
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;">
                <button type="button" class="btn btn-sm dev-recibido" data-id="${esc(e.id)}" style="background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;">✓ Recibido</button>
                ${esConfirmacion ? `<button type="button" class="btn btn-sm dev-nunca" data-id="${esc(e.id)}">Nunca salió</button>` : ''}
                <select class="form-select dev-motivo" data-id="${esc(e.id)}" style="height:30px;font-size:12px;max-width:230px;">
                  <option value="">No se devuelve — motivo…</option>
                  ${MOTIVOS.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
                </select>
              </div>`)
            : '<span style="color:var(--fg-3,#6b7280);">pendiente</span>')}
        </td>
      </tr>`).join('');

    // Check-in por modelo pendiente de confirmar: fila extra con el mismo
    // mini-checklist (se escribe una sola vez, al confirmar).
    const filaDraft = _draftModelo ? `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);font-family:var(--font-mono,monospace);">${esc(_draftModelo.serial)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${esc(_draftModelo.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${miniFormHtml(_draftModelo.serial)}</td>
      </tr>` : '';

    // Captura libre (modo sin_contrato): la orden nace sin esperados — cada
    // serial se registra al llegar, con modelo del catálogo si se conoce.
    const bloqueCapturaLibre = (editable && esSinContrato && !_draftModelo) ? `
      <div style="margin-top:${esperados.length ? '12px' : '0'};border:1px dashed var(--border-subtle,#cbd5e1);border-radius:10px;padding:10px 12px;">
        <div style="font-weight:600;font-size:13px;margin-bottom:6px;">Registrar unidad recibida</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <input class="form-input" id="devSerialLibre" placeholder="Serial (tecléalo o escanéalo)" style="height:32px;font-size:12.5px;max-width:220px;" autocomplete="off">
          <input class="form-input" id="devModeloLibre" list="devModelosList" placeholder="Modelo" style="height:32px;font-size:12.5px;max-width:220px;" autocomplete="off">
          <datalist id="devModelosList">${(_modelos || []).map(m => `<option value="${esc(m.nombre)}"></option>`).join('')}</datalist>
          <button type="button" class="btn btn-sm dev-checkin-libre" style="height:32px;">Check-in</button>
        </div>
      </div>` : '';

    const filasModelo = porModelo.map((m, i) => {
      const falta = Math.max(0, Number(m.cantidad || 0) - Number(m.recibidos || 0));
      return `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">${esc(m.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);text-align:center;">${Number(m.recibidos || 0)} / ${Number(m.cantidad || 0)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle,#e5e7eb);">
          ${(editable && falta > 0) ? `
            <div style="display:flex;gap:6px;flex-wrap:wrap;">
              <input class="form-input dev-serial-modelo" data-idx="${i}" placeholder="Serial recibido (tecléalo o escanéalo)" style="height:30px;font-size:12px;max-width:220px;">
              <button type="button" class="btn btn-sm dev-checkin-modelo" data-idx="${i}">Check-in</button>
            </div>` : (falta === 0 ? '<span class="chip-estado chip-aprobada">completo</span>' : '')}
        </td>
      </tr>`;
    }).join('');

    // Acuse de recepción: el cliente firma lo registrado (accesorios/daño)
    // de las unidades recibidas que aún no tienen firma — una firma por
    // tanda, con la misma leyenda legal del descargo de ENTRADA.
    const bloqueAcuse = (editable && sinAcuse.length) ? `
      <div style="margin-top:16px;border:1px solid #fcd34d;background:#fffbeb;border-radius:10px;padding:12px 14px;">
        <div style="font-weight:700;font-size:13px;margin-bottom:4px;">Acuse de recepción — firma del cliente</div>
        <p style="margin:0 0 8px;font-size:12.5px;color:#78350f;">
          ${sinAcuse.length} unidad(es) recibida(s) por firmar: <b>${sinAcuse.map(e => esc(e.serial)).join(', ')}</b>.
          La firma deja constancia de los accesorios entregados y el daño visible registrados arriba.
        </p>
        <p style="margin:0 0 10px;font-size:11.5px;color:#92400e;background:#fef3c7;border-radius:6px;padding:6px 8px;">
          Los radios ingresarán al taller para su revisión. Cualquier daño identificado como causado por mal uso,
          así como los accesorios o equipos no devueltos, serán notificados oportunamente mediante cotización
          para su posterior facturación.
        </p>
        <div class="form-field" style="margin-bottom:8px;">
          <label class="form-label" for="acuseNombre">Nombre de quien entrega</label>
          <input class="form-input" id="acuseNombre" placeholder="Nombre y apellido" autocomplete="off" style="height:32px;">
        </div>
        <div id="acuseFirmaWrap">
          <label class="form-label">Firma</label>
          <canvas id="acuseFirmaCanvas" style="width:100%;height:140px;border:1px dashed var(--line,#cbd5e1);border-radius:8px;background:#fff;touch-action:none;"></canvas>
          <button type="button" class="btn btn-ghost btn-sm" id="acuseLimpiarFirma" style="margin-top:2px;padding:3px 8px;font-size:12px;">Limpiar firma</button>
        </div>
        <label class="form-check" style="margin-top:6px;display:flex;align-items:center;gap:8px;font-size:12.5px;">
          <input type="checkbox" id="acuseSinFirma"> <span>Registrar sin firma del cliente</span>
        </label>
        <div class="form-field hidden" id="acuseSinFirmaBloque" style="margin-top:6px;">
          <label class="form-label" for="acuseSinFirmaMotivo">Motivo (obligatorio)</label>
          <input class="form-input" id="acuseSinFirmaMotivo" style="height:32px;" placeholder="Ej.: equipos recogidos por el técnico en sitio">
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="acuseGuardarBtn" style="margin-top:10px;"><i data-lucide="pen-line"></i> Guardar acuse</button>
      </div>` : '';

    const listaAcuses = acuses.length ? `
      <div style="margin-top:12px;font-size:12.5px;">
        <div style="font-weight:600;margin-bottom:4px;">Acuses de recepción firmados</div>
        ${acuses.map(a => `
          <div style="display:flex;gap:8px;flex-wrap:wrap;color:var(--fg-2,#374151);padding:2px 0;">
            <span>${esc(a.nombre_entrega || (a.sin_firma ? 'Sin firma' : '—'))}</span>
            <span style="color:var(--fg-3,#6b7280);">· ${(a.seriales || []).length} unidad(es)</span>
            <span style="color:var(--fg-3,#6b7280);">· ${a.at?.toDate ? a.at.toDate().toLocaleString('es-PA', { hour12: false }) : ''}</span>
            ${a.firma_url
              ? `<a href="${esc(a.firma_url)}" target="_blank" rel="noopener">ver firma</a>`
              : (a.sin_firma ? `<span style="color:#92400e;">sin firma: ${esc(a.sin_firma_motivo || '')}</span>` : '')}
          </div>`).join('')}
      </div>` : '';

    const html = `
      <div class="modal" style="max-width:720px;max-height:88vh;display:flex;flex-direction:column;">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <div>
            <div style="font-weight:700;">Devolución de equipos — orden ${esc(_ordenId)}</div>
            <div style="font-size:12.5px;color:var(--fg-3,#6b7280);">${esc(_orden.cliente_nombre || '')} · ${esc(_orden.contrato?.contrato_id || '')} ${cerrada ? '· <b>CERRADA</b>' : ''}</div>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" id="devCerrarModal"><i data-lucide="x"></i></button>
        </div>
        <div style="padding:14px 18px;overflow:auto;flex:1;">
          <p style="margin:0 0 12px;font-size:13px;color:var(--fg-2,#374151);">${intro}</p>
          ${(esperados.length || _draftModelo) ? `
          <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
              <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);font-size:12px;">
                <th style="padding:6px 8px;">Serial</th><th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;">Resolución</th>
              </tr></thead>
              <tbody>${filas}${filaDraft}</tbody>
            </table>
          </div>` : ''}
          ${bloqueCapturaLibre}
          ${porModelo.length ? `
          <div style="margin-top:${(esperados.length || _draftModelo) ? '14px' : '0'};">
            <div style="font-weight:600;font-size:13px;margin-bottom:6px;">Por modelo (la baja no registró seriales — se capturan al llegar)</div>
            <div style="overflow-x:auto;">
              <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
                <thead><tr style="text-align:left;color:var(--fg-3,#6b7280);font-size:12px;">
                  <th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;text-align:center;">Recibidos</th><th style="padding:6px 8px;">Check-in</th>
                </tr></thead>
                <tbody>${filasModelo}</tbody>
              </table>
            </div>
          </div>` : ''}
          ${bloqueAcuse}
          ${listaAcuses}
        </div>
        <div class="sheet-footer" style="display:flex;justify-content:space-between;gap:8px;padding:12px 18px;border-top:1px solid var(--border-subtle,#e5e7eb);">
          <span style="font-size:12px;color:var(--fg-3,#6b7280);align-self:center;">${cerrada ? 'Orden cerrada.' : `${pendientes + modelosPend} unidad(es) sin resolver${sinAcuse.length ? ` · ${sinAcuse.length} sin acuse firmado` : ''}`}</span>
          ${(!cerrada && puedeOperar()) ? `<button type="button" class="btn btn-primary" id="devCerrarOrden" ${pendientes + modelosPend > 0 ? 'disabled title="Resuelve todas las unidades para cerrar"' : ''}><i data-lucide="check"></i> Cerrar devolución</button>` : ''}
        </div>
      </div>`;

    if (!_overlay) {
      _overlay = document.createElement('div');
      _overlay.className = 'overlay';
      _overlay.style.display = 'flex';
      document.body.appendChild(_overlay);
      _overlay.addEventListener('click', (ev) => { if (ev.target === _overlay) cerrarModal(); });
    }
    _overlay.innerHTML = html;
    if (window.lucide) lucide.createIcons();

    _overlay.querySelector('#devCerrarModal')?.addEventListener('click', cerrarModal);
    _overlay.querySelector('#devCerrarOrden')?.addEventListener('click', cerrarOrden);
    // "✓ Recibido" abre el mini-checklist; la escritura ocurre al confirmar.
    _overlay.querySelectorAll('.dev-recibido').forEach(b => b.addEventListener('click', () => {
      _recibiendoId = b.dataset.id;
      _draftModelo = null;
      render();
    }));
    _overlay.querySelector('#devRecibidoConfirm')?.addEventListener('click', confirmarRecibido);
    _overlay.querySelector('#devRecibidoCancel')?.addEventListener('click', () => {
      _recibiendoId = null; _draftModelo = null; render();
    });
    _overlay.querySelectorAll('.dev-nunca').forEach(b => b.addEventListener('click', () => resolver(b.dataset.id, 'nunca_salio')));
    _overlay.querySelectorAll('.dev-motivo').forEach(sel => sel.addEventListener('change', async () => {
      if (!sel.value) return;
      let detalle = '';
      if (sel.value === 'otro') {
        detalle = (window.Modal?.prompt
          ? await Modal.prompt({ title: 'Motivo de la excepción', message: 'Detalla por qué esta unidad no se devuelve.' })
          : window.prompt('Detalla por qué esta unidad no se devuelve:')) || '';
        if (!detalle.trim()) { sel.value = ''; return; }
      }
      resolver(sel.dataset.id, 'no_devuelve', sel.value, detalle.trim());
    }));
    _overlay.querySelectorAll('.dev-checkin-modelo').forEach(b => b.addEventListener('click', () => checkinPorModelo(Number(b.dataset.idx))));
    _overlay.querySelectorAll('.dev-checkin-libre').forEach(b => b.addEventListener('click', checkinLibre));
    // Enter en el serial libre = Check-in (flujo de escáner de código de barras).
    _overlay.querySelector('#devSerialLibre')?.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); checkinLibre(); }
    });

    // Bloque de acuse: canvas + toggle sin-firma + guardar.
    const cbSin = _overlay.querySelector('#acuseSinFirma');
    if (cbSin) cbSin.addEventListener('change', () => {
      _overlay.querySelector('#acuseSinFirmaBloque')?.classList.toggle('hidden', !cbSin.checked);
      _overlay.querySelector('#acuseFirmaWrap')?.classList.toggle('hidden', cbSin.checked);
    });
    _overlay.querySelector('#acuseLimpiarFirma')?.addEventListener('click', () => _firmaAcuse?.clear());
    _overlay.querySelector('#acuseGuardarBtn')?.addEventListener('click', guardarAcuse);
    _firmaAcuse = null;
    const cv = _overlay.querySelector('#acuseFirmaCanvas');
    // El canvas necesita clientWidth real → esperar al layout.
    if (cv) requestAnimationFrame(() => { _firmaAcuse = _wireFirmaCanvas(cv); });
  }

  async function _guardarDevolucion(log) {
    const user = firebase.auth().currentUser;
    await OrdenesService.mergeOrder(_ordenId, {
      devolucion: _orden.devolucion,
      os_logs: firebase.firestore.FieldValue.arrayUnion({ action: log, by: user?.uid || '' }),
    });
  }

  // Confirmación del mini-checklist: única escritura del "recibido" (unidad
  // esperada o check-in por modelo), con accesorios y daño incluidos.
  async function confirmarRecibido() {
    const dev = _orden.devolucion;
    const user = firebase.auth().currentUser;
    const accesorios = {};
    _overlay.querySelectorAll('.dev-acc').forEach(cb => { accesorios[cb.dataset.acc] = !!cb.checked; });
    const dano = (_overlay.querySelector('#devDano')?.value || '').trim();

    if (_draftModelo) {
      const m = (dev.esperados_por_modelo || [])[_draftModelo.idx];
      const nuevo = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
        serial: _draftModelo.serial,
        modelo: _draftModelo.modelo || '',
        modelo_id: _draftModelo.modelo_id || null,
        pool_doc_id: null, // el backend resuelve por serial
        resolucion: 'recibido',
        accesorios,
        dano_visible: dano || null,
        motivo_codigo: null, motivo_detalle: null,
        resuelto_at: firebase.firestore.Timestamp.now(),
        resuelto_por: user?.uid || null,
      };
      dev.esperados = dev.esperados || [];
      dev.esperados.push(nuevo);
      if (m) m.recibidos = Number(m.recibidos || 0) + 1;
      try {
        await _guardarDevolucion('DEVOLUCION_CHECKIN');
        Toast.show(`${nuevo.serial}: recibido.`, 'ok');
        _draftModelo = null;
      } catch (err) {
        console.error(err);
        dev.esperados.pop();
        if (m) m.recibidos = Number(m.recibidos || 0) - 1;
        Toast.show('No se pudo registrar el check-in.', 'bad');
      }
      render();
      return;
    }

    const e = (dev.esperados || []).find(x => x.id === _recibiendoId);
    _recibiendoId = null;
    if (!e || e.resolucion) { render(); return; }
    e.resolucion = 'recibido';
    e.accesorios = accesorios;
    e.dano_visible = dano || null;
    e.motivo_codigo = null;
    e.motivo_detalle = null;
    e.resuelto_at = firebase.firestore.Timestamp.now();
    e.resuelto_por = user?.uid || null;
    try {
      await _guardarDevolucion('DEVOLUCION_CHECKIN');
      Toast.show(`${e.serial}: recibido.`, 'ok');
    } catch (err) {
      console.error(err);
      e.resolucion = null; e.accesorios = null; e.dano_visible = null; e.resuelto_at = null; e.resuelto_por = null;
      Toast.show('No se pudo registrar el check-in.', 'bad');
    }
    render();
  }

  // nunca_salio / no_devuelve — sin checklist (no entra nada al taller).
  async function resolver(esperadoId, resolucion, motivoCodigo, motivoDetalle) {
    const e = (_orden.devolucion.esperados || []).find(x => x.id === esperadoId);
    if (!e || e.resolucion) return;
    const labels = { nunca_salio: 'NUNCA SALIÓ del taller', no_devuelve: 'NO SE DEVUELVE' };
    if (!window.confirm(`${e.serial} → ${labels[resolucion]}. Esta acción mueve el equipo en el inventario y no se deshace desde aquí. ¿Confirmar?`)) { render(); return; }
    const user = firebase.auth().currentUser;
    e.resolucion = resolucion;
    e.motivo_codigo = motivoCodigo || null;
    e.motivo_detalle = motivoDetalle || null;
    e.resuelto_at = firebase.firestore.Timestamp.now();
    e.resuelto_por = user?.uid || null;
    try {
      await _guardarDevolucion('DEVOLUCION_CHECKIN');
      Toast.show(`${e.serial}: ${labels[resolucion].toLowerCase()}.`, 'ok');
    } catch (err) {
      console.error(err);
      e.resolucion = null; e.motivo_codigo = null; e.motivo_detalle = null; e.resuelto_at = null; e.resuelto_por = null;
      Toast.show('No se pudo registrar el check-in.', 'bad');
    }
    render();
  }

  function checkinPorModelo(idx) {
    const m = (_orden.devolucion.esperados_por_modelo || [])[idx];
    const input = _overlay.querySelector(`.dev-serial-modelo[data-idx="${idx}"]`);
    const serial = (input?.value || '').trim().toUpperCase();
    if (!m || !serial) { Toast.show('Escribe o escanea el serial recibido.', 'warn'); return; }
    if ((_orden.devolucion.esperados || []).some(e => (e.serial || '').toUpperCase() === serial)) {
      Toast.show('Ese serial ya está registrado en esta orden.', 'warn'); return;
    }
    // El registro se escribe al confirmar el mini-checklist (una sola
    // escritura con accesorios + daño incluidos).
    _draftModelo = { idx, serial, modelo: m.modelo || '', modelo_id: m.modelo_id || null };
    _recibiendoId = null;
    render();
  }

  // Captura libre (modo sin_contrato): serial + modelo sin lista previa de
  // esperados. Si el modelo coincide con el catálogo, la unidad viaja con
  // modelo_id (mejor identidad en el pool); texto libre también vale.
  function checkinLibre() {
    const serial = (_overlay.querySelector('#devSerialLibre')?.value || '').trim().toUpperCase();
    const modeloTxt = (_overlay.querySelector('#devModeloLibre')?.value || '').trim();
    if (!serial) { Toast.show('Escribe o escanea el serial recibido.', 'warn'); return; }
    if ((_orden.devolucion.esperados || []).some(e => (e.serial || '').toUpperCase() === serial)) {
      Toast.show('Ese serial ya está registrado en esta orden.', 'warn'); return;
    }
    const cat = (_modelos || []).find(m => m.nombre.toLowerCase() === modeloTxt.toLowerCase());
    _draftModelo = { idx: null, serial, modelo: cat ? cat.nombre : modeloTxt, modelo_id: cat ? cat.id : null };
    _recibiendoId = null;
    render();
  }

  // Acuse por tanda: sube la firma, agrega devolucion.acuses[] y estampa
  // acuse_id en cada unidad cubierta. El backend copia el primer acuse a la
  // ENTRADA (recepción en mostrador).
  async function guardarAcuse() {
    const dev = _orden.devolucion;
    const pendientes = (dev.esperados || []).filter(e => e.resolucion === 'recibido' && !e.acuse_id);
    if (!pendientes.length) return;

    const sin = !!_overlay.querySelector('#acuseSinFirma')?.checked;
    const nombre = (_overlay.querySelector('#acuseNombre')?.value || '').trim();
    const motivo = (_overlay.querySelector('#acuseSinFirmaMotivo')?.value || '').trim();
    if (sin) {
      if (!motivo) { Toast.show('Indica el motivo para registrar sin firma.', 'bad'); return; }
    } else {
      if (!nombre) { Toast.show('Ingresa el nombre de quien entrega.', 'bad'); return; }
      if (!_firmaAcuse || _firmaAcuse.isEmpty()) { Toast.show('La firma es obligatoria (o marca "Registrar sin firma").', 'bad'); return; }
    }

    const btn = _overlay.querySelector('#acuseGuardarBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }
    const user = firebase.auth().currentUser;
    try {
      let firmaUrl = null;
      if (!sin) {
        const canvas = _overlay.querySelector('#acuseFirmaCanvas');
        const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
        const path = `ordenes_firmas/${_ordenId}_acuse_${Date.now()}.png`;
        const ref = firebase.storage().ref(path);
        await ref.put(blob, { contentType: 'image/png' });
        firmaUrl = await ref.getDownloadURL();
      }
      const acuse = {
        id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
        at: firebase.firestore.Timestamp.now(),
        por_uid: user?.uid || null,
        nombre_entrega: sin ? null : nombre,
        firma_url: firmaUrl,
        sin_firma: sin,
        sin_firma_motivo: sin ? motivo : null,
        seriales: pendientes.map(e => e.serial),
        unidades: pendientes.map(e => ({
          serial: e.serial,
          accesorios: e.accesorios || null,
          dano_visible: e.dano_visible || null,
        })),
      };
      dev.acuses = [...(dev.acuses || []), acuse];
      pendientes.forEach(e => { e.acuse_id = acuse.id; });
      try {
        await _guardarDevolucion('DEVOLUCION_ACUSE');
        Toast.show('Acuse de recepción guardado.', 'ok');
      } catch (err) {
        dev.acuses = dev.acuses.filter(a => a.id !== acuse.id);
        pendientes.forEach(e => { delete e.acuse_id; });
        throw err;
      }
    } catch (err) {
      console.error(err);
      Toast.show('No se pudo guardar el acuse.', 'bad');
    }
    render();
  }

  async function cerrarOrden() {
    const sinAcuse = (_orden.devolucion.esperados || []).filter(e => e.resolucion === 'recibido' && !e.acuse_id).length;
    const aviso = sinAcuse ? `\n\nOJO: ${sinAcuse} unidad(es) recibida(s) quedan SIN acuse firmado del cliente.` : '';
    if (!window.confirm('¿Cerrar la devolución? Todas las unidades quedaron resueltas; los equipos recibidos ya están (o quedarán) en la orden de ENTRADA de inspección.' + aviso)) return;
    const user = firebase.auth().currentUser;
    try {
      await OrdenesService.mergeOrder(_ordenId, {
        estado_reparacion: 'CERRADA (DEVOLUCION)',
        fecha_completado: firebase.firestore.FieldValue.serverTimestamp(),
        completado_por_uid: user?.uid || null,
        os_logs: firebase.firestore.FieldValue.arrayUnion({ action: 'CERRAR_DEVOLUCION', by: user?.uid || '' }),
      });
      _orden.estado_reparacion = 'CERRADA (DEVOLUCION)';
      Toast.show('Devolución cerrada.', 'ok');
      render();
    } catch (e) {
      console.error(e);
      Toast.show('No se pudo cerrar la devolución.', 'bad');
    }
  }

  // ── Nueva devolución SIN CONTRATO (contrato de papel) ────────────────
  // Para equipos alquilados con contratos fuera del sistema: crea la orden
  // de DEVOLUCION en modo 'sin_contrato' (sin esperados) y abre el check-in,
  // donde los seriales se capturan libres y quedan trackeados en el pool.
  const ROLES_NUEVA = () => [ROLES.ADMIN, ROLES.RECEPCION, ROLES.JEFE_TALLER, ROLES.VENDEDOR];

  // Consecutivo AAAAMMDDNN — misma convención que nueva-orden.js y el backend
  // (_siguienteOrdenId): transacción create-if-missing con reintentos por si
  // hay carrera con otra creación simultánea.
  async function _crearDocOrden(data) {
    const db = firebase.firestore();
    const col = db.collection('ordenes_de_servicio');
    const hoy = new Date();
    const fechaBase = `${hoy.getFullYear()}${String(hoy.getMonth() + 1).padStart(2, '0')}${String(hoy.getDate()).padStart(2, '0')}`;
    const snap = await col
      .where(firebase.firestore.FieldPath.documentId(), '>=', `${fechaBase}00`)
      .where(firebase.firestore.FieldPath.documentId(), '<=', `${fechaBase}99`)
      .get();
    const usados = snap.docs.map(d => parseInt(d.id.slice(-2), 10)).filter(n => !Number.isNaN(n));
    const siguiente = usados.length ? Math.max(...usados) + 1 : 1;
    for (let i = 0; i < 5; i++) {
      const candidato = `${fechaBase}${String(siguiente + i).padStart(2, '0')}`;
      const ganado = await db.runTransaction(async (tx) => {
        const s = await tx.get(col.doc(candidato));
        if (s.exists) return null;
        tx.set(col.doc(candidato), data);
        return candidato;
      });
      if (ganado) return ganado;
    }
    throw new Error('No se pudo reservar un número de orden — reintenta.');
  }

  async function nueva() {
    if (!ROLES_NUEVA().includes(window.APP?.state?.userRole || '')) {
      Toast.show('Tu rol no puede registrar devoluciones.', 'bad');
      return;
    }

    // Autocompletado de clientes (best-effort): texto libre también vale —
    // el cliente de un contrato de papel puede no existir en el sistema.
    let clientes = [];
    try { clientes = [...(await ClientesService.loadClientes()).values()]; } catch (e) { /* datalist vacío */ }
    const nombres = clientes
      .map(c => (c.nombre || '').trim()).filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9400';
    overlay.innerHTML = `
      <div class="modal" style="max-width:520px;width:min(94vw,520px);">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="package-open"></i> Devolución sin contrato</h3>
          <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:12px 14px;">
          <p style="margin:0 0 10px;font-size:13px;color:var(--fg-2,#374151);">
            Para equipos alquilados con <b>contrato de papel</b> (fuera del sistema). Se crea el
            tiquete de devolución y los seriales se registran al recibirlos, con checklist de
            accesorios/daño y acuse firmado — las unidades quedan trackeadas en Equipos por serial.
          </p>
          <div class="form-field" style="margin-bottom:8px;">
            <label class="form-label" for="devNuevaCliente">Cliente <span class="req">*</span></label>
            <input class="form-input" id="devNuevaCliente" list="devNuevaClientesList" placeholder="Nombre del cliente (elige o escribe)" autocomplete="off">
            <datalist id="devNuevaClientesList">${nombres.map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
          </div>
          <div class="form-field" style="margin-bottom:8px;">
            <label class="form-label" for="devNuevaRef">Referencia del contrato de papel</label>
            <input class="form-input" id="devNuevaRef" placeholder="Ej.: contrato físico #123 / carpeta 2019" autocomplete="off">
          </div>
          <div class="form-field">
            <label class="form-label" for="devNuevaObs">Observaciones (opcional)</label>
            <textarea class="form-input form-textarea" id="devNuevaObs" rows="2" placeholder="Ej.: cliente pasa a dejar 4 radios por fin de alquiler"></textarea>
          </div>
        </div>
        <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
          <button class="btn btn-secondary" data-close="1">Cancelar</button>
          <button class="btn btn-primary" id="devNuevaCrearBtn"><i data-lucide="plus"></i> Crear devolución</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(overlay);
    const cleanup = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) cleanup();
    });

    const btn = overlay.querySelector('#devNuevaCrearBtn');
    btn.onclick = async () => {
      const nombre = (overlay.querySelector('#devNuevaCliente')?.value || '').trim();
      const refPapel = (overlay.querySelector('#devNuevaRef')?.value || '').trim();
      const obs = (overlay.querySelector('#devNuevaObs')?.value || '').trim();
      if (!nombre) { Toast.show('Ingresa el nombre del cliente.', 'bad'); return; }
      const match = clientes.find(c => (c.nombre || '').trim().toLowerCase() === nombre.toLowerCase());
      const user = firebase.auth().currentUser;

      btn.disabled = true;
      btn.textContent = 'Creando…';
      try {
        const data = {
          cliente_id: match?.id || '',
          cliente_nombre: nombre,
          vendedor_asignado: '',
          tipo_de_servicio: 'DEVOLUCION',
          estado_reparacion: 'POR ASIGNAR',
          fecha_creacion: firebase.firestore.FieldValue.serverTimestamp(),
          observaciones: [`Devolución sin contrato en el sistema${refPapel ? ` — ${refPapel}` : ''}.`, obs].filter(Boolean).join(' '),
          // Sin `equipos[]` a propósito (mismo criterio que ordenDevolucion.js
          // del backend): las unidades entran al capturarse en el check-in.
          devolucion: {
            modo: 'sin_contrato',
            origen: { tipo: 'contrato_papel', ref_id: null, ref_papel: refPapel || null },
            esperados: [],
            esperados_por_modelo: [],
          },
          contrato: {
            aplica: false,
            contrato_doc_id: null,
            contrato_id: refPapel || null,
            motivo_no_aplica: 'Contrato de papel (fuera del sistema)',
          },
          creado_por_uid: user?.uid || '',
          creado_por_email: user?.email || null,
          eliminado: false,
          os_logs: [{ action: 'CREAR', by: user?.uid || '' }],
        };
        const ordenId = await _crearDocOrden(data);
        cleanup();
        Toast.show(`Devolución ${ordenId} creada — registra los seriales al recibirlos.`, 'ok');
        abrir(ordenId); // directo al check-in, con el cliente en el mostrador
      } catch (err) {
        console.error('[OrdenesDevolucion.nueva]', err);
        Toast.show('No se pudo crear la devolución: ' + err.message, 'bad');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="plus"></i> Crear devolución';
        if (window.APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(btn);
      }
    };
  }

  window.OrdenesDevolucion = { abrir, nueva };
})();
