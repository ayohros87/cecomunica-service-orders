// @ts-nocheck
// Agregar grupos a varios radios a la vez (Brenda / MENZIES AVIATION,
// 2026-11-18).
//
// Se crearon dos grupos nuevos (RIH-PASAJEROS, RIH-RAMPA) para 5 radios de un
// contrato temporal y había que sumarlos a los otros 13 del cliente: la única
// forma era entrar a cada ficha, o reescribir el campo de texto fila por fila
// en "Editar en masa" (tope de 25).
//
// Más → "Agregar grupos…": con radios de UN solo cliente seleccionados,
// enseña los grupos del catálogo de ese cliente (clientes/{id}.poc_grupos) y
// SUMA los elegidos a cada radio, conservando los que ya tiene. No quita
// grupos (quitar en masa es donde un error borra más; eso sigue en la ficha y
// en Administrar grupos). Sin tope de 25. Un poc_log por radio que cambió.
window.PocGruposMasa = {
  async abrir() {
    if (PocState.esLectura()) { Toast.show('Solo administración o recepción cambian los grupos.', 'bad'); return; }
    if (window.PocBulk?._modo) { Toast.show('Termina o cancela la edición en masa primero.', 'bad'); return; }
    const sel = PocList.obtenerSeleccionados();
    if (!sel.length) { Toast.show('Selecciona los radios a los que vas a agregar grupos.', 'bad'); return; }
    // Fichas FRESCAS, no la memoria de la lista: _docsPorId es de la última
    // vez que se pintó la fila y otra sesión pudo haberle cambiado los grupos
    // (el conteo "ya lo tienen N" y el log saldrían mal). Mismo criterio que
    // "Asignar del pool".
    let radios;
    try {
      radios = (await Promise.all(sel.map(({ id }) => PocService.getPocDevice(id))))
        .filter(d => d && d.deleted !== true);
    } catch (e) {
      console.error('[PocGruposMasa] leer equipos', e);
      Toast.show('No se pudieron leer los equipos. Revisa tu conexión e intenta de nuevo.', 'bad');
      return;
    }
    if (!radios.length) { Toast.show('Los seleccionados son fichas cerradas: no se editan.', 'warn'); return; }

    // El catálogo es por cliente: mezclar clientes no tiene una lista de
    // grupos que ofrecer.
    const claves = [...new Set(radios.map(d => d.cliente_id ? 'id:' + d.cliente_id : 'n:' + (d.cliente || '')))];
    if (claves.length > 1) {
      Toast.show('Los radios seleccionados son de varios clientes. Los grupos se agregan a un cliente a la vez.', 'bad');
      return;
    }
    const clienteId = radios[0].cliente_id || null;
    const clienteNombre = PocState.nombreClienteDe(radios[0]) || radios[0].cliente || '';
    if (!clienteId) {
      Toast.show('Estos radios no están ligados a un cliente del sistema: no hay catálogo de grupos que ofrecer.', 'bad');
      return;
    }

    let catalogo = [], prefijo = null;
    try {
      // fresh: los grupos pueden haberse creado hace un minuto en otra pestaña.
      const [cat, pfx] = await Promise.all([
        PocService.getCatalogoGrupos(clienteId, { fresh: true }),
        PocService.getGrupoPrefix(clienteId),
      ]);
      catalogo = Array.isArray(cat) ? cat : [];
      prefijo = pfx || null;
    } catch (e) {
      console.error('[PocGruposMasa] catálogo', e);
      Toast.show('No se pudo leer el catálogo de grupos. Revisa tu conexión e intenta de nuevo.', 'bad');
      return;
    }
    // Universo = catálogo ∪ grupos que ya trae alguno de los seleccionados
    // (un grupo escrito a mano en un radio también se puede extender a los demás).
    const norm = (g) => FMT.normalize(g);
    const universo = FMT.dedupGrupos([...catalogo, ...radios.flatMap(d => Array.isArray(d.grupos) ? d.grupos : [])])
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    if (!universo.length) {
      Toast.show(`${clienteNombre || 'El cliente'} no tiene grupos. Créalos en Más → Administrar grupos.`, 'warn');
      return;
    }
    const catNorms = new Set(catalogo.map(norm));
    const tienen = (g) => radios.filter(d => (Array.isArray(d.grupos) ? d.grupos : []).some(x => norm(x) === norm(g))).length;

    const esc = FMT.esc;
    const n = radios.length;
    const chips = universo.map(g => {
      const t = tienen(g);
      const completo = t === n;
      return `<button type="button" class="grupo-chip ${catNorms.has(norm(g)) ? '' : 'is-extra'}" data-grupo="${esc(g)}"
                ${completo ? 'disabled style="opacity:.55;cursor:default;"' : ''}
                title="${completo ? 'Ya lo tienen todos los seleccionados' : `Lo ${t === 1 ? 'tiene' : 'tienen'} ${t} de ${n}`}">${esc(g)} <span style="opacity:.7;font-weight:400;">${completo ? '· todos' : `· ${t}/${n}`}</span></button>`;
    }).join('');
    const html = `
      <p style="margin:0 0 10px;font-size:14.5px;line-height:1.5;">
        ${n === 1 ? 'Un radio' : `<b>${n}</b> radios`} de <b>${esc(clienteNombre)}</b>. Toca los grupos que quieres <b>agregar</b>;
        cada radio conserva los que ya tiene.
      </p>
      <div class="drawer-grupos-chips" id="pocGruposMasaChips">${chips}</div>
      <p id="pocGruposMasaResumen" style="margin:10px 0 0;font-size:13px;color:var(--fg-2);min-height:18px;"></p>
      <p style="margin:6px 0 0;font-size:12.5px;color:var(--fg-3);line-height:1.4;">
        El número junto a cada grupo dice cuántos de los seleccionados ya lo tienen. ¿Falta un grupo? Créalo en <b>Más → Administrar grupos</b>.
      </p>`;

    const elegidos = await Modal.sheet({
      title: 'Agregar grupos',
      icon: 'list-plus',
      size: 'md',
      html,
      buttons: [
        { action: 'cancel',    label: 'Cancelar' },
        { action: 'confirmar', label: 'Agregar', primary: true },
      ],
      onMount: (root) => {
        const resumen = root.querySelector('#pocGruposMasaResumen');
        const pintar = () => {
          const act = [...root.querySelectorAll('.grupo-chip.is-active')].map(b => b.dataset.grupo);
          if (!act.length) { resumen.textContent = ''; return; }
          const cambian = radios.filter(d => act.some(g => !(Array.isArray(d.grupos) ? d.grupos : []).some(x => norm(x) === norm(g)))).length;
          resumen.innerHTML = `Se ${act.length === 1 ? 'agrega <b>1</b> grupo' : `agregan <b>${act.length}</b> grupos`} a <b>${cambian}</b> radio${cambian === 1 ? '' : 's'}.`;
        };
        root.querySelectorAll('.grupo-chip:not([disabled])').forEach(b => b.addEventListener('click', () => {
          b.classList.toggle('is-active');
          pintar();
        }));
      },
      onAction: (action, root) => {
        if (action !== 'confirmar') return null;
        const act = [...root.querySelectorAll('.grupo-chip.is-active')].map(b => b.dataset.grupo);
        if (!act.length) { Toast.show('Toca al menos un grupo para agregar.', 'warn'); return false; }
        return act;
      },
    });
    if (!elegidos || !elegidos.length) return;

    // Mismo criterio que la ficha: con prefijo de empresa, el grupo queda
    // como PREFIJO-Nombre (los del catálogo ya vienen así; no cambia nada).
    const aAgregar = FMT.dedupGrupos(prefijo ? elegidos.map(g => FMT.aplicarPrefijoGrupo(prefijo, g)) : elegidos);

    const user = firebase.auth().currentUser;
    const db   = firebase.firestore();
    const cambios = [];
    for (const d of radios) {
      const antes = Array.isArray(d.grupos) ? d.grupos : [];
      const faltan = aAgregar.filter(g => !antes.some(x => norm(x) === norm(g)));
      if (!faltan.length) continue;   // ya los tenía todos
      cambios.push({ d, faltan, despues: [...antes, ...faltan] });
    }
    if (!cambios.length) { Toast.show('Todos los seleccionados ya tenían esos grupos.', 'info'); return; }

    let hechos = 0;
    const TANDA = 200;   // 2 escrituras por radio; el batch admite 500
    try {
      for (let i = 0; i < cambios.length; i += TANDA) {
        const tanda = cambios.slice(i, i + TANDA);
        const batch = db.batch();
        for (const { d, faltan, despues } of tanda) {
          batch.update(db.collection('poc_devices').doc(d.id), {
            // arrayUnion: SUMA en el servidor. Si otra sesión le cambió los
            // grupos a este radio entre la lectura y el guardado, no se pisa.
            grupos: firebase.firestore.FieldValue.arrayUnion(...faltan),
            updated_at:       firebase.firestore.FieldValue.serverTimestamp(),
            updated_by:       user?.uid   || null,
            updated_by_email: user?.email || null,
          });
          batch.set(db.collection('poc_logs').doc(), {
            equipo_id: d.id,
            fecha:     firebase.firestore.FieldValue.serverTimestamp(),
            usuario:   user?.email || null,
            accion:    'grupos_agregar',
            origen:    'poc-lista',
            motivo:    `Grupos agregados en masa: ${aAgregar.join(', ')}`,
            cambios:   { antes: PocService.stripSentinels(d), despues: PocService.stripSentinels({ ...d, grupos: despues }) },
          });
        }
        await batch.commit();
        tanda.forEach(({ d, despues }) => PocList.aplicarCambioLocal(d.id, { grupos: despues }));
        hechos += tanda.length;
      }
    } catch (e) {
      console.error('[PocGruposMasa] guardar', e);
      Toast.show(`Se actualizaron ${hechos} de ${cambios.length} radios. Error: ${e.message || e}`, 'bad');
      PocList.refresh();
      return;
    }
    const ya = radios.length - cambios.length;
    Toast.show(`${aAgregar.length === 1 ? 'Grupo agregado' : `${aAgregar.length} grupos agregados`} a ${hechos} radio${hechos === 1 ? '' : 's'}`
      + (ya ? ` · ${ya} ya ${ya === 1 ? 'lo tenía' : 'los tenían'}` : '') + '.', 'ok');
  },
};
