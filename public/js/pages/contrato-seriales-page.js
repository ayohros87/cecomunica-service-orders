// @ts-nocheck
// Página de asignación de seriales del CONTRATO (contratos/seriales.html).
//
// Desde 2026-09-03 (propuesta "Asignar desde Almacén", F0) el formulario de
// cupos por modelo, el picker del pool, pegar columna y la revisión suave del
// pool viven en el componente compartido js/ui/asignador-seriales.js. Esta
// página conserva lo que es SOLO del contrato: el candado tras "asignados",
// el modo reemplazo por solicitud de cambio, el registro histórico (legacy),
// las fuentes de recuperación (plan de transición, POC, órdenes) y la hoja
// de confirmación que dispara el correo a activaciones.
//
// Su usuario son recepción, vendedores, gerencia y admin. BODEGA (rol
// inventario) ya no trabaja aquí: se redirige a Almacén · Asignar, donde el
// mismo componente corre con la política dura.
//
// El frontend NUNCA escribe el documento del contrato (las reglas lo bloquean
// post-aprobación por presencia de firma_codigo): solo subcolecciones.
(function () {
  const params = new URLSearchParams(location.search);
  const contratoDocId = params.get('id');

  let contrato = null;
  let asignador = null;
  const ctx = { contratoIdVisible: '', clienteNombre: '', clienteId: '' };

  const db = () => firebase.firestore();
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  // Identidad de serial = la del pool (L7 2026-07-27).
  const norm = (s) => ContratosService._serialKey(s);
  const $ = (id) => document.getElementById(id);

  // ── Salidas de la página ────────────────────────────────────────────────
  let _destinoVolver = 'index.html';
  window.volverDeSeriales = () => { location.href = _destinoVolver; };

  function ajustarSalidas() {
    if (new URLSearchParams(location.search).get('volver') === 'almacen') {
      _destinoVolver = '../almacen/index.html';
    }
  }

  // ── Entry ──────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad(init);
  });

  async function init(rol) {
    // Bodega tiene su propia herramienta: la pestaña Asignar de Almacén (misma
    // cola, mismo componente, política dura). Esta página era un callejón para
    // ese rol (auditoría 2026-08-04, B7).
    if (rol === 'inventario' && contratoDocId) {
      location.replace(`../almacen/index.html?tab=asignar&contrato=${encodeURIComponent(contratoDocId)}`);
      return;
    }
    ajustarSalidas();
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
    // seriales (no se notifica a activaciones), pero SÍ se permite registrar
    // seriales para referencia — modo "registro histórico".
    ctx.esLegacy = (contrato.seriales_estado === 'legacy');

    ctx.contratoIdVisible = contrato.contrato_id || contratoDocId;
    ctx.clienteNombre = contrato.cliente_nombre || '';
    ctx.clienteId = contrato.cliente_id || '';

    const bc = $('bc-contrato-id'); if (bc) bc.textContent = ctx.contratoIdVisible;
    const ph = $('ph-cliente'); if (ph) ph.textContent = ctx.clienteNombre || '';
    const sub = $('ph-subtitle');
    if (sub) sub.textContent = `${ctx.contratoIdVisible} · ${ctx.clienteNombre || 'Cliente'}`;

    asignador = AsignadorSeriales.crear({
      body: $('serialesBody'),
      norm,
      politica: 'suave',
      contratoDocId,
      clienteId: ctx.clienteId,
      esLegacy: ctx.esLegacy,
      textoVacio: 'Este contrato no tiene unidades activas que serializar.',
      onChange: ({ done, req }) => { const f = $('footProgreso'); if (f) f.textContent = `${done} / ${req}`; },
    });

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

    // Candado: una vez "asignados", solo-lectura salvo admin/allowlist.
    ctx.yaAsignados = !ctx.esLegacy &&
      (estadoSenal === 'asignados' || contrato.seriales_estado === 'asignados');
    ctx.puedeEditarAsignados = ctx.yaAsignados ? await puedeEditarAsignados(rol) : false;
    ctx.desbloqueado = false;

    // Modo reemplazo: solicitud de cambio de serial PENDIENTE → se reabren
    // SOLO los seriales marcados, aun con el candado.
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

    wireOnce();
    render(serialesGuardados, omisiones);
  }

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

  // Cupos por modelo del contrato: cantidad menos bajas parciales, con lo ya
  // guardado (seriales + omisiones) repartido por modelo.
  function gruposDelContrato(serialesGuardados, omisiones) {
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
    return equipos.map(eq => {
      const modelo = String(eq?.modelo || '-').trim() || '-';
      const modeloId = eq?.modelo_id || '';
      const key = String(modeloId || modelo);
      const contratados = Number(eq?.cantidad || 0);
      const activos = Math.max(0, contratados - Number(cancelado[key] || 0));
      if (activos === 0) return null;
      const k = norm(modelo);
      const slots = [];
      (savedByModel[k] || []).filter(Boolean).forEach(s => slots.push({ serial: s }));
      (omsByModel[k] || []).forEach(m => slots.push({ omitido: true, motivo: m }));
      return { modelo, modelo_id: modeloId, activos, slots };
    }).filter(Boolean);
  }

  function render(serialesGuardados, omisiones) {
    ctx._saved = serialesGuardados;
    ctx._oms = omisiones;
    asignador.setGuardados(serialesGuardados);
    const locked = ctx.yaAsignados && !ctx.desbloqueado;

    const hayGrupos = asignador.render(gruposDelContrato(serialesGuardados, omisiones));

    // Barra de llenado (auditoría 2026-08-04, R4): "Tomar del pool" es el
    // camino normal; POC y órdenes son rutas de recuperación en "Otras fuentes".
    if (hayGrupos && !locked) {
      const continuan = (contrato.transicion_plan?.nivel === 'serial')
        ? (contrato.transicion_plan.unidades || []).filter(u => u.destino === 'continua')
        : [];
      const btnPlan = continuan.length
        ? '<button type="button" class="btn btn-primary btn-sm" data-action="traer-original" '
          + `title="El plan de la venta dice que ${continuan.length} unidad(es) del contrato original continúan en este — las llena aquí sin re-teclear.">`
          + `<i data-lucide="repeat"></i> Traer del original (${continuan.length} continúan)</button>`
        : '';
      const toolbar = document.createElement('div');
      toolbar.id = 'serialesToolbar';
      toolbar.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:var(--sp-3,12px);';
      toolbar.innerHTML =
        btnPlan
        + `<button type="button" class="btn ${btnPlan ? 'btn-ghost' : 'btn-primary'} btn-sm" data-action="tomar-pool" title="Escoge unidades disponibles en bodega y resérvalas para este contrato. Es la vía normal.">`
        + '<i data-lucide="scan-barcode"></i> Tomar del pool (bodega)</button>'
        + '<span style="font-size:12px; color:var(--fg-3);">o teclea/escanea cada serial abajo — también puedes pegar una columna de Excel sobre la primera casilla.</span>'
        + '<span style="flex:1;"></span>'
        + '<div class="overflow-menu">'
        + '  <button type="button" class="btn btn-ghost btn-sm" data-action="otras-fuentes" title="Rutas de recuperación: para contratos históricos o cuando los equipos ya están registrados en otro lado">'
        + '    <i data-lucide="import"></i> Otras fuentes ▾</button>'
        + '  <div class="overflow-menu-dropdown" id="menuOtrasFuentes">'
        + '    <button type="button" class="overflow-menu-item" data-action="jalar-poc"><i data-lucide="download"></i> Jalar desde POC</button>'
        + '    <button type="button" class="overflow-menu-item" data-action="jalar-os"><i data-lucide="clipboard-list"></i> Jalar desde órdenes del contrato</button>'
        + '  </div>'
        + '</div>';
      $('serialesBody').prepend(toolbar);
    }

    if (ctx.esLegacy) {
      const banner = document.createElement('div');
      banner.style.cssText = 'margin-bottom:var(--sp-3,12px);padding:12px 14px;border:1px solid #BFDBFE;background:#EFF6FF;color:#1E3A8A;border-radius:10px;display:flex;gap:8px;align-items:flex-start;font-size:14px;';
      banner.innerHTML = '<i data-lucide="archive" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div><strong>Contrato histórico.</strong> Puedes registrar los seriales para referencia; <strong>no se envía nada a activaciones</strong> ni se reinicia el proceso.</div>';
      $('serialesBody').prepend(banner);
      const bc = $('btnConfirmar'); if (bc) bc.style.display = 'none';
    }

    const fs = $('footerStrip');
    if (fs) fs.style.display = hayGrupos ? '' : 'none';
    const sw = $('serialBuscarWrap');
    if (sw) sw.style.display = hayGrupos ? 'flex' : 'none';

    aplicarCandado(locked);
    asignador.refresh();
    aplicarBusquedaSerial();
    if (window.lucide) lucide.createIcons();
  }

  // ── Buscador de seriales del contrato ───────────────────────────────────
  function aplicarBusquedaSerial(conScroll) {
    const inp = $('serialBuscar');
    const info = $('serialBuscarInfo');
    if (!inp || !asignador) return;
    if (!norm(inp.value)) { asignador.aplicarBusqueda(''); if (info) info.textContent = ''; return; }
    const hits = asignador.aplicarBusqueda(inp.value, conScroll);
    if (info) {
      info.textContent = hits.length
        ? `${hits.length} coincidencia${hits.length === 1 ? '' : 's'}`
        : 'Sin coincidencias — revisa el serial';
    }
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
      // Al editar seriales YA asignados no se reofrece "Confirmar" (evitar reenvío).
      if (btnConfirmar) btnConfirmar.style.display = (ctx.yaAsignados || ctx.esLegacy) ? 'none' : '';
      return;
    }

    asignador.setLocked(true);

    let nReemplazo = 0;
    if (ctx.modoReemplazo) {
      body.querySelectorAll('.serial-input').forEach(inp => {
        if (ctx.cambioSet.has(norm(inp.value))) {
          inp.disabled = false;
          inp.dataset.reemplazo = inp.value.trim();
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
      el.innerHTML = '<i data-lucide="lock" style="width:18px;height:18px;flex:none;margin-top:1px;"></i><div><strong>Seriales asignados.</strong> Ya no se pueden editar desde aquí. Para corregir un serial, crea una <strong>solicitud de cambio</strong> desde la lista de Contratos (menú de acciones del contrato → "Solicitar cambio de serial") — un administrador la aprueba y esta página se desbloquea solo en los seriales marcados.</div>';
    }
    return el;
  }

  // ── Wiring de la página (la del formulario la hace el componente) ───────
  let _wired = false;
  function wireOnce() {
    if (_wired) return;
    _wired = true;
    const body = $('serialesBody');

    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-action');
      if (action === 'otras-fuentes') { document.getElementById('menuOtrasFuentes')?.classList.toggle('open'); return; }
      if (action === 'tomar-pool') { asignador.tomarDelPool(); return; }
      if (action === 'traer-original') { traerDelOriginal(); return; }
      if (action === 'jalar-poc') { cerrarOtrasFuentes(); jalarDesdePoc(); return; }
      if (action === 'jalar-os')  { cerrarOtrasFuentes(); jalarDesdeOS();  return; }
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.overflow-menu')) cerrarOtrasFuentes();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarOtrasFuentes(); });

    const sb = $('serialBuscar');
    if (sb) {
      sb.addEventListener('input', () => aplicarBusquedaSerial(true));
      sb.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { sb.value = ''; aplicarBusquedaSerial(); }
      });
    }

    $('btnGuardar').addEventListener('click', () => guardar());
    $('btnConfirmar').addEventListener('click', () => confirmar());
    $('btnEditar')?.addEventListener('click', () => {
      if (!ctx.puedeEditarAsignados) return;
      ctx.desbloqueado = true;
      render(ctx._saved, ctx._oms);
    });
    $('btnReemplazo')?.addEventListener('click', () => guardarReemplazo());
  }

  function cerrarOtrasFuentes() {
    document.getElementById('menuOtrasFuentes')?.classList.remove('open');
  }

  // ── Save / confirm ──────────────────────────────────────────────────────
  async function persistir(estado) {
    const { seriales, omisiones } = asignador.collect();
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
      if (!await asignador.confirmarAvisosPool(asignador.collect().seriales)) { btn.disabled = false; return; }
      // Al corregir seriales YA asignados se preserva 'asignados' (no se
      // degrada a 'pendiente' ni se reenvía a activaciones).
      const estadoGuardar = ctx.yaAsignados ? 'asignados' : 'pendiente';
      const { seriales, omisiones } = await persistir(estadoGuardar);
      Toast.show(`Guardado (${seriales.length} serial(es)${omisiones.length ? `, ${omisiones.length} sin serial` : ''}).`, 'ok');
      if (ctx.yaAsignados) { ctx.desbloqueado = false; render(seriales, omisiones); }
    } catch (e) {
      console.error('Error guardando seriales:', e);
      Toast.show('No se pudieron guardar los seriales.', 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  // Guardar reemplazo (solicitud de cambio de serial): persiste preservando
  // 'asignados' y marca la solicitud resuelta con el mapeo anterior→nuevo; el
  // trigger onSerialCambio envía la corrección a activaciones.
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

    const todos = [...document.querySelectorAll('#serialesBody .serial-input')]
      .map(i => norm(i.value)).filter(Boolean);
    const hayDup = todos.some((v, i) => todos.indexOf(v) !== i);
    if (hayDup) { Toast.show('Un serial de reemplazo duplica otro ya asignado. Revisa los valores.', 'warn'); return; }

    const btn = $('btnReemplazo');
    btn.disabled = true;
    try {
      if (!await asignador.confirmarAvisosPool(asignador.collect().seriales)) { btn.disabled = false; return; }
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
      setTimeout(() => { location.href = _destinoVolver; }, 1400);
    } catch (e) {
      console.error('Error guardando reemplazo:', e);
      Toast.show('No se pudo guardar el reemplazo.', 'bad');
      btn.disabled = false;
    }
  }

  // Hoja de resumen del paso irreversible (auditoría 2026-08-04, R5).
  function hojaConfirmarEnvio({ seriales, omisiones }) {
    return new Promise((resolve) => {
      const porModelo = new Map();
      seriales.forEach(s => {
        const k = s.modelo || '—';
        porModelo.set(k, (porModelo.get(k) || 0) + 1);
      });
      (omisiones || []).forEach(o => {
        const k = `${o.modelo || '—'}`;
        if (!porModelo.has(k)) porModelo.set(k, 0);
      });
      const filas = [...porModelo.entries()].map(([modelo, n]) => {
        const oms = (omisiones || []).filter(o => (o.modelo || '—') === modelo).length;
        return `<tr>
          <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:13px;">${esc(modelo)}</td>
          <td style="padding:6px 10px; border-bottom:1px solid var(--border); font-size:13px; text-align:right; white-space:nowrap;">
            <b>${n}</b> con serial${oms ? ` · ${oms} sin serial` : ''}</td>
        </tr>`;
      }).join('');

      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.style.display = 'flex';
      overlay.innerHTML = `
        <div class="modal" style="max-width:560px; width:min(560px, 94vw);">
          <div class="sheet-header"><h3 class="sheet-title">Confirmar y enviar a activaciones</h3></div>
          <div class="sheet-body" style="padding:12px 8px;">
            <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(150px,1fr)); gap:10px 16px; margin-bottom:12px;">
              <div><div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3);">Contrato</div>
                   <div style="font-size:13.5px;">${esc(ctx.contratoIdVisible)}</div></div>
              <div><div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3);">Cliente</div>
                   <div style="font-size:13.5px;">${esc(ctx.clienteNombre || '—')}</div></div>
              <div><div style="font-size:10.5px; text-transform:uppercase; letter-spacing:.07em; color:var(--fg-3);">Unidades</div>
                   <div style="font-size:13.5px;"><b>${seriales.length}</b> con serial${omisiones.length ? ` · <b>${omisiones.length}</b> sin serial` : ''}</div></div>
            </div>
            <div style="border:1px solid var(--border); border-radius:8px; overflow:hidden; max-height:240px; overflow-y:auto;">
              <table style="border-collapse:collapse; width:100%;">${filas}</table>
            </div>
            <div style="margin-top:12px; padding:10px 12px; background:#FFFBEB; border:1px solid #FCD34D; border-radius:8px; color:#92400E; font-size:12.5px; line-height:1.55;">
              Al confirmar se envía el <b>correo a activaciones</b> con estos seriales y el PDF del contrato,
              y esta página <b>queda bloqueada</b>. Corregir un serial después requiere una
              <b>solicitud de cambio</b> desde la lista de Contratos.
            </div>
          </div>
          <div class="footer">
            <button class="btn btn-ghost" data-action="cancel">Volver a revisar</button>
            <button class="btn btn-primary" data-action="confirm"><i data-lucide="send" style="width:14px;height:14px;"></i> Confirmar y enviar</button>
          </div>
        </div>`;
      const cleanup = (r) => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', kb); resolve(r); };
      const kb = (e) => { if (e.key === 'Escape') cleanup(false); };
      overlay.addEventListener('click', (e) => {
        const action = e.target.closest('[data-action]')?.dataset?.action;
        if (action === 'confirm') cleanup(true);
        else if (action === 'cancel' || e.target === overlay) cleanup(false);
      });
      document.addEventListener('keydown', kb);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';
      if (window.lucide) lucide.createIcons();
    });
  }

  async function confirmar() {
    const error = asignador.validarCompleto();
    if (error) { Toast.show(error, 'warn'); return; }
    const datos = asignador.collect();
    if (!await asignador.confirmarAvisosPool(datos.seriales)) return;
    if (!await hojaConfirmarEnvio(datos)) return;

    const btn = $('btnConfirmar');
    btn.disabled = true;
    try {
      await persistir('asignados');
      Toast.show('Seriales confirmados. Se notificará a activaciones.', 'ok');
      setTimeout(() => { location.href = _destinoVolver; }, 1400);
    } catch (e) {
      console.error('Error confirmando seriales:', e);
      Toast.show('No se pudo confirmar. Intenta de nuevo.', 'bad');
      btn.disabled = false;
    }
  }

  // ── Fuentes de recuperación (plan de transición, POC, órdenes) ──────────
  function traerDelOriginal() {
    const plan = contrato.transicion_plan;
    const continuan = (plan?.nivel === 'serial')
      ? (plan.unidades || []).filter(u => u.destino === 'continua')
      : [];
    if (!continuan.length) { Toast.show('El plan de la venta no tiene unidades que continúen.', 'warn'); return; }
    asignador.jalarItems(continuan.map(u => ({ serial: u.serial, modelo: u.modelo || '', modeloId: u.modelo_id || '' })),
      'el contrato original (plan de la venta)');
  }

  async function jalarDesdePoc() {
    if (typeof PocService === 'undefined') { Toast.show('POC no está disponible.', 'bad'); return; }
    if (!ctx.clienteId && !ctx.clienteNombre) { Toast.show('El contrato no tiene cliente asociado para buscar en POC.', 'warn'); return; }
    try {
      let devices = await PocService.getByCliente({ clienteId: ctx.clienteId, clienteNombre: ctx.clienteNombre });
      devices = (devices || []).filter(d => d.deleted !== true && String(d.serial || '').trim());
      if (!devices.length) { Toast.show('No hay equipos en POC para este cliente.', 'warn'); return; }
      asignador.jalarItems(devices.map(d => ({
        serial: d.serial,
        modelo: d.modelo_label || d.modelo || '',
        modeloId: d.modelo_id || '',
      })), 'POC');
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
      asignador.jalarItems(items, 'órdenes del contrato');
    } catch (e) {
      console.error('Error leyendo órdenes del contrato:', e);
      Toast.show('No se pudieron leer las órdenes del contrato.', 'bad');
    }
  }
})();
