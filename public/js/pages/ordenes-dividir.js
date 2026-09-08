// @ts-nocheck
/* ========================================
 * ORDENES DIVIDIR — repartir una ENTRADA entre varias órdenes
 *
 * Petición de Brenda (2026-09-08): la devolución de Gamboa (34 NX-420-R)
 * cayó completa en la ENTRADA 2026090806 y, como una orden tiene UN técnico,
 * la inspección de los 34 radios quedaba en una sola persona. Este modal
 * reparte los equipos en órdenes hermanas (mismo cliente, devolución, acuse)
 * para que cada una se asigne por separado.
 *
 * Dos formas de repartir, en la misma hoja:
 *   · Parejo — "Repartir en N órdenes": la madre se queda con el primer
 *     bloque y nacen N-1 hijas con bloques de tamaño parejo.
 *   · A mano — marcar los equipos que pasan a UNA orden nueva (se puede
 *     repetir para sacar más).
 *
 * La escritura es OrdenesService.dividirOrden (transacción). Módulo diferido:
 * lo carga CargaDiferida.dividir() al primer uso.
 * ======================================== */

(function () {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, m => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[m]));

  // Bloques contiguos de tamaño parejo (los primeros llevan el sobrante):
  // 34 en 4 → 9, 9, 8, 8. Conserva el orden del array (el de la devolución).
  function repartir(ids, n) {
    const lista = (ids || []).slice();
    const partes = Math.max(1, Math.min(Number(n) || 1, lista.length));
    const base = Math.floor(lista.length / partes);
    let sobra = lista.length % partes;
    const out = [];
    let i = 0;
    for (let k = 0; k < partes; k++) {
      const tam = base + (sobra > 0 ? 1 : 0);
      if (sobra > 0) sobra--;
      out.push(lista.slice(i, i + tam));
      i += tam;
    }
    return out;
  }

  function puedeDividir(orden) {
    if (!orden) return false;
    const estado = (orden.estado_reparacion || 'POR ASIGNAR').toUpperCase();
    const esEntrada = typeof esOrdenEntrada === 'function'
      ? esOrdenEntrada(orden)
      : String(orden.tipo_de_servicio || '').toUpperCase().includes('ENTRADA');
    const activos = (orden.equipos || []).filter(e => e && !e.eliminado).length;
    return esEntrada && estado === 'POR ASIGNAR' && !orden.tecnico_uid && !orden.tecnico_asignado && activos >= 2;
  }

  async function abrir(ordenId) {
    let orden = null;
    try { orden = await OrdenesService.getOrder(ordenId); } catch (_) { /* abajo */ }
    if (!orden) { Toast.show('Orden no encontrada', 'bad'); return; }
    if (!puedeDividir(orden)) {
      Toast.show('Solo se divide una ENTRADA en POR ASIGNAR, sin técnico y con al menos 2 equipos.', 'bad');
      return;
    }
    const equipos = (orden.equipos || []).filter(e => e && e.id && !e.eliminado);
    const total = equipos.length;
    const maxPartes = Math.min(8, total);
    const opcionesN = [];
    for (let n = 2; n <= maxPartes; n++) {
      const tams = repartir(equipos.map(e => e.id), n).map(g => g.length).join(' · ');
      opcionesN.push(`<option value="${n}"${n === 2 ? ' selected' : ''}>${n} órdenes (${tams})</option>`);
    }

    const filas = equipos.map((e, i) => {
      const serial = e.numero_de_serie || e.serial || '—';
      const cond = /DAÑADO/i.test(e.observaciones || '') ? '<span class="chip chip-warn" style="font-size:11px;">dañado</span>' : '';
      return `
        <label class="dv-fila" style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-bottom:1px solid var(--border-subtle,#EEF2F6);cursor:pointer;">
          <input type="checkbox" class="dv-check" value="${esc(e.id)}" data-i="${i}">
          <span style="font-family:var(--font-mono,monospace);font-size:13px;min-width:120px;">${esc(serial)}</span>
          <span style="font-size:13px;color:var(--fg-2);">${esc(e.modelo || '—')}</span>
          ${cond}
        </label>`;
    }).join('');

    let overlay = null;
    const marcados = () => [...overlay.querySelectorAll('.dv-check:checked')].map(c => c.value);
    const refrescar = () => {
      const n = marcados().length;
      const c = overlay.querySelector('#dvCount');
      const b = overlay.querySelector('#dvMover');
      if (c) c.textContent = n
        ? `${n} equipo${n === 1 ? '' : 's'} → orden nueva · ${total - n} se queda${total - n === 1 ? '' : 'n'} aquí`
        : 'Sin selección';
      if (b) b.disabled = !(n >= 1 && n < total);
    };

    const resultado = await Modal.sheet({
      title: `Dividir orden ${ordenId}`, icon: 'layers', size: 'lg',
      html: `
        <p style="margin:0 0 12px;font-size:13px;color:var(--fg-3);">
          Las órdenes nuevas nacen con el mismo cliente, la misma devolución y el acuse ya firmado,
          en <b>POR ASIGNAR</b>: cada una se asigna a su técnico por separado. Esta orden se queda
          con los equipos que no muevas.
        </p>

        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:10px 12px;margin-bottom:12px;border:1px solid var(--border);border-radius:8px;background:var(--surface-2,#F8FAFC);">
          <strong style="font-size:13px;">Repartir parejo</strong>
          <select id="dvPartes" class="form-input" style="height:34px;min-width:200px;">${opcionesN.join('')}</select>
          <button type="button" class="btn btn-secondary" id="dvParejo" style="height:34px;">
            <i data-lucide="layers" style="width:14px;height:14px;"></i> Repartir
          </button>
          <span style="font-size:12px;color:var(--fg-3);">${total} equipos en total · esta orden conserva el primer bloque</span>
        </div>

        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;margin-bottom:6px;">
          <strong style="font-size:13px;white-space:nowrap;">O elige a mano</strong>
          <span style="font-size:12px;color:var(--fg-3);">los marcados pasan a UNA orden nueva</span>
          <span style="margin-left:auto;display:flex;gap:6px;">
            <button type="button" class="btn btn-ghost" id="dvTodos" style="height:28px;font-size:12px;white-space:nowrap;">Marcar mitad</button>
            <button type="button" class="btn btn-ghost" id="dvNinguno" style="height:28px;font-size:12px;white-space:nowrap;">Ninguno</button>
          </span>
        </div>
        <input type="search" id="dvBuscar" class="form-input" placeholder="Filtrar por serial…" style="width:100%;margin-bottom:6px;height:34px;font-family:var(--font-mono,monospace);">
        <div id="dvCount" style="position:sticky;top:-24px;z-index:2;margin:0 -24px 6px;padding:6px 24px;background:var(--surface-card,#fff);border-bottom:1px solid var(--border-subtle,#EEF2F6);font-size:13px;font-weight:600;color:var(--fg-2);">Sin selección</div>
        <div id="dvLista" style="max-height:320px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;">${filas}</div>`,
      buttons: [
        { action: 'cerrar', label: 'Cancelar' },
        { action: 'mover', label: 'Mover a una orden nueva', primary: true, icon: 'layers' },
      ],
      onMount: (root) => {
        overlay = root;
        const btnMover = root.querySelector('.modal-footer .btn-primary');
        if (btnMover) { btnMover.id = 'dvMover'; btnMover.disabled = true; }
        root.querySelector('#dvLista').addEventListener('change', refrescar);
        root.querySelector('#dvTodos').addEventListener('click', () => {
          const mitad = repartir(equipos.map(e => e.id), 2)[1];
          const set = new Set(mitad);
          root.querySelectorAll('.dv-check').forEach(c => { c.checked = set.has(c.value); });
          refrescar();
        });
        root.querySelector('#dvNinguno').addEventListener('click', () => {
          root.querySelectorAll('.dv-check').forEach(c => { c.checked = false; });
          refrescar();
        });
        root.querySelector('#dvBuscar').addEventListener('input', (e) => {
          const q = (e.target.value || '').trim().toUpperCase();
          root.querySelectorAll('.dv-fila').forEach(f => {
            f.style.display = !q || f.textContent.toUpperCase().includes(q) ? '' : 'none';
          });
        });
        root.querySelector('#dvParejo').addEventListener('click', async () => {
          const n = Number(root.querySelector('#dvPartes').value) || 2;
          const grupos = repartir(equipos.map(e => e.id), n);
          const hijas = grupos.slice(1);
          const ok = await Modal.confirm({
            title: 'Repartir parejo',
            message: `Se crean ${hijas.length} orden${hijas.length === 1 ? '' : 'es'} nueva${hijas.length === 1 ? '' : 's'} con ${hijas.map(g => g.length).join(', ')} equipos; la ${ordenId} se queda con ${grupos[0].length}. ¿Continuar?`,
            confirmLabel: 'Repartir',
          });
          if (!ok) return;
          await ejecutar(ordenId, hijas, root);
        });
        refrescar();
      },
      onAction: async (action, root) => {
        if (action !== 'mover') return null;
        const ids = marcados();
        if (!ids.length || ids.length >= total) return false;
        const ok = await Modal.confirm({
          title: 'Mover a una orden nueva',
          message: `${ids.length} equipo${ids.length === 1 ? '' : 's'} pasa${ids.length === 1 ? '' : 'n'} a una orden nueva de ENTRADA; la ${ordenId} se queda con ${total - ids.length}. ¿Continuar?`,
          confirmLabel: 'Mover',
        });
        if (!ok) return false;
        const hecho = await ejecutar(ordenId, [ids], root);
        return hecho ? 'ok' : false;
      },
    });
    return resultado;
  }

  // Guarda y cierra la hoja. Devuelve true si se dividió.
  async function ejecutar(ordenId, grupos, root) {
    const botones = root.querySelectorAll('button');
    botones.forEach(b => { b.disabled = true; });
    try {
      const { nuevas, restantes } = await OrdenesService.dividirOrden(ordenId, grupos);
      // La bandeja se re-renderiza sola con el snapshot en vivo; el caché se
      // parcha por si la madre está fuera de la primera página.
      const cache = (APP?.state?.orders || []).find(o => o.ordenId === ordenId);
      if (cache && Array.isArray(cache.equipos)) {
        const movidos = new Set(grupos.flat());
        cache.equipos = cache.equipos.filter(e => !(e && movidos.has(e.id)));
        if (typeof refrescarEquiposDeOrden === 'function') { try { refrescarEquiposDeOrden(ordenId); } catch (_) { /* no crítico */ } }
      }
      Toast.show(`✅ Orden dividida: ${nuevas.length === 1 ? 'nueva orden' : 'nuevas órdenes'} ${nuevas.join(', ')} · la ${ordenId} se queda con ${restantes}`, 'ok');
      // Cierra la hoja desde afuera del ciclo de onAction.
      const cerrar = root.querySelector('[data-sheet-action="__cerrar"]');
      if (cerrar) cerrar.click();
      return true;
    } catch (err) {
      console.error('[ordenes-dividir]', err);
      Toast.show(`❌ ${err?.message || 'No se pudo dividir la orden'}`, 'bad');
      botones.forEach(b => { b.disabled = false; });
      return false;
    }
  }

  window.OrdenesDividir = { abrir, repartir, puedeDividir };
  window.abrirDividirOrden = abrir;
})();
