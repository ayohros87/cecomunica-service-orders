/**
 * senalesService.js
 * Conteos para la fila de señales del home (y badges del rail).
 * PLAN_REDISENO_COMMAND_CENTER.md §3.
 *
 * ⚠️ HISTORIA (2026-08-24): este archivo nació asumiendo que el SDK compat
 * traía agregados count() "≥9.16". NUNCA los trajo — los agregados son de la
 * API modular; compat no los expone en ninguna versión. El guard
 * aggregatesDisponibles() siempre devolvió false y ESCONDIÓ la fila de
 * señales completa desde el estreno del rediseño, con una degradación tan
 * silenciosa que nadie la vio. Hoy _count() cuenta con un SCAN ACOTADO
 * (tope _COUNT_TOPE; por encima reporta "N+"), y el día que la app migre a
 * la API modular puede volver al agregado de verdad.
 *
 * Piso de permisos (firestore.rules, verificado 2026-07-13):
 *   ordenes_de_servicio / contratos / inventario_piezas → read isSignedIn()
 *   cotizaciones → list solo puedeCotizar (admin, vendedor, jefe_taller,
 *                  recepcion, gerente) + técnicos taller + supervisores.
 * El gating de QUÉ señal ve cada rol vive en js/pages/home-signals.js
 * (módulos visibles); este servicio solo ejecuta la consulta.
 *
 * (La vieja "limitación v1" —conteos de órdenes inflados por soft-deleted
 * porque count() no podía expresar "campo ausente o != true"— murió con los
 * agregados: el scan filtra `eliminado` como cualquier consumidor. Medido el
 * 2026-08-24: POR ASIGNAR decía 90 y 55 eran órdenes borradas.)
 */

