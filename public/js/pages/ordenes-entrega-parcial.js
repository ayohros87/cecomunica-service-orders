// @ts-nocheck
/* ========================================
 * ORDENES ENTREGA PARCIAL — el cliente se lleva solo una parte
 *
 * Pedido 2026-09-09: una reparación de 10 radios no puede esperar a que los
 * 10 estén listos (o a que el cliente tenga cómo llevárselos todos). Esta
 * hoja registra una TANDA: quién recibe, su firma, y qué radios salen hoy.
 * El resto se queda en el taller y la orden sigue viva.
 *
 * LO QUE ESTA HOJA NO HACE — a propósito:
 *   · No cambia `estado_reparacion`. La orden sigue COMPLETADO (EN OFICINA).
 *   · No entrega lo último. Si marcas todo lo que queda, te manda al botón
 *     "Entregar" de siempre: ese es el ÚNICO camino que cierra una orden
 *     (y el que dispara pool, contrato y correo de nota de entrega).
 *
 * Los candados (QC, contrato firmado, anexo firmado, factura de venta) los
 * corre `puedeEntregar()` en ordenes-flujo.js ANTES de abrir esta hoja — los
 * mismos que el botón normal, sin copia.
 *
 * Módulo diferido: lo carga CargaDiferida.entregaParcial() al primer uso.
 * ======================================== */

