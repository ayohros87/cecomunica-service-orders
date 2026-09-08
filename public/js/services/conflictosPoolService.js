// @ts-nocheck
// Conflictos de serial del pool — UNA implementación (2026-09-08, F2 de
// "Bandejas y pickers"). Antes la cola vivía completa dos veces: en
// Almacén · Hoy (cargarConflictos + fusionar + distintos) y en Equipos por
// serial (_gruposConflicto + fusionarGrupo + marcarDistintos + reabrir),
// con el mismo predicado, el mismo callable y el mismo batch de kardex.
//
// Un conflicto = 2+ fichas de equipos_pool con el mismo serial_norm (el
// failsafe de colisión crea `${serial}__${modelo}` y marca
// serial_compartido). Se "resuelve" fusionando (callable fusionarPoolFicha,
// conserva kardex) o confirmando que son radios físicos distintos
// (conflicto_revisado: true en todas las fichas + movimiento en el kardex).
const ConflictosPoolService = {
  LIMITE: 300,

  // Agrupa fichas por serial_norm. Devuelve [{norm, docs, revisado}], los
  // pendientes primero y luego por serial. `incluirRevisados` trae también
  // los grupos ya cerrados (historial de la cola de Equipos).
  agrupar(fichas, { incluirRevisados = false } = {}) {
    const porNorm = new Map();
    for (const eq of (fichas || [])) {
      const k = eq.serial_norm || String(eq.id || '').split('__')[0];
      if (!porNorm.has(k)) porNorm.set(k, []);
      porNorm.get(k).push(eq);
    }
    const grupos = [];
    for (const [norm, docs] of porNorm) {
      if (docs.length < 2) continue;
      const revisado = docs.every(d => d.conflicto_revisado === true);
      if (revisado && !incluirRevisados) continue;
      grupos.push({ norm, docs, revisado });
    }
    return grupos.sort((a, b) =>
      (a.revisado === b.revisado) ? a.norm.localeCompare(b.norm) : (a.revisado ? 1 : -1));
  },

  // Grupos pendientes desde Firestore (las fichas marcadas serial_compartido).
  async listarPendientes() {
    const snap = await firebase.firestore().collection('equipos_pool')
      .where('serial_compartido', '==', true).limit(this.LIMITE).get();
    return this.agrupar(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  },

  // Fusiona las fichas `absorbidosIds` en `keeperId` (callable: conserva el
  // kardex de las absorbidas). Devuelve { fusionados }.
  async fusionar({ keeperId, absorbidosIds }) {
    const fn = firebase.functions().httpsCallable('fusionarPoolFicha');
    const res = await fn({ keeperId, absorbidosIds });
    return res.data || {};
  },

  // Marca (o desmarca) `conflicto_revisado` en todas las fichas del grupo y
  // deja un movimiento en el kardex de cada una con el motivo — meses después
  // la pregunta es "¿en qué se basó la decisión?". Muta `grupo.docs` para que
  // la página repinte sin releer.
  async marcarRevisado(grupo, valor, notas) {
    const db = firebase.firestore();
    const user = firebase.auth().currentUser;
    const batch = db.batch();
    grupo.docs.forEach(d => {
      const ref = db.collection('equipos_pool').doc(d.id);
      batch.set(ref, {
        conflicto_revisado: valor,
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_by: user?.uid || null,
        updated_by_email: user?.email || null,
      }, { merge: true });
      batch.set(ref.collection('movimientos').doc(), {
        at: firebase.firestore.FieldValue.serverTimestamp(),
        por: user?.uid || 'system', por_email: user?.email || null,
        tipo: valor ? 'conflicto_revisado' : 'conflicto_reabierto',
        de_estado: d.estado || null, a_estado: d.estado || null, ref: null,
        notas: notas || '',
      });
    });
    await batch.commit();
    grupo.docs.forEach(d => { d.conflicto_revisado = valor; });
  },

  // Tarjetas de un grupo para elegir la ficha real (radio con name=`hyConfl`
  // cuando `elegible`). Lo usan la hoja de Almacén y la cola de Equipos.
  tarjetasHtml(grupo, { elegible = true, esc = (v) => String(v ?? '') } = {}) {
    const chip = (d) => (typeof EquiposPoolService !== 'undefined' && EquiposPoolService.chipEstadoHtml)
      ? EquiposPoolService.chipEstadoHtml(d.estado)
      : `<span class="eqpool-chip">${esc(EquiposPoolService?.ESTADO_LABELS?.[d.estado] || d.estado || '')}</span>`;
    return grupo.docs.map(d => `
      <label style="display:block; border:1px solid var(--border-default, #DDE4EB); border-radius:8px; padding:8px 10px; cursor:${elegible ? 'pointer' : 'default'}; font-size:12.5px;">
        ${elegible ? `<input type="radio" name="hyConfl" value="${esc(d.id)}" style="margin-right:6px;">` : ''}
        <strong>${esc(d.modelo_label || d.modelo_id || 'sin modelo')}</strong>
        ${chip(d)}
        <div style="color:var(--fg-3); margin-top:3px;">
          ${esc(d.asignacion?.cliente_nombre || 'sin asignación')}${d.asignacion?.contrato_id ? ` · ${esc(d.asignacion.contrato_id)}` : ''}
          · origen ${esc((d.origen || '—').replace(/_/g, ' '))}
          · <span style="font-family:var(--font-mono, monospace); font-size:11px;">${esc(d.id)}</span>
          ${d.verificado === false ? ' · sin verificar' : ''}
        </div>
      </label>`).join('');
  },
};

window.ConflictosPoolService = ConflictosPoolService;
