// @ts-nocheck
// Centro de gestión de clientes — Acciones: UN menú, siempre en el mismo sitio.
// Sección de clientes-centro.js (partido el 2026-09-28, auditoría UX §4.3 #13).
// centro-core.js define window.Centro; aquí se le suman estos métodos. El
// orden de carga lo fija js/entry/clientes-centro.js.
Object.assign(window.Centro, {
  /* ═════════ Acciones: UN menú, siempre en el mismo sitio ═════════
     Antes cada acción vivía donde cupo: aprobar en el aviso amarillo,
     editar/anular al pie, la firma en medio del cuerpo, "anular contrato" en
     otro pie y el resto en el footer del modal "Ver contrato". Tres gestiones
     del MISMO cliente enseñaban tres botoneras distintas (M.A.M. PROTECTION,
     2026-09-09: "algunas le sale editar, otra anular… cada vez hay que buscar
     botones en lugares distintos").

     Ahora hay UNA lista por expediente —gestión o contrato—, se pinta en el
     "⋯" de la fila y en el pie del detalle, y lo que NO se puede sale en gris
     con el motivo, nunca escondido. Editar y Anular están SIEMPRE: son las dos
     que se buscan cuando algo salió mal. */

  // Descriptor: { id, label, hint, grupo, ok, motivo, onclick|href|file, danger, primaria }
  _acc(a) { return { grupo: 'Avanzar', ok: true, motivo: '', ...a }; },

  _accionesGestion(g) {
    const id = this.esc(g.id);
    const A = [];
    const puedeG = this.puedeCrearGestion();
    const esBaja = g.tipo === 'baja';
    const esAum = g.tipo === 'aumento';
    const esAct = esAum && g.aumento?.es_regularizacion === true;   // actualización de seriales
    const terminal = ['cerrada', 'anulada'].includes(g.estado);

    // ── Avanzar: lo que mueve el expediente al siguiente paso ──
    // Cambio de MODELO (2026-09-29): bodega puso un radio de otra familia y la
    // gestión volvió a administración. Se decide ESO — el reemplazo ya estaba
    // aprobado —, así que "Aprobar" a secas no aparece: lo que se pregunta es
    // si se acepta el modelo y qué pasa con la tarifa.
    const cambiosModelo = g.estado === 'pendiente_aprobacion' ? GestionesService.cambiosModeloPendientes(g) : [];
    if (cambiosModelo.length) {
      const puede = this.puedeAprobar();
      A.push(this._acc({ id: 'aprobar_cambio_modelo', label: 'Aprobar el cambio de modelo…', primaria: true,
        hint: 'dices si la tarifa del cliente se mantiene; la OS sale sola',
        onclick: `Centro.aprobarCambioModelo('${id}')`, ok: puede, motivo: 'solo administración o gerencia aprueba' }));
      A.push(this._acc({ id: 'rechazar_cambio_modelo', label: 'Rechazar el cambio de modelo…',
        hint: 'bodega pone un radio del modelo aprobado', onclick: `Centro.rechazarCambioModelo('${id}')`,
        ok: puede, motivo: 'solo administración o gerencia decide' }));
    } else if (g.estado === 'pendiente_aprobacion' && GestionesService.esReposicionDano(g)) {
      // DAÑO del cliente: aprobar tiene DOS sentidos y cada uno es su botón.
      // "Rechazar" es Anular, como en cualquier gestión.
      const puede = this.puedeAprobar();
      A.push(this._acc({ id: 'aprobar_cargo', label: 'Aprobar con cargo…', primaria: true,
        hint: 'fijas el monto; se arma la cotización y Bodega espera a que el cliente acepte',
        onclick: `Centro.aprobarConCargoGestion('${id}')`, ok: puede, motivo: 'solo administración o gerencia aprueba' }));
      A.push(this._acc({ id: 'aprobar_cortesia', label: 'Aprobar sin cargo (cortesía)…',
        hint: 'se repone gratis — pide el motivo', onclick: `Centro.aprobarSinCargoGestion('${id}')`,
        ok: puede, motivo: 'solo administración o gerencia aprueba' }));
    } else if (g.estado === 'pendiente_aprobacion') {
      const puede = (esBaja || esAum) ? this.puedeAprobarBaja() : this.puedeAprobar();
      const sinCarta = esBaja && !g.carta_path;
      const fn = esBaja ? 'aprobarBajaGestion' : esAct ? 'aprobarActualizacionSeriales'
        : esAum ? 'aprobarAumentoGestion' : 'aprobarGestion';
      A.push(this._acc({ id: 'aprobar', label: esAct ? 'Aprobar y aplicar' : 'Aprobar', primaria: true,
        hint: esAct ? 'aplica las líneas al contrato y amarra los seriales'
          : esBaja ? 'una sola aprobación, con el desglose por contrato' : 'la gestión pasa al siguiente paso',
        onclick: `Centro.${fn}('${id}')`,
        ok: puede && !sinCarta,
        motivo: !puede ? 'solo administración o gerencia aprueba' : 'falta la carta de solicitud del cliente' }));
    }
    if (g.estado === 'pendiente_cliente') {
      const cot = g.cobro?.cotizacion_doc_id;
      A.push(this._acc({ id: 'cotizacion', label: 'Abrir la cotización de la reposición', primaria: true,
        hint: cot ? `${g.cobro?.cotizacion_id || ''} — ahí se envía y se anota la respuesta del cliente` : 'todavía se está armando',
        href: cot ? `../cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(cot)}` : undefined,
        ok: !!cot, motivo: 'la cotización se está armando — recarga en unos segundos' }));
      A.push(this._acc({ id: 'cobranza', label: 'El cliente no paga → cobranza…', danger: true,
        hint: 'cierra el caso sin reponer el radio y abre la deuda en cobranza',
        onclick: `Centro.cobranzaReposicion('${id}')`,
        ok: !!cot && [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol),
        motivo: !cot ? 'la cotización se está armando' : 'lo decide administración o gerencia' }));
    }
    if (esAct && g.estado === 'pendiente_firma') {
      A.push(this._acc({ id: 'aplicar_sin_firma', label: 'Aplicar sin firma', primaria: true,
        hint: 'las actualizaciones de seriales ya no se firman — se aplican',
        onclick: `Centro.cerrarRegSinFirma('${id}')`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    if (esAum && !esAct && g.estado === 'pendiente_firma') {
      const conEnlace = g.firma_solicitud_estado === 'pendiente';
      A.push(this._acc({ id: 'firma', label: conEnlace ? 'Ver o reenviar el enlace de firma' : 'Enviar anexo para firma por enlace',
        primaria: !conEnlace, hint: conEnlace ? 'el cliente ya lo tiene — se puede reenviar' : 'el cliente firma con el dedo, desde el celular',
        onclick: `Centro.enviarFirmaAnexo('${id}')`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
      A.push(this._acc({ id: 'subir_firmado', label: 'Subir el anexo firmado', hint: 'PDF o foto del papel firmado',
        file: `Centro.subirAnexo('${id}', this.files[0])`, accept: 'application/pdf,image/*',
        ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    if (g.firma_pendiente_validacion) {
      A.push(this._acc({ id: 'firmante', label: 'Aceptar al firmante…', primaria: true,
        hint: 'firmó alguien distinto al representante registrado',
        onclick: `Centro.aceptarFirmanteGestion('${id}')`,
        ok: [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol), motivo: 'lo valida administración o gerencia' }));
    }
    // Bodega. El formulario vive en Almacén · Asignar desde 2026-09-03.
    const esCS = g.tipo === 'cambio_serial';
    const faltanSeriales = !g.ordenes?.programacion_id && !esAct && !g.aumento?.es_ajuste
      && (g.estado === 'pendiente_bodega' || (esAum && g.estado === 'pendiente_firma'));
    if (faltanSeriales) {
      const yaHay = (g.aumento?.seriales_asignados || []).length || (g.demo?.seriales_asignados || []).length
        || (g.items || []).some(i => i.serial_nuevo);
      // El cambio de serial no "asigna" nada: bodega verifica cuál es el serial
      // de verdad. Llamarlo asignar manda a bodega a sacar un radio del estante.
      A.push(this._acc({ id: 'asignar',
        label: esCS ? 'Confirmar el serial en Almacén' : yaHay ? 'Completar seriales en Almacén' : 'Asignar seriales en Almacén',
        primaria: g.estado === 'pendiente_bodega',
        hint: esCS ? 'contra el radio: cuál es el serial de verdad' : 'el picker del estante y la política dura viven allá',
        href: `../almacen/index.html?tab=asignar&g=${encodeURIComponent(g.id)}`,
        ok: this.puedeAsignar(), motivo: 'los seriales los declara bodega (Almacén · Asignar)' }));
    }

    // Corregir los seriales que bodega YA asignó (2026-09-16). Antes de esto,
    // un serial mal puesto —o un radio cambiado en el mostrador— obligaba a
    // anular la gestión entera: la OS sale sola al completarse la asignación y
    // con ella el expediente deja de ser editable. El trabajo es de bodega
    // (tiene el radio en la mano), así que vive en Almacén · Asignar.
    const yaTieneSeriales = (g.aumento?.seriales_asignados || []).some(s => String(s.serial || '').trim())
      || (g.demo?.seriales_asignados || []).some(s => String(s.serial || '').trim())
      || (g.items || []).some(i => i.serial_nuevo);
    if (yaTieneSeriales && !terminal && !esCS) {
      A.push(this._acc({ id: 'corregir_seriales', label: 'Corregir seriales…',
        hint: 'bodega puso otro radio o tecleó mal: se corrigen la gestión, sus órdenes y el inventario',
        href: `../almacen/index.html?tab=asignar&g=${encodeURIComponent(g.id)}&corregir=1`,
        ok: this.puedeAsignar(), motivo: 'los seriales los corrige bodega (Almacén · Asignar)' }));
    }

    // ── Documentos: papeles y órdenes ──
    if (esAum && !esAct) {
      A.push(this._acc({ id: 'imprimir', grupo: 'Documentos', label: 'Imprimir el anexo',
        hint: 'deja explícito el período propio del equipo nuevo', blank: true,
        href: `./anexo-aumento.html?g=${encodeURIComponent(g.id)}` }));
    }
    if (esBaja) {
      A.push(g.carta_path
        ? this._acc({ id: 'ver_carta', grupo: 'Documentos', label: 'Ver la carta del cliente',
            onclick: `Centro.verAnexo('${this.esc(g.carta_path)}')` })
        : this._acc({ id: 'subir_carta', grupo: 'Documentos', label: 'Subir la carta del cliente',
            hint: 'obligatoria: sin ella la baja no se aprueba', accept: 'image/*,application/pdf',
            file: `Centro.subirCarta('${id}', this.files[0])`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    if (g.anexo_firmado_path) {
      A.push(this._acc({ id: 'ver_anexo', grupo: 'Documentos', label: 'Ver el anexo firmado',
        onclick: `Centro.verAnexo('${this.esc(g.anexo_firmado_path)}')` }));
    }
    if (g.anexo_firma_digital) {
      A.push(this._acc({ id: 'ver_firma', grupo: 'Documentos', label: 'Ver la firma del cliente',
        hint: 'trazo, nombre y cédula de quien firmó el anexo',
        onclick: `Centro.verFirmaGestion('${id}')` }));
    }
    const ordenes = [
      ...(g.ordenes?.programacion_ids || (g.ordenes?.programacion_id ? [g.ordenes.programacion_id] : [])).map(x => ['PROGRAMACIÓN', x]),
      ...(g.ordenes?.devolucion_id ? [['DEVOLUCIÓN', g.ordenes.devolucion_id]] : []),
      ...(g.ordenes?.entrada_id ? [['ENTRADA', g.ordenes.entrada_id]] : []),
    ];
    for (const [tipo, oid] of ordenes) {
      A.push(this._acc({ id: `os-${oid}`, grupo: 'Documentos', label: `Ver la orden ${tipo}`, hint: oid,
        href: `../ordenes/editar-orden.html?id=${encodeURIComponent(oid)}` }));
    }

    // ── Corregir: SIEMPRE las dos, con el motivo cuando no se puede ──
    const pEd = GestionesService.puedeEditarse(g);
    A.push(this._acc({ id: 'editar', grupo: 'Corregir', label: 'Editar…',
      hint: 'cantidades, precios, fechas, motivos y qué seriales entran',
      onclick: `Centro.editarGestion('${id}')`,
      ok: puedeG && pEd.ok, motivo: !puedeG ? 'tu rol no edita gestiones' : pEd.motivo }));
    if (g.firma_solicitud_estado === 'pendiente') {
      A.push(this._acc({ id: 'retirar_firma', grupo: 'Corregir', label: 'Retirar el enlace de firma…',
        hint: 'el enlace del cliente deja de servir y el anexo vuelve a poder corregirse',
        onclick: `Centro.retirarFirmaAnexo('${id}')`, ok: puedeG, motivo: 'tu rol no mueve gestiones' }));
    }
    const pAn = GestionesService.puedeAnularse(g, { rol: this.rol, uid: firebase.auth().currentUser?.uid });
    A.push(this._acc({ id: 'anular', grupo: 'Corregir', label: 'Anular gestión…', danger: true,
      hint: g.estado === 'pendiente_aprobacion' ? 'es también el “rechazar” de la aprobación — pide el motivo' : 'pide el motivo y revierte lo que se pueda',
      onclick: `Centro.anularGestion('${id}')`, ok: pAn.ok, motivo: pAn.motivo }));
    void terminal;
    return A;
  },

  _accionesContrato(c) {
    const id = this.esc(c.id);
    const A = [];
    const puedeG = this.puedeCrearGestion();
    const mando = [ROLES.ADMIN, ROLES.GERENTE].includes(this.rol);
    // Un REEMPLAZO no lleva firma (2026-09-15): ni se manda a firmar ni se le
    // sube un firmado. `conEnlace` NO cuelga de esto: si a uno se le mandó un
    // enlace por error, "Retirar el enlace" tiene que seguir estando.
    const esperaFirma = ContratoFirma.esperando(c);
    const conEnlace = c.estado === 'aprobado' && !c.firmado && c.firma_solicitud_estado === 'pendiente';
    const reg = this._regPendiente(c);

    // Cerrar el contrato (2026-09-14): el acuerdo terminó y el equipo ya está
    // en casa. Va PRIMERO y como primaria cuando el sistema lo está pidiendo
    // (`cancelacion_pendiente`) — hasta hoy ese aviso solo salía en el home,
    // apuntando al módulo viejo de contratos, que ya no cancela nada.
    if (ContratoCierre.esCerrable(c)) {
      const enCampo = this.equipos.filter(e => e.asignacion?.contrato_doc_id === c.id).length;
      const pide = !!c.cancelacion_pendiente;
      const temporal = ['TEMP', 'DEMO'].includes(this._codigoTipo(c));
      // Un aprobado que todavía no entregó nada no "terminó": no empezó
      // (auditoría de módulos 2026-09-30, C5: "Cerrar el contrato…" encabezaba
      // el menú de un recién aprobado con 0 en campo). Su salida es Anular.
      const sinEmpezar = c.estado === 'aprobado' && c.entrega_confirmada !== true;
      // Se ofrece cuando el sistema lo pide, cuando es un temporal (no hay otra
      // forma de cerrarlos: "Terminar la cuenta" solo alcanza a los renovables)
      // o cuando no queda un solo radio en campo bajo este contrato.
      if (pide || (!sinEmpezar && (temporal || !enCampo))) {
        A.push(this._acc({ id: 'cerrar', label: 'Cerrar el contrato…', primaria: pide,
          hint: pide ? ContratoCierre.porQue(c)
            : enCampo ? `${enCampo} equipo(s) siguen en campo bajo este contrato`
              : 'el acuerdo terminó y no queda equipo en campo — no mueve ningún radio',
          onclick: `Centro.cerrarContrato('${id}')`, ok: mando, motivo: 'lo cierra administración o gerencia' }));
      }
    }

    // DORMIDO (decisión 7, 1-oct-2026): lo único que avanza es reactivarlo —
    // vendedor o administración; genera un enlace de firma nuevo.
    if (ContratoFirma.dormido(c)) {
      A.push(this._acc({ id: 'reactivar', label: 'Reactivar la solicitud de firma…', primaria: true,
        hint: `dormido ${c.dormido_dias ? `tras ${c.dormido_dias} días` : 'a los 45 días'} sin firma — vuelve a ser trámite y sale un enlace nuevo`,
        onclick: `Centro.reactivarContrato('${id}')`,
        ok: [ROLES.ADMIN, 'admin', ROLES.GERENTE, ROLES.VENDEDOR].includes(this.rol),
        motivo: 'lo reactiva el vendedor o administración' }));
    }
    if (c.estado === 'pendiente_aprobacion') {
      A.push(this._acc({ id: 'aprobar', label: 'Aprobar contrato', primaria: true,
        hint: 'después se le manda a firmar al cliente',
        onclick: `Centro.aprobarContrato('${id}')`, ok: mando, motivo: 'lo aprueba administración o gerencia' }));
    }
    if (esperaFirma) {
      A.push(this._acc({ id: 'firma', label: conEnlace ? 'Ver o reenviar el enlace de firma' : 'Enviar para firma',
        primaria: !conEnlace, hint: conEnlace ? 'el cliente ya lo tiene — se puede reenviar' : 'el cliente firma con el dedo, desde el celular',
        onclick: `Centro.enviarFirma('${id}')`, ok: puedeG && (conEnlace || this._serialesListos(c)),
        motivo: !puedeG ? 'tu rol no mueve contratos' : 'Bodega todavía no asignó los seriales; el anexo saldría vacío' }));
    }
    // "Subir el contrato firmado" ya NO cuelga de esperaFirma (2026-09-10): la
    // rama `activo && !firmado_url` de _aceptaFirmado() era inalcanzable, así
    // que a un contrato ya activo al que le falta el papel no había forma de
    // completarle el expediente desde ninguna pantalla.
    if (this._aceptaFirmado(c)) {
      const yaActivo = c.estado === 'activo';
      A.push(this._acc({ id: 'subir_firmado',
        label: yaActivo ? 'Adjuntar el contrato firmado' : 'Subir el contrato firmado',
        hint: yaActivo ? 'el contrato ya está activo; falta el papel en el expediente' : 'PDF, o fotos que se arman en un solo PDF',
        file: `Centro.subirFirmadoContrato('${id}', this.files)`, accept: 'application/pdf,image/*', multiple: true,
        ok: this._puedeSubirFirmado(), motivo: 'lo sube administración o el vendedor' }));
    }
    if (c.firmado_pendiente_validacion) {
      A.push(this._acc({ id: 'firmante', label: 'Aceptar al firmante…', primaria: true,
        hint: 'firmó alguien distinto al representante registrado',
        onclick: `Centro.aceptarFirmante('${id}')`, ok: mando, motivo: 'lo valida administración o gerencia' }));
    }
    if (c.accion === 'Renovación' && esperaFirma) {
      A.push(this._acc({ id: 'seriales', label: 'Seriales de la cuenta',
        hint: 'cuáles siguen con el cliente, cuáles no tiene y cuáles faltan — antes de la firma',
        onclick: `Centro.wizSerialesRenovacion('${id}')`, ok: puedeG, motivo: 'tu rol no mueve contratos' }));
    }
    if (reg?.motivo === 'sobrantes') {
      A.push(this._acc({ id: 'actualizar', label: 'Actualizar seriales',
        hint: `${reg.sob} radio(s) del cliente sin línea en este contrato`,
        onclick: `Centro.wizAumento('${id}',{regularizar:true})`, ok: puedeG, motivo: 'tu rol no mueve contratos' }));
    }

    A.push(this._acc({ id: 'ver', grupo: 'Documentos', label: 'Ver el contrato', hint: 'líneas, totales, equipos en campo',
      onclick: `Centro.verContrato('${id}')` }));
    A.push(this._acc({ id: 'documento', grupo: 'Documentos', label: 'Documento completo', blank: true,
      hint: esperaFirma ? 'para imprimirlo y recoger la firma en papel' : '',
      href: this._urlDocumento(c) }));
    // El firmado. El enlace vivía SOLO en el archivo /contratos/ y por eso
    // "dentro de la gestión del cliente no aparece el contrato firmado"
    // (Zuleika, 2026-09-10): el PDF estaba en Storage desde siempre, lo que
    // faltaba era la puerta. Papel → el archivo; firma digital → el documento
    // reconstruido, que es donde vive esa firma (no hay PDF que abrir).
    const firmadoAcc = this._accFirmado(c);
    if (firmadoAcc) A.push(firmadoAcc);
    if (c.firmado_tipo === 'digital' && c.firma_solicitud_id) {
      A.push(this._acc({ id: 'ver_firma', grupo: 'Documentos', label: 'Ver la firma del cliente',
        hint: 'trazo, nombre y cédula de quien firmó, contra el representante registrado',
        onclick: `Centro.verFirmaContrato('${id}')` }));
    }

    // Corregir. El criterio de si el contrato admite cambios vive en
    // js/domain/contratoEdicion.js — el mismo que aplica el editor al abrirse.
    // Antes cada uno tenía el suyo: el Centro ofrecía "Editar…" y la página
    // devolvía al usuario con un aviso, o al revés.
    const ed = ContratoEdicion.puedeEditarse(c);
    A.push(this._acc({ id: 'editar', grupo: 'Corregir', label: 'Editar…',
      hint: 'tipo, duración, equipos, cargos y observaciones',
      onclick: `Centro.editarContrato('${id}')`,
      ok: ed.ok && puedeG,
      motivo: !puedeG ? 'tu rol no edita contratos' : ed.texto }));
    if (conEnlace) {
      A.push(this._acc({ id: 'retirar_firma', grupo: 'Corregir', label: 'Retirar el enlace de firma…',
        hint: 'el enlace del cliente deja de servir y el contrato vuelve a poder editarse',
        onclick: `Centro.retirarEnlaceFirma('${id}')`, ok: puedeG, motivo: 'tu rol no mueve contratos' }));
    }
    const anulable = ContratoAnulacion.esAnulable(c);
    A.push(this._acc({ id: 'anular', grupo: 'Corregir', label: 'Anular contrato…', danger: true,
      hint: 'pide el motivo y queda en el historial',
      onclick: `Centro.anularContrato('${id}')`,
      ok: anulable && mando,
      motivo: !anulable ? `un contrato ${this.esc(this._estadoLabel(c).toLowerCase())} ya no se anula desde aquí` : 'lo anula administración o gerencia' }));
    return A;
  },

  // Render del menú (mismos estilos que el de "Nueva gestión": .cg-menu).
  _menuAccionesHtml(acc) {
    const item = (a) => {
      const hint = a.ok ? (a.hint || '') : (a.motivo || 'no se puede ahora');
      const cls = [a.ok ? '' : 'off', a.ok && a.primaria ? 'top' : '', a.ok && a.danger ? 'mal' : ''].filter(Boolean).join(' ');
      const cuerpo = `${this.esc(a.label)}${hint ? `<span class="cg-menu-hint">${hint}</span>` : ''}`;
      if (!a.ok) return `<button type="button" class="${cls}" disabled aria-disabled="true">${cuerpo}</button>`;
      if (a.file) return `<label class="${cls}" style="cursor:pointer; display:block;">${cuerpo}
        <input type="file" ${a.multiple ? 'multiple' : ''} accept="${this.esc(a.accept || '')}" style="display:none;"
          onchange="Centro._cerrarAcciones(); ${a.file}"></label>`;
      if (a.href) return `<a class="${cls}" href="${a.href}"${a.blank ? ' target="_blank" rel="noopener"' : ''}>${cuerpo}</a>`;
      return `<button type="button" class="${cls}" onclick="Centro._cerrarAcciones(); ${a.onclick}">${cuerpo}</button>`;
    };
    return ['Avanzar', 'Documentos', 'Corregir'].map(gr => {
      const xs = acc.filter(a => a.grupo === gr);
      return xs.length ? `<div class="hd">${gr}</div>${xs.map(item).join('')}` : '';
    }).join('');
  },

  // El "⋯" de una fila: SIEMPRE al final, gestión o contrato, abierta o no.
  _masFila(key, acc, etiqueta) {
    if (!acc.length) return '';
    return `<span class="cg-rowacts" onclick="event.stopPropagation();">
      <button type="button" class="cg-masbtn" aria-haspopup="true" title="Acciones"
        aria-label="Acciones de ${this.esc(etiqueta)}" onclick="Centro.toggleAcciones('${this.esc(key)}', event)">⋯</button>
      <div class="cg-menu cg-accmenu hidden" id="accm-${this.esc(key)}">${this._menuAccionesHtml(acc)}</div>
    </span>`;
  },

  // Pie del detalle: el siguiente paso como botón (sale de la MISMA lista) y
  // el resto detrás de "Acciones ⋯", que abre el mismo menú de la fila. Con el
  // expediente abierto el "⋯" de arriba queda lejos; esto lo repite al pie,
  // pero es la misma lista, no otra botonera.
  _pieAcciones(key, acc) {
    const P = acc.find(a => a.primaria && a.ok);
    const btn = !P ? ''
      : P.file
        ? `<label class="btn btn-primary cg-act" style="cursor:pointer;">${this.esc(P.label)}
             <input type="file" ${P.multiple ? 'multiple' : ''} accept="${this.esc(P.accept || '')}" style="display:none;" onchange="${P.file}"></label>`
        : P.href
          ? `<a class="btn btn-primary cg-act" href="${P.href}"${P.blank ? ' target="_blank" rel="noopener"' : ''}>${this.esc(P.label)}</a>`
          : `<button class="btn btn-primary cg-act" onclick="${P.onclick}">${this.esc(P.label)}</button>`;
    return `<span class="cg-rowacts">${btn}
      <button type="button" class="btn btn-ghost cg-act" onclick="Centro.toggleAcciones('${this.esc(key)}', event)">Acciones ⋯</button>
      <div class="cg-menu cg-accmenu cg-up hidden" id="accm-${this.esc(key)}">${this._menuAccionesHtml(acc)}</div></span>`;
  },

  // Un solo menú abierto a la vez (incluidos los dos de la cabecera).
  toggleAcciones(key, ev) {
    ev?.stopPropagation();
    const el = document.getElementById('accm-' + key);
    const abierto = el && !el.classList.contains('hidden');
    this._cerrarAcciones();
    if (!el || abierto) return;
    el.classList.remove('hidden');
    // Posición FIJA calculada desde el botón: el menú vive dentro de filas y
    // de la tabla de contratos, que tiene overflow — ahí un `absolute` se
    // corta a la mitad. Y si abajo no cabe, se abre hacia arriba.
    const btn = ev?.currentTarget?.getBoundingClientRect ? ev.currentTarget : null;
    const r = btn?.getBoundingClientRect();
    if (r) {
      const ancho = el.offsetWidth || 300, alto = el.offsetHeight || 260;
      const izq = Math.max(8, Math.min(window.innerWidth - ancho - 8, r.right - ancho));
      const cabeAbajo = r.bottom + alto + 10 <= window.innerHeight;
      el.style.position = 'fixed';
      el.style.left = `${izq}px`;
      el.style.top = `${cabeAbajo || r.top - alto - 10 < 0 ? r.bottom + 6 : r.top - alto - 6}px`;
      el.style.right = 'auto';
      el.style.bottom = 'auto';
      el.style.maxHeight = `${Math.max(180, window.innerHeight - (cabeAbajo ? r.bottom : 0) - 16)}px`;
    }
    setTimeout(() => {
      document.addEventListener('click', Centro._cerrarAcciones, { once: true });
      window.addEventListener('scroll', Centro._cerrarAcciones, { once: true, capture: true });
    }, 0);
  },
  _cerrarAcciones() {
    document.querySelectorAll('.cg-accmenu:not(.hidden)').forEach(m => {
      m.classList.add('hidden');
      m.style.position = ''; m.style.left = ''; m.style.top = ''; m.style.right = ''; m.style.bottom = ''; m.style.maxHeight = '';
    });
    document.getElementById('cgMenu')?.classList.add('hidden');
    document.getElementById('cgMasMenu')?.classList.add('hidden');
  },
});
