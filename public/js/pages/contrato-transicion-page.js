// @ts-nocheck
// Transición de equipos (renovación / adición / reemplazo) — contratos/transicion.html?id=<nuevo>
// PLAN_CICLO_VIDA_EQUIPOS.md C.4: dos columnas — SALIENTES (equipos que el
// cliente tiene, del contrato original si está vinculado o de todo el cliente
// si no / legacy) y ENTRANTES (seriales del contrato nuevo) — con mapeo
// serial→serial ASIMÉTRICO (§3.4):
//   · entrante con saliente  → linaje (reemplaza_a) + saliente pendiente de devolución
//   · entrante sin saliente  → unidad neta nueva (no genera mapeo)
//   · saliente sin entrante  → se devuelve sin sustituto (solo pendiente de devolución)
// Aquí solo se escriben los docs de contratos/{id}/mapeos; el trigger
// onMapeoWrite aplica los cambios al pool con Admin SDK. La devolución física
// se registra después como ENTRADA (cierre de enmienda / anulación) y ahí la
// unidad pasa a inspección.
(function () {
  const params = new URLSearchParams(location.search);
  const contratoDocId = params.get('id');

  const db = () => firebase.firestore();
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const norm = (s) => String(s || '').trim().toLowerCase();
  const $ = (id) => document.getElementById(id);

  const ctx = { contrato: null, salientes: [], entrantes: [], mapeos: [], poolNuevoPorSerial: new Map() };

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
      renderMensaje('Acceso restringido. No tienes permiso para gestionar la transición de equipos.');
      return;
    }
    try {
      ctx.contrato = await ContratosService.getContrato(contratoDocId);
    } catch (e) { console.error(e); renderMensaje('No se pudo cargar el contrato.'); return; }
    if (!ctx.contrato) {
      Toast.show('Contrato no encontrado.', 'bad');
      setTimeout(() => { location.href = 'index.html'; }, 1200);
      return;
    }

    const c = ctx.contrato;
    const bc = $('bc-contrato-id'); if (bc) bc.textContent = c.contrato_id || contratoDocId;
    const sub = $('ph-subtitle');
    if (sub) sub.textContent = `${c.contrato_id || contratoDocId} · ${c.cliente_nombre || 'Cliente'} · ${c.accion || c.tipo_contrato || ''}`;

    await cargarDatos();
    render();
  }

  async function cargarDatos() {
    const c = ctx.contrato;

    // SALIENTES: anclados al contrato original si está vinculado; si no (o
    // legacy/papel), a TODOS los equipos del cliente en el pool — excluyendo
    // lo asignado al contrato nuevo. Solo unidades aún con el cliente.
    let salientes = [];
    try {
      salientes = c.contrato_origen_id
        ? await EquiposPoolService.listarPorContrato(c.contrato_origen_id)
        : await EquiposPoolService.listarPorCliente(c.cliente_id);
    } catch (e) { console.warn('No se pudieron cargar los equipos salientes', e); }
    ctx.salientes = salientes.filter(u =>
      (u.estado === EquiposPoolService.ESTADOS.ASIGNADO || u.estado === EquiposPoolService.ESTADOS.EN_CLIENTE)
      && u.asignacion?.contrato_doc_id !== contratoDocId);

    // ENTRANTES: seriales del contrato nuevo + su doc del pool (para el trigger).
    let seriales = [];
    try { seriales = await ContratosService.getSerialesManual(contratoDocId); } catch (e) { /* ok */ }
    ctx.entrantes = (seriales || []).filter(s => String(s.serial || '').trim());
    try {
      const poolNuevo = await EquiposPoolService.listarPorContrato(contratoDocId);
      ctx.poolNuevoPorSerial = new Map(poolNuevo.map(u => [norm(u.serial || u.serial_norm), u]));
    } catch (e) { ctx.poolNuevoPorSerial = new Map(); }

    // Mapeos ya registrados (append-only).
    try {
      const snap = await db().collection('contratos').doc(contratoDocId).collection('mapeos').get();
      ctx.mapeos = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.at?.toMillis?.() || 0) - (b.at?.toMillis?.() || 0));
    } catch (e) { ctx.mapeos = []; }
  }

  function renderMensaje(msg) {
    $('transBody').innerHTML = `<div class="ds-card ds-card-padded" style="text-align:center; color:var(--fg-3);">${esc(msg)}</div>`;
    if (window.lucide) lucide.createIcons();
  }

  function render() {
    const c = ctx.contrato;
    const mapSalientes = new Set(ctx.mapeos.map(m => norm(m.saliente)).filter(Boolean));
    const mapEntrantes = new Set(ctx.mapeos.map(m => norm(m.entrante)).filter(Boolean));

    const entrantesPend = ctx.entrantes.filter(s => !mapEntrantes.has(norm(s.serial)));
    const salientesDisp = ctx.salientes.filter(u =>
      !mapSalientes.has(norm(u.serial || u.serial_norm)) && !u.pendiente_devolucion);
    const salientesEnTransicion = ctx.salientes.filter(u =>
      mapSalientes.has(norm(u.serial || u.serial_norm)) || u.pendiente_devolucion);

    // Aviso de ancla: con vínculo al original se listan SUS equipos; sin
    // vínculo, todos los del cliente (caso legacy/papel — §3.4).
    const ancla = c.contrato_origen_id
      ? `Equipos del contrato original <b>${esc(c.contrato_origen_ref || c.contrato_origen_id)}</b>`
      : (c.origen_tipo === 'legacy'
          ? `Contrato original en papel${c.origen_legacy_ref ? ` (<b>${esc(c.origen_legacy_ref)}</b>)` : ''} — se listan todos los equipos del cliente en el pool`
          : 'Sin contrato original vinculado — se listan todos los equipos del cliente en el pool');

    // Selector de saliente para cada entrante pendiente (mismo modelo primero).
    const opcionesSaliente = (ent) => {
      const compatibles = [], otros = [];
      salientesDisp.forEach(u => {
        (EquiposPoolService._mismoModelo(u, ent.modelo_id || null, ent.modelo || '') ? compatibles : otros).push(u);
      });
      const opt = (u, grupo) => `<option value="${esc(u.id)}" data-serial="${esc(u.serial || u.serial_norm)}">${esc(u.serial || u.serial_norm)} · ${esc(u.modelo_label || '—')}${grupo ? '' : ' (otro modelo)'}</option>`;
      return '<option value="">— No reemplaza (unidad nueva)</option>'
        + compatibles.map(u => opt(u, true)).join('')
        + otros.map(u => opt(u, false)).join('');
    };

    const filasEntrantes = entrantesPend.length ? entrantesPend.map((s, i) => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);">${esc(s.serial)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">${esc(s.modelo || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">
          <select class="form-select trans-map" data-idx="${i}" style="height:32px;font-size:13px;max-width:320px;">${opcionesSaliente(s)}</select>
        </td>
      </tr>`).join('')
      : `<tr><td colspan="3" style="padding:12px;color:var(--fg-3);">No hay entrantes sin mapear${ctx.entrantes.length ? '' : ' — asigna primero los seriales del contrato en la página de Seriales'}.</td></tr>`;

    const filasSalientes = salientesDisp.length ? salientesDisp.map(u => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">
          <input type="checkbox" class="trans-devolver" value="${esc(u.id)}" data-serial="${esc(u.serial || u.serial_norm)}" style="width:16px;height:16px;">
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);">
          <a class="eq-link" href="${EquiposPoolService.kardexUrl(u.serial || u.serial_norm)}">${esc(u.serial || u.serial_norm)}</a>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">${esc(u.modelo_label || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">${EquiposPoolService.chipEstadoHtml(u.estado)}</td>
      </tr>`).join('')
      : `<tr><td colspan="4" style="padding:12px;color:var(--fg-3);">No quedan equipos del cliente por resolver.</td></tr>`;

    const filasMapeos = ctx.mapeos.length ? ctx.mapeos.map(m => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);color:#991b1b;">${esc(m.saliente || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);text-align:center;">→</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);color:#065f46;">${esc(m.entrante || '— (se devuelve sin sustituto)')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);color:var(--fg-3);">${esc(m.modelo || '')}</td>
      </tr>`).join('') : '';

    $('transBody').innerHTML = `
      <div class="ds-card ds-card-padded" style="margin-bottom:var(--sp-3);font-size:13px;color:var(--fg-2);">
        <i data-lucide="info" style="width:14px;height:14px;vertical-align:-2px;"></i>
        ${ancla}. Puede haber <b>menos o más</b> entrantes que salientes: mapea lo que aplique.
        Los salientes quedan <b>pendientes de devolución</b> (el cliente los conserva durante la
        transición); su devolución se registra después como <b>Entrada</b> al cerrar la enmienda o anular el contrato original.
      </div>

      <div class="ds-card ds-card-padded" style="margin-bottom:var(--sp-3);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px;">
          <div style="font-weight:600;">Entrantes del contrato nuevo (${entrantesPend.length} sin mapear)</div>
          <button type="button" class="btn btn-ghost btn-sm" id="btnAutoMapa"><i data-lucide="wand-2"></i> Auto-proponer por modelo</button>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:560px;">
            <thead><tr style="text-align:left;color:var(--fg-3);font-size:12px;">
              <th style="padding:6px 8px;">Serial entrante</th><th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;">Reemplaza a (saliente)</th>
            </tr></thead>
            <tbody>${filasEntrantes}</tbody>
          </table>
        </div>
      </div>

      <div class="ds-card ds-card-padded" style="margin-bottom:var(--sp-3);">
        <div style="font-weight:600;margin-bottom:8px;">Salientes del cliente sin resolver (${salientesDisp.length})</div>
        <p style="margin:0 0 8px;font-size:12px;color:var(--fg-3);">Marca los que se <b>devuelven sin sustituto</b> (renovación con menos equipos). Los elegidos arriba como reemplazo no necesitan marcarse.</p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:560px;">
            <thead><tr style="text-align:left;color:var(--fg-3);font-size:12px;">
              <th style="padding:6px 8px;"></th><th style="padding:6px 8px;">Serial</th><th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;">Estado</th>
            </tr></thead>
            <tbody>${filasSalientes}</tbody>
          </table>
        </div>
      </div>

      ${salientesEnTransicion.length ? `
      <div class="ds-card ds-card-padded" style="margin-bottom:var(--sp-3);">
        <div style="font-weight:600;margin-bottom:8px;">En transición — pendientes de devolución (${salientesEnTransicion.length})</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${salientesEnTransicion.map(u => `<span class="eqpool-chip" style="background:#fef3c7;color:#92400e;" title="${esc(u.modelo_label || '')}">${esc(u.serial || u.serial_norm)}</span>`).join('')}
        </div>
      </div>` : ''}

      ${filasMapeos ? `
      <div class="ds-card ds-card-padded" style="margin-bottom:var(--sp-3);">
        <div style="font-weight:600;margin-bottom:8px;">Transición registrada (${ctx.mapeos.length})</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px;">
            <tbody>${filasMapeos}</tbody>
          </table>
        </div>
      </div>` : ''}

      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button type="button" class="btn btn-primary" id="btnGuardarTrans"><i data-lucide="check"></i> Registrar transición</button>
      </div>`;

    $('btnAutoMapa')?.addEventListener('click', autoProponer);
    $('btnGuardarTrans')?.addEventListener('click', guardar);
    // Un saliente elegido en un select desaparece de las opciones de los demás
    // y de la lista de "se devuelve sin sustituto" (checkbox se desmarca/oculta).
    document.querySelectorAll('.trans-map').forEach(sel => sel.addEventListener('change', sincronizarSelecciones));
    sincronizarSelecciones();
    if (window.lucide) lucide.createIcons();
  }

  // Deshabilita en cada select las opciones ya elegidas en otro, y atenúa los
  // checkboxes de salientes que ya fueron elegidos como reemplazo.
  function sincronizarSelecciones() {
    const elegidos = new Set([...document.querySelectorAll('.trans-map')].map(s => s.value).filter(Boolean));
    document.querySelectorAll('.trans-map').forEach(sel => {
      [...sel.options].forEach(opt => {
        if (!opt.value) return;
        opt.disabled = elegidos.has(opt.value) && sel.value !== opt.value;
      });
    });
    document.querySelectorAll('.trans-devolver').forEach(chk => {
      const usado = elegidos.has(chk.value);
      chk.disabled = usado;
      if (usado) chk.checked = false;
      chk.closest('tr').style.opacity = usado ? '0.45' : '';
    });
  }

  // Auto-propuesta: para cada entrante sin saliente elegido, toma el primer
  // saliente disponible del MISMO modelo (opciones compatibles van primero).
  function autoProponer() {
    const usados = new Set([...document.querySelectorAll('.trans-map')].map(s => s.value).filter(Boolean));
    let n = 0;
    document.querySelectorAll('.trans-map').forEach(sel => {
      if (sel.value) return;
      const opt = [...sel.options].find(o => o.value && !usados.has(o.value) && !o.textContent.includes('(otro modelo)'));
      if (opt) { sel.value = opt.value; usados.add(opt.value); n++; }
    });
    sincronizarSelecciones();
    Toast.show(n ? `${n} reemplazo(s) propuestos — revisa antes de registrar.` : 'No hay salientes del mismo modelo disponibles para proponer.', n ? 'ok' : 'warn');
  }

  async function guardar() {
    const c = ctx.contrato;
    const mapEntrantes = new Set(ctx.mapeos.map(m => norm(m.entrante)).filter(Boolean));
    const entrantesPend = ctx.entrantes.filter(s => !mapEntrantes.has(norm(s.serial)));

    const salientePorId = new Map(ctx.salientes.map(u => [u.id, u]));
    const nuevos = [];

    document.querySelectorAll('.trans-map').forEach(sel => {
      if (!sel.value) return;
      const ent = entrantesPend[Number(sel.getAttribute('data-idx'))];
      const sal = salientePorId.get(sel.value);
      if (!ent || !sal) return;
      nuevos.push({
        saliente: sal.serial || sal.serial_norm,
        saliente_pool_id: sal.id,
        entrante: ent.serial,
        entrante_pool_id: ctx.poolNuevoPorSerial.get(norm(ent.serial))?.id || null,
        modelo: ent.modelo || sal.modelo_label || '',
        modelo_id: ent.modelo_id || null,
      });
    });
    document.querySelectorAll('.trans-devolver:checked').forEach(chk => {
      const sal = salientePorId.get(chk.value);
      if (!sal) return;
      nuevos.push({
        saliente: sal.serial || sal.serial_norm,
        saliente_pool_id: sal.id,
        entrante: null,
        entrante_pool_id: null,
        modelo: sal.modelo_label || '',
        modelo_id: sal.modelo_id || null,
      });
    });

    if (!nuevos.length) { Toast.show('No hay reemplazos elegidos ni salientes marcados para devolver.', 'warn'); return; }
    if (!window.confirm(`Se registrarán ${nuevos.length} movimiento(s) de transición. Los salientes quedan pendientes de devolución. ¿Continuar?`)) return;

    const btn = $('btnGuardarTrans');
    btn.disabled = true;
    try {
      const uid = firebase.auth().currentUser?.uid || null;
      const batch = db().batch();
      const col = db().collection('contratos').doc(contratoDocId).collection('mapeos');
      nuevos.forEach(m => batch.set(col.doc(), {
        ...m,
        contrato_id: c.contrato_id || contratoDocId,
        contrato_origen_id: c.contrato_origen_id || null,
        at: firebase.firestore.FieldValue.serverTimestamp(),
        por: uid,
      }));
      await batch.commit();
      await notificarTransicion(nuevos);
      Toast.show(`Transición registrada (${nuevos.length}). Se avisó a recepción y al vendedor para coordinar la recuperación.`, 'ok');
      // El trigger tarda un instante en estampar el pool; recargar con margen.
      setTimeout(async () => { await cargarDatos(); render(); }, 1200);
    } catch (e) {
      console.error('Error registrando la transición:', e);
      Toast.show('No se pudo registrar la transición.', 'bad');
      btn.disabled = false;
    }
  }

  // Correo al registrar la transición (best-effort, nunca bloquea el guardado):
  // los SALIENTES quedan "pendiente de devolución" y alguien debe coordinar la
  // recuperación con el cliente — vendedor asignado + recepción
  // (empresa/config.email_recepcion, o todos los usuarios con rol recepción).
  // La devolución física se registra después como ENTRADA (cierre de enmienda /
  // anulación), que ya dispara la orden de inspección con sus propios avisos.
  async function notificarTransicion(nuevos) {
    const salientes = (nuevos || []).filter(m => m.saliente);
    if (!salientes.length) return; // solo entrantes netos: no hay nada que recuperar
    const c = ctx.contrato;
    try {
      // TO: el vendedor asignado del cliente (dueño de la relación — es quien
      // coordina la recuperación). CC: recepción + ventas@ (administración).
      let vendedor = null;
      try {
        if (c.cliente_id) {
          const cli = await db().collection('clientes').doc(c.cliente_id).get();
          const uidV = cli.exists ? cli.data().vendedor_asignado : null;
          if (uidV) {
            const u = await db().collection('usuarios').doc(uidV).get();
            const e = u.exists ? u.data().email : null;
            if (e) vendedor = String(e).toLowerCase();
          }
        }
      } catch (e) { /* sin vendedor asignado */ }

      const copias = new Set(['ventas@cecomunica.com']);
      try {
        const cfg = (typeof EmpresaService !== 'undefined') ? await EmpresaService.getConfig() : {};
        (Array.isArray(cfg.email_recepcion) ? cfg.email_recepcion : [])
          .forEach(e => { if (e) copias.add(String(e).toLowerCase()); });
      } catch (e) { /* cae al rol */ }
      if (copias.size === 1) { // solo ventas@: resolver recepción por rol
        const qs = await db().collection('usuarios').where('rol', '==', 'recepcion').get();
        qs.forEach(d => { const e = d.data()?.email; if (e) copias.add(String(e).toLowerCase()); });
      }
      if (vendedor) copias.delete(vendedor);
      const lista = vendedor ? [vendedor, ...copias] : [...copias];
      if (!lista.length) return;

      const filas = salientes.map(m => `
        <tr>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;font-family:monospace;">${esc(m.saliente)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${esc(m.modelo || '—')}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #eee;">${m.entrante ? `reemplazado por <b style="font-family:monospace;">${esc(m.entrante)}</b>` : 'sale sin sustituto'}</td>
        </tr>`).join('');

      await db().collection('mail_queue').add({
        to: lista[0],
        cc: lista.length > 1 ? lista.slice(1).join(',') : null,
        subject: `Transición de equipos: ${c.contrato_id || contratoDocId} – ${c.cliente_nombre || ''} (${salientes.length} por recuperar)`,
        preheader: `${salientes.length} equipo(s) del cliente quedaron pendientes de devolución`,
        bodyContent: `
          <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#92400e;">Equipos pendientes de devolución</h2>
          <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
            Se registró la transición de equipos del contrato <b>${esc(c.contrato_id || contratoDocId)}</b>
            de <b>${esc(c.cliente_nombre || '—')}</b>. Los siguientes equipos siguen con el cliente y
            <b>hay que coordinar su recuperación</b>:
          </p>
          <table role="presentation" width="100%" style="border-collapse:collapse;font:14px Arial,sans-serif;margin:8px 0 12px;">
            <thead><tr>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Serial saliente</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Modelo</th>
              <th style="text-align:left;padding:6px 8px;border-bottom:2px solid #e5e7eb;">Situación</th>
            </tr></thead>
            <tbody>${filas}</tbody>
          </table>
          <p style="margin:0 0 12px;font:13px/1.5 Arial,sans-serif;color:#6b7280;">
            Cuando el cliente entregue los equipos, regístralo al <b>cerrar la enmienda</b> o
            <b>anular el contrato original</b> — eso los pasa a inspección y crea la orden de ENTRADA
            para el taller automáticamente.
          </p>`,
        ctaUrl: `${location.origin}/contratos/transicion.html?id=${encodeURIComponent(contratoDocId)}`,
        ctaLabel: 'Ver transición de equipos',
        meta: {
          created_at: firebase.firestore.FieldValue.serverTimestamp(),
          source: 'transicion-equipos',
          contrato_id: c.contrato_id || contratoDocId,
        },
        status: 'queued',
      });
    } catch (e) {
      console.warn('No se pudo enviar el aviso de transición (no crítico):', e);
    }
  }
})();