(function () {
  'use strict';

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  const plural = (n, sing, plur) => `${n} ${n === 1 ? sing : plur}`;

  function filaEquipo(e) {
    const serial = e.numero_de_serie || e.serial || '—';
    const clave = EntregaTandas.claveEquipo(e);
    // Un equipo marcado "no disponible" no se intervino: casi nunca es lo que
    // el cliente viene a recoger, así que se avisa en vez de esconderlo.
    const aviso = e.intervencion_no_disponible
      ? '<span class="chip chip-warn" style="font-size:11px;">sin intervenir</span>' : '';
    return `
      <label class="ep-fila" style="display:flex;align-items:center;gap:10px;padding:7px 9px;border-bottom:1px solid var(--border-subtle,#EEF2F6);cursor:pointer;">
        <input type="checkbox" class="ep-check" value="${esc(clave)}">
        <span style="font-family:var(--font-mono,monospace);font-size:13px;min-width:120px;">${esc(serial)}</span>
        <span style="font-size:13px;color:var(--fg-2);flex:1;">${esc(e.modelo || '—')}</span>
        ${aviso}
      </label>`;
  }

  // Historial de tandas ya entregadas — el operador tiene que poder ver qué
  // se llevaron antes sin salir de la hoja (la pregunta del mostrador es
  // siempre "¿y qué me falta?").
  const numeroDe = (ordenId, t) => t.numero || `${ordenId}-E${t.n || '?'}`;

  const fechaLarga = (ts) => {
    const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
    return d ? d.toLocaleString('es-PA', {
      day: 'numeric', month: 'long', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }) : '';
  };

  // Estado REAL del correo, no "se pidió el envío": lo espeja onMailQueued
  // desde el resultado del SMTP. Misma paleta que el chip del acuse.
  function chipEnvio(envio) {
    const st = envio?.status || 'sin_enviar';
    if (st === 'enviado') {
      return `<span class="chip-estado" style="background:#e9f7f0;color:#067647;" title="Copia enviada a ${esc(envio.to || '')}">✓ Enviada al cliente</span>`;
    }
    if (st === 'solicitado' || st === 'encolado') {
      return `<span class="chip-estado" style="background:#eef2ff;color:#4338ca;" title="En cola de envío${envio?.to ? ` hacia ${esc(envio.to)}` : ''}">Enviando…</span>`;
    }
    if (st === 'fallo') {
      return `<span class="chip-estado" style="background:#fee2e2;color:#b91c1c;" title="${esc(envio?.error || 'El envío falló')}">⚠ Falló el envío</span>`;
    }
    return '';
  }

  // Tarjeta de una tanda ya entregada. Vive en DOS sitios a propósito: en esta
  // hoja (mientras quedan equipos) y en "Ver entrega" (para siempre). Sin lo
  // segundo, al cerrarse la orden las notas parciales se volverían
  // irrecuperables — y son justo el papel que el cliente puede venir a pedir.
  function tarjetaTanda(ordenId, t) {
    const numero = numeroDe(ordenId, t);
    const seriales = (t.equipos || []).map(x => x.serial || '—').join(', ');
    const st = t.envio?.status;
    const enCamino = st === 'solicitado' || st === 'encolado';
    return `
      <div class="ep-tanda" data-numero="${esc(numero)}"
           style="border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px;background:var(--surface-2,#F8FAFC);">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:12.5px;">
          <b style="font-family:var(--font-mono,monospace);">${esc(numero)}</b>
          <span style="color:var(--fg-3);">${esc(fechaLarga(t.fecha))}</span>
          <span style="color:var(--fg-2);">· ${esc(t.receptor_nombre || '—')}</span>
          <span class="ep-chip-envio">${chipEnvio(t.envio)}</span>
        </div>
        <div style="font-family:var(--font-mono,monospace);font-size:12px;color:var(--fg-2);margin:3px 0 6px;">${esc(seriales)}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary ep-doc" data-numero="${esc(numero)}"
                  style="height:26px;font-size:12px;" title="Abre la nota en una pestaña nueva, lista para imprimir">Ver / Imprimir</button>
          <button type="button" class="btn btn-secondary ep-enviar" data-numero="${esc(numero)}"
                  style="height:26px;font-size:12px;"${enCamino ? ' disabled' : ''}>${st === 'enviado' || st === 'fallo' ? 'Reenviar al cliente' : 'Enviar al cliente'}</button>
        </div>
      </div>`;
  }

  function bloqueTandas(orden) {
    const previas = EntregaTandas.tandas(orden);
    if (!previas.length) return '';
    return `
      <div style="margin-bottom:12px;">
        <div style="font-size:12px;font-weight:600;color:var(--fg-2);margin-bottom:4px;">Ya entregado</div>
        ${previas.map(t => tarjetaTanda(orden.ordenId, t)).join('')}
      </div>`;
  }

  // ── Documento imprimible de la tanda ──────────────────────────────────
  // Se renderiza en el navegador, en una pestaña nueva lista para Ctrl+P —
  // sin PDF ni servidor, igual que el acuse de devolución. El CONTENIDO
  // espeja el correo que arma functions/src/lib/notaTandaEntrega.js: si
  // cambias columnas o la leyenda aquí, cámbialas también allá.
  const LEYENDA_TANDA =
    'Esta nota deja constancia de la entrega de los equipos listados arriba. ' +
    'Los equipos que aún no se retiran permanecen en nuestro taller bajo la ' +
    'misma orden de servicio, que sigue abierta hasta que se entregue el ' +
    'último. La entrega de cada tanda se documenta por separado.';

  function _docNotaTandaHtml(orden, t) {
    const ordenId = orden.ordenId;
    const numero = numeroDe(ordenId, t);
    const fecha = fechaLarga(t.fecha);
    const equipos = t.equipos || [];
    // Lo que queda DESPUÉS de esta tanda. La nota sin esto contesta media
    // pregunta: el cliente se va sabiendo qué se llevó pero no qué le falta.
    const previas = EntregaTandas.tandas(orden);
    const corte = previas.indexOf(t);
    const fuera = new Set();
    for (const p of (corte >= 0 ? previas.slice(0, corte + 1) : previas)) {
      for (const u of (p.equipos || [])) {
        if (u?.id) fuera.add(String(u.id));
        const s = String(u?.serial || '').trim().toUpperCase();
        if (s) fuera.add('s:' + s);
      }
    }
    const quedan = EntregaTandas.equiposActivos(orden).filter(e => {
      if (e.id && fuera.has(String(e.id))) return false;
      const s = String(e.numero_de_serie || e.serial || '').trim().toUpperCase();
      return !(s && fuera.has('s:' + s));
    });

    const filas = equipos.map(u => `
      <tr><td class="mono">${esc(u.serial || '—')}</td><td>${esc(u.modelo || '—')}</td></tr>`).join('');
    const filasPend = quedan.map(e => `
      <tr><td class="mono">${esc(e.numero_de_serie || e.serial || '—')}</td><td>${esc(e.modelo || '—')}</td></tr>`).join('');

    return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
      <title>Nota de entrega ${esc(numero)}</title>
      <style>
        * { box-sizing: border-box; margin: 0; }
        body { background: #e8e6e0; font: 14px/1.55 'Source Serif 4', Georgia, 'Times New Roman', serif; color: #26221C; }
        .toolbar { display: flex; gap: 10px; align-items: center; justify-content: flex-end; max-width: 780px; margin: 0 auto; padding: 12px 16px 0; font-family: 'Segoe UI', Arial, sans-serif; }
        .toolbar button { font: 600 13.5px 'Segoe UI', Arial, sans-serif; border: 0; border-radius: 8px; cursor: pointer; padding: 9px 16px; background: #0B2A47; color: #fff; }
        .hoja { background: #FDFCF8; max-width: 780px; margin: 12px auto 40px; padding: 44px 52px; box-shadow: 0 8px 30px rgba(20,20,30,.18); }
        .memb { display: flex; justify-content: space-between; gap: 20px; align-items: flex-start; border-bottom: 2px solid #26221C; padding-bottom: 14px; flex-wrap: wrap; }
        .memb img { height: 42px; }
        .memb .datos-emp { font: 10.5px/1.5 'Segoe UI', Arial, sans-serif; color: #5C554A; margin-top: 4px; }
        .docnum { text-align: right; font-size: 12.5px; color: #5C554A; }
        .docnum b { display: block; font-family: Consolas, monospace; font-size: 14px; color: #26221C; }
        h1 { font-size: 18px; text-align: center; margin: 26px 0 4px; letter-spacing: .02em; }
        .subt { text-align: center; font-size: 12.5px; color: #5C554A; margin-bottom: 22px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 28px; font-size: 13px; margin-bottom: 20px; }
        .grid .lbl { display: block; font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .08em; text-transform: uppercase; color: #5C554A; }
        h2 { font: 600 13px 'Segoe UI', Arial, sans-serif; letter-spacing: .04em; text-transform: uppercase; color: #5C554A; margin: 20px 0 6px; }
        table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        th { font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .07em; text-transform: uppercase; color: #5C554A; text-align: left; padding: 6px 10px; border-bottom: 1.5px solid #26221C; }
        td { padding: 8px 10px; border-bottom: 1px solid #E4DFD2; vertical-align: top; }
        td.mono { font-family: Consolas, monospace; font-size: 12px; white-space: nowrap; }
        .legal { font-size: 11.5px; color: #5C554A; border-left: 2px solid #E4DFD2; padding-left: 14px; margin: 18px 0 34px; font-style: italic; }
        .firmas { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; }
        .f-col { text-align: center; font-size: 12px; }
        .f-line { border-bottom: 1px solid #26221C; min-height: 58px; display: flex; align-items: flex-end; justify-content: center; margin-bottom: 6px; }
        .f-line img { max-height: 56px; max-width: 100%; }
        .f-name { font-weight: 600; }
        .f-role { font: 10.5px 'Segoe UI', Arial, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #5C554A; }
        .pie { margin-top: 34px; padding-top: 10px; border-top: 1px solid #E4DFD2; font: 10.5px 'Segoe UI', Arial, sans-serif; color: #5C554A; display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        @media print { body { background: #fff; } .toolbar { display: none; } .hoja { box-shadow: none; margin: 0; max-width: none; padding: 6mm 4mm; } }
      </style></head>
      <body>
        <div class="toolbar"><button onclick="window.print()">🖨 Imprimir</button></div>
        <div class="hoja">
          <div class="memb">
            <div>
              <img src="${location.origin}/brand/logo-lockup-horizontal.svg" alt="C Comunica">
              <div class="datos-emp">C COMUNICA, S.A. · RUC 32977-27-249966 DV 39 · Panamá<br>ventas@cecomunica.com · +507 279-5570</div>
            </div>
            <div class="docnum">Nota de entrega N.º <b>${esc(numero)}</b>${esc(fecha)}</div>
          </div>
          <h1>Nota de entrega parcial</h1>
          <p class="subt">Constancia de entrega de una parte de los equipos de la orden</p>
          <div class="grid">
            <div><span class="lbl">Cliente</span><b>${esc(orden.cliente_nombre || '—')}</b></div>
            <div><span class="lbl">Orden de servicio</span><b>${esc(ordenId)}</b></div>
            <div><span class="lbl">Entregado por</span><b>Mostrador — C Comunica</b></div>
            <div><span class="lbl">Equipos en esta entrega</span><b>${equipos.length}</b></div>
          </div>
          <h2>Se lleva hoy (${equipos.length})</h2>
          <table><thead><tr><th>Serial</th><th>Modelo</th></tr></thead><tbody>${filas}</tbody></table>
          ${quedan.length ? `
            <h2>Queda${quedan.length === 1 ? '' : 'n'} en el taller (${quedan.length})</h2>
            <table><thead><tr><th>Serial</th><th>Modelo</th></tr></thead><tbody>${filasPend}</tbody></table>`
            : '<h2>Nada pendiente</h2><p style="font-size:12.5px;">Con esta entrega no queda ningún equipo en el taller.</p>'}
          ${t.notas ? `<h2>Notas</h2><p style="font-size:12.5px;">${esc(t.notas)}</p>` : ''}
          <p class="legal">${esc(LEYENDA_TANDA)}</p>
          <div class="firmas">
            <div class="f-col">
              <div class="f-line">${t.firma_url ? `<img src="${esc(t.firma_url)}" alt="Firma de ${esc(t.receptor_nombre || '')}">` : ''}</div>
              <div class="f-name">${esc(t.receptor_nombre || '—')}</div>
              ${t.receptor_cedula ? `<div style="font-size:11.5px;color:#5C554A;">Cédula ${esc(t.receptor_cedula)}</div>` : ''}
              ${t.sin_id ? `<div style="font-size:11px;color:#5C554A;">Sin identificación — ${esc(t.sin_id_motivo || '')}</div>` : ''}
              <div class="f-role">Recibe — por el cliente</div>
            </div>
            <div class="f-col">
              <div class="f-line"></div>
              <div class="f-name">Mostrador C Comunica</div>
              <div class="f-role">Entrega — ${esc(fecha)}</div>
            </div>
          </div>
          <div class="pie">
            <span>Generado por el sistema de órdenes de servicio</span>
            <span>${equipos.length} equipo(s) entregado(s) · ${esc(numero)}</span>
          </div>
        </div>
      </body></html>`;
  }

  async function _ordenDe(ordenId) {
    return (APP?.state?.orders || []).find(o => o.ordenId === ordenId)
      || await OrdenesService.getOrder(ordenId);
  }

  async function abrirDocTanda(ordenId, numero) {
    const orden = await _ordenDe(ordenId);
    const t = EntregaTandas.tandas(orden).find(x => numeroDe(ordenId, x) === numero);
    if (!t) { Toast.show('Esa entrega ya no está en la orden.', 'bad'); return; }
    const w = window.open('', '_blank');
    if (!w) { Toast.show('El navegador bloqueó la pestaña — permite ventanas emergentes.', 'bad'); return; }
    w.document.write(_docNotaTandaHtml({ ...orden, ordenId }, t));
    w.document.close();
  }

  // ── Copia al cliente ──────────────────────────────────────────────────
  // Solo marca la solicitud; el correo lo arma y lo encola el backend, y
  // onMailQueued espeja el resultado real. Sirve para el primer envío y para
  // el reenvío tras un fallo, también con la orden ya cerrada.
  async function enviarNotaTanda(ordenId, numero, onHecho) {
    const orden = await _ordenDe(ordenId);
    const t = EntregaTandas.tandas(orden).find(x => numeroDe(ordenId, x) === numero);
    if (!t) { Toast.show('Esa entrega ya no está en la orden.', 'bad'); return; }

    let prellenado = t.envio?.to || '';
    if (!prellenado && orden.cliente_id) {
      try {
        const c = await ClientesService.getCliente(orden.cliente_id);
        prellenado = (c?.email_acuses || c?.email || '').trim().toLowerCase();
      } catch (_) { /* el operador lo teclea */ }
    }

    await Modal.sheet({
      title: `Enviar nota ${numero}`, icon: 'mail', size: 'sm',
      html: `
        <p style="margin:0 0 10px;font-size:13px;color:var(--fg-2,#374151);">
          El cliente recibe la nota completa — lo que se llevó, lo que queda en el taller y la firma.
        </p>
        <label class="form-label" for="epMail">Correo del cliente</label>
        <input type="email" id="epMail" class="form-input" value="${esc(prellenado)}" placeholder="cliente@empresa.com">`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'enviar', label: 'Enviar', primary: true, icon: 'send' },
      ],
      onAction: async (a, root) => {
        if (a !== 'enviar') return null;
        const to = (root.querySelector('#epMail').value || '').trim().toLowerCase();
        const botones = root.querySelectorAll('button');
        botones.forEach(b => { b.disabled = true; });
        try {
          await OrdenesService.solicitarEnvioTanda(ordenId, numero, to);
          Toast.show('📧 La copia va en camino — el chip cambia solo cuando salga.', 'ok');
          if (onHecho) onHecho(to);
          return 'ok';
        } catch (err) {
          Toast.show('❌ ' + (err.message || 'No se pudo pedir el envío'), 'bad');
          botones.forEach(b => { b.disabled = false; });
          return false;
        }
      },
    });
  }

  // Cablea los botones de las tarjetas de tanda. Lo usan esta hoja y
  // "Ver entrega" (ordenes-events.js), que pinta las mismas tarjetas.
  function cablearTandas(root, ordenId) {
    root.addEventListener('click', async (ev) => {
      const doc = ev.target.closest('.ep-doc');
      if (doc) { abrirDocTanda(ordenId, doc.dataset.numero); return; }
      const env = ev.target.closest('.ep-enviar');
      if (!env) return;
      const numero = env.dataset.numero;
      await enviarNotaTanda(ordenId, numero, () => {
        // Optimista: el snapshot en vivo no repinta una hoja ya montada.
        const tarjeta = root.querySelector(`.ep-tanda[data-numero="${CSS.escape(numero)}"]`);
        if (!tarjeta) return;
        tarjeta.querySelector('.ep-chip-envio').innerHTML = chipEnvio({ status: 'solicitado' });
        const b = tarjeta.querySelector('.ep-enviar');
        if (b) { b.disabled = true; b.textContent = 'Enviando…'; }
      });
    });
  }

  async function abrir(ordenId) {
    let orden = (APP?.state?.orders || []).find(o => o.ordenId === ordenId);
    if (!orden) {
      try { orden = await OrdenesService.getOrder(ordenId); } catch (_) { /* abajo */ }
    }
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }

    if (!EntregaTandas.admiteTandas(orden)) {
      Toast.show('La entrega parcial es solo para órdenes de REPARACIÓN.', 'bad');
      return;
    }
    const pendientes = EntregaTandas.equiposPendientes(orden);
    if (pendientes.length < 2) {
      Toast.show('Queda un solo equipo por entregar: usa el botón Entregar.', 'warn');
      return;
    }

    await CargaDiferida.storage();   // la firma sube a Storage al confirmar

    let pad = null;
    let overlay = null;
    // Firma en la tablet del mostrador: `solTablet` es la solicitud viva y
    // `firmaTablet` la firma ya recibida (URL, la tablet la subió a Storage).
    // Solo una de las dos vías vale a la vez — el recuadro se esconde
    // mientras la tablet manda.
    let solTablet = null, unsubTablet = null, firmaTablet = null;
    // La cablea onMount (necesita el root); la usa también el cierre de la hoja.
    let soltarTablet = () => {};
    const marcados = () => [...overlay.querySelectorAll('.ep-check:checked')].map(c => c.value);

    const refrescar = () => {
      const n = marcados().length;
      const quedan = pendientes.length - n;
      const cont = overlay.querySelector('#epCount');
      const btn = overlay.querySelector('#epEntregar');
      // Marcar TODO no es una tanda: es la entrega completa. Se dice aquí
      // mismo en vez de dejar que falle al confirmar.
      const esTodo = n >= pendientes.length;
      if (cont) {
        cont.textContent = !n
          ? 'Sin selección'
          : esTodo
            ? 'Marcaste todo lo que queda — eso es la entrega completa, usa el botón Entregar'
            : `${plural(n, 'equipo sale', 'equipos salen')} hoy · ${plural(quedan, 'se queda', 'se quedan')} en el taller`;
        cont.style.color = esTodo ? 'var(--danger,#B91C1C)' : 'var(--fg-2)';
      }
      if (btn) btn.disabled = !n || esTodo;
    };

    const resultado = await Modal.sheet({
      title: `Entrega parcial · orden ${ordenId}`,
      icon: 'package-check',
      size: 'lg',
      html: `
        <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
          Marca los equipos que el cliente se lleva <b>hoy</b>. Los demás se quedan en el taller y
          <b>la orden sigue abierta</b> hasta que salga el último — ahí se cierra con el botón
          <b>Entregar</b> de siempre.
        </p>

        ${bloqueTandas(orden)}

        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-bottom:6px;">
          <strong style="font-size:13px;">Equipos pendientes (${pendientes.length})</strong>
          <button type="button" class="btn btn-secondary" id="epNinguno" style="height:28px;font-size:12px;">Ninguno</button>
        </div>
        <input type="search" id="epBuscar" class="form-input" placeholder="Filtrar por serial…"
               style="width:100%;margin-bottom:6px;height:34px;font-family:var(--font-mono,monospace);">
        <div id="epCount" style="position:sticky;top:-24px;z-index:2;margin:0 -24px 6px;padding:6px 24px;background:var(--surface-card,#fff);border-bottom:1px solid var(--border-subtle,#EEF2F6);font-size:13px;font-weight:600;color:var(--fg-2);">Sin selección</div>
        <div id="epLista" style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:14px;">
          ${pendientes.map(filaEquipo).join('')}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
          <div>
            <label class="form-label" for="epReceptor">Quién recibe *</label>
            <input type="text" id="epReceptor" class="form-input" placeholder="Nombre completo" autocomplete="off">
          </div>
          <div>
            <label class="form-label" for="epCedula">Cédula</label>
            <input type="text" id="epCedula" class="form-input" placeholder="Opcional" autocomplete="off">
          </div>
        </div>

        <label style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:8px;cursor:pointer;">
          <input type="checkbox" id="epSinId"> El cliente no presentó identificación
        </label>
        <div id="epSinIdWrap" class="hidden" style="margin-bottom:10px;">
          <input type="text" id="epSinIdMotivo" class="form-input" placeholder="¿Por qué? (obligatorio)">
        </div>

        <label class="form-label" for="epNotas">Notas de la entrega</label>
        <textarea id="epNotas" class="form-input" rows="2" placeholder="Opcional — qué se acordó sobre lo que queda"></textarea>

        <div style="margin-top:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:4px;">
            <label class="form-label" style="margin:0;">Firma de quien recibe *</label>
            <span style="display:flex;gap:6px;">
              ${FirmaTablet.disponible()
                ? '<button type="button" class="btn btn-secondary" id="epTabletPedir" style="height:26px;font-size:12px;">Firmar en la tablet</button>'
                : ''}
              <button type="button" class="btn btn-secondary" id="epLimpiarFirma" style="height:26px;font-size:12px;">Limpiar</button>
            </span>
          </div>
          <div id="epCanvasWrap">
            <canvas id="epFirma" style="width:100%;height:140px;border:1px dashed var(--border);border-radius:8px;background:#fff;touch-action:none;"></canvas>
          </div>
          <div id="epTabletEspera" class="hidden" style="border:1px dashed var(--border);border-radius:8px;padding:14px;text-align:center;font-size:13px;color:var(--fg-2);">
            Esperando la firma en la tablet del mostrador…
            <div style="margin-top:8px;"><button type="button" class="btn btn-secondary" id="epTabletCancelar" style="height:26px;font-size:12px;">Cancelar y firmar aquí</button></div>
          </div>
          <div id="epTabletListo" class="hidden" style="border:1px solid var(--border);border-radius:8px;padding:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
              <b id="epTabletNombre" style="font-size:13px;"></b>
              <button type="button" class="btn btn-secondary" id="epTabletDescartar" style="height:26px;font-size:12px;">Descartar firma</button>
            </div>
            <img id="epTabletPreview" alt="Firma recibida" style="max-height:80px;margin-top:6px;">
          </div>
        </div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'entregar', label: 'Registrar entrega parcial', primary: true, icon: 'package-check' },
      ],
      onMount: (root) => {
        overlay = root;
        const btn = root.querySelector('.modal-footer .btn-primary');
        if (btn) { btn.id = 'epEntregar'; btn.disabled = true; }

        root.querySelector('#epLista').addEventListener('change', refrescar);
        root.querySelector('#epNinguno').addEventListener('click', () => {
          root.querySelectorAll('.ep-check').forEach(c => { c.checked = false; });
          refrescar();
        });
        root.querySelector('#epBuscar').addEventListener('input', (e) => {
          const q = (e.target.value || '').trim().toUpperCase();
          root.querySelectorAll('.ep-fila').forEach(f => {
            f.style.display = !q || f.textContent.toUpperCase().includes(q) ? '' : 'none';
          });
        });
        root.querySelector('#epSinId').addEventListener('change', (e) => {
          root.querySelector('#epSinIdWrap').classList.toggle('hidden', !e.target.checked);
        });

        pad = FirmaPad.mount(root.querySelector('#epFirma'), { alto: 140 });
        root.querySelector('#epLimpiarFirma').addEventListener('click', () => pad && pad.clear());

        const pintarTablet = () => {
          const esperando = !!solTablet && !firmaTablet;
          root.querySelector('#epCanvasWrap').classList.toggle('hidden', esperando || !!firmaTablet);
          root.querySelector('#epTabletEspera').classList.toggle('hidden', !esperando);
          root.querySelector('#epTabletListo').classList.toggle('hidden', !firmaTablet);
          root.querySelector('#epLimpiarFirma').classList.toggle('hidden', esperando || !!firmaTablet);
          const pedir = root.querySelector('#epTabletPedir');
          if (pedir) pedir.classList.toggle('hidden', esperando || !!firmaTablet);
          if (firmaTablet) {
            root.querySelector('#epTabletNombre').textContent =
              (firmaTablet.nombre || '—') + (firmaTablet.cedula ? ` · Céd. ${firmaTablet.cedula}` : '');
            if (firmaTablet.url) root.querySelector('#epTabletPreview').src = firmaTablet.url;
          }
        };
        // Suelta el listener y, si el operador abandona, cancela la solicitud
        // para que no quede colgando en la tablet. Una firma ya recibida NO
        // se cancela: es constancia.
        soltarTablet = (cancelarPendiente) => {
          if (unsubTablet) { unsubTablet(); unsubTablet = null; }
          if (cancelarPendiente && solTablet && !firmaTablet) FirmaTablet.cancelar(solTablet);
          solTablet = null;
        };

        root.querySelector('#epTabletPedir')?.addEventListener('click', async () => {
          if (solTablet || firmaTablet) return;
          const marcadosAhora = marcados();
          if (!marcadosAhora.length) {
            Toast.show('Marca primero qué equipos se lleva: es lo que el cliente va a ver en la tablet.', 'warn');
            return;
          }
          const set = new Set(marcadosAhora);
          const salen = pendientes.filter(e => set.has(EntregaTandas.claveEquipo(e)));
          try {
            const { n } = EntregaTandas.siguienteTanda(orden, ordenId);
            solTablet = await FirmaTablet.solicitar({
              tipo: 'entrega',
              ordenId,
              numero: `${ordenId}-E${n}`,
              titulo: 'Entrega parcial de equipos',
              nombreLabel: 'Nombre de quien recibe',
              // La tablet muestra SOLO lo que se lleva hoy: firmar una lista
              // con los que se quedan en el taller sería firmar de más.
              unidades: FirmaTablet.unidadesDeEquipos(salen),
              clienteNombre: orden.cliente_nombre || '',
              contratoId: orden.contrato?.contrato_id || null,
              leyenda: null,
            });
            firmaTablet = null;
            unsubTablet = FirmaTablet.escuchar(solTablet, {
              onFirmada: (f) => {
                firmaTablet = f;
                if (unsubTablet) { unsubTablet(); unsubTablet = null; }
                solTablet = null;
                // El nombre que tecleó el cliente prellena el campo, sin pisar
                // lo que recepción ya hubiera escrito.
                const inp = root.querySelector('#epReceptor');
                if (inp && !inp.value.trim() && f.nombre) inp.value = f.nombre;
                const ced = root.querySelector('#epCedula');
                if (ced && !ced.value.trim() && f.cedula) ced.value = f.cedula;
                pintarTablet();
                Toast.show('Firma recibida de la tablet.', 'ok');
              },
              onCancelada: () => { soltarTablet(false); pintarTablet(); },
            });
            pintarTablet();
            Toast.show('Solicitud enviada — ya aparece en la tablet del mostrador.', 'ok');
          } catch (err) {
            console.error('[ordenes-entrega-parcial] tablet', err);
            Toast.show('No se pudo enviar la solicitud a la tablet.', 'bad');
            solTablet = null;
            pintarTablet();
          }
        });
        root.querySelector('#epTabletCancelar').addEventListener('click', () => {
          soltarTablet(true); pintarTablet();
        });
        // Firmó la persona equivocada: se descarta y vuelve el recuadro. La
        // firma queda archivada en la solicitud; la orden solo guarda la que
        // esté vigente al confirmar.
        root.querySelector('#epTabletDescartar').addEventListener('click', () => {
          firmaTablet = null; pintarTablet();
        });
        pintarTablet();
        // Ver / Imprimir / Enviar de las tandas ya registradas.
        cablearTandas(root, ordenId);
        refrescar();
      },
      onAction: async (action, root) => {
        if (action !== 'entregar') return null;

        const ids = marcados();
        if (!ids.length || ids.length >= pendientes.length) return false;

        const receptorNombre = (root.querySelector('#epReceptor').value || '').trim();
        if (!receptorNombre) { Toast.show('Ingrese el nombre de quien recibe', 'bad'); return false; }

        const sinId = !!root.querySelector('#epSinId').checked;
        const sinIdMotivo = sinId ? (root.querySelector('#epSinIdMotivo').value || '').trim() : '';
        if (sinId && !sinIdMotivo) { Toast.show('Indique por qué el cliente no presenta identificación', 'bad'); return false; }

        if (!firmaTablet && (!pad || pad.isEmpty())) {
          Toast.show(solTablet
            ? 'La tablet todavía no devuelve la firma — espera o cancela para firmar aquí.'
            : 'La firma de quien recibe es obligatoria', 'bad');
          return false;
        }

        const ok = await Modal.confirm({
          title: 'Registrar entrega parcial',
          message: `${plural(ids.length, 'equipo sale', 'equipos salen')} hoy con ${receptorNombre}; `
            + `${plural(pendientes.length - ids.length, 'equipo se queda', 'equipos se quedan')} en el taller y la orden sigue abierta. ¿Continuar?`,
          confirmLabel: 'Registrar',
        });
        if (!ok) return false;

        const botones = root.querySelectorAll('button');
        botones.forEach(b => { b.disabled = true; });
        try {
          // La firma de la tablet YA está en Storage (la subió allá): se usa
          // tal cual, sin canvas ni segunda subida.
          let firmaUrl = firmaTablet?.url || null;
          if (!firmaUrl) {
            const blob = await pad.toBlob();
            const path = `ordenes_firmas/${ordenId}_tanda_${Date.now()}.png`;
            const refFirma = firebase.storage().ref(path);
            await refFirma.put(blob, { contentType: 'image/png' });
            firmaUrl = await refFirma.getDownloadURL();
          }

          const r = await OrdenesService.registrarTandaEntrega(ordenId, {
            equipoIds: ids,
            receptorNombre,
            receptorCedula: (root.querySelector('#epCedula').value || '').trim()
              || firmaTablet?.cedula || '',
            firmaUrl,
            sinId, sinIdMotivo,
            notas: (root.querySelector('#epNotas').value || '').trim(),
          });

          // La bandeja se repinta sola con el snapshot en vivo; el caché se
          // parcha por si la orden está fuera de las 40 más recientes.
          const cache = (APP?.state?.orders || []).find(o => o.ordenId === ordenId);
          if (cache) {
            const salieron = new Set(ids);
            cache.entrega = cache.entrega || {};
            cache.entrega.tandas = [...EntregaTandas.tandas(cache), {
              n: r.n, numero: r.numero, receptor_nombre: receptorNombre,
              equipos: pendientes.filter(e => salieron.has(EntregaTandas.claveEquipo(e)))
                .map(e => ({ id: e.id || null, serial: e.numero_de_serie || e.serial || null })),
            }];
          }

          Toast.show(`✅ Entrega ${r.numero} registrada · ${plural(r.pendientes, 'equipo queda', 'equipos quedan')} en el taller`, 'ok');
          return { accion: 'ok', numero: r.numero };
        } catch (err) {
          console.error('[ordenes-entrega-parcial]', err);
          Toast.show('❌ ' + (err.message || 'No se pudo registrar la entrega'), 'bad');
          botones.forEach(b => { b.disabled = false; });
          refrescar();
          return false;
        }
      },
    });
    // Modal.sheet no tiene hook de cierre: la promesa resuelve cuando la hoja
    // se fue, y ahí es cuando el pad suelta sus listeners de document/window
    // y se cancela la solicitud de tablet que nadie llegó a firmar (si no,
    // se queda para siempre en la pantalla del mostrador).
    if (pad) { pad.destroy(); pad = null; }
    soltarTablet(true);

    // El cliente está PARADO en el mostrador esperando su papel: ofrecerlo
    // aquí y no hacerle buscar la hoja otra vez es la diferencia entre que la
    // nota exista y que se use.
    if (resultado && resultado.accion === 'ok') await _ofrecerPapel(ordenId, resultado.numero);
    return resultado;
  }

  async function _ofrecerPapel(ordenId, numero) {
    await Modal.sheet({
      title: `Entrega ${numero} registrada`, icon: 'check-circle-2', size: 'sm',
      html: `
        <p style="margin:0;font-size:13.5px;color:var(--fg-2,#374151);">
          ¿Le das el papel al cliente? Puedes hacerlo ahora o después, desde
          <b>Ver entrega</b> de la orden.
        </p>`,
      buttons: [
        { action: 'cerrar', label: 'Ahora no' },
        { action: 'enviar', label: 'Enviar por correo', icon: 'mail' },
        { action: 'imprimir', label: 'Imprimir', primary: true, icon: 'printer' },
      ],
      onAction: async (a) => {
        if (a === 'imprimir') { await abrirDocTanda(ordenId, numero); return 'imprimir'; }
        if (a === 'enviar') { await enviarNotaTanda(ordenId, numero); return 'enviar'; }
        return null;
      },
    });
  }

  window.abrirEntregaParcial = abrir;
  // Lo que necesita "Ver entrega" (ordenes-events.js) para mostrar las notas
  // parciales cuando la orden ya cerró y esta hoja no se puede abrir.
  window.EntregaParcialDoc = { tarjetaTanda, cablearTandas, abrirDocTanda, enviarNotaTanda };
})();
