// @ts-nocheck
    let currentUser = null;
    let currentRole = null;
    let cacheUsuarios = []; // {uid, nombre, email, rol}
    let cacheProgreso = {}; // uid -> {total, count, ultima}

// 🔒 Restringir funciones interactivas si el usuario es técnico
function aplicarModoSoloLectura() {
  if (currentRole === ROLES.TECNICO || currentRole === ROLES.TECNICO_OPERATIVO) {
    // Desactivar búsqueda y botones
    document.getElementById('buscarNombre').disabled = true;
    document.getElementById('selPeriodo').disabled = true;
    document.getElementById('btnBuscar').disabled = true;
    document.getElementById('btnLimpiar').disabled = true;
    document.getElementById('btnRefrescar').disabled = true;

    // Atenuar visualmente los controles
    document.querySelectorAll('.btn, select, input').forEach(el => {
      el.style.opacity = '0.6';
      el.style.cursor = 'not-allowed';
    });

    // Mostrar una nota visual
    const note = document.createElement('div');
    note.textContent = "🔒 Modo lectura: solo puedes ver tu progreso y ranking general.";
    note.style.background = "#fef9c3";
    note.style.border = "1px solid #facc15";
    note.style.padding = "8px 12px";
    note.style.borderRadius = "8px";
    note.style.margin = "12px 0";
    note.style.fontSize = "14px";
    const anchor = document.querySelector(".alert-banner");
    if (anchor && anchor.parentNode) {
      anchor.parentNode.insertBefore(note, anchor.nextSibling);
    } else {
      document.body.insertBefore(note, document.body.firstChild);
    }
  }
}

    function formatStamp(){
      const d = new Date();
      const f = d.toISOString().slice(0,19).replace('T',' ');
      document.getElementById('stamp').textContent = 'Actualizado: ' + f;
    }

    // Mapeo periodo -> días de ventana móvil. `total` => null (histórico).
    const PERIODO_LABEL = {
      '7':'Últimos 7 días', '30':'Últimos 30 días',
      '90':'Últimos 90 días', 'total':'Total histórico'
    };
    function periodoDias(p){
      return p === '7' ? 7 : p === '30' ? 30 : p === '90' ? 90 : null;
    }

    function setPeriodoChip(value){
      document.getElementById('chipPeriodo').textContent =
        'Periodo: ' + (PERIODO_LABEL[value] || PERIODO_LABEL['7']);
    }

    // Muestra un mensaje de estado (cargando / error / vacío) ocupando la tabla.
    function setTablaMensaje(html){
      const tbody = document.getElementById('tbodyRanking');
      if (tbody) tbody.innerHTML =
        `<tr><td colspan="5" style="padding:24px; color:var(--fg-3);">${html}</td></tr>`;
    }

    function fmtUltima(d){
      if (!d) return '—';
      try { return d.toLocaleDateString('es-MX', { day:'2-digit', month:'short' }); }
      catch (_) { return '—'; }
    }

    function canViewAll(role){
      // Admin y Recepción pueden ver todo; técnicos ven su propia fila + ranking sin info sensible
      return role === ROLES.ADMIN || role === ROLES.RECEPCION;
    }

    function medalla(idx){
      if (idx === 0) return '🥇';
      if (idx === 1) return '🥈';
      if (idx === 2) return '🥉';
      return '';
    }

    async function cargarUsuariosTecnicos(){
      const users = await UsuariosService.getUsuariosByRol([ROLES.TECNICO, ROLES.TECNICO_OPERATIVO]);

      cacheUsuarios = users
        // Excluir técnicos desactivados del ranking. Convención del proyecto:
        // un usuario está activo cuando `activo !== false` (true o ausente).
        .filter(u => u.activo !== false)
        .map(u => ({
          uid: u.id,
          nombre: u.nombre || '',
          email : u.email || '',
          rol   : u.rol
        }));
    }

