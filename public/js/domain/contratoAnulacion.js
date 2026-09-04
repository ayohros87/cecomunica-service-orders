// Anulación de un contrato — fuente ÚNICA de la escritura.
// La usan el menú ⋯ de la lista de contratos (contratos-list.js) y el modal
// "Ver contrato" del Centro de gestión (clientes-centro.js). Si cambian los
// campos que lee onAnnulment, cambian solo aquí. Mismo patrón que
// js/domain/transicionPendiente.js.
//
// La pregunta que importa no es el motivo sino QUÉ PASA CON LOS EQUIPOS:
//   · 'sustitucion' — se rehace el papel, el cliente conserva los equipos
//     (opcionalmente pasan al contrato sustituto). Es el caso común.
//   · 'terminacion' — termina el acuerdo; onAnnulment abre la DEVOLUCIÓN.
window.ContratoAnulacion = {

  // Se anula un contrato vivo O uno todavía en trámite (pendiente de
  // aprobación — pedido de Alberto 2026-09-04: "cuando el contrato está en
  // gestión debería haber una forma de anular"). Admin y gerente (roles.js
  // 'anular-contrato'). El menú ⋯ de la lista sigue ofreciendo Eliminar para
  // los pendientes; el Centro los anula con rastro (motivo + quién).
  esAnulable(c) { return !!c && ['activo', 'aprobado', 'pendiente_aprobacion'].includes(c.estado); },

  // ¿Aplica la pregunta "qué pasa con los equipos"? Solo si el contrato llegó
  // a estar vivo: un pendiente de aprobación nunca movió equipo, se anula sin
  // devolución ni traspaso (anulacion_tipo 'sustitucion' = nada se mueve).
  preguntaEquipos(c) { return !!c && ['activo', 'aprobado'].includes(c.estado); },

  // Candidatos a sustituto: contratos vivos del MISMO cliente, el más nuevo primero.
  candidatos(contratosDelCliente, idAnulado) {
    return (contratosDelCliente || [])
      .filter(x => x.id !== idAnulado && x.deleted !== true && ['aprobado', 'activo'].includes(x.estado))
      .sort((a, b) => (b.fecha_creacion?.seconds || 0) - (a.fecha_creacion?.seconds || 0));
  },

  // Payload del update. `sustituto` es el doc del contrato sustituto (o null).
  // `anulacion_tipo` va en el MISMO update que `estado`: onAnnulment dispara
  // con ese snapshot y mandarlo después sería tarde.
  buildUpdate(c, { motivo, tipo, sustituto, uid }, docId) {
    const update = {
      estado:             'anulado',
      anulado:            true,
      anulado_motivo:     String(motivo || '').trim(),
      anulado_fecha:      firebase.firestore.Timestamp.now(),
      anulado_por_uid:    uid || firebase.auth().currentUser?.uid || null,
      anulado_ref:        c.contrato_id || docId,
      anulacion_tipo:     tipo === 'terminacion' ? 'terminacion' : 'sustitucion',
      fecha_modificacion: new Date(),
    };
    if (sustituto && update.anulacion_tipo === 'sustitucion') {
      update.sustituido_por_id          = sustituto.id;
      update.sustituido_por_contrato_id = sustituto.contrato_id || '';
    }
    // El firmado se archiva, no se borra: un contrato anulado no queda "firmado".
    if (c.firmado || c.firmado_url) {
      Object.assign(update, {
        firmado_anulado:              true,
        firmado_url_anulado:          c.firmado_url || null,
        firmado_nombre_anulado:       c.firmado_nombre || null,
        firmado_storage_path_anulado: c.firmado_storage_path || null,
        firmado_fecha_anulado:        c.firmado_fecha || null,
        firmado:              false,
        firmado_url:          null,
        firmado_nombre:       null,
        firmado_storage_path: null,
        firmado_fecha:        null,
        firmado_por_uid:      null,
      });
    }
    return update;
  },

  // Qué va a pasar con los equipos — es lo que la persona confirma de un vistazo.
  mensaje(update, c) {
    if (c && c.estado === 'pendiente_aprobacion')
      return '✅ Contrato ANULADO — no había sido aprobado, no se mueve ningún equipo.';
    if (update.anulacion_tipo === 'terminacion')
      return '✅ Contrato ANULADO. Se abrirá una orden de DEVOLUCIÓN para recuperar los equipos.';
    return update.sustituido_por_id
      ? `✅ Contrato ANULADO. Los equipos pasan a ${update.sustituido_por_contrato_id || 'el contrato sustituto'}.`
      : '✅ Contrato ANULADO. Los equipos siguen con el cliente — recuerda vincular el contrato nuevo.';
  },
};
