// @ts-nocheck
/**
 * admin-grupos.js — Group administration page.
 *
 * Groups live as a string[] on each poc_devices doc; there is no canonical
 * grupos collection. This page derives the per-client group list, surfaces
 * usage counts and case-insensitive duplicates, and offers rename / merge /
 * delete actions that batch-update every device referencing those groups.
 *
 * Cache invalidation: vendedores-batch caches per-client groups in
 * localStorage under `grupos_v2_<clienteId>` / `grupos_v2_<nombreNorm>`.
 * After any write we clear those entries so the batch tool picks up the
 * change on next refresh.
 */
(function () {
  'use strict';

  const State = {
    clientes: [],            // [{ id, nombre, norm }] — todos los clientes
    clientesConGrupos: null, // { idsSet, nombresNormSet, gruposPorId, gruposPorNombre } — null hasta cargar
    mostrarTodos: false,     // toggle: si true, no filtra por "tiene grupos"
    clienteFiltro: '',
    clienteSel: null,        // { id, nombre } | null
    grupos: [],              // [{ nombre, count }] — union catálogo + derivado
    tieneCatalogo: false,    // true si el cliente ya tiene clientes/{id}.poc_grupos
    clientePrefijo: null,    // prefijo de 3 letras del cliente seleccionado | null
    prefijosTomados: new Set(), // todos los prefijos ya usados (unicidad global)
    migFilas: [],            // filas del modal de migración de prefijos
    globalFilas: [],         // filas de la vista global de empresas
    comunes: [],             // grupos comunes (empresa/config.poc_grupos_comunes)
    rol: null,               // rol del usuario actual (gate de la migración)
    listaLimpia: false,      // toggle: mostrar nombres sin el prefijo
    seleccionados: new Set(),

    // Scan de duplicados — null = ningún scan corrido, sino objeto con análisis.
    // mode: 'exactos' | 'fuzzy'
    // porId/porNombre: Map<key, bucketCount> (solo > 0)
    scan: null,
  };

  // Grupos comunes propuestos como chips de 1 clic (alta rápida). Editable y
  // persistido en empresa/config.poc_grupos_comunes; este es solo el fallback.
  const DEFAULT_COMUNES = [
    'Ventas', 'Operaciones', 'Administración', 'Gerencia', 'Contabilidad',
    'GPS', 'Bodega', 'Logística', 'Soporte', 'Mantenimiento', 'Cobranzas', 'Recursos Humanos',
  ];

  function $(id) { return document.getElementById(id); }

  // Lista de grupos comunes saneada (dedup + trim). Array vacío explícito se
  // respeta; si no es array (config incompleta) cae al default.
  function sanitizarComunes(arr) {
    if (!Array.isArray(arr)) return DEFAULT_COMUNES.slice();
    return FMT.dedupGrupos(arr);
  }
  function esc(s) {
    return (s || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nowTs() {
    const d = new Date();
    return d.toLocaleTimeString('es-PA', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  // ── Cliente list ────────────────────────────────────────────────────
  async function cargarClientes() {
    try {
      // Paralelo: clientes + qué clientes tienen al menos un grupo. Ambas
      // lecturas son cache-first y se reusan dentro del PocService.
      // fresh:true en getClientesConGrupos → lee TODOS los equipos del servidor
      // (la caché parcial dejaba grupos fuera de la lista).
      const [lista, conGrupos, config] = await Promise.all([
        ClientesService.getAllClientes(),
        PocService.getClientesConGrupos({ fresh: true }),
        EmpresaService.getConfig(),
      ]);
      State.comunes = sanitizarComunes(config && config.poc_grupos_comunes);
      State.clientes = lista.map(c => ({
        id: c.id,
        nombre: (c.nombre || '').toString(),
        norm: FMT.normalize(c.nombre || ''),
        prefijo: FMT.normalizePrefijo(c.poc_grupo_prefix) || null,
        nCatalogo: Array.isArray(c.poc_grupos) ? c.poc_grupos.length : null,
      }));
      // Set global de prefijos ya tomados (para proponer únicos).
      State.prefijosTomados = new Set();
      State.clientes.forEach(c => { if (c.prefijo) State.prefijosTomados.add(c.prefijo); });
      // Normaliza los nombres del set una sola vez para comparación O(1).
      const nombresNorm = new Set();
      conGrupos.nombres.forEach(n => nombresNorm.add(FMT.normalize(n)));
      // Mapa nombre normalizado → conjunto de grupos crudos (para el scan).
      const gruposPorNombreNorm = new Map();
      conGrupos.gruposPorNombre.forEach((set, nombre) => {
        const k = FMT.normalize(nombre);
        if (!gruposPorNombreNorm.has(k)) gruposPorNombreNorm.set(k, new Set());
        const target = gruposPorNombreNorm.get(k);
        set.forEach(g => target.add(g));
      });
      State.clientesConGrupos = {
        ids: conGrupos.ids,
        nombresNorm,
        gruposPorId: conGrupos.gruposPorId,
        gruposPorNombreNorm,
      };
      renderClientes();
    } catch (e) {
      console.error('Error cargando clientes:', e);
      $('gpClienteList').innerHTML =
        `<div style="padding:14px; color:var(--fg-3); font-size:13px;">Error al cargar clientes.</div>`;
    }
  }

  function tieneGrupos(c) {
    const cg = State.clientesConGrupos;
    if (!cg) return true;  // sin datos aún → no filtra
    return cg.ids.has(c.id) || cg.nombresNorm.has(c.norm);
  }

  // Devuelve los grupos crudos del cliente desde los datos del scan inicial.
  // Combina (union) los grupos encontrados por cliente_id y por nombre normalizado
  // para que equipos legacy se cuenten también.
  function gruposCrudosDeCliente(c) {
    const cg = State.clientesConGrupos;
    if (!cg) return [];
    const out = new Set();
    if (cg.gruposPorId.has(c.id)) cg.gruposPorId.get(c.id).forEach(g => out.add(g));
    if (cg.gruposPorNombreNorm.has(c.norm)) cg.gruposPorNombreNorm.get(c.norm).forEach(g => out.add(g));
    return Array.from(out);
  }

  // Cuenta de buckets duplicados del cliente bajo el scan activo.
  function bucketCountCliente(c) {
    if (!State.scan) return 0;
    return (State.scan.porId.get(c.id) || State.scan.porNombreNorm.get(c.norm) || 0);
  }

  // Corre el scan global usando los grupos crudos cacheados en
  // State.clientesConGrupos (no necesita nueva lectura de Firestore).
  function runScan(modo) {
    if (!State.clientesConGrupos) {
      Toast.show('Carga de clientes incompleta — recarga la página.', 'bad');
      return;
    }
    const t0 = performance.now();
    const porId = new Map();
    const porNombreNorm = new Map();
    let clientesAfectados = 0;
    let totalBuckets = 0;
    for (const c of State.clientes) {
      const grupos = gruposCrudosDeCliente(c);
      if (!grupos.length) continue;
      const n = GruposAnalisis.contarBuckets(grupos, modo);
      if (n > 0) {
        clientesAfectados++;
        totalBuckets += n;
        if (c.id) porId.set(c.id, n);
        if (c.norm) porNombreNorm.set(c.norm, n);
      }
    }
    State.scan = { mode: modo, porId, porNombreNorm, clientesAfectados, totalBuckets, at: new Date() };
    const dt = ((performance.now() - t0) / 1000).toFixed(2);
    const tipo = modo === 'fuzzy' ? 'fuzzy' : 'exactos';
    Toast.show(`Scan ${tipo}: ${clientesAfectados} clientes, ${totalBuckets} buckets · ${dt}s`, 'ok');
    renderClientes();
    // Re-render del banner derecho con el nuevo modo si hay cliente seleccionado.
    if (State.clienteSel) renderDupBanner();
  }

  function clearScan() {
    State.scan = null;
    renderClientes();
    if (State.clienteSel) renderDupBanner();
  }

  function renderClientes() {
    const cont = $('gpClienteList');
    const needle = State.clienteFiltro ? FMT.normalize(State.clienteFiltro) : '';

    // Base: con grupos o todos. Con término de búsqueda llega a TODAS las
    // empresas (incl. sin grupos) para poder pre-aprovisionar; sin término
    // muestra solo "con grupos" salvo que esté activo "Mostrar todos".
    let base = State.clientes;
    if (!needle && !State.mostrarTodos) base = base.filter(tieneGrupos);

    // Filtro por scan (si activo y "solo afectados" — siempre que hay scan
    // implícito limitamos a los que tienen buckets > 0, sino el badge no
    // aporta nada visual).
    if (State.scan) base = base.filter(c => bucketCountCliente(c) > 0);

    // Filtro de búsqueda.
    let visibles = base;
    if (needle) {
      visibles = base
        .filter(c => c.norm.includes(needle))
        .sort((a, b) => a.norm.indexOf(needle) - b.norm.indexOf(needle));
    } else if (State.scan) {
      // Orden por bucketCount desc cuando hay scan activo.
      visibles = [...base].sort((a, b) => bucketCountCliente(b) - bucketCountCliente(a));
    }
    visibles = visibles.slice(0, 200);

    // Header con toggle + estado del scan.
    const totalConGrupos = State.clientesConGrupos
      ? State.clientes.filter(tieneGrupos).length
      : State.clientes.length;

    let scanRow = '';
    if (State.scan) {
      const pill = State.scan.mode === 'fuzzy'
        ? '<span class="gp-badge gp-badge-fuzzy">fuzzy</span>'
        : '<span class="gp-badge gp-badge-exactos">exactos</span>';
      scanRow = `
        <div style="padding:6px 12px;border-bottom:1px solid var(--border-subtle);font-size:11px;color:var(--fg-3);display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--surface-sunken);">
          <span>${pill} ${State.scan.clientesAfectados} clientes · ${State.scan.totalBuckets} buckets</span>
          <button id="gpClearScan" class="btn btn-ghost btn-xs" style="font-size:10px;padding:2px 8px;">Limpiar</button>
        </div>`;
    }

    const headerHtml = `
      <div style="padding:8px 12px;border-bottom:1px solid var(--border-subtle);font-size:11px;color:var(--fg-3);display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span>${totalConGrupos} de ${State.clientes.length} clientes con grupos</span>
        <label style="display:inline-flex;align-items:center;gap:4px;cursor:pointer;">
          <input type="checkbox" id="gpToggleTodos" ${State.mostrarTodos ? 'checked' : ''} style="width:14px;height:14px;">
          <span>Mostrar todos</span>
        </label>
      </div>
      ${scanRow}`;

    if (!visibles.length) {
      let emptyMsg = 'Sin coincidencias.';
      if (!needle && State.scan) emptyMsg = `Ningún cliente con duplicados ${State.scan.mode === 'fuzzy' ? 'fuzzy' : 'exactos'} 🎉`;
      else if (!needle) emptyMsg = 'Ningún cliente tiene grupos asignados.';
      cont.innerHTML = headerHtml +
        `<div style="padding:14px; color:var(--fg-3); font-size:13px;">${emptyMsg}</div>`;
      wireToggle();
      return;
    }
    cont.innerHTML = headerHtml + visibles.map(c => {
      const activo = State.clienteSel && State.clienteSel.id === c.id ? 'active' : '';
      let badge = '';
      if (State.scan) {
        const n = bucketCountCliente(c);
        if (n > 0) {
          const cls = State.scan.mode === 'fuzzy' ? 'gp-badge-fuzzy' : 'gp-badge-exactos';
          badge = `<span class="gp-badge ${cls}" title="${n} bucket${n === 1 ? '' : 's'} de duplicados ${State.scan.mode}">${n}</span>`;
        }
      }
      const nuevoTag = (needle && !tieneGrupos(c)) ? '<span class="gp-cli-tag">nuevo</span>' : '';
      return `<div class="gp-cliente-item ${activo}" data-id="${esc(c.id)}" data-nombre="${esc(c.nombre)}">
        <span class="gp-cliente-nombre">${esc(c.nombre)}</span>${nuevoTag}${badge}
      </div>`;
    }).join('');
    cont.querySelectorAll('.gp-cliente-item').forEach(el => {
      el.addEventListener('click', () => {
        seleccionarCliente({ id: el.dataset.id, nombre: el.dataset.nombre });
      });
    });
    wireToggle();
  }

  function wireToggle() {
    const t = $('gpToggleTodos');
    if (t) t.addEventListener('change', () => {
      State.mostrarTodos = t.checked;
      renderClientes();
    });
    const c = $('gpClearScan');
    if (c) c.addEventListener('click', clearScan);
  }

  // ── Cliente → grupos ────────────────────────────────────────────────
  async function seleccionarCliente(cli) {
    State.clienteSel = cli;
    State.seleccionados.clear();
    renderClientes();
    $('btnGpReload').disabled = false;
    $('gpGrupoList').innerHTML =
      `<div style="padding:24px; text-align:center; color:var(--fg-3); font-size:13px;">Cargando grupos…</div>`;
    await cargarGruposCliente();
  }

  async function cargarGruposCliente() {
    if (!State.clienteSel) return;
    try {
      const [{ grupos, tieneCatalogo }, prefijo] = await Promise.all([
        PocService.listGruposConCatalogo({
          clienteId: State.clienteSel.id,
          clienteNombre: State.clienteSel.nombre,
          fresh: true,
        }),
        PocService.getGrupoPrefix(State.clienteSel.id),
      ]);
      State.grupos = grupos;
      State.tieneCatalogo = tieneCatalogo;
      State.clientePrefijo = prefijo;
      $('gpLastUpdate').textContent = nowTs();
      renderPrefijoBar();
      renderPanelAgregar();
      renderGrupos();
      renderDupBanner();
    } catch (e) {
      console.error('Error cargando grupos:', e);
      Toast.show('No se pudieron cargar los grupos.', 'bad');
    }
  }

  // ── Prefijo del cliente ──────────────────────────────────────────────
  function renderPrefijoBar() {
    const bar = $('gpPrefijoBar');
    if (!bar) return;
    if (!State.clienteSel) { bar.innerHTML = ''; return; }
    const p = State.clientePrefijo;
    bar.innerHTML = p
      ? `<span class="gp-prefijo-pill">Prefijo <strong>${esc(p)}</strong></span>
         <button id="gpEditPrefijo" class="btn btn-ghost btn-xs">Cambiar prefijo…</button>`
      : `<span class="gp-prefijo-pill gp-prefijo-pill--none">Sin prefijo asignado</span>
         <button id="gpEditPrefijo" class="btn btn-secondary btn-xs">Asignar prefijo…</button>`;
    const b = $('gpEditPrefijo');
    if (b) b.addEventListener('click', cambiarPrefijoCliente);
  }

  // Pide y valida un prefijo único de 3 letras; lo propone si el cliente no
  // tiene. Al confirmar, re-aplica el prefijo a TODOS los grupos del cliente.
  function pedirPrefijo(propuesto) {
    const tomados = new Set(State.prefijosTomados);
    if (State.clientePrefijo) tomados.delete(State.clientePrefijo); // puede conservar el propio
    const entrada = prompt(
      `Prefijo de 3 letras (A-Z) para ${State.clienteSel.nombre}:\n` +
      `Los grupos quedarán como PREFIJO-Nombre.`,
      propuesto
    );
    if (entrada === null) return null;
    const pfx = FMT.normalizePrefijo(entrada);
    if (pfx.length !== 3) { Toast.show('El prefijo debe ser exactamente 3 letras (A-Z).', 'bad'); return null; }
    if (tomados.has(pfx)) { Toast.show(`El prefijo "${pfx}" ya lo usa otra empresa.`, 'bad'); return null; }
    return pfx;
  }

  async function cambiarPrefijoCliente() {
    if (!State.clienteSel) return;
    const tomados = new Set(State.prefijosTomados);
    if (State.clientePrefijo) tomados.delete(State.clientePrefijo);
    const propuesto = State.clientePrefijo || GruposAnalisis.proponerPrefijo(State.clienteSel.nombre, tomados);
    const pfx = pedirPrefijo(propuesto);
    if (!pfx) return;
    if (!confirm(`Aplicar el prefijo "${pfx}" a TODOS los grupos de ${State.clienteSel.nombre} (catálogo + equipos)?`)) return;
    try {
      const { affected, prefijo } = await PocService.aplicarPrefijoCliente({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
        prefijo: pfx,
      });
      if (State.clientePrefijo) State.prefijosTomados.delete(State.clientePrefijo);
      State.prefijosTomados.add(prefijo);
      State.clientePrefijo = prefijo;
      const c = State.clientes.find(x => x.id === State.clienteSel.id);
      if (c) c.prefijo = prefijo;
      invalidarCachesGrupos();
      Toast.show(`Prefijo "${prefijo}" aplicado en ${affected} equipo${affected === 1 ? '' : 's'} ✅`, 'ok');
      await cargarGruposCliente();
    } catch (e) {
      console.error('Error aplicando prefijo:', e);
      Toast.show('Error al aplicar el prefijo.', 'bad');
    }
  }

  // Alta (uno o varios) de grupos al catálogo del cliente. Recibe nombres BASE.
  // Migración escalonada: NO se fuerza el prefijo — si el cliente ya tiene uno,
  // los grupos se prefijan; si no, se guardan crudos (luego se prefijan con
  // "Asignar prefijo…" o la migración masiva). Omite los que ya existan.
  async function agregarGruposBase(nombresBase) {
    if (!State.clienteSel) return;
    const limpios = FMT.dedupGrupos(nombresBase);
    if (!limpios.length) return;
    const prefijo = State.clientePrefijo;   // puede ser null — no forzamos
    const nuevos = limpios.filter(b => {
      const full = prefijo ? FMT.aplicarPrefijoGrupo(prefijo, b) : FMT.normalizeGrupo(b);
      return full && !State.grupos.some(g => FMT.normalize(g.nombre) === FMT.normalize(full));
    });
    if (!nuevos.length) { Toast.show('Esos grupos ya existen para este cliente.', 'warn'); return; }
    try {
      const { added } = await PocService.agregarGruposCatalogo({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
        nombres: nuevos,
        prefijo,
      });
      invalidarCachesGrupos();
      Toast.show(`${added} grupo${added === 1 ? '' : 's'} agregado${added === 1 ? '' : 's'} ✅`, 'ok');
      await cargarGruposCliente();
    } catch (e) {
      console.error('Error agregando grupos:', e);
      Toast.show('Error al agregar los grupos.', 'bad');
    }
  }

  // Parte un texto libre (líneas y/o comas) en nombres y los agrega.
  function agregarGruposDesdeTexto(texto) {
    const partes = (texto || '').split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
    if (partes.length) agregarGruposBase(partes);
  }

  // Panel de alta: input inline + "pegar varios" + chips de grupos comunes.
  function renderPanelAgregar() {
    const cont = $('gpAddPanel');
    if (!cont) return;
    if (!State.clienteSel) { cont.innerHTML = ''; return; }
    const prefijo = State.clientePrefijo;
    const have = new Set(State.grupos.map(g => FMT.normalize(g.nombre)));
    const chips = State.comunes.map(b => {
      const full = prefijo ? FMT.aplicarPrefijoGrupo(prefijo, b) : b;
      const yes = full && have.has(FMT.normalize(full));
      return `<button type="button" class="gp-chip-add ${yes ? 'is-added' : ''}" data-base="${esc(b)}" ${yes ? 'disabled' : ''}
        title="${yes ? 'Ya está en el catálogo' : 'Agregar ' + esc(b)}">${yes ? '✓ ' : '+ '}${esc(b)}</button>`;
    }).join('');
    cont.innerHTML = `
      <div class="gp-add-card">
        <div class="gp-add-row">
          <input id="gpAddInput" class="form-input" type="text" autocomplete="off"
                 placeholder="Nuevo grupo… (Enter para agregar)">
          <button id="gpAddBtn" class="btn btn-primary btn-sm"><i data-lucide="plus"></i> Agregar</button>
          <button id="gpAddVariosToggle" class="btn btn-ghost btn-sm" title="Agregar varios a la vez">
            <i data-lucide="list-plus"></i> Pegar varios
          </button>
        </div>
        <div id="gpAddVarios" class="gp-add-varios" style="display:none;">
          <textarea id="gpAddVariosText" class="form-input" rows="4"
                    placeholder="Un grupo por línea o separados por coma…"></textarea>
          <button id="gpAddVariosBtn" class="btn btn-secondary btn-sm"><i data-lucide="list-plus"></i> Agregar todos</button>
        </div>
        <div class="gp-add-comunes">
          <span class="gp-add-comunes-label">Comunes:</span>${chips}
          <button id="gpEditComunes" type="button" class="gp-comunes-edit" title="Editar la lista de grupos comunes">✎ editar</button>
        </div>
      </div>`;

    const input = $('gpAddInput');
    const altaInput = () => { const v = input.value; input.value = ''; agregarGruposDesdeTexto(v); input.focus(); };
    $('gpAddBtn').addEventListener('click', altaInput);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); altaInput(); } });
    $('gpAddVariosToggle').addEventListener('click', () => {
      const v = $('gpAddVarios');
      v.style.display = v.style.display === 'none' ? 'block' : 'none';
      if (v.style.display === 'block') $('gpAddVariosText').focus();
    });
    $('gpAddVariosBtn').addEventListener('click', () => {
      const t = $('gpAddVariosText'); const v = t.value; t.value = '';
      $('gpAddVarios').style.display = 'none';
      agregarGruposDesdeTexto(v);
    });
    cont.querySelectorAll('.gp-chip-add:not(.is-added)').forEach(b => {
      b.addEventListener('click', () => agregarGruposBase([b.dataset.base]));
    });
    const ec = $('gpEditComunes');
    if (ec) ec.addEventListener('click', abrirComunes);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Editor de la lista de grupos comunes (empresa/config) ───────────
  function abrirComunes() {
    $('gpComunesText').value = State.comunes.join('\n');
    $('gpComunesOverlay').style.display = 'flex';
    setTimeout(() => { const t = $('gpComunesText'); if (t) t.focus(); }, 50);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }
  function cerrarComunes() { $('gpComunesOverlay').style.display = 'none'; }
  async function guardarComunes() {
    const list = FMT.dedupGrupos(($('gpComunesText').value || '').split(/[\n,]+/));
    const btn = $('gpComunesGuardar');
    if (btn) btn.disabled = true;
    try {
      await EmpresaService.setConfig({ poc_grupos_comunes: list });
      State.comunes = list;
      Toast.show('Lista de grupos comunes guardada ✅', 'ok');
      cerrarComunes();
      if (State.clienteSel) renderPanelAgregar();
    } catch (e) {
      console.error('Error guardando grupos comunes:', e);
      Toast.show('Error al guardar la lista.', 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function renderGrupos() {
    const cont = $('gpGrupoList');
    if (!State.grupos.length) {
      cont.innerHTML =
        `<div style="padding:24px; text-align:center; color:var(--fg-3); font-size:13px;">
          Este cliente no tiene grupos. Usa el panel <strong>“Agregar grupos”</strong> de arriba
          (escribe uno, pega varios o toca un grupo común) para crear el primero.
        </div>`;
      actualizarBotonMerge();
      return;
    }
    const pfx = State.clientePrefijo;
    cont.innerHTML = State.grupos.map(g => {
      const checked = State.seleccionados.has(g.nombre) ? 'checked' : '';
      const sel = State.seleccionados.has(g.nombre) ? 'selected' : '';
      // Toggle "lista limpia": muestra el nombre base (sin prefijo) sin perder
      // el nombre real (data-nombre) que usan las acciones.
      const display = (State.listaLimpia && pfx
        && FMT.normalize(g.nombre).startsWith(FMT.normalize(pfx) + '-'))
        ? g.nombre.slice(pfx.length + 1)
        : g.nombre;
      return `
        <div class="gp-grupo-row ${sel}" data-nombre="${esc(g.nombre)}">
          <div style="display:flex; align-items:center; gap:10px;">
            <input type="checkbox" class="gp-check" ${checked}
                   data-nombre="${esc(g.nombre)}"
                   style="width:16px; height:16px;">
            <span class="gp-grupo-name">${esc(display)}</span>
          </div>
          <span class="gp-grupo-count ${g.count === 0 ? 'gp-grupo-count--empty' : 'gp-grupo-count--click'}"
                ${g.count > 0 ? `data-action="ver" data-nombre="${esc(g.nombre)}"` : ''}
                title="${g.count === 0 ? 'En el catálogo, sin equipos asignados todavía' : 'Ver los ' + g.count + ' equipo' + (g.count === 1 ? '' : 's')}">${g.count}</span>
          <div class="gp-grupo-actions">
            <button class="btn btn-ghost btn-sm" data-action="rename" data-nombre="${esc(g.nombre)}" title="Renombrar">
              <i data-lucide="pencil"></i>
            </button>
            <button class="btn btn-ghost btn-sm" data-action="delete" data-nombre="${esc(g.nombre)}" title="Eliminar">
              <i data-lucide="trash-2"></i>
            </button>
          </div>
        </div>`;
    }).join('');

    cont.querySelectorAll('.gp-check').forEach(el => {
      el.addEventListener('change', () => {
        const n = el.dataset.nombre;
        if (el.checked) State.seleccionados.add(n);
        else State.seleccionados.delete(n);
        el.closest('.gp-grupo-row').classList.toggle('selected', el.checked);
        actualizarBotonMerge();
      });
    });
    cont.querySelectorAll('button[data-action="rename"]').forEach(b => {
      b.addEventListener('click', () => renombrarGrupo(b.dataset.nombre));
    });
    cont.querySelectorAll('button[data-action="delete"]').forEach(b => {
      b.addEventListener('click', () => eliminarGrupo(b.dataset.nombre));
    });
    cont.querySelectorAll('.gp-grupo-count--click[data-action="ver"]').forEach(b => {
      b.addEventListener('click', () => verEquiposDeGrupo(b.dataset.nombre));
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
    actualizarBotonMerge();
  }

  // Drill-down: equipos PoC del cliente que tienen el grupo `nombre`.
  async function verEquiposDeGrupo(nombre) {
    if (!State.clienteSel) return;
    const ov = $('gpEquiposOverlay');
    $('gpEquiposTitle').innerHTML = `<i data-lucide="radio-tower"></i> Equipos en “${esc(nombre)}”`;
    $('gpEquiposResumen').textContent = '';
    $('gpEquiposList').innerHTML = '<div class="gp-mig-empty">Cargando…</div>';
    ov.style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
    try {
      const devices = await PocService.getByCliente({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
        fresh: true,
      });
      const norm = FMT.normalize(nombre);
      const equipos = devices.filter(d => d.deleted !== true
        && (d.grupos || []).some(g => FMT.normalize(g) === norm));
      if (!equipos.length) {
        $('gpEquiposList').innerHTML = '<div class="gp-mig-empty">Sin equipos con este grupo.</div>';
        return;
      }
      equipos.sort((a, b) => (a.unit_id || '').localeCompare(b.unit_id || '', 'es', { numeric: true }));
      $('gpEquiposResumen').textContent = `${equipos.length} equipo${equipos.length === 1 ? '' : 's'}`;
      $('gpEquiposList').innerHTML = equipos.map(d => `
        <div class="gp-eq-row">
          <span class="gp-eq-serial" title="${esc(d.serial || '')}">${esc(d.serial || '—')}</span>
          <span class="gp-eq-unit">${esc(d.unit_id || '—')}</span>
          <span class="gp-eq-name" title="${esc(d.radio_name || '')}">${esc(d.radio_name || '—')}</span>
          <span class="gp-eq-act" title="${d.activo !== false ? 'Activo' : 'Inactivo'}">${d.activo !== false ? '🟢' : '🔴'}</span>
        </div>`).join('');
    } catch (e) {
      console.error('Error cargando equipos del grupo:', e);
      $('gpEquiposList').innerHTML = '<div class="gp-mig-empty">Error al cargar los equipos.</div>';
    }
  }

  function cerrarEquipos() { $('gpEquiposOverlay').style.display = 'none'; }

  function actualizarBotonMerge() {
    const btn = $('btnGpMerge');
    btn.disabled = State.seleccionados.size < 2;
    btn.title = btn.disabled
      ? 'Selecciona 2 o más grupos para fusionar'
      : `Fusionar ${State.seleccionados.size} grupos`;
  }

  // ── Banner de duplicados ────────────────────────────────────────────
  // Por defecto detecta solo "exactos" (lo que ya hacía antes). Si el scan
  // global activo es 'fuzzy', también renderiza un banner amarillo separado
  // con candidatos fuzzy — éstos NO se auto-fusionan: solo abren el flujo
  // manual con la selección previa.
  function detectarBucketsLocales(modo) {
    const grupos = State.grupos.map(g => g.nombre);
    const buckets = modo === 'fuzzy'
      ? GruposAnalisis.bucketsFuzzy(grupos)
      : GruposAnalisis.bucketsExactos(grupos);
    // Asocia cada nombre raw con su entry de State.grupos para mostrar counts.
    const byName = new Map(State.grupos.map(g => [g.nombre, g]));
    return buckets.map(arr => arr.map(n => byName.get(n)).filter(Boolean));
  }

  function renderDupBanner() {
    const cont = $('gpDupBanner');
    const dupsExactos = detectarBucketsLocales('exactos');
    const dupsFuzzy = (State.scan && State.scan.mode === 'fuzzy')
      ? detectarBucketsLocales('fuzzy')
      : [];

    let html = '';

    if (dupsExactos.length) {
      const first = dupsExactos[0];
      const sortedByCount = [...first].sort((a, b) => b.count - a.count);
      const target = sortedByCount[0].nombre;
      const sources = sortedByCount.slice(1).map(g => g.nombre);
      const nombres = first.map(g => `<strong>${esc(g.nombre)}</strong> (${g.count})`).join(', ');
      html += `
        <div class="gp-dup-banner gp-dup-exactos">
          <strong>🔴 Duplicados exactos — auto-mergeable</strong>
          Estos grupos solo difieren en mayúsculas, acentos o espacios: ${nombres}.
          ${dupsExactos.length > 1 ? `Hay ${dupsExactos.length - 1} bucket(s) más con la misma situación.` : ''}
          <div>
            <button class="btn btn-secondary btn-sm" id="btnGpMergeSug">
              <i data-lucide="git-merge"></i> Fusionar en "${esc(target)}"
            </button>
          </div>
        </div>`;
    }

    if (dupsFuzzy.length) {
      const first = dupsFuzzy[0];
      const nombres = first.map(g => `<strong>${esc(g.nombre)}</strong> (${g.count})`).join(', ');
      const ids = first.map(g => g.nombre).join('|');
      html += `
        <div class="gp-dup-banner gp-dup-fuzzy">
          <strong>🟡 Posibles fuzzy duplicates — revisa antes de fusionar</strong>
          Estos nombres son similares pero podrían ser conceptos distintos: ${nombres}.
          ${dupsFuzzy.length > 1 ? `Hay ${dupsFuzzy.length - 1} bucket(s) más con candidatos similares.` : ''}
          <div>
            <button class="btn btn-ghost btn-sm" data-fuzzy-preselect="${esc(ids)}">
              <i data-lucide="check-square"></i> Preseleccionar para revisar
            </button>
          </div>
        </div>`;
    }

    cont.innerHTML = html;
    const sug = $('btnGpMergeSug');
    if (sug) sug.addEventListener('click', () => {
      const first = dupsExactos[0];
      const sortedByCount = [...first].sort((a, b) => b.count - a.count);
      const target = sortedByCount[0].nombre;
      const sources = sortedByCount.slice(1).map(g => g.nombre);
      fusionarGrupos(sources, target);
    });
    const fuz = cont.querySelector('[data-fuzzy-preselect]');
    if (fuz) fuz.addEventListener('click', () => {
      const ids = fuz.dataset.fuzzyPreselect.split('|');
      State.seleccionados = new Set(ids);
      renderGrupos();
      Toast.show('Grupos preseleccionados — revisa y usa "Fusionar seleccionados" si es correcto.', 'warn');
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Migración de prefijos (admin-only) ──────────────────────────────
  // Modal con la lista editable de empresas + su prefijo (propuesto o ya
  // guardado). Al aplicar, cada grupo se renombra a PREFIJO-Nombre en catálogo
  // + equipos (idempotente). El universo de grupos por cliente sale del scan
  // server-fresh en State.clientesConGrupos (gruposCrudosDeCliente).
  function abrirMigracion() {
    if (!State.clientesConGrupos) {
      Toast.show('Carga de clientes incompleta — recarga la página.', 'bad');
      return;
    }
    // Prefijos ya guardados en OTROS clientes (semilla de unicidad).
    const usados = new Set(State.prefijosTomados);
    const filas = [];
    for (const c of State.clientes) {
      const grupos = gruposCrudosDeCliente(c);
      if (!grupos.length && !c.prefijo) continue;  // nada que migrar
      filas.push({ id: c.id, nombre: c.nombre, grupos, nGrupos: grupos.length, prefijo: c.prefijo || '' });
    }
    // Propone prefijo a quien no tenga, manteniendo unicidad global.
    filas.forEach(f => {
      if (!f.prefijo) f.prefijo = GruposAnalisis.proponerPrefijo(f.nombre, usados);
      usados.add(f.prefijo);
    });
    State.migFilas = filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    $('gpMigStatus').textContent = '';
    renderMigList();
    $('gpMigOverlay').style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function cerrarMigracion() {
    $('gpMigOverlay').style.display = 'none';
  }

  function ejemploFila(f) {
    const ej = f.grupos.slice(0, 2).map(g => FMT.aplicarPrefijoGrupo(f.prefijo, g)).filter(Boolean).join(', ');
    return ej + (f.grupos.length > 2 ? '…' : '');
  }

  function renderMigList() {
    const cont = $('gpMigList');
    if (!State.migFilas.length) {
      cont.innerHTML = '<div class="gp-mig-empty">No hay empresas con grupos para migrar.</div>';
      validarMig();
      return;
    }
    cont.innerHTML = State.migFilas.map((f, i) => `
      <div class="gp-mig-row" data-i="${i}">
        <span class="gp-mig-name" title="${esc(f.nombre)}">${esc(f.nombre)}</span>
        <input class="gp-mig-prefix" data-i="${i}" maxlength="3" value="${esc(f.prefijo)}"
               autocomplete="off" spellcheck="false" aria-label="Prefijo de ${esc(f.nombre)}">
        <span class="gp-mig-ngrupos">${f.nGrupos} grupo${f.nGrupos === 1 ? '' : 's'}</span>
        <span class="gp-mig-ej" title="${esc(ejemploFila(f))}">${esc(ejemploFila(f))}</span>
      </div>`).join('');
    cont.querySelectorAll('.gp-mig-prefix').forEach(inp => {
      inp.addEventListener('input', () => {
        const i = +inp.dataset.i;
        const norm = FMT.normalizePrefijo(inp.value);
        State.migFilas[i].prefijo = norm;
        if (inp.value !== norm) inp.value = norm;
        const row = inp.closest('.gp-mig-row');
        const ej = row.querySelector('.gp-mig-ej');
        ej.textContent = ejemploFila(State.migFilas[i]);
        ej.title = ejemploFila(State.migFilas[i]);
        validarMig();
      });
    });
    validarMig();
  }

  function validarMig() {
    const counts = new Map();
    State.migFilas.forEach(f => {
      if (f.prefijo.length === 3) counts.set(f.prefijo, (counts.get(f.prefijo) || 0) + 1);
    });
    let invalid = 0, dups = 0;
    $('gpMigList').querySelectorAll('.gp-mig-row').forEach(row => {
      const i = +row.dataset.i;
      const f = State.migFilas[i];
      const inp = row.querySelector('.gp-mig-prefix');
      const isInvalid = f.prefijo.length !== 3;
      const isDup = !isInvalid && counts.get(f.prefijo) > 1;
      inp.classList.toggle('is-invalid', isInvalid);
      inp.classList.toggle('is-dup', isDup);
      if (isInvalid) invalid++;
      if (isDup) dups++;
    });
    const ok = invalid === 0 && dups === 0 && State.migFilas.length > 0;
    $('gpMigApply').disabled = !ok;
    $('gpMigCount').textContent = State.migFilas.length === 0
      ? ''
      : (ok ? `${State.migFilas.length} empresa(s) listas`
            : `${invalid} inválido(s), ${dups} duplicado(s)`);
  }

  async function aplicarMigracion() {
    const filas = State.migFilas;
    if (!filas.length) return;
    if (!confirm(
      `Aplicar prefijos y renombrar grupos en ${filas.length} empresa(s)?\n\n` +
      `Esto modifica el catálogo Y los equipos en producción. Es idempotente (se puede repetir).`
    )) return;
    const apply = $('gpMigApply');
    const cancel = $('gpMigCancel');
    const status = $('gpMigStatus');
    apply.disabled = true; if (cancel) cancel.disabled = true;
    let ok = 0, fail = 0;
    for (let i = 0; i < filas.length; i++) {
      const f = filas[i];
      status.textContent = `Migrando ${i + 1}/${filas.length}: ${f.nombre}…`;
      try {
        await PocService.aplicarPrefijoCliente({ clienteId: f.id, clienteNombre: f.nombre, prefijo: f.prefijo });
        ok++;
        const c = State.clientes.find(x => x.id === f.id);
        if (c) c.prefijo = f.prefijo;
        State.prefijosTomados.add(f.prefijo);
      } catch (e) {
        console.error('Migración falló para', f.nombre, e);
        fail++;
      }
    }
    status.textContent = `Listo: ${ok} ok${fail ? `, ${fail} con error` : ''}.`;
    Toast.show(`Migración: ${ok} empresa(s) ✅${fail ? `, ${fail} con error` : ''}`, fail ? 'warn' : 'ok');
    if (cancel) cancel.disabled = false;
    if (State.clienteSel) {
      State.clientePrefijo = await PocService.getGrupoPrefix(State.clienteSel.id);
      renderPrefijoBar();
      await cargarGruposCliente();
    }
    setTimeout(cerrarMigracion, 1400);
  }

  // ── Vista global de empresas (admin-only) ───────────────────────────
  // Tabla de todas las empresas con prefijo + # grupos (catálogo / equipos),
  // marca las sin prefijo y los prefijos repetidos, y exporta a CSV.
  function abrirGlobal() {
    const prefijoCount = new Map();
    State.clientes.forEach(c => { if (c.prefijo) prefijoCount.set(c.prefijo, (prefijoCount.get(c.prefijo) || 0) + 1); });
    const filas = [];
    for (const c of State.clientes) {
      const nDev = gruposCrudosDeCliente(c).length;
      const nCat = (typeof c.nCatalogo === 'number') ? c.nCatalogo : 0;
      if (!c.prefijo && nDev === 0 && nCat === 0) continue;  // empresas sin nada
      filas.push({
        nombre: c.nombre,
        prefijo: c.prefijo || '',
        nCat, nDev,
        dupPrefijo: !!(c.prefijo && prefijoCount.get(c.prefijo) > 1),
      });
    }
    filas.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' }));
    State.globalFilas = filas;
    renderGlobal();
    // Exportar a CSV solo para admin: recepción no ve el botón aunque llegara
    // a abrir esta vista.
    const exp = $('gpGlobalExport');
    if (exp) exp.style.display = (State.rol === ROLES.ADMIN) ? '' : 'none';
    $('gpGlobalOverlay').style.display = 'flex';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function cerrarGlobal() { $('gpGlobalOverlay').style.display = 'none'; }

  function renderGlobal() {
    const filas = State.globalFilas;
    const sinPrefijo = filas.filter(f => !f.prefijo).length;
    const dups = new Set(filas.filter(f => f.dupPrefijo).map(f => f.prefijo)).size;
    $('gpGlobalResumen').innerHTML =
      `${filas.length} empresas · ${sinPrefijo} sin prefijo`
      + (dups ? ` · <strong style="color:#DC2626;">${dups} prefijo(s) duplicado(s)</strong>` : '');
    $('gpGlobalList').innerHTML = filas.map(f => `
      <div class="gp-glob-row">
        <span class="gp-glob-name" title="${esc(f.nombre)}">${esc(f.nombre)}</span>
        <span class="gp-glob-pfx ${!f.prefijo ? 'is-none' : ''} ${f.dupPrefijo ? 'is-dup' : ''}">${f.prefijo ? esc(f.prefijo) : '—'}</span>
        <span class="gp-glob-num">${f.nCat}</span>
        <span class="gp-glob-num">${f.nDev}</span>
      </div>`).join('') || '<div class="gp-mig-empty">No hay empresas con grupos.</div>';
  }

  function csvCell(v) {
    const s = (v == null ? '' : String(v));
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportarGlobalCSV() {
    // Exportar a CSV es solo para administradores (por ahora). Guard a nivel de
    // la acción, además de ocultar el botón a recepción en abrirGlobal().
    if (State.rol !== ROLES.ADMIN) {
      Toast.show('La exportación a CSV es solo para administradores.', 'bad');
      return;
    }
    const filas = State.globalFilas;
    if (!filas.length) { Toast.show('Nada que exportar.', 'warn'); return; }
    const head = ['Empresa', 'Prefijo', 'Grupos (catalogo)', 'Grupos (equipos)', 'Estado'];
    const lines = [head.join(',')];
    filas.forEach(f => {
      const estado = !f.prefijo ? 'sin prefijo' : (f.dupPrefijo ? 'prefijo duplicado' : 'ok');
      lines.push([f.nombre, f.prefijo, f.nCat, f.nDev, estado].map(csvCell).join(','));
    });
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'grupos-por-empresa.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  // ── Cache invalidation ───────────────────────────────────────────────
  // vendedores-batch caches groups under both the client ID and the normalized
  // name. Clear both keys so the next pull is fresh.
  function invalidarCachesGrupos() {
    if (!State.clienteSel) return;
    try {
      localStorage.removeItem('grupos_v2_' + State.clienteSel.id);
      localStorage.removeItem('grupos_v2_' + FMT.normalize(State.clienteSel.nombre));
    } catch (_) {}
  }

  // ── Actions ─────────────────────────────────────────────────────────
  async function renombrarGrupo(nombre) {
    const nuevo = prompt(`Nuevo nombre para "${nombre}":`, nombre);
    if (!nuevo) return;
    let nuevoN = FMT.normalizeGrupo(nuevo);
    // Conserva el prefijo del cliente en el nombre nuevo.
    if (State.clientePrefijo) nuevoN = FMT.aplicarPrefijoGrupo(State.clientePrefijo, nuevoN);
    if (!nuevoN || nuevoN === nombre) return;
    if (!confirm(`Renombrar "${nombre}" → "${nuevoN}" en todos los equipos de ${State.clienteSel.nombre}?`)) return;
    try {
      const { affected } = await PocService.renombrarGrupo({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
        from: nombre,
        to: nuevoN,
      });
      invalidarCachesGrupos();
      Toast.show(`Renombrado en ${affected} equipo${affected === 1 ? '' : 's'} ✅`, 'ok');
      await cargarGruposCliente();
    } catch (e) {
      console.error('Error renombrando grupo:', e);
      Toast.show('Error al renombrar el grupo.', 'bad');
    }
  }

  async function eliminarGrupo(nombre) {
    const grupo = State.grupos.find(g => g.nombre === nombre);
    const count = grupo ? grupo.count : 0;
    if (!confirm(
      `Eliminar grupo "${nombre}" de ${count} equipo${count === 1 ? '' : 's'} de ${State.clienteSel.nombre}?\n\n` +
      `Esta acción quita el grupo de los equipos, no los elimina.`
    )) return;
    try {
      const { affected } = await PocService.eliminarGrupo({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
        nombre,
      });
      invalidarCachesGrupos();
      Toast.show(`Eliminado de ${affected} equipo${affected === 1 ? '' : 's'} ✅`, 'ok');
      State.seleccionados.delete(nombre);
      await cargarGruposCliente();
    } catch (e) {
      console.error('Error eliminando grupo:', e);
      Toast.show('Error al eliminar el grupo.', 'bad');
    }
  }

  async function fusionarGrupos(sources, target) {
    sources = (sources || []).filter(s => s && s !== target);
    if (!sources.length || !target) return;
    const totalEquipos = State.grupos
      .filter(g => sources.includes(g.nombre) || g.nombre === target)
      .reduce((acc, g) => acc + g.count, 0);
    if (!confirm(
      `Fusionar ${sources.length} grupo${sources.length === 1 ? '' : 's'} (${sources.map(s => `"${s}"`).join(', ')}) ` +
      `en "${target}"?\n\nSe actualizarán hasta ${totalEquipos} equipos de ${State.clienteSel.nombre}.`
    )) return;
    try {
      const { affected } = await PocService.fusionarGrupos({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
        sources,
        target,
      });
      invalidarCachesGrupos();
      Toast.show(`Fusionados en ${affected} equipo${affected === 1 ? '' : 's'} ✅`, 'ok');
      State.seleccionados.clear();
      await cargarGruposCliente();
    } catch (e) {
      console.error('Error fusionando grupos:', e);
      Toast.show('Error al fusionar los grupos.', 'bad');
    }
  }

  // "Fusionar seleccionados" toolbar action: prompt for target name from the
  // current selection.
  async function mergeSeleccionados() {
    const seleccion = Array.from(State.seleccionados);
    if (seleccion.length < 2) return;
    const target = prompt(
      `Fusionar estos grupos en uno:\n\n${seleccion.map(s => '• ' + s).join('\n')}\n\n` +
      `Escribe el nombre final (puede ser uno de la lista o uno nuevo):`,
      seleccion[0]
    );
    if (!target) return;
    const targetN = target.toString().trim().replace(/\s+/g, ' ');
    if (!targetN) return;
    const sources = seleccion.filter(s => s !== targetN);
    if (!sources.length) { Toast.show('Nada que fusionar (el destino ya es la única selección).', 'warn'); return; }
    await fusionarGrupos(sources, targetN);
  }

  // ── Init ────────────────────────────────────────────────────────────
  function bindUI() {
    $('gpClienteSearch').addEventListener('input', e => {
      State.clienteFiltro = e.target.value || '';
      renderClientes();
    });
    $('btnGpReload').addEventListener('click', () => cargarGruposCliente());
    $('btnGpMerge').addEventListener('click', () => mergeSeleccionados());

    // Toggle "Lista limpia" (persistente): muestra los nombres sin el prefijo.
    try { State.listaLimpia = localStorage.getItem('gp_lista_limpia') === '1'; } catch (_) {}
    const limpia = $('gpToggleLimpia');
    if (limpia) {
      limpia.checked = State.listaLimpia;
      limpia.addEventListener('change', () => {
        State.listaLimpia = limpia.checked;
        try { localStorage.setItem('gp_lista_limpia', limpia.checked ? '1' : '0'); } catch (_) {}
        if (State.clienteSel) renderGrupos();
      });
    }
    const mig = $('btnGpMigrarPrefijos');
    if (mig) mig.addEventListener('click', abrirMigracion);
    const migClose = $('gpMigClose');   if (migClose)  migClose.addEventListener('click', cerrarMigracion);
    const migCancel = $('gpMigCancel');  if (migCancel) migCancel.addEventListener('click', cerrarMigracion);
    const migApply = $('gpMigApply');    if (migApply)  migApply.addEventListener('click', aplicarMigracion);
    const migOv = $('gpMigOverlay');
    if (migOv) migOv.addEventListener('click', e => { if (e.target === migOv) cerrarMigracion(); });

    const glob = $('btnGpVistaGlobal');  if (glob)       glob.addEventListener('click', abrirGlobal);
    const globClose = $('gpGlobalClose');  if (globClose)  globClose.addEventListener('click', cerrarGlobal);
    const globExport = $('gpGlobalExport'); if (globExport) globExport.addEventListener('click', exportarGlobalCSV);
    const globOv = $('gpGlobalOverlay');
    if (globOv) globOv.addEventListener('click', e => { if (e.target === globOv) cerrarGlobal(); });

    const eqClose = $('gpEquiposClose'); if (eqClose) eqClose.addEventListener('click', cerrarEquipos);
    const eqOv = $('gpEquiposOverlay');
    if (eqOv) eqOv.addEventListener('click', e => { if (e.target === eqOv) cerrarEquipos(); });

    const comClose = $('gpComunesClose');   if (comClose)  comClose.addEventListener('click', cerrarComunes);
    const comCancel = $('gpComunesCancel');  if (comCancel) comCancel.addEventListener('click', cerrarComunes);
    const comSave = $('gpComunesGuardar');   if (comSave)   comSave.addEventListener('click', guardarComunes);
    const comOv = $('gpComunesOverlay');
    if (comOv) comOv.addEventListener('click', e => { if (e.target === comOv) cerrarComunes(); });
    const sExact = $('btnGpScanExactos');
    if (sExact) sExact.addEventListener('click', () => runScan('exactos'));
    const sFuzzy = $('btnGpScanFuzzy');
    if (sFuzzy) sFuzzy.addEventListener('click', () => runScan('fuzzy'));
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindUI();
  });

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '../login.html'; return; }
    try {
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const rol = userDoc ? userDoc.rol : null;
      if (![ROLES.ADMIN, ROLES.RECEPCION].includes(rol)) {
        Toast.show('Acceso restringido a administradores y recepción.', 'bad');
        // Devuelve a donde tiene acceso según su rol — los roles permitidos
        // que llegan aquí (admin/recepcion) pasan; los demás vuelven al home.
        window.location.href = '../index.html';
        return;
      }
      State.rol = rol;
      // Migración masiva y vista global son admin-only; recepción administra
      // grupos por cliente pero no migra ni audita todas las empresas en lote.
      const mig = $('btnGpMigrarPrefijos');
      if (mig && rol === ROLES.ADMIN) mig.style.display = '';
      const glob = $('btnGpVistaGlobal');
      if (glob && rol === ROLES.ADMIN) glob.style.display = '';
      await cargarClientes();
    } catch (e) {
      console.error('Error inicializando admin/grupos:', e);
      window.location.href = 'index.html';
    }
  });
})();
