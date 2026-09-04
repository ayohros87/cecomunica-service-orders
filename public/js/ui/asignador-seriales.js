// @ts-nocheck
// Asignador de seriales — el formulario "una unidad, un serial" que comparten
// la página de seriales del contrato (contratos/seriales.html) y la pestaña
// Asignar de Almacén (almacen/index.html). Propuesta "Asignar desde Almacén"
// 2026-09-03, F0: antes el formulario vivía dos veces (contrato-seriales-page
// y el expediente de gestiones del Centro) con dos validaciones distintas.
//
// El componente NO sabe de Firestore: recibe los cupos por modelo, deja que
// la persona los llene (teclear, pegar columna, picker del pool) y devuelve
// los seriales. Quién guarda y dónde lo decide la página que lo monta.
//
// Contrato de DOM (lo consultan las páginas que lo montan, no cambiarlo):
//   .serial-group[data-modelo][data-modelo-id][data-activos]
//     .serial-row  > .serial-input  .omit-toggle  .motivo-input
//     .paste-box   > .paste-area
//     .grupo-progreso
//
// Dos políticas de validación contra el pool:
//   · 'suave' (contratos/seriales.html; recepción, vendedores, admin): avisa,
//     nunca frena — registro legacy y correcciones.
//   · 'dura'  (Almacén; bodega): el serial debe existir en el pool, estar en
//     bodega y ser del modelo pedido. Excepciones explícitas (mismo contrato,
//     unidades que continúan del original) y "modelo distinto" solo con motivo.
window.AsignadorSeriales = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));
  const normDefault = (s) => (typeof ContratosService !== 'undefined' && ContratosService._serialKey)
    ? ContratosService._serialKey(s)
    : String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  function crear(opts = {}) {
    const body = opts.body;
    if (!body) throw new Error('AsignadorSeriales.crear: falta body');
    const norm = opts.norm || normDefault;
    const permitirOmitir = opts.permitirOmitir !== false;
    const politica = opts.politica === 'dura' ? 'dura' : 'suave';
    const toast = (msg, kind) => { if (window.Toast) Toast.show(msg, kind); };
    const st = { grupos: [], wired: false, contratoDocId: opts.contratoDocId || null,
                 clienteId: opts.clienteId || null, esLegacy: !!opts.esLegacy, guardados: new Set() };

    // ── Render ─────────────────────────────────────────────────────────
    // grupos: [{ modelo, modelo_id, activos, slots: [{serial|omitido,motivo|bloqueado, etiqueta}], titulo, nota }]
    function render(grupos) {
      st.grupos = grupos || [];
      const html = st.grupos.map(g => {
        const activos = Number(g.activos || 0);
        if (activos <= 0) return '';
        const slots = (g.slots || []).slice();
        while (slots.length < activos) slots.push({});
        const filas = slots.map((slot, i) => rowHtml(g, i + 1, slot)).join('');
        const clave = g.clave != null ? ` data-clave="${esc(g.clave)}"` : '';
        return `
        <div class="serial-group ds-card ds-card-padded" data-modelo="${esc(g.modelo)}" data-modelo-id="${esc(g.modelo_id || '')}" data-activos="${activos}"${clave} style="margin-bottom:var(--sp-3);">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap;">
            <div style="font-weight:600;">${g.titulo || esc(g.modelo)}
              <span class="grupo-progreso" style="color:var(--fg-3); font-weight:400;">· 0/${activos}</span>
              ${g.nota ? `<span class="grupo-nota" style="color:var(--fg-3); font-weight:400; font-size:12.5px; margin-left:6px;">${g.nota}</span>` : ''}
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
      body.innerHTML = html || `<div class="ds-card ds-card-padded" style="color:var(--fg-3);">${esc(opts.textoVacio || 'No hay unidades que serializar.')}</div>`;
      wire();
      refresh();
      if (window.lucide) lucide.createIcons();
      return !!html;
    }

    function rowHtml(g, num, slot) {
      const omit = !!slot?.omitido;
      const bloqueado = !!slot?.bloqueado;
      const etiqueta = slot?.etiqueta ? `<span class="serial-etiqueta" style="font-size:12.5px; color:var(--fg-3); white-space:nowrap;">${slot.etiqueta}</span>` : '';
      return `
      <div class="serial-row${bloqueado ? ' bloqueado' : ''}">
        <span class="serial-num">${esc(String(num))}.</span>
        ${etiqueta}
        <input class="serial-input form-input${slot?.clase ? ' ' + esc(slot.clase) : ''}" data-modelo="${esc(g.modelo)}" data-modelo-id="${esc(g.modelo_id || '')}"
               value="${esc(slot?.serial || '')}" placeholder="Número de serie" ${(omit || bloqueado) ? 'disabled' : ''}
               ${slot?.dataReemplazo ? `data-reemplazo="${esc(slot.dataReemplazo)}"` : ''}>
        <label class="serial-omit" ${permitirOmitir && !bloqueado ? '' : 'style="display:none;"'}><input type="checkbox" class="omit-toggle" ${omit ? 'checked' : ''} ${bloqueado ? 'disabled' : ''}> Sin serial</label>
        <input class="motivo-input form-input" placeholder="Motivo (por qué no lleva serial)"
               value="${esc(slot?.motivo || '')}" style="${omit ? '' : 'display:none;'}" ${bloqueado ? 'disabled' : ''}>
      </div>`;
    }

    // ── Wiring (una sola vez por body) ─────────────────────────────────
    function wire() {
      if (st.wired) return;
      st.wired = true;
      body.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn || !body.contains(btn)) return;
        const action = btn.getAttribute('data-action');
        const grupo = btn.closest('.serial-group');
        if (!grupo) return;
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
      // SerialField: chip persistente con el estado del serial en el pool.
      body.addEventListener('focusout', (e) => {
        const inp = e.target;
        if (!inp.classList?.contains('serial-input')) return;
        if (typeof SerialField === 'undefined' || typeof EquiposPoolService === 'undefined') return;
        if (inp._sfAdjuntado) return;
        SerialField.adjuntar(inp, {
          clienteId: () => st.clienteId || null,
          modelo: () => ({ modelo_id: inp.getAttribute('data-modelo-id') || null,
                           modelo_label: inp.getAttribute('data-modelo') || '' }),
        });
      });
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

    // Pegar multilínea sobre una casilla → reparte líneas/tabs en esta casilla
    // y las siguientes del mismo grupo (estilo hoja de cálculo).
    function onPasteSerial(e) {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      if (!text || !/[\r\n\t]/.test(text)) return;
      e.preventDefault();
      const vals = text.split(/[\r\n\t]+/).map(s => s.trim()).filter(Boolean);
      fillFrom(e.target.closest('.serial-group'), e.target, vals);
    }

    // Reparte `vals` a partir de `startInput`, SIN crear filas: la cantidad la
    // fija el contrato. Los de más se descartan y se avisa.
    function fillFrom(grupo, startInput, vals) {
      const inputs = [...grupo.querySelectorAll('.serial-input')].filter(i => !i.closest('.serial-row').classList.contains('bloqueado'));
      let idx = inputs.indexOf(startInput);
      if (idx < 0) idx = 0;
      let applied = 0;
      for (const v of vals) {
        const inp = inputs[idx];
        if (!inp) break;
        const chk = inp.closest('.serial-row').querySelector('.omit-toggle');
        if (chk && chk.checked) { chk.checked = false; onOmitToggle(chk); }
        inp.disabled = false;
        inp.value = v;
        idx++;
        applied++;
      }
      refresh();
      const dropped = vals.length - applied;
      if (dropped > 0) {
        const req = Number(grupo.getAttribute('data-activos') || inputs.length);
        toast(`Se pegaron ${applied}; ${dropped} de más se ignoraron (este modelo tiene ${req} unidad(es)).`, 'warn');
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
      const inputs = [...grupo.querySelectorAll('.serial-input')];
      const start = inputs.find(i => !i.disabled && !i.value.trim()) || inputs[0];
      const applied = fillFrom(grupo, start, vals);
      togglePaste(grupo, false);
      if (applied === vals.length) toast(`${applied} serial(es) pegados.`, 'ok');
    }

    // ── Progreso + duplicados ──────────────────────────────────────────
    function refresh() {
      const seen = new Map();
      const inputs = [...body.querySelectorAll('.serial-input')];
      inputs.forEach(i => i.classList.remove('dup'));
      inputs.forEach(i => {
        if (i.disabled && !i.closest('.serial-row').classList.contains('bloqueado')) return;
        const v = norm(i.value);
        if (!v) return;
        if (seen.has(v)) { i.classList.add('dup'); seen.get(v).classList.add('dup'); }
        else seen.set(v, i);
      });
      let totalReq = 0, totalDone = 0;
      body.querySelectorAll('.serial-group').forEach(grupo => {
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
      if (typeof opts.onChange === 'function') opts.onChange({ done: totalDone, req: totalReq });
      return { done: totalDone, req: totalReq };
    }

    // ── Collect + validate ─────────────────────────────────────────────
    function collect() {
      const seriales = [];
      const omisiones = [];
      body.querySelectorAll('.serial-row').forEach(row => {
        const inp = row.querySelector('.serial-input');
        const omit = row.querySelector('.omit-toggle').checked;
        const motivo = row.querySelector('.motivo-input').value.trim();
        const modelo = inp.getAttribute('data-modelo') || '';
        const modeloId = inp.getAttribute('data-modelo-id') || '';
        const clave = row.closest('.serial-group')?.getAttribute('data-clave');
        if (omit) {
          if (motivo) omisiones.push({ modelo, modelo_id: modeloId, motivo });
        } else {
          const serial = inp.value.trim();
          if (serial) seriales.push({ modelo, modelo_id: modeloId, serial, source: 'manual', ...(clave != null ? { clave } : {}) });
        }
      });
      return { seriales, omisiones };
    }

    // Para confirmar: cada unidad activa con serial O omitida con motivo, y
    // sin duplicados.
    function validarCompleto() {
      if (body.querySelector('.serial-input.dup')) return 'Hay seriales duplicados (marcados en rojo).';
      const faltan = [];
      body.querySelectorAll('.serial-group').forEach(grupo => {
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

    function presentes() {
      const set = new Set();
      body.querySelectorAll('.serial-input').forEach(i => { const v = norm(i.value); if (v) set.add(v); });
      return set;
    }

    // Deshabilita toda edición (candado). Devuelve el body para que la página
    // reabra lo que necesite (modo reemplazo).
    function setLocked(locked) {
      body.querySelectorAll('input, textarea, button').forEach(el => { el.disabled = !!locked; });
      if (!locked) {
        // Al desbloquear, respetar las filas "sin serial" y las bloqueadas.
        body.querySelectorAll('.serial-row').forEach(row => {
          const omit = row.querySelector('.omit-toggle').checked;
          const bloq = row.classList.contains('bloqueado');
          if (omit || bloq) row.querySelector('.serial-input').disabled = true;
          if (bloq) { row.querySelector('.omit-toggle').disabled = true; row.querySelector('.motivo-input').disabled = true; }
        });
      }
      return body;
    }

    // ── Buscador dentro del formulario ─────────────────────────────────
    function aplicarBusqueda(q, conScroll) {
      const k = norm(q);
      const inputs = [...body.querySelectorAll('.serial-input')];
      inputs.forEach(i => i.classList.remove('buscado'));
      if (!k) return [];
      const hits = inputs.filter(i => norm(i.value).includes(k));
      hits.forEach(i => i.classList.add('buscado'));
      if (conScroll && hits.length) hits[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
      return hits;
    }

    // ── Jalar seriales a los cupos vacíos ──────────────────────────────
    // items: [{serial, modelo, modeloId}]. Match por modelo_id o nombre
    // normalizado; dedupe contra lo presente; no toca filas "sin serial" ni
    // bloqueadas. Reporta cuántos entraron / duplicados / sin cupo / sin modelo.
    function jalarItems(items, origen) {
      const grupos = [...body.querySelectorAll('.serial-group')];
      if (!grupos.length) { toast('No hay modelos que serializar.', 'warn'); return 0; }
      const pres = presentes();
      const porId = new Map(), porNombre = new Map();
      grupos.forEach(g => {
        const mid = g.getAttribute('data-modelo-id') || '';
        const mnom = norm(g.getAttribute('data-modelo') || '');
        if (mid && !porId.has(mid)) porId.set(mid, g);
        if (mnom && !porNombre.has(mnom)) porNombre.set(mnom, g);
      });
      const cupoEn = (grupo) => [...grupo.querySelectorAll('.serial-row')].find(row => {
        const inp = row.querySelector('.serial-input');
        const omit = row.querySelector('.omit-toggle')?.checked;
        return inp && !inp.disabled && !omit && !inp.value.trim() && !row.classList.contains('bloqueado');
      });
      let agregados = 0, duplicados = 0, sinModelo = 0, sinCupo = 0;
      for (const it of (items || [])) {
        const serial = String(it.serial || '').trim();
        if (!serial) continue;
        const key = norm(serial);
        if (pres.has(key)) { duplicados++; continue; }
        // Cuando el mismo modelo aparece en varios grupos (p.ej. reemplazos, un
        // grupo por unidad), se busca el primer grupo compatible con cupo.
        let grupo = (it.modeloId && porId.get(it.modeloId)) || porNombre.get(norm(it.modelo)) || null;
        if (grupo && !cupoEn(grupo)) {
          grupo = grupos.find(g => cupoEn(g) && (
            (it.modeloId && g.getAttribute('data-modelo-id') === it.modeloId)
            || norm(g.getAttribute('data-modelo')) === norm(it.modelo))) || grupo;
        }
        if (!grupo) { sinModelo++; continue; }
        const slot = cupoEn(grupo);
        if (!slot) { sinCupo++; continue; }
        slot.querySelector('.serial-input').value = serial;
        pres.add(key);
        agregados++;
      }
      refresh();
      const partes = [`${agregados} agregado(s)`];
      if (duplicados) partes.push(`${duplicados} ya presentes`);
      if (sinCupo) partes.push(`${sinCupo} sin cupo`);
      if (sinModelo) partes.push(`${sinModelo} sin modelo en la lista`);
      toast(`${origen ? `Desde ${origen}: ` : ''}${partes.join(' · ')}.`, agregados ? 'ok' : 'warn');
      return agregados;
    }

    // ── Picker del pool (unidades en bodega, FIFO por ingreso) ─────────
    async function tomarDelPool() {
      if (typeof EquiposPoolService === 'undefined') { toast('El pool de equipos no está disponible.', 'bad'); return; }
      let enBodega;
      try {
        enBodega = await EquiposPoolService.listar({ estado: EquiposPoolService.ESTADOS.EN_BODEGA });
      } catch (e) {
        console.error('Error consultando el pool:', e);
        toast('No se pudo consultar el pool de equipos.', 'bad');
        return;
      }
      if (!enBodega.length) { toast('No hay equipos disponibles en bodega. Recibe equipos primero.', 'warn'); return; }
      abrirPickerPool(enBodega);
    }

    function abrirPickerPool(enBodega) {
      const grupos = [...body.querySelectorAll('.serial-group')];
      if (!grupos.length) { toast('No hay modelos que serializar.', 'warn'); return; }
      const pres = presentes();
      const secciones = [];
      // Agrupar por modelo aunque haya varios grupos del mismo (reemplazos).
      const porModelo = new Map();
      grupos.forEach(g => {
        const modelo = g.getAttribute('data-modelo') || '';
        const modeloId = g.getAttribute('data-modelo-id') || '';
        const cupos = [...g.querySelectorAll('.serial-row')].filter(row => {
          const inp = row.querySelector('.serial-input');
          const omit = row.querySelector('.omit-toggle')?.checked;
          return inp && !inp.disabled && !omit && !inp.value.trim() && !row.classList.contains('bloqueado');
        }).length;
        if (!cupos) return;
        const k = modeloId || norm(modelo);
        const cur = porModelo.get(k) || { modelo, modeloId, cupos: 0 };
        cur.cupos += cupos;
        porModelo.set(k, cur);
      });
      for (const s of porModelo.values()) {
        const unidades = enBodega
          .filter(d => EquiposPoolService._mismoModelo(d, s.modeloId, s.modelo) && !pres.has(norm(d.serial || d.serial_norm)))
          .sort((a, b) => (a.ingreso_bodega_at?.toMillis?.() || 0) - (b.ingreso_bodega_at?.toMillis?.() || 0)
            || String(a.serial || '').localeCompare(String(b.serial || '')));
        secciones.push({ ...s, unidades });
      }
      if (!secciones.length) { toast('No hay cupos vacíos que llenar: todos los seriales están colocados u omitidos.', 'warn'); return; }
      if (!secciones.some(s => s.unidades.length)) {
        toast('En bodega no hay unidades de estos modelos. Recibe equipos primero.', 'warn');
        return;
      }
      const titulo = opts.tituloPicker || 'Tomar del pool (bodega)';
      const seccionesHtml = secciones.map((s, si) => {
        const filas = s.unidades.map(u => `
          <label class="pp-item" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid var(--border-subtle,#eee);cursor:pointer;font-size:13px;">
            <input type="checkbox" class="pp-check" value="${esc(u.serial || u.serial_norm)}" data-grupo="${si}" style="width:16px;height:16px;">
            <span class="pp-serial" style="font-family:var(--font-mono,monospace);">${esc(u.serial || u.serial_norm)}</span>
            <span style="margin-left:auto;color:var(--fg-3);font-size:12px;">${u.condicion === 'reuso' ? 'Refurbished' : 'Nuevo'}</span>
          </label>`).join('');
        return `
          <div class="pp-grupo" data-grupo="${si}" style="margin-bottom:12px;">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin:4px 0;">
              <div style="font-weight:600;">${esc(s.modelo)}</div>
              <div class="pp-progreso" style="color:var(--fg-3);font-size:12px;">0/${s.cupos} · ${s.unidades.length} disponible(s)</div>
            </div>
            ${s.unidades.length
              ? `<div style="border:1px solid var(--border-subtle,#e5e7eb);border-radius:8px;overflow:hidden;">${filas}</div>`
              : `<div style="border:1px dashed var(--border-subtle,#e5e7eb);border-radius:8px;padding:10px;color:var(--fg-3);font-size:13px;">Sin unidades en bodega de este modelo.</div>`}
          </div>`;
      }).join('');

      const overlay = document.createElement('div');
      overlay.id = 'overlayPoolPicker';
      overlay.className = 'modal-backdrop open';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.innerHTML = `
        <div class="modal" style="max-width:640px;width:100%;">
          <div class="modal-header">
            <h3 class="modal-title"><i data-lucide="scan-barcode"></i> ${esc(titulo)}</h3>
            <button type="button" class="modal-close" data-pp="cerrar" aria-label="Cerrar"><i data-lucide="x" style="width:18px;height:18px;"></i></button>
          </div>
          <div class="modal-body" style="max-height:56vh;overflow:auto;">
            <p style="margin:0 0 10px;font-size:13px;color:var(--fg-3);">
              Marca las unidades que vas a asignar, o usa <b>Selección automática</b>
              (toma las más antiguas en bodega por modelo).
            </p>
            <input type="search" id="ppBuscar" class="form-input" placeholder="Filtrar por serial…" style="width:100%;margin-bottom:12px;height:36px;font-family:var(--font-mono,monospace);">
            ${seccionesHtml}
          </div>
          <div class="modal-footer">
            <span id="ppCount" class="ts" style="margin-right:auto;align-self:center;">Sin selección</span>
            <button type="button" class="btn btn-ghost" data-pp="auto"><i data-lucide="list-checks"></i> Selección automática</button>
            <button type="button" class="btn btn-ghost" data-pp="cerrar">Cancelar</button>
            <button type="button" class="btn btn-primary" data-pp="aplicar"><i data-lucide="check"></i> Asignar seleccionados</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const cerrar = () => overlay.remove();
      const refrescarConteos = () => {
        let total = 0;
        secciones.forEach((s, si) => {
          const n = overlay.querySelectorAll(`.pp-check[data-grupo="${si}"]:checked`).length;
          total += n;
          const el = overlay.querySelector(`.pp-grupo[data-grupo="${si}"] .pp-progreso`);
          if (el) el.textContent = `${n}/${s.cupos} · ${s.unidades.length} disponible(s)`;
        });
        const c = overlay.querySelector('#ppCount');
        if (c) c.textContent = total ? `${total} unidad(es) seleccionada(s)` : 'Sin selección';
      };
      overlay.addEventListener('change', (e) => {
        const chk = e.target;
        if (!chk.classList || !chk.classList.contains('pp-check')) return;
        const si = Number(chk.getAttribute('data-grupo'));
        const s = secciones[si];
        if (chk.checked && s && overlay.querySelectorAll(`.pp-check[data-grupo="${si}"]:checked`).length > s.cupos) {
          chk.checked = false;
          toast(`${s.modelo}: solo hay ${s.cupos} cupo(s) vacío(s).`, 'warn');
        }
        refrescarConteos();
      });
      overlay.querySelector('#ppBuscar').addEventListener('input', (e) => {
        const q = norm(e.target.value);
        overlay.querySelectorAll('.pp-item').forEach(item => {
          const serial = norm(item.querySelector('.pp-serial')?.textContent);
          item.style.display = (!q || serial.includes(q)) ? '' : 'none';
        });
      });
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) { cerrar(); return; }
        const btn = e.target.closest('[data-pp]');
        if (!btn) return;
        const act = btn.getAttribute('data-pp');
        if (act === 'cerrar') { cerrar(); return; }
        if (act === 'auto') {
          secciones.forEach((s, si) => {
            const checks = [...overlay.querySelectorAll(`.pp-check[data-grupo="${si}"]`)];
            let n = checks.filter(c => c.checked).length;
            for (const c of checks) {
              if (n >= s.cupos) break;
              if (!c.checked) { c.checked = true; n++; }
            }
          });
          refrescarConteos();
          return;
        }
        if (act === 'aplicar') {
          const items = [...overlay.querySelectorAll('.pp-check:checked')].map(c => {
            const s = secciones[Number(c.getAttribute('data-grupo'))] || {};
            return { serial: c.value, modelo: s.modelo || '', modeloId: s.modeloId || '' };
          });
          if (!items.length) { toast('Marca al menos una unidad para asignar.', 'warn'); return; }
          cerrar();
          jalarItems(items, opts.origenPicker || 'el pool de bodega');
        }
      });
      if (window.lucide) lucide.createIcons();
      refrescarConteos();
    }

    // ── Política SUAVE: avisos, nunca bloquea ──────────────────────────
    // Revisa solo los seriales nuevos frente a lo ya guardado (setGuardados).
    async function advertenciasPool(seriales) {
      if (typeof EquiposPoolService === 'undefined') return [];
      const nuevos = (seriales || []).filter(s => !st.guardados.has(norm(s.serial)));
      const avisos = [];
      for (const s of nuevos) {
        try {
          const docs = await EquiposPoolService.findBySerial(s.serial);
          if (!docs.length) {
            if (!st.esLegacy) avisos.push({ serial: s.serial, chip: 'sin registro en el pool',
              chipCss: 'background:transparent;border:1px dashed #cbd5e1;color:#64748b;',
              detalle: 'Verifica que esté bien escrito, o recíbelo antes en Almacén · Recibir equipos. Se dará de alta al guardar.' });
            continue;
          }
          const mismo = docs.find(d => EquiposPoolService._mismoModelo(d, s.modelo_id, s.modelo));
          if (!mismo) {
            const otros = docs.map(d => d.modelo_label || 'sin modelo').join(', ');
            avisos.push({ serial: s.serial, chip: 'modelo distinto en el pool',
              chipCss: 'background:#fee2e2;color:#b91c1c;',
              detalle: `El pool lo registra como ${otros} — verifica que sea el ${s.modelo}. Si es el mismo radio, el conflicto se resuelve en Almacén · Hoy (Conflictos).` });
            continue;
          }
          if (mismo.estado !== EquiposPoolService.ESTADOS.EN_BODEGA
              && mismo.asignacion?.contrato_doc_id !== st.contratoDocId) {
            const est = EquiposPoolService.ESTADO_LABELS[mismo.estado] || mismo.estado;
            const quien = mismo.asignacion?.cliente_nombre ? ` con ${mismo.asignacion.cliente_nombre}` : '';
            avisos.push({ serial: s.serial, chip: `${est}${quien}`,
              chipCss: 'background:#fef3c7;color:#92400e;',
              detalle: 'Al guardar, la unidad se reasignará a este contrato (queda rastro del tenedor anterior en su historia).' });
          }
        } catch (e) { /* best-effort: nunca bloquea */ }
      }
      return avisos;
    }

    function panelRevisionSeriales(avisos, totalSeriales) {
      return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.style.display = 'flex';
        const filas = avisos.map(a => `
          <tr>
            <td style="font-family:var(--font-mono, monospace); font-size:12.5px; white-space:nowrap; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top;">
              <a href="#" data-ficha="${esc(a.serial)}" style="color:inherit; text-decoration:none;" title="Ver ficha del equipo">${esc(a.serial)}</a></td>
            <td style="padding:8px 10px; border-bottom:1px solid var(--border); font-size:12.5px;">
              <span class="eqpool-chip" style="${esc(a.chipCss)}">${esc(a.chip)}</span>
              <div style="color:var(--fg-3); margin-top:3px; line-height:1.45;">${esc(a.detalle)}</div></td>
          </tr>`).join('');
        overlay.innerHTML = `
          <div class="modal" style="max-width:640px; width:min(640px, 94vw);">
            <div class="sheet-header"><h3 class="sheet-title">Revisión antes de guardar</h3></div>
            <div class="sheet-body" style="padding:12px 8px;">
              <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
                ${totalSeriales} serial(es) · <strong>${avisos.length} aviso(s)</strong> del pool de equipos. Guardar no se bloquea — revisa y decide.</p>
              <div style="max-height:320px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
                <table style="border-collapse:collapse; width:100%;">${filas}</table>
              </div>
            </div>
            <div class="footer">
              <button class="btn btn-ghost" data-action="cancel">Volver a editar</button>
              <button class="btn btn-primary" data-action="confirm">Guardar con ${avisos.length} aviso(s)</button>
            </div>
          </div>`;
        const cleanup = (r) => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', kb); resolve(r); };
        const kb = (e) => { if (e.key === 'Escape') cleanup(false); };
        overlay.addEventListener('click', (e) => {
          const ficha = e.target.closest('[data-ficha]');
          if (ficha) { e.preventDefault(); window.EquipoFicha?.abrir(ficha.getAttribute('data-ficha')); return; }
          const action = e.target.closest('[data-action]')?.dataset?.action;
          if (action === 'confirm') cleanup(true);
          else if (action === 'cancel' || e.target === overlay) cleanup(false);
        });
        document.addEventListener('keydown', kb);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
      });
    }

    async function confirmarAvisosPool(seriales) {
      const avisos = await advertenciasPool(seriales);
      if (!avisos.length) return true;
      return panelRevisionSeriales(avisos, (seriales || []).length);
    }

    // ── Política DURA: el serial debe estar en bodega y ser del modelo ──
    // Devuelve { errores:[{serial, tipo, motivo}], unidades: Map(norm → doc) }.
    //   tipo 'inexistente' | 'modelo' | 'ocupado'. Solo 'modelo' admite
    //   "asignar de todos modos" con motivo.
    // Pasan sin revisar: los ya guardados en esta misma fuente (setGuardados)
    // y las excepciones declaradas por la página (unidades que continúan del
    // contrato original, mismo cliente en renovación…).
    async function validarDuro(seriales, { excepciones = null, esperado = null } = {}) {
      const errores = [];
      const unidades = new Map();
      if (typeof EquiposPoolService === 'undefined') return { errores: [{ serial: '', tipo: 'inexistente', motivo: 'El pool de equipos no está disponible.' }], unidades };
      const exc = excepciones instanceof Set ? excepciones : new Set(excepciones || []);
      for (const s of (seriales || [])) {
        const k = norm(s.serial);
        if (!k) continue;
        let docs = [];
        try { docs = await EquiposPoolService.findBySerial(s.serial); } catch (e) { docs = []; }
        const mismoModelo = docs.filter(d => EquiposPoolService._mismoModelo(d, s.modelo_id || null, s.modelo || ''));
        const candidato = mismoModelo.find(d => d.estado === EquiposPoolService.ESTADOS.EN_BODEGA)
          || mismoModelo.find(d => st.contratoDocId && d.asignacion?.contrato_doc_id === st.contratoDocId)
          || mismoModelo[0] || docs[0] || null;
        if (st.guardados.has(k) || exc.has(k)) {
          if (candidato) unidades.set(k, candidato);
          continue;
        }
        if (!docs.length) {
          errores.push({ serial: s.serial, tipo: 'inexistente', motivo: 'No existe en el inventario. Revisa el número o recíbelo primero en Almacén · Recibir equipos.' });
          continue;
        }
        if (!mismoModelo.length) {
          const otros = docs.map(d => d.modelo_label || 'sin modelo').join(', ');
          const enBodegaOtro = docs.find(d => d.estado === EquiposPoolService.ESTADOS.EN_BODEGA);
          if (!enBodegaOtro) {
            const est = EquiposPoolService.ESTADO_LABELS[docs[0].estado] || docs[0].estado;
            errores.push({ serial: s.serial, tipo: 'ocupado', motivo: `Es ${otros} y está ${est}${docs[0].asignacion?.cliente_nombre ? ` con ${docs[0].asignacion.cliente_nombre}` : ''}.` });
          } else {
            errores.push({ serial: s.serial, tipo: 'modelo', motivo: `Es ${otros}, no ${s.modelo || 'el modelo pedido'}.`, doc: enBodegaOtro });
          }
          continue;
        }
        if (candidato && candidato.estado === EquiposPoolService.ESTADOS.EN_BODEGA) { unidades.set(k, candidato); continue; }
        if (candidato && st.contratoDocId && candidato.asignacion?.contrato_doc_id === st.contratoDocId) { unidades.set(k, candidato); continue; }
        const est = EquiposPoolService.ESTADO_LABELS[candidato?.estado] || candidato?.estado || 'fuera de bodega';
        const quien = candidato?.asignacion?.cliente_nombre ? ` con ${candidato.asignacion.cliente_nombre}` : '';
        errores.push({ serial: s.serial, tipo: 'ocupado', doc: candidato, motivo: `Está ${est}${quien}. Si volvió, regístralo por devolución o ENTRADA antes de asignarlo.` });
      }
      return { errores, unidades };
    }

    // Panel de bloqueo de la política dura. Resuelve:
    //   false                → volver a editar
    //   { motivo }           → "asignar de todos modos" (solo si todos los
    //                          errores son de modelo)
    function panelBloqueo(errores) {
      return new Promise((resolve) => {
        const soloModelo = errores.length && errores.every(e => e.tipo === 'modelo');
        const overlay = document.createElement('div');
        overlay.className = 'overlay';
        overlay.style.display = 'flex';
        const chip = (t) => t === 'modelo'
          ? '<span class="eqpool-chip" style="background:#fee2e2;color:#b91c1c;">modelo distinto</span>'
          : t === 'inexistente'
            ? '<span class="eqpool-chip" style="background:transparent;border:1px dashed #cbd5e1;color:#64748b;">no existe</span>'
            : '<span class="eqpool-chip" style="background:#fef3c7;color:#92400e;">no está en bodega</span>';
        const filas = errores.map(e => `
          <tr>
            <td style="font-family:var(--font-mono, monospace); font-size:12.5px; white-space:nowrap; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top;">
              ${e.serial ? `<a href="#" data-ficha="${esc(e.serial)}" style="color:inherit; text-decoration:none;" title="Ver ficha del equipo">${esc(e.serial)}</a>` : '—'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid var(--border); font-size:12.5px;">
              ${chip(e.tipo)}
              <div style="color:var(--fg-3); margin-top:3px; line-height:1.45;">${esc(e.motivo)}</div></td>
          </tr>`).join('');
        overlay.innerHTML = `
          <div class="modal" style="max-width:640px; width:min(640px, 94vw);">
            <div class="sheet-header"><h3 class="sheet-title">${errores.length} serial(es) que no se pueden asignar</h3></div>
            <div class="sheet-body" style="padding:12px 8px;">
              <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
                Un serial se asigna solo si existe en el inventario, está en bodega y es del modelo pedido.</p>
              <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
                <table style="border-collapse:collapse; width:100%;">${filas}</table>
              </div>
              ${soloModelo ? `
              <div style="margin-top:12px; padding:10px 12px; background:#FFFBEB; border:1px solid #FCD34D; border-radius:8px; color:#92400E; font-size:12.5px; line-height:1.55;">
                Si estás seguro de que es el radio correcto y el modelo del contrato está mal escrito,
                puedes asignarlo de todos modos. El motivo queda en el historial.
                <input type="text" id="pbMotivo" class="form-input" placeholder="Motivo (obligatorio)" style="margin-top:8px; width:100%; height:34px;">
              </div>` : ''}
            </div>
            <div class="footer">
              <button class="btn btn-primary" data-action="cancel">Volver a editar</button>
              ${soloModelo ? '<button class="btn btn-ghost" data-action="forzar">Asignar de todos modos</button>' : ''}
            </div>
          </div>`;
        const cleanup = (r) => { overlay.remove(); document.body.style.overflow = ''; document.removeEventListener('keydown', kb); resolve(r); };
        const kb = (e) => { if (e.key === 'Escape') cleanup(false); };
        overlay.addEventListener('click', (e) => {
          const ficha = e.target.closest('[data-ficha]');
          if (ficha) { e.preventDefault(); window.EquipoFicha?.abrir(ficha.getAttribute('data-ficha')); return; }
          const action = e.target.closest('[data-action]')?.dataset?.action;
          if (action === 'forzar') {
            const motivo = overlay.querySelector('#pbMotivo')?.value.trim();
            if (!motivo) { toast('Escribe el motivo para asignar un modelo distinto.', 'warn'); return; }
            cleanup({ motivo });
          } else if (action === 'cancel' || e.target === overlay) cleanup(false);
        });
        document.addEventListener('keydown', kb);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
      });
    }

    // Atajo de la política dura: valida y, si hay bloqueos, abre el panel.
    // Resuelve null si hay que volver a editar; si no, { unidades, excepcion }.
    // `permitir(error)` deja a la página aceptar un bloqueo con criterio propio
    // (p.ej. una unidad que sigue con el MISMO cliente en una renovación).
    async function exigirEnBodega(seriales, ctxValidacion = {}) {
      const { errores: todos, unidades } = await validarDuro(seriales, ctxValidacion);
      const errores = [];
      todos.forEach(e => {
        if (typeof ctxValidacion.permitir === 'function' && e.doc && ctxValidacion.permitir(e)) unidades.set(norm(e.serial), e.doc);
        else errores.push(e);
      });
      if (!errores.length) return { unidades, excepcion: null };
      const r = await panelBloqueo(errores);
      if (!r) return null;
      // Forzado: las unidades de modelo distinto entran con su doc real.
      errores.forEach(e => { if (e.doc) unidades.set(norm(e.serial), e.doc); });
      return { unidades, excepcion: { motivo: r.motivo, seriales: errores.map(e => e.serial) } };
    }

    function setGuardados(seriales) {
      st.guardados = new Set((seriales || []).map(s => norm(typeof s === 'string' ? s : s.serial)));
    }
    function setContexto({ contratoDocId, clienteId, esLegacy } = {}) {
      if (contratoDocId !== undefined) st.contratoDocId = contratoDocId;
      if (clienteId !== undefined) st.clienteId = clienteId;
      if (esLegacy !== undefined) st.esLegacy = !!esLegacy;
    }

    return {
      body, politica, norm,
      render, refresh, collect, validarCompleto, presentes, setLocked, aplicarBusqueda,
      fillFrom, togglePaste, applyPaste, onOmitToggle,
      jalarItems, tomarDelPool, abrirPickerPool,
      advertenciasPool, panelRevisionSeriales, confirmarAvisosPool,
      validarDuro, panelBloqueo, exigirEnBodega,
      setGuardados, setContexto,
    };
  }

  return { crear, esc };
})();
