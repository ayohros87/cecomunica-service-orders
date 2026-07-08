// @ts-nocheck
/**
 * admin-clientes-duplicados.js — Revisión y fusión de clientes duplicados.
 *
 * Escanea todos los clientes activos, los agrupa en clústeres de duplicados
 * (ver ClientesDedupService) y muestra cada grupo para revisión. Para cada
 * grupo eliges el registro a conservar (canónico) y cuáles incluir; al fusionar
 * se re-apuntan referencias y se hace soft-delete de los duplicados.
 */
(function () {
  'use strict';

  const State = { clusters: [] }; // [{ id, miembros:[cliente], refs:{id->{...}} }]

  function $(id) { return document.getElementById(id); }
  function esc(s) { return FMT.esc(s); } // helper canónico (core/formatting.js)
  const Svc = () => window.ClientesDedupService;

  async function escanear() {
    const btn = $('btnEscanear');
    btn.disabled = true;
    $('dupResumen').textContent = 'Escaneando…';
    $('dupList').innerHTML = '<div class="dup-empty">Cargando clientes y detectando duplicados…</div>';
    try {
      const clientes = await Svc().getClientesActivos();
      const clusters = Svc().buildClusters(clientes);
      // Confianza por grupo; exactos primero, "revisar" (fuzzy) después.
      State.clusters = clusters
        .map((miembros, i) => ({ id: 'cl' + i, miembros, refs: {}, confianza: Svc().clusterConfianza(miembros) }))
        .sort((a, b) => (a.confianza === b.confianza ? b.miembros.length - a.miembros.length : (a.confianza === 'exacta' ? -1 : 1)));
      $('dupResumen').textContent =
        `${clientes.length} clientes · ${State.clusters.length} grupo(s) de duplicados`;
      if (!State.clusters.length) {
        $('dupList').innerHTML = '<div class="dup-empty">Sin duplicados detectados. 🎉</div>';
        return;
      }
      renderClusters();
      cargarReferencias(); // async, rellena conteos
    } catch (e) {
      console.error('Error escaneando duplicados:', e);
      Toast.show('Error al escanear: ' + (e.message || e), 'bad');
      $('dupList').innerHTML = '<div class="dup-empty">Error al escanear.</div>';
    } finally {
      btn.disabled = false;
    }
  }

  function renderClusters() {
    $('dupList').innerHTML = State.clusters.map(renderCluster).join('');
    State.clusters.forEach(bindCluster);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderCluster(cl) {
    const canon = Svc().pickCanonical(cl.miembros);
    const rucComun = (cl.miembros.find(m => (m.ruc || '').trim()) || {}).ruc || '—';
    const esRevisar = cl.confianza === 'revisar';
    const filas = cl.miembros.map(m => {
      const isCanon = m.id === canon.id;
      const nsRaw = Svc().nameSim(m.nombre, canon.nombre);
      // Por defecto se incluye solo si es match confiable (nombre ≥85% al canónico).
      const incluirDefault = isCanon || nsRaw >= 0.85;
      let sim = '<span class="ts">canónico</span>';
      if (!isCanon) {
        const ns = Math.round(nsRaw * 100);
        const rs = Svc().rucSim(m, canon);
        const rsTxt = rs === null ? '' : ` · RUC ${Math.round(rs * 100)}%`;
        const warn = (ns < 100 || (rs !== null && rs < 1)) ? ' style="color:var(--warn,#b45309);font-weight:600;"' : '';
        sim = `<span${warn}>nombre ${ns}%${rsTxt}</span>${!incluirDefault ? ' <span class="ts">(revisar)</span>' : ''}`;
      }
      return `
        <tr class="${isCanon ? 'dup-canon-row' : ''}" data-mid="${esc(m.id)}">
          <td><input type="radio" name="${cl.id}-canon" value="${esc(m.id)}" ${isCanon ? 'checked' : ''} title="Conservar este"></td>
          <td><input type="checkbox" class="dup-incl" value="${esc(m.id)}" ${incluirDefault ? 'checked' : ''} title="Incluir en la fusión"></td>
          <td><strong>${esc(m.nombre || 'Sin nombre')}</strong></td>
          <td class="dup-mono">${esc(m.ruc || '—')}</td>
          <td class="dup-mono">${esc(m.dv || '—')}</td>
          <td>${esc(m.representante || '—')}</td>
          <td>${[m.email, m.telefono].filter(Boolean).map(esc).join('<br>') || '—'}</td>
          <td class="dup-refs" data-refs="${esc(m.id)}">…</td>
          <td class="dup-refs">${sim}</td>
        </tr>`;
    }).join('');

    const badge = esRevisar
      ? '<span class="pill" style="background:#FEF3C7;color:#92400E;">⚠ Revisar (por similitud)</span>'
      : '<span class="pill" style="background:#DCFCE7;color:#166534;">Exacta</span>';

    return `
      <div class="dup-cluster" data-cid="${cl.id}">
        <div class="dup-cluster-head">
          <i data-lucide="users"></i>
          <strong>${cl.miembros.length} registros</strong>
          <span class="ruc">RUC ${esc(rucComun)}</span>
          ${badge}
        </div>
        <table class="dup-table">
          <thead><tr>
            <th>Conservar</th><th>Incluir</th><th>Nombre</th><th>RUC</th><th>DV</th>
            <th>Representante</th><th>Contacto</th><th>Refs (C/O/P)</th><th>Similitud</th>
          </tr></thead>
          <tbody>${filas}</tbody>
        </table>
        <div class="dup-actions">
          <button class="btn btn-primary btn-sm" data-fusionar="${cl.id}"><i data-lucide="git-merge"></i> Fusionar</button>
          <span class="ts">El canónico conserva su nombre; los demás se marcan como eliminados.</span>
        </div>
      </div>`;
  }

  function bindCluster(cl) {
    const root = document.querySelector(`.dup-cluster[data-cid="${cl.id}"]`);
    if (!root) return;
    root.querySelector('[data-fusionar]').addEventListener('click', () => fusionar(cl));
  }

  // Carga conteos de referencias por miembro (contratos / órdenes / poc).
  async function cargarReferencias() {
    for (const cl of State.clusters) {
      for (const m of cl.miembros) {
        try {
          const r = await Svc().contarReferencias(m);
          cl.refs[m.id] = r;
          const cell = document.querySelector(`.dup-cluster[data-cid="${cl.id}"] [data-refs="${CSS.escape(m.id)}"]`);
          if (cell) cell.textContent = `${r.contratos}/${r.ordenes}/${r.poc}`;
        } catch (e) { /* deja "…" */ }
      }
    }
  }

  async function fusionar(cl) {
    const root = document.querySelector(`.dup-cluster[data-cid="${cl.id}"]`);
    const canonId = root.querySelector(`input[name="${cl.id}-canon"]:checked`)?.value;
    const incluidos = Array.from(root.querySelectorAll('.dup-incl:checked')).map(c => c.value);
    const canonical = cl.miembros.find(m => m.id === canonId);
    if (!canonical) { Toast.show('Elige cuál conservar.', 'warn'); return; }
    const dups = cl.miembros.filter(m => incluidos.includes(m.id) && m.id !== canonId);
    if (!dups.length) { Toast.show('Marca al menos un duplicado a fusionar.', 'warn'); return; }

    const fill = Svc().proposeFill(canonical, dups);
    const fillTxt = Object.keys(fill).length
      ? Object.entries(fill).map(([k, v]) => `${k}=${v}`).join(', ')
      : '(nada que rellenar)';
    const totalRefs = dups.reduce((acc, d) => {
      const r = cl.refs[d.id] || {}; return acc + (r.contratos || 0) + (r.ordenes || 0) + (r.poc || 0);
    }, 0);

    const ok = confirm(
      `Fusionar en "${canonical.nombre}":\n\n` +
      `• Se eliminarán (soft-delete) ${dups.length} duplicado(s): ${dups.map(d => '"' + d.nombre + '"').join(', ')}\n` +
      `• Se re-apuntarán ~${totalRefs} referencia(s) (contratos/órdenes/equipos) al canónico\n` +
      `• El canónico ganará: ${fillTxt}\n\n` +
      `¿Continuar?`
    );
    if (!ok) return;

    const btn = root.querySelector('[data-fusionar]');
    btn.disabled = true; btn.innerHTML = 'Fusionando…';
    try {
      const r = await Svc().mergeCluster({ canonical, dups, fill });
      Toast.show(
        `Fusionado ✅ — ${r.eliminados} duplicado(s), ` +
        `${r.contratosRepointed} contratos, ${r.ordenesRepointed} órdenes, ${r.pocRepointed} equipos re-apuntados.`,
        'ok'
      );
      // Quita el clúster fusionado de la vista.
      State.clusters = State.clusters.filter(c => c.id !== cl.id);
      root.remove();
      $('dupResumen').textContent = `${State.clusters.length} grupo(s) de duplicados restantes`;
      if (!State.clusters.length) $('dupList').innerHTML = '<div class="dup-empty">Sin duplicados pendientes. 🎉</div>';
    } catch (e) {
      console.error('Error fusionando:', e);
      Toast.show('Error al fusionar: ' + (e.message || e), 'bad');
      btn.disabled = false; btn.innerHTML = '<i data-lucide="git-merge"></i> Fusionar';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnEscanear').addEventListener('click', escanear);
  });

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '../login.html'; return; }
    try {
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const rol = userDoc ? userDoc.rol : null;
      if (![ROLES.ADMIN].includes(rol)) {
        Toast.show('Acceso restringido a administradores.', 'bad');
        window.location.href = 'index.html';
      }
    } catch (e) {
      console.error('Error init dedup:', e);
      window.location.href = 'index.html';
    }
  });
})();
