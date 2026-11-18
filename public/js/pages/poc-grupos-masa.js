// @ts-nocheck
// Agregar o quitar grupos a varios radios a la vez (Brenda / MENZIES AVIATION,
// 2026-11-18).
//
// Se crearon dos grupos nuevos (RIH-PASAJEROS, RIH-RAMPA) para 5 radios de un
// contrato temporal y había que sumarlos a los otros 13 del cliente: la única
// forma era entrar a cada ficha, o reescribir el campo de texto fila por fila
// en "Editar en masa" (tope de 25).
//
// Más → "Agregar o quitar grupos…": con radios de UN solo cliente
// seleccionados, enseña los grupos del catálogo de ese cliente
// (clientes/{id}.poc_grupos) y, según el modo:
//   · Agregar — SUMA los elegidos a cada radio, conservando los que ya tiene.
//   · Quitar  — saca los elegidos de los radios que los tienen; los demás
//     grupos de cada radio no se tocan. Pide una confirmación aparte (quitar
//     en masa es donde un error borra más) y NO toca el catálogo del cliente:
//     el grupo sigue existiendo, solo deja de estar en esos radios.
// La primera versión (a78cd1e) solo agregaba; Brenda pidió las dos cosas
// "desde una misma selección". Sin tope de 25. Un poc_log por radio que
// cambió (accion grupos_agregar / grupos_quitar), con antes y después.
window.PocGruposMasa = {
  async abrir() {
    if (PocState.esLectura()) { Toast.show('Solo administración o recepción cambian los grupos.', 'bad'); return; }
    if (window.PocBulk?._modo) { Toast.show('Termina o cancela la edición en masa primero.', 'bad'); return; }
    const sel = PocList.obtenerSeleccionados();
    if (!sel.length) { Toast.show('Selecciona los radios a los que vas a agregar o quitar grupos.', 'bad'); return; }
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
      Toast.show('Los radios seleccionados son de varios clientes. Los grupos se cambian a un cliente a la vez.', 'bad');
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
    // (un grupo escrito a mano en un radio también se puede extender a los
    // demás, o quitar).
    const norm = (g) => FMT.normalize(g);
    const gruposDe = (d) => (Array.isArray(d.grupos) ? d.grupos : []);
    const universo = FMT.dedupGrupos([...catalogo, ...radios.flatMap(gruposDe)])
      .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
    if (!universo.length) {
      Toast.show(`${clienteNombre || 'El cliente'} no tiene grupos. Créalos en Más → Administrar grupos.`, 'warn');
      return;
    }
    const catNorms = new Set(catalogo.map(norm));
    const loTiene = (d, g) => gruposDe(d).some(x => norm(x) === norm(g));
    const tienen = (g) => radios.filter(d => loTiene(d, g)).length;

    const esc = FMT.esc;
    const n = radios.length;
    const chips = universo.map(g => {
      const t = tienen(g);
      return `<button type="button" class="grupo-chip ${catNorms.has(norm(g)) ? '' : 'is-extra'}" data-grupo="${esc(g)}" data-tienen="${t}"
                title="${t === n ? 'Lo tienen todos los seleccionados' : `Lo ${t === 1 ? 'tiene' : 'tienen'} ${t} de ${n}`}">${esc(g)} <span style="opacity:.7;font-weight:400;">${t === n ? '· todos' : `· ${t}/${n}`}</span></button>`;
    }).join('');
    const btnModo = (modo, icono, texto) => `<button type="button" class="btn ${modo === 'agregar' ? 'btn-primary' : 'btn-secondary'} btn-sm" data-modo="${modo}" aria-pressed="${modo === 'agregar'}"><i data-lucide="${icono}"></i> ${texto}</button>`;
    const html = `
      <div id="pocGruposMasaModo" role="group" aria-label="Qué hacer con los grupos" style="display:flex;gap:6px;margin:0 0 10px;">
        ${btnModo('agregar', 'plus', 'Agregar')}
        ${btnModo('quitar', 'minus', 'Quitar')}
      </div>
      <p id="pocGruposMasaIntro" style="margin:0 0 10px;font-size:14.5px;line-height:1.5;"></p>
      <div class="drawer-grupos-chips" id="pocGruposMasaChips">${chips}</div>
      <p id="pocGruposMasaResumen" style="margin:10px 0 0;font-size:13px;color:var(--fg-2);min-height:18px;"></p>
      <p style="margin:6px 0 0;font-size:12.5px;color:var(--fg-3);line-height:1.4;">
        El número junto a cada grupo dice cuántos de los seleccionados ya lo tienen. ¿Falta un grupo? Créalo en <b>Más → Administrar grupos</b>.
      </p>`;

    let modo = 'agregar';
    const cuantos = n === 1 ? 'Un radio' : `<b>${n}</b> radios`;
    const res = await Modal.sheet({
      title: 'Agregar o quitar grupos',
      icon: 'tags',
      size: 'md',
      html,
      buttons: [
        { action: 'cancel',    label: 'Cancelar' },
        { action: 'confirmar', label: 'Agregar', primary: true },
      ],
      onMount: (root) => {
        const resumen = root.querySelector('#pocGruposMasaResumen');
        const intro   = root.querySelector('#pocGruposMasaIntro');
        const activos = () => [...root.querySelectorAll('.grupo-chip.is-active')].map(b => b.dataset.grupo);
        const pintar = () => {
          const act = activos();
          if (!act.length) { resumen.textContent = ''; return; }
          const cambian = modo === 'agregar'
            ? radios.filter(d => act.some(g => !loTiene(d, g))).length
            : radios.filter(d => act.some(g => loTiene(d, g))).length;
          const verbo = modo === 'agregar' ? ['agrega', 'agregan', 'a'] : ['quita', 'quitan', 'de'];
          resumen.innerHTML = `Se ${act.length === 1 ? `${verbo[0]} <b>1</b> grupo` : `${verbo[1]} <b>${act.length}</b> grupos`} ${verbo[2]} <b>${cambian}</b> radio${cambian === 1 ? '' : 's'}.`;
        };
        const ponerModo = (m) => {
          modo = m;
          root.querySelectorAll('#pocGruposMasaModo [data-modo]').forEach(b => {
            const on = b.dataset.modo === m;
            b.classList.toggle('btn-primary', on);
            b.classList.toggle('btn-secondary', !on);
            b.setAttribute('aria-pressed', String(on));
          });
          intro.innerHTML = m === 'agregar'
            ? `${cuantos} de <b>${esc(clienteNombre)}</b>. Toca los grupos que quieres <b>agregar</b>; cada radio conserva los que ya tiene.`
            : `${cuantos} de <b>${esc(clienteNombre)}</b>. Toca los grupos que quieres <b>quitar</b>; los demás grupos de cada radio no se tocan.`;
          // Agregar: no hay nada que sumar donde ya lo tienen todos.
          // Quitar: no hay nada que sacar donde no lo tiene ninguno.
          root.querySelectorAll('.grupo-chip').forEach(b => {
            const t = Number(b.dataset.tienen);
            const sinEfecto = m === 'agregar' ? t === n : t === 0;
            b.classList.remove('is-active');
            b.disabled = sinEfecto;
            b.style.opacity = sinEfecto ? '.55' : '';
            b.style.cursor = sinEfecto ? 'default' : '';
          });
          const btn = root.querySelector('.modal-footer [data-sheet-action="confirmar"]');
          if (btn) btn.textContent = m === 'agregar' ? 'Agregar' : 'Quitar';
          pintar();
        };
        root.querySelectorAll('#pocGruposMasaModo [data-modo]').forEach(b => b.addEventListener('click', () => ponerModo(b.dataset.modo)));
        root.querySelectorAll('.grupo-chip').forEach(b => b.addEventListener('click', () => {
          if (b.disabled) return;
          b.classList.toggle('is-active');
          pintar();
        }));
        ponerModo('agregar');
        if (typeof lucide !== 'undefined') lucide.createIcons();
      },
      onAction: (action, root) => {
        if (action !== 'confirmar') return null;
        const act = [...root.querySelectorAll('.grupo-chip.is-active')].map(b => b.dataset.grupo);
        if (!act.length) { Toast.show(`Toca al menos un grupo para ${modo === 'agregar' ? 'agregar' : 'quitar'}.`, 'warn'); return false; }
        return { modo, grupos: act };
      },
    });
    if (!res || !res.grupos?.length) return;
    const quitar = res.modo === 'quitar';

    // Agregar: mismo criterio que la ficha — con prefijo de empresa, el grupo
    // queda como PREFIJO-Nombre (los del catálogo ya vienen así; no cambia
    // nada). Quitar: se saca tal como está escrito en cada radio.
    const elegidos = FMT.dedupGrupos(!quitar && prefijo ? res.grupos.map(g => FMT.aplicarPrefijoGrupo(prefijo, g)) : res.grupos);

    const cambios = [];
    for (const d of radios) {
      const antes = gruposDe(d);
      if (quitar) {
        // Las cadenas EXACTAS del radio (arrayRemove compara literal): un
        // "aero1" escrito a mano también sale al quitar "AERO1".
        const salen = antes.filter(x => elegidos.some(g => norm(g) === norm(x)));
        if (!salen.length) continue;   // no tenía ninguno
        cambios.push({ d, delta: salen, despues: antes.filter(x => !salen.includes(x)) });
      } else {
        const faltan = elegidos.filter(g => !antes.some(x => norm(x) === norm(g)));
        if (!faltan.length) continue;  // ya los tenía todos
        cambios.push({ d, delta: faltan, despues: [...antes, ...faltan] });
      }
    }
    if (!cambios.length) {
      Toast.show(quitar ? 'Ninguno de los seleccionados tenía esos grupos.' : 'Todos los seleccionados ya tenían esos grupos.', 'info');
      return;
    }
    if (quitar) {
      const sinGrupos = cambios.filter(c => !c.despues.length).length;
      const ok = await Modal.confirm({
        title: 'Quitar grupos',
        confirmLabel: `Quitar de ${cambios.length} radio${cambios.length === 1 ? '' : 's'}`,
        message: `Vas a quitar ${elegidos.join(', ')} de ${cambios.length} radio${cambios.length === 1 ? '' : 's'} de ${clienteNombre}.`
          + (sinGrupos ? ` ${sinGrupos === 1 ? 'Un radio queda' : `${sinGrupos} radios quedan`} sin ningún grupo.` : '')
          + ' El grupo sigue en el catálogo del cliente.',
      });
      if (!ok) return;
    }

    const user = firebase.auth().currentUser;
    const db   = firebase.firestore();
    const FV   = firebase.firestore.FieldValue;
    let hechos = 0;
    const TANDA = 200;   // 2 escrituras por radio; el batch admite 500
    try {
      for (let i = 0; i < cambios.length; i += TANDA) {
        const tanda = cambios.slice(i, i + TANDA);
        const batch = db.batch();
        for (const { d, delta, despues } of tanda) {
          batch.update(db.collection('poc_devices').doc(d.id), {
            // arrayUnion / arrayRemove: el cambio se aplica en el servidor. Si
            // otra sesión le cambió los grupos a este radio entre la lectura
            // y el guardado, no se pisa.
            grupos: quitar ? FV.arrayRemove(...delta) : FV.arrayUnion(...delta),
            updated_at:       FV.serverTimestamp(),
            updated_by:       user?.uid   || null,
            updated_by_email: user?.email || null,
          });
          batch.set(db.collection('poc_logs').doc(), {
            equipo_id: d.id,
            fecha:     FV.serverTimestamp(),
            usuario:   user?.email || null,
            accion:    quitar ? 'grupos_quitar' : 'grupos_agregar',
            origen:    'poc-lista',
            motivo:    `Grupos ${quitar ? 'quitados' : 'agregados'} en masa: ${elegidos.join(', ')}`,
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
    const resto = radios.length - cambios.length;
    const uno = elegidos.length === 1;
    Toast.show(quitar
      ? `${uno ? 'Grupo quitado' : `${elegidos.length} grupos quitados`} de ${hechos} radio${hechos === 1 ? '' : 's'}`
        + (resto ? ` · ${resto} no ${uno ? 'lo' : 'los'} ${resto === 1 ? 'tenía' : 'tenían'}` : '') + '.'
      : `${uno ? 'Grupo agregado' : `${elegidos.length} grupos agregados`} a ${hechos} radio${hechos === 1 ? '' : 's'}`
        + (resto ? ` · ${resto} ya ${uno ? 'lo' : 'los'} ${resto === 1 ? 'tenía' : 'tenían'}` : '') + '.', 'ok');
  },
};
