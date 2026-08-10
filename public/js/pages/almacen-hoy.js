/* =============================================================
   Almacén · Hoy — la bandeja unificada de trabajo de bodega.
   (Propuesta Almacén/Finanzas 2026-08, etapa E1.)

   Junta en una sola lista lo que antes vivía en dos páginas y
   seis señales del home:
     · De contratos (ColaInventarioService): seriales por asignar,
       cambios de serial, transiciones (si la cola está encendida).
     · Del pool: devueltos por inspeccionar, por clasificar,
       conflictos de ficha, sin verificar (deuda de migración).
     · De conteos: modelos con diferencia pool ≠ conteo (StockAgg).

   La bandeja RUTEA: cada ítem lleva a la pantalla donde ya se
   resuelve (contratos/seriales.html, equipos.html con deep-link).
   La bandeja vacía es el estado de éxito.
   ============================================================= */

window.AlmacenPage = {
  setTab(tab) {
    document.getElementById('tab-hoy').style.display = tab === 'hoy' ? '' : 'none';
    document.getElementById('tab-existencias').style.display = tab === 'existencias' ? '' : 'none';
    if (window.WorkspaceTabs) WorkspaceTabs.setActive(tab);
    // Existencias carga bajo demanda la primera vez (pool completo).
    if (tab === 'existencias' && window.AlmacenExistencias) AlmacenExistencias.activar();
    try {
      const url = new URL(location.href);
      if (tab === 'hoy') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
      history.replaceState(null, '', url);
    } catch { /* la pestaña cambió igual */ }
  },

  // "Recargar" del menú: refresca la pestaña que se está viendo.
  recargar() {
    const ex = document.getElementById('tab-existencias');
    if (ex && ex.style.display !== 'none' && window.AlmacenExistencias) return AlmacenExistencias.recargar();
    return AlmacenHoy.recargar();
  },
};

