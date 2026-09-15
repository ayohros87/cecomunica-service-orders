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

  /** ¿Está esperando esa firma AHORA? (aprobado y todavía sin firmar) */
  esperando(c) { return this.lleva(c) && c?.estado === 'aprobado' && c.firmado !== true; },

  /** Por qué no la lleva, para decirlo en la pantalla. */
  porQue(c) { return this.SIN_FIRMA[this.codigoTipo(c)]?.porQue || ''; },

  /** Cómo llamarlo en una frase ("el demo espera la entrega"). */
  nombre(c) { return this.SIN_FIRMA[this.codigoTipo(c)]?.nombre || 'contrato'; },
};
