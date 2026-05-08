// @ts-nocheck
// nuevo-contrato coordinator — auth bootstrap, data loading, visibility refresh
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
  document.getElementById('clienteCombo').focus();
});

document.addEventListener('visibilitychange', async () => {
  if (document.hidden) return;
  const combo  = document.getElementById('clienteCombo');
  const hidden = document.getElementById('cliente');
  const q      = (combo.value || '').trim();
  if (hidden.value) {
    const c = await ClientesService.getCliente(hidden.value);
    if (c) { NC.listaClientes[c.id] = c; NCCombo.selectCliente(c.id, true); }
  } else if (q.length >= 2) {
    NCCombo.doSearch(q);
  } else {
    await NCGuardar.cargarClientes();
  }
});