const SenalesService = {

  /** Conservado por compatibilidad de firma: los conteos ya no dependen de
      agregados del SDK (ver la cabecera), así que siempre hay señales. */
  aggregatesDisponibles() {
    return true;
  },

  // Tope del conteo por scan. Por encima se reporta "N+": para una señal
  // operativa, "50+" ya significa "hay cola" — el número exacto no cambia
  // ninguna decisión y sí costaría lecturas sin tope. Era 400: con el SDK
  // compat cada conteo BAJA los documentos enteros (no hay .count()), así que
  // el tope es literalmente la factura de la señal (2026-09-02, factura de
  // agosto: ~3M lecturas/mes y el grueso del egreso venían de estos scans).
  _COUNT_TOPE: 50,

  async _count(queryRef, docFilter = null, spec = null) {
    // Agregados server-side (2026-09-02): el compat no trae count(), así que
    // js/firebase-aggregates.js carga el SDK modular SOLO para contar y
    // publica window.FbAgg. Con spec, el conteo cuesta 1-2 lecturas y unos
    // bytes en vez de bajar ~50 docs de 8KB. `restarEliminadas` cubre el
    // docFilter _viva sin backfill: total − (mismos filtros + eliminado==true)
    // — los docs viejos sin el campo `eliminado` quedan bien contados.
    // Cualquier fallo (módulo bloqueado, sin sesión, error) cae al scan.
    if (spec && window.FbAgg && window.FbAgg.disponible) {
      try {
        // Todos los agregados de UN conteo salen a la vez (2026-09-30): antes
        // iban en serie (total → eliminadas → cada tipo), 2-4 viajes por señal.
        // Exclusión de tipos por inclusión-exclusión: se resta el tipo entero
        // y, si también se restaron eliminadas, se devuelve el traslape
        // (tipo + eliminada) que se restó dos veces.
        const partes = [[+1, spec.wheres]];
        if (spec.restarEliminadas) partes.push([-1, [...spec.wheres, ['eliminado', '==', true]]]);
        for (const tipo of (spec.excluirTipos || [])) {
          partes.push([-1, [...spec.wheres, ['tipo_de_servicio', '==', tipo]]]);
          if (spec.restarEliminadas) {
            partes.push([+1, [...spec.wheres, ['tipo_de_servicio', '==', tipo], ['eliminado', '==', true]]]);
          }
        }
        const valores = await Promise.all(partes.map(([, w]) => window.FbAgg.count(spec.col, w)));
        const n = valores.reduce((acc, v, i) => acc + partes[i][0] * v, 0);
        return Math.max(0, n);
      } catch (e) {
        console.warn('[senales] agregado falló, cayendo al scan:', e?.code || e);
      }
    }
    if (typeof queryRef.count === 'function' && !docFilter) {
      const snap = await queryRef.count().get();
      return snap.data().count;
    }
    const snap = await queryRef.limit(this._COUNT_TOPE + 1).get();
    if (!docFilter) return snap.size > this._COUNT_TOPE ? (this._COUNT_TOPE + '+') : snap.size;
    let n = 0, vistos = 0;
    snap.forEach(d => { vistos++; if (docFilter(d.data() || {})) n++; });
    // Si el scan topó, hay más docs sin ver: el conteo filtrado es piso.
    return vistos > this._COUNT_TOPE ? (n + '+') : n;
  },

  // Una orden borrada (lógicamente) no es cola de nadie.
  _viva(o) { return o.eliminado !== true; },

  // soloTaller (2026-09-02): los KPIs de asignación excluyen los tipos con
  // circuito propio (DEVOLUCION nace "POR ASIGNAR" pero nunca se asigna —
  // eran 27 de las 48 vivas). Para "POR ASIGNAR" el default es excluir:
  // el filtro de la bandeja también las quita (pedido del dueño), así que
  // conteo y filas cuadran.
  countOrdenesPorEstado(estado, { soloTaller = (String(estado || '').trim().toUpperCase() === 'POR ASIGNAR') } = {}) {
    const db = firebase.firestore();
    const docFilter = soloTaller
      ? (o) => this._viva(o) && PendientesDomain.esColaDeTaller(o)
      : this._viva;
    return this._count(
      db.collection('ordenes_de_servicio').where('estado_reparacion', '==', estado),
      docFilter,
      { col: 'ordenes_de_servicio', wheres: [['estado_reparacion', '==', estado]],
        restarEliminadas: true,
        ...(soloTaller ? { excluirTipos: PendientesDomain.TIPOS_FUERA_DE_COLA } : {}) }
    );
  },

  // La lista comparte las exclusiones del contador. Paginar antes de filtrar
  // evita que una página llena de eliminadas/devoluciones esconda las vivas.
  // Memo compartida con el conteo (el conteo de S1 sale de estas filas).
  listOrdenesPorAsignar() {
    return this._memoList('asignar', () => this._leerOrdenesPorAsignar());
  },
  async _leerOrdenesPorAsignar() {
    const { staleMax } = await this._config();
    const db = firebase.firestore();
    const base = db.collection('ordenes_de_servicio')
      .where('estado_reparacion', '==', 'POR ASIGNAR')
      .orderBy(firebase.firestore.FieldPath.documentId());
    const rows = [];
    const now = new Date();
    let cursor = null;
    do {
      const q = cursor ? base.startAfter(cursor) : base;
      const snap = await q.limit(100).get({ source: 'server' });
      for (const d of snap.docs) {
        const o = d.data() || {};
        if (!this._viva(o) || !PendientesDomain.esColaDeTaller(o)) continue;
        rows.push({
          id: d.id, col: 'ordenes_de_servicio',
          cliente: o.cliente_nombre || o.cliente || '—',
          tipo: o.tipo_de_servicio || '—',
          dias: Math.max(0, Math.floor(PendientesDomain.edadDias(o.fecha_entrada || o.fecha_creacion, now) || 0)),
        });
        rows[rows.length - 1].viejo = this._vieja(rows[rows.length - 1].dias, staleMax);
      }
      cursor = snap.size === 100 ? snap.docs[snap.docs.length - 1] : null;
    } while (cursor);
    return rows.sort((a, b) => b.dias - a.dias || a.id.localeCompare(b.id));
  },

  // Más vieja que orden_stale_max_dias (30) = casi seguro ya no está en el
  // taller: sigue en el panel, en su grupo "por depurar", pero no infla el
  // número de la tarjeta (repaso del home 2026-09-29: 24 de las 44 "por
  // asignar" y 33 de las 80 "listas para entregar" pasaban del mes, hasta
  // 235 días). Mismo corte que "sin movimiento" y el correo diario.
  // Devuelve el corte en días (para el título del grupo) o 0 si no es vieja.
  _vieja(dias, staleMax) { return dias > staleMax ? staleMax : 0; },

  async countOrdenesPorAsignar() { return (await this.listOrdenesPorAsignar()).filter(r => !r.viejo).length; },

  /**
   * Órdenes completadas que el candado de QC no deja entregar (ordenes-qc.js).
   * NO usa count(): el criterio ("aprobado y además cubriendo los equipos
   * actuales") no se puede expresar en una query, así que trae los docs con la
   * marca —volumen bajo por el corte del 2026-07-21— y filtra en cliente.
   * @returns {Promise<number>}
   */
  async countOrdenesQcPendiente() {
    const db = firebase.firestore();
    // El filtro de estado va server-side (antes se bajaba TODO qc_requerido
    // sin limit y se filtraba aquí). limit(200) es techo de cordura: la señal
    // muestra un conteo, no una lista, y 200 pendientes de QC ya es incendio.
    // Índice compuesto: ordenes_de_servicio(qc_requerido ASC, estado_reparacion ASC).
    const snap = await db.collection('ordenes_de_servicio')
      .where('qc_requerido', '==', true)
      .where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)')
      .limit(200)
      .get();
    // Predicado compartido con el cron del correo (PendientesDomain: espejo
    // del servidor + test de sincronía). La copia local que vivía aquí ni
    // siquiera sabía detectar la sustitución de serial.
    let n = 0;
    snap.forEach(doc => {
      if (PendientesDomain.esQcColaOperativa(doc.data() || {})) n++;
    });
    return n;
  },

  countMisOrdenes(uid, estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('ordenes_de_servicio')
        .where('tecnico_uid', '==', uid)
        .where('estado_reparacion', '==', estado),
      this._viva,
      { col: 'ordenes_de_servicio',
        wheres: [['tecnico_uid', '==', uid], ['estado_reparacion', '==', estado]],
        restarEliminadas: true }
    );
  },

  // Cotizaciones que piden aprobación interna (auditoría A10): borradores con
  // el flag `requiere_aprobacion` que la app estampa al guardar. La señal que
  // el plan del Command Center dejó pendiente por "no contable server-side" —
  // contable desde que el flag se persiste (2026-08-17). Índice compuesto:
  // cotizaciones(estado ASC, requiere_aprobacion ASC).
  // Cotizaciones: la eliminada (soft delete, `deleted: true`) no es cola de
  // nadie. Aquí el filtro es una igualdad directa porque las tres puertas
  // que crean cotizaciones escriben `deleted: false` desde el primer día
  // (verificado 2026-09-29: 147 docs, ninguno sin el campo), así que no hace
  // falta el truco de restar como en órdenes (`eliminado` ausente en las viejas).
  // Antes no se filtraba y el home seguía pidiendo el visto bueno de una
  // cotización borrada una semana atrás (COT-2026-0117).
  countCotizacionesPorAprobar() {
    const db = firebase.firestore();
    return this._count(
      db.collection('cotizaciones')
        .where('deleted', '==', false)
        .where('estado', '==', 'borrador')
        .where('requiere_aprobacion', '==', true),
      null,
      { col: 'cotizaciones', wheres: [['deleted', '==', false], ['estado', '==', 'borrador'], ['requiere_aprobacion', '==', true]] }
    );
  },

  countCotizacionesPorEstado(estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('cotizaciones')
        .where('deleted', '==', false)
        .where('estado', '==', estado),
      null,
      { col: 'cotizaciones', wheres: [['deleted', '==', false], ['estado', '==', estado]] }
    );
  },

  countMisCotizacionesActivas(uid) {
    const db = firebase.firestore();
    return this._count(
      db.collection('cotizaciones')
        .where('deleted', '==', false)
        .where('creado_por_uid', '==', uid)
        .where('estado', 'in', ['borrador', 'enviada', 'aprobada']),
      null,
      { col: 'cotizaciones', wheres: [['deleted', '==', false], ['creado_por_uid', '==', uid], ['estado', 'in', ['borrador', 'enviada', 'aprobada']]] }
    );
  },

  // Contratos por firmar (2026-09-29): reemplaza a "Contratos por activar",
  // que contaba TODO contrato en 'aprobado' (203 al medirlo) y enviaba a la
  // lista de contratos. 'aprobado' solo quiere decir "aprobado y sin firmar",
  // y casi todo eso no espera nada: 116 históricos 'legacy' que se firmaron
  // en papel antes del sistema, ~80 REEMP/DEMO que no llevan firma
  // (ContratoFirma.SIN_FIRMA — 'aprobado' es su estado de reposo), borrados
  // y los ya entregados antes del candado del 2026-09-03. Lo que queda es la
  // cola real: bodega ya asignó los seriales (el Anexo A sale lleno), el
  // cliente no ha firmado y la entrega está trancada por eso. `uid` limita a
  // los contratos que elaboró esa persona (el vendedor ve los suyos): pedir
  // la firma es trabajo del VENDEDOR — el correo de firma le llega a él al
  // aprobarse. Sin uid es la vista de supervisión de gerencia.
  listContratosPorFirmar({ uid = null } = {}) {
    return this._memoList(`firmar:${uid || 'todos'}`, async () => {
      const snap = await firebase.firestore().collection('contratos')
        .where('estado', '==', 'aprobado')
        .where('seriales_estado', '==', 'asignados')
        .limit(300).get();
      const now = new Date();
      const lleva = (c) => (window.ContratoFirma ? ContratoFirma.lleva(c) : !['REEMP', 'DEMO'].includes(c.codigo_tipo));
      const rows = [];
      snap.forEach(d => {
        const c = d.data() || {};
        if (c.deleted === true || c.firmado === true || c.entrega_confirmada === true || !lleva(c)) return;
        if (uid && c.creado_por_uid !== uid) return;
        rows.push({
          id: d.id, col: 'contratos',
          cliente: c.cliente_nombre || 'Cliente sin nombre',
          cliente_id: c.cliente_id || null,
          contrato: c.contrato_id || d.id,
          clase: c.accion && c.accion !== 'No Aplica' ? `${c.tipo_contrato || 'Contrato'} · ${c.accion}` : (c.tipo_contrato || 'Contrato'),
          con_orden: Number(c.os_count || 0) > 0,
          creado_por_uid: c.creado_por_uid || null,
          // Espera la firma desde que bodega dejó los seriales listos.
          dias: Math.floor(PendientesDomain.edadDias(c.seriales_asignados_at || c.fecha_aprobacion || c.fecha_creacion, now) || 0),
        });
      });
      // Vista de supervisión (sin uid, gerencia): la firma la pide el
      // vendedor que elaboró el contrato — la fila dice de quién es. Un fallo
      // leyendo usuarios no tumba la cola: la fila sale sin el nombre.
      if (!uid && rows.length && window.UsuariosService?.getUsuariosByIds) {
        try {
          const uids = [...new Set(rows.map(r => r.creado_por_uid).filter(Boolean))];
          const nombres = new Map((await UsuariosService.getUsuariosByIds(uids))
            .map(u => [u.id, u.nombre || u.displayName || String(u.email || '').split('@')[0]]));
          rows.forEach(r => { r.vendedor = nombres.get(r.creado_por_uid) || ''; });
        } catch (e) { /* sin nombres */ }
      }
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },
  async countContratosPorFirmar(opts) { return (await this.listContratosPorFirmar(opts)).length; },

  // Cola de bodega: contratos vigentes esperando que inventario asigne los
  // seriales (la marca la estampa onContratoAprobadoSolicitaSeriales). Es el
  // conteo exacto de la primera cola de inventario/pendientes.html; las otras
  // dos colas de esa bandeja no entran aquí (la de transición necesita filtro
  // en cliente y no se puede contar con un agregado).
  countSerialesPorAsignar() {
    const db = firebase.firestore();
    return this._count(
      db.collection('contratos')
        .where('seriales_estado', '==', 'pendiente')
        .where('estado', 'in', ['aprobado', 'activo']),
      null,
      { col: 'contratos', wheres: [['seriales_estado', '==', 'pendiente'], ['estado', 'in', ['aprobado', 'activo']]] }
    );
  },

  // S9 — piezas sin stock: el MISMO criterio que la tarjeta y el filtro "Sin
  // stock" de inventario/piezas.html (esSinStock): pieza ACTIVA, con control
  // de inventario (las "Libre" no se agotan) y en cero. Antes contaba
  // cantidad<=0 a secas y la señal decía un número que la página no mostraba
  // (auditoría UX 2026-09-28, P2 §4.6). Solo igualdades —sin índice
  // compuesto—: activas en 0 menos las "Libre" activas en 0. Sin agregados
  // cae al scan con el mismo predicado en cliente.
  async countPiezasSinStock() {
    const db = firebase.firestore();
    const wheres = [['activo', '==', true], ['cantidad', '==', 0]];
    if (window.FbAgg && window.FbAgg.disponible) {
      try {
        const [n, libres] = await Promise.all([
          window.FbAgg.count('inventario_piezas', wheres),
          window.FbAgg.count('inventario_piezas', [...wheres, ['sin_control_inventario', '==', true]]),
        ]);
        return Math.max(0, n - libres);
      } catch (e) {
        console.warn('[senales] agregado de piezas falló, cayendo al scan:', e?.code || e);
      }
    }
    return this._count(
      db.collection('inventario_piezas').where('activo', '==', true).where('cantidad', '==', 0),
      (p) => p.sin_control_inventario !== true
    );
  },

  // Lotes PoC que ventas preparó y recepción todavía no cargó
  // (poc_lotes_preparados — list solo recepción/admin/gerente; el vendedor
  // no debe llamar esto: le rebotaría en rules). Auditoría UX 2026-09-28 §4.7 #9.
  countLotesPocPorCargar() {
    const db = firebase.firestore();
    return this._count(
      db.collection('poc_lotes_preparados').where('estado', '==', 'pendiente'),
      null,
      { col: 'poc_lotes_preparados', wheres: [['estado', '==', 'pendiente']] }
    );
  },

  // Pool de equipos serializados (equipos_pool — read isSignedIn()).
  countEquiposPoolPorEstado(estado) {
    const db = firebase.firestore();
    return this._count(
      db.collection('equipos_pool').where('estado', '==', estado),
      null,
      { col: 'equipos_pool', wheres: [['estado', '==', estado]] }
    );
  },

  countEquiposPoolSinVerificar() {
    const db = firebase.firestore();
    return this._count(
      db.collection('equipos_pool').where('verificado', '==', false),
      null,
      { col: 'equipos_pool', wheres: [['verificado', '==', false]] }
    );
  },

  /* ══ Detectores con FILAS (bandeja de pendientes del home) ═════════════
     Los cuatro salen del cron del correo diario; los predicados viven en
     PendientesDomain (espejo del servidor + test de sincronia). Aqui solo
     van las queries y la proyeccion segura de campos para la UI.

     El conteo y las filas comparten UNA promesa memoizada (TTL 5 min): la
     senal cuenta y, si la persona expande, las filas ya estan en memoria —
     expandir no paga una segunda consulta.

     Cada fila trae `pospuesto`: la UI muestra las activas y resume las
     pospuestas. Los conteos excluyen las pospuestas — el mismo criterio
     que el correo diario. */

  _LIST_TTL_MS: 5 * 60 * 1000,
  _listMemo: new Map(),   // clave → { t, p: Promise<rows> }

  /** Cuentas con deuda de regularización (plan 2026-09-08). Lee SOLO el
   *  campo clientes.regularizacion que escribe el job — nada se calcula aquí.
   *  { uid } → la cartera de ese vendedor (filtro en cliente sobre su
   *  cartera, sin índice compuesto); sin uid → todas (puntos > 0). */
  listCuentasPorRegularizar({ uid = null } = {}) {
    return this._memoList(`reg:${uid || 'todas'}`, async () => {
      const db = firebase.firestore();
      const q = uid
        ? db.collection('clientes').where('vendedor_asignado', '==', uid)
        : db.collection('clientes').where('regularizacion.puntos', '>', 0).limit(400);
      const snap = await q.get();
      const now = Date.now();
      const rows = [];
      snap.forEach(d => {
        const c = d.data() || {};
        const r = c.regularizacion;
        if (c.deleted || c.activo === false || !r || !(r.puntos > 0)) return;
        // Solo "por clasificar" = cola de bodega, no cuenta del vendedor.
        if (r.solo_bodega) return;
        const desde = r.primera_marca_at?.toDate?.() || r.calculado_at?.toDate?.() || null;
        rows.push({
          id: d.id, col: 'clientes',
          cliente: c.nombre || '—',
          vendedor: (c.vendedor_email || '').split('@')[0],
          nivel: r.nivel, nivel_label: (window.Regularizacion?.NIVEL_LABEL || {})[r.nivel] || r.nivel,
          puntos: Number(r.puntos) || 0, puntuales: Number(r.gestiones_puntuales) || 0,
          excede: !!r.excede_margen, etiqueta: r.etiqueta || '',
          dias: desde ? Math.floor((now - desde.getTime()) / 86400000) : 0,
          ...this._snooze(c),
        });
      });
      // Sin vendedor primero (nadie las ve), luego por deuda.
      return rows.sort((a, b) => (a.vendedor ? 1 : 0) - (b.vendedor ? 1 : 0) || b.puntos - a.puntos);
    });
  },
  async countCuentasPorRegularizar(opts) { return (await this.listCuentasPorRegularizar(opts)).filter(r => !r.pospuesto).length; },

  _memoList(clave, fn) {
    const hit = this._listMemo.get(clave);
    if (hit && Date.now() - hit.t < this._LIST_TTL_MS) return hit.p;
    const p = fn().catch(e => { this._listMemo.delete(clave); throw e; });
    this._listMemo.set(clave, { t: Date.now(), p });
    return p;
  },

  /** Tras posponer/reactivar: la proxima lectura vuelve al servidor. */
  invalidarListas() { this._listMemo.clear(); },

  // Umbrales de empresa/config con fallback a los defaults del dominio —
  // los MISMOS numeros que usa el cron, para que el correo y la bandeja
  // nunca cuenten distinto (que es el bug que origino todo esto).
  _cfgMemo: null,
  async _config() {
    if (this._cfgMemo) return this._cfgMemo;
    const D = PendientesDomain.DEFAULTS;
    let cfg = {};
    try {
      // Vía EmpresaService (memo de sesión de 30 min): las señales S1, ENT y
      // EST releían empresa/config cada una por su lado y en serie con su
      // consulta. Si el servicio no está en la página, lectura directa.
      if (window.EmpresaService?.getDoc) {
        cfg = (await EmpresaService.getDoc('config')) || {};
      } else {
        const snap = await firebase.firestore().collection('empresa').doc('config').get();
        cfg = snap.exists ? (snap.data() || {}) : {};
      }
    } catch (e) { /* sin permiso o sin red: defaults */ }
    const num = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 1) ? Number(v) : d;
    const staleDias = num(cfg.orden_stale_dias, D.stale_dias);
    this._cfgMemo = {
      staleDias,
      staleMax:    Math.max(num(cfg.orden_stale_max_dias, D.stale_max_dias), staleDias + 1),
      entradaDias: num(cfg.entrada_recordatorio_dias, D.entrada_dias),
      entregaDias: num(cfg.entrega_recordatorio_dias, D.entrega_dias),
    };
    return this._cfgMemo;
  },

  // "En curso": coordinación dentro del rol (el DUEÑO del pendiente es el
  // rol, decisión 2026-08-21). No filtra nada — ni el conteo, ni el correo:
  // un pendiente en curso sigue pendiente; solo avisa quién lo está
  // trabajando para que el resto del rol no lo duplique.
  _curso(doc) {
    const c = doc && doc.pendiente_curso;
    if (!c || !c.por_email) return { en_curso: false, curso_por: '', curso_dias: 0 };
    return {
      en_curso: true,
      curso_por: String(c.por_email).split('@')[0],
      curso_dias: Math.max(0, Math.floor(PendientesDomain.edadDias(c.at, new Date()) || 0)),
    };
  },

  _snooze(doc) {
    const activo = PendientesDomain.estaPospuesto(doc, new Date());
    return {
      pospuesto: activo,
      snooze_motivo: activo ? String(doc.pendiente_snooze?.motivo || '') : '',
      snooze_hasta: activo ? String(doc.pendiente_snooze?.hasta || '').slice(0, 10) : '',
    };
  },

  /** Terminadas con QC listo que nadie marco ENTREGADO (cron seccion E). */
  listListasParaEntregar() {
    return this._memoList('entregar', async () => {
      const { entregaDias, staleMax } = await this._config();
      const now = new Date();
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        .where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)')
        .limit(150).get();
      const rows = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (!PendientesDomain.esListaParaEntregar(o, now, entregaDias)) return;
        rows.push({
          id: d.id, col: 'ordenes_de_servicio',
          cliente: o.cliente_nombre || o.cliente || '—',
          tipo: o.tipo_de_servicio || '—',
          equipos: (o.equipos || []).filter(e => e && !e.eliminado).length,
          dias: Math.floor(PendientesDomain.edadDias(o.fecha_completado || o.fecha_modificacion, now) || 0) || Math.floor(PendientesDomain.edadDias(o.fecha_creacion, now) || 0),
          ...this._snooze(o), ...this._curso(o),
        });
        rows[rows.length - 1].viejo = this._vieja(rows[rows.length - 1].dias, staleMax);
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Abiertas sin movimiento dentro de la ventana accionable (cron A). */
  listEstancadas() {
    return this._memoList('estancadas', async () => {
      const { staleDias, staleMax } = await this._config();
      const now = new Date();
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        // Sin orderBy la query sale por doc ID = fecha (YYYYMMDD...): las más
        // viejas primero, que es exactamente donde viven las estancadas. El
        // tope bajó de 600 (2026-09-02): cada doc de orden pesa ~8KB y estos
        // scans eran el grueso del egreso de la factura de agosto.
        .where('estado_reparacion', 'in', PendientesDomain.ESTADOS_ABIERTOS)
        .limit(150).get();
      const rows = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (!PendientesDomain.esOrdenEstancada(o, now, { staleDias, staleMax })) return;
        const base = o.fecha_modificacion || o.fecha_actualizacion || o.updatedAt || o.fecha_entrada || o.fecha_creacion;
        rows.push({
          id: d.id, col: 'ordenes_de_servicio',
          cliente: o.cliente_nombre || o.cliente || '—',
          estado: o.estado_reparacion || '—',
          tecnico: o.tecnico_asignado || '',
          dias: Math.floor(PendientesDomain.edadDias(base, now) || 0),
          ...this._snooze(o), ...this._curso(o),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Cola de QC con filas (mismo criterio que countOrdenesQcPendiente). */
  listQcCola() {
    return this._memoList('qc', async () => {
      const now = new Date();
      const snap = await firebase.firestore().collection('ordenes_de_servicio')
        .where('qc_requerido', '==', true)
        .where('estado_reparacion', '==', 'COMPLETADO (EN OFICINA)')
        .limit(150).get();
      const rows = [];
      snap.forEach(d => {
        const o = d.data() || {};
        if (!PendientesDomain.esQcColaOperativa(o)) return;
        rows.push({
          id: d.id, col: 'ordenes_de_servicio',
          cliente: o.cliente_nombre || o.cliente || '—',
          tipo: o.tipo_de_servicio || '—',
          motivo: PendientesDomain.qcCaducado(o) ? 'caduco (cambiaron los equipos)'
            : (o.qc?.resultado === 'rechazado' ? 'rechazado, esperando correccion' : 'sin firmar'),
          dias: Math.floor(PendientesDomain.edadDias(o.fecha_completado || o.fecha_modificacion, now) || 0),
          ...this._snooze(o), ...this._curso(o),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Devueltos sin inspeccionar, con edad. TODOS, no solo los atascados: la
      señal S13 cuenta la cuarentena completa (agregado) y el panel tiene que
      listar lo mismo que el número promete. El umbral de "atascado N+ días"
      es del CORREO (cron sección B), que avisa; la bandeja muestra la cola. */
  listCuarentena() {
    return this._memoList('cuarentena', async () => {
      const now = new Date();
      const snap = await firebase.firestore().collection('equipos_pool')
        .where('estado', '==', 'devuelto_revision')
        .limit(150).get();
      const rows = [];
      snap.forEach(d => {
        const u = d.data() || {};
        rows.push({
          id: d.id, col: 'equipos_pool',
          serial: u.serial || d.id,
          modelo: u.modelo_label || '—',
          cliente: u.asignacion?.cliente_nombre || '—',
          dias: Math.floor(PendientesDomain.edadDias(u.updated_at || u.created_at, now) || 0),
          ...this._snooze(u), ...this._curso(u),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  /** Radios por recuperar SIN orden de devolucion que los reclame (cron C2).
      DEFINIDO pero sin senal asignada: se enciende cuando negocio decida como
      triar el atraso — mismo trato que la cola de transiciones de bodega. */
  listRecuperarSinOrden() {
    return this._memoList('recuperar', async () => {
      const db = firebase.firestore();
      const now = new Date();
      const [pend, devs] = await Promise.all([
        db.collection('equipos_pool').where('pendiente_devolucion', '==', true).limit(500).get(),
        db.collection('ordenes_de_servicio').where('tipo_de_servicio', '==', 'DEVOLUCION').limit(1000).get(),
      ]);
      const norm = v => String(v || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cubiertos = new Set();
      devs.forEach(d => {
        const o = d.data() || {};
        if (o.eliminado) return;
        if ((o.estado_reparacion || '').toUpperCase() === 'CERRADA (DEVOLUCION)') return;
        (o.devolucion?.esperados || []).forEach(e => { const sr = norm(e.serial); if (sr) cubiertos.add(sr); });
      });
      const rows = [];
      pend.forEach(d => {
        const u = d.data() || {};
        if (!['asignado_contrato', 'en_cliente'].includes(u.estado)) return;
        if (cubiertos.has(norm(u.serial_norm || u.serial || d.id))) return;
        rows.push({
          id: d.id, col: 'equipos_pool',
          serial: u.serial || d.id,
          modelo: u.modelo_label || '—',
          cliente: u.asignacion?.cliente_nombre || '—',
          dias: Math.floor(PendientesDomain.edadDias(u.updated_at, now) || 0),
          ...this._snooze(u), ...this._curso(u),
        });
      });
      return rows.sort((a, b) => b.dias - a.dias);
    });
  },

  // Conteos derivados de las filas (excluyen pospuestas, como el correo).
  async countListasParaEntregar() { return (await this.listListasParaEntregar()).filter(r => !r.pospuesto && !r.viejo).length; },
  async countEstancadas()         { return (await this.listEstancadas()).filter(r => !r.pospuesto).length; },

  /* ── Posponer (fase 3) ─────────────────────────────────────────────────
     Escribe pendiente_snooze EN EL DOCUMENTO FUENTE (orden o unidad del
     pool), nunca en una bandeja — mismo principio que el descarte de
     "Ordenes por crear". Lo respetan esta bandeja Y el correo diario.
     El piso de permisos es firestore.rules: ordenes las escriben los seis
     roles de ordenes; el pool, los roles de puedeGestionarSeriales. Si las
     reglas lo niegan, el error sube y la UI lo dice. */
  async posponerPendiente({ col, id, dias, motivo }) {
    const d = Math.max(1, Math.min(60, Number(dias) || 7));
    const razon = String(motivo || '').trim();
    if (!razon) throw new Error('El motivo es obligatorio: es lo que lee la siguiente persona.');
    const hasta = new Date(Date.now() + d * 86400000).toISOString();
    await firebase.firestore().collection(col).doc(id).update({
      pendiente_snooze: {
        hasta, motivo: razon,
        por_email: firebase.auth().currentUser?.email || '',
        at: firebase.firestore.FieldValue.serverTimestamp(),
      },
    });
    this.invalidarListas();
    return hasta.slice(0, 10);
  },

  /** Deshace un posponer antes de que venza (vuelve a contar de una vez). */
  async reactivarPendiente({ col, id }) {
    await firebase.firestore().collection(col).doc(id).update({
      pendiente_snooze: firebase.firestore.FieldValue.delete(),
    });
    this.invalidarListas();
  },

  /** "Lo estoy trabajando" — visible para todo el rol, sin bloquear a nadie. */
  async tomarPendiente({ col, id }) {
    const u = firebase.auth().currentUser;
    await firebase.firestore().collection(col).doc(id).update({
      pendiente_curso: {
        por_email: u?.email || '', por_uid: u?.uid || '',
        at: new Date().toISOString(),
      },
    });
    this.invalidarListas();
  },

  /** Libera un "en curso" — cualquiera del rol puede (el dueño es el rol:
      si quien lo tomó no está, el pendiente no se queda secuestrado). */
  async soltarPendiente({ col, id }) {
    await firebase.firestore().collection(col).doc(id).update({
      pendiente_curso: firebase.firestore.FieldValue.delete(),
    });
    this.invalidarListas();
  },
};

window.SenalesService = SenalesService;
