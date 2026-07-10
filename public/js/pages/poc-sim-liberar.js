// @ts-nocheck
// Liberación de SIMs al desactivar/eliminar equipos POC. Compartido por el
// drawer de edición (poc-edit), la edición masiva (poc-bulk), editar-batch y
// el soft-delete de la lista. Detecta equipos que pasaron a inactivo o
// eliminado conservando un SIM, pregunta UNA sola vez, y si la usuaria acepta:
// el SIM vuelve al pool como disponible y se limpian sim/teléfono/operador del
// equipo en una sola transacción (SimCardsService.liberarDeEquipo). El
// historial queda en poc_logs.
window.SimLiberar = {

  // cambios: [{ id, antes, despues }] — `despues` es el estado final del doc.
  // El SIM que se libera es el que quedó EN el equipo tras el guardado
  // (despues.sim_number): si en la misma edición se tecleó un SIM nuevo y se
  // desactivó, se libera el nuevo (el que el equipo realmente lleva), no el
  // viejo ya pisado.
  // Retorna Set<deviceId> con los equipos cuyo SIM fue liberado (para que el
  // caller refresque su UI). Si la usuaria dice "No" (p.ej. suspensión
  // temporal), el equipo queda inactivo con su SIM intacto.
  // NUNCA lanza: los callers la ejecutan después de guardados ya persistidos,
  // y un throw aquí dejaría su UI en estado colgado (modo edición pegado,
  // redirect que no corre, "Error al guardar" falso).
  async procesarDesactivados(cambios) {
    try {
      return await this._procesar(cambios);
    } catch (e) {
      console.error('SimLiberar falló (los guardados previos ya persistieron):', e);
      try { Toast.show('No se pudo completar la liberación de SIMs — revisa la consola.', 'bad'); } catch (_) { /* sin Toast en esta página */ }
      return new Set();
    }
  },

  // Estado final del SIM en el equipo: el de `despues` si el guardado lo tocó,
  // si no el que ya tenía.
  _simFinal(c) {
    const d = c.despues || {};
    return ('sim_number' in d) ? d : (c.antes || {});
  },

  async _procesar(cambios) {
    const candidatos = (cambios || []).filter(c => {
      const sim = SimCardsService.normalizarSim(this._simFinal(c).sim_number);
      if (!sim) return false;
      const desactivado = (c.antes?.activo !== false) && (c.despues?.activo === false);
      const eliminado   = (c.antes?.deleted !== true) && (c.despues?.deleted === true);
      return desactivado || eliminado;
    });
    if (!candidatos.length) return new Set();

    const esc = FMT.esc;
    const filas = candidatos.slice(0, 10).map(c =>
      `<strong>${esc(c.antes?.serial || c.antes?.unit_id || c.id)}</strong> — SIM ${esc(this._simFinal(c).sim_number)}`
    ).join('<br>');
    const extra = candidatos.length > 10 ? `<br>… y ${candidatos.length - 10} más` : '';
    const ok = await Modal.confirm({
      title: 'SIMs de equipos desactivados',
      message: `${candidatos.length === 1 ? 'Este equipo quedó inactivo y tiene un SIM' : `Estos ${candidatos.length} equipos quedaron inactivos y tienen SIM`}:<br><br>${filas}${extra}<br><br>¿Poner ${candidatos.length === 1 ? 'el SIM' : 'los SIMs'} como <strong>disponibles</strong> en el pool? Se quitarán del equipo (SIM, teléfono y operador).`,
      confirmLabel: 'Poner disponibles',
      cancelLabel: 'Conservar en el equipo',
    });
    if (!ok) return new Set();

    const user = firebase.auth().currentUser;
    const liberados = new Set();
    let errores = 0;

    for (const c of candidatos) {
      const final = this._simFinal(c);
      const clienteNombre = (window.PocState?.nombreClienteDe?.(c.antes || {}))
        || c.antes?.cliente_nombre || c.antes?.cliente || '';
      try {
        // Transacción: limpia el equipo y marca el SIM disponible — salvo que
        // el pool lo tenga asignado a OTRO equipo ('pool-ajeno': se limpia
        // solo el equipo, la otra asignación no se toca).
        const resultado = await SimCardsService.liberarDeEquipo({
          sim_number: final.sim_number,
          sim_phone:  final.sim_phone || '',
          operador:   final.operador  || '',
          desde: { device_id: c.id, serial: c.antes?.serial || '', cliente_nombre: clienteNombre },
        }, user);
        if (resultado === 'pool-ajeno') {
          console.warn(`SIM ${final.sim_number} está asignado a otro equipo en el pool; se limpió solo el equipo ${c.antes?.serial || c.id}.`);
        }

        const antesLog     = PocService.stripSentinels(c.despues || c.antes);
        const despuesClean = { ...antesLog, sim_number: '', sim_phone: '', operador: '' };
        PocService.addLog({
          equipo_id: c.id,
          fecha:     firebase.firestore.FieldValue.serverTimestamp(),
          usuario:   user?.email,
          cambios:   { antes: antesLog, despues: despuesClean },
        }).catch(e => console.warn('poc_log write failed (non-critical):', e));

        liberados.add(c.id);
      } catch (e) {
        console.error(`No se pudo liberar el SIM de ${c.antes?.serial || c.id}:`, e);
        errores++;
      }
    }

    if (liberados.size) Toast.show(`${liberados.size} SIM${liberados.size === 1 ? '' : 's'} devuelto${liberados.size === 1 ? '' : 's'} al pool como disponible${liberados.size === 1 ? '' : 's'}.`, 'ok');
    if (errores)        Toast.show(`${errores} SIM(s) no se pudieron liberar — revisa la consola.`, 'bad');
    return liberados;
  },
};
