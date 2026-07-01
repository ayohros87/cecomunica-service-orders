// @ts-nocheck
// Página de asignación de seriales (flujo de inventario, al inicio del ciclo).
// El encargado de inventario llega aquí desde el correo "Solicitud de seriales"
// y coloca un serial por unidad (o marca "Sin serial" con motivo). Al confirmar,
// escribe la señal `contratos/{id}/seriales_estado/current`, que un trigger
// espeja al contrato y dispara el correo a activaciones (con seriales + PDF).
//
// El frontend NUNCA escribe el documento del contrato (las reglas lo bloquean
// post-aprobación por presencia de firma_codigo): solo subcolecciones.
(function () {
  const params = new URLSearchParams(location.search);
  const contratoDocId = params.get('id');

  let contrato = null;
  const ctx = { contratoIdVisible: '', clienteNombre: '', clienteId: '' };

  const db = () => firebase.firestore();
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const norm = (s) => String(s || '').trim().toLowerCase();
  const $ = (id) => document.getElementById(id);

  // ── Entry ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad(init);
  });

  async function init(rol) {
    if (!contratoDocId) {
      Toast.show('Falta el id del contrato.', 'bad');
      setTimeout(() => { location.href = 'index.html'; }, 1200);
      return;
    }
    if (!canRole(rol, 'gestionar-seriales')) {
      renderMensaje('Acceso restringido. No tienes permiso para asignar seriales.');
      return;
    }

    try {
      contrato = await ContratosService.getContrato(contratoDocId);
    } catch (e) {
      console.error(e);
      renderMensaje('No se pudo cargar el contrato.');
      return;
    }
    if (!contrato) {
      Toast.show('Contrato no encontrado.', 'bad');
      setTimeout(() => { location.href = 'index.html'; }, 1200);
      return;
    }

    // Corte legacy: contratos históricos no entran al flujo AUTOMÁTICO de
    // seriales (no se notifica a activaciones). Pero SÍ se permite registrar
    // seriales para referencia/historial — modo "registro histórico": render
    // normal con banner, solo "Guardar" (se oculta "Confirmar y enviar"). El
    // correo a activaciones queda bloqueado de todos modos por el backstop del
    // trigger onSerialesAsignadasSendPdf. Ver backfill `marcarSerialesLegacy`.
    ctx.esLegacy = (contrato.seriales_estado === 'legacy');

    ctx.contratoIdVisible = contrato.contrato_id || contratoDocId;
    ctx.clienteNombre = contrato.cliente_nombre || '';
    ctx.clienteId = contrato.cliente_id || '';

    const bc = $('bc-contrato-id'); if (bc) bc.textContent = ctx.contratoIdVisible;
    const ph = $('ph-cliente'); if (ph) ph.textContent = ctx.clienteNombre || '';
    const sub = $('ph-subtitle');
    if (sub) sub.textContent = `${ctx.contratoIdVisible} · ${ctx.clienteNombre || 'Cliente'}`;

    // Prefill: seriales guardados + omisiones (de la señal).
    let serialesGuardados = [];
    let omisiones = [];
    let estadoSenal = '';
    try { serialesGuardados = await ContratosService.getSerialesManual(contratoDocId); } catch (e) { /* ok */ }
    try {
      const sig = await db().collection('contratos').doc(contratoDocId)
        .collection('seriales_estado').doc('current').get();
      if (sig.exists) {
        const sd = sig.data() || {};
        if (Array.isArray(sd.omisiones)) omisiones = sd.omisiones;
        estadoSenal = sd.estado || '';
      }
    } catch (e) { /* ok */ }

    // Candado: una vez "asignados", la pantalla queda en solo-lectura para evitar
    // cambios accidentales. Solo administradores (o usuarios habilitados en
    // empresa/config.seriales_editores_extra) pueden reabrir y editar. Los
    // contratos legacy (registro histórico) no aplican al candado.
    ctx.yaAsignados = !ctx.esLegacy &&
      (estadoSenal === 'asignados' || contrato.seriales_estado === 'asignados');
    ctx.puedeEditarAsignados = ctx.yaAsignados ? await puedeEditarAsignados(rol) : false;
    ctx.desbloqueado = false;

    // Modo reemplazo: si hay una solicitud de cambio de serial PENDIENTE
    // (creada por recepción/admin desde el módulo de contratos), inventario puede
    // reemplazar SOLO los seriales marcados en la solicitud, aun con el candado.
    ctx.cambioReq = null;
    ctx.cambioSet = new Set();
    if (ctx.yaAsignados) {
      try {
        const qs = await db().collection('contratos').doc(contratoDocId)
          .collection('seriales_cambios').where('estado', '==', 'pendiente').get();
        if (!qs.empty) {
          const docs = qs.docs.map(d => ({ id: d.id, ...d.data() }));
          docs.sort((a, b) => (b.solicitado_at?.toMillis?.() || 0) - (a.solicitado_at?.toMillis?.() || 0));
          const req = docs[0];
          ctx.cambioReq = { id: req.id, items: Array.isArray(req.items) ? req.items : [], motivo: req.motivo || '', motivo_tipo: req.motivo_tipo || '' };
          ctx.cambioReq.items.forEach(it => { const s = norm(it.serial); if (s) ctx.cambioSet.add(s); });
        }
      } catch (e) { /* ok */ }
    }
    ctx.modoReemplazo = !!ctx.cambioReq && ctx.cambioSet.size > 0;

    render(serialesGuardados, omisiones);
  }

  // ¿Este usuario puede editar seriales YA asignados? Admin siempre; además, los
  // emails habilitados en empresa/config.seriales_editores_extra (config del
  // panel de administración). Falla cerrado si no se puede leer la config.
  async function puedeEditarAsignados(rol) {
    if (rol === (window.ROLES && ROLES.ADMIN) || rol === 'administrador') return true;
    try {
      if (typeof EmpresaService === 'undefined') return false;
      const cfg = await EmpresaService.getConfig();
      const extra = Array.isArray(cfg.seriales_editores_extra) ? cfg.seriales_editores_extra : [];
      const email = String(firebase.auth().currentUser?.email || '').toLowerCase();
      return !!email && extra.map(e => String(e).toLowerCase()).includes(email);
    } catch (e) { return false; }
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function renderMensaje(msg) {
    $('serialesBody').innerHTML = `<div class="ds-card ds-card-padded" style="text-align:center; color:var(--fg-3);">${esc(msg)}</div>`;
    const fs = $('footerStrip'); if (fs) fs.style.display = 'none';
    if (window.lucide) lucide.createIcons();
  }

  function render(serialesGuardados, omisiones) {
    // Recordado para poder re-renderizar al (des)bloquear sin recargar.
    ctx._saved = serialesGuardados;
    ctx._oms = omisiones;
    const locked = ctx.yaAsignados && !ctx.desbloqueado;

    const equipos = Array.isArray(contrato.equipos) ? contrato.equipos : [];
    const cancelado = contrato.baja_cancelado || {};

    const savedByModel = {};
    serialesGuardados.forEach(s => {
      const k = norm(s.modelo);
      (savedByModel[k] = savedByModel[k] || []).push(String(s.serial || '').trim());
    });
    const omsByModel = {};
    (omisiones || []).forEach(o => {
      const k = norm(o.modelo);
      (omsByModel[k] = omsByModel[k] || []).push(String(o.motivo || ''));
    });

    const gruposHtml = equipos.map(eq => {
      const modelo = String(eq?.modelo || '-').trim() || '-';
      const modeloId = eq?.modelo_id || '';
      const key = String(modeloId || modelo);
      const contratados = Number(eq?.cantidad || 0);
      const activos = Math.max(0, contratados - Number(cancelado[key] || 0));
      if (activos === 0) return '';
      const k = norm(modelo);

      const slots = [];
      (savedByModel[k] || []).filter(Boolean).forEach(s => slots.push({ serial: s }));
      (omsByModel[k] || []).forEach(m => slots.push({ omitido: true, motivo: m }));
      while (slots.length < activos) slots.push({});

      const filas = slots.map((slot, i) => rowHtml(modelo, modeloId, i + 1, slot)).join('');

      return `
        <div class="serial-group ds-card ds-card-padded" data-modelo="${esc(modelo)}" data-modelo-id="${esc(modeloId)}" data-activos="${activos}" style="margin-bottom:var(--sp-3);">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
            <div style="font-weight:600;">${esc(modelo)}
              <span class="grupo-progreso" style="color:var(--fg-3); font-weight:400;">· 0/${activos}</span>
            </div>
            <div style="display:flex; gap:6px;">
              <button type="button" class="btn btn-ghost btn-sm" data-action="toggle-paste"><i data-lucide="clipboard-paste"></i> Pegar columna</button>
            </div>
          </div>
          <div class="paste-box" style="display:none; margin-bottom:8px;">
            <textarea class="form-input paste-area" rows="4" placeholder="Pega aquí una columna de seriales (uno por línea) y pulsa Aplicar"></textarea>
            <div style="display:flex; gap:6px; margin-top:6px;">
              <button type="button" class="btn btn-primary btn-sm" data-action="apply-paste">Aplicar</button>
              <button type="button" class="btn btn-ghost btn-sm" data-action="cancel-paste">Cancelar</button>
            </div>
          </div>
          <div class="serial-rows">${filas}</div>
        </div>`;
    }).join('');

    $('serialesBody').innerHTML = gruposHtml ||
      `<div class="ds-card ds-card-padded" style="color:var(--fg-3);">Este contrato no tiene unidades activas que serializar.</div>`;

    // Barra "Jalar seriales": trae los seriales del cliente desde POC o desde las
    // órdenes de servicio vinculadas al contrato y rellena los slots por modelo,
    // sin teclear. Útil en el flujo normal y en el registro histórico (legacy).
    // No se muestra en modo solo-lectura (candado de seriales asignados).
    if (gruposHtml && !locked) {
      const toolbar = document.createElement('div');
      toolbar.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; margin-bottom:var(--sp-3,12px);';
      toolbar.innerHTML =
        '<button type="button" class="btn btn-ghost btn-sm" data-action="jalar-poc"><i data-lucide="download"></i> Jalar desde POC</button>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-action="jalar-os"><i data-lucide="clipboard-list"></i> Jalar desde órdenes</button>';
      $('serialesBody').prepend(toolbar);
    }

    // Modo "registro histórico" (contrato legacy): banner explicativo + se oculta
    // "Confirmar y enviar a activaciones". "Guardar" sigue disponible para dejar
    // los seriales registrados en el contrato sin notificar a nadie.
    if (ctx.esLegacy) {
      const banner = document.createElement('div');
      banner.style.cssText = 'margin-bottom:var(--sp-3,12px);padding:12px 14px;border:1px solid #BFDBFE;background:#EFF6FF;color:#1E3A8A;border-radius:10px;display:flex;gap:8px;align-items:flex-start;font-size:14px;';
      banner.innerHTML = '<i data-lucide="archive" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div><strong>Contrato histórico.</strong> Puedes registrar los seriales para referencia; <strong>no se envía nada a activaciones</strong> ni se reinicia el proceso.</div>';
      $('serialesBody').prepend(banner);
      const bc = $('btnConfirmar'); if (bc) bc.style.display = 'none';
    }

    const fs = $('footerStrip');
    if (fs) fs.style.display = gruposHtml ? '' : 'none';

    aplicarCandado(locked);

    wire();
    refresh();
    if (window.lucide) lucide.createIcons();
  }

  // Modo solo-lectura sobre la pantalla ya renderizada. Tres estados:
  //   · editable   → normal o desbloqueado por admin (Guardar/Confirmar).
  //   · reemplazo  → hay solicitud pendiente: desbloquea SOLO los seriales
  //                  marcados y ofrece "Guardar reemplazo".
  //   · bloqueado  → seriales asignados sin solicitud (admin/allowlist ve "Editar").
  function aplicarCandado(locked) {
    const body = $('serialesBody');
    const btnGuardar = $('btnGuardar');
    const btnConfirmar = $('btnConfirmar');
    const btnEditar = $('btnEditar');
    const btnReemplazo = $('btnReemplazo');
    const lockNote = $('lockNote');

    const lb = body.querySelector('#lockBanner'); if (lb) lb.remove();
    [btnGuardar, btnConfirmar, btnEditar, btnReemplazo].forEach(b => { if (b) b.style.display = 'none'; });
    if (lockNote) lockNote.style.display = 'none';

    if (!locked) {
      if (btnGuardar) btnGuardar.style.display = '';
      // Al editar seriales YA asignados NO reofrecemos "Confirmar y enviar a
      // activaciones" (evitar reenvío): solo "Guardar cambios". Legacy ya se oculta.
      if (btnConfirmar) btnConfirmar.style.display = (ctx.yaAsignados || ctx.esLegacy) ? 'none' : '';
      return;
    }

    // Bloqueado: deshabilita toda edición del cuerpo.
    body.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = true; });

    // ¿Modo reemplazo? Reabre SOLO los seriales marcados en la solicitud.
    let nReemplazo = 0;
    if (ctx.modoReemplazo) {
      body.querySelectorAll('.serial-input').forEach(inp => {
        if (ctx.cambioSet.has(norm(inp.value))) {
          inp.disabled = false;
          inp.dataset.reemplazo = inp.value.trim();   // serial original a reemplazar
          inp.classList.add('reemplazo');
          nReemplazo++;
        }
      });
    }

    if (nReemplazo > 0) {
      body.prepend(bannerCandado('reemplazo', nReemplazo));
      if (btnReemplazo) btnReemplazo.style.display = '';
      return;
    }

    // Bloqueo normal (sin solicitud aplicable).
    body.prepend(bannerCandado(ctx.puedeEditarAsignados ? 'editable' : 'bloqueado'));
    if (btnEditar) btnEditar.style.display = ctx.puedeEditarAsignados ? '' : 'none';
    if (lockNote && !ctx.puedeEditarAsignados) { lockNote.style.display = ''; lockNote.textContent = 'Bloqueado — seriales asignados'; }
  }

  function bannerCandado(kind, n) {
    const el = document.createElement('div');
    el.id = 'lockBanner';
    const s = (border, bg, color) => `margin-bottom:var(--sp-3,12px);padding:12px 14px;border:1px solid ${border};background:${bg};color:${color};border-radius:10px;display:flex;gap:8px;align-items:flex-start;font-size:14px;`;
    if (kind === 'reemplazo') {
      el.style.cssText = s('#93C5FD', '#EFF6FF', '#1E3A8A');
      const m = ctx.cambioReq?.motivo_tipo
        ? ` (${esc(ctx.cambioReq.motivo_tipo)}${ctx.cambioReq.motivo ? ' — ' + esc(ctx.cambioReq.motivo) : ''})` : '';
      el.innerHTML = `<i data-lucide="replace" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div><strong>Solicitud de cambio de serial${m}.</strong> Reemplaza los ${n} serial(es) resaltados y pulsa <strong>“Guardar reemplazo”</strong>. Los demás quedan bloqueados.</div>`;
    } else if (kind === 'editable') {
      el.style.cssText = s('#FCD34D', '#FFFBEB', '#92400E');
      el.innerHTML = '<i data-lucide="lock" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div><strong>Seriales asignados.</strong> Están bloqueados para evitar cambios accidentales. Pulsa <strong>“Editar seriales”</strong> para corregirlos.</div>';
    } else {
      el.style.cssText = s('#FCD34D', '#FFFBEB', '#92400E');
      el.innerHTML = '<i data-lucide="lock" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div><strong>Seriales asignados.</strong> Ya no se pueden editar desde aquí. Si necesitas corregir un serial, contacta a un administrador.</div>';
    }
    return el;
  }

  function rowHtml(modelo, modeloId, num, slot) {
    const omit = !!slot?.omitido;
    return `
      <div class="serial-row">
        <span class="serial-num">${esc(String(num))}.</span>
        <input class="serial-input form-input" data-modelo="${esc(modelo)}" data-modelo-id="${esc(modeloId)}"
               value="${esc(slot?.serial || '')}" placeholder="Número de serie" ${omit ? 'disabled' : ''}>
        <label class="serial-omit"><input type="checkbox" class="omit-toggle" ${omit ? 'checked' : ''}> Sin serial</label>
        <input class="motivo-input form-input" placeholder="Motivo (por qué no lleva serial)"
               value="${esc(slot?.motivo || '')}" style="${omit ? '' : 'display:none;'}">
      </div>`;
  }

  // ── Wiring ─────────────────────────────────────────────────────────────
  let _wired = false;
  function wire() {
    if (_wired) return;
    _wired = true;
    const body = $('serialesBody');

    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'jalar-poc') { jalarDesdePoc(); return; }
      if (action === 'jalar-os')  { jalarDesdeOS();  return; }
      const grupo = btn.closest('.serial-group');
      if (action === 'toggle-paste') togglePaste(grupo, true);
      else if (action === 'cancel-paste') togglePaste(grupo, false);
      else if (action === 'apply-paste') applyPaste(grupo);
    });

    body.addEventListener('change', (e) => {
      if (e.target.classList.contains('omit-toggle')) onOmitToggle(e.target);
    });

    body.addEventListener('input', (e) => {
      if (e.target.classList.contains('serial-input') || e.target.classList.contains('motivo-input')) refresh();
    });

    body.addEventListener('paste', (e) => {
      if (e.target.classList.contains('serial-input')) onPasteSerial(e);
    });

    $('btnGuardar').addEventListener('click', () => guardar());
    $('btnConfirmar').addEventListener('click', () => confirmar());
    $('btnEditar')?.addEventListener('click', () => {
      if (!ctx.puedeEditarAsignados) return;
      ctx.desbloqueado = true;
      render(ctx._saved, ctx._oms);
    });
    $('btnReemplazo')?.addEventListener('click', () => guardarReemplazo());
  }

  function onOmitToggle(chk) {
    const row = chk.closest('.serial-row');
    const serial = row.querySelector('.serial-input');
    const motivo = row.querySelector('.motivo-input');
    if (chk.checked) {
      serial.value = '';
      serial.disabled = true;
      serial.classList.remove('dup');
      motivo.style.display = '';
      motivo.focus();
    } else {
      serial.disabled = false;
      motivo.value = '';
      motivo.style.display = 'none';
      serial.focus();
    }
    refresh();
  }

  // Pegar multilínea sobre una casilla → reparte líneas/tabs en esta casilla y
  // las siguientes del mismo grupo (estilo hoja de cálculo).
  function onPasteSerial(e) {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    if (!text || !/[\r\n\t]/.test(text)) return; // valor único → comportamiento normal
    e.preventDefault();
    const vals = text.split(/[\r\n\t]+/).map(s => s.trim()).filter(Boolean);
    const grupo = e.target.closest('.serial-group');
    fillFrom(grupo, e.target, vals);
  }

  // Reparte `vals` a partir de `startInput`, SIN crear filas: la cantidad la fija
  // el contrato. Si se pegan más seriales que casillas disponibles, los de más se
  // descartan y se avisa. Devuelve cuántos se aplicaron.
  function fillFrom(grupo, startInput, vals) {
    const inputs = [...grupo.querySelectorAll('.serial-input')];
    let idx = inputs.indexOf(startInput);
    if (idx < 0) idx = 0;
    let applied = 0;
    for (const v of vals) {
      const inp = inputs[idx];
      if (!inp) break; // no hay más casillas: el resto se descarta
      // si la fila estaba marcada "sin serial", desmárcala
      const chk = inp.closest('.serial-row').querySelector('.omit-toggle');
      if (chk.checked) { chk.checked = false; onOmitToggle(chk); }
      inp.disabled = false;
      inp.value = v;
      idx++;
      applied++;
    }
    refresh();
    const dropped = vals.length - applied;
    if (dropped > 0) {
      const req = Number(grupo.getAttribute('data-activos') || inputs.length);
      Toast.show(`Se pegaron ${applied}; ${dropped} de más se ignoraron (este modelo tiene ${req} unidad(es) en el contrato).`, 'warn');
    }
    return applied;
  }

  function togglePaste(grupo, show) {
    const box = grupo.querySelector('.paste-box');
    if (!box) return;
    box.style.display = show ? '' : 'none';
    if (show) { const ta = box.querySelector('.paste-area'); ta.value = ''; ta.focus(); }
  }

  function applyPaste(grupo) {
    const ta = grupo.querySelector('.paste-area');
    const vals = ta.value.split(/[\r\n\t]+/).map(s => s.trim()).filter(Boolean);
    if (!vals.length) { togglePaste(grupo, false); return; }
    // Empieza en la primera casilla vacía (no pisa lo ya colocado).
    const inputs = [...grupo.querySelectorAll('.serial-input')];
    const start = inputs.find(i => !i.disabled && !i.value.trim()) || inputs[0];
    const applied = fillFrom(grupo, start, vals);
    togglePaste(grupo, false);
    // Si hubo sobrantes, fillFrom ya mostró el aviso; aquí solo confirmo el éxito.
    if (applied === vals.length) Toast.show(`${applied} serial(es) pegados.`, 'ok');
  }

  // ── Progress + duplicates ───────────────────────────────────────────────
  function refresh() {
    // duplicados (sobre seriales no omitidos)
    const seen = new Map();
    const inputs = [...document.querySelectorAll('#serialesBody .serial-input')];
    inputs.forEach(i => i.classList.remove('dup'));
    inputs.forEach(i => {
      if (i.disabled) return;
      const v = norm(i.value);
      if (!v) return;
      if (seen.has(v)) { i.classList.add('dup'); seen.get(v).classList.add('dup'); }
      else seen.set(v, i);
    });

    // progreso por grupo + total
    let totalReq = 0, totalDone = 0;
    document.querySelectorAll('#serialesBody .serial-group').forEach(grupo => {
      const req = Number(grupo.getAttribute('data-activos') || 0);
      let done = 0;
      grupo.querySelectorAll('.serial-row').forEach(row => {
        const omit = row.querySelector('.omit-toggle').checked;
        const serial = row.querySelector('.serial-input').value.trim();
        const motivo = row.querySelector('.motivo-input').value.trim();
        if ((omit && motivo) || (!omit && serial)) done++;
      });
      const el = grupo.querySelector('.grupo-progreso');
      if (el) el.textContent = `· ${Math.min(done, req)}/${req}`;
      totalReq += req;
      totalDone += Math.min(done, req);
    });
    const foot = $('footProgreso');
    if (foot) foot.textContent = `${totalDone} / ${totalReq}`;
  }

  // ── Collect + validate ──────────────────────────────────────────────────
  function collect() {
    const seriales = [];
    const omisiones = [];
    document.querySelectorAll('#serialesBody .serial-row').forEach(row => {
      const inp = row.querySelector('.serial-input');
      const omit = row.querySelector('.omit-toggle').checked;
      const motivo = row.querySelector('.motivo-input').value.trim();
      const modelo = inp.getAttribute('data-modelo') || '';
      const modeloId = inp.getAttribute('data-modelo-id') || '';
      if (omit) {
        if (motivo) omisiones.push({ modelo, modelo_id: modeloId, motivo });
      } else {
        const serial = inp.value.trim();
        if (serial) seriales.push({ modelo, modelo_id: modeloId, serial, source: 'manual' });
      }
    });
    return { seriales, omisiones };
  }

  // Para confirmar: cada unidad activa debe tener serial O estar omitida con
  // motivo, y no puede haber seriales duplicados.
  function validarCompleto() {
    if (document.querySelector('#serialesBody .serial-input.dup')) {
      return 'Hay seriales duplicados (marcados en rojo).';
    }
    let faltan = [];
    document.querySelectorAll('#serialesBody .serial-group').forEach(grupo => {
      const modelo = grupo.getAttribute('data-modelo') || '';
      const req = Number(grupo.getAttribute('data-activos') || 0);
      let done = 0;
      let omitSinMotivo = false;
      grupo.querySelectorAll('.serial-row').forEach(row => {
        const omit = row.querySelector('.omit-toggle').checked;
        const serial = row.querySelector('.serial-input').value.trim();
        const motivo = row.querySelector('.motivo-input').value.trim();
        if (omit && !motivo) omitSinMotivo = true;
        if ((omit && motivo) || (!omit && serial)) done++;
      });
      if (omitSinMotivo) faltan.push(`${modelo}: falta motivo en una unidad sin serial`);
      else if (done < req) faltan.push(`${modelo}: faltan ${req - done} de ${req}`);
    });
    return faltan.length ? faltan.join(' · ') : null;
  }

  // ── Save / confirm ──────────────────────────────────────────────────────
  async function persistir(estado) {
    const { seriales, omisiones } = collect();
    const uid = firebase.auth().currentUser?.uid || null;
    const ref = db().collection('contratos').doc(contratoDocId);

    await ContratosService.saveSerialesManual(contratoDocId, seriales, {
      uid,
      estado,
      contrato_id: ctx.contratoIdVisible,
      cliente_id: ctx.clienteId,
      cliente_nombre: ctx.clienteNombre,
    });

    await ref.collection('seriales_estado').doc('current').set({
      estado,
      omisiones,
      por: uid,
      at: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return { seriales, omisiones };
  }

  async function guardar() {
    const btn = $('btnGuardar');
    btn.disabled = true;
    try {
      // Al corregir seriales YA asignados preservamos 'asignados' (no se degrada a
      // 'pendiente' ni se reenvía a activaciones: el trigger solo dispara en la
      // transición a 'asignados'). En el flujo normal se guarda como 'pendiente'.
      const estadoGuardar = ctx.yaAsignados ? 'asignados' : 'pendiente';
      const { seriales, omisiones } = await persistir(estadoGuardar);
      Toast.show(`Guardado (${seriales.length} serial(es)${omisiones.length ? `, ${omisiones.length} sin serial` : ''}).`, 'ok');
      // Si estábamos editando seriales asignados, re-bloquear tras guardar.
      if (ctx.yaAsignados) { ctx.desbloqueado = false; render(seriales, omisiones); }
    } catch (e) {
      console.error('Error guardando seriales:', e);
      Toast.show('No se pudieron guardar los seriales.', 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  // Guardar reemplazo (modo solicitud de cambio de serial): persiste los seriales
  // (preservando 'asignados', sin reenviar a activaciones desde el flujo normal) y
  // marca la solicitud como resuelta con el mapeo anterior→nuevo; el trigger
  // onSerialCambio envía la corrección a activaciones.
  async function guardarReemplazo() {
    if (!ctx.cambioReq) return;
    const reemplazos = [];
    document.querySelectorAll('#serialesBody .serial-input[data-reemplazo]').forEach(inp => {
      const anterior = inp.dataset.reemplazo;
      const nuevo = inp.value.trim();
      if (!nuevo) return;
      if (norm(nuevo) !== norm(anterior)) {
        reemplazos.push({ anterior, nuevo, modelo: inp.getAttribute('data-modelo') || '' });
      }
    });
    if (!reemplazos.length) { Toast.show('No cambiaste ningún serial marcado. Escribe el serial de reemplazo.', 'warn'); return; }

    // Anti-duplicado contra TODOS los seriales (no solo los editables).
    const todos = [...document.querySelectorAll('#serialesBody .serial-input')]
      .map(i => norm(i.value)).filter(Boolean);
    const hayDup = todos.some((v, i) => todos.indexOf(v) !== i);
    if (hayDup) { Toast.show('Un serial de reemplazo duplica otro ya asignado. Revisa los valores.', 'warn'); return; }

    const btn = $('btnReemplazo');
    btn.disabled = true;
    try {
      await persistir('asignados');
      const uid = firebase.auth().currentUser?.uid || null;
      await db().collection('contratos').doc(contratoDocId)
        .collection('seriales_cambios').doc(ctx.cambioReq.id).set({
          estado: 'resuelto',
          resuelto_por: uid,
          resuelto_at: firebase.firestore.FieldValue.serverTimestamp(),
          reemplazos,
        }, { merge: true });
      Toast.show(`Reemplazo guardado (${reemplazos.length}). Se notificará a activaciones.`, 'ok');
      setTimeout(() => { location.href = 'index.html'; }, 1400);
    } catch (e) {
      console.error('Error guardando reemplazo:', e);
      Toast.show('No se pudo guardar el reemplazo.', 'bad');
      btn.disabled = false;
    }
  }

  async function confirmar() {
    const error = validarCompleto();
    if (error) { Toast.show(error, 'warn'); return; }
    if (!window.confirm('¿Confirmar los seriales y enviar a activaciones? El contrato continuará el proceso.')) return;

    const btn = $('btnConfirmar');
    btn.disabled = true;
    try {
      await persistir('asignados');
      Toast.show('Seriales confirmados. Se notificará a activaciones.', 'ok');
      setTimeout(() => { location.href = 'index.html'; }, 1400);
    } catch (e) {
      console.error('Error confirmando seriales:', e);
      Toast.show('No se pudo confirmar. Intenta de nuevo.', 'bad');
      btn.disabled = false;
    }
  }

  // ── Jalar seriales (POC / órdenes) ───────────────────────────────────────
  // Distribuye una lista de candidatos {serial, modelo, modeloId} en los slots
  // vacíos por modelo del contrato. Hace match por modelo_id (si ambos lo
  // tienen) o, en su defecto, por nombre normalizado. Deduplica contra los
  // seriales ya presentes en el formulario y dentro del mismo lote. No toca
  // filas marcadas "Sin serial". Reporta cuántos entraron / duplicados / sin
  // cupo / sin modelo en el contrato.
  function jalarItems(items, origen) {
    const grupos = [...document.querySelectorAll('#serialesBody .serial-group')];
    if (!grupos.length) { Toast.show('No hay modelos que serializar en este contrato.', 'warn'); return; }

    const presentes = new Set();
    document.querySelectorAll('#serialesBody .serial-input').forEach(i => {
      const v = norm(i.value); if (v) presentes.add(v);
    });

    const porId = new Map(), porNombre = new Map();
    grupos.forEach(g => {
      const mid = g.getAttribute('data-modelo-id') || '';
      const mnom = norm(g.getAttribute('data-modelo') || '');
      if (mid) porId.set(mid, g);
      if (mnom && !porNombre.has(mnom)) porNombre.set(mnom, g);
    });

    let agregados = 0, duplicados = 0, sinModelo = 0, sinCupo = 0;

    for (const it of (items || [])) {
      const serial = String(it.serial || '').trim();
      if (!serial) continue;
      const key = serial.toLowerCase();
      if (presentes.has(key)) { duplicados++; continue; }

      const grupo = (it.modeloId && porId.get(it.modeloId)) || porNombre.get(norm(it.modelo)) || null;
      if (!grupo) { sinModelo++; continue; }

      const slot = [...grupo.querySelectorAll('.serial-row')].find(row => {
        const inp = row.querySelector('.serial-input');
        const omit = row.querySelector('.omit-toggle')?.checked;
        return inp && !inp.disabled && !omit && !inp.value.trim();
      });
      if (!slot) { sinCupo++; continue; }

      slot.querySelector('.serial-input').value = serial;
      presentes.add(key);
      agregados++;
    }

    refresh();

    const partes = [`${agregados} agregado(s)`];
    if (duplicados) partes.push(`${duplicados} ya presentes`);
    if (sinCupo)    partes.push(`${sinCupo} sin cupo`);
    if (sinModelo)  partes.push(`${sinModelo} sin modelo en el contrato`);
    Toast.show(`Jalado desde ${origen}: ${partes.join(' · ')}.`, agregados ? 'ok' : 'warn');
  }

  async function jalarDesdePoc() {
    if (typeof PocService === 'undefined') { Toast.show('POC no está disponible.', 'bad'); return; }
    if (!ctx.clienteId && !ctx.clienteNombre) { Toast.show('El contrato no tiene cliente asociado para buscar en POC.', 'warn'); return; }
    try {
      let devices = await PocService.getByCliente({ clienteId: ctx.clienteId, clienteNombre: ctx.clienteNombre });
      devices = (devices || []).filter(d => d.deleted !== true && String(d.serial || '').trim());
      if (!devices.length) { Toast.show('No hay equipos en POC para este cliente.', 'warn'); return; }
      const items = devices.map(d => ({
        serial: d.serial,
        modelo: d.modelo_label || d.modelo || '',
        modeloId: d.modelo_id || '',
      }));
      jalarItems(items, 'POC');
    } catch (e) {
      console.error('Error consultando POC:', e);
      Toast.show('No se pudo consultar POC.', 'bad');
    }
  }

  async function jalarDesdeOS() {
    if (typeof ContratosService === 'undefined' || !ContratosService.getOrdenesDeContratoCompleto) {
      Toast.show('Las órdenes del contrato no están disponibles.', 'bad'); return;
    }
    try {
      const ordenes = await ContratosService.getOrdenesDeContratoCompleto(contratoDocId);
      const vivas = (ordenes || []).filter(o => o.eliminado !== true);
      const items = [];
      vivas.forEach(o => (o.equipos || []).forEach(e => {
        const serial = String(e.serial || '').trim();
        if (serial) items.push({ serial, modelo: e.modelo || '', modeloId: '' });
      }));
      if (!items.length) { Toast.show('Las órdenes vinculadas no tienen seriales registrados.', 'warn'); return; }
      jalarItems(items, 'órdenes del contrato');
    } catch (e) {
      console.error('Error leyendo órdenes del contrato:', e);
      Toast.show('No se pudieron leer las órdenes del contrato.', 'bad');
    }
  }
})();
