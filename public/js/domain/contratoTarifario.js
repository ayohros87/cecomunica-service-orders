// @ts-nocheck
// Tarifario y documento del contrato — lógica PURA compartida entre el
// formulario clásico (nuevo-contrato: nc-form/nc-guardar) y el wizard del
// Centro de gestión (clientes-centro). Extraída 2026-08-27 para que ambas
// vías produzcan EXACTAMENTE el mismo doc de `contratos`: todo lo que corre
// aguas abajo (aprobación, solicitud de seriales, PDF, firmado→activo,
// vigencia) reacciona al cambio de estado y es ciego a quién lo creó.
// Requiere: FMT, ContractTotals (js/domain/totales.js), OrigenContrato.
window.ContratoTarifario = {

  // Totales del contrato: mensual = equipos + cargos recurrentes (+ITBMS);
  // el primer pago suma además los cargos únicos. Misma aritmética que
  // usaban nc-form.recalcularTotalesContrato y Centro._totAumento por
  // separado — ahora una sola.
  // equipos: [{cantidad, precio}] o el subtotal ya sumado (número).
  // cargos: [{monto, cantidad, recurrente}]
  totales(equipos, cargos, itbmsAplica, itbmsRate = FMT.ITBMS_RATE) {
    const equiposSub = FMT.round2(typeof equipos === 'number' ? equipos
      : (equipos || []).reduce((s, e) =>
          s + (Number(e.cantidad) || 0) * (Number(e.precio) || 0), 0));
    let cargosRec = 0, cargosUni = 0;
    (cargos || []).forEach(c => {
      const t = (Number(c.monto) || 0) * (Number(c.cantidad) || 1);
      if (c.recurrente) cargosRec += t; else cargosUni += t;
    });
    cargosRec = FMT.round2(cargosRec); cargosUni = FMT.round2(cargosUni);

    const mensual = ContractTotals.compute(FMT.round2(equiposSub + cargosRec), itbmsAplica, itbmsRate);
    const inicial = ContractTotals.compute(FMT.round2(equiposSub + cargosRec + cargosUni), itbmsAplica, itbmsRate);
    const itbmsUni = Math.max(0, FMT.round2(inicial.itbmsMonto - mensual.itbmsMonto));
    return {
      // Compat con el retorno histórico de recalcularTotalesContrato: estos
      // campos reflejan el MENSUAL (equipos + cargos recurrentes).
      subtotal: mensual.subtotal, itbmsAplica: mensual.itbmsAplica, itbmsPorc: mensual.itbmsPorc,
      itbmsMonto: mensual.itbmsMonto, totalConITBMS: mensual.totalConITBMS, itbmsLabel: mensual.itbmsLabel,
      // Detalle adicional:
      equiposSub, cargosRec, cargosUni, itbmsUni,
      subtotalInicial: inicial.subtotal, itbmsInicial: inicial.itbmsMonto, primerPago: inicial.totalConITBMS,
    };
  },

  // Construye el doc de `contratos` — el bloque que vivía inline en
  // nc-guardar.js. La forma es sagrada: es lo que toda la plataforma lee.
  // d = {
  //   contrato_id, searchTokens,
  //   cliente: {id, nombre, direccion, telefono, ruc, dv, representante, representante_cedula},
  //   codigo_tipo, tipo_contrato, accion,
  //   renovacion_sin_equipo, renovacion_refurbished_componentes,
  //   origenSel (forma de OrigenContrato.validar), transicion_plan|null,
  //   reemplaza_seriales|null, duracion ("N meses"), duracion_meses?,
  //   observaciones, equipos[], cargos[], itbms_aplica, creado_por_uid
  // }
  construirDoc(d) {
    const cli      = d.cliente || {};
    const esRenov  = d.accion === 'Renovación';
    const sinEq    = esRenov && !!d.renovacion_sin_equipo;
    const refurb   = esRenov && sinEq && !!d.renovacion_refurbished_componentes;
    const equipos  = (d.equipos || []).map(e => ({
      modelo_id: e.modelo_id || '',
      modelo: e.modelo || '',
      descripcion: (e.descripcion || '').trim() || 'Equipos de Comunicación',
      cantidad: parseInt(e.cantidad || 0, 10) || 0,
      precio: Number(e.precio || 0),
      // SERV mixto (2026-09-01): 'propio' = equipo del cliente (tarifa de
      // servicio); 'alquiler' = equipo de CECOMUNICA. Ausente en legacy.
      ...(e.modalidad ? { modalidad: e.modalidad } : {}),
    }));
    const cargos   = Array.isArray(d.cargos) ? d.cargos : [];
    const tot      = this.totales(equipos, cargos, !!d.itbms_aplica);
    const origen   = d.origenSel || {};
    const origenIds  = Array.isArray(origen.origen_ids) ? origen.origen_ids.filter(Boolean) : [];
    const origenRefs = Array.isArray(origen.origen_refs) ? origen.origen_refs.filter(Boolean) : [];

    const doc = {
      contrato_id: d.contrato_id,
      cliente_id: cli.id,
      cliente_nombre: cli.nombre || '',
      cliente_nombre_lower: (cli.nombre || '').toLowerCase(),
      searchTokens: d.searchTokens || [],
      cliente_direccion: cli.direccion || '',
      cliente_telefono: cli.telefono || '',
      cliente_ruc: cli.ruc || '',
      cliente_dv: cli.dv || '',
      cliente_rucdv: (cli.ruc || '') + (cli.dv ? ' - DV' + cli.dv : ''),
      representante: cli.representante || '',
      representante_cedula: cli.representante_cedula || '',
      duracion: d.duracion,
      codigo_tipo: d.codigo_tipo,
      tipo_contrato: d.tipo_contrato,
      accion: d.accion,
      renovacion_sin_equipo: sinEq,
      renovacion_refurbished_componentes: refurb,
      renovacion_modalidad: esRenov ? (sinEq ? 'Renovación sin equipo' : 'Renovación con equipo') : '',
      origen_tipo: OrigenContrato.tipoDe(origen),
      contrato_origen_id: origenIds[0] || null,
      contrato_origen_ref: origenRefs[0] || '',
      contrato_origen_ids: origenIds,
      contrato_origen_refs: origenRefs,
      origen_legacy_ref: origen.legacy ? (origen.legacy_ref || '') : '',
      transicion_plan: d.transicion_plan || null,
      // `[]` = "no se identificó" (una respuesta) ≠ `null` = "no aplica".
      reemplaza_seriales: (d.reemplaza_seriales !== undefined) ? d.reemplaza_seriales : null,
      estado: 'pendiente_aprobacion',
      observaciones: (d.observaciones || '').trim(),
      equipos,
      cargos,
      total_equipos: equipos.reduce((acc, e) => acc + Number(e.cantidad || 0), 0),
      subtotal: tot.subtotal,
      itbms_aplica: tot.itbmsAplica,
      itbms_porcentaje: FMT.ITBMS_RATE,
      itbms_monto: FMT.round2(tot.itbmsMonto),
      total_con_itbms: FMT.round2(tot.totalConITBMS),
      subtotal_equipos: FMT.round2(tot.equiposSub),
      cargos_recurrente: FMT.round2(tot.cargosRec),
      cargos_unico: FMT.round2(tot.cargosUni),
      total_mensual: FMT.round2(tot.totalConITBMS),
      primer_pago: FMT.round2(tot.primerPago),
      total: FMT.round2(tot.totalConITBMS),
      fecha_creacion: new Date(),
      fecha_modificacion: new Date(),
      deleted: false,
      creado_por_uid: d.creado_por_uid,
    };
    // Aditivo 2026-08-27 (wizard del Centro): la duración también como número.
    // El string " meses" vacío de la duración "Otro" dejó 53 contratos sin
    // vencimiento calculable; el número no puede quedar vacío.
    if (Number(d.duracion_meses) > 0) doc.duracion_meses = Number(d.duracion_meses);
    return doc;
  },
};
