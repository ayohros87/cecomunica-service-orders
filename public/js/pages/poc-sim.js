// @ts-nocheck
// POC SIM/phone bulk-update modal
window.PocSim = {
  abrir() {
    if (PocState.esLectura()) {
      Toast.show('Modo lectura: el rol técnico no puede modificar SIM/Teléfono.', 'bad');
      return;
    }
    const seleccionados = PocList.obtenerSeleccionados();
    if (seleccionados.length === 0) { Toast.show('Selecciona al menos un equipo.', 'bad'); return; }

    const dropdown = document.getElementById('operadorGlobal');
    dropdown.innerHTML = '<option value="">— Selecciona operador —</option>';
    (PocState.listaOperadores || []).forEach(op => {
      const opt = document.createElement('option');
      opt.value = op;
      opt.textContent = op;
      dropdown.appendChild(opt);
    });

    const modal = document.getElementById('simModal');
    Modal.open('simModal', { onEscape: false });
    modal.onclick  = e => { if (e.target === modal) this.cerrar(); };
    const handler  = e => { if (e.key === 'Escape') this.cerrar(); };
    document.addEventListener('keydown', handler);
    modal._escapeHandler = handler;
  },

  cerrar() {
    const modal = document.getElementById('simModal');
    Modal.close('simModal');
    if (modal?._escapeHandler) {
      document.removeEventListener('keydown', modal._escapeHandler);
      modal._escapeHandler = null;
    }
    document.getElementById('simPasteArea').value     = '';
    document.getElementById('operadorGlobal').selectedIndex = 0;
  },

  async procesar() {
    if (PocState.esLectura()) {
      Toast.show('Modo lectura: el rol técnico no puede modificar SIM/Teléfono.', 'bad');
      return;
    }
    const datos       = document.getElementById('simPasteArea').value.trim().split('\n');
    const seleccionados = PocList.obtenerSeleccionados();
    if (datos.length !== seleccionados.length) {
      Toast.show(`Seleccionaste ${seleccionados.length} radios pero pegaste ${datos.length} líneas.`, 'bad');
      return;
    }
    const operador    = document.getElementById('operadorGlobal').value;
    const user        = firebase.auth().currentUser;
    let actualizados  = 0;

    for (let i = 0; i < seleccionados.length; i++) {
      const simTel = datos[i].split(/\t|,/).map(s => s.trim());
      const id     = seleccionados[i].id;
      if (!id) continue;
      const prevData = (await PocService.getPocDevice(id)) || {};
      const newData  = {
        operador,
        sim_number:       simTel[0] || '',
        sim_phone:        simTel[1] || '',
        updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
        updated_by:       user?.uid   || null,
        updated_by_email: user?.email || null
      };
      await PocService.updatePocDevice(id, newData);
      await PocService.addLog({
        equipo_id: id,
        fecha:     firebase.firestore.FieldValue.serverTimestamp(),
        usuario:   user?.email,
        cambios:   { antes: prevData, despues: newData }
      });
      // SIM pegado a mano que existe disponible en el pool → marcarlo asignado
      // para que no se ofrezca dos veces. Best-effort, no bloquea el lote.
      if (newData.sim_number) {
        SimCardsService.marcarAsignadoSiExiste(newData.sim_number, {
          id, serial: prevData.serial || '',
          cliente_nombre: PocState.nombreClienteDe(prevData),
        }, user);
      }
      actualizados++;
    }

    Toast.show(`${actualizados} radios actualizados.`, 'ok');
    this.cerrar();
    PocList.refresh();
  }
};
