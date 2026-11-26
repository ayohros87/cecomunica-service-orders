// @ts-nocheck
// Caja menuda — la pantalla de quien pide y de quien aprueba (caja/index.html).
//
// Dos pestañas: "Mis gastos" (lo que pedí y en qué va) y "Por aprobar" (lo de
// mi gente, si soy jefe de alguien; administración ve todo lo solicitado).
// El botón fijo de abajo abre el formulario. Tocar una tarjeta abre el gasto
// con las acciones que me tocan. Deep-link de los correos: ?g=<id>.
(function () {
  const C = () => window.CajaMenuda;
  const S = () => window.CajaMenudaService;
  const $ = (id) => document.getElementById(id);

  let yo = null;
  let tab = 'mios';
  let mios = [], aprobar = [];

  function pintar() {
    const cont = $('cmLista');
    document.querySelectorAll('.cm-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const cnt = $('cmCntAprobar');
    cnt.textContent = String(aprobar.length); cnt.hidden = !aprobar.length;
    // La pestaña de aprobar sale para administración y para quien tenga algo esperando.
    $('cmTabAprobar').hidden = !(yo.rol === 'administrador' || aprobar.length || tab === 'aprobar');
    if (window.Layout?.setRailBadge) Layout.setRailBadge('caja', aprobar.length);

    if (tab === 'aprobar') {
      cont.innerHTML = aprobar.length
        ? aprobar.map(g => CajaUI.tarjeta(g, { quien: 'otro' })).join('')
        : `<div class="cm-vacio"><i data-lucide="check-circle-2"></i><p>Nada por aprobar.</p></div>`;
    } else {
      const abiertos = mios.filter(g => C().ABIERTOS.includes(g.estado));
      const hechos = mios.filter(g => !C().ABIERTOS.includes(g.estado)).slice(0, 30);
      cont.innerHTML = !mios.length
        ? `<div class="cm-vacio"><i data-lucide="banknote"></i><p>Todavía no has pedido nada.<br>Toca <b>Nuevo gasto</b> para pedir un reembolso o un anticipo.</p></div>`
        : (abiertos.length ? `<h2 class="cm-grupo-t">En curso</h2>${abiertos.map(g => CajaUI.tarjeta(g)).join('')}` : '')
          + (hechos.length ? `<h2 class="cm-grupo-t">Terminados</h2>${hechos.map(g => CajaUI.tarjeta(g)).join('')}` : '');
    }
    if (window.lucide?.createIcons) lucide.createIcons({ nodes: [cont] });
  }

  async function cargar() {
    try {
      [mios, aprobar] = await Promise.all([S().mios(), S().porAprobar()]);
      pintar();
    } catch (e) {
      console.error('[caja] cargar:', e);
      $('cmLista').innerHTML = `<div class="cm-vacio">No se pudo cargar. Revisa la conexión y recarga.</div>`;
    }
  }

  async function abrirPorId(id) {
    const g = [...mios, ...aprobar].find(x => x.id === id) || await S().get(id).catch(() => null);
    if (!g) { Toast.show('Ese gasto no existe o no es tuyo.', 'warn'); return; }
    CajaUI.abrir(g);
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.querySelector('.cm-tabs').addEventListener('click', (e) => {
      const b = e.target.closest('.cm-tab');
      if (!b) return;
      tab = b.dataset.tab; pintar();
    });
    $('cmLista').addEventListener('click', (e) => {
      const c = e.target.closest('[data-cm-id]');
      if (c) abrirPorId(c.dataset.cmId);
    });
    $('cmNuevo').addEventListener('click', () => CajaUI.nuevo());

    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) { window.location.href = '../login.html'; return; }
      try {
        const p = await Sesion.miPerfil(user);
        window.userRole = p.rol || '';
        if (!MODULOS.exigir(window.userRole, 'caja')) return;
        yo = { uid: user.uid, rol: p.rol, nombre: p.nombre || user.displayName || '', email: user.email || '' };
        S().usar(yo);
        const cfg = await S().config();
        CajaUI.init({ yo, cfg, onCambio: cargar });
        $('cmLinkConta').hidden = !C().esCustodio(yo.rol);
        await cargar();
        const q = new URLSearchParams(location.search);
        if (q.get('ver') === 'aprobar') { tab = 'aprobar'; pintar(); }
        if (q.get('g')) abrirPorId(q.get('g'));
      } catch (e) {
        console.error('[caja] arranque:', e);
        $('cmLista').innerHTML = `<div class="cm-vacio">No se pudo cargar. Revisa la conexión y recarga.</div>`;
      }
    });
  });
})();