window.AlmacenHoy = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const EQUIPOS = '../inventario/equipos.html';
  const MAX_FILAS = 8;   // por grupo; el resto queda tras "ver todos"

  const ctx = { rol: '', datos: null };

  const $ = (id) => document.getElementById(id);

  // ── Presentación ──────────────────────────────────────────────────────
  function dias(ms) {
    if (!ms) return null;
    return Math.floor((Date.now() - ms) / 86400000);
  }

  function ageHtml(ms) {
    const d = dias(ms);
    if (d === null) return '';
    const txt = d === 0 ? 'hoy' : (d === 1 ? '1 día' : `${d} días`);
    const cls = d > 7 ? 'hy-age bad' : d > 3 ? 'hy-age warn' : 'hy-age';
    return `<span class="${cls}">${txt}</span>`;
  }

  function cta(href, icono, label) {
    return `<a class="btn btn-sm btn-accent hy-cta" href="${href}">
      <i data-lucide="${icono}" style="width:14px;height:14px;"></i> ${esc(label)}</a>`;
  }

  function fila({ chip, chipCls, txt, at, ctaHtml }) {
    return `<div class="hy-row">
      <span class="hy-chip hy-chip--${chipCls}">${esc(chip)}</span>
      <span class="hy-txt">${txt}</span>
      ${at ? ageHtml(at) : ''}
      ${ctaHtml || ''}
    </div>`;
  }

  function grupo(titulo, n, filasHtml, extraHtml = '') {
    if (!filasHtml && !extraHtml) return '';
    return `<div class="hy-grupo">
      <h3 class="hy-grupo-t">${esc(titulo)} <span class="hy-n">${n}</span></h3>
      ${filasHtml}${extraHtml}
    </div>`;
  }

  function conMas(filas, renderFila, hrefTodos, labelTodos) {
    const html = filas.slice(0, MAX_FILAS).map(renderFila).join('');
    const resto = filas.length - MAX_FILAS;
    const mas = resto > 0
      ? `<p class="hy-mas"><a href="${hrefTodos}">Ver ${labelTodos} (${filas.length}) →</a></p>` : '';
    return html + mas;
  }

  // ── Cargas ────────────────────────────────────────────────────────────
  async function contarSinVerificar() {
    const db = firebase.firestore();
    const probe = db.collection('equipos_pool').limit(1);
    if (typeof probe.count !== 'function') return null;
    const s = await db.collection('equipos_pool').where('verificado', '==', false).count().get();
    return s.data().count;
  }

  async function cargarConflictos() {
    // Subconjunto marcado por el failsafe de colisión — mismo predicado que la
    // cola "Conflictos" de equipos.html (≥2 fichas del mismo serial_norm y no
    // todas revisadas).
    const db = firebase.firestore();
    const snap = await db.collection('equipos_pool')
      .where('serial_compartido', '==', true).limit(300).get();
    const porNorm = new Map();
    snap.docs.forEach(d => {
      const eq = { id: d.id, ...d.data() };
      const k = eq.serial_norm || (eq.id || '').split('__')[0];
      if (!porNorm.has(k)) porNorm.set(k, []);
      porNorm.get(k).push(eq);
    });
    const grupos = [];
    for (const [norm, docs] of porNorm) {
      if (docs.length < 2) continue;
      if (docs.every(d => d.conflicto_revisado === true)) continue;
      grupos.push({ norm, docs });
    }
    return grupos.sort((a, b) => a.norm.localeCompare(b.norm));
  }

  async function cargarDiferencias() {
    const [modelos, conteos, poolMap] = await Promise.all([
      ModelosService.getModelos(),
      InventarioService.getInventarioActual(),
      EquiposPoolService.contarBodegaPorModelo(),
    ]);
    return StockAgg.diferencias(StockAgg.build({ modelos, conteos, poolMap }));
  }

  async function cargar() {
    const loader = $('loader');
    if (loader) loader.style.display = '';
    try {
      // Cada carga cae por su lado: un permiso o índice roto no tumba la bandeja
      // — se muestra lo que sí se pudo leer y se avisa del hueco (null = falló).
      const [colas, devueltos, clasificar, conflictos, sinVerificarN, difs] = await Promise.all([
        ColaInventarioService.todo(),
        EquiposPoolService.listar({ estado: 'devuelto_revision' }).catch(e => { console.warn('[Hoy] devueltos:', e?.code || e); return null; }),
        EquiposPoolService.listar({ estado: 'por_clasificar' }).catch(e => { console.warn('[Hoy] clasificar:', e?.code || e); return null; }),
        cargarConflictos().catch(e => { console.warn('[Hoy] conflictos:', e?.code || e); return null; }),
        contarSinVerificar().catch(e => { console.warn('[Hoy] sin verificar:', e?.code || e); return null; }),
        cargarDiferencias().catch(e => { console.warn('[Hoy] diferencias:', e?.code || e); return null; }),
      ]);
      ctx.datos = { colas, devueltos, clasificar, conflictos, sinVerificarN, difs };
      render();
    } catch (e) {
      console.error('[Hoy] no se pudo cargar:', e);
      if (typeof Toast !== 'undefined') Toast.show('No se pudo cargar la bandeja.', 'bad');
    } finally {
      if (loader) loader.style.display = 'none';
    }
  }

  // ── Render ────────────────────────────────────────────────────────────
  function filaContrato(r) {
    const cfgs = {
      seriales: { chip: 'Seriales', cls: 'seriales', icono: 'scan-barcode', cta: 'Asignar seriales', href: `../contratos/seriales.html?id=${encodeURIComponent(r.doc_id)}` },
      cambio: { chip: 'Cambio', cls: 'cambio', icono: 'replace', cta: 'Reemplazar', href: `../contratos/seriales.html?id=${encodeURIComponent(r.doc_id)}` },
      transicion: { chip: 'Transición', cls: 'transicion', icono: 'arrow-left-right', cta: 'Registrar', href: `../contratos/transicion.html?id=${encodeURIComponent(r.doc_id)}` },
    };
    const c = cfgs[r.tipo];
    let detalle = '';
    if (r.tipo === 'cambio') {
      const items = (r.cambio?.items || []).map(i => `<span class="hy-eq"><b>${esc(i.serial || '—')}</b>${i.modelo ? ` · ${esc(i.modelo)}` : ''}</span>`).join('');
      const motivo = r.cambio?.motivo_tipo || r.cambio?.motivo || '';
      detalle = ` — ${items}${motivo ? ` <span style="color:var(--fg-3);">${esc(motivo)}</span>` : ''}`;
    } else {
      detalle = ` — ${r.resueltos}/${r.unidades} unidades`;
    }
    return fila({
      chip: c.chip, chipCls: c.cls,
      txt: `<b>${esc(r.contrato_id)}</b> · ${esc(r.cliente_nombre)}${detalle}`,
      at: r.at,
      ctaHtml: cta(c.href, c.icono, c.cta),
    });
  }

  function render() {
    const d = ctx.datos;
    if (!d) return;
    const partes = [];
    const fallidas = [...(d.colas?.fallidas || [])];
    let total = 0;

    // ── De contratos ──
    const colas = d.colas || { seriales: [], cambios: [], transiciones: [] };
    const deContratos = [...colas.seriales, ...colas.cambios, ...colas.transiciones]
      .sort((a, b) => a.at - b.at);
    total += deContratos.length;
    let notaTransicion = '';
    if (!ColaInventarioService.COLA_TRANSICIONES_ACTIVA && ctx.rol === ROLES.ADMIN) {
      notaTransicion = `<p class="hy-nota">Cola de transiciones apagada (atraso histórico sin triar) —
        se enciende en <code>colaInventarioService.js</code>; la mayoría de casos nuevos se
        auto-registra al confirmar la entrega.</p>`;
    }
    // Sin tope: esta bandeja ES la superficie primaria de estas colas.
    partes.push(grupo('De contratos', deContratos.length,
      deContratos.map(filaContrato).join(''),
      notaTransicion));

    // ── Del pool ──
    let poolHtml = '';
    let poolN = 0;

    if (d.devueltos === null) fallidas.push('devueltos');
    else if (d.devueltos.length) {
      poolN += d.devueltos.length;
      const filas = [...d.devueltos].sort((a, b) => (a.updated_at?.toMillis?.() || 0) - (b.updated_at?.toMillis?.() || 0));
      poolHtml += conMas(filas, (eq) => fila({
        chip: 'Inspección', chipCls: 'inspeccion',
        txt: `<b>${esc(eq.serial || eq.serial_norm)}</b> · ${esc(eq.modelo_label || 'sin modelo')}`
          + (eq.asignacion?.cliente_nombre ? ` — de ${esc(eq.asignacion.cliente_nombre)}` : ''),
        at: eq.updated_at?.toMillis?.() || null,
        ctaHtml: cta(`${EQUIPOS}?serial=${encodeURIComponent(eq.serial || eq.serial_norm)}`, 'search-check', 'Revisar'),
      }), `${EQUIPOS}?tab=devuelto_revision`, 'devueltos');
    }

    if (d.clasificar === null) fallidas.push('por clasificar');
    else if (d.clasificar.length) {
      // Agrupado por modelo: la acción (salir a buscarlos / corregir a bodega)
      // se hace por lote en Equipos por serial.
      const porModelo = new Map();
      d.clasificar.forEach(eq => {
        const k = eq.modelo_label || 'Sin modelo';
        porModelo.set(k, (porModelo.get(k) || 0) + 1);
      });
      poolN += d.clasificar.length;
      poolHtml += [...porModelo.entries()].map(([modelo, n]) => fila({
        chip: 'Clasificar', chipCls: 'clasificar',
        txt: `<b>${esc(modelo)}</b> — ${n} ${n === 1 ? 'unidad' : 'unidades'} sin ubicación conocida`,
        ctaHtml: cta(`${EQUIPOS}?tab=por_clasificar`, 'map-pin', 'Clasificar'),
      })).join('');
    }

    if (d.conflictos === null) fallidas.push('conflictos');
    else if (d.conflictos.length) {
      poolN += d.conflictos.length;
      poolHtml += conMas(d.conflictos, (g) => fila({
        chip: 'Conflicto', chipCls: 'conflicto',
        txt: `<b>${esc(g.norm)}</b> — ${g.docs.length} fichas: ${esc(g.docs.map(x => x.modelo_label || '¿?').join(' ↔ '))}`,
        ctaHtml: cta(`${EQUIPOS}?tab=conflictos`, 'git-merge', 'Resolver'),
      }), `${EQUIPOS}?tab=conflictos`, 'conflictos');
    }

    total += poolN;
    let notaVerificar = '';
    if (d.sinVerificarN) {
      // Deuda de migración, no trabajo del día: se muestra pero NO suma al badge.
      notaVerificar = `<p class="hy-nota">${d.sinVerificarN.toLocaleString()} fichas de migración sin verificar
        (deuda, no trabajo del día) — <a href="${EQUIPOS}?tab=todos&verificar=1">revisar por lotes →</a></p>`;
    }
    partes.push(grupo('Del pool', poolN, poolHtml, notaVerificar));

    // ── De conteos ──
    if (d.difs === null) fallidas.push('diferencias de conteo');
    const difs = d.difs || [];
    total += difs.length;
    partes.push(grupo('De conteos', difs.length,
      conMas(difs, (f) => fila({
        chip: 'Diferencia', chipCls: 'diferencia',
        txt: `<b>${esc(f.modelo?.modelo || f.label)}</b> — pool ${f.seriales} vs conteo ${f.conteo} (${f.dif > 0 ? '+' : ''}${f.dif})`,
        at: f.data?.ultima_actualizacion?.toMillis?.() || null,
        ctaHtml: cta(`${EQUIPOS}?tab=en_bodega${f.modelo_id ? `&modelo=${encodeURIComponent(f.modelo_id)}` : ''}`, 'diff', 'Revisar'),
      }), '../inventario/index.html', 'el tablero'),
    ));

    // ── Pintado ──
    const cont = $('hoyGrupos');
    const vacio = $('hoyVacio');
    const html = partes.filter(Boolean).join('');
    if (total === 0) {
      cont.innerHTML = '';
      vacio.style.display = '';
    } else {
      vacio.style.display = 'none';
      cont.innerHTML = html;
    }

    const aviso = $('avisoFallidas');
    if (aviso) {
      if (fallidas.length) {
        aviso.style.display = '';
        aviso.innerHTML = `<i data-lucide="alert-triangle"></i> No se pudo leer: <b>${esc(fallidas.join(', '))}</b>. Lo que ves está incompleto.`;
      } else {
        aviso.style.display = 'none';
      }
    }

    if (window.WorkspaceTabs) WorkspaceTabs.setBadge('hoy', total);
    // El badge del rail conserva su semántica (solo colas de contratos, igual
    // que contarParaBadge): se sincroniza con lo que se acaba de leer.
    ColaInventarioService.refrescarBadge(colas.seriales.length + colas.cambios.length);

    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function recargar() { return cargar(); }

  // ── Entry ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', () => {
    verificarAccesoYAplicarVisibilidad(init);
  });

  function init(rol) {
    ctx.rol = rol;
    // EquipoFicha decide su footer ("Abrir en Inventario") con window.userRole.
    window.userRole = rol;
    // Mismo criterio que las páginas del área: operan admin/inventario, lee
    // gerencia; y quien puede gestionar seriales (recepción/vendedor) puede
    // ver su cola aquí igual que podía en la bandeja vieja.
    const ok = rol === ROLES.ADMIN || rol === ROLES.INVENTARIO || rol === ROLES.GERENTE
      || (typeof canRole === 'function' && canRole(rol, 'gestionar-seriales'));
    if (!ok) {
      const body = $('bodyAlmacen');
      if (body) {
        body.innerHTML = `<div class="ds-card ds-card-padded" style="text-align:center; color:var(--fg-3);">
          Esta área es de administración e inventario. <a href="../index.html">Volver al inicio</a></div>`;
      }
      const loader = $('loader');
      if (loader) loader.style.display = 'none';
      return;
    }

    // La barra de pestañas y el deep-link ?tab= se resuelven en el parse
    // (scripts inline de la página) para que nada brinque; aquí solo se
    // dispara la carga de datos de la pestaña que quedó visible.
    const ex = document.getElementById('tab-existencias');
    if (ex && ex.style.display !== 'none' && window.AlmacenExistencias) {
      AlmacenExistencias.activar();
    }
    cargar();
  }

  return { recargar, render };
})();
