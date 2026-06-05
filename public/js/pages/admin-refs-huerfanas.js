// @ts-nocheck
/**
 * admin-refs-huerfanas.js — Revisión y re-apunte de referencias huérfanas.
 * Ver RefsHuerfanasService. Cada grupo (por nombre) se re-apunta a un cliente
 * activo: el sugerido, o uno que elijas a mano. Re-apunta cliente_id (+ nombre
 * denormalizado en órdenes/POC).
 */
(function () {
  'use strict';

  const State = { grupos: [], nombreToId: new Map() };

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return (s || '').toString()
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  async function precargarClientes() {
    try {
      const clientes = await ClientesService.getAllClientes();
      const dl = $('clientesActivos');
      const seen = new Set();
      dl.innerHTML = '';
      State.nombreToId.clear();
      for (const c of clientes) {
        const nombre = (c.nombre || '').trim();
        if (!nombre) continue;
        State.nombreToId.set(nombre.toLowerCase(), c.id);
        if (!seen.has(nombre)) { seen.add(nombre); dl.appendChild(new Option(nombre)); }
      }
    } catch (e) { console.error('precarga clientes', e); }
  }

  async function escanear() {
    const btn = $('btnEscanear');
    btn.disabled = true;
    $('ohResumen').textContent = 'Escaneando…';
    $('ohList').innerHTML = '<div class="oh-empty">Buscando referencias huérfanas…</div>';
    try {
      if (!State.nombreToId.size) await precargarClientes();
      const { grupos, totals } = await RefsHuerfanasService.scan();
      State.grupos = grupos.map((g, i) => ({ ...g, _id: 'g' + i }));
      $('ohResumen').textContent =
        `${totals.grupos} grupo(s) · ${totals.docs} docs · ${totals.conSugerencia} con sugerencia`;
      render();
    } catch (e) {
      console.error('escanear huérfanos', e);
      Toast.show('Error al escanear: ' + (e.message || e), 'bad');
      $('ohList').innerHTML = '<div class="oh-empty">Error al escanear.</div>';
    } finally {
      btn.disabled = false;
    }
  }

  function render() {
    if (!State.grupos.length) { $('ohList').innerHTML = '<div class="oh-empty">Sin referencias huérfanas. 🎉</div>'; return; }
    $('ohList').innerHTML = State.grupos.map(renderRow).join('');
    State.grupos.forEach(bind);
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function renderRow(g) {
    const c = g.counts;
    const partes = [];
    if (c.orden) partes.push(`${c.orden} órden`);
    if (c.poc) partes.push(`${c.poc} POC`);
    if (c.contrato) partes.push(`${c.contrato} contrato`);
    const sug = g.sugerido
      ? `value="${esc(g.sugerido.nombre)}"`
      : '';
    const simTxt = g.sugerido
      ? `<span class="oh-sim">${g.sugerido.sim >= 1 ? 'exacto' : Math.round(g.sugerido.sim * 100) + '%'}</span>`
      : `<span class="oh-sim">sin sugerencia</span>`;
    return `
      <div class="oh-row" data-id="${g._id}">
        <div>
          <div class="oh-nombre">${esc(g.nombre)}</div>
          <div class="oh-meta">${partes.join(' · ')}</div>
        </div>
        <div class="oh-target">
          <i data-lucide="arrow-right" style="width:14px;height:14px;color:var(--fg-3);"></i>
          <input class="form-input form-input-sm oh-input" list="clientesActivos" placeholder="Cliente activo…" ${sug}>
          ${simTxt}
        </div>
        <button class="btn btn-primary btn-sm oh-apply"><i data-lucide="link"></i> Re-apuntar</button>
      </div>`;
  }

  function bind(g) {
    const root = document.querySelector(`.oh-row[data-id="${g._id}"]`);
    if (!root) return;
    root.querySelector('.oh-apply').addEventListener('click', () => aplicar(g, root));
  }

  async function aplicar(g, root) {
    const input = root.querySelector('.oh-input');
    const nombre = (input.value || '').trim();
    if (!nombre) { Toast.show('Escribe o elige el cliente destino.', 'warn'); return; }
    const id = State.nombreToId.get(nombre.toLowerCase());
    if (!id) { Toast.show('Ese nombre no es un cliente activo. Elígelo de la lista.', 'warn'); return; }
    if (!confirm(`Re-apuntar ${g.total} referencia(s) de "${g.nombre}" → "${nombre}"?`)) return;

    const btn = root.querySelector('.oh-apply');
    btn.disabled = true; btn.textContent = 'Aplicando…';
    try {
      const { afectados } = await RefsHuerfanasService.rePoint(g.docs, { id, nombre });
      Toast.show(`Re-apuntadas ${afectados} referencia(s) → "${nombre}" ✅`, 'ok');
      State.grupos = State.grupos.filter(x => x._id !== g._id);
      root.remove();
      $('ohResumen').textContent = `${State.grupos.length} grupo(s) restantes`;
      if (!State.grupos.length) $('ohList').innerHTML = '<div class="oh-empty">Sin referencias huérfanas pendientes. 🎉</div>';
    } catch (e) {
      console.error('re-apuntar', e);
      Toast.show('Error al re-apuntar: ' + (e.message || e), 'bad');
      btn.disabled = false; btn.innerHTML = '<i data-lucide="link"></i> Re-apuntar';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    $('btnEscanear').addEventListener('click', escanear);
  });

  firebase.auth().onAuthStateChanged(async user => {
    if (!user) { window.location.href = '../login.html'; return; }
    try {
      const u = await UsuariosService.getUsuario(user.uid);
      if (!u || u.rol !== ROLES.ADMIN) {
        Toast.show('Acceso restringido a administradores.', 'bad');
        window.location.href = 'index.html';
      }
    } catch (e) { window.location.href = 'index.html'; }
  });
})();
