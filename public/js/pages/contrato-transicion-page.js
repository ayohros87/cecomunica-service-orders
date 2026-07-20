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

    // SALIENTES: anclados a los contratos originales vinculados (multi: una
    // renovación puede consolidar varios contratos viejos); si no hay vínculo
    // (o legacy/papel), a TODOS los equipos del cliente en el pool —
    // excluyendo lo asignado al contrato nuevo. Solo unidades con el cliente.
    let salientes = [];
    try {
      const origenIds = (Array.isArray(c.contrato_origen_ids) && c.contrato_origen_ids.length)
        ? c.contrato_origen_ids
        : (c.contrato_origen_id ? [c.contrato_origen_id] : []);
      if (origenIds.length) {
        const listas = await Promise.all(origenIds.map(id => EquiposPoolService.listarPorContrato(id)));
        const vistos = new Set();
        salientes = listas.flat().filter(u => !vistos.has(u.id) && vistos.add(u.id));
      } else {
        salientes = await EquiposPoolService.listarPorCliente(c.cliente_id);
      }
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
    // Devoluciones/reemplazos vs excepciones (no_devuelve) se separan: las
    // excepciones NO son "pendientes de devolución" — solo salen de la lista
    // por resolver y quedan en la tabla "Transición registrada".
    const mapSalientes = new Set(ctx.mapeos.filter(m => m.tipo !== 'no_devuelve').map(m => norm(m.saliente)).filter(Boolean));
    const excepSalientes = new Set(ctx.mapeos.filter(m => m.tipo === 'no_devuelve').map(m => norm(m.saliente)).filter(Boolean));
    const mapEntrantes = new Set(ctx.mapeos.map(m => norm(m.entrante)).filter(Boolean));

    const entrantesPend = ctx.entrantes.filter(s => !mapEntrantes.has(norm(s.serial)));
    const salientesDisp = ctx.salientes.filter(u =>
      !mapSalientes.has(norm(u.serial || u.serial_norm))
      && !excepSalientes.has(norm(u.serial || u.serial_norm))
      && !u.pendiente_devolucion);
    const salientesEnTransicion = ctx.salientes.filter(u =>
      mapSalientes.has(norm(u.serial || u.serial_norm)) || u.pendiente_devolucion);

    // Aviso de ancla: con vínculo al/los originales se listan SUS equipos;
    // sin vínculo, todos los del cliente (caso legacy/papel — §3.4).
    const origenRefs = (Array.isArray(c.contrato_origen_refs) && c.contrato_origen_refs.length)
      ? c.contrato_origen_refs
      : (c.contrato_origen_id ? [c.contrato_origen_ref || c.contrato_origen_id] : []);
    const ancla = origenRefs.length
      ? `Equipos ${origenRefs.length > 1 ? 'de los contratos originales' : 'del contrato original'} <b>${origenRefs.map(esc).join('</b>, <b>')}</b>`
      : (c.origen_tipo === 'legacy'
          ? `Contrato original en papel${c.origen_legacy_ref ? ` (<b>${esc(c.origen_legacy_ref)}</b>)` : ''} — se listan todos los equipos del cliente en el pool`
          : 'Sin contrato original vinculado — se listan todos los equipos del cliente en el pool');

    // Propiedad: los equipos PROPIOS del cliente no se devuelven (son suyos);
    // el default de devolución aplica solo al alquiler. 'desconocida' se trata
    // como alquiler — lado seguro para el inventario (la excepción se
    // justifica con un clic si resultara propio).
    const propios  = salientesDisp.filter(u => u.propiedad === 'cliente');
    const alquiler = salientesDisp.filter(u => u.propiedad !== 'cliente');
    const MOTIVOS_NO_DEV = [
      ['parcial', 'Renovación parcial — sigue en servicio'],
      ['vendido', 'Se vendió al cliente'],
      ['perdido', 'Perdido — pendiente de cobro'],
      ['otro',    'Otro (detallar)'],
    ];

    // Selector de saliente para cada entrante pendiente (mismo modelo primero).
    const opcionesSaliente = (ent) => {
      const compatibles = [], otros = [];
      alquiler.forEach(u => {
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

    // Default: TODO el alquiler se devuelve (checkbox marcado). Desmarcar es
    // la excepción y exige motivo (renovación parcial / vendido / perdido…).
    const filasSalientes = alquiler.length ? alquiler.map(u => `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">
          <input type="checkbox" class="trans-devolver" checked value="${esc(u.id)}" data-serial="${esc(u.serial || u.serial_norm)}" style="width:16px;height:16px;">
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);">
          <a class="eq-link" href="${EquiposPoolService.kardexUrl(u.serial || u.serial_norm)}">${esc(u.serial || u.serial_norm)}</a>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">${esc(u.modelo_label || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);">${EquiposPoolService.chipEstadoHtml(u.estado)}</td>
        <td class="celda-motivo" style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);display:none;">
          <select class="form-select trans-motivo" style="height:30px;font-size:12px;max-width:260px;">
            <option value="">Motivo de NO devolución…</option>
            ${MOTIVOS_NO_DEV.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}
          </select>
          <input class="form-input trans-motivo-detalle" placeholder="Detalle" style="display:none;height:30px;font-size:12px;margin-top:4px;max-width:260px;">
        </td>
      </tr>`).join('')
      : `<tr><td colspan="5" style="padding:12px;color:var(--fg-3);">No quedan equipos de alquiler del cliente por resolver.</td></tr>`;

    const filasMapeos = ctx.mapeos.length ? ctx.mapeos.map(m => m.sin_reemplazos ? `
      <tr>
        <td colspan="4" style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);color:var(--fg-3);">
          Cerrada <b>sin reemplazos</b> — los equipos nuevos no sustituyen a ninguno (adición pura)
        </td>
      </tr>` : m.tipo === 'no_devuelve' ? `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);">${esc(m.saliente || '—')}</td>
        <td colspan="3" style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);color:#92400e;">
          NO se devuelve — ${esc((MOTIVOS_NO_DEV.find(([v]) => v === m.motivo_codigo) || [,'motivo registrado'])[1])}${m.motivo_detalle ? `: ${esc(m.motivo_detalle)}` : ''}
        </td>
      </tr>` : `
      <tr>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);color:#991b1b;">${esc(m.saliente || '—')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);text-align:center;">→</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);font-family:var(--font-mono,monospace);color:#065f46;">${esc(m.entrante || '— (se devuelve sin sustituto)')}</td>
        <td style="padding:6px 8px;border-bottom:1px solid var(--border-subtle);color:var(--fg-3);">${esc(m.modelo || '')}</td>
      </tr>`).join('') : '';

    // Vincular contrato(s) original(es) DESPUÉS de crear el contrato: el form
    // de nuevo-contrato lo ofrece, pero si se omitió, aquí es donde se
    // descubre que falta (los salientes salen sin ancla). Multi-selección.
    const vincularHtml = (!origenRefs.length && c.cliente_id) ? `
      <div style="margin-top:8px;">
        <div id="listOrigenTrans" style="display:flex;flex-direction:column;gap:4px;max-height:160px;overflow:auto;border:1px solid var(--border-subtle);border-radius:8px;padding:8px 10px;">
          <span style="color:var(--fg-3);">Cargando contratos del cliente…</span>
        </div>
        <button type="button" class="btn btn-sm" id="btnVincularOrigen" style="margin-top:6px;"><i data-lucide="link"></i> Vincular original(es)</button>
      </div>` : '';

    $('transBody').innerHTML = `
      <div class="ds-card ds-card-padded" style="margin-bottom:var(--sp-3);font-size:13px;color:var(--fg-2);">
        <i data-lucide="info" style="width:14px;height:14px;vertical-align:-2px;"></i>
        ${ancla}. Puede haber <b>menos o más</b> entrantes que salientes: mapea lo que aplique.
        Los salientes quedan <b>pendientes de devolución</b> (el cliente los conserva durante la
        transición); su devolución se registra después como <b>Entrada</b> al cerrar la enmienda o anular el contrato original.
        ${vincularHtml}
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
        <div style="font-weight:600;margin-bottom:8px;">Equipos de alquiler que se devuelven (${alquiler.length})</div>
        <p style="margin:0 0 8px;font-size:12px;color:var(--fg-3);"><b>Todos se devuelven por defecto.</b> Desmarca solo la excepción (renovación parcial, vendido, perdido…) — el motivo es obligatorio. Los elegidos arriba como reemplazo se resuelven solos.</p>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:640px;">
            <thead><tr style="text-align:left;color:var(--fg-3);font-size:12px;">
              <th style="padding:6px 8px;" title="Se devuelve">↩</th><th style="padding:6px 8px;">Serial</th><th style="padding:6px 8px;">Modelo</th><th style="padding:6px 8px;">Estado</th><th style="padding:6px 8px;">Si NO se devuelve</th>
            </tr></thead>
            <tbody>${filasSalientes}</tbody>
          </table>
        </div>
      </div>

      ${propios.length ? `
      <div class="ds-card ds-card-padded" style="margin-bottom:var(--sp-3);">
        <div style="font-weight:600;margin-bottom:8px;">Equipos PROPIOS del cliente (${propios.length}) — no se devuelven</div>
        <p style="margin:0 0 8px;font-size:12px;color:var(--fg-3);">Son propiedad del cliente; quedan fuera de la devolución. Solo informativo.</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          ${propios.map(u => `<span class="eqpool-chip" title="${esc(u.modelo_label || '')}">${esc(u.serial || u.serial_norm)}</span>`).join('')}
        </div>
      </div>` : ''}

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

      <div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;">
        ${ctx.mapeos.length ? '<span></span>' : `<button type="button" class="btn btn-ghost" id="btnSinReemplazos" title="Los equipos de este contrato no sustituyen a ninguno (adición pura): cierra la transición sin mapeos"><i data-lucide="circle-slash-2"></i> Cerrar sin reemplazos</button>`}
        <button type="button" class="btn btn-primary" id="btnGuardarTrans"><i data-lucide="check"></i> Registrar transición</button>
      </div>`;

    $('btnAutoMapa')?.addEventListener('click', autoProponer);
    $('btnGuardarTrans')?.addEventListener('click', guardar);
    $('btnSinReemplazos')?.addEventListener('click', cerrarSinReemplazos);
    $('btnVincularOrigen')?.addEventListener('click', vincularOrigen);
    poblarVinculo();
    // Un saliente elegido en un select desaparece de las opciones de los demás
    // y de la lista de "se devuelve sin sustituto" (checkbox se desmarca/oculta).
    document.querySelectorAll('.trans-map').forEach(sel => sel.addEventListener('change', sincronizarSelecciones));
    // Desmarcar "se devuelve" abre el motivo de la excepción (obligatorio).
    document.querySelectorAll('.trans-devolver').forEach(chk => chk.addEventListener('change', () => {
      const celda = chk.closest('tr')?.querySelector('.celda-motivo');
      if (celda) celda.style.display = (chk.checked || chk.disabled) ? 'none' : '';
    }));
    document.querySelectorAll('.trans-motivo').forEach(sel => sel.addEventListener('change', () => {
      const det = sel.closest('.celda-motivo')?.querySelector('.trans-motivo-detalle');
      if (det) det.style.display = sel.value === 'otro' ? '' : 'none';
    }));
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
      // Resuelto por reemplazo → no es excepción: el motivo no aplica.
      const celda = chk.closest('tr')?.querySelector('.celda-motivo');
      if (celda) celda.style.display = (chk.checked || chk.disabled) ? 'none' : '';
    });
  }

  // Cierre sin reemplazos — para adiciones puras. Antes era un callejón sin
  // salida: guardar() exige al menos un saliente, así que un contrato cuyos
  // equipos no sustituyen a ninguno jamás limpiaba la CTA "Transición de
  // equipos" de la lista. El doc marcador incrementa transicion_mapeos_count
  // vía onMapeoWrite (que no aplica linaje al no traer seriales).
  async function cerrarSinReemplazos() {
    const c = ctx.contrato;
    if (!window.confirm('Confirma que los equipos de este contrato NO sustituyen a ninguno existente (adición pura).\n\nLa lista dejará de pedir la transición. Si más adelante sí hay reemplazos, puedes registrarlos aquí mismo.')) return;
    try {
      await db().collection('contratos').doc(contratoDocId).collection('mapeos').add({
        sin_reemplazos: true,
        saliente: null, saliente_pool_id: null,
        entrante: null, entrante_pool_id: null,
        contrato_id: c.contrato_id || contratoDocId,
        contrato_origen_id: c.contrato_origen_id || null,
        at: firebase.firestore.FieldValue.serverTimestamp(),
        por: firebase.auth().currentUser?.uid || null,
      });
      Toast.show('Transición cerrada sin reemplazos.', 'ok');
      setTimeout(async () => { await cargarDatos(); render(); }, 1200);
    } catch (e) {
      console.error('Error cerrando sin reemplazos:', e);
      Toast.show('No se pudo cerrar la transición.', 'bad');
    }
  }

  // Vincular el contrato original a posteriori (el form lo ofrece al crear,
  // pero aquí es donde se nota si faltó). Ancla los salientes al original en
  // vez de listar todos los equipos del cliente.
  async function poblarVinculo() {
    const list = $('listOrigenTrans');
    if (!list) return;
    try {
      const contratos = await ContratosService.getContratosActivosPorCliente(ctx.contrato.cliente_id);
      const otros = (contratos || []).filter(k => k.id !== contratoDocId);
      list.innerHTML = otros.length
        ? otros.map(k => `
            <label class="form-check" style="margin:0;">
              <input type="checkbox" class="origen-trans-chk" value="${esc(k.id)}" data-ref="${esc(k.contrato_id || k.id)}">
              <span><span class="form-check-label">${esc(k.contrato_id || k.id)} · ${esc(k.tipo_contrato || '')} · ${esc(k.estado || '')}</span></span>
            </label>`).join('')
        : '<span style="color:var(--fg-3);">El cliente no tiene otros contratos vigentes</span>';
    } catch (e) {
      list.innerHTML = '<span style="color:var(--fg-3);">No se pudieron cargar los contratos</span>';
    }
  }

  async function vincularOrigen() {
    const chks = [...document.querySelectorAll('#listOrigenTrans .origen-trans-chk:checked')];
    if (!chks.length) { Toast.show('Marca al menos un contrato original de la lista.', 'warn'); return; }
    const ids  = chks.map(c => c.value);
    const refs = chks.map(c => c.getAttribute('data-ref') || c.value);
    try {
      await ContratosService.updateContrato(contratoDocId, {
        contrato_origen_id: ids[0],
        contrato_origen_ref: refs[0],
        contrato_origen_ids: ids,
        contrato_origen_refs: refs,
        origen_tipo: 'sistema',
      });
      Object.assign(ctx.contrato, {
        contrato_origen_id: ids[0], contrato_origen_ref: refs[0],
        contrato_origen_ids: ids, contrato_origen_refs: refs,
      });
      Toast.show(`Vinculado a ${refs.join(', ')} — los salientes ahora se anclan a ${ids.length > 1 ? 'esos contratos' : 'ese contrato'}.`, 'ok');
      await cargarDatos(); render();
    } catch (e) {
      console.error('Error vinculando el contrato original:', e);
      Toast.show('No se pudo vincular el contrato original.', 'bad');
    }
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

    // Excepciones: alquiler desmarcado (y no resuelto por reemplazo) exige
    // motivo. Se registra como mapeo tipo 'no_devuelve' — auditable, y
    // onMapeoWrite estampa la excepción en el kardex de la unidad.
    let sinMotivo = null;
    document.querySelectorAll('.trans-devolver').forEach(chk => {
      if (chk.checked || chk.disabled) return;
      const sal = salientePorId.get(chk.value);
      if (!sal) return;
      const fila = chk.closest('tr');
      const motivo  = fila?.querySelector('.trans-motivo')?.value || '';
      const detalle = (fila?.querySelector('.trans-motivo-detalle')?.value || '').trim();
      if (!motivo || (motivo === 'otro' && !detalle)) { sinMotivo = sal.serial || sal.serial_norm; return; }
      nuevos.push({
        tipo: 'no_devuelve',
        saliente: sal.serial || sal.serial_norm,
        saliente_pool_id: sal.id,
        entrante: null,
        entrante_pool_id: null,
        modelo: sal.modelo_label || '',
        modelo_id: sal.modelo_id || null,
        motivo_codigo: motivo,
        motivo_detalle: detalle,
      });
    });
    if (sinMotivo) { Toast.show(`El serial ${sinMotivo} quedó sin devolver y sin motivo — elige el motivo de la excepción o vuelve a marcarlo.`, 'warn'); return; }

    if (!nuevos.length) { Toast.show('No hay nada que registrar. Si la adición no sustituye equipos, usa "Cerrar sin reemplazos".', 'warn'); return; }
    const nDevuelven = nuevos.filter(m => m.tipo !== 'no_devuelve' && m.saliente).length;
    const nExcep = nuevos.filter(m => m.tipo === 'no_devuelve').length;
    if (!window.confirm(`Se registrarán ${nDevuelven} devolución(es)${nExcep ? ` y ${nExcep} excepción(es) justificada(s)` : ''}. Los que se devuelven quedan pendientes de devolución. ¿Continuar?`)) return;

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
