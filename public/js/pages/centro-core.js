// @ts-nocheck
// Partido el 2026-09-28 (auditoría UX §4.3 #13): clientes-centro.js tenía
// 7,800 líneas. Este núcleo define window.Centro (estado, init, helpers
// compartidos) y cada sección de antes es un centro-*.js que le suma sus
// métodos con Object.assign(window.Centro, {...}). El orden de carga lo fija
// js/entry/clientes-centro.js: el núcleo primero, luego las secciones; el
// init lo dispara centro.html en DOMContentLoaded, cuando ya cargó todo.
// Ningún método cambió de nombre ni de lógica al mudarse.
//
// Centro de gestión de clientes (Ola 1, gestiones por cliente).
// La vista 360 del cliente para el vendedor: directorio con búsqueda como
// navegación principal (decisión 2026-08-25: el vendedor llega a INICIAR una
// gestión, con o sin pendientes — las señales son ayuda secundaria), y ficha
// con contratos, flota (equipos_pool por cliente), gestiones y señales.
// Los wizards de reemplazo/demo llegan con la Ola 2; mientras tanto el menú
// "Nueva gestión" enlaza los flujos existentes con el cliente a la mano.
window.Centro = {
  rol: null,
  uid: null,
  cartera: 'todos',        // 'mios' | 'todos'
  soloActivos: true,       // toggle "solo clientes activos" (persistido)
  filtroReg: false,        // ?filtro=regularizacion (señal REGV del home)
  term: '',
  cursor: null,
  cliente: null,           // doc del cliente abierto (ficha)
  equipos: [],             // flota cargada de la ficha
  contratos: [],
  _debounce: null,

  AVISO_DIAS: 60,          // espejo de functions/src/lib/vigencia.js (señal, no cálculo)

  esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },

  // El RUC como está en el documento del cliente ("155703071-2-2021 · DV 08"),
  // no el normalizado ("15570307122021-08") que nadie puede cotejar
  // (auditoría de módulos 2026-09-30, C5). El normalizado queda de respaldo
  // para fichas viejas sin `ruc`.
  _rucLegible(c) {
    if (!c) return null;
    const ruc = String(c.ruc || '').trim();
    if (ruc) return `RUC ${ruc}${c.dv ? ` · DV ${String(c.dv).trim()}` : ''}`;
    return c.rucdv_norm ? `RUC ${c.rucdv_norm}` : null;
  },

  // "Le toca a" — QUIÉN destraba una fila de "Ahora" o el siguiente paso de
  // una línea de tiempo. Es un DATO que declara la fuente ({rol}), no una
  // regex sobre el texto (auditoría UX 2026-09-28, §4.3 #13): el texto sale
  // del rol. Cuando el rol es el de quien mira, se le dice "ti".
  //   administracion  aprueba, valida al firmante, decide cobros
  //   bodega          asigna seriales, programa, entrega (la OS)
  //   recepcion       recibe el equipo que vuelve (check-in)
  //   cliente         responde algo él solo (acepta un cobro, devuelve)
  //   cliente_enlace  firma, pero alguien de aquí le manda el enlace
  //   cuenta          quien atiende la cuenta (vendedor / quien mira)
  //   cuenta_carta    quien atiende la cuenta, con la carta que firma el cliente
  //   taller          revisa o diagnostica el equipo
  //   sistema         paso automático: no le toca a nadie
  TOCA: {
    administracion: 'administración',
    bodega: 'bodega',
    recepcion: 'recepción',
    cliente: 'el cliente',
    cliente_enlace: 'el cliente · tú envías el enlace',
    cuenta: 'ti',
    cuenta_carta: 'ti · el cliente firma la carta',
    taller: 'el taller',
    sistema: '',
  },
  _tocaLabel(rol) {
    const txt = rol ? this.TOCA[rol] : '';
    if (!txt) return '';
    const yo = { administracion: [ROLES.ADMIN, 'admin', ROLES.GERENTE], bodega: [ROLES.INVENTARIO],
                 recepcion: [ROLES.RECEPCION] }[rol] || [];
    return yo.includes(this.rol) ? 'ti' : txt;
  },

  init() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) return (window.location.href = '../login.html');
      try {
        const u = await Sesion.miPerfil(user);
        this.rol = u ? u.rol : null;
        this.uid = user.uid;
        this.email = user.email || null;
        // inventario entra para ASIGNAR seriales a las gestiones (llega por el
        // correo de bodega con deep-link ?id=&g=); no crea gestiones.
        // contabilidad (D17, Alberto 2026-10-01) entra de CONSULTA: ve la ficha,
        // los contratos y las gestiones; ningún puede* la incluye.
        const permitido = [ROLES.ADMIN, ROLES.GERENTE, ROLES.VENDEDOR, ROLES.RECEPCION, ROLES.INVENTARIO, ROLES.CONTABILIDAD];
        if (!u || !permitido.includes(this.rol)) {
          document.body.innerHTML = "<h3 style='color:red;text-align:center;margin-top:100px;'>Acceso restringido</h3>";
          return;
        }
        // REGLA (Alberto 2026-08-26): el vendedor SOLO ve su propia cartera.
        // No es un default — es un candado: sin toggle, lista filtrada y ficha
        // bloqueada para clientes ajenos. (El piso en firestore.rules llega con
        // el scoping de la Ola 2; hoy clientes es legible por toda la app.)
        this.cartera = this.esVendedor() ? 'mios' : 'todos';
        if (this.esVendedor()) {
          document.querySelector('.seg')?.classList.add('hidden');
        }
        // Toggle "solo activos": encendido por defecto, preferencia persistida.
        this.soloActivos = localStorage.getItem('cg_solo_activos') !== '0';
        const chk = document.getElementById('cgSoloActivos');
        if (chk) chk.checked = this.soloActivos;
        // Bandeja "Cuentas por regularizar" (plan 2026-09-08 §4.6): admin y
        // gerencia. El vendedor ve las suyas en el inicio y en cada ficha.
        const extras = [];
        if ([ROLES.ADMIN, ROLES.GERENTE, ROLES.RECEPCION].includes(this.rol)) {
          extras.push(`<a class="btn btn-ghost" href="./regularizacion.html" style="font-size:13px;"><i data-lucide="clipboard-list"></i> Cuentas por regularizar</a>`);
        }
        // Alta de cliente desde el Centro (2026-09-11): el vendedor no tiene
        // el módulo Clientes en el rail, así que su única puerta al alta era
        // el combo de una cotización. El formulario es la misma ficha.
        if (this._puedeCrearCliente()) {
          extras.push(`<a class="btn btn-primary" href="./ficha.html?nuevo=1&from=centro" style="font-size:13px;"><i data-lucide="user-plus"></i> Nuevo cliente</a>`);
        }
        const ex = document.getElementById('cgToolsExtra');
        if (ex && extras.length) ex.innerHTML = extras.join(' ');
        this._wire();
        window.CentroAprobaciones?.init(this.rol);
        const params = new URLSearchParams(location.search);
        const id = params.get('id');
        this.gSel = params.get('g') || null;   // deep-link al expediente (correos)
        // Deep-link al contrato (?contrato=): el editor del módulo viejo vuelve
        // aquí y reabre el mismo contrato que se estaba viendo (2026-09-07).
        this.cSel = params.get('contrato') || null;
        // ?filtro=regularizacion: la señal REGV del home aterriza en el
        // directorio filtrado a las cuentas con deuda de regularización
        // (auditoría UX 2026-09-28, §4.3 #13). Antes caía en el directorio
        // completo y había que buscar cuáles eran.
        this.filtroReg = params.get('filtro') === 'regularizacion';
        // ?aviso=: el editor de contratos rebota aquí cuando no puede editar
        // y dice por qué (antes el toast se perdía en la redirección).
        const AVISOS = {
          activo: 'Ese contrato ya está ACTIVO y no se edita: los cambios van por anexo, ajuste de tarifa o renovación',
          firma_pendiente: 'Ese contrato tiene un enlace de firma abierto: retira el enlace desde el expediente y podrás editarlo',
        };
        const aviso = AVISOS[params.get('aviso') || ''];
        if (aviso) setTimeout(() => Toast.show(aviso, 'warn'), 300);
        if (id) await this.abrir(id, { push: false });
        else await this.cargarLista(true);
        // ?docs=1: el documento del contrato (contratos/documento.html) manda
        // aquí a ver el expediente legal — esa página es "papel" y no carga el
        // kit, así que el visor vive solo de este lado. Sin permiso no abre
        // nada: ahí el enlace ni se ofrece.
        if (id && params.get('docs') === '1' && this._puedeVerDocs()) this.verDocumentos();
      } catch (e) { console.error(e); Toast.show('Error al iniciar', 'bad'); }
    });
    window.addEventListener('popstate', () => {
      const id = new URLSearchParams(location.search).get('id');
      if (id) this.abrir(id, { push: false });
      else this.volver({ push: false });
    });
  },

  _wire() {
    document.getElementById('cgBuscar')?.addEventListener('input', (e) => {
      clearTimeout(this._debounce);
      this._debounce = setTimeout(() => { this.term = e.target.value.trim(); this.cargarLista(true); }, 250);
    });
    document.getElementById('btnMas')?.addEventListener('click', () => this.cargarLista(false));
    document.getElementById('fEqFiltro')?.addEventListener('input', () => this.pintarEquipos());
    // El bloque Actividad carga el historial la primera vez que se abre.
    document.getElementById('blkActividad')?.addEventListener('toggle', (e) => { if (e.target.open) this.cargarActividad(); });
    document.addEventListener('click', (e) => {
      if (e.target.closest('.cg-acts')) return;
      for (const id of ['cgMenu', 'cgMasMenu']) {
        const menu = document.getElementById(id);
        if (menu && !menu.classList.contains('hidden')) menu.classList.add('hidden');
      }
    });
  },
};
