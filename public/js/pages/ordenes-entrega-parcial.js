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
  function bloqueTandas(orden) {
    const previas = EntregaTandas.tandas(orden);
    if (!previas.length) return '';
    const filas = previas.map(t => {
      const f = t.fecha?.toDate ? t.fecha.toDate().toLocaleDateString('es-PA') : '';
      const seriales = (t.equipos || []).map(x => x.serial || '—').join(', ');
      return `<li style="margin-bottom:3px;"><b>${esc(t.numero || ('E' + t.n))}</b>${f ? ' · ' + esc(f) : ''}
                · ${esc(t.receptor_nombre || '—')} · <span style="font-family:var(--font-mono,monospace);">${esc(seriales)}</span></li>`;
    }).join('');
    return `
      <div style="border:1px solid var(--border);border-radius:8px;padding:8px 12px;margin-bottom:12px;background:var(--surface-2,#F8FAFC);">
        <div style="font-size:12px;font-weight:600;color:var(--fg-2);margin-bottom:4px;">Ya entregado</div>
        <ul style="margin:0;padding-left:18px;font-size:12.5px;color:var(--fg-2);">${filas}</ul>
      </div>`;
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
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label class="form-label" style="margin:0;">Firma de quien recibe *</label>
            <button type="button" class="btn btn-secondary" id="epLimpiarFirma" style="height:26px;font-size:12px;">Limpiar</button>
          </div>
          <canvas id="epFirma" style="width:100%;height:140px;border:1px dashed var(--border);border-radius:8px;background:#fff;touch-action:none;"></canvas>
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

        if (!pad || pad.isEmpty()) { Toast.show('La firma de quien recibe es obligatoria', 'bad'); return false; }

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
          const blob = await pad.toBlob();
          const path = `ordenes_firmas/${ordenId}_tanda_${Date.now()}.png`;
          const refFirma = firebase.storage().ref(path);
          await refFirma.put(blob, { contentType: 'image/png' });
          const firmaUrl = await refFirma.getDownloadURL();

          const r = await OrdenesService.registrarTandaEntrega(ordenId, {
            equipoIds: ids,
            receptorNombre,
            receptorCedula: (root.querySelector('#epCedula').value || '').trim(),
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
          return 'ok';
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
    // se fue, y ahí es cuando el pad suelta sus listeners de document/window.
    if (pad) { pad.destroy(); pad = null; }
    return resultado;
  }

  window.abrirEntregaParcial = abrir;
})();
