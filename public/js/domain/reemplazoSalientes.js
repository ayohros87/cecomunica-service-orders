// ¿Qué radio sale en un REEMPLAZO? — regla del equipo saliente.
// Fuente ÚNICA del criterio: la usan nc-form.js (pinta la lista y la exigencia),
// nc-preview.js (bloquea el guardado) y nc-guardar.js (persiste
// `reemplaza_seriales`). Del lado del servidor lo consume
// functions/src/triggers/contratos/onEntregaTransicion.js, que reclama esos
// seriales y NO el contrato de origen completo.
//
// POR QUÉ EXISTE (caso REEMP20260825-01 / SEGURIDAD IDEAL, 2026-08-27):
// un reemplazo se define por el RADIO que sustituye, pero el sistema solo
// guardaba el CONTRATO de donde ese radio venía. Al confirmarse la entrega, la
// devolución reclamaba todas las unidades de ese contrato — dos radios de
// febrero que el cliente tenía con todo derecho— en vez del único radio
// sustituido. El dato correcto sí existía: estaba en observaciones, como texto
// libre ("Se reemplaza la radio con número de serie 24813A0527"), donde ningún
// proceso puede leerlo.
//
// Y resuelve el hueco del contrato de papel: el radio saliente está en el pool
// aunque su contrato no esté en el sistema, así que esta pregunta SÍ se puede
// contestar cuando la del contrato original no.
window.ReemplazoSalientes = {

  // Solo los REEMPLAZOS. Una renovación sustituye un contrato entero (y ahí el
  // plan de transición es la herramienta correcta); una adición no sustituye
  // nada. El reemplazo es el único que cambia un radio por otro.
  aplica(sel) {
    return !!sel && sel.codigo_tipo === 'REEMP';
  },

  // Unidades del cliente que pueden ser el saliente. Se ofrece TODA su flota,
  // no solo la del contrato original: el radio dañado puede venir de un
  // contrato de papel, de otro contrato del mismo cliente o de uno vencido, y
  // en los tres casos el vendedor lo reconoce por el serial.
  //
  // `en_taller` entra a propósito: el caso típico es que el radio ya esté en
  // reparación cuando se vende el reemplazo (fue exactamente lo que pasó con
  // 24813A0527, que llevaba 6 días en la OS 2026081905).
  candidatas(unidadesCliente) {
    return (unidadesCliente || [])
      .filter(u => u && (u.serial || u.serial_norm))
      .filter(u => ['asignado_contrato', 'en_cliente', 'en_taller'].includes(u.estado))
      // Los radios del cliente no se "reemplazan" con flota nuestra sin que
      // eso sea otra cosa (una venta, un préstamo). Fuera del universo.
      .filter(u => u.propiedad !== 'cliente')
      .sort((a, b) => String(a.modelo_label || '').localeCompare(String(b.modelo_label || ''))
        || String(a.serial || '').localeCompare(String(b.serial || '')));
  },

  // Valida la selección del formulario.
  // sel = { codigo_tipo, sin_identificar, seriales[], candidatos }
  // Devuelve { ok } o { ok:false, motivo, mensaje }.
  validar(sel) {
    const s = sel || {};
    if (!this.aplica(s)) return { ok: true };
    if (s.sin_identificar) return { ok: true };
    if ((s.seriales || []).length) return { ok: true };

    // Sin candidatos no se puede exigir lo imposible — se manda al escape,
    // igual que hace OrigenContrato con el contrato de papel.
    if (!Number(s.candidatos || 0)) {
      return {
        ok: false,
        motivo: 'sin_candidatos',
        mensaje: 'Este cliente no tiene equipos nuestros registrados. '
               + 'Marca «No se identifica el equipo saliente» y recepción lo define al entregar.',
      };
    }
    return {
      ok: false,
      motivo: 'falta_saliente',
      mensaje: 'Marca cuál es el equipo que se reemplaza. '
             + 'De ahí sale el radio que el cliente debe entregar — sin él, el sistema no sabe cuál pedir.',
    };
  },

  // Lo que se guarda en el contrato. Array vacío = "no se identificó",
  // que es una respuesta distinta de "no se preguntó" (campo ausente): el
  // trigger trata el array vacío como "no reclames nada automáticamente".
  construir(unidades) {
    return (unidades || []).map(u => ({
      serial: String(u.serial || u.serial_norm || '').trim(),
      serial_norm: String(u.serial_norm || u.serial || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, ''),
      pool_id: u.id || u.pool_id || null,
      modelo: u.modelo_label || u.modelo || '',
      modelo_id: u.modelo_id || null,
      contrato_doc_id: (u.asignacion && u.asignacion.contrato_doc_id) || null,
      contrato_id: (u.asignacion && u.asignacion.contrato_id) || null,
    })).filter(u => u.serial_norm);
  },
};
