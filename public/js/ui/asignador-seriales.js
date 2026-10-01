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
  const normDefault = (s) => Serial.clave(s);

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
               ${slot?.origen ? `data-origen="${esc(slot.origen)}"` : ''}
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
        // Origen de la casilla (decisión de Alberto 2026-10-01: José teclea,
        // y lo tecleado con el radio en la mano ya está verificado). Teclear
        // o escanear = 'manual'; lo que llena el picker o "Pegar columna" lo
        // marcan jalarItems/fillFrom. Lo lee collect() → `source`, y con eso
        // la hoja "Verificar la lista" solo pide lo que no se tecleó.
        if (e.target.classList.contains('serial-input')) e.target.dataset.origen = 'manual';
        if (e.target.classList.contains('serial-input') || e.target.classList.contains('motivo-input')) refresh();
      });
      body.addEventListener('paste', (e) => {
        if (e.target.classList.contains('serial-input')) onPasteSerial(e);
      });
      // Lector de barras (auditoría UX 2026-09-28, T12): el lector manda el
      // serial + Enter. Sin esto Enter no hacía nada y el segundo escaneo se
      // pegaba al primero en la misma casilla. Enter salta a la siguiente
      // casilla vacía; si ya no quedan, suelta el foco para que un escaneo de
      // más no ensucie la última.
      body.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || !e.target.classList?.contains('serial-input')) return;
        e.preventDefault();
        refresh();
        const sig = siguienteVacia(e.target);
        if (sig) { sig.focus(); sig.select?.(); }
        else { e.target.blur(); toast('Todas las casillas tienen serial.', 'ok'); }
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

    // Siguiente casilla de serial libre (habilitada, sin valor, no omitida)
    // DESPUÉS de `desde`, dando la vuelta al principio si hace falta.
    function siguienteVacia(desde) {
      const libres = [...body.querySelectorAll('.serial-input')].filter(i =>
        !i.disabled && !i.closest('.serial-row')?.classList.contains('bloqueado'));
      const idx = libres.indexOf(desde);
      const orden = idx >= 0 ? [...libres.slice(idx + 1), ...libres.slice(0, idx)] : libres;
      return orden.find(i => !i.value.trim()) || null;
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
        inp.dataset.origen = 'pegado';
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
          // `source`: 'manual' (tecleado/escaneado), 'picker' (del estante) o
          // 'pegado'. Sin marca (restaurado de un borrador viejo, ítem de
          // gestión) cuenta como manual: la decisión de Alberto es que lo
          // tecleado ya está verificado; el picker es la excepción.
          if (serial) seriales.push({ modelo, modelo_id: modeloId, serial, source: inp.dataset.origen || 'manual', ...(clave != null ? { clave } : {}) });
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
        const inpSlot = slot.querySelector('.serial-input');
        inpSlot.value = serial;
        inpSlot.dataset.origen = 'picker';
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
      // Solo los modelos de este formulario, por familia del catálogo
      // (listarBodegaDe) — antes se bajaba la bodega entera y se pareaba por
      // texto, que ofrecía modelos parecidos (HYT-P50 PRO por HYT-P50).
      const refs = [...body.querySelectorAll('.serial-group')].map(g => ({
        modelo_id: g.getAttribute('data-modelo-id') || null, modelo: g.getAttribute('data-modelo') || '' }));
      let bodega;
      try {
        bodega = await EquiposPoolService.listarBodegaDe(refs);
      } catch (e) {
        console.error('Error consultando el pool:', e);
        toast('No se pudo consultar el inventario de equipos.', 'bad');
        return;
      }
      abrirPickerPool(bodega);
    }

    async function abrirPickerPool(bodega) {
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
        const unidades = bodega.deRef({ modelo_id: s.modeloId || null, modelo: s.modelo })
          .filter(d => !pres.has(norm(d.serial || d.serial_norm)))
          .sort((a, b) => (a.ingreso_bodega_at?.toMillis?.() || 0) - (b.ingreso_bodega_at?.toMillis?.() || 0)
            || String(a.serial || '').localeCompare(String(b.serial || '')));
        secciones.push({ ...s, unidades });
      }
      // "Disponible" ≠ "en bodega" (auditoría UX 2026-09-28, P2 #15). Del
      // estante NO se ofrecen —ni a mano ni por selección automática— las
      // unidades descartadas en QC (T12), las que el importador marcó DAÑADA
      // (nota) ni las que arrastran una condición particular vigente. Se
      // listan aparte como "No disponibles (N)" con su motivo, para que bodega
      // sepa por qué el conteo del estante no cuadra con lo que se ofrece.
      // Solo se consultan los modelos que se van a llenar.
      const todas = secciones.flatMap(s => s.unidades.map(u => u.serial || u.serial_norm));
      const [descartados, condiciones] = await Promise.all([descartadosDe(todas), condicionesVigentes()]);
      const noDisp = [];
      secciones.forEach(s => {
        s.unidades = s.unidades.filter(u => {
          const motivo = motivoNoDisponible(u, descartados, condiciones);
          if (!motivo) return true;
          noDisp.push({ modelo: s.modelo, serial: u.serial || u.serial_norm, motivo });
          return false;
        });
      });
      if (!secciones.length) { toast('No hay cupos vacíos que llenar: todos los seriales están colocados u omitidos.', 'warn'); return; }
      // Radios en bodega sin modelo en su ficha: no se ofrecen (no se sabe qué
      // son), pero se dice que existen — "no hay" no puede leerse como estante vacío.
      const nSinFicha = Number(bodega.sinFicha || 0);
      const txtSinFicha = nSinFicha
        ? ` Además hay ${nSinFicha} radio(s) en bodega sin modelo en su ficha, que no se ofrecen hasta clasificarlos (Almacén · Avanzado).` : '';
      if (!secciones.some(s => s.unidades.length)) {
        toast((noDisp.length
          ? `En bodega hay ${noDisp.length} unidad(es) de estos modelos, pero ninguna disponible (${[...new Set(noDisp.map(x => x.motivo))].join('; ')}).`
          : 'En bodega no hay unidades de estos modelos. Recibe equipos primero.') + txtSinFicha, 'warn');
        return;
      }
      const sinFichaHtml = nSinFicha
        ? `<p style="margin:0 0 10px; font-size:12.5px; color:var(--fg-3);">${esc(txtSinFicha.trim())}</p>` : '';
      const noDispHtml = noDisp.length ? `
        <details class="ep-nodisp" style="margin:0 0 10px; font-size:12.5px; color:var(--fg-2);">
          <summary style="cursor:pointer; color:#92400E;"><b>No disponibles (${noDisp.length})</b> — están en bodega pero no se ofrecen</summary>
          <ul style="margin:6px 0 0; padding-left:18px; line-height:1.6; max-height:140px; overflow-y:auto;">
            ${noDisp.map(x => `<li><span style="font-family:var(--font-mono, monospace);">${esc(x.serial)}</span> · ${esc(x.modelo)} — ${esc(x.motivo)}</li>`).join('')}
          </ul>
        </details>` : '';
      // EntityPicker (js/ui/entity-picker.js, 2026-09-08): lista agrupada
      // por modelo con buscador, tope de cupos por grupo y selección
      // automática (FIFO por ingreso a bodega). Devuelve la selección; el
      // llenado del formulario sigue siendo jalarItems.
      EntityPicker.abrir({
        titulo: opts.tituloPicker || 'Tomar de bodega', icono: 'scan-barcode', size: 'lg',
        descripcion: 'Marca las unidades que vas a asignar, o usa <b>Selección automática</b> (toma las más antiguas en bodega por modelo).',
        extraHtml: noDispHtml + sinFichaHtml,
        placeholderBuscar: 'Filtrar por serial…', normalizar: (s) => norm(s),
        grupos: secciones.map((s, si) => ({
          id: si, titulo: s.modelo, cupos: s.cupos,
          items: s.unidades.map(u => ({ id: u.serial || u.serial_norm, label: u.serial || u.serial_norm, sub: u.condicion === 'reuso' ? 'Refurbished' : 'Nuevo' })),
        })),
        vacioGrupo: 'Sin unidades en bodega de este modelo.',
        autoSeleccion: true, confirmar: 'Asignar seleccionados', iconoConfirmar: 'check',
      }).then((r) => {
        if (!r) return;
        const items = r.seleccion.map(x => {
          const s = secciones[Number(x.grupo)] || {};
          return { serial: x.id, modelo: s.modelo || '', modeloId: s.modeloId || '' };
        });
        jalarItems(items, opts.origenPicker || 'bodega');
      });
    }

    // ── Política SUAVE: avisos, nunca bloquea ──────────────────────────
    // Revisa solo los seriales nuevos frente a lo ya guardado (setGuardados).
    // Condición particular registrada por serial (equipos_condiciones): el
    // radio sirve, pero con una limitación. Aviso, nunca bloqueo — la
    // condición es justamente "sirve para un cliente que no use esa función".
    // Se muestra en las DOS políticas: en la suave va dentro de advertenciasPool;
    // en la dura, después de que exigirEnBodega dio el visto bueno.
    async function avisosCondiciones(seriales) {
      if (typeof EquiposCondicionesService === 'undefined') return [];
      const nuevos = (seriales || []).filter(s => !st.guardados.has(norm(s.serial)));
      if (!nuevos.length) return [];
      let mapa;
      try { mapa = await EquiposCondicionesService.buscarVarios(nuevos.map(s => s.serial)); }
      catch (e) { return []; }
      const avisos = [];
      for (const s of nuevos) {
        const c = mapa.get(norm(s.serial));
        if (!c) continue;
        avisos.push({ serial: s.serial, chip: `⚠ condición: ${EquiposCondicionesService.resumen(c.condicion, 40)}`,
          chipCls: 'eqpool-chip-aviso',
          detalle: `${c.condicion}${c.orden_id ? ` (orden ${c.orden_id})` : ''}. Funciona, pero verifica que este cliente no necesite justo esa función.` });
      }
      return avisos;
    }

    async function advertenciasPool(seriales) {
      if (typeof EquiposPoolService === 'undefined') return [];
      const nuevos = (seriales || []).filter(s => !st.guardados.has(norm(s.serial)));
      const avisos = await avisosCondiciones(seriales);
      for (const s of nuevos) {
        try {
          const docs = await EquiposPoolService.findBySerial(s.serial);
          if (!docs.length) {
            if (!st.esLegacy) avisos.push({ serial: s.serial, chip: 'sin registro en el inventario',
              chipCls: 'eqpool-chip-vacio',
              detalle: 'Verifica que esté bien escrito, o recíbelo antes en Almacén · Recibir equipos. Se dará de alta al guardar.' });
            continue;
          }
          const mismo = docs.find(d => EquiposPoolService._mismoModelo(d, s.modelo_id, s.modelo));
          if (!mismo) {
            const otros = docs.map(d => d.modelo_label || 'sin modelo').join(', ');
            avisos.push({ serial: s.serial, chip: 'modelo distinto en el inventario',
              chipCls: 'eqpool-chip-alerta',
              detalle: `El inventario lo registra como ${otros} — verifica que sea el ${s.modelo}. Si es el mismo radio, el conflicto se resuelve en Almacén · Hoy (Conflictos).` });
            continue;
          }
          if (mismo.estado !== EquiposPoolService.ESTADOS.EN_BODEGA
              && mismo.asignacion?.contrato_doc_id !== st.contratoDocId) {
            const est = EquiposPoolService.ESTADO_LABELS[mismo.estado] || mismo.estado;
            const quien = mismo.asignacion?.cliente_nombre ? ` con ${mismo.asignacion.cliente_nombre}` : '';
            avisos.push({ serial: s.serial, chip: `${est}${quien}`,
              chipCls: 'eqpool-chip-aviso',
              detalle: 'Al guardar, la unidad se reasignará a este contrato (queda rastro del tenedor anterior en su historia).' });
          }
        } catch (e) { /* best-effort: nunca bloquea */ }
      }
      return avisos;
    }

    async function panelRevisionSeriales(avisos, totalSeriales) {
      {
        const filas = avisos.map(a => `
          <tr>
            <td style="font-family:var(--font-mono, monospace); font-size:12.5px; white-space:nowrap; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top;">
              <a href="#" data-ficha="${esc(a.serial)}" style="color:inherit; text-decoration:none;" title="Ver ficha del equipo">${esc(a.serial)}</a></td>
            <td style="padding:8px 10px; border-bottom:1px solid var(--border); font-size:12.5px;">
              <span class="eqpool-chip ${esc(a.chipCls || '')}">${esc(a.chip)}</span>
              <div style="color:var(--fg-3); margin-top:3px; line-height:1.45;">${esc(a.detalle)}</div></td>
          </tr>`).join('');
        const r = await Modal.sheet({
          title: 'Revisión antes de guardar', icon: 'search-check', size: 'lg',
          html: `
            <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
              ${totalSeriales} serial(es) · <strong>${avisos.length} aviso(s)</strong> del inventario de equipos. Guardar no se bloquea — revisa y decide.</p>
            <div style="max-height:320px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
              <table style="border-collapse:collapse; width:100%;">${filas}</table>
            </div>`,
          buttons: [
            { action: 'cancel', label: 'Volver a editar' },
            { action: 'confirm', label: `Guardar con ${avisos.length} aviso(s)`, primary: true },
          ],
          onMount: (root) => root.addEventListener('click', (e) => {
            const ficha = e.target.closest('[data-ficha]');
            if (ficha) { e.preventDefault(); window.EquipoFicha?.abrir(ficha.getAttribute('data-ficha')); }
          }),
        });
        return r === 'confirm';
      }
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
    // Por qué una unidad en bodega NO se ofrece (null = disponible). La regla
    // vive en EquiposPoolService.motivoNoDisponible; con un servicio viejo en
    // caché (sin el método) se cae al criterio anterior: solo descartados.
    function motivoNoDisponible(u, descartados, condiciones) {
      if (typeof EquiposPoolService !== 'undefined' && EquiposPoolService.motivoNoDisponible) {
        return EquiposPoolService.motivoNoDisponible(u, { descartados, condiciones });
      }
      const dsc = descartados.get(norm(u.serial || u.serial_norm));
      return dsc ? EquiposDescartadosService.motivoBloqueo(dsc) : null;
    }

    // Condiciones particulares VIGENTES, Map(serial_norm → doc). Una sola
    // consulta (son pocas) en vez de una por unidad del estante. Fail-open.
    async function condicionesVigentes() {
      if (typeof EquiposCondicionesService === 'undefined' || !EquiposCondicionesService.listar) return new Map();
      try {
        const m = new Map();
        for (const c of await EquiposCondicionesService.listar()) {
          const k = c.serial_norm || norm(c.serial || '');
          if (k && c.vigente !== false) m.set(k, c);
        }
        return m;
      } catch (e) {
        console.warn('[Asignador] condiciones no consultadas:', e?.code || e);
        return new Map();
      }
    }

    // Descartados vigentes entre `seriales` (Map norm → doc). Fail-open: sin el
    // servicio o con la red caída devuelve vacío, igual que SerialField.
    async function descartadosDe(seriales) {
      if (typeof EquiposDescartadosService === 'undefined' || !EquiposDescartadosService.descartadosDe) return new Map();
      try {
        const m = await EquiposDescartadosService.descartadosDe(seriales);
        // Re-clave con la norma de este componente (puede ser Serial.clave).
        const out = new Map();
        m.forEach((d, k) => out.set(norm(k), d));
        return out;
      } catch (e) { return new Map(); }
    }

    // El pool se consulta por lotes `in` de 10 (auditoría UX 2026-09-28,
    // T12): antes era una consulta por serial, lenta con 20+.
    async function poolPorSerial(seriales, onProgreso) {
      if (EquiposPoolService.findBySeriales) {
        return EquiposPoolService.findBySeriales((seriales || []).map(s => s.serial), onProgreso);
      }
      // Servicio viejo en caché: el camino uno a uno de antes.
      const porNorm = new Map();
      for (const s of (seriales || [])) {
        const k = EquiposPoolService.normalizarSerial(s.serial);
        if (!k || porNorm.has(k)) continue;
        try { porNorm.set(k, await EquiposPoolService.findBySerial(s.serial)); } catch (_) { porNorm.set(k, []); }
      }
      return porNorm;
    }


    async function validarDuro(seriales, { excepciones = null, esperado = null, onProgreso = null } = {}) {
      const errores = [];
      const unidades = new Map();
      if (typeof EquiposPoolService === 'undefined') return { errores: [{ serial: '', tipo: 'inexistente', motivo: 'El inventario de equipos no está disponible.' }], unidades };
      const exc = excepciones instanceof Set ? excepciones : new Set(excepciones || []);
      const prog = onProgreso || opts.onValidando || null;
      let porNorm, descartados;
      try {
        try {
          porNorm = await poolPorSerial(seriales, prog);
        } catch (e) {
          // No se pudo consultar el inventario (2026-09-30): antes la búsqueda
          // devolvía [] y aquí salía "no existe". Ahora es un bloqueo propio —
          // sin verificar, no se guarda — y el panel dice lo que pasó.
          console.warn('[Asignador] validación sin consulta:', e?.code || e);
          const motivo = 'No se pudo consultar el inventario para verificar este serial. Reintenta; si persiste, revisa la conexión.';
          return { errores: (seriales || []).filter(x => norm(x.serial)).map(x => ({ serial: x.serial, tipo: 'sin_consulta', motivo })), unidades };
        }
        descartados = await descartadosDe((seriales || []).filter(s => !st.guardados.has(norm(s.serial))).map(s => s.serial));
      } finally {
        // null = terminó la validación (la página restaura su contador).
        if (prog) { try { prog(null); } catch (_) {} }
      }
      for (const s of (seriales || [])) {
        const k = norm(s.serial);
        if (!k) continue;
        const docs = porNorm.get(EquiposPoolService.normalizarSerial(s.serial)) || [];
        // Descartado en QC: bloqueo sin "asignar de todos modos". Los ya
        // guardados no se revisan (ya están en el contrato; su corrección va
        // por la vía de corregir seriales).
        const dsc = !st.guardados.has(k) && descartados.get(k);
        if (dsc) {
          errores.push({ serial: s.serial, tipo: 'descartado',
            motivo: `No se puede usar: ${EquiposDescartadosService.motivoBloqueo(dsc)}. Si fue un error, se revoca en Almacén · Descartados.` });
          continue;
        }
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
    //                          errores son de modelo y la política lo deja)
    //
    // `modeloDistinto` (2026-09-29, Alberto: "si se hizo un contrato con un
    // modelo se le incluyó el precio de ese modelo; si bodega cambia el
    // modelo, ¿quién dice que el precio es el mismo?"):
    //   'forzar'     → bodega fuerza con motivo (demo: no lleva precio)
    //   'aprobacion' → bodega PROPONE con motivo y administración decide
    //                  (reemplazo: el servidor devuelve la gestión a aprobación)
    //   'bloquear'   → no se fuerza: el modelo y el precio los fija el
    //                  contrato/anexo, y se corrigen allá
    async function panelBloqueo(errores, modeloDistinto = 'forzar') {
      {
        const soloModelo = errores.length && errores.every(e => e.tipo === 'modelo');
        const puedeForzar = soloModelo && modeloDistinto !== 'bloquear';
        const chip = (t) => t === 'modelo'
          ? '<span class="eqpool-chip eqpool-chip-alerta">modelo distinto</span>'
          : t === 'descartado'
            ? '<span class="eqpool-chip eqpool-chip-alerta">descartado en QC</span>'
          : t === 'inexistente'
            ? '<span class="eqpool-chip eqpool-chip-vacio">no existe</span>'
          : t === 'sin_consulta'
            ? '<span class="eqpool-chip eqpool-chip-alerta">no se pudo verificar</span>'
            : '<span class="eqpool-chip eqpool-chip-aviso">no está en bodega</span>';
        const filas = errores.map(e => `
          <tr>
            <td style="font-family:var(--font-mono, monospace); font-size:12.5px; white-space:nowrap; padding:8px 10px; border-bottom:1px solid var(--border); vertical-align:top;">
              ${e.serial ? `<a href="#" data-ficha="${esc(e.serial)}" style="color:inherit; text-decoration:none;" title="Ver ficha del equipo">${esc(e.serial)}</a>` : '—'}</td>
            <td style="padding:8px 10px; border-bottom:1px solid var(--border); font-size:12.5px;">
              ${chip(e.tipo)}
              <div style="color:var(--fg-3); margin-top:3px; line-height:1.45;">${esc(e.motivo)}</div></td>
          </tr>`).join('');
        const r = await Modal.sheet({
          title: `${errores.length} serial(es) que no se pueden asignar`, icon: 'shield-alert', size: 'lg',
          html: `
            <p style="margin:0 0 10px; font-size:13px; color:var(--fg-3);">
              Un serial se asigna solo si existe en el inventario, está en bodega, es del modelo pedido y no fue descartado en QC.</p>
            <div style="max-height:300px; overflow-y:auto; border:1px solid var(--border); border-radius:8px;">
              <table style="border-collapse:collapse; width:100%;">${filas}</table>
            </div>
            ${soloModelo && modeloDistinto === 'bloquear' ? `
            <div style="margin-top:12px; padding:10px 12px; background:#FEF2F2; border:1px solid #FCA5A5; border-radius:8px; color:#991B1B; font-size:12.5px; line-height:1.55;">
              <b>No se puede asignar otro modelo aquí.</b> El modelo y su precio los fija el contrato o el anexo
              que firma el cliente. Si no hay de este modelo, o el modelo está mal escrito, pide al vendedor
              que corrija la línea (modelo y precio) y asigna después.
            </div>` : ''}
            ${puedeForzar ? `
            <div style="margin-top:12px; padding:10px 12px; background:#FFFBEB; border:1px solid #FCD34D; border-radius:8px; color:#92400E; font-size:12.5px; line-height:1.55;">
              ${modeloDistinto === 'aprobacion'
                ? `Puedes <b>proponer</b> este radio de otro modelo. La gestión vuelve a <b>administración</b>, que decide
                   si lo acepta y si la tarifa del cliente se mantiene; no se programa hasta entonces. Explica por qué.`
                : 'Si estás seguro de que es el radio correcto, puedes asignarlo de todos modos. El motivo queda en el historial.'}
              <input type="text" id="pbMotivo" class="form-input" placeholder="${modeloDistinto === 'aprobacion' ? 'Por qué va otro modelo (obligatorio)' : 'Motivo (obligatorio)'}" style="margin-top:8px; width:100%; height:34px;">
            </div>` : ''}`,
          buttons: [
            ...(puedeForzar ? [{ action: 'forzar', label: modeloDistinto === 'aprobacion' ? 'Proponer a administración' : 'Asignar de todos modos' }] : []),
            { action: 'cancel', label: 'Volver a editar', primary: true },
          ],
          onMount: (root) => root.addEventListener('click', (e) => {
            const ficha = e.target.closest('[data-ficha]');
            if (ficha) { e.preventDefault(); window.EquipoFicha?.abrir(ficha.getAttribute('data-ficha')); }
          }),
          onAction: (action, root) => {
            if (action !== 'forzar') return null;
            const motivo = root.querySelector('#pbMotivo')?.value.trim();
            if (!motivo) { toast('Escribe el motivo para asignar un modelo distinto.', 'warn'); return false; }
            return { motivo };
          },
        });
        return r && typeof r === 'object' ? r : false;
      }
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
      let excepcion = null;
      if (errores.length) {
        const r = await panelBloqueo(errores, ctxValidacion.modeloDistinto || 'forzar');
        if (!r) return null;
        // Forzado: las unidades de modelo distinto entran con su doc real.
        errores.forEach(e => { if (e.doc) unidades.set(norm(e.serial), e.doc); });
        excepcion = { motivo: r.motivo, seriales: errores.map(e => e.serial) };
      }
      // Ya pasó la política dura: si alguna unidad arrastra una condición
      // particular, se muestra para que bodega decida — no bloquea.
      const avisos = await avisosCondiciones(seriales);
      if (avisos.length && !(await panelRevisionSeriales(avisos, (seriales || []).length))) return null;
      return { unidades, excepcion };
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
      advertenciasPool, avisosCondiciones, panelRevisionSeriales, confirmarAvisosPool,
      validarDuro, panelBloqueo, exigirEnBodega,
      setGuardados, setContexto,
      motivoNoDisponible, condicionesVigentes, descartadosDe,
    };
  }

  return { crear, esc };
})();
