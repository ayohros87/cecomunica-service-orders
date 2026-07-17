// @ts-nocheck
/* ========================================
 * ORDENES VISITA - Visitas técnicas de campo
 * Órdenes de tipo VISITA TECNICA (torres, repetidores, sitios del
 * cliente): no entra equipo al taller ni hay entrega posterior.
 *  · Informe de visita estructurado (fecha real, motivo, trabajo,
 *    hallazgos, elementos de sitio SIN serial obligatorio) — reemplaza
 *    el volcado del trabajo en `nota_tecnica`.
 *  · Cierre en sitio con firma del personal de la empresa visitada
 *    (o motivo obligatorio si no hay firma) → estado CERRADA (VISITA).
 * Ambos modales se construyen dinámicamente (patrón ordenes-notas.js)
 * y están pensados para uso en móvil (inputs grandes, chips de un tap,
 * canvas táctil).
 * ======================================== */

(function () {
  const esc = (s) => escapeHtml(String(s ?? ''));

  // Catálogo de elementos de sitio — lo que un técnico interviene en una
  // torre/caseta. Serial opcional: en campo muchas veces no está a mano.
  const ELEMENTOS_SITIO = [
    'Repetidor', 'Amplificador', 'Antena', 'Duplexor', 'Fuente de poder',
    'Planta eléctrica', 'Torre / estructura', 'Radio base', 'Router / enlace',
    'Cableado', 'Caseta / climatización', 'Otro'
  ];

  const MOTIVOS = [
    { key: 'preventivo',  label: 'Preventivo' },
    { key: 'correctivo',  label: 'Correctivo' },
    { key: 'emergencia',  label: 'Emergencia' },
  ];

  function _ordenDe(ordenId) {
    return (window.APP?.state?.orders || []).find(o => o.ordenId === ordenId) || {};
  }

  function _hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ════════════════════════════════════════════════════════════════
  // INFORME DE VISITA
  // ════════════════════════════════════════════════════════════════

  function _elementoRowHtml(el = {}) {
    const opts = ELEMENTOS_SITIO.map(t =>
      `<option value="${esc(t)}" ${t === el.tipo ? 'selected' : ''}>${esc(t)}</option>`).join('');
    return `
      <div class="visita-elemento-row" style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:6px;">
        <select class="form-select visita-el-tipo" style="flex:1 1 140px;min-width:130px;">
          <option value="">Elemento…</option>${opts}
        </select>
        <input class="form-input visita-el-detalle" type="text" placeholder="Detalle (ej.: TPL 70W, caseta norte)"
               value="${esc(el.detalle || '')}" style="flex:2 1 160px;min-width:140px;">
        <input class="form-input visita-el-serial" type="text" placeholder="Serial (opcional)"
               value="${esc(el.serial || '')}" style="flex:1 1 120px;min-width:110px;font-family:var(--font-mono,monospace);">
        <button type="button" class="btn btn-ghost visita-el-del" title="Quitar" aria-label="Quitar elemento" style="padding:6px 8px;">✕</button>
      </div>`;
  }

  window.abrirInformeVisita = async function (ordenId, opts = {}) {
    let datos;
    try {
      datos = await OrdenesService.getOrder(ordenId);
    } catch (e) {
      console.error('[abrirInformeVisita]', e);
      Toast.show('Error cargando la orden', 'bad');
      return;
    }
    if (!datos) { Toast.show('Orden no encontrada', 'bad'); return; }

    const inf = datos.informe_visita || {};
    const sitio = datos.visita?.sitio || '';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9500';
    overlay.innerHTML = `
      <div class="modal" style="max-width:640px;width:min(94vw,640px);">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="clipboard-list"></i> Informe de visita — Orden ${esc(ordenId)}</h3>
          <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:12px 10px;max-height:72vh;overflow:auto;">
          ${sitio ? `<div class="muted" style="margin-bottom:10px;display:flex;align-items:center;gap:6px;"><i data-lucide="map-pin"></i> ${esc(sitio)}</div>` : ''}

          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
            <div class="form-field" style="flex:0 1 170px;">
              <label class="form-label" for="informeFechaVisita">Fecha real de la visita <span class="req">*</span></label>
              <input class="form-input" type="date" id="informeFechaVisita" value="${esc(inf.fecha_visita || _hoyISO())}" max="${_hoyISO()}">
            </div>
            <div class="form-field" style="flex:1 1 220px;">
              <label class="form-label">Motivo <span class="req">*</span></label>
              <div id="informeMotivoChips" style="display:flex;gap:6px;flex-wrap:wrap;">
                ${MOTIVOS.map(m => `
                  <button type="button" class="btn ${inf.motivo === m.key ? 'btn-primary' : 'btn-secondary'} visita-motivo-chip"
                          data-motivo="${m.key}" style="padding:8px 14px;">${m.label}</button>`).join('')}
              </div>
            </div>
          </div>

          <div class="form-field" style="margin-bottom:12px;">
            <label class="form-label" for="informeTrabajo">Trabajo realizado <span class="req">*</span></label>
            <textarea class="form-input form-textarea" id="informeTrabajo" rows="4"
              placeholder="Qué se hizo en el sitio: revisiones, ajustes, mediciones, cambios…">${esc(inf.trabajo_realizado || '')}</textarea>
          </div>

          <div class="form-field" style="margin-bottom:12px;">
            <label class="form-label" for="informeHallazgos">Hallazgos / recomendaciones</label>
            <textarea class="form-input form-textarea" id="informeHallazgos" rows="3"
              placeholder="Lo que se encontró y lo que se recomienda dar seguimiento (opcional)">${esc(inf.hallazgos || '')}</textarea>
          </div>

          <div class="form-field" style="margin-bottom:4px;">
            <label class="form-label" style="display:flex;align-items:center;gap:6px;"><i data-lucide="radio-tower"></i> Elementos intervenidos en el sitio</label>
            <div id="informeElementos">
              ${(Array.isArray(inf.elementos) && inf.elementos.length ? inf.elementos : []).map(_elementoRowHtml).join('')}
            </div>
            <button type="button" class="btn btn-secondary" id="informeAgregarElemento" style="margin-top:4px;">
              <i data-lucide="plus"></i> Agregar elemento
            </button>
          </div>

          <div class="muted" style="margin-top:10px;font-size:12px;display:flex;align-items:center;gap:6px;">
            <i data-lucide="camera"></i>
            <span>¿Fotos del sitio? Úselas desde <a href="fotos-taller.html?ordenId=${encodeURIComponent(ordenId)}">Fotos de la visita</a>.</span>
          </div>
        </div>
        <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
          <button class="btn btn-secondary" data-close="1">Cancelar</button>
          <button class="btn btn-primary" id="informeGuardarBtn"><i data-lucide="save"></i> Guardar informe</button>
        </div>
      </div>`;

    let motivoSel = inf.motivo || '';

    const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
    const kb = e => { if (e.key === 'Escape') cleanup(); };
    document.addEventListener('keydown', kb);

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }

      const chip = e.target.closest('.visita-motivo-chip');
      if (chip) {
        motivoSel = chip.dataset.motivo;
        overlay.querySelectorAll('.visita-motivo-chip').forEach(b => {
          const active = b.dataset.motivo === motivoSel;
          b.classList.toggle('btn-primary', active);
          b.classList.toggle('btn-secondary', !active);
        });
        return;
      }

      if (e.target.closest('#informeAgregarElemento')) {
        const cont = overlay.querySelector('#informeElementos');
        cont.insertAdjacentHTML('beforeend', _elementoRowHtml());
        return;
      }

      const del = e.target.closest('.visita-el-del');
      if (del) { del.closest('.visita-elemento-row')?.remove(); return; }
    });

    const btnGuardar = overlay.querySelector('#informeGuardarBtn');
    btnGuardar.onclick = async () => {
      const fecha   = overlay.querySelector('#informeFechaVisita').value;
      const trabajo = overlay.querySelector('#informeTrabajo').value.trim();
      const hallaz  = overlay.querySelector('#informeHallazgos').value.trim();

      if (!fecha)   { Toast.show('Indique la fecha real de la visita', 'bad'); return; }
      if (!motivoSel) { Toast.show('Seleccione el motivo de la visita', 'bad'); return; }
      if (!trabajo) { Toast.show('Describa el trabajo realizado', 'bad'); return; }

      const elementos = [...overlay.querySelectorAll('.visita-elemento-row')].map(row => ({
        tipo:    row.querySelector('.visita-el-tipo').value,
        detalle: row.querySelector('.visita-el-detalle').value.trim(),
        serial:  row.querySelector('.visita-el-serial').value.trim(),
      })).filter(el => el.tipo || el.detalle || el.serial);

      btnGuardar.disabled = true;
      btnGuardar.textContent = 'Guardando…';
      try {
        await OrdenesService.saveInformeVisita(ordenId, {
          fecha_visita: fecha,
          motivo: motivoSel,
          trabajo_realizado: trabajo,
          hallazgos: hallaz,
          elementos
        });
        cleanup();
        Toast.show('✅ Informe de visita guardado', 'ok');
        if (typeof opts.onSaved === 'function') opts.onSaved();
      } catch (err) {
        console.error('[abrirInformeVisita] guardar', err);
        Toast.show('❌ Error al guardar el informe: ' + err.message, 'bad');
        btnGuardar.disabled = false;
        btnGuardar.innerHTML = '<i data-lucide="save"></i> Guardar informe';
        APP.utils.lucideRefresh(btnGuardar);
      }
    };

    document.body.appendChild(overlay);
    APP.utils.lucideRefresh(overlay);
    setTimeout(() => overlay.querySelector('#informeTrabajo')?.focus(), 100);
  };

  // ════════════════════════════════════════════════════════════════
  // CIERRE DE VISITA (firma en sitio o motivo)
  // ════════════════════════════════════════════════════════════════

  // Canvas de firma propio del modal de cierre — mismo patrón DPR/táctil
  // que el modal de entrega (ordenes-flujo.js), pero autocontenido porque
  // el modal se crea y destruye dinámicamente.
  function _wireFirmaCanvas(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr  = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 300;
    const cssH = 180;
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

  window.abrirCierreVisita = async function (ordenId) {
    // Leer la orden fresca de Firestore: si el informe se acaba de guardar
    // (onSaved → reabrir cierre), el snapshot en vivo de APP.state.orders
    // puede no haberse actualizado todavía.
    let orden;
    try {
      orden = await OrdenesService.getOrder(ordenId);
    } catch (e) {
      console.warn('[abrirCierreVisita] getOrder falló, usando estado local', e);
    }
    orden = orden || _ordenDe(ordenId);

    // El informe de visita es requisito del cierre: sin él, la orden se
    // cerraría con el trabajo sin documentar (el hábito que reemplazamos).
    const informeOk = !!(orden.informe_visita?.trabajo_realizado || '').trim();
    if (!informeOk) {
      Toast.show('Complete primero el informe de visita', 'warn');
      abrirInformeVisita(ordenId, { onSaved: () => abrirCierreVisita(ordenId) });
      return;
    }

    const inf = orden.informe_visita || {};
    const sitio = orden.visita?.sitio || '';
    const motivoLabel = (MOTIVOS.find(m => m.key === inf.motivo)?.label) || inf.motivo || '—';

    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.style.zIndex = '9500';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px;width:min(94vw,560px);">
        <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="pen-line"></i> Cerrar visita — Orden ${esc(ordenId)}</h3>
          <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:12px 10px;max-height:72vh;overflow:auto;">

          <div style="border:1px solid var(--line,#e5e7eb);border-radius:10px;padding:8px 12px;margin-bottom:12px;font-size:13px;">
            <div style="display:flex;gap:8px;padding:2px 0;"><span class="muted" style="min-width:110px;">Cliente</span><strong>${esc(nombreClienteDe(orden))}</strong></div>
            ${sitio ? `<div style="display:flex;gap:8px;padding:2px 0;"><span class="muted" style="min-width:110px;">Sitio</span><strong>${esc(sitio)}</strong></div>` : ''}
            <div style="display:flex;gap:8px;padding:2px 0;"><span class="muted" style="min-width:110px;">Visita</span><strong>${esc(inf.fecha_visita || '—')} · ${esc(motivoLabel)}</strong></div>
            <div style="display:flex;gap:8px;padding:2px 0;align-items:flex-start;"><span class="muted" style="min-width:110px;">Trabajo</span><span>${esc((inf.trabajo_realizado || '').slice(0, 160))}${(inf.trabajo_realizado || '').length > 160 ? '…' : ''}</span></div>
            <button type="button" class="btn btn-ghost" data-editar-informe="1" style="padding:4px 8px;margin-top:2px;font-size:12px;"><i data-lucide="pencil"></i> Editar informe</button>
          </div>

          <div class="form-field" style="margin-bottom:10px;">
            <label class="form-label" for="cierreReceptorNombre">Nombre de quien recibe conforme (personal de la empresa) <span class="req">*</span></label>
            <input class="form-input" type="text" id="cierreReceptorNombre" placeholder="Nombre y apellido" autocomplete="off">
          </div>
          <div class="form-field" style="margin-bottom:10px;">
            <label class="form-label" for="cierreReceptorCargo">Cargo / área</label>
            <input class="form-input" type="text" id="cierreReceptorCargo" placeholder="Ej.: Supervisor de mantenimiento (opcional)" autocomplete="off">
          </div>

          <div id="cierreFirmaWrap">
            <label class="form-label">Firma de conformidad <span class="req">*</span></label>
            <canvas id="cierreFirmaCanvas" style="width:100%;height:180px;border:1px dashed var(--line,#cbd5e1);border-radius:8px;background:#fff;touch-action:none;"></canvas>
            <button type="button" class="btn btn-ghost" data-limpiar-firma="1" style="margin-top:4px;padding:4px 10px;font-size:12px;"><i data-lucide="eraser"></i> Limpiar firma</button>
          </div>

          <label class="form-check" style="margin-top:10px;display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="cierreSinFirma">
            <span class="form-check-label">Cerrar sin firma del personal de la empresa</span>
          </label>
          <div class="form-field hidden" id="cierreSinFirmaBloque" style="margin-top:8px;">
            <label class="form-label" for="cierreSinFirmaMotivo">Motivo (obligatorio) <span class="req">*</span></label>
            <textarea class="form-input form-textarea" id="cierreSinFirmaMotivo" rows="2"
              placeholder="Ej.: no había personal de la empresa en el sitio al finalizar"></textarea>
          </div>
        </div>
        <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
          <button class="btn btn-secondary" data-close="1">Cancelar</button>
          <button class="btn btn-primary" id="cierreConfirmarBtn"><i data-lucide="check"></i> Cerrar visita</button>
        </div>
      </div>`;

    const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
    const kb = e => { if (e.key === 'Escape') cleanup(); };
    document.addEventListener('keydown', kb);

    document.body.appendChild(overlay);
    APP.utils.lucideRefresh(overlay);

    // El canvas necesita clientWidth real → esperar al layout.
    let firma = null;
    requestAnimationFrame(() => {
      firma = _wireFirmaCanvas(overlay.querySelector('#cierreFirmaCanvas'));
    });

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay || e.target.closest('[data-close]')) { cleanup(); return; }
      if (e.target.closest('[data-limpiar-firma]')) { firma?.clear(); return; }
      if (e.target.closest('[data-editar-informe]')) {
        cleanup();
        abrirInformeVisita(ordenId, { onSaved: () => abrirCierreVisita(ordenId) });
        return;
      }
    });

    overlay.querySelector('#cierreSinFirma').addEventListener('change', (e) => {
      const sin = e.target.checked;
      overlay.querySelector('#cierreSinFirmaBloque').classList.toggle('hidden', !sin);
      overlay.querySelector('#cierreFirmaWrap').classList.toggle('hidden', sin);
    });

    const btn = overlay.querySelector('#cierreConfirmarBtn');
    btn.onclick = async () => {
      const receptor = overlay.querySelector('#cierreReceptorNombre').value.trim();
      const cargo    = overlay.querySelector('#cierreReceptorCargo').value.trim();
      const sinFirma = overlay.querySelector('#cierreSinFirma').checked;
      const motivo   = overlay.querySelector('#cierreSinFirmaMotivo').value.trim();

      if (sinFirma) {
        if (!motivo) { Toast.show('Indique el motivo por el cual se cierra sin firma', 'bad'); return; }
      } else {
        if (!receptor) { Toast.show('Ingrese el nombre de quien recibe conforme', 'bad'); return; }
        if (!firma || firma.isEmpty()) { Toast.show('La firma de conformidad es obligatoria (o marque "Cerrar sin firma")', 'bad'); return; }
      }

      btn.disabled = true;
      btn.textContent = 'Guardando…';
      try {
        let firmaUrl = null;
        if (!sinFirma) {
          const canvas = overlay.querySelector('#cierreFirmaCanvas');
          const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
          const path = `ordenes_firmas/${ordenId}_visita_${Date.now()}.png`;
          const ref  = firebase.storage().ref(path);
          await ref.put(blob, { contentType: 'image/png' });
          firmaUrl = await ref.getDownloadURL();
        }

        await OrdenesService.closeVisita(ordenId, {
          firmaUrl,
          receptorNombre: receptor,
          receptorCargo: cargo,
          sinFirma,
          sinFirmaMotivo: motivo
        });

        cleanup();
        Toast.show('✅ Visita cerrada' + (sinFirma ? ' (sin firma, con motivo)' : ''), 'ok');
        // El snapshot en vivo de ordenes-data.js re-renderiza solo.
      } catch (err) {
        console.error('[abrirCierreVisita] confirmar', err);
        Toast.show('❌ Error al cerrar la visita: ' + err.message, 'bad');
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check"></i> Cerrar visita';
        APP.utils.lucideRefresh(btn);
      }
    };
  };
})();
