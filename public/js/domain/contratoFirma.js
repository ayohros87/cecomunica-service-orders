// ¿Este contrato lleva firma del cliente? — fuente ÚNICA del front.
// Espejo de functions/src/domain/contratoFirma.js (si cambia uno, cambia el
// otro) y de contratoLlevaFirma() en firestore.rules.
//
// Por qué existe (2026-09-15, caso Brenda / MACELLO S.A., OS 2026090310):
// un contrato de REEMPLAZO no le pide nada al cliente. No es un acuerdo nuevo
// —no hay precio nuevo, ni plazo nuevo, ni obligación nueva—: sustituye una
// unidad por otra bajo el contrato que el cliente YA firmó. Aun así, el
// candado de firma de la entrega (2026-09-03, requerimiento de Zuleika) lo
// trataba como a cualquier otro contrato y dejaba los radios trancados en la
// orden: 79 de los 82 REEMP del sistema están SIN firmar, y esa es su forma
// normal — no un pendiente. Brenda quedó persiguiendo una firma que no existe
// mientras los 3 radios ya estaban en poder del cliente desde el 4 de
// septiembre.
//
// Y firmarlo no es inocuo: al firmarse, el contrato pasa a `activo` y
// onApproval le crea un aviso de facturación `contrato_activo` con su
// comisión — un cobro que nadie pactó, por unos radios que solo cambiaron de
// número de serie. Por eso el Centro tampoco ofrece ya "subir el firmado" de
// un REEMP. Lo mismo vale para el DEMO, que entró en la segunda vuelta del
// mismo repaso: ver SIN_FIRMA.
window.ContratoFirma = {

  // Tipos de contrato que NO llevan firma del cliente, y por qué — el motivo
  // se pinta en pantalla, así que vive con la regla y no suelto en cada vista.
  SIN_FIRMA: {
    REEMP: {
      nombre: 'reemplazo',
      porQue: 'un reemplazo no lleva firma: sustituye una unidad por otra bajo el contrato que el cliente ya firmó',
    },
    // Demo (2026-09-15, segunda vuelta): 14 de 14 demos entregados nunca se
    // firmaron y ninguno llegó a `activo`. Y el sistema ya se contradecía solo:
    // un demo creado como GESTIÓN no tiene paso de firma (CIERRE_DEFS.demo),
    // pero el mismo demo creado como CONTRATO exigía firma para entregar.
    DEMO: {
      nombre: 'demo',
      porQue: 'un demo no lleva firma: es un préstamo de evaluación — la custodia la documentan la nota de entrega y el retorno',
    },
  },

  // Mismo criterio que Centro._codigoTipo / regularizacion.codigoTipo: el
  // campo manda, el nombre es el respaldo, y el prefijo del número es el
  // último recurso (no es confiable por sí solo — REEMP20251024 se numeró
  // ALQ20251024-01 por error y sigue siendo un reemplazo).
  codigoTipo(c) {
    if (c?.codigo_tipo) return c.codigo_tipo;
    const m = { Servicio: 'SERV', Alquiler: 'ALQ', Propio: 'PROP', Reemplazo: 'REEMP', Demo: 'DEMO', Temporal: 'TEMP' };
    if (m[c?.tipo_contrato]) return m[c.tipo_contrato];
    const x = String(c?.contrato_id || '').match(/^[A-Z]+/);
    return x ? x[0] : null;
  },

  /** ¿Este contrato lleva la firma del cliente? */
  lleva(c) { return !this.SIN_FIRMA[this.codigoTipo(c)]; },

  /** ¿Está esperando esa firma AHORA? (aprobado, sin firmar y no dormido) */
  esperando(c) { return this.lleva(c) && c?.estado === 'aprobado' && c.firmado !== true && !this.dormido(c); },

  // DORMIDO (decisión 7 de Alberto, 1-oct-2026): aprobado sin firmar a los 45
  // días. El cron caduca la solicitud y marca el contrato; para todos los
  // efectos es como si no existiera — un borrador que el vendedor reactiva
  // desde el Centro. Espejo de functions/src/domain/contratoDormido.js.
  DIAS_DORMIDO: 45,
  dormido(c) { return c?.dormido === true; },

  // Días que lleva esperando la firma, desde la APROBACIÓN (Alberto,
  // 2-oct-2026) — o desde la reactivación, si el vendedor despertó un
  // dormido. Un enlace reenviado ya no reinicia el reloj. Misma fórmula que
  // el cron: lo que la señal dice que lleva es lo que el cron mide.
  diasEsperando(c, now = new Date()) {
    const aDate = (v) => !v ? null : (v.toDate ? v.toDate() : (typeof v.seconds === 'number' ? new Date(v.seconds * 1000) : new Date(v)));
    const ts = [c?.dormido_reactivado_at, c?.fecha_aprobacion]
      .map(aDate).filter(d => d && !isNaN(d));
    const base = ts.length ? new Date(Math.max(...ts.map(d => d.getTime()))) : aDate(c?.fecha_creacion);
    if (!base || isNaN(base)) return null;
    return Math.floor((now - base) / 86400000);
  },

  // ENTREGADO CON LA FIRMA PENDIENTE (2026-11-11, pedido de Brenda): recepción
  // entregó los radios dejando la firma digital de quien recibe y el contrato
  // sigue sin firmar. La marca `entrega_sin_firma` la estampa onOrdenEntregada;
  // el estado se DERIVA, así que se apaga solo cuando el contrato se firma.
  // Sin la marca —lo entregado antes de esa fecha— no cuenta: es histórico.
  // Espejo de functions/src/domain/contratoFirma.js.
  entregadoSinFirma(c) {
    return !!c?.entrega_sin_firma && c.deleted !== true && this.lleva(c)
      && c.estado === 'aprobado' && c.firmado !== true;
  },

  // Días de CALENDARIO (Panamá, UTC-5) desde esa entrega: lo que dice la
  // pantalla es lo que dice el recordatorio diario al vendedor.
  diasEntregadoSinFirma(c, now = new Date()) {
    const aDate = (v) => !v ? null : (v.toDate ? v.toDate() : (typeof v.seconds === 'number' ? new Date(v.seconds * 1000) : new Date(v)));
    const m = c?.entrega_sin_firma || {};
    const f = [m.fecha_entrega, m.at, c?.fecha_entrega_ultima].map(aDate).find(d => d && !isNaN(d));
    if (!f) return null;
    const dia = (d) => Math.floor((d.getTime() - 5 * 3600000) / 86400000);
    return Math.max(0, dia(now) - dia(f));
  },

  // ── FORMALIZACIÓN POR ORDEN DE COMPRA (2026-11-18, Alberto) ──────────────
  // Hay clientes de gobierno y corporativos que no firman nuestro contrato:
  // formalizan con su ORDEN DE COMPRA (o un contrato hecho por la entidad), y
  // en gobierno esa OC además se REFRENDA en la Contraloría. Para ellos la OC
  // ocupa el lugar de la firma: subirla cumple el requisito por la MISMA vía
  // que el "subir firmado" (firmado=true + firmado_url, activa el contrato),
  // así el candado de la entrega, la activación, la facturación y la comisión
  // no cambian — ni las rules, que están en el 66% del tope de expresiones.
  // Nuestro contrato sigue visible como términos estándar de referencia.
  //
  // Decisiones de Alberto (18-nov-2026):
  //  · se entrega con la OC aunque el refrendo no haya llegado — el refrendo
  //    queda como pendiente aparte, no frena nada;
  //  · se marca por CLIENTE (clientes.formalizacion_contrato) y el contrato la
  //    copia al nacer; se puede cambiar en un contrato puntual;
  //  · el monto de la OC debe CUADRAR con el contrato;
  //  · 90 días para dormirse (no 45): una OC de gobierno tarda;
  //  · la sube el vendedor (o administración), igual que el firmado;
  //  · las renovaciones también llevan OC nueva (nacen por la misma vía).
  // Espejo de functions/src/domain/contratoFirma.js.
  FORMALIZACION: {
    oc_gobierno: { tipo: 'orden_compra', sector: 'gobierno', label: 'Orden de compra refrendada (gobierno)' },
    oc_corporativo: { tipo: 'orden_compra', sector: 'corporativo', label: 'Orden de compra (corporativo)' },
  },
  DIAS_DORMIDO_OC: 90,
  // Diferencia que se tolera entre la OC y el contrato (redondeos del ITBMS).
  TOLERANCIA_OC: 1,

  /** Formalización que le toca a un contrato NUEVO de este cliente (objeto para el doc, o null = firma). */
  formalizacionDeCliente(cli) {
    const f = this.FORMALIZACION[cli?.formalizacion_contrato];
    return f ? { tipo: f.tipo, sector: f.sector, origen: 'cliente' } : null;
  },
  /** Clave del selector ('firma' | 'oc_gobierno' | 'oc_corporativo') de un contrato. */
  claveFormalizacion(c) {
    const f = c?.formalizacion;
    if (f?.tipo !== 'orden_compra') return 'firma';
    return f.sector === 'gobierno' ? 'oc_gobierno' : 'oc_corporativo';
  },
  /** ¿Se formaliza con orden de compra en vez de firma? */
  esOC(c) { return this.lleva(c) && c?.formalizacion?.tipo === 'orden_compra'; },
  /** ¿Es OC de gobierno (lleva refrendo)? */
  esGobierno(c) { return this.esOC(c) && c.formalizacion.sector === 'gobierno'; },
  /** OC de gobierno ya registrada, todavía sin el refrendo de la Contraloría. */
  refrendoPendiente(c) {
    return this.esGobierno(c) && c.firmado === true && !!c.orden_compra && !c.orden_compra.refrendo
      && c.deleted !== true && !['anulado', 'vencido', 'cancelado'].includes(c.estado);
  },
  /** Días para dormirse según cómo se formaliza. */
  diasDormido(c) { return this.esOC(c) ? this.DIAS_DORMIDO_OC : this.DIAS_DORMIDO; },
  /** Lo que se espera del cliente, para las frases ("espera la orden de compra"). */
  requisito(c) {
    if (!this.esOC(c)) return 'la firma del cliente';
    return this.esGobierno(c) ? 'la orden de compra (refrendada)' : 'la orden de compra';
  },

  // Meses del contrato: el derivado si está, si no el texto ("18 meses").
  // Un contrato por DÍAS no tiene meses: null.
  _meses(c) {
    if (Number(c?.duracion_dias) > 0) return null;
    if (Number(c?.duracion_meses) > 0) return Number(c.duracion_meses);
    const s = String(c?.duracion || '').toLowerCase();
    if (/d[ií]a/.test(s)) return null;
    const n = parseInt(s.replace(/\D/g, ''), 10);
    return n > 0 ? n : null;
  },
  /**
   * Monto que la OC debe cubrir: el primer pago (mensualidad + cargos únicos)
   * más las mensualidades restantes del plazo. {monto, detalle} o null si el
   * contrato no permite calcularlo (por días, sin plazo).
   */
  //  opts.meses     — la OC cubre solo esos meses (OC parcial; por defecto, todo el plazo)
  //  opts.siguiente — es una OC SIGUIENTE: sin primer pago, solo mensualidades
  montoEsperadoOC(c, { meses: mesesOC, siguiente = false } = {}) {
    const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
    const mensual = Number(c?.total_mensual ?? c?.total_con_itbms ?? 0);
    const primer = Number(c?.primer_pago ?? mensual);
    if (Number(c?.duracion_dias) > 0) {
      // Un temporal por días se cobra entero en el primer pago.
      return primer > 0 ? { monto: r2(primer), detalle: `${Number(c.duracion_dias)} día(s): el total del contrato` } : null;
    }
    const plazo = this._meses(c);
    if (!plazo || !(mensual > 0 || primer > 0)) return null;
    const meses = Number(mesesOC) > 0 ? Math.min(Number(mesesOC), plazo) : plazo;
    if (siguiente) {
      return { monto: r2(mensual * meses), detalle: `${meses} × $${mensual.toFixed(2)}` };
    }
    const monto = r2(primer + mensual * (meses - 1));
    const detalle = primer !== mensual
      ? `primer pago $${primer.toFixed(2)} + ${meses - 1} × $${mensual.toFixed(2)}`
      : `${meses} × $${mensual.toFixed(2)}`;
    return { monto, detalle };
  },
  /** {ok, esperado, diferencia, detalle} — ok=null si no hay con qué comparar. */
  cuadraOC(c, monto, opts = {}) {
    const e = this.montoEsperadoOC(c, opts);
    if (!e) return { ok: null, esperado: null, diferencia: null, detalle: '' };
    const diferencia = Math.round((Number(monto) - e.monto) * 100) / 100;
    return { ok: Math.abs(diferencia) <= this.TOLERANCIA_OC, esperado: e.monto, diferencia, detalle: e.detalle };
  },

  // ── ¿Este contrato está EN TRÁMITE de formalizarse? (2026-11-18) ──
  // Es el único universo al que se le puede cambiar firma ↔ OC, sea desde la
  // ficha del cliente o en el contrato puntual. Lo que NO entra, a propósito:
  //  · lo ya formalizado (firmado, con OC, firma por validar) y lo activo;
  //  · el HISTÓRICO 'aprobado' sin firma — seriales 'legacy', o sin circuito
  //    de seriales, o entregado antes de que existiera la marca de "entregado
  //    sin firma". Son ~180 contratos (nov-2026) que operan así desde siempre;
  //    marcarlos con OC les ofrecería "Subir la OC", y subirla los ACTIVARÍA
  //    y arrancaría a facturar. Eso es dañar lo que ya existe.
  //  · REEMP/DEMO (no llevan nada).
  enTramiteFormalizacion(c) {
    if (!c || c.deleted === true || !this.lleva(c)) return false;
    if (c.firmado === true || c.firmado_pendiente_validacion) return false;
    if (c.estado === 'pendiente_aprobacion') return true;
    if (c.estado !== 'aprobado') return false;
    if (!c.seriales_estado || c.seriales_estado === 'legacy') return false;
    if (c.entrega_confirmada === true && !c.entrega_sin_firma) return false;
    return true;
  },

  // ── OC PARCIAL (2026-11-18): la entidad emite una OC por año fiscal ──
  // Una OC puede cubrir solo N de los M meses del contrato. La primera cubre
  // el primer pago + (N−1) mensualidades; las SIGUIENTES, N mensualidades.
  // Lo cubierto se acumula en `oc_meses_cubiertos`; cuando no alcanza el
  // plazo, el Centro pide la OC siguiente antes de que venza la vigente.
  mesesContrato(c) { return this._meses(c); },
  mesesCubiertosOC(c) { return Number(c?.oc_meses_cubiertos || 0); },
  /** ¿Falta OC para el resto del plazo? */
  ocParcial(c) {
    const m = this._meses(c);
    return this.esOC(c) && c?.firmado === true && !!c.orden_compra && !!m && this.mesesCubiertosOC(c) > 0
      && this.mesesCubiertosOC(c) < m && !['anulado', 'vencido', 'cancelado'].includes(c.estado) && c.deleted !== true;
  },
  /** Días que le quedan a la OC vigente (negativo = vencida), o null. */
  diasOCVigente(c, now = new Date()) {
    const h = c?.orden_compra?.cubre_hasta;
    if (!h) return null;
    const d = new Date(`${h}T12:00:00-05:00`);
    if (isNaN(d)) return null;
    return Math.ceil((d - now) / 86400000);
  },
  DIAS_AVISO_OC_SIGUIENTE: 30,
  /** "YYYY-MM-DD" N meses después de `desde` (Date), en hora de Panamá. */
  sumarMeses(desde, n) {
    const d = new Date(desde.getTime() - 5 * 3600000);
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + Number(n), dia = d.getUTCDate();
    const fin = new Date(Date.UTC(y, m, 1));
    const ultimo = new Date(Date.UTC(fin.getUTCFullYear(), fin.getUTCMonth() + 1, 0)).getUTCDate();
    fin.setUTCDate(Math.min(dia, ultimo));
    return fin.toISOString().slice(0, 10);
  },

  // ── ANEXO DE AUMENTO con orden de compra (2026-11-18) ──
  // La gestión copia al nacer la formalización del cliente (no la del marco:
  // lo que manda es cómo trabaja HOY el cliente). Las actualizaciones de
  // seriales (es_regularizacion) no se firman ni llevan OC.
  anexoEsOC(g) {
    return g?.tipo === 'aumento' && g?.formalizacion?.tipo === 'orden_compra' && g?.aumento?.es_regularizacion !== true;
  },
  anexoEsGobierno(g) { return this.anexoEsOC(g) && g.formalizacion.sector === 'gobierno'; },
  anexoRefrendoPendiente(g) {
    return this.anexoEsGobierno(g) && !!g.orden_compra && !g.orden_compra.refrendo
      && g.deleted !== true && g.estado !== 'anulada';
  },
  /** Lo que la OC del anexo debe cubrir: sus totales por sus meses. */
  montoEsperadoAnexoOC(g, { meses } = {}) {
    const a = g?.aumento || {};
    const t = a.totales || {};
    const mensual = Number(t.total_mensual ?? t.totalMensual ?? 0);
    const primer = Number(t.primer_pago ?? t.primerPago ?? mensual);
    const plazo = Number(a.duracion_meses || 0);
    const n = Number(meses) > 0 ? Math.min(Number(meses), plazo || Number(meses)) : plazo;
    if (!(n > 0) || !(mensual > 0 || primer > 0)) return null;
    const r2 = (x) => Math.round(x * 100) / 100;
    return { monto: r2(primer + mensual * (n - 1)), detalle: primer !== mensual
      ? `primer pago $${primer.toFixed(2)} + ${n - 1} × $${mensual.toFixed(2)}` : `${n} × $${mensual.toFixed(2)}` };
  },
  cuadraAnexoOC(g, monto, opts = {}) {
    const e = this.montoEsperadoAnexoOC(g, opts);
    if (!e) return { ok: null, esperado: null, diferencia: null, detalle: '' };
    const diferencia = Math.round((Number(monto) - e.monto) * 100) / 100;
    return { ok: Math.abs(diferencia) <= this.TOLERANCIA_OC, esperado: e.monto, diferencia, detalle: e.detalle };
  },

  /** Por qué no la lleva, para decirlo en la pantalla. */
  porQue(c) { return this.SIN_FIRMA[this.codigoTipo(c)]?.porQue || ''; },

  /** Cómo llamarlo en una frase ("el demo espera la entrega"). */
  nombre(c) { return this.SIN_FIRMA[this.codigoTipo(c)]?.nombre || 'contrato'; },
};
