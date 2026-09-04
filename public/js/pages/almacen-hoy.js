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
  setTab(tab, extra = {}) {
    ['hoy', 'asignar', 'existencias'].forEach(t => {
      const el = document.getElementById('tab-' + t);
      if (el) el.style.display = t === tab ? '' : 'none';
    });
    if (window.WorkspaceTabs) WorkspaceTabs.setActive(tab);
    // Existencias y Asignar cargan bajo demanda la primera vez.
    if (tab === 'existencias' && window.AlmacenExistencias) AlmacenExistencias.activar();
    if (tab === 'asignar' && window.AlmacenAsignar) AlmacenAsignar.activar(extra);
    try {
      const url = new URL(location.href);
      if (tab === 'hoy') url.searchParams.delete('tab'); else url.searchParams.set('tab', tab);
      if (tab !== 'asignar') { url.searchParams.delete('contrato'); url.searchParams.delete('g'); }
      history.replaceState(null, '', url);
    } catch { /* la pestaña cambió igual */ }
  },

  // Desde Hoy (y desde cualquier <a data-asignar>): abrir la pestaña Asignar
  // con un contrato o una gestión, sin recargar la página.
  abrirAsignar({ contrato = null, g = null } = {}) {
    AlmacenPage.setTab('asignar', { contrato, g });
  },

  // "Recargar" del menú: refresca la pestaña que se está viendo.
  recargar() {
    const visible = (id) => { const el = document.getElementById(id); return el && el.style.display !== 'none'; };
    if (visible('tab-existencias') && window.AlmacenExistencias) return AlmacenExistencias.recargar();
    if (visible('tab-asignar') && window.AlmacenAsignar) return AlmacenAsignar.recargar();
    return AlmacenHoy.recargar();
  },

  recargarTodo() {
    AlmacenHoy.recargar();
    if (window.AlmacenExistencias) AlmacenExistencias.refrescarSiCargado();
  },

  // Asistentes (Fase B): componentes propios del espacio. Mientras alguno no
  // esté cargado (transición), cae al deep-link de la página de Equipos.
  abrirConteo() {
    if (!window.AsistenteConteo) { location.href = '../inventario/cargar-inventario.html?volver=almacen'; return; }
    AsistenteConteo.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
  abrirRecibir() {
    if (!window.AsistenteRecibir) { location.href = '../inventario/equipos.html?accion=recibir&volver=almacen'; return; }
    AsistenteRecibir.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
  // Importar la hoja de bodega tal cual llega. Es la vía principal de un conteo:
  // "Recibir equipos" queda para el alta suelta de dos o tres seriales.
  abrirImportar() {
    if (!window.AsistenteImportar) { AlmacenPage.abrirRecibir(); return; }
    AsistenteImportar.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
  abrirVenta() {
    if (!window.AsistenteVenta) { location.href = '../inventario/equipos.html?accion=vender&volver=almacen'; return; }
    AsistenteVenta.abrir({ user: firebase.auth().currentUser, onDone: () => AlmacenPage.recargarTodo() });
  },
};

window.AlmacenHoy = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const EQUIPOS = '../inventario/equipos.html';
  const MAX_FILAS = 8;   // por grupo; el resto queda tras "ver todos"

  // Todo link que sale de la bandeja lleva ?volver=almacen: el topbar de la
  // página destino (layout.js) lo convierte en un "Volver" que regresa AQUÍ
  // y no al módulo histórico de esa página.
  const vol = (url) => url + (url.includes('?') ? '&' : '?') + 'volver=almacen';

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

  // CTA que abre la pestaña Asignar de ESTA página (sin recargar). El href
  // sigue siendo un deep-link real para "abrir en otra pestaña".
  function ctaAsignar({ contrato = null, g = null }, icono, label) {
    const q = contrato ? `contrato=${encodeURIComponent(contrato)}` : `g=${encodeURIComponent(g)}`;
    return `<a class="btn btn-sm btn-accent hy-cta" href="index.html?tab=asignar&${q}" data-asignar
       data-contrato="${esc(contrato || '')}" data-g="${esc(g || '')}">
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

  // Gestiones esperando a BODEGA (brecha Ola 6, caso GA20260828-01 de
  // C COMUNICA 2026-08-28: el aumento firmado quedó en pendiente_bodega y la
  // bandeja no lo mostraba — bodega solo se enteraba por el correo):
  //   · aumento en 'pendiente_firma' sin seriales completos (2026-09-03: la
  //     firma corre en paralelo — bodega puede pre-asignar desde la aprobación)
  //   · aumento en 'pendiente_bodega' (anexo firmado; faltan los seriales)
  //   · reemplazo/demo en 'en_proceso' sin cierre.asignacion
  // La asignación se resuelve en la pestaña Asignar (2026-09-03); antes era el
  // expediente del Centro. La comparte AlmacenAsignar para armar su cola.
  async function cargarGestionesBodega() {
    const db = firebase.firestore();
    const snap = await db.collection('gestiones')
      .where('estado', 'in', ['pendiente_firma', 'pendiente_bodega', 'en_proceso']).limit(200).get();
    const out = [];
    const serialesCompletos = (g) => {
      const total = (g.aumento?.lineas || []).reduce((s, l) => s + Number(l.cantidad || 0), 0);
      const asignados = (g.aumento?.seriales_asignados || []).filter(s => String(s.serial || '').trim()).length;
      return total > 0 && asignados >= total;
    };
    snap.docs.forEach(d => {
      const g = { id: d.id, ...d.data() };
      if (g.deleted) return;
      const espera = g.estado === 'pendiente_bodega'
        || (g.estado === 'en_proceso' && ['reemplazo', 'demo'].includes(g.tipo) && !g.cierre?.asignacion)
        || (g.estado === 'pendiente_firma' && g.tipo === 'aumento'
            && g.aumento?.es_ajuste !== true && g.aumento?.es_regularizacion !== true
            && !serialesCompletos(g));
      if (espera) out.push(g);
    });
    const ms = (g) => g.actualizado_at?.toMillis?.() || g.updated_at?.toMillis?.()
      || g.creado_at?.toMillis?.() || g.created_at?.toMillis?.() || g.fecha_creacion?.toMillis?.() || 0;
    return out.map(g => ({ ...g, _at: ms(g) })).sort((a, b) => a._at - b._at);
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
      const [colas, gestiones, devueltos, clasificar, conflictos, sinVerificarN, difs] = await Promise.all([
        ColaInventarioService.todo(),
        cargarGestionesBodega().catch(e => { console.warn('[Hoy] gestiones:', e?.code || e); return null; }),
        EquiposPoolService.listar({ estado: 'devuelto_revision' }).catch(e => { console.warn('[Hoy] devueltos:', e?.code || e); return null; }),
        EquiposPoolService.listar({ estado: 'por_clasificar' }).catch(e => { console.warn('[Hoy] clasificar:', e?.code || e); return null; }),
        cargarConflictos().catch(e => { console.warn('[Hoy] conflictos:', e?.code || e); return null; }),
        contarSinVerificar().catch(e => { console.warn('[Hoy] sin verificar:', e?.code || e); return null; }),
        cargarDiferencias().catch(e => { console.warn('[Hoy] diferencias:', e?.code || e); return null; }),
      ]);
      ctx.datos = { colas, gestiones, devueltos, clasificar, conflictos, sinVerificarN, difs };
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
    // Seriales y cambios se trabajan en la pestaña Asignar de este mismo
    // espacio; la transición sigue en su página (cola apagada).
    const cfgs = {
      seriales: { chip: 'Seriales', cls: 'seriales', icono: 'scan-barcode', cta: 'Asignar seriales', ctaHtml: ctaAsignar({ contrato: r.doc_id }, 'scan-barcode', 'Asignar seriales') },
      cambio: { chip: 'Cambio', cls: 'cambio', icono: 'replace', cta: 'Reemplazar', ctaHtml: ctaAsignar({ contrato: r.doc_id }, 'replace', 'Reemplazar') },
      transicion: { chip: 'Transición', cls: 'transicion', icono: 'arrow-left-right', cta: 'Registrar', href: vol(`../contratos/transicion.html?id=${encodeURIComponent(r.doc_id)}`) },
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
      ctaHtml: c.ctaHtml || cta(c.href, c.icono, c.cta),
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

    // ── De gestiones (bodega asigna) ──
    if (d.gestiones === null) fallidas.push('gestiones');
    const gestiones = d.gestiones || [];
    total += gestiones.length;
    const CHIP_G = { aumento: ['Aumento', 'seriales'], reemplazo: ['Reemplazo', 'cambio'], demo: ['Demo', 'transicion'] };
    partes.push(grupo('De gestiones (bodega asigna)', gestiones.length,
      conMas(gestiones, (g) => {
        const [chip, cls] = CHIP_G[g.tipo] || [g.tipo, 'seriales'];
        let detalle = '';
        if (g.tipo === 'aumento') {
          const a = g.aumento || {};
          detalle = ` — anexo ${g.estado === 'pendiente_firma'
              ? 'aprobado (<b>firma en paralelo</b>)' : 'firmado'} al <b>${esc(a.contrato_id || '—')}</b>: `
            + (a.lineas || []).map(l => `${Number(l.cantidad || 0)} × ${esc(l.modelo || '?')}`).join(', ');
        } else {
          const n = (g.items || []).length;
          detalle = g.tipo === 'demo'
            ? ` — ${n} equipo(s) de demo por asignar`
            : ` — ${n} reemplazo(s): elegir la unidad que sustituye`;
        }
        return fila({
          chip, chipCls: cls,
          txt: `<b>${esc(g.id)}</b> · ${esc(g.cliente_nombre || '—')}${detalle}`,
          at: g._at || null,
          ctaHtml: ctaAsignar({ g: g.id }, 'scan-barcode', 'Asignar seriales'),
        });
      }, 'index.html?tab=asignar', 'gestiones'),
    ));
    // Badge de la pestaña Asignar = lo que bodega tiene que poner.
    if (window.WorkspaceTabs) WorkspaceTabs.setBadge('asignar', colas.seriales.length + colas.cambios.length + gestiones.length);

    // ── Del pool ──
    let poolHtml = '';
    let poolN = 0;

    // La inspección FORMAL de un devuelto es del TALLER, vía su orden de
    // ENTRADA: al cerrarla, el trigger regresa la unidad a bodega verificada.
    // A bodega solo le toca lo que quedó SIN tiquete de taller — la fuga
    // (migración, o una ENTRADA que nunca se creó). Diagnóstico 2026-08-10:
    // 63 de 66 en cuarentena tenían ENTRADA abierta — mostrarlos aquí era
    // duplicarle al taller su propia cola.
    let notaTaller = '';
    if (d.devueltos === null) fallidas.push('devueltos');
    else if (d.devueltos.length) {
      const sinTaller = d.devueltos.filter(eq => !eq.orden_actual_id);
      const enTaller = d.devueltos.length - sinTaller.length;
      if (sinTaller.length) {
        poolN += sinTaller.length;
        const filas = [...sinTaller].sort((a, b) => (a.updated_at?.toMillis?.() || 0) - (b.updated_at?.toMillis?.() || 0));
        poolHtml += conMas(filas, (eq) => fila({
          chip: 'Inspección', chipCls: 'inspeccion',
          txt: `<b>${esc(eq.serial || eq.serial_norm)}</b> · ${esc(eq.modelo_label || 'sin modelo')}`
            + (eq.asignacion?.cliente_nombre ? ` — de ${esc(eq.asignacion.cliente_nombre)}` : '')
            + ' <span style="color:var(--fg-3);">(sin tiquete de taller)</span>',
          at: eq.updated_at?.toMillis?.() || null,
          ctaHtml: cta(vol(`${EQUIPOS}?serial=${encodeURIComponent(eq.serial || eq.serial_norm)}`), 'search-check', 'Revisar'),
        }), vol(`${EQUIPOS}?tab=devuelto_revision`), 'devueltos');
      }
      if (enTaller) {
        notaTaller = `<p class="hy-nota">${enTaller} devueltos están en inspección de TALLER
          (orden de ENTRADA abierta) — regresan a bodega solos al cerrarse la ENTRADA;
          no son trabajo de bodega.</p>`;
      }
    }

    // Por clasificar NO se cuenta como trabajo del día: es deuda de migración
    // (diagnóstico 2026-08-10: 1,541 unidades, 1,280 sin modelo — nada lo
    // produce en runtime, solo scripts/backfills). Mismo criterio que la cola
    // de transiciones apagada: mostrarlo entero convierte la bandeja en una
    // lista de reproches. Va como nota, con su tamaño real y su CTA.
    let notaClasificar = '';
    if (d.clasificar === null) fallidas.push('por clasificar');
    else if (d.clasificar.length) {
      const sinModelo = d.clasificar.filter(eq => !eq.modelo_label).length;
      notaClasificar = `<p class="hy-nota">${d.clasificar.length.toLocaleString()} unidades en
        "por clasificar" (deuda de migración — ubicación sin respaldo${sinModelo ? `, ${sinModelo.toLocaleString()} sin modelo` : ''})
        — <a href="${vol(`${EQUIPOS}?tab=por_clasificar`)}">revisar por lotes →</a></p>`;
    }

    if (d.conflictos === null) fallidas.push('conflictos');
    else if (d.conflictos.length) {
      poolN += d.conflictos.length;
      poolHtml += conMas(d.conflictos, (g) => fila({
        chip: 'Conflicto', chipCls: 'conflicto',
        txt: `<b>${esc(g.norm)}</b> — ${g.docs.length} fichas: ${esc(g.docs.map(x => x.modelo_label || '¿?').join(' ↔ '))}`,
        ctaHtml: `<button type="button" class="btn btn-sm btn-accent hy-cta" onclick="AlmacenHoy.abrirConflicto('${esc(g.norm).replace(/'/g, "\\'")}')">
          <i data-lucide="git-merge" style="width:14px;height:14px;"></i> Resolver</button>`,
      }), vol(`${EQUIPOS}?tab=conflictos`), 'conflictos');
    }

    total += poolN;
    let notaVerificar = '';
    if (d.sinVerificarN) {
      // Deuda de migración, no trabajo del día: se muestra pero NO suma al badge.
      notaVerificar = `<p class="hy-nota">${d.sinVerificarN.toLocaleString()} fichas de migración sin verificar
        (deuda, no trabajo del día) — <a href="${vol(`${EQUIPOS}?tab=todos&verificar=1`)}">revisar por lotes →</a></p>`;
    }
    partes.push(grupo('Del pool', poolN, poolHtml, notaTaller + notaClasificar + notaVerificar));

    // ── De conteos ──
    // Solo diferencias contra un conteo RECIENTE: la conciliación significa
    // algo cuando el conteo es fresco. Contra un conteo de hace meses (33 de
    // 51 tenían >90 días en el diagnóstico 2026-08-10, algunos >400) la
    // diferencia solo dice "este modelo no se ha vuelto a contar" — eso vive
    // en el tablero, no en la bandeja del día.
    const UMBRAL_CONTEO_DIAS = 30;
    if (d.difs === null) fallidas.push('diferencias de conteo');
    const difsTodas = d.difs || [];
    const difs = difsTodas.filter(f => {
      const ms = f.data?.ultima_actualizacion?.toMillis?.();
      return ms && (Date.now() - ms) <= UMBRAL_CONTEO_DIAS * 86400000;
    });
    const difsViejas = difsTodas.length - difs.length;
    const notaConteosViejos = difsViejas > 0
      ? `<p class="hy-nota">${difsViejas} modelos más tienen diferencia contra conteos de hace
         más de ${UMBRAL_CONTEO_DIAS} días — se cuadran recontando (Conteo físico), no son trabajo de hoy.
         <a href="#" onclick="event.preventDefault(); AlmacenPage.setTab('existencias')">Ver Existencias →</a></p>` : '';
    total += difs.length;
    partes.push(grupo('De conteos', difs.length,
      conMas(difs, (f) => fila({
        chip: 'Diferencia', chipCls: 'diferencia',
        txt: `<b>${esc(f.modelo?.modelo || f.label)}</b> — pool ${f.seriales} vs conteo ${f.conteo} (${f.dif > 0 ? '+' : ''}${f.dif})`,
        at: f.data?.ultima_actualizacion?.toMillis?.() || null,
        ctaHtml: cta(vol(`${EQUIPOS}?tab=en_bodega${f.modelo_id ? `&modelo=${encodeURIComponent(f.modelo_id)}` : ''}`), 'diff', 'Revisar'),
      }), './index.html?tab=existencias', 'Existencias'),
      notaConteosViejos,
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

  // ── Conflictos: resolver desde la bandeja (Fase C) ─────────────────────
  // Mismo circuito que la cola de Equipos: elegir la ficha real → callable
  // fusionarPoolFicha (conserva kardex, absorbe duplicados), o marcar que son
  // radios físicos distintos (colisión real tipo Kenwood).
  function abrirConflicto(norm) {
    const g = (ctx.datos?.conflictos || []).find(x => x.norm === norm);
    if (!g) return;
    if (!(ctx.rol === ROLES.ADMIN || ctx.rol === ROLES.INVENTARIO)) {
      if (window.Toast) Toast.show('Solo administración o inventario resuelven conflictos.', 'warn');
      return;
    }
    const cards = g.docs.map(d => `
      <label style="display:block; border:1px solid var(--border-default); border-radius:var(--radius-md); padding:10px 12px; cursor:pointer;">
        <input type="radio" name="hyConfl" value="${esc(d.id)}" style="margin-right:8px;">
        <b>${esc(d.modelo_label || 'sin modelo')}</b>
        <span style="color:var(--fg-3); font-size:12px; display:block; margin-left:22px;">
          estado: ${esc(EquiposPoolService.ESTADO_LABELS[d.estado] || d.estado)}
          · origen: ${esc(d.origen || '—')}
          ${d.asignacion?.cliente_nombre ? ` · ${esc(d.asignacion.cliente_nombre)}` : ''}
          ${d.verificado === false ? ' · sin verificar' : ''}
        </span>
      </label>`).join('');
    _modalConflicto(`
      <p style="font-size:13px; color:var(--fg-3); margin:0 0 10px;">
        El serial <b style="font-family:var(--mono, monospace);">${esc(norm)}</b> tiene ${g.docs.length} fichas
        (modelos distintos registrados por fuentes distintas). Elige el radio REAL para fusionar
        las demás en él (su kardex se conserva) — o confirma que son radios físicos distintos.
      </p>
      <div style="display:flex; flex-direction:column; gap:8px;">${cards}</div>`,
      `<button class="btn btn-ghost" onclick="AlmacenHoy._conflictoDistintos('${esc(norm).replace(/'/g, "\\'")}')">Son radios distintos</button>
       <button class="btn btn-primary" onclick="AlmacenHoy._conflictoFusionar('${esc(norm).replace(/'/g, "\\'")}', this)">Fusionar en la seleccionada</button>`);
  }

  async function _conflictoFusionar(norm, btn) {
    const g = (ctx.datos?.conflictos || []).find(x => x.norm === norm);
    const sel = document.querySelector('input[name="hyConfl"]:checked');
    if (!g || !sel) { if (window.Toast) Toast.show('Selecciona primero la ficha que se conserva.', 'warn'); return; }
    const keeperId = sel.value;
    const absorbidosIds = g.docs.map(d => d.id).filter(id => id !== keeperId);
    if (!confirm(`Fusionar ${absorbidosIds.length} ficha(s) en la seleccionada. Sus kardex se conservan. ¿Continuar?`)) return;
    btn.disabled = true;
    try {
      const res = await firebase.functions().httpsCallable('fusionarPoolFicha')({ keeperId, absorbidosIds });
      if (window.Toast) Toast.show(`Fusión lista: ${res.data.fusionados} ficha(s) absorbida(s).`, 'ok');
      _cerrarConflicto();
      cargar();
    } catch (e) {
      btn.disabled = false;
      if (window.Toast) Toast.show('No se pudo fusionar: ' + (e.message || e), 'bad');
    }
  }

  async function _conflictoDistintos(norm) {
    const g = (ctx.datos?.conflictos || []).find(x => x.norm === norm);
    if (!g) return;
    if (!confirm(`Las ${g.docs.length} fichas del serial ${norm} quedarán marcadas como radios FÍSICOS distintos (salen de la cola, conservan el aviso "2+ modelos"). ¿Continuar?`)) return;
    try {
      const db = firebase.firestore();
      const user = firebase.auth().currentUser;
      const batch = db.batch();
      // Marca + kardex: la decisión tiene que quedar rastreable en la ficha —
      // meses después la pregunta es "¿quién dijo que son distintos y cuándo?",
      // y el chip "2+ modelos" por sí solo no la contesta.
      g.docs.forEach(d => {
        const ref = db.collection('equipos_pool').doc(d.id);
        batch.set(ref, {
          conflicto_revisado: true,
          updated_at: firebase.firestore.FieldValue.serverTimestamp(),
          updated_by: user?.uid || null,
          updated_by_email: user?.email || null,
        }, { merge: true });
        batch.set(ref.collection('movimientos').doc(), {
          at: firebase.firestore.FieldValue.serverTimestamp(),
          por: user?.uid || 'system', por_email: user?.email || null,
          tipo: 'conflicto_revisado',
          de_estado: d.estado || null, a_estado: d.estado || null, ref: null,
          notas: 'Serial compartido entre modelos: son radios distintos.',
        });
      });
      await batch.commit();
      if (window.Toast) Toast.show('Grupo marcado como radios distintos.', 'ok');
      _cerrarConflicto();
      cargar();
    } catch (e) {
      if (window.Toast) Toast.show('No se pudo marcar: ' + (e.message || e), 'bad');
    }
  }

  function _modalConflicto(bodyHtml, footerHtml) {
    document.getElementById('hyConflOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'hyConflOverlay';
    overlay.className = 'overlay';
    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="modal" style="max-width:560px; width:min(560px, 94vw);">
        <div class="sheet-header" style="display:flex; justify-content:space-between; align-items:center;">
          <h3 class="sheet-title" style="margin:0;">Fichas en conflicto</h3>
          <button class="btn btn-ghost btn-icon" data-action="cerrar" aria-label="Cerrar">✕</button>
        </div>
        <div class="sheet-body" style="padding:14px 10px;">${bodyHtml}</div>
        <div class="footer" style="display:flex; justify-content:flex-end; gap:8px; flex-wrap:wrap;">
          ${footerHtml}
          <button class="btn btn-ghost" data-action="cerrar">Cancelar</button>
        </div>
      </div>`;
    overlay.addEventListener('click', (e) => { if (e.target.closest('[data-action="cerrar"]')) _cerrarConflicto(); });
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
  }

  function _cerrarConflicto() {
    document.getElementById('hyConflOverlay')?.remove();
    document.body.style.overflow = '';
  }

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
    // Una acción de la ficha (inspección, baja, venta…) refresca las listas.
    if (window.EquipoFicha) EquipoFicha.onCambio = () => AlmacenPage.recargarTodo();
    // Los CTAs "Asignar" de la bandeja abren la pestaña sin recargar.
    document.getElementById('hoyGrupos')?.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-asignar]');
      if (!a || e.ctrlKey || e.metaKey || e.button !== 0) return;
      e.preventDefault();
      AlmacenPage.abrirAsignar({ contrato: a.dataset.contrato || null, g: a.dataset.g || null });
    });
    // Deep-link ?tab=asignar (correo de "Solicitud de seriales" / de bodega):
    // la sección ya está visible desde el parse; aquí se cargan sus datos.
    const qs = new URLSearchParams(location.search);
    if (qs.get('tab') === 'asignar' && window.AlmacenAsignar) {
      AlmacenAsignar.activar({ contrato: qs.get('contrato'), g: qs.get('g') });
    }
    // ?accion=conteo|recibir|vender — deep-links de los asistentes.
    const accion = new URLSearchParams(location.search).get('accion');
    if (accion === 'conteo') AlmacenPage.abrirConteo();
    else if (accion === 'recibir') AlmacenPage.abrirRecibir();
    else if (accion === 'vender') AlmacenPage.abrirVenta();
    cargar();
  }

  return { recargar, render, abrirConflicto, _conflictoFusionar, _conflictoDistintos, cargarGestionesBodega };
})();