// Carga el conteo por ventana móvil (días) + el total histórico de cada técnico.
// Resuelve cada técnico por UID y por nombre, porque los docs de stats están
// mezclados: unos con clave UID (órdenes nuevas, con tecnico_uid) y otros con
// clave nombre (órdenes viejas sin UID). El trigger registra cada orden bajo una
// sola clave, así que sumar ambas no duplica.
async function cargarProgresos(dias) {
  cacheProgreso = {};
  const since = (dias != null) ? new Date(Date.now() - dias * 86400000) : null;

  // Dos lecturas en total, sin importar el número de técnicos:
  //  - totales históricos: una lectura de toda la colección raíz.
  //  - ventana móvil: una collection-group query sobre `eventos`.
  // Ambos mapas vienen claveados por id de doc (uid O nombre legacy).
  const [totals, winMap] = await Promise.all([
    UsuariosService.getAllTecnicoStats(),
    since ? UsuariosService.getEventosCountSince(since) : Promise.resolve(new Map()),
  ]);

  cacheUsuarios.forEach(u => {
    // Suma bajo ambas claves (uid + nombre legacy); el trigger registra cada
    // orden bajo una sola, así que no se duplica.
    const keys = [u.uid, u.nombre].filter(Boolean);
    const total = keys.reduce((s, k) => s + (totals.get(k) || 0), 0);
    let count = 0, ultima = null;
    keys.forEach(k => {
      const w = winMap.get(k);
      if (!w) return;
      count += w.count;
      if (w.ultima && (!ultima || w.ultima > ultima)) ultima = w.ultima;
    });
    cacheProgreso[u.uid] = { total, count, ultima };
  });
}

    function renderTabla(periodo='7', filtro=''){
      const tbody = document.getElementById('tbodyRanking');
      tbody.innerHTML = '';

      const esTotal = periodo === 'total';

      // filtro simple por nombre/correo
      const needle = filtro.trim().toLowerCase();

      let rows = cacheUsuarios
        .filter(u => {
          if (!needle) return true;
          const txt = (u.nombre + ' ' + u.email).toLowerCase();
          return txt.includes(needle);
        })
        .map(u => {
          const p = cacheProgreso[u.uid] || { total:0, count:0, ultima:null };
          return {
            uid: u.uid,
            nombre: u.nombre || u.email || u.uid,
            email: u.email,
            // métrica del ranking: en histórico = total; si no = conteo de la ventana
            metric: esTotal ? (p.total || 0) : (p.count || 0),
            total: p.total || 0,
            ultima: p.ultima || null,
          };
        });

      // ordenar por la métrica del periodo (desc); desempate por total
      rows.sort((a,b) => (b.metric - a.metric) || (b.total - a.total));

      const hayDatos = rows.some(r => r.metric > 0);
      if (!hayDatos) {
        tbody.innerHTML = `
          <tr><td colspan="5" style="padding:24px; color:var(--fg-3);">
            Sin órdenes completadas en ${PERIODO_LABEL[periodo] || 'este periodo'}.
          </td></tr>`;
        return;
      }

      rows.forEach((r, idx) => {
        const m = medalla(idx);
        const isTop3 = idx < 3 && r.metric > 0;
        const tr = document.createElement('tr');
        if (isTop3) tr.style.boxShadow = 'inset 2px 0 0 #22c55e';

        tr.innerHTML = `
        <td class="nowrap"><span class="rank-medal">${m}</span> ${idx + 1}</td>
        <td class="nowrap">${r.nombre}<br><span class="subtle">${r.email || ''}</span></td>
        <td class="nowrap"><strong>${r.metric}</strong></td>
        <td class="nowrap">${esTotal ? '—' : fmtUltima(r.ultima)}</td>
        <td class="nowrap">${r.total}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    async function cargarPantalla(periodo='7', filtro=''){
      // Permisos: si no es admin/recepcion, igual cargamos ranking pero mostramos mi bloque propio
      setTablaMensaje('Cargando…');
      await cargarUsuariosTecnicos();
      await cargarProgresos(periodoDias(periodo));
      renderTabla(periodo, filtro);
      setPeriodoChip(periodo);
      formatStamp();

      // Actualiza el encabezado de la columna métrica según el periodo
      const thMetric = document.getElementById('thMetric');
      if (thMetric) thMetric.textContent = (periodo === 'total') ? 'Total' : 'Órdenes (periodo)';

      // Mis estadísticas (si soy técnico)
      if (currentRole === ROLES.TECNICO || currentRole === ROLES.TECNICO_OPERATIVO) {
        const mine = cacheProgreso[currentUser.uid] || { total:0, count:0 };
        document.getElementById('misStatsWrap').style.display = 'flex';
        document.getElementById('miPeriodoLabel').textContent =
          'Mis órdenes · ' + (PERIODO_LABEL[periodo] || '');
        document.getElementById('miPeriodo').textContent = mine.count || 0;
        document.getElementById('miTotal').textContent = mine.total || 0;
      } else {
        document.getElementById('misStatsWrap').style.display = 'none';
      }
    }

    // Auth guard
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.href = '../login.html';
        return;
      }
      currentUser = user;
      const uDoc = await UsuariosService.getUsuario(user.uid);
      currentRole = uDoc ? (uDoc.rol || '') : '';

      // Todos pueden ver (técnico ve sus propios números + ranking general sin datos sensibles)
      try {
        await cargarPantalla('7','');
      } catch (e) {
        console.error('[progreso-tecnicos] carga falló', e);
        setTablaMensaje('No se pudo cargar el ranking: ' +
          (e?.message || e?.code || e) + '. Revisa la consola para más detalle.');
      }
      aplicarModoSoloLectura();
    });

    // Ejecuta una carga protegiendo la UI de fallos silenciosos.
    async function cargarSeguro(periodo, filtro){
      try {
        await cargarPantalla(periodo, filtro);
      } catch (e) {
        console.error('[progreso-tecnicos] carga falló', e);
        setTablaMensaje('No se pudo cargar el ranking: ' +
          (e?.message || e?.code || e) + '. Revisa la consola para más detalle.');
      }
    }

    // UI handlers
    document.getElementById('btnRefrescar').addEventListener('click', () => {
      const periodo = document.getElementById('selPeriodo').value || '7';
      const filtro  = document.getElementById('buscarNombre').value || '';
      cargarSeguro(periodo, filtro);
    });

    document.getElementById('selPeriodo').addEventListener('change', (e) => {
      const filtro = document.getElementById('buscarNombre').value || '';
      cargarSeguro(e.target.value, filtro);
    });

    document.getElementById('btnBuscar').addEventListener('click', async () => {
      const periodo = document.getElementById('selPeriodo').value || '7';
      const filtro  = document.getElementById('buscarNombre').value || '';
      renderTabla(periodo, filtro);
    });

    document.getElementById('btnLimpiar').addEventListener('click', async () => {
      document.getElementById('buscarNombre').value = '';
      const periodo = document.getElementById('selPeriodo').value || '7';
      renderTabla(periodo, '');
    });
