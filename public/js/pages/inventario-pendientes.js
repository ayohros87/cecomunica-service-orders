/* =============================================================
   Pendientes de inventario — bandeja de trabajo de bodega.

   El rol `inventario` no tiene el módulo Contratos, pero tres de
   sus colas nacen dentro de un contrato y solo le llegaban por
   correo. Esta página las junta mostrando ÚNICAMENTE lo operativo
   —contrato, cliente, modelos, cantidades, progreso, antigüedad—
   sin precios ni condiciones comerciales. La proyección la hace
   ColaInventarioService (js/services/colaInventarioService.js).

   Los CTA llevan a las páginas que ya existen y que ya están
   gateadas por el permiso 'gestionar-seriales' (seriales.html y
   transicion.html, bajo /contratos/ pero con el rail y el "Volver"
   reescritos a Inventario para este rol).
   ============================================================= */

window.ColaInventario = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const COLAS = {
    seriales: {
      label: 'Seriales por asignar', sub: 'contratos aprobados', icon: 'scan-barcode',
      cta: 'Asignar seriales', ctaIcon: 'scan-barcode',
      href: (r) => `../contratos/seriales.html?id=${encodeURIComponent(r.doc_id)}`,
      vacio: 'Ningún contrato está esperando seriales.',
    },
    cambio: {
      label: 'Cambios de serial', sub: 'reemplazo solicitado', icon: 'replace',
      cta: 'Reemplazar', ctaIcon: 'replace',
      href: (r) => `../contratos/seriales.html?id=${encodeURIComponent(r.doc_id)}`,
      vacio: 'No hay solicitudes de cambio de serial.',
    },
    transicion: {
      label: 'Transiciones', sub: 'renovación o reemplazo sin registrar', icon: 'arrow-left-right',
      cta: 'Registrar transición', ctaIcon: 'arrow-left-right',
      href: (r) => `../contratos/transicion.html?id=${encodeURIComponent(r.doc_id)}`,
      vacio: 'No hay transiciones de equipo sin registrar.',
    },
  };

  const ctx = { datos: null, cola: '', rol: '' };

  const $ = (id) => document.getElementById(id);

  // ── Helpers de presentación ───────────────────────────────────────────
  function dias(at) {
    if (!at) return null;
    return Math.floor((Date.now() - at) / 86400000);
  }

  // La antigüedad es el dato que convierte una lista en una cola: se colorea
  // igual que los backlogs del resto del sistema (ámbar > 3 días, rojo > 7).
  function esperandoHtml(at) {
    const d = dias(at);
    if (d === null) return '<span style="color:var(--fg-3);">—</span>';
    const txt = d === 0 ? 'hoy' : (d === 1 ? '1 día' : `${d} días`);
    let css = 'color:var(--fg-3);';
    if (d > 7) css = 'color:#991B1B;font-weight:600;';
    else if (d > 3) css = 'color:#92400E;font-weight:600;';
    return `<span style="${css}">${txt}</span>`;
  }

  function equiposHtml(row) {
    if (row.tipo === 'cambio') {
      const items = row.cambio?.items || [];
      if (!items.length) return '<span style="color:var(--fg-3);">—</span>';
      return items.map(i =>
        `<span class="pi-eq"><b>${esc(i.serial || '—')}</b>${i.modelo ? ` · ${esc(i.modelo)}` : ''}</span>`
      ).join(' ');
    }
    if (!row.equipos.length) return '<span style="color:var(--fg-3);">—</span>';
    return row.equipos.map(e =>
      `<span class="pi-eq">${esc(e.modelo)} <b>×${e.cantidad}</b></span>`
    ).join(' ');
  }

  function progresoHtml(row) {
    if (row.tipo === 'cambio') {
      const motivo = row.cambio?.motivo_tipo || row.cambio?.motivo || '';
      return motivo
        ? `<span class="pi-motivo" title="Motivo de la solicitud">${esc(motivo)}</span>`
        : '<span style="color:var(--fg-3);">—</span>';
    }
    if (row.tipo === 'transicion') return '<span style="color:var(--fg-3);">—</span>';
    const { resueltos, unidades } = row;
    const completo = unidades > 0 && resueltos >= unidades;
    const css = completo
      ? 'background:#ECFDF5;color:#065F46;border:1px solid #A7F3D0;'
      : (resueltos === 0
        ? 'background:#FEF3C7;color:#92400E;border:1px solid #FDE68A;'
        : 'background:#EFF6FF;color:#1E3A8A;border:1px solid #93C5FD;');
    return `<span class="pi-prog" style="${css}">${resueltos}/${unidades}</span>`;
  }

  function filaHtml(row) {
    const cfg = COLAS[row.tipo];
    return `
<tr>
  <td><b>${esc(row.contrato_id)}</b></td>
  <td>${esc(row.cliente_nombre)}</td>
  <td><span class="pi-accion">${esc(row.accion)}</span></td>
  <td>${equiposHtml(row)}</td>
  <td style="text-align:center;">${progresoHtml(row)}</td>
  <td style="text-align:center;">${esperandoHtml(row.at)}</td>
  <td class="pi-cta">
    <a class="btn btn-sm btn-accent" href="${cfg.href(row)}" title="${esc(cfg.cta)}">
      <i data-lucide="${cfg.ctaIcon}" style="width:14px;height:14px;"></i> ${esc(cfg.cta)}
    </a>
  </td>
</tr>`;
  }

  // ── Render ────────────────────────────────────────────────────────────
  function filasVisibles() {
    const d = ctx.datos;
    if (!d) return [];
    if (ctx.cola) return d[_clave(ctx.cola)] || [];
    return [...d.seriales, ...d.cambios, ...d.transiciones].sort((a, b) => a.at - b.at);
  }

  // La cola 'cambio' se guarda como `cambios` y 'transicion' como
  // `transiciones` (plurales del servicio); el resto coincide.
  function _clave(cola) {
    return { seriales: 'seriales', cambio: 'cambios', transicion: 'transiciones' }[cola] || cola;
  }

  // La tarjeta de transiciones se oculta mientras la cola esté apagada en el
  // servicio (COLA_TRANSICIONES_ACTIVA). Ocultar y no borrar: encenderla es
  // cambiar un booleano, no reconstruir la pantalla.
  function aplicarColasActivas() {
    if (ColaInventarioService.COLA_TRANSICIONES_ACTIVA) return;
    const card = document.querySelector('.pi-cola[data-cola="transicion"]');
    if (card) card.style.display = 'none';
    if (ctx.cola === 'transicion') ctx.cola = '';
  }

  function pintarColas() {
    const d = ctx.datos || { seriales: [], cambios: [], transiciones: [] };
    const n = { seriales: d.seriales.length, cambio: d.cambios.length, transicion: d.transiciones.length };
    Object.keys(COLAS).forEach(k => {
      const el = $(`cola-${k}`);
      if (el) el.textContent = String(n[k]);
      const card = document.querySelector(`.pi-cola[data-cola="${k}"]`);
      if (card) {
        card.classList.toggle('is-vacia', !n[k]);
        card.classList.toggle('is-active', ctx.cola === k);
      }
    });
    const todas = $('cola-todas');
    if (todas) todas.textContent = String(n.seriales + n.cambio + n.transicion);
    const cardTodas = document.querySelector('.pi-cola[data-cola=""]');
    if (cardTodas) cardTodas.classList.toggle('is-active', !ctx.cola);
  }

  function render() {
    pintarColas();
    const filas = filasVisibles();
    const tbody = $('tablaPendientes');
    const vacio = $('estadoVacio');
    const wrap = $('wrapTabla');
    if (!tbody) return;

    if (!filas.length) {
      wrap.style.display = 'none';
      vacio.style.display = '';
      vacio.innerHTML = ctx.cola
        ? `<i data-lucide="check-circle-2"></i><p>${esc(COLAS[ctx.cola].vacio)}</p>`
        : `<i data-lucide="check-circle-2"></i><p>Nada pendiente. Bodega al día.</p>`;
    } else {
      vacio.style.display = 'none';
      wrap.style.display = '';
      tbody.innerHTML = filas.map(filaHtml).join('');
    }

    const resumen = $('resumenPendientes');
    if (resumen) {
      const total = filasVisibles().length;
      resumen.textContent = total === 1 ? '1 pendiente' : `${total} pendientes`;
    }
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function setCola(cola) {
    ctx.cola = (ctx.cola === cola) ? '' : cola;
    render();
  }

  // ── Carga ─────────────────────────────────────────────────────────────
  async function cargar() {
    const loader = $('loader');
    if (loader) loader.style.display = '';
    aplicarColasActivas();
    try {
      ctx.datos = await ColaInventarioService.todo();
      const aviso = $('avisoFallidas');
      if (aviso) {
        if (ctx.datos.fallidas.length) {
          aviso.style.display = '';
          aviso.innerHTML = `<i data-lucide="alert-triangle"></i> No se pudo leer: <b>${esc(ctx.datos.fallidas.join(', '))}</b>. Lo que ves está incompleto.`;
        } else {
          aviso.style.display = 'none';
        }
      }
      // El badge del rail cuenta solo seriales + cambios (ver el servicio):
      // se sincroniza con lo que la bandeja acaba de leer.
      ColaInventarioService.refrescarBadge(ctx.datos.seriales.length + ctx.datos.cambios.length);
      render();
    } catch (e) {
      console.error('[Pendientes] no se pudo cargar:', e);
      if (typeof Toast !== 'undefined') Toast.show('No se pudieron cargar los pendientes.', 'bad');
    } finally {
      if (loader) loader.style.display = 'none';
    }
  }

  // Devuelve la promesa a propósito: el botón la ignora, pero deja la carga
  // esperable desde fuera (tests, y cualquier futura recarga encadenada).
  function recargar() { return cargar(); }

  // ── Entry ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad(init);
  });

  function init(rol) {
    ctx.rol = rol;
    // Mismo permiso que las páginas a las que lleva la bandeja: si no puedes
    // gestionar seriales, esta cola no es tuya.
    if (!canRole(rol, 'gestionar-seriales')) {
      const body = $('bodyPendientes');
      if (body) {
        body.innerHTML = `<div class="ds-card ds-card-padded" style="text-align:center; color:var(--fg-3);">
          Acceso restringido. No tienes permiso para trabajar esta cola.</div>`;
      }
      const loader = $('loader');
      if (loader) loader.style.display = 'none';
      return;
    }
    cargar();
  }

  return { setCola, recargar, render };
})();
