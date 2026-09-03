// @ts-nocheck
// nuevo-contrato coordinator — auth bootstrap, data loading, visibility refresh

// ── Respaldo local del formulario (auditoría A7) ────────────────────────────
// Una renovación grande (origen + 80 unidades + cargos) se perdía con un F5
// o un cierre de pestaña. El snapshot usa la MISMA forma que el prefill de
// Duplicar/Renovar, así la restauración pasa por applyPrefillFromDuplicate
// (cliente, tipo, acción, duración, equipos, cargos y origen preseleccionado).
// Limitación conocida: las decisiones por serial del plan de transición no se
// respaldan (viven en un DOM profundo); el origen sí, y el plan se repropone.
window.NCRespaldo = (() => {
  let key = null;
  let timer = null;

  function snapshot() {
    const v = (id) => document.getElementById(id)?.value || '';
    const equipos = [...document.querySelectorAll('#tablaEquipos tbody tr')].map(row => ({
      modelo_id:   row.querySelector('.modelo')?.value || '',
      descripcion: row.querySelector('.descripcion')?.value || '',
      cantidad:    Number(row.querySelector('.cantidad')?.value || 0),
      precio:      Number(row.querySelector('.precio')?.value || 0),
    }));
    return {
      cliente_id:  v('cliente'),
      codigo_tipo: v('tipo_contrato'),
      accion:      v('accion'),
      duracion:    v('duracion') === 'Otro' ? `${v('otra_duracion')} meses` : v('duracion'),
      renovacion_sin_equipo: !!document.getElementById('renovacion_sin_equipo')?.checked,
      renovacion_refurbished_componentes: !!document.getElementById('renovacion_refurbished_componentes')?.checked,
      observaciones: v('observaciones'),
      equipos,
      cargos: (window.NCCargos && NCCargos.leer) ? NCCargos.leer() : [],
      origen_preseleccion: (window.NCForm && NCForm.leerOrigen)
        ? (NCForm.leerOrigen().origen_ids || []) : [],
    };
  }

  function significativo(d) {
    return !!(d.cliente_id || d.observaciones || (d.cargos || []).length
      || (d.equipos || []).some(e => e.modelo_id || e.cantidad > 0));
  }

  function programar() {
    if (!key) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        const d = snapshot();
        if (significativo(d)) localStorage.setItem(key, JSON.stringify({ ts: Date.now(), draft: d }));
      } catch (_) { /* best-effort */ }
    }, 1500);
  }

  function limpiar() {
    clearTimeout(timer);
    if (key) { try { localStorage.removeItem(key); } catch (_) { /* sin storage */ } }
  }

  function iniciar(uid) {
    key = 'contrato_respaldo_' + uid;
    document.addEventListener('input', programar, true);
    document.addEventListener('change', programar, true);
  }

  function pendiente() {
    if (!key) return null;
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const bk = JSON.parse(raw);
      if (!bk?.draft || !significativo(bk.draft)) return null;
      if ((Date.now() - (bk.ts || 0)) > 3 * 86400000) return null;
      return bk;
    } catch (_) { return null; }
  }

  return { iniciar, limpiar, pendiente };
})();

firebase.auth().onAuthStateChanged(async user => {
  if (!user) { window.location.href = '/login.html'; return; }
  NC.currentUser = user;

  await NCGuardar.cargarClientes();

  const params = new URLSearchParams(window.location.search);
  const preseleccionado = params.get('cliente_id');
  if (preseleccionado) {
    const c = await ClientesService.getCliente(preseleccionado);
    if (c) { NC.listaClientes[preseleccionado] = c; NCCombo.selectCliente(preseleccionado, true); }
  }

  await NCGuardar.cargarModelos();
  await NCGuardar.applyPrefillFromDuplicate();

  // Restauración del respaldo: solo cuando NO se llegó con intención propia
  // (prefill de Duplicar/Renovar o ?cliente_id de otra pantalla). Reutiliza
  // el canal del prefill: se escribe a sessionStorage y se re-aplica.
  NCRespaldo.iniciar(user.uid);
  if (!preseleccionado && !params.get('prefill')) {
    const bk = NCRespaldo.pendiente();
    if (bk) {
      const n = (bk.draft.equipos || []).filter(e => e.modelo_id || e.cantidad > 0).length;
      const edadMin = Math.max(1, Math.round((Date.now() - bk.ts) / 60000));
      const edadTxt = edadMin < 60 ? `${edadMin} min` : `${Math.round(edadMin / 60)} h`;
      const ok = await Modal.confirm({
        title: 'Recuperar contrato sin guardar',
        message: `Quedó un contrato a medio llenar que no llegó a guardarse (${n} renglón(es) de equipos, hace ${edadTxt}). ¿Recuperarlo y seguir donde ibas?`,
        confirmLabel: 'Recuperar',
        cancelLabel: 'Descartar respaldo',
      });
      if (ok) {
        try {
          sessionStorage.setItem('contrato_prefill', JSON.stringify(bk.draft));
          await NCGuardar.applyPrefillFromDuplicate();
        } catch (e) { console.warn('No se pudo restaurar el respaldo:', e); }
      } else {
        NCRespaldo.limpiar();
      }
    }
  }

  document.getElementById('clienteCombo').focus();
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  const combo  = document.getElementById('clienteCombo');
  const hidden = document.getElementById('cliente');
  const q      = (combo.value || '').trim();
  if (hidden.value) {
    const c = await ClientesService.getCliente(hidden.value);
    if (c) {
      NC.listaClientes[c.id] = c; NCCombo.selectCliente(c.id, true);
      // Vista previa abierta: el caso típico es "Corregir en la ficha" en otra
      // pestaña y volver — el representante nuevo debe verse sin cerrar el
      // modal, y el check de validación se rearma para el valor corregido.
      const ov = document.getElementById('previewOverlay');
      if (ov && ov.style.display === 'flex' && window.NCPreview) NCPreview.refrescar();
    }
  } else if (q.length >= 2) {
    NCCombo.doSearch(q);
  } else {
    await NCGuardar.cargarClientes();
  }
});
