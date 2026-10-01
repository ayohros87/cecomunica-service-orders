// @ts-nocheck
// Un SIM no debería estar en dos radios a la vez (decisión de Alberto,
// 1-oct-2026, auditoría de módulos PoC R2/D2): el app AVISA con el radio y el
// cliente donde está y PIDE MOTIVO; nunca bloquea. Lo comparten los cuatro
// caminos que escriben sim_number: el cajón (poc-edit), la edición masiva
// (poc-bulk), "Asignar del pool" (poc-sim-pool) y el pegado en lote
// (poc-sim). El motivo queda en la ficha (`sim_conflicto`) y en poc_logs.
//
// Antes ninguno de los cuatro miraba las demás fichas: 444 SIMs vivían en más
// de una ficha viva y 41 en más de una ACTIVA (00-base-poc.js, 2026-09-30).
window.PocSimConflicto = {

  _resumen(d, enEsteGuardado = false) {
    return {
      id:         d.id,
      serial:     d.serial || '',
      radio_name: d.radio_name || '',
      cliente:    (window.PocState?.nombreClienteDe?.(d)) || d.cliente_nombre || d.cliente || '',
      activo:     d.activo !== false,
      enEsteGuardado,
    };
  },

  // items: [{ id, sim_number, serial, cliente }] — las fichas que van a quedar
  // con ese SIM. Devuelve Map id → { sim, otras: [...] } solo para las que
  // chocan con OTRA ficha viva (o con otro item del mismo guardado). Siempre
  // al servidor: la caché local no tiene por qué tener la ficha del otro
  // cliente, y son dos lecturas por SIM.
  async buscar(items) {
    const norm = (s) => SimCardsService.normalizarSim(s);
    const porSim = new Map();
    for (const it of items || []) {
      const k = norm(it.sim_number);
      if (!k) continue;
      if (!porSim.has(k)) porSim.set(k, []);
      porSim.get(k).push(it);
    }
    const res = new Map();
    await Promise.all([...porSim.entries()].map(async ([k, lista]) => {
      const fichas = await PocService.fichasConSim(k);
      const propios = new Set(lista.map(i => i.id));
      const otras = fichas.filter(d => !propios.has(d.id)).map(d => this._resumen(d));
      for (const it of lista) {
        const mismoGuardado = lista.filter(o => o !== it)
          .map(o => ({ id: o.id, serial: o.serial || '', radio_name: '', cliente: o.cliente || '', activo: true, enEsteGuardado: true }));
        const todas = otras.concat(mismoGuardado);
        if (todas.length) res.set(it.id, { sim: k, otras: todas });
      }
    }));
    return res;
  },

  // Busca y, si hay choque, avisa y pide el motivo (obligatorio cuando alguna
  // de las otras fichas está ACTIVA). Devuelve:
  //   { cancelado: true }                       — la persona no quiso guardar
  //   { cancelado: false, motivo, conflictos }  — conflictos: Map id → {...}
  // Sin choque: motivo '' y Map vacío. Si la consulta falla, no tranca: se
  // avisa y se sigue sin validar (el guardado es de recepción, no del app).
  async revisar(items) {
    let conflictos;
    try { conflictos = await this.buscar(items); }
    catch (e) {
      console.warn('[PocSimConflicto] no se pudo revisar el SIM:', e?.code || e);
      Toast.show('No se pudo revisar si el SIM está en otro radio. Se guarda igual.', 'warn');
      return { cancelado: false, motivo: '', conflictos: new Map() };
    }
    if (!conflictos.size) return { cancelado: false, motivo: '', conflictos };
    const motivo = await this._pedirMotivo(items, conflictos);
    if (motivo === null) return { cancelado: true };
    return { cancelado: false, motivo, conflictos };
  },

  // Lo que se escribe en la ficha (campo `sim_conflicto`) para un id que chocó;
  // null si ese id no chocó.
  campo(revision, id, user) {
    const c = revision?.conflictos?.get(id);
    if (!c) return null;
    return {
      sim_number: c.sim,
      motivo:     revision.motivo || '',
      otras:      c.otras.map(o => ({ id: o.id, serial: o.serial, cliente: o.cliente, activo: o.activo })),
      at:         new Date(),
      por:        user?.email || null,
    };
  },

  async _pedirMotivo(items, conflictos) {
    const esc = FMT.esc;
    const porId = new Map((items || []).map(i => [i.id, i]));
    let hayActiva = false;
    const bloques = [...conflictos.entries()].map(([id, c]) => {
      const it = porId.get(id) || {};
      const lis = c.otras.map(o => {
        if (o.activo) hayActiva = true;
        const ver = (!o.enEsteGuardado && o.id)
          ? ` <a href="index.html?focus=${encodeURIComponent(o.serial || '')}&campo=serial&id=${encodeURIComponent(o.id)}" target="_blank" rel="noopener" style="font-size:12px;">ver</a>`
          : '';
        const estado = o.enEsteGuardado
          ? '<span class="badge" style="margin-left:4px;">en este mismo guardado</span>'
          : `<span class="badge ${o.activo ? 'completo' : ''}" style="margin-left:4px;">${o.activo ? 'Activo' : 'Inactivo'}</span>`;
        return `<li><strong class="td-mono">${esc(o.serial || '(sin serial)')}</strong>${o.radio_name ? ' · ' + esc(o.radio_name) : ''} · ${esc(o.cliente || '(sin cliente)')}${estado}${ver}</li>`;
      }).join('');
      const quien = conflictos.size > 1
        ? `<div style="margin-top:8px;"><strong class="td-mono">${esc(it.serial || id)}</strong> → SIM <strong class="td-mono">${esc(c.sim)}</strong> ya está en:</div>`
        : `<p style="margin:0 0 6px;">El SIM <strong class="td-mono">${esc(c.sim)}</strong> ya está en:</p>`;
      return `${quien}<ul style="margin:4px 0 0 18px;">${lis}</ul>`;
    }).join('');
    const obligatorio = hayActiva;
    const html = `
      ${bloques}
      <p style="margin:12px 0 6px;font-size:13px;color:var(--fg-2);">
        Un SIM no debería estar en dos radios. Si de verdad se movió, lo normal es liberarlo o cerrar la otra ficha.
        Puedes guardar igual: escribe por qué${obligatorio ? '' : ' (el otro radio está inactivo: el motivo es opcional)'}.
      </p>
      <label for="simConflictoMotivo" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px;">Motivo${obligatorio ? ' (obligatorio)' : ''}</label>
      <textarea id="simConflictoMotivo" class="input" rows="3" style="width:100%;resize:vertical;" placeholder="Ej.: el radio anterior se dañó y el SIM pasó a este"></textarea>
      <div id="simConflictoError" style="display:none;color:var(--status-critical);font-size:12px;margin-top:4px;">Escribe el motivo para poder guardar.</div>`;
    return Modal.sheet({
      title: conflictos.size > 1 ? 'SIMs en otros radios' : 'SIM en otro radio',
      icon: 'alert-triangle',
      html,
      size: 'md',
      buttons: [
        { action: 'cancelar', label: 'Cancelar' },
        { action: 'guardar', label: 'Guardar igual', primary: true, icon: 'save' },
      ],
      onMount: (root) => { setTimeout(() => root.querySelector('#simConflictoMotivo')?.focus(), 50); },
      onAction: (action, root) => {
        if (action !== 'guardar') return null;
        const motivo = (root.querySelector('#simConflictoMotivo')?.value || '').trim();
        if (obligatorio && !motivo) {
          const err = root.querySelector('#simConflictoError');
          if (err) err.style.display = 'block';
          root.querySelector('#simConflictoMotivo')?.focus();
          return false;
        }
        return motivo;
      },
    });
  },
};
