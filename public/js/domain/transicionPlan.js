// Plan de transición de equipos — QUÉ pasa con cada unidad del contrato
// original, decidido EN LA VENTA (informe docs/INFORME_TRACKING_SERIAL_2026-08-12.md,
// P1/P2/P5). Fuente ÚNICA del criterio: lo usan el formulario de contrato nuevo
// (nc-form pinta y lee, nc-guardar persiste), la página de seriales ("Traer del
// original") y —del lado del servidor— functions/src/lib/transicionPlanExec.js,
// que lo ejecuta al confirmarse la entrega.
//
// POR QUÉ EXISTE: quien sabe qué continúa, qué se devuelve y qué se reemplaza
// es el VENDEDOR al cerrar el trato — lo escribía en observaciones, como texto
// libre, y el sistema se lo preguntaba a recepción semanas después en la
// pantalla de transición. Resultado medido: 0 linajes y 2 mapeos en toda la
// historia de la base. El plan captura esa decisión donde nace y viaja con el
// contrato.
//
// DOS NIVELES de la misma captura (el vendedor no siempre sabe seriales):
//   · 'serial'   — destino por unidad: {serial, destino}. El nivel fino.
//   · 'cantidad' — por modelo: {continuan, devuelven, reemplazan}. Recepción
//                  resuelve los seriales concretos después, PERO contra un plan
//                  que ya dice cuántos y de qué tipo.
//
// DESTINOS (P5 — lenguaje de continuidad, no de excepción):
//   · continua  — la unidad sigue en servicio bajo el contrato nuevo
//   · devuelve  — sale del servicio (recuperación al entregar)
//   · reemplaza — sale y una unidad nueva toma su lugar (linaje al parear)
//   · no_tiene  — el cliente NO tiene ese equipo (2026-09-04, caso Chino
//                 Panameño: fichas amarradas al cliente por la migración POC
//                 que nadie verificó). Al aprobarse el contrato la ficha se
//                 SUELTA del cliente y cae a "por clasificar" — nunca se
//                 devuelve ni se reclama, porque no hay nada que recuperar.
//
// FUENTE de cada unidad (`fuente`): de dónde salió la fila en el plan —
//   'origen' (pool de un contrato que se renueva), 'custodia' (en_cliente sin
//   contrato), 'migracion' (por_clasificar / sin verificar) o 'agregado' (la
//   tecleó el vendedor al renovar: el cliente lo tiene y el sistema no lo
//   sabía). Es rastro, no regla.
window.TransicionPlan = {

  DESTINOS: ['continua', 'devuelve', 'reemplaza', 'no_tiene'],
  FUENTES: ['origen', 'custodia', 'migracion', 'agregado'],
  DESTINO_LABEL: { continua: 'Continúa', devuelve: 'Se devuelve', reemplaza: 'Se reemplaza', no_tiene: 'El cliente no lo tiene' },

  // El plan aplica donde el original SE SUSTITUYE — mismo corte que
  // OrigenContrato.obligatorio (Renovación/REEMP; la Adición agrega a un
  // contrato vigente y no toca sus unidades).
  aplica(sel) {
    if (!sel) return false;
    return sel.accion === 'Renovación' || sel.codigo_tipo === 'REEMP';
  },

  // Punto de partida honesto por tipo: un REEMPLAZO existe para sustituir
  // (todo 'reemplaza'); una RENOVACIÓN extiende el servicio (todo 'continua').
  // El vendedor ajusta las excepciones — no arma el plan desde cero.
  destinoDefault(sel) {
    return (sel && sel.codigo_tipo === 'REEMP') ? 'reemplaza' : 'continua';
  },

  // Agrega unidades {modelo_id, modelo, destino} → filas por modelo.
  derivarPorModelo(unidades) {
    const filas = new Map();
    for (const u of (unidades || [])) {
      const k = u.modelo_id || (u.modelo || 'sin modelo').toLowerCase();
      if (!filas.has(k)) {
        filas.set(k, { modelo_id: u.modelo_id || null, modelo: u.modelo || '',
          continuan: 0, devuelven: 0, reemplazan: 0, no_tienen: 0, total: 0 });
      }
      const f = filas.get(k);
      f.total++;
      if (u.destino === 'continua') f.continuan++;
      else if (u.destino === 'reemplaza') f.reemplazan++;
      else if (u.destino === 'no_tiene') f.no_tienen++;
      else f.devuelven++;
    }
    return [...filas.values()];
  },

  // Plan nivel 'serial' a partir de las unidades con destino elegido.
  construirSerial(unidades, origenes) {
    const us = (unidades || []).map(u => ({
      pool_id: u.pool_id || null,
      serial: (u.serial || '').toString().trim(),
      serial_norm: (u.serial_norm || u.serial || '').toString().trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
      modelo_id: u.modelo_id || null,
      modelo: u.modelo || '',
      destino: this.DESTINOS.includes(u.destino) ? u.destino : 'devuelve',
      ...(this.FUENTES.includes(u.fuente) ? { fuente: u.fuente } : {}),
      // Modalidad de la línea a la que pertenece (SERV mixto): 'propio' si
      // el equipo es del cliente, 'alquiler' si es de CECOMUNICA.
      ...(u.modalidad === 'propio' || u.modalidad === 'alquiler' ? { modalidad: u.modalidad } : {}),
    })).filter(u => u.serial_norm);
    return {
      nivel: 'serial',
      creado_en: 'venta',
      origenes: origenes || [],
      unidades: us,
      por_modelo: this.derivarPorModelo(us),
    };
  },

  // Plan nivel 'cantidad' a partir de filas por modelo ya contadas.
  construirCantidad(filas, origenes) {
    return {
      nivel: 'cantidad',
      creado_en: 'venta',
      origenes: origenes || [],
      unidades: [],
      por_modelo: (filas || []).map(f => ({
        modelo_id: f.modelo_id || null,
        modelo: f.modelo || '',
        continuan: Math.max(0, Number(f.continuan || 0)),
        devuelven: Math.max(0, Number(f.devuelven || 0)),
        reemplazan: Math.max(0, Number(f.reemplazan || 0)),
        total: Math.max(0, Number(f.total || 0)),
      })),
    };
  },

  // Valida el plan antes de persistir. Devuelve { ok } o { ok:false, mensaje }.
  validar(plan) {
    const p = plan || {};
    if (p.nivel !== 'serial' && p.nivel !== 'cantidad') {
      return { ok: false, mensaje: 'El plan de transición no tiene nivel válido.' };
    }
    if (p.nivel === 'serial') {
      const malo = (p.unidades || []).find(u => !this.DESTINOS.includes(u.destino));
      if (malo) return { ok: false, mensaje: `El serial ${malo.serial || '?'} quedó sin destino — elige continúa, se devuelve o se reemplaza.` };
      return { ok: true };
    }
    for (const f of (p.por_modelo || [])) {
      const suma = Number(f.continuan || 0) + Number(f.devuelven || 0) + Number(f.reemplazan || 0);
      if (suma !== Number(f.total || 0)) {
        return { ok: false, mensaje: `${f.modelo || 'Un modelo'}: las cantidades suman ${suma} pero el original tiene ${f.total}. Tienen que cuadrar.` };
      }
    }
    return { ok: true };
  },

  // Resumen humano — la misma frase en la vista previa, la página de seriales
  // y la de transición, para que el plan se reconozca como una sola cosa.
  resumen(plan) {
    const p = plan || {};
    const t = { continuan: 0, devuelven: 0, reemplazan: 0, no_tienen: 0 };
    for (const f of (p.por_modelo || [])) {
      t.continuan += Number(f.continuan || 0);
      t.devuelven += Number(f.devuelven || 0);
      t.reemplazan += Number(f.reemplazan || 0);
      t.no_tienen += Number(f.no_tienen || 0);
    }
    const agregados = (p.unidades || []).filter(u => u.fuente === 'agregado').length;
    const partes = [];
    if (t.continuan) partes.push(`${t.continuan} continúa${t.continuan === 1 ? '' : 'n'}${agregados ? ` (${agregados} agregado${agregados === 1 ? '' : 's'} por el vendedor)` : ''}`);
    if (t.reemplazan) partes.push(`${t.reemplazan} se reemplaza${t.reemplazan === 1 ? '' : 'n'}`);
    if (t.devuelven) partes.push(`${t.devuelven} se devuelve${t.devuelven === 1 ? '' : 'n'}`);
    if (t.no_tienen) partes.push(`${t.no_tienen} no ${t.no_tienen === 1 ? 'lo' : 'los'} tiene el cliente (se sueltan de la cuenta)`);
    if (!partes.length) return 'Sin unidades en el plan';
    return partes.join(' · ') + (p.nivel === 'cantidad' ? ' (por cantidades — los seriales los resuelve recepción)' : '');
  },

  // ── Conciliación plan ↔ líneas del contrato (2026-09-04) ──
  // Cuenta cuántas unidades 'continua' del plan caen en cada línea del
  // contrato (mismo modelo — id exacto o texto tolerante al sufijo -R — y
  // misma modalidad; una línea sin modalidad es legacy y acepta ambas).
  // Devuelve { porLinea: [{ idx, continuan }], sinLinea: [unidad] }.
  // Lo usa el wizard del Centro para avisar "la línea dice 24 y solo
  // continúan 22" y para el botón "Cuadrar cantidades".
  _claveModelo(s) {
    return String(s || '').toUpperCase().normalize('NFD').replace(/[^A-Z0-9]/g, '').replace(/R$/, '');
  },
  _mismaLinea(u, l) {
    const modU = u.modalidad || 'alquiler';
    if (l.modalidad && l.modalidad !== modU) return false;
    if (u.modelo_id && l.modelo_id && u.modelo_id === l.modelo_id) return true;
    // Ids distintos NO descartan: PNC360S y PNC360S-R son fichas distintas
    // del catálogo (refurbished) y una línea "PNC360S-R" cubre ambas — el
    // mismo criterio tolerante de lib/regularizacion.planAmarre en el servidor.
    const a = this._claveModelo(u.modelo), b = this._claveModelo(l.modelo);
    if (!a || !b) return false;
    return a === b || (a.length >= 3 && b.includes(a)) || (b.length >= 3 && a.includes(b));
  },
  conciliarLineas(plan, lineas) {
    const ls = Array.isArray(lineas) ? lineas : [];
    const porLinea = ls.map((_, idx) => ({ idx, continuan: 0 }));
    const sinLinea = [];
    for (const u of ((plan && plan.unidades) || [])) {
      if (u.destino !== 'continua') continue;
      // Exacto por modelo_id primero; luego el tolerante por texto.
      let idx = ls.findIndex(l => (l.modalidad || 'alquiler') === (u.modalidad || 'alquiler') && u.modelo_id && l.modelo_id && u.modelo_id === l.modelo_id);
      if (idx < 0) idx = ls.findIndex(l => this._mismaLinea(u, l));
      if (idx < 0) { sinLinea.push(u); continue; }
      porLinea[idx].continuan++;
    }
    return { porLinea, sinLinea };
  },
};
