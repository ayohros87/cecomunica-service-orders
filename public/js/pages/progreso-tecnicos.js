// @ts-nocheck
    let currentUser = null;
    let currentRole = null;
    let cacheUsuarios = []; // {uid, nombre, email, rol}
    let cacheProgreso = {}; // uid -> {semanal, mensual, total, mes, semana}

// 🔒 Restringir funciones interactivas si el usuario es técnico
function aplicarModoSoloLectura() {
  if (currentRole === 'tecnico' || currentRole === 'tecnico_operativo') {
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
    document.body.insertBefore(note, document.querySelector(".banner").nextSibling);
  }
}

    function formatStamp(){
      const d = new Date();
      const f = d.toISOString().slice(0,19).replace('T',' ');
      document.getElementById('stamp').textContent = 'Actualizado: ' + f;
    }

    function setPeriodoChip(value){
      const map = { semanal:'Semanal', mensual:'Mensual', total:'Total histórico' };
      document.getElementById('chipPeriodo').textContent = 'Periodo: ' + (map[value] || 'Mensual');
    }

    function canViewAll(role){
      // Admin y Recepción pueden ver todo; técnicos ven su propia fila + ranking sin info sensible
      return role === 'administrador' || role === 'recepcion';
    }

    function medalla(idx){
      if (idx === 0) return '🥇';
      if (idx === 1) return '🥈';
      if (idx === 2) return '🥉';
      return '';
    }

    function estadoVisual(p){
      // Pequeño “estado” a modo de ejemplo: si semanal>0 => en progreso
      if ((p?.semanal || 0) > 0) return '<span class="pill-warn">En progreso</span>';
      return '<span class="pill-ok">—</span>';
    }

    async function cargarUsuariosTecnicos(){
      const users = await UsuariosService.getUsuariosByRol(['tecnico', 'tecnico_operativo']);

      cacheUsuarios = users.map(u => ({
        uid: u.id,
        nombre: u.nombre || '',
        email : u.email || '',
        rol   : u.rol
      }));
    }

async function cargarProgresos(periodoSel = 'mensual') {
  // periodoSel: 'mensual' | 'semanal' | 'total'
  cacheProgreso = {};
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth()+1).padStart(2,'0');
  const yyyyMM = `${year}-${month}`;
  const isoWeek = getISOWeekKey(now);

  // Lee total (doc raíz) + subcolección del periodo
  const periodKey = periodoSel === 'mensual' ? yyyyMM : periodoSel === 'semanal' ? isoWeek : null;
  await Promise.all(cacheUsuarios.map(async u => {
    const stats = await UsuariosService.getTecnicoStats(u.uid, {
      periodo: periodKey ? periodoSel : null,
      periodoKey: periodKey,
    });
    cacheProgreso[u.uid] = stats;
  }));
}

function getISOWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}


    function renderTabla(periodo='mensual', filtro=''){
      const tbody = document.getElementById('tbodyRanking');
      tbody.innerHTML = '';

      // filtro simple por nombre/correo
      const needle = filtro.trim().toLowerCase();

      let rows = cacheUsuarios
        .filter(u => {
          if (!needle) return true;
          const txt = (u.nombre + ' ' + u.email).toLowerCase();
          return txt.includes(needle);
        })
        .map(u => {
          const p = cacheProgreso[u.uid] || {semanal:0, mensual:0, total:0};
          return {
            uid: u.uid,
            nombre: u.nombre || u.email || u.uid,
            email: u.email,
            semanal: p.semanal || 0,
            mensual: p.mensual || 0,
            total: p.total || 0,
            estado: estadoVisual(p)
          };
        });

      // ordenar por periodo
      rows.sort((a,b) => {
        if (periodo === 'semanal') return b.semanal - a.semanal;
        if (periodo === 'total')   return b.total - a.total;
        return b.mensual - a.mensual; // default: mensual
      });

      rows.forEach((r, idx) => {
        const m = medalla(idx);
        const isTop3 = idx < 3;
        const tr = document.createElement('tr');
        if (isTop3) tr.style.boxShadow = 'inset 2px 0 0 #22c55e';

        tr.innerHTML = `
        <td class="nowrap"><span class="rank-medal">${m}</span> ${idx + 1}</td>
        <td class="nowrap">${r.nombre}<br><span class="subtle">${r.email || ''}</span></td>
        <td class="nowrap">${r.semanal}</td>
        <td class="nowrap">${r.mensual}</td>
        <td class="nowrap">${r.total}</td>
        <td>${r.estado}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    async function cargarPantalla(periodo='mensual', filtro=''){
      // Permisos: si no es admin/recepcion, igual cargamos ranking pero mostramos mi bloque propio
      await cargarUsuariosTecnicos();
      await cargarProgresos(periodo); 
      renderTabla(periodo, filtro);
      setPeriodoChip(periodo);
      formatStamp();

      // Mis estadísticas (si soy técnico)
      if (currentRole === 'tecnico' || currentRole === 'tecnico_operativo') {
        const mine = cacheProgreso[currentUser.uid] || {semanal:0,mensual:0,total:0};
        document.getElementById('misStatsWrap').style.display = 'flex';
        document.getElementById('miSemanal').textContent = mine.semanal || 0;
        document.getElementById('miMensual').textContent = mine.mensual || 0;
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
      await cargarPantalla('mensual','');
      aplicarModoSoloLectura();
    });

    // UI handlers
    document.getElementById('btnRefrescar').addEventListener('click', async () => {
      const periodo = document.getElementById('selPeriodo').value || 'mensual';
      const filtro  = document.getElementById('buscarNombre').value || '';
      await cargarPantalla(periodo, filtro);
    });

    document.getElementById('selPeriodo').addEventListener('change', async (e) => {
      const filtro = document.getElementById('buscarNombre').value || '';
      await cargarPantalla(e.target.value, filtro);
    });

    document.getElementById('btnBuscar').addEventListener('click', async () => {
      const periodo = document.getElementById('selPeriodo').value || 'mensual';
      const filtro  = document.getElementById('buscarNombre').value || '';
      renderTabla(periodo, filtro);
    });

    document.getElementById('btnLimpiar').addEventListener('click', async () => {
      document.getElementById('buscarNombre').value = '';
      const periodo = document.getElementById('selPeriodo').value || 'mensual';
      renderTabla(periodo, '');
    });
