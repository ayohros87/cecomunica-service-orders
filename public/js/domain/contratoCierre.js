// Cierre de un contrato — fuente ÚNICA de la escritura en el front.
// Espejo de functions/src/domain/cierreContrato.js (si cambia uno, cambia el
// otro). La usa el Centro de gestión (clientes-centro.js); el backend la aplica
// solo cuando la ENTRADA devuelve todo un temporal o cuando se desactiva al
// cliente.
//
// CERRAR ≠ ANULAR (js/domain/contratoAnulacion.js):
//   · anular deshace el papel — puede abrir una DEVOLUCIÓN para recuperar
//     equipos, y deja el contrato como si no hubiera valido.
//   · cerrar reconoce que el acuerdo llegó a su fin con el equipo YA de vuelta.
//     No mueve un solo radio. Terminal 'vencido', el mismo de la terminación
//     total de la cuenta.
//
// Por qué existe (2026-09-14, FANLYC/TEMP20260902-01): un contrato TEMPORAL o
// un DEMO no tenían forma de cerrarse. "Terminar la cuenta" solo alcanza a los
// renovables (SERV/ALQ/PROP/REEMP) y a los temporales se los dejaba fuera con
// un "terminan por su propio flujo" que nunca se escribió.
window.ContratoCierre = {

  ESTADOS_VIGENTES: ['activo', 'aprobado'],

  // Se cierra un contrato VIVO. Uno en trámite no se vence: se aprueba o se
  // anula. Uno ya cerrado (vencido/anulado/terminado) no se vuelve a cerrar.
  esCerrable(c) { return !!c && this.ESTADOS_VIGENTES.includes(c.estado); },

  /**
   * ¿Se le ofrece "Cerrar" a este contrato, y con qué advertencia?
   * @param {Object} c        contrato
   * @param {number} enCampo  unidades suyas todavía con el cliente
   * @returns {{ok:boolean, motivo:string, aviso:string}}
   *   `aviso` no bloquea: cerrar con equipo en campo es legítimo (el radio
   *   puede haber vuelto sin registrarse), pero hay que decirlo en voz alta.
   */
  evaluar(c, enCampo) {
    if (!this.esCerrable(c)) {
      return { ok: false, motivo: `un contrato ${c?.estado || ''} ya no se cierra`, aviso: '' };
    }
    return {
      ok: true,
      motivo: '',
      aviso: enCampo > 0
        ? `Este contrato todavía tiene <b>${enCampo} equipo(s) en campo</b>. Cerrarlo no los recupera ni abre una devolución — si el cliente los tiene de verdad, primero haz la baja.`
        : '',
    };
  },

  // Texto que explica por qué el sistema lo está pidiendo, para el modal.
  porQue(c) {
    const cp = c?.cancelacion_pendiente;
    if (!cp) return '';
    const n = Array.isArray(cp.seriales) ? cp.seriales.length : 0;
    if (cp.motivo === 'conteo_bodega') return `${n} equipo(s) de este contrato aparecieron en el conteo de bodega.`;
    if (cp.motivo === 'temporal_vencido') return 'Temporal/demo vencido, sin equipo asignado ni devolución registrada.';
    return `${n} equipo(s) volvieron en la entrada ${cp.orden_numero || cp.orden_entrada_id || ''}.`;
  },

  // Payload del update. Mismos campos que buildCierre del backend.
  buildUpdate(c, { motivo, uid }) {
    return {
      estado: 'vencido',
      estado_previo: c?.estado || null,
      vencido_at: firebase.firestore.Timestamp.now(),
      vencido_motivo: String(motivo || '').trim(),
      vencido_por_uid: uid || firebase.auth().currentUser?.uid || null,
      fecha_fin: firebase.firestore.Timestamp.now(),
      cancelacion_pendiente: firebase.firestore.FieldValue.delete(),
      fecha_modificacion: new Date(),
    };
  },
};
