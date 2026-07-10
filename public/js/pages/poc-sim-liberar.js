// @ts-nocheck
// Liberación de SIMs al desactivar/eliminar equipos POC. Compartido por el
// drawer de edición (poc-edit), la edición masiva (poc-bulk), editar-batch y
// el soft-delete de la lista. Detecta equipos que pasaron a inactivo o
// eliminado conservando un SIM, pregunta UNA sola vez, y si la usuaria acepta:
// el SIM vuelve al pool como disponible y se limpian sim/teléfono/operador del
// equipo (una sola fuente de verdad; el historial queda en poc_logs).
window.SimLiberar = {

  // cambios: [{ id, antes, despues }] — `despues` es el estado final del doc.
  // Retorna Set<deviceId> con los equipos cuyo SIM fue liberado (para que el
  // caller refresque su UI). Si la usuaria dice "No" (p.ej. suspensión
  // temporal), el equipo queda inactivo con su SIM intacto.
  async procesarDesactivados(cambios) {
    const candidatos = (cambios || []).filter(c => {
      const sim = SimCardsService.normalizarSim(c.antes?.sim_number);
      if (!sim) return false;
      const desactivado = (c.antes?.activo !== false) && (c.despues?.activo === false);
      const eliminado   = (c.antes?.deleted !== true) && (c.despues?.deleted === true);
      return desactivado || eliminado;
    });
    if (!candidatos.length) return new Set();

    const esc = FMT.esc;
    const filas = candidatos.slice(0, 10).map(c =>
      `<strong>${esc(c.antes.serial || c.antes.unit_id || c.id)}</strong> — SIM ${esc(c.antes.sim_number)}`
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
      const antes = c.antes || {};
      const clienteNombre = (window.PocState?.nombreClienteDe?.(antes))
        || antes.cliente_nombre || antes.cliente || '';
      try {
        await SimCardsService.liberar({
          sim_number: antes.sim_number,
          sim_phone:  antes.sim_phone || '',
          operador:   antes.operador  || '',
          desde: { device_id: c.id, serial: antes.serial || '', cliente_nombre: clienteNombre },
        }, user);

        const limpiar = {
          sim_number: '', sim_phone: '', operador: '',
          updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
          updated_by:       user?.uid   || null,
          updated_by_email: user?.email || null,
        };
        await PocService.updatePocDevice(c.id, limpiar);

        // FieldValue sentinels (serverTimestamp/delete) no pueden ir anidados
        // dentro de un .add() — se filtran antes de embeber en el log.
        const FV = firebase.firestore.FieldValue;
        const sinSentinels = (obj) => Object.fromEntries(
          Object.entries(obj || {}).filter(([, v]) => !(v instanceof FV))
        );
        const antesLog   = sinSentinels(c.despues || antes);
        const despuesClean = { ...antesLog, sim_number: '', sim_phone: '', operador: '' };
        PocService.addLog({
          equipo_id: c.id,
          fecha:     firebase.firestore.FieldValue.serverTimestamp(),
          usuario:   user?.email,
          cambios:   { antes: antesLog, despues: despuesClean },
        }).catch(e => console.warn('poc_log write failed (non-critical):', e));

        liberados.add(c.id);
      } catch (e) {
        console.error(`No se pudo liberar el SIM de ${antes.serial || c.id}:`, e);
        errores++;
      }
    }

    if (liberados.size) Toast.show(`${liberados.size} SIM${liberados.size === 1 ? '' : 's'} devuelto${liberados.size === 1 ? '' : 's'} al pool como disponible${liberados.size === 1 ? '' : 's'}.`, 'ok');
    if (errores)        Toast.show(`${errores} SIM(s) no se pudieron liberar — revisa la consola.`, 'bad');
    return liberados;
  },
};
