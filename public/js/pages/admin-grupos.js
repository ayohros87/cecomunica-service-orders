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
    rol: null,               // rol del usuario actual (gate del sembrado masivo)
    seleccionados: new Set(),

    // Scan de duplicados — null = ningún scan corrido, sino objeto con análisis.
    // mode: 'exactos' | 'fuzzy'
    // porId/porNombre: Map<key, bucketCount> (solo > 0)
    scan: null,
  };

  function $(id) { return document.getElementById(id); }
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
      const [lista, conGrupos] = await Promise.all([
        ClientesService.getAllClientes(),
        PocService.getClientesConGrupos(),
      ]);
      State.clientes = lista.map(c => ({
        id: c.id,
        nombre: (c.nombre || '').toString(),
        norm: FMT.normalize(c.nombre || ''),
      }));
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

    // Base: con grupos o todos.
    let base = State.clientes;
    if (!State.mostrarTodos) base = base.filter(tieneGrupos);

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
      return `<div class="gp-cliente-item ${activo}" data-id="${esc(c.id)}" data-nombre="${esc(c.nombre)}">
        <span class="gp-cliente-nombre">${esc(c.nombre)}</span>${badge}
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
      const { grupos, tieneCatalogo } = await PocService.listGruposConCatalogo({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
      });
      State.grupos = grupos;
      State.tieneCatalogo = tieneCatalogo;
      $('gpLastUpdate').textContent = nowTs();
      const addBtn = $('btnGpAddGrupo');
      if (addBtn) addBtn.disabled = false;
      renderGrupos();
      renderDupBanner();
    } catch (e) {
      console.error('Error cargando grupos:', e);
      Toast.show('No se pudieron cargar los grupos.', 'bad');
    }
  }

  // Add a group to the client's catalog (no device needed). Shows up with a
  // "0 equipos" badge until it's tagged onto equipos at data-entry.
  async function agregarGrupo() {
    if (!State.clienteSel) return;
    const nombre = FMT.normalizeGrupo(prompt(`Nuevo grupo para ${State.clienteSel.nombre}:`) || '');
    if (!nombre) return;
    if (State.grupos.some(g => FMT.normalize(g.nombre) === FMT.normalize(nombre))) {
      Toast.show('Ese grupo ya existe para este cliente.', 'warn');
      return;
    }
    try {
      const { added } = await PocService.agregarGrupoCatalogo({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
        nombre,
      });
      invalidarCachesGrupos();
      Toast.show(added ? `Grupo "${nombre}" agregado ✅` : 'Ese grupo ya existía.', added ? 'ok' : 'warn');
      await cargarGruposCliente();
    } catch (e) {
      console.error('Error agregando grupo:', e);
      Toast.show('Error al agregar el grupo.', 'bad');
    }
  }

  function renderGrupos() {
    const cont = $('gpGrupoList');
    if (!State.grupos.length) {
      cont.innerHTML =
        `<div style="padding:24px; text-align:center; color:var(--fg-3); font-size:13px;">
          Este cliente no tiene grupos. Usa <strong>“Agregar grupo”</strong> para crear el primero.
        </div>`;
      actualizarBotonMerge();
      return;
    }
    cont.innerHTML = State.grupos.map(g => {
      const checked = State.seleccionados.has(g.nombre) ? 'checked' : '';
      const sel = State.seleccionados.has(g.nombre) ? 'selected' : '';
      return `
        <div class="gp-grupo-row ${sel}" data-nombre="${esc(g.nombre)}">
          <div style="display:flex; align-items:center; gap:10px;">
            <input type="checkbox" class="gp-check" ${checked}
                   data-nombre="${esc(g.nombre)}"
                   style="width:16px; height:16px;">
            <span class="gp-grupo-name">${esc(g.nombre)}</span>
          </div>
          <span class="gp-grupo-count ${g.count === 0 ? 'gp-grupo-count--empty' : ''}"
                title="${g.count === 0 ? 'En el catálogo, sin equipos asignados todavía' : g.count + ' equipo' + (g.count === 1 ? '' : 's')}">${g.count}</span>
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

    if (typeof lucide !== 'undefined') lucide.createIcons();
    actualizarBotonMerge();
  }

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

  // ── Backfill: seed catalogs from device tags (admin-only, one-shot) ──
  // Writes clientes/{id}.poc_grupos from the device-derived union already
  // loaded in State.clientesConGrupos. Idempotent: skips clients that already
  // have a catalog. Batched (450/commit).
  async function sembrarCatalogos() {
    if (!State.clientesConGrupos) {
      Toast.show('Carga de clientes incompleta — recarga la página.', 'bad');
      return;
    }
    if (!confirm(
      'Inicializar el catálogo de grupos (poc_grupos) de cada cliente a partir de los grupos ' +
      'que hoy tienen sus equipos.\n\n' +
      'Solo escribe clientes que AÚN NO tienen catálogo (idempotente — se puede repetir sin riesgo). ¿Continuar?'
    )) return;
    const btn = $('btnGpSeedCatalogo');
    if (btn) btn.disabled = true;
    try {
      // Full docs (cache-first) para saber quién ya tiene catálogo.
      const full = await ClientesService.getAllClientes();
      const yaTiene = new Set(full.filter(c => Array.isArray(c.poc_grupos)).map(c => c.id));
      const pendientes = [];
      for (const c of State.clientes) {
        if (yaTiene.has(c.id)) continue;
        const grupos = gruposCrudosDeCliente(c);
        if (grupos.length) pendientes.push({ id: c.id, grupos });
      }
      if (!pendientes.length) {
        Toast.show('Todos los catálogos ya están al día. Nada que sembrar.', 'ok');
        return;
      }
      const db = firebase.firestore();
      const uid = firebase.auth().currentUser?.uid || null;
      const CHUNK = 450;
      let ok = 0;
      for (let i = 0; i < pendientes.length; i += CHUNK) {
        const batch = db.batch();
        for (const p of pendientes.slice(i, i + CHUNK)) {
          const limpio = FMT.dedupGrupos(p.grupos)
            .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
          batch.update(db.collection('clientes').doc(p.id), {
            poc_grupos: limpio,
            updated_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_by: uid,
          });
          ok++;
        }
        await batch.commit();
      }
      Toast.show(`Catálogo inicializado en ${ok} cliente${ok === 1 ? '' : 's'} ✅`, 'ok');
      if (State.clienteSel) await cargarGruposCliente();
    } catch (e) {
      console.error('Error sembrando catálogos:', e);
      Toast.show('Error al inicializar catálogos.', 'bad');
    } finally {
      if (btn) btn.disabled = false;
    }
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
    const nuevoN = nuevo.toString().trim().replace(/\s+/g, ' ');
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
    $('btnGpAddGrupo').addEventListener('click', () => agregarGrupo());
    $('btnGpMerge').addEventListener('click', () => mergeSeleccionados());
    const seed = $('btnGpSeedCatalogo');
    if (seed) seed.addEventListener('click', () => sembrarCatalogos());
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
      // El sembrado masivo (inicializa catálogos de TODOS los clientes) es
      // admin-only; recepción administra grupos por cliente pero no migra en lote.
      const seed = $('btnGpSeedCatalogo');
      if (seed && rol === ROLES.ADMIN) seed.style.display = '';
      await cargarClientes();
    } catch (e) {
      console.error('Error inicializando admin/grupos:', e);
      window.location.href = 'index.html';
    }
  });
})();
