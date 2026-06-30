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
    try { serialesGuardados = await ContratosService.getSerialesManual(contratoDocId); } catch (e) { /* ok */ }
    try {
      const sig = await db().collection('contratos').doc(contratoDocId)
        .collection('seriales_estado').doc('current').get();
      if (sig.exists && Array.isArray(sig.data().omisiones)) omisiones = sig.data().omisiones;
    } catch (e) { /* ok */ }

    render(serialesGuardados, omisiones);
  }

  // ── Render ─────────────────────────────────────────────────────────────
  function renderMensaje(msg) {
    $('serialesBody').innerHTML = `<div class="ds-card ds-card-padded" style="text-align:center; color:var(--fg-3);">${esc(msg)}</div>`;
    const fs = $('footerStrip'); if (fs) fs.style.display = 'none';
    if (window.lucide) lucide.createIcons();
  }

  function render(serialesGuardados, omisiones) {
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

    const fs = $('footerStrip');
    if (fs) fs.style.display = gruposHtml ? '' : 'none';

    wire();
    refresh();
    if (window.lucide) lucide.createIcons();
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
      const { seriales, omisiones } = await persistir('pendiente');
      Toast.show(`Guardado (${seriales.length} serial(es)${omisiones.length ? `, ${omisiones.length} sin serial` : ''}).`, 'ok');
    } catch (e) {
      console.error('Error guardando seriales:', e);
      Toast.show('No se pudieron guardar los seriales.', 'bad');
    } finally {
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
})();
