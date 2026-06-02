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
 * localStorage under `grupos_id_<clienteId>` / `grupos_id_<nombreNorm>`.
 * After any write we clear those entries so the batch tool picks up the
 * change on next refresh.
 */
(function () {
  'use strict';

  const State = {
    clientes: [],          // [{ id, nombre, norm }]
    clienteFiltro: '',
    clienteSel: null,      // { id, nombre } | null
    grupos: [],            // [{ nombre, count, devices: [] }]
    seleccionados: new Set(),
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
      const lista = await ClientesService.getAllClientes();
      State.clientes = lista.map(c => ({
        id: c.id,
        nombre: (c.nombre || '').toString(),
        norm: FMT.normalize(c.nombre || ''),
      }));
      renderClientes();
    } catch (e) {
      console.error('Error cargando clientes:', e);
      $('gpClienteList').innerHTML =
        `<div style="padding:14px; color:var(--fg-3); font-size:13px;">Error al cargar clientes.</div>`;
    }
  }

  function renderClientes() {
    const cont = $('gpClienteList');
    const needle = State.clienteFiltro ? FMT.normalize(State.clienteFiltro) : '';
    let visibles = State.clientes;
    if (needle) {
      visibles = State.clientes
        .filter(c => c.norm.includes(needle))
        .sort((a, b) => a.norm.indexOf(needle) - b.norm.indexOf(needle));
    }
    visibles = visibles.slice(0, 200);
    if (!visibles.length) {
      cont.innerHTML = `<div style="padding:14px; color:var(--fg-3); font-size:13px;">Sin coincidencias.</div>`;
      return;
    }
    cont.innerHTML = visibles.map(c => {
      const activo = State.clienteSel && State.clienteSel.id === c.id ? 'active' : '';
      return `<div class="gp-cliente-item ${activo}" data-id="${esc(c.id)}" data-nombre="${esc(c.nombre)}">${esc(c.nombre)}</div>`;
    }).join('');
    cont.querySelectorAll('.gp-cliente-item').forEach(el => {
      el.addEventListener('click', () => {
        seleccionarCliente({ id: el.dataset.id, nombre: el.dataset.nombre });
      });
    });
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
      const grupos = await PocService.listGruposByCliente({
        clienteId: State.clienteSel.id,
        clienteNombre: State.clienteSel.nombre,
      });
      State.grupos = grupos;
      $('gpLastUpdate').textContent = nowTs();
      renderGrupos();
      renderDupBanner();
    } catch (e) {
      console.error('Error cargando grupos:', e);
      Toast.show('No se pudieron cargar los grupos.', 'bad');
    }
  }

  function renderGrupos() {
    const cont = $('gpGrupoList');
    if (!State.grupos.length) {
      cont.innerHTML =
        `<div style="padding:24px; text-align:center; color:var(--fg-3); font-size:13px;">
          Este cliente no tiene grupos asignados a equipos.
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
          <span class="gp-grupo-count" title="${g.count} equipo${g.count === 1 ? '' : 's'}">${g.count}</span>
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

  // ── Near-duplicate detector ─────────────────────────────────────────
  // Buckets groups whose normalized form (lowercase + accent-stripped + whitespace
  // collapsed) match. Surfaces the first bucket with > 1 group as a one-click
  // merge suggestion.
  function detectarDuplicados() {
    const buckets = new Map();
    State.grupos.forEach(g => {
      const k = FMT.normalize(g.nombre).replace(/\s+/g, ' ').trim();
      if (!buckets.has(k)) buckets.set(k, []);
      buckets.get(k).push(g);
    });
    return Array.from(buckets.values()).filter(arr => arr.length > 1);
  }

  function renderDupBanner() {
    const cont = $('gpDupBanner');
    const dups = detectarDuplicados();
    if (!dups.length) { cont.innerHTML = ''; return; }
    const first = dups[0];
    const sortedByCount = [...first].sort((a, b) => b.count - a.count);
    const target = sortedByCount[0].nombre;
    const sources = sortedByCount.slice(1).map(g => g.nombre);
    const nombres = first.map(g => `<strong>${esc(g.nombre)}</strong> (${g.count})`).join(', ');
    cont.innerHTML = `
      <div class="gp-dup-banner">
        <strong>Posibles duplicados detectados</strong>
        Estos grupos solo difieren en mayúsculas, acentos o espacios: ${nombres}.
        ${dups.length > 1 ? `Hay ${dups.length} grupos más con duplicados similares.` : ''}
        <div>
          <button class="btn btn-secondary btn-sm" id="btnGpMergeSug">
            <i data-lucide="git-merge"></i> Fusionar en "${esc(target)}"
          </button>
        </div>
      </div>`;
    $('btnGpMergeSug').addEventListener('click', () => fusionarGrupos(sources, target));
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  // ── Cache invalidation ───────────────────────────────────────────────
  // vendedores-batch caches groups under both the client ID and the normalized
  // name. Clear both keys so the next pull is fresh.
  function invalidarCachesGrupos() {
    if (!State.clienteSel) return;
    try {
      localStorage.removeItem('grupos_id_' + State.clienteSel.id);
      localStorage.removeItem('grupos_id_' + FMT.normalize(State.clienteSel.nombre));
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
    $('btnGpMerge').addEventListener('click', () => mergeSeleccionados());
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindUI();
  });

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '../login.html'; return; }
    try {
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const rol = userDoc ? userDoc.rol : null;
      if (![ROLES.ADMIN].includes(rol)) {
        Toast.show('Acceso restringido a administradores.', 'bad');
        window.location.href = 'index.html';
        return;
      }
      await cargarClientes();
    } catch (e) {
      console.error('Error inicializando admin/grupos:', e);
      window.location.href = 'index.html';
    }
  });
})();
