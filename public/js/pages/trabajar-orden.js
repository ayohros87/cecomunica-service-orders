// @ts-nocheck
// Trabajar-Orden coordinator — auth bootstrap, notas autosave
const _notaTimers = {};

firebase.auth().onAuthStateChanged(async user => {
  if (!user) { location.href = 'login.html'; return; }

  TO.usuarioActual.uid   = user.uid;
  TO.usuarioActual.email = user.email || '';

  try {
    const u = await UsuariosService.getUsuario(user.uid);
    TO.rolUsuario           = u ? (u.rol || null) : null;
    TO.usuarioActual.nombre = (u && u.nombre) ? u.nombre : (TO.usuarioActual.email || 'Usuario');
  } catch {}
  TO.byId('chipUsuario').textContent = `Operando como: ${TO.usuarioActual.nombre}`;

  try {
    const p = await EmpresaService.getDoc('parametros');
    if (p && typeof p.itbms === 'number') TO.itbmsPct = p.itbms;
  } catch {}

  TO.ordenData = await OrdenesService.getOrder(TO.ordenId);
  if (!TO.ordenData) { alert('Orden no encontrada'); return; }

  if (TO.ordenData.cotizacion_emitida === true) document.body.classList.add('solo-lectura');

  let cliente = TO.ordenData.cliente_nombre || TO.ordenData.cliente || '—';
  if (TO.ordenData.cliente_id) {
    try {
      const c = await ClientesService.getCliente(TO.ordenData.cliente_id);
      if (c) cliente = c.nombre || cliente;
    } catch {}
  }
  const fecha = TO.ordenData.fecha_creacion?.toDate
    ? TO.ordenData.fecha_creacion.toDate().toISOString().slice(0, 10)
    : '—';
  TO.byId('infoOrden').innerHTML =
    `Orden <strong>${TO.ordenId}</strong> · Cliente <strong>${cliente}</strong> · ` +
    `Servicio <strong>${TO.ordenData.tipo_de_servicio || '—'}</strong> · ` +
    `Creada <strong>${fecha}</strong> · Estado <strong>${(TO.ordenData.estado_reparacion || '').toUpperCase()}</strong>`;

  const estado = TO.ordenData.trabajo_estado || (TO.ordenData.cotizacion_emitida ? 'COMPLETADO' : 'SIN_INICIAR');
  TO.pintarChipTrabajo(estado);

  setTimeout(() => {
    const b1 = TO.byId('btnCompletarCot');
    const b2 = TO.byId('btnDesbloquearCot');
    if (TO.ordenData?.cotizacion_emitida) {
      if (b1) { b1.disabled = true; b1.textContent = '✅ Cotización completada'; }
      if (b2) b2.style.display = 'inline-block';
    } else {
      if (b1) { b1.disabled = false; b1.textContent = '✅ Completar cotización'; }
      if (b2) b2.style.display = 'none';
    }
  }, 0);

  TO.equipos = Array.isArray(TO.ordenData.equipos)
    ? TO.ordenData.equipos.filter(e => !e.eliminado)
    : [];

  await TO.cargarInventarioConCache();
  await TOEquipos.renderEquiposYConsumos();
  await TOCotizacion.renderResumen();
});

document.addEventListener('input', e => {
  if (!e.target.classList.contains('inp-nota')) return;
  const equipoId = e.target.getAttribute('data-eid');
  const scope    = e.target.getAttribute('data-scope');
  const val      = e.target.value;
  const key      = equipoId + '_' + scope;
  clearTimeout(_notaTimers[key]);
  _notaTimers[key] = setTimeout(async () => {
    await db.collection('ordenes_de_servicio').doc(TO.ordenId)
      .collection('equipos_meta').doc(equipoId).set(
        scope === 'internas' ? { notas_internas: val } : { notas_cliente: val },
        { merge: true }
      );
    TO.showToast();
  }, 400);
});

document.addEventListener('keydown', e => {
  if (TO.byId('modalPieza').style.display === 'flex') {
    if (e.key === 'Escape') TOPieza.cerrarModal();
    if (e.key === 'Enter')  TOPieza.confirmarAgregar();
  }
});
