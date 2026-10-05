// Expone: window.AdminUso
// Depende de: window.firebase, window.ROLES, window.Toast, window.Icons
//
// Admin · Uso del app (2026-09-30). Lee uso_diario/{YYYY-MM-DD} (lo escribe
// firebase-init en cada página vista con sesión) y arma tres vistas: páginas
// vistas por día, pantallas más usadas y uso por usuario. Solo admin: las
// reglas de uso_diario no dejan leer a nadie más.
window.AdminUso = (() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = (n) => Number(n || 0).toLocaleString('es-PA');
  const hoyPanama = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Panama' });
  const diaMenos = (iso, n) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };

  let _nombres = null;
  async function nombres() {
    if (_nombres) return _nombres;
    const snap = await firebase.firestore().collection('usuarios').get();
    _nombres = new Map(snap.docs.map((d) => [d.id, d.data().nombre || d.data().email || d.id]));
    return _nombres;
  }

  async function cargar() {
    const dias = Number($('selRango').value || 30);
    const hasta = hoyPanama();
    const desde = diaMenos(hasta, dias - 1);
    $('usoResumen').textContent = 'Cargando…';
    const FP = firebase.firestore.FieldPath;
    const [snap, mapaNombres] = await Promise.all([
      firebase.firestore().collection('uso_diario')
        .where(FP.documentId(), '>=', desde).where(FP.documentId(), '<=', hasta).get(),
      nombres().catch(() => new Map()),
    ]);

    const porDia = new Map();
    const porPagina = new Map();    // slug → {vistas, usuarios:Set}
    const porUsuario = new Map();   // uid → {vistas, paginas:Map}
    snap.docs.forEach((doc) => {
      const d = doc.data() || {};
      let totalDia = 0;
      Object.entries(d.paginas || {}).forEach(([slug, n]) => {
        totalDia += Number(n || 0);
        const p = porPagina.get(slug) || { vistas: 0, usuarios: new Set() };
        p.vistas += Number(n || 0);
        porPagina.set(slug, p);
      });
      porDia.set(doc.id, totalDia);
      Object.entries(d.usuarios || {}).forEach(([uid, pags]) => {
        const u = porUsuario.get(uid) || { vistas: 0, paginas: new Map() };
        Object.entries(pags || {}).forEach(([slug, n]) => {
          u.vistas += Number(n || 0);
          u.paginas.set(slug, (u.paginas.get(slug) || 0) + Number(n || 0));
          porPagina.get(slug)?.usuarios.add(uid);
        });
        porUsuario.set(uid, u);
      });
    });

    // Por día (incluye los días sin datos, en cero).
    const serie = [];
    for (let i = dias - 1; i >= 0; i--) { const k = diaMenos(hasta, i); serie.push([k, porDia.get(k) || 0]); }
    const maxDia = Math.max(1, ...serie.map(([, n]) => n));
    $('usoDias').innerHTML = serie.map(([k, n]) =>
      `<div style="height:${Math.round((n / maxDia) * 100)}%" title="${esc(k)}: ${fmt(n)} vistas"></div>`).join('');

    const total = serie.reduce((s, [, n]) => s + n, 0);
    $('usoResumen').textContent = `${fmt(total)} páginas vistas · ${fmt(porUsuario.size)} usuarios · ${desde} a ${hasta}`;

    // Pantallas.
    const paginas = [...porPagina].sort((a, b) => b[1].vistas - a[1].vistas);
    const maxPag = Math.max(1, ...paginas.map(([, p]) => p.vistas));
    $('usoPaginas').innerHTML = paginas.length
      ? `<table><thead><tr><th>Pantalla</th><th class="num">Vistas</th><th class="num">Usuarios</th><th style="width:30%"></th></tr></thead><tbody>
        ${paginas.map(([slug, p]) => `<tr><td>${esc(slug)}</td><td class="num">${fmt(p.vistas)}</td><td class="num">${fmt(p.usuarios.size)}</td>
          <td><div class="uso-barra" style="width:${Math.round((p.vistas / maxPag) * 100)}%"></div></td></tr>`).join('')}
        </tbody></table>`
      : '<div class="uso-vacio">Todavía no hay datos en este rango. Se empezó a contar el 30 de septiembre de 2026.</div>';

    pintarIntentos(desde, mapaNombres).catch((e) => {
      console.error('[admin/uso] intentos', e);
      $('usoIntentos').innerHTML = '<div class="uso-vacio">No se pudieron cargar los intentos.</div>';
    });

    // Usuarios.
    const usuarios = [...porUsuario].sort((a, b) => b[1].vistas - a[1].vistas);
    $('usoUsuarios').innerHTML = usuarios.length
      ? `<table><thead><tr><th>Usuario</th><th class="num">Vistas</th><th>Pantallas principales</th></tr></thead><tbody>
        ${usuarios.map(([uid, u]) => {
          const top = [...u.paginas].sort((a, b) => b[1] - a[1]).slice(0, 3)
            .map(([s, n]) => `${esc(s)} (${fmt(n)})`).join(' · ');
          return `<tr><td>${esc(mapaNombres.get(uid) || uid)}</td><td class="num">${fmt(u.vistas)}</td><td style="font-size:12px;">${top}</td></tr>`;
        }).join('')}
        </tbody></table>`
      : '<div class="uso-vacio">Sin datos en este rango.</div>';
  }

  // Envíos frenados o fallidos (intentos_fallidos, 2026-10-05): lo que un
  // vendedor creyó enviar y no se guardó, con el motivo exacto.
  async function pintarIntentos(desde, mapaNombres) {
    const snap = await firebase.firestore().collection('intentos_fallidos')
      .where('fecha', '>=', desde).orderBy('fecha', 'desc').limit(200).get();
    const filas = snap.docs.map((d) => d.data())
      .sort((a, b) => (b.at?.toMillis?.() || 0) - (a.at?.toMillis?.() || 0));
    const hora = (t) => t?.toDate ? t.toDate().toLocaleString('es-PA', { timeZone: 'America/Panama', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    $('usoIntentos').innerHTML = filas.length
      ? `<table><thead><tr><th>Cuándo</th><th>Quién</th><th>Trámite</th><th>Cliente</th><th>Qué pasó</th></tr></thead><tbody>
        ${filas.map((f) => `<tr>
          <td style="white-space:nowrap;">${esc(hora(f.at) || f.fecha)}</td>
          <td>${esc(mapaNombres.get(f.uid) || f.email || f.uid)}</td>
          <td>${esc(f.etiqueta || f.accion)}</td>
          <td>${f.cliente_id ? `<a href="../clientes/centro.html?id=${encodeURIComponent(f.cliente_id)}">${esc(f.cliente_nombre || f.cliente_id)}</a>` : '—'}</td>
          <td style="font-size:12.5px;">${f.resultado === 'error' ? '<b style="color:#991B1B;">Error</b> · ' : ''}${(f.mensajes || []).map(esc).join(' · ')}${f.error ? `<div class="ts">${esc(f.error)}</div>` : ''}</td>
        </tr>`).join('')}
        </tbody></table>`
      : '<div class="uso-vacio">Ningún envío frenado en este rango.</div>';
  }

  function init() {
    verificarAccesoYAplicarVisibilidad((rol) => {
      if (rol !== ROLES.ADMIN) {
        if (window.Toast) Toast.show('Acceso restringido a administradores.', 'bad');
        setTimeout(() => { location.href = '../index.html'; }, 1200);
        return;
      }
      $('selRango').addEventListener('change', () => cargar().catch(fallo));
      cargar().catch(fallo);
    });
  }
  function fallo(e) {
    console.error('[admin/uso]', e);
    $('usoResumen').textContent = 'No se pudo cargar el uso.';
    if (window.Toast) Toast.show('No se pudo cargar el uso del app.', 'bad');
  }

  document.addEventListener('DOMContentLoaded', init);
  return { cargar };
})();
