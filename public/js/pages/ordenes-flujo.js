// @ts-nocheck
/* ========================================
 * ORDENES FLUJO - Lifecycle transitions
 * Asignar / Completar / Entregar / Eliminar / Agregar-equipo flows,
 * plus nota-entrega generators and serial copy. All actions delegate
 * to OrdenesService for Firestore writes and trigger a reload via
 * cargarOrdenesYEquipos.
 * ======================================== */

// ===== MODAL ASIGNAR / CAMBIAR TÉCNICO =====
// El mismo modal (#modalAsignar) sirve dos flujos:
//   · 'asignar'   → primera asignación; transiciona la orden a ASIGNADO.
//   · 'reasignar' → cambio esporádico de técnico (admin/jefe_taller) que NO
//                   toca el estado. Preselecciona el técnico actual.
// El modo viaja en el dataset del botón confirmar y lo lee confirmarAsignarTecnico.
function _abrirModalTecnico(ordenId, { modo }) {
  const modal = document.getElementById("modalAsignar");
  const select = document.getElementById("asignarTecnicoSelect");
  const btnConfirmar = modal && modal.querySelector("button[data-action='confirmar-asignar-tecnico']");
  const titulo = document.getElementById("modalAsignarTitle");

  if (!modal || !select || !btnConfirmar) {
    console.error("Modal elements not found");
    return;
  }

  const esReasignar = modo === "reasignar";
  btnConfirmar.dataset.ordenId = ordenId;
  btnConfirmar.dataset.modo = modo;

  // Título + texto del botón según el modo (el modal se reutiliza para ambos).
  if (titulo) {
    titulo.innerHTML = esReasignar
      ? '<i data-lucide="user-cog"></i> Cambiar técnico'
      : '<i data-lucide="wrench"></i> Asignar técnico';
  }
  btnConfirmar.textContent = esReasignar ? "Cambiar técnico" : "Asignar técnico";

  // Técnico actual, para preseleccionarlo en modo reasignar.
  const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
  const tecnicoActualUid = orden.tecnico_uid || "";

  select.innerHTML = '<option value="">Seleccionar técnico...</option>';

  OrdenesService.loadTechnicians()
    .then(technicians => {
      technicians.forEach(tech => {
        const option = document.createElement("option");
        option.value = tech.uid;
        // El nombre limpio viaja en dataset: es lo que se guarda en la orden
        // (tecnico_asignado) y lo que compara el filtro por técnico. El sufijo
        // del texto es solo visual, para distinguir al supervisor de taller.
        option.dataset.nombre = tech.nombre;
        option.textContent = tech.rol === "jefe_taller"
          ? `${tech.nombre} — supervisor` : tech.nombre;
        if (esReasignar && tech.uid === tecnicoActualUid) option.selected = true;
        select.appendChild(option);
      });
      // "Asignármela" (auditoría Q3): si quien abre el modal ES un técnico de
      // la lista, preseleccionarlo — el caso más común es el técnico tomando
      // su propia orden (4-5 clicks → 2, y sin riesgo de elegir al vecino).
      // Recepción/jefe no suelen estar en la lista y eligen normal.
      if (!esReasignar && !select.value) {
        const miUid = firebase.auth().currentUser?.uid || '';
        if (miUid && technicians.some(t => t.uid === miUid)) select.value = miUid;
      }
      select.style.borderColor = select.value ? 'var(--accent)' : 'var(--line)';
    })
    .catch(error => {
      console.error("Error cargando técnicos:", error);
      Toast.show("❌ Error cargando técnicos", "bad");
    });

  modal.onclick = function (e) {
    if (e.target === modal) {
      cerrarModalAsignar();
    }
  };

  // Modal.open wires Escape, Tab focus-trap, and saves/restores
  // focus on the previously-focused element. The `.hidden` class is
  // removed inside open(). ORDENES_INDEX_IMPROVEMENTS.md QW5.
  Modal.open("modalAsignar");
  // Re-pinta el icono del título recién inyectado (data-lucide).
  if (APP?.utils?.lucideRefresh) APP.utils.lucideRefresh(modal);
  else if (window.lucide?.createIcons) window.lucide.createIcons();
}

window.abrirModalAsignarTecnico = function (ordenId) {
  _abrirModalTecnico(ordenId, { modo: "asignar" });
};

window.abrirModalCambiarTecnico = function (ordenId) {
  _abrirModalTecnico(ordenId, { modo: "reasignar" });
};

window.cerrarModalAsignar = function () {
  const modal = document.getElementById("modalAsignar");
  if (!modal) return;
  Modal.close("modalAsignar");
  modal.classList.add("hidden");  // keep the .hidden class invariant
  const select = document.getElementById("asignarTecnicoSelect");
  if (select) select.value = "";
};

window.confirmarAsignarTecnico = async function (ordenId) {
  const select = document.getElementById("asignarTecnicoSelect");
  if (!select || !select.value) {
    Toast.show("⚠️ Selecciona un técnico", "bad");
    return;
  }

  const btnConfirmar = document.querySelector("#modalAsignar button[data-action='confirmar-asignar-tecnico']");
  const modo = (btnConfirmar && btnConfirmar.dataset.modo) || "asignar";
  const tecnicoUid = select.value;
  const opcion = select.options[select.selectedIndex];
  // dataset.nombre = nombre limpio (el texto puede traer el sufijo visual
  // "— supervisor", que no debe guardarse en tecnico_asignado).
  const tecnicoNombre = opcion.dataset.nombre || opcion.text;

  try {
    if (modo === "reasignar") {
      const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
      // Eligió el mismo técnico: nada que cambiar, solo cierra.
      if (tecnicoUid && tecnicoUid === orden.tecnico_uid) {
        cerrarModalAsignar();
        return;
      }
      await OrdenesService.reassignTechnician(ordenId, tecnicoUid, tecnicoNombre, {
        prevUid: orden.tecnico_uid || "",
        prevNombre: orden.tecnico_asignado || ""
      });
      Toast.show("✅ Técnico cambiado correctamente", "ok");
    } else {
      // Si la orden sigue en POR ASIGNAR, esta asignación se salta la
      // recepción en mostrador — va marcado a os_logs (auditoría P2).
      // PROGRAMACIÓN y ENTRADA no llevan recepción por diseño (su botón de
      // POR ASIGNAR ya es Asignar), así que NO se marcan: si contaran como
      // salto, la métrica de atajos —lo que sí es una excepción— quedaría
      // inservible.
      const ordenPrev = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
      const sinRecepcion =
        (typeof esOrdenProgramacion === 'function' && esOrdenProgramacion(ordenPrev))
        || (typeof esOrdenEntrada === 'function' && esOrdenEntrada(ordenPrev));
      const saltoRecepcion = !sinRecepcion
        && (ordenPrev.estado_reparacion || "POR ASIGNAR").toUpperCase() === "POR ASIGNAR";
      await OrdenesService.assignTechnician(ordenId, tecnicoUid, tecnicoNombre, { saltoRecepcion });
      Toast.show("✅ Técnico asignado correctamente", "ok");
    }

    cerrarModalAsignar();
    // The live snapshot in ordenes-data.js picks up the Firestore write
    // and re-renders within milliseconds — no manual reload needed.
    // ORDENES_INDEX_IMPROVEMENTS.md §3.1.
  } catch (error) {
    console.error("Error asignando técnico:", error);
    Toast.show("❌ Error al asignar técnico", "bad");
  }
};

window.completarOrden = async function (ordenId) {
  // Las ENTRADA (inspección de devueltos) no llevan candado de QC: la
  // revisión ES el trabajo de la orden y nada sale hacia el cliente.
  const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
  const esEntrada = typeof esOrdenEntrada === 'function' && esOrdenEntrada(orden);

  // Misma definición de "finalizado" que la barra de progreso de la fila:
  // trabajo_tecnico con texto o marcado no-disponible (ordenes-render.js).
  // Los índices van sobre la lista SIN eliminados — el mismo espacio que
  // usa updateTrabajoTecnico({equipoIdxs}).
  const equiposActivos = (orden.equipos || []).filter(e => !e.eliminado);
  const pendientesIdx = [];
  equiposActivos.forEach((e, i) => {
    if (!((e.trabajo_tecnico || '').trim() || e.intervencion_no_disponible)) pendientesIdx.push(i);
  });
  const sinIntervencion = pendientesIdx.length;

  // PROGRAMACIÓN (§5.20, aprobado 2026-08-18): la intervención es UNA por
  // orden — el mismo trabajo en todos los radios, y el 46% de equipos
  // quedaba sin texto con el modelo por-equipo. Al completar se pide UN
  // texto (pre-llenado: aceptar es un click) y se estampa a los pendientes
  // en un solo write. Vaciar el texto = completar sin estampar — el aviso
  // nunca bloqueó y sigue sin bloquear. Cancelar aborta el completar.
  const tipoNorm = String(orden.tipo_de_servicio || "").trim().toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (tipoNorm === "PROGRAMACION" && !esEntrada && sinIntervencion > 0) {
    const texto = await Modal.prompt({
      title: `Completar orden ${ordenId}`,
      message: `${sinIntervencion} de ${equiposActivos.length} equipo(s) sin intervención registrada. En PROGRAMACIÓN el trabajo es el mismo para todos: este texto se estampa a los pendientes al completar.`,
      defaultValue: `Programación aplicada a los ${equiposActivos.length} radios de la orden.`,
      multiline: true,
      confirmLabel: "Estampar y completar",
    });
    if (texto === null) return; // canceló
    try {
      if (texto) {
        const user = firebase.auth().currentUser;
        await OrdenesService.updateTrabajoTecnico({
          ordenId, equipoIdxs: pendientesIdx, texto,
          uid: user?.uid || '', email: user?.email || ''
        });
      }
      await OrdenesService.completeOrder(ordenId, { qcRequerido: true });
      Toast.show(texto
        ? `✅ Intervención estampada en ${sinIntervencion} equipo(s) — orden completada`
        : "✅ Orden completada", "ok");
      // Live snapshot picks up the change — no manual reload.
    } catch (error) {
      console.error("Error completando orden:", error);
      Toast.show("❌ Error al completar orden", "bad");
    }
    return;
  }

  let msg = esEntrada
    ? `¿Marcar la revisión de la orden ${ordenId} como completada? A continuación se abre el cierre de la entrada.`
    : `¿Marcar la orden ${ordenId} como completada?`;

  // Aviso temprano (auditoría Q4): completar con equipos sin intervención se
  // descubría DESPUÉS — en el badge de contradicción o con un rechazo de QC
  // (~7 clicks + ida y vuelta del técnico). El aviso barato va en el confirm.
  // También aplica a ENTRADA (auditoría P2): ahí la revisión ES el trabajo —
  // completar sin texto significa inspección sin documentar (y no hay QC
  // después que lo atrape).
  if (sinIntervencion > 0) {
    msg += esEntrada
      ? ` ⚠️ ${sinIntervencion} de ${equiposActivos.length} equipo(s) aún no tienen la revisión registrada — la inspección quedaría sin documentar.`
      : ` ⚠️ ${sinIntervencion} de ${equiposActivos.length} equipo(s) aún no tienen intervención registrada — el control de calidad puede rechazarla.`;
  }
  if (!await Modal.confirm({ message: msg })) return;

  try {
    await OrdenesService.completeOrder(ordenId, { qcRequerido: !esEntrada });

    Toast.show("✅ Orden completada", "ok");
    // Live snapshot picks up the change — no manual reload.

    // ENTRADA: encadenar el modal de cierre — completar y cerrar son casi
    // siempre el mismo momento, pero el cierre sigue siendo su propia
    // decisión (mueve inventario a bodega y es terminal): el modal conserva
    // el aviso de cotización y se puede cancelar; la orden queda en
    // COMPLETADO con su botón "Cerrar entrada" de siempre.
    if (esEntrada && typeof window.cerrarEntrada === 'function') {
      window.cerrarEntrada(ordenId);
    }
  } catch (error) {
    console.error("Error completando orden:", error);
    Toast.show("❌ Error al completar orden", "bad");
  }
};

// ── Candado de firma del contrato (2026-09-03, requerimiento de Zuleika) ──
// Una PROGRAMACIÓN entrega radios BAJO un contrato, y ese contrato debe estar
// firmado en la plataforma (firmado=true, o estado 'activo' — la firma es lo
// único que activa) ANTES de poner los radios en manos del cliente. Todo lo
// demás (aprobación, seriales, asignación de la orden) corre sin esperar la
// firma; el único punto duro es este. Las rules exigen lo mismo en la
// transición a ENTREGADO (respaldo contra escrituras directas, admin exento).
// Devuelve null si se puede entregar; si no, el contrato leído (para armar el
// mensaje). Sin señal clara (error de red, vínculo roto) NO bloquea aquí: las
// rules son el respaldo y un fallo de lectura no debe frenar una entrega.
async function contratoSinFirmarParaEntrega(orden) {
  const c = orden?.contrato;
  if (!(c && c.aplica === true && c.contrato_doc_id)) return null;
  if (!(typeof esOrdenProgramacion === 'function' && esOrdenProgramacion(orden))) return null;
  try {
    const ref = firebase.firestore().collection('contratos').doc(c.contrato_doc_id);
    const firmado = (d) => !!d && (d.firmado === true || d.estado === 'activo');
    let snap = await ref.get();
    if (snap.exists && firmado(snap.data())) return null;
    // La caché multi-pestaña puede pintar viejo (patrón del Centro): antes de
    // bloquear una entrega, la firma se revalida contra el servidor — pudo
    // llegar hace un momento desde el celular del cliente.
    if (snap.metadata && snap.metadata.fromCache) {
      snap = await ref.get({ source: 'server' });
      if (snap.exists && firmado(snap.data())) return null;
    }
    if (!snap.exists) return null; // vínculo roto = problema de datos, no de firma
    return { id: c.contrato_doc_id, ...snap.data() };
  } catch (e) {
    console.warn('[entrega] no se pudo verificar la firma del contrato:', e);
    return null;
  }
}

function abrirModalFirmaPendiente(orden, contrato) {
  const esAdmin = (APP.state.userRole || '') === (typeof ROLES !== 'undefined' ? ROLES.ADMIN : 'administrador');
  const clienteId = orden.cliente_id || contrato.cliente_id || '';
  const enValidacion = contrato.firmado_pendiente_validacion === true;
  const detalle = enValidacion
    ? `La firma digital <b>ya llegó</b>, pero el firmante no coincide con el representante
       registrado: falta que ventas lo <b>valide</b> desde la ficha del cliente. En cuanto
       se acepte, el contrato queda activo y la entrega sale.`
    : `Desde la ficha del cliente se le puede <b>enviar el enlace de firma digital</b>
       (firma desde su celular, sin usuario, en minutos) o <b>subir el PDF firmado</b>
       si ya firmó en papel. Apenas quede firmado, esta entrega sale sin más trámite.`;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '9500';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;width:min(94vw,520px);">
      <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="pen-line"></i> Falta la firma del contrato</h3>
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body" style="padding:12px 14px;max-height:70vh;overflow:auto;">
        <p style="margin:0 0 8px;font-size:13.5px;color:var(--fg-2,#374151);">
          Esta orden entrega equipos bajo el contrato
          <b>${escapeHtml(contrato.contrato_id || orden.contrato?.contrato_id || '—')}</b>,
          que todavía <b>no está firmado</b> en la plataforma. Los radios no se
          entregan sin la firma del cliente.
        </p>
        <p style="margin:0 0 4px;font-size:13.5px;color:var(--fg-2,#374151);">${detalle}</p>
      </div>
      <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);flex-wrap:wrap;">
        ${esAdmin ? `<button class="btn btn-secondary" id="firmaOverrideBtn" style="margin-right:auto;"
          title="Solo administración — para casos excepcionales">Entregar sin firma (admin)</button>` : ''}
        <button class="btn btn-secondary" data-close="1">Cerrar</button>
        ${clienteId ? `<a class="btn btn-primary" href="../clientes/centro.html?id=${encodeURIComponent(clienteId)}">
          <i data-lucide="pen-line"></i> Abrir la ficha y gestionar la firma</a>` : ''}
      </div>
    </div>`;

  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', kb);
  document.body.appendChild(overlay);
  APP.utils.lucideRefresh(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) cleanup();
  });
  const ov = overlay.querySelector('#firmaOverrideBtn');
  if (ov) ov.onclick = () => { cleanup(); abrirModalEntrega(orden.ordenId); };
}

// ── Candado de firma del ANEXO de aumento (2026-09-03, segunda vuelta) ────
// La OS de un aumento sale apenas bodega asigna, con el anexo todavía en
// firma — programar y completar corre todo en paralelo; el único punto duro
// es la entrega. El contrato marco ya está activo (el candado de arriba pasa
// de largo), así que aquí se verifica la firma del ANEXO: cierre.firma de la
// gestión. Las rules exigen lo mismo en la transición a ENTREGADO (respaldo,
// admin exento). Devuelve null si se puede entregar; si no, la gestión leída.
// Sin señal clara (error de red, vínculo roto) NO bloquea: rules respaldan.
async function anexoSinFirmarParaEntrega(orden) {
  const ge = orden?.gestion;
  if (!(ge && ge.tipo === 'aumento' && ge.id)) return null;
  try {
    const ref = firebase.firestore().collection('gestiones').doc(ge.id);
    const firmado = (d) => !!d && d.cierre?.firma === true;
    let snap = await ref.get();
    if (snap.exists && firmado(snap.data())) return null;
    // Caché multi-pestaña puede pintar viejo: la firma pudo llegar hace un
    // momento desde el celular del cliente — revalidar contra el servidor.
    if (snap.metadata && snap.metadata.fromCache) {
      snap = await ref.get({ source: 'server' });
      if (snap.exists && firmado(snap.data())) return null;
    }
    if (!snap.exists) return null; // vínculo roto = problema de datos, no de firma
    return { id: ge.id, ...snap.data() };
  } catch (e) {
    console.warn('[entrega] no se pudo verificar la firma del anexo:', e);
    return null;
  }
}

function abrirModalFirmaAnexoPendiente(orden, gestion) {
  const esAdmin = (APP.state.userRole || '') === (typeof ROLES !== 'undefined' ? ROLES.ADMIN : 'administrador');
  const clienteId = orden.cliente_id || gestion.cliente_id || '';
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '9500';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;width:min(94vw,520px);">
      <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="pen-line"></i> Falta la firma del anexo</h3>
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body" style="padding:12px 14px;max-height:70vh;overflow:auto;">
        <p style="margin:0 0 8px;font-size:13.5px;color:var(--fg-2,#374151);">
          Esta orden entrega los equipos del aumento
          <b>${escapeHtml(gestion.id || '—')}</b> (contrato
          <b>${escapeHtml(gestion.aumento?.contrato_id || orden.contrato?.contrato_id || '—')}</b>),
          y el <b>anexo todavía no está firmado</b>. La programación corre en
          paralelo, pero los radios no se entregan sin la firma del cliente.
        </p>
        <p style="margin:0 0 4px;font-size:13.5px;color:var(--fg-2,#374151);">
          Desde el expediente del cliente se le puede <b>reenviar el enlace de firma
          digital</b> (firma desde su celular, en minutos) o <b>subir el anexo firmado</b>
          si ya firmó en papel. Apenas quede firmado, esta entrega sale sin más trámite.
        </p>
      </div>
      <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);flex-wrap:wrap;">
        ${esAdmin ? `<button class="btn btn-secondary" id="firmaAnexoOverrideBtn" style="margin-right:auto;"
          title="Solo administración — para casos excepcionales">Entregar sin firma (admin)</button>` : ''}
        <button class="btn btn-secondary" data-close="1">Cerrar</button>
        ${clienteId ? `<a class="btn btn-primary" href="../clientes/centro.html?id=${encodeURIComponent(clienteId)}&g=${encodeURIComponent(gestion.id || '')}">
          <i data-lucide="pen-line"></i> Abrir el expediente y gestionar la firma</a>` : ''}
      </div>
    </div>`;

  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', kb);
  document.body.appendChild(overlay);
  APP.utils.lucideRefresh(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) cleanup();
  });
  const ov = overlay.querySelector('#firmaAnexoOverrideBtn');
  if (ov) ov.onclick = () => { cleanup(); abrirModalEntrega(orden.ordenId); };
}

// ── Candado de factura de la venta (2026-09-03, decisión de Zuleika) ──────
// Un contrato "Propio" VENDE los radios: la factura QBO debe estar registrada
// (Contratos → Equipos → "Registrar factura de venta") ANTES de ponerlos en
// manos del cliente. Igual que la firma: la preparación nunca espera — el
// único punto duro es la entrega. Las rules exigen lo mismo en la transición
// a ENTREGADO (respaldo contra escrituras directas, admin exento). Devuelve
// null si se puede entregar; si no, el contrato leído. Sin señal clara (error
// de red, vínculo roto) NO bloquea aquí: las rules son el respaldo.
async function contratoSinFacturaParaEntrega(orden) {
  const c = orden?.contrato;
  if (!(c && c.aplica === true && c.contrato_doc_id)) return null;
  if (!(typeof esOrdenProgramacion === 'function' && esOrdenProgramacion(orden))) return null;
  try {
    const ref = firebase.firestore().collection('contratos').doc(c.contrato_doc_id);
    // El candado aplica SOLO a ventas (tipo "Propio") — mismo criterio que
    // onSerialWrite/contratos-equipos. Alquiler/demo/temporal no facturan
    // equipos y pasan de largo.
    const exento = (d) => !!d && !(d.tipo_contrato === 'Propio' || d.codigo_tipo === 'PROP');
    const facturada = (d) => !!(d && d.factura_venta && (d.factura_venta.numero || '').trim());
    let snap = await ref.get();
    let d = snap.exists ? snap.data() : null;
    if (d && (exento(d) || facturada(d))) return null;
    // Caché multi-pestaña puede pintar viejo (patrón del Centro): antes de
    // bloquear, se revalida contra el servidor — Recepción pudo registrar la
    // factura hace un momento en otra máquina.
    if (snap.metadata && snap.metadata.fromCache) {
      snap = await ref.get({ source: 'server' });
      d = snap.exists ? snap.data() : null;
      if (d && (exento(d) || facturada(d))) return null;
    }
    if (!d) return null; // vínculo roto = problema de datos, no de factura
    return { id: c.contrato_doc_id, ...d };
  } catch (e) {
    console.warn('[entrega] no se pudo verificar la factura de la venta:', e);
    return null;
  }
}

function abrirModalFacturaPendiente(orden, contrato) {
  const rol = APP.state.userRole || '';
  const esAdmin = rol === (typeof ROLES !== 'undefined' ? ROLES.ADMIN : 'administrador');
  const puedeRegistrar = typeof canRole === 'function' && canRole(rol, 'registrar-factura-venta');
  const detalle = puedeRegistrar
    ? `El botón te lleva a <b>Contratos</b> y abre directo el registro: se escribe el
       número de la factura de QuickBooks una sola vez y queda en el contrato y en
       cada serial. Al volver, esta entrega sale sin más trámite.`
    : `Recepción o gerencia la registran en <b>Contratos → Equipos del contrato →
       "Registrar factura de venta"</b>. Apenas quede registrada, esta entrega sale.`;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '9500';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;width:min(94vw,520px);">
      <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="receipt"></i> Falta la factura de la venta</h3>
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body" style="padding:12px 14px;max-height:70vh;overflow:auto;">
        <p style="margin:0 0 8px;font-size:13.5px;color:var(--fg-2,#374151);">
          Esta orden entrega radios <b>vendidos</b> bajo el contrato
          <b>${escapeHtml(contrato.contrato_id || orden.contrato?.contrato_id || '—')}</b>,
          y la factura de la venta todavía <b>no está registrada</b> en la plataforma.
          Los radios no se entregan sin facturar primero.
        </p>
        <p style="margin:0 0 4px;font-size:13.5px;color:var(--fg-2,#374151);">${detalle}</p>
      </div>
      <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);flex-wrap:wrap;">
        ${esAdmin ? `<button class="btn btn-secondary" id="factOverrideBtn" style="margin-right:auto;"
          title="Solo administración — para casos excepcionales">Entregar sin factura (admin)</button>` : ''}
        <button class="btn btn-secondary" data-close="1">Cerrar</button>
        ${puedeRegistrar ? `<a class="btn btn-primary" href="../contratos/index.html?factura_venta=${encodeURIComponent(contrato.id)}">
          <i data-lucide="receipt"></i> Registrar la factura</a>` : ''}
      </div>
    </div>`;

  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', kb);
  document.body.appendChild(overlay);
  APP.utils.lucideRefresh(overlay);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) cleanup();
  });
  const ov = overlay.querySelector('#factOverrideBtn');
  if (ov) ov.onclick = () => { cleanup(); abrirModalEntrega(orden.ordenId); };
}

window.entregarOrden = async function (ordenId) {
  // Candado de QC: con control de calidad pendiente no se abre el modal de
  // entrega (las rules además rechazan la transición). Al rol que puede
  // ejecutar el QC se le abre directamente el checklist.
  const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
  if (typeof OrdenesQC !== 'undefined' && OrdenesQC.qcPendiente(orden)) {
    const msg = OrdenesQC.qcCaducado(orden)
      ? 'El QC aprobado caducó: cambiaron los equipos de la orden. Hay que repetirlo.'
      : 'Esta orden requiere control de calidad antes de entregarse';
    if (OrdenesQC.puedeHacerQc(APP.state.userRole || '')) {
      Toast.show(msg, 'bad');
      OrdenesQC.abrir(ordenId);
    } else {
      Toast.show('⛔ ' + msg + ' (jefe de taller)', 'bad');
    }
    return;
  }
  // Candado de firma del contrato (ver contratoSinFirmarParaEntrega arriba).
  const sinFirmar = await contratoSinFirmarParaEntrega(orden);
  if (sinFirmar) { abrirModalFirmaPendiente(orden, sinFirmar); return; }
  // Candado de firma del ANEXO (aumentos con la firma en paralelo — arriba).
  const anexoSinFirmar = await anexoSinFirmarParaEntrega(orden);
  if (anexoSinFirmar) { abrirModalFirmaAnexoPendiente(orden, anexoSinFirmar); return; }
  // Candado de factura de la venta (solo contratos "Propio" — ver arriba).
  const sinFactura = await contratoSinFacturaParaEntrega(orden);
  if (sinFactura) { abrirModalFacturaPendiente(orden, sinFactura); return; }
  abrirModalEntrega(ordenId);
};

// Cierre de una orden de ENTRADA (inspección de equipos devueltos): la
// revisión terminó y las unidades quedan bajo control de inventario — el
// destino final (bodega o baja) se decide por serial en Equipos por serial.
// Aquí NO hay entrega al cliente. Si la inspección encontró daños o
// faltantes cobrables, la cotización se emite antes de cerrar (aviso suave,
// no candado: cerrar sin cotizar es válido cuando no hay nada que cobrar).
window.cerrarEntrada = function (ordenId) {
  const orden = (APP.state.orders || []).find(o => o.ordenId === ordenId) || {};
  const cotizada = !!orden.cotizacion_emitida;
  const nEquipos = (orden.equipos || []).filter(e => !e.eliminado).length;

  // Equipos marcados como DESCARTADOS durante la revisión (modal de
  // intervención). El cierre es quien los escribe en el registro central
  // `equipos_descartados` — mismo momento que en QC lo hace la firma.
  const descartados = (orden.equipos || []).filter(e => !e.eliminado && e.descartado_revision);
  const avisoDescartes = descartados.length
    ? `<div style="border:1px solid #FECACA;background:#FEF2F2;color:#991B1B;border-radius:8px;padding:8px 12px;font-size:13px;margin:10px 0;">
         ⛔ <b>${descartados.length} equipo(s) descartado(s) en la revisión</b> — al cerrar quedan en el registro de
         equipos descartados (alerta al teclear el serial en bodega o taller):
         <ul style="margin:6px 0 0;padding-left:18px;">
           ${descartados.map(e => `<li><span style="font-family:var(--font-mono,monospace);">${escapeHtml(String(e.numero_de_serie || e.serial || e.SERIAL || '-'))}</span>${e.descarte_motivo ? ' — ' + escapeHtml(String(e.descarte_motivo)) : ''}</li>`).join('')}
         </ul>
       </div>`
    : '';

  const avisoCot = cotizada
    ? `<div style="border:1px solid #a7f3d0;background:#ecfdf5;color:#065f46;border-radius:8px;padding:8px 12px;font-size:13px;margin:10px 0;">✓ Cotización emitida para esta orden.</div>`
    : `<div style="border:1px solid #fde68a;background:#fffbeb;color:#92400e;border-radius:8px;padding:8px 12px;font-size:13px;margin:10px 0;">Si la revisión encontró <b>daños o faltantes cobrables</b>, emite la cotización antes de cerrar (menú ⋯ → Cotizar). Si no hay nada que cobrar, cierra sin más.</div>`;

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '9500';
  overlay.innerHTML = `
    <div class="modal" style="max-width:520px;width:min(94vw,520px);">
      <div class="sheet-header" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <h3 class="sheet-title" style="display:flex;align-items:center;gap:6px;"><i data-lucide="package-check"></i> Cerrar entrada — Orden ${escapeHtml(ordenId)}</h3>
        <button class="btn btn-ghost" data-close="1" aria-label="Cerrar">✕</button>
      </div>
      <div class="sheet-body" style="padding:12px 14px;max-height:70vh;overflow:auto;">
        <p style="margin:0 0 4px;font-size:13.5px;color:var(--fg-2,#374151);">
          La revisión de ${nEquipos || 'los'} equipo(s) terminó. Las unidades quedan bajo control de
          <b>inventario</b> — el destino final (bodega o baja) se decide por serial en
          <b>Inventario · Equipos por serial</b>. Esta orden <b>no se entrega al cliente</b>.
        </p>
        ${avisoDescartes}
        ${avisoCot}
        <div class="form-field">
          <label class="form-label" for="cierreEntradaObs">Observaciones del cierre (opcional)</label>
          <textarea class="form-input form-textarea" id="cierreEntradaObs" rows="2"
            placeholder="Ej.: 2 unidades OK, 1 con antena quebrada — cotizado"></textarea>
        </div>
      </div>
      <div class="footer" style="display:flex;justify-content:flex-end;gap:8px;padding:10px;border-top:1px solid var(--line,#eee);">
        <button class="btn btn-secondary" data-close="1">Cancelar</button>
        <button class="btn btn-primary" id="cierreEntradaBtn"><i data-lucide="check"></i> Cerrar entrada</button>
      </div>
    </div>`;

  const cleanup = () => { overlay.remove(); document.removeEventListener('keydown', kb); };
  const kb = e => { if (e.key === 'Escape') cleanup(); };
  document.addEventListener('keydown', kb);
  document.body.appendChild(overlay);
  APP.utils.lucideRefresh(overlay);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.closest('[data-close]')) cleanup();
  });

  const btn = overlay.querySelector('#cierreEntradaBtn');
  btn.onclick = async () => {
    const observaciones = (overlay.querySelector('#cierreEntradaObs')?.value || '').trim();
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      await OrdenesService.closeEntrada(ordenId, { observaciones });

      // Registro central de los descartados de la revisión — DESPUÉS del
      // cierre (el cierre no se bloquea por un fallo del registro) y con el
      // mismo fail-soft del QC: si algo falla, se pide registrarlo a mano.
      const fallos = [];
      if (descartados.length && typeof EquiposDescartadosService !== 'undefined') {
        for (const e of descartados) {
          const serial = String(e.numero_de_serie || e.serial || e.SERIAL || '');
          try {
            await EquiposDescartadosService.registrar({
              serial,
              modelo: String(e.modelo || e.MODEL || e.modelo_nombre || ''),
              modelo_id: String(e.modelo_id || ''),
              orden_id: ordenId,
              equipo_id: String(e.id || ''),
              cliente: typeof nombreClienteDe === 'function' ? nombreClienteDe(orden) : '',
              motivo: String(e.descarte_motivo || 'Descartado en revisión de entrada')
            });
          } catch (err2) {
            fallos.push(serial || '(sin serial)');
            console.error('[cerrarEntrada] no se registró el descarte de', serial, err2);
          }
        }
      }

      cleanup();
      if (fallos.length) {
        Toast.show(`Entrada cerrada, pero NO se registró el descarte de ${fallos.join(', ')}. Regístrelo a mano en Inventario · Descartados.`, 'bad');
      } else if (descartados.length) {
        Toast.show(`✅ Entrada cerrada — ${descartados.length} descartado(s) quedaron en el registro`, 'ok');
      } else {
        Toast.show('✅ Entrada cerrada — unidades bajo control de inventario', 'ok');
      }
      // El snapshot en vivo de ordenes-data.js re-renderiza solo.
    } catch (err) {
      console.error('[cerrarEntrada]', err);
      Toast.show('❌ Error al cerrar la entrada: ' + err.message, 'bad');
      btn.disabled = false;
      btn.innerHTML = '<i data-lucide="check"></i> Cerrar entrada';
      APP.utils.lucideRefresh(btn);
    }
  };
};

window.eliminarOrden = async function (ordenId) {
  // Guardrails (auditoría órdenes P2): una orden entregada/cerrada es
  // historial del cliente (firma, QC, acuses) — no se elimina. El menú ⋯ ya
  // no ofrece la opción en terminales; esto cubre atajos y estado viejo en
  // pantalla. Las rules exigen lo mismo del lado del servidor.
  const o = APP.state.orders.find(x => x.ordenId === ordenId) || {};
  const estado = (o.estado_reparacion || "POR ASIGNAR").toUpperCase();
  if (estado.includes("ENTREGAD") || estado.startsWith("CERRADA")) {
    Toast.show("Una orden entregada o cerrada no se elimina — es historial del cliente.", "warn");
    return;
  }

  // El motivo es la fricción que reemplaza al confirm: queda en la orden y
  // en su bitácora (os_logs), y las rules piden mínimo 10 caracteres.
  const motivo = await Modal.prompt({
    title: `Eliminar orden ${ordenId}`,
    message: "La orden se oculta de la bandeja (borrado lógico). Indica el motivo — queda registrado en la orden:",
    placeholder: "Ej.: duplicada — se creó dos veces por error",
    multiline: true,
    confirmLabel: "Eliminar orden",
  });
  if (motivo === null) return; // canceló
  if (motivo.length < 10) {
    Toast.show("Describe el motivo (mínimo 10 caracteres).", "warn");
    return;
  }

  try {
    await OrdenesService.deleteOrder(ordenId, { motivo });

    Toast.show("✅ Orden eliminada", "ok");
    // Live snapshot picks up the eliminado:true write — no manual reload.
  } catch (error) {
    console.error("Error eliminando orden:", error);
    Toast.show("❌ Error al eliminar orden", "bad");
  }
};

window.agregarEquipo = function (ordenId) {
  window.location.href = `agregar-equipo.html?orden_id=${ordenId}`;
};

window.nuevoBatch = function (ordenId) {
  window.location.href = `nuevo-batch.html?orden_id=${ordenId}`;
};

// Leyenda de QC para las notas de entrega: solo cuando el control de
// calidad quedó aprobado (ordenes-qc.js). La nota impresa la muestra
// junto al pie — vende el proceso ante el cliente.
function qcParaNota(orden) {
  const qc = orden?.qc;
  if (!qc || qc.resultado !== 'aprobado') return null;
  return {
    por: qc.por_email || '',
    fecha: qc.fecha?.toDate ? qc.fecha.toDate().toLocaleDateString('es-PA') : ''
  };
}

// (window.generarNotaEntrega + nota-entrega.html retirados en la auditoría P2:
// ninguna acción de la UI los alcanzaba — la nota vigente es la de
// intervenciones, abajo, vía el action 'nota-entrega-doc'.)

window.generarNotaEntregaIntervenciones = async function (ordenId) {
  const orden = APP.state.orders.find(o => o.ordenId === ordenId);
  if (!orden) {
    Toast.show("Orden no encontrada", 'bad');
    return;
  }

  // Abrir la ventana dentro del gesto del usuario (evita bloqueo de pop-ups);
  // la apuntamos al documento una vez resueltos los datos asíncronos.
  const win = window.open("about:blank", "_blank");

  const equipos = prepararEquiposParaNota(orden, true);

  // Adjunta las piezas/accesorios cambiados o reparados por el técnico (consumos
  // cobrables y de garantía) a cada equipo, para que la nota que firma el cliente
  // muestre nº de serie, modelo, piezas cambiadas y la intervención completa.
  try {
    const cons = await OrdenesService.getConsumos(ordenId);
    const porEquipo = {};
    (cons || []).forEach(c => {
      if ((c.tipo || 'cobro') === 'interno') return; // las internas no van en la nota del cliente
      const k = c.equipoId || 'X';
      (porEquipo[k] = porEquipo[k] || []).push({
        nombre: c.pieza_nombre || 'Pieza',
        sku: c.sku || '',
        qty: Number(c.qty || 0),
        tipo: c.tipo || 'cobro',
      });
    });
    equipos.forEach(eq => { eq.piezas = porEquipo[eq.id] || porEquipo[eq.serial] || []; });
  } catch (e) {
    console.warn('No se pudieron cargar las piezas del técnico para la nota:', e);
  }

  const data = {
    numeroOrden: orden.ordenId || "",
    cliente: nombreClienteDe(orden),
    observaciones: orden.observaciones || "",
    equipos,
    resumen: computeResumenTotales(equipos),
    qc: qcParaNota(orden)
  };

  localStorage.setItem("notaEntregaData", JSON.stringify(data));
  if (win) { win.location = BASE + "nota-entrega-intervenciones.html"; }
  else { window.open(BASE + "nota-entrega-intervenciones.html", "_blank"); }
};

function prepararEquiposParaNota(orden, incluirIntervencion = false) {
  const equipos = Array.isArray(orden?.equipos) ? orden.equipos : [];
  const unicos = [];
  const seen = new Set();

  equipos.forEach((e) => {
    if (!e || e.eliminado === true) return;

    const serial = String(e.numero_de_serie || "").trim();
    const modelo = String(e.modelo || "").trim();
    const nombre = String(e.nombre || "-").trim() || "-";
    const id = String(e.id || "").trim();

    const key = id ? `id:${id}` : `sm:${serial.toLowerCase()}|${modelo.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);

    const item = {
      id: id || serial,
      serial, modelo, nombre,
      bateria:  !!e.bateria,
      clip:     !!e.clip,
      cargador: !!e.cargador,
      fuente:   !!e.fuente,
      antena:   !!e.antena,
      cubrepolvo: !!e.cubrepolvo,
    };
    if (incluirIntervencion) {
      item.intervencion = String(e.trabajo_tecnico || "").trim();
    }
    unicos.push(item);
  });

  return unicos;
}

// Shared helper: count radios + accessory totals from a list of
// equipos (either raw from Firestore or already-prepared via
// prepararEquiposParaNota). Returns { radios, bateria, clip,
// cargador, fuente, antena }. Used by print templates and the
// entrega modal to render a one-line totals summary.
function computeResumenTotales(equiposLike) {
  const list = (Array.isArray(equiposLike) ? equiposLike : [])
    .filter(e => e && e.eliminado !== true);
  const r = { radios: list.length, bateria: 0, clip: 0, cargador: 0, fuente: 0, antena: 0, cubrepolvo: 0 };
  list.forEach(e => {
    if (e.bateria)  r.bateria++;
    if (e.clip)     r.clip++;
    if (e.cargador) r.cargador++;
    if (e.fuente)   r.fuente++;
    if (e.antena)   r.antena++;
    if (e.cubrepolvo) r.cubrepolvo++;
  });
  return r;
}
window.computeResumenTotales = computeResumenTotales;

window.copiarSeriales = function (ordenId) {
  const filas = document.querySelectorAll(`.celda-editable[data-campo="numero_de_serie"][data-id^="${ordenId}_"] .valor`);
  const seriales = [...filas].map(f => f.textContent.trim()).filter(Boolean).join('\n');

  if (!seriales) {
    Toast.show("No hay seriales para copiar", 'warn');
    return;
  }

  navigator.clipboard.writeText(seriales)
    .then(() => Toast.show('✅ Seriales copiados al portapapeles', 'ok'))
    .catch(err => Toast.show(`Error al copiar: ${err}`, 'bad'));
};


// ===== MODAL ENTREGA DE EQUIPOS =====
(function () {
  let _ordenId = null;
  let _ctx = null;
  let _dibujando = false;
  let _canvasInited = false;
  // Cached cliente doc for the open modal — populated in abrirModalEntrega
  // so confirmarEntrega can detect email edits without an extra round-trip.
  let _clienteDoc = null;
  // 'entrega' (default) o 'recepcion'. _applyModo lo sincroniza con la UI;
  // confirmarEntrega lo lee para despachar a la rama correcta del flujo.
  let _modo = 'entrega';

  // ── Canvas helpers ──────────────────────────────────────────────
  function _initCanvas() {
    const canvas = document.getElementById('entregaFirmaCanvas');
    if (!canvas) return;
    _ctx = canvas.getContext('2d');
    _ctx.strokeStyle = '#000';
    _ctx.lineWidth = 2;
    _ctx.lineJoin = 'round';
    _ctx.lineCap = 'round';
    _resizeCanvas(canvas);

    const getPos = e => {
      const r = canvas.getBoundingClientRect();
      if (e.touches) return { x: e.touches[0].clientX - r.left, y: e.touches[0].clientY - r.top };
      return { x: e.offsetX, y: e.offsetY };
    };
    const start = e => { _dibujando = true; _ctx.beginPath(); const p = getPos(e); _ctx.moveTo(p.x, p.y); e.preventDefault(); };
    const move  = e => { if (!_dibujando) return; const p = getPos(e); _ctx.lineTo(p.x, p.y); _ctx.stroke(); e.preventDefault(); };
    const end   = e => { _dibujando = false; e.preventDefault(); };

    canvas.addEventListener('mousedown', start);
    canvas.addEventListener('mousemove', move);
    canvas.addEventListener('mouseup', end);
    canvas.addEventListener('mouseleave', end);
    canvas.addEventListener('touchstart', start, { passive: false });
    canvas.addEventListener('touchmove',  move,  { passive: false });
    canvas.addEventListener('touchend',   end,   { passive: false });
    _canvasInited = true;
  }

  function _resizeCanvas(canvas) {
    canvas = canvas || document.getElementById('entregaFirmaCanvas');
    if (!canvas) return;
    // Match backing store to devicePixelRatio so the captured signature is
    // sharp on retina/HiDPI displays. CSS size stays at 100% × 200px from
    // the inline style; we scale the drawing buffer up and apply a transform
    // so drawing coords remain in CSS pixels.
    const dpr  = Math.max(1, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || canvas.offsetWidth || 300;
    const cssH = 200;
    canvas.width  = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    if (_ctx) {
      // setTransform (not scale) so re-running _resizeCanvas is idempotent.
      _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      _ctx.fillStyle = '#fff';
      _ctx.fillRect(0, 0, cssW, cssH);
      _ctx.strokeStyle = '#000';
      _ctx.lineWidth = 2;
      _ctx.lineJoin = 'round';
      _ctx.lineCap = 'round';
    }
  }

  function _clearCanvas() {
    const canvas = document.getElementById('entregaFirmaCanvas');
    if (!canvas || !_ctx) return;
    _ctx.save();
    _ctx.setTransform(1, 0, 0, 1, 0, 0);
    _ctx.clearRect(0, 0, canvas.width, canvas.height);
    _ctx.fillStyle = '#fff';
    _ctx.fillRect(0, 0, canvas.width, canvas.height);
    _ctx.restore();
  }

  function _isCanvasEmpty() {
    const canvas = document.getElementById('entregaFirmaCanvas');
    if (!canvas) return true;
    return !canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some(v => v !== 255);
  }

  // ── Reset form ──────────────────────────────────────────────────
  function _reset() {
    const g = id => document.getElementById(id);

    const noRecibidoCb = g('entregaNoRecibido');
    if (noRecibidoCb) noRecibidoCb.checked = false;
    const motivo = g('entregaNoRecibidoMotivo');
    if (motivo) motivo.value = '';
    const persona = g('entregaPersonaInterna');
    if (persona) persona.value = '';

    const receptorNombre = g('entregaReceptorNombre');
    if (receptorNombre) receptorNombre.value = '';

    const sinIdCb = g('entregaSinId');
    if (sinIdCb) sinIdCb.checked = false;
    const fotoId = g('entregaFotoId');
    if (fotoId) fotoId.value = '';
    const preview = g('entregaPreviewId');
    if (preview) preview.innerHTML = '';
    const sinIdMotivo = g('entregaSinIdMotivo');
    if (sinIdMotivo) sinIdMotivo.value = '';

    const notas = g('entregaNotas');
    if (notas) notas.value = '';

    const clienteEmail = g('entregaClienteEmail');
    if (clienteEmail) clienteEmail.value = '';
    const clienteEmailHint = g('entregaClienteEmailHint');
    if (clienteEmailHint) {
      clienteEmailHint.textContent = 'Cargando email registrado…';
      clienteEmailHint.style.color = '';
    }
    _clienteDoc = null;

    // Reset visibility. Use classList — the global `.hidden` class
    // is `display:none !important`, so any prior inline style is moot
    // and must not be carried over either.
    const nb = g('entregaNoRecibidoBloque');
    if (nb) { nb.classList.add('hidden'); nb.style.display = ''; }
    const normalBloque = g('entregaNormalBloque');
    if (normalBloque) { normalBloque.classList.remove('hidden'); normalBloque.style.display = ''; }
    const conId = g('entregaConIdBloque');
    if (conId) { conId.classList.remove('hidden'); conId.style.display = ''; }
    const sinId = g('entregaSinIdBloque');
    if (sinId) { sinId.classList.add('hidden'); sinId.style.display = ''; }

    _clearCanvas();
    // Solicitud de tablet de un uso anterior del modal: se cancela — este
    // modal es transiente y compartido entre órdenes.
    _tabletReset(true);
  }

  // ── Resumen de la orden (equipos + totales) + leyenda ENTRADA ───
  function _escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function _renderResumenEntrega(orden) {
    const ul  = document.getElementById('entregaResumenEquipos');
    const tot = document.getElementById('entregaResumenTotales');
    if (!ul || !tot) return;

    const equipos = (Array.isArray(orden?.equipos) ? orden.equipos : [])
      .filter(e => e && !e.eliminado);

    const accs = [
      { key: 'bateria',  short: 'Bat',  plural: 'baterías'   },
      { key: 'clip',     short: 'Clip', plural: 'clips'      },
      { key: 'cargador', short: 'Carg', plural: 'cargadores' },
      { key: 'fuente',   short: 'Fnt',  plural: 'fuentes'    },
      { key: 'antena',   short: 'Ant',  plural: 'antenas'    },
      { key: 'cubrepolvo', short: 'CPolvo', plural: 'cubre polvos' },
    ];
    const totales = { bateria: 0, clip: 0, cargador: 0, fuente: 0, antena: 0, cubrepolvo: 0 };

    ul.innerHTML = equipos.length
      ? equipos.map((e, i) => {
          accs.forEach(a => { if (e[a.key]) totales[a.key]++; });
          const presentes = accs.filter(a => !!e[a.key]).map(a => a.short);
          const serial = _escapeHtml(e.numero_de_serie || '—');
          const modelo = e.modelo ? ` <span class="re-mod">${_escapeHtml(e.modelo)}</span>` : '';
          const accStr = presentes.length
            ? `<span class="re-acc">${presentes.join(' · ')}</span>`
            : `<span class="re-acc re-acc--none">sin acc.</span>`;
          return `<li><span class="re-num">${i + 1}.</span> <span class="re-serial">${serial}</span>${modelo} ${accStr}</li>`;
        }).join('')
      : `<li class="re-empty">Sin equipos</li>`;

    const partes = [`<b>${equipos.length}</b> radio${equipos.length !== 1 ? 's' : ''}`];
    accs.forEach(a => { if (totales[a.key] > 0) partes.push(`<b>${totales[a.key]}</b> ${a.plural}`); });
    tot.innerHTML = partes.join(' · ');
  }

  // Minimal RFC-style check — backend re-validates on send. Enough to
  // catch typos like missing "@" or domain before queueing the email.
  function _isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
  }

  // Load the cliente doc and prefill the email input so the user can
  // review/edit before confirming delivery. Stored in _clienteDoc so
  // confirmarEntrega can diff against the original value.
  function _prefillClienteEmail(orden) {
    const input = document.getElementById('entregaClienteEmail');
    const hint  = document.getElementById('entregaClienteEmailHint');
    if (!input) return;

    if (!orden?.cliente_id) {
      _clienteDoc = null;
      if (hint) hint.textContent = 'No hay cliente vinculado a la orden. Ingrese el email manualmente si desea enviar la nota.';
      return;
    }

    ClientesService.getCliente(orden.cliente_id)
      .then(doc => {
        _clienteDoc = doc;
        if (doc?.email) {
          input.value = doc.email;
          if (hint) hint.textContent = 'Email registrado del cliente. Edítelo si necesita corregirlo antes de enviar.';
        } else if (hint) {
          hint.textContent = 'El cliente no tiene email registrado. Ingréselo para enviar la nota de entrega.';
        }
      })
      .catch(err => {
        console.warn('[abrirModalEntrega] cliente fetch failed', err);
        if (hint) {
          hint.textContent = 'No se pudo cargar el email del cliente. Ingréselo manualmente.';
          hint.style.color = 'var(--warn, #b45309)';
        }
      });
  }

  function _toggleLegendaEntrada(orden) {
    const el = document.getElementById('entregaLegendaEntrada');
    if (!el) return;
    const tipo = String(orden?.tipo_de_servicio || '').toUpperCase();
    // Cache tipo on the element so the no-recibido toggle can decide
    // whether to re-show the legend when the user unchecks it.
    el.dataset.tipo = tipo;
    el.classList.toggle('hidden', !tipo.includes('ENTRADA'));
  }

  // Reconfigura el modal compartido entre los flujos de entrega y
  // recepción. En 'recepcion' oculta los bloques que no aplican (ID,
  // sin-ID, no-recibido, leyenda ENTRADA) y cambia título/labels/botón.
  // Mantiene firma + nombre + email cliente, que son los únicos campos
  // requeridos para el acuse de recibo en mostrador.
  function _applyModo(modo) {
    _modo = (modo === 'recepcion') ? 'recepcion' : 'entrega';
    const root = document.getElementById('modalEntrega');
    if (root) root.dataset.modo = _modo;
    const esRecepcion = _modo === 'recepcion';

    const titulo = document.getElementById('entregaModalTituloPrefijo');
    if (titulo) titulo.textContent = esRecepcion ? 'Recepción en mostrador' : 'Entrega';

    // Lucide reemplaza el <i> con <svg> en el primer render, así que
    // un simple setAttribute no actualiza el icono. Re-creamos el <i>
    // y dejamos que lucideRefresh lo vuelva a renderizar.
    const icon = document.getElementById('entregaModalIcon');
    if (icon) {
      const fresh = document.createElement('i');
      fresh.id = 'entregaModalIcon';
      fresh.setAttribute('data-lucide', esRecepcion ? 'package-plus' : 'package-check');
      icon.replaceWith(fresh);
    }

    const receptorLabel = document.getElementById('entregaReceptorLabel');
    if (receptorLabel) receptorLabel.textContent = esRecepcion ? 'Nombre de quien entrega' : 'Nombre de quien recibe';

    const firmaLabel = document.getElementById('entregaFirmaLabel');
    if (firmaLabel) firmaLabel.textContent = esRecepcion ? 'Firma del que entrega' : 'Firma del receptor';

    const btnLabel = document.getElementById('btnConfirmarEntregaLabel');
    if (btnLabel) btnLabel.textContent = esRecepcion ? 'Confirmar Recepción' : 'Confirmar Entrega';

    // Containers que no aplican en recepción. .modal-entrega__alert--no-id
    // envuelve el bloque de foto-ID y el checkbox sin-ID; .modal-entrega__alert
    // envuelve el checkbox no-recibido y su sub-bloque.
    const root2 = document.getElementById('modalEntrega');
    const idAlert = root2?.querySelector('.modal-entrega__alert--no-id');
    if (idAlert) idAlert.classList.toggle('hidden', esRecepcion);
    const noRecibidoAlert = root2?.querySelector('.modal-entrega__alert');
    if (noRecibidoAlert) noRecibidoAlert.classList.toggle('hidden', esRecepcion);
    // La leyenda ENTRADA (daños/accesorios no devueltos → cotización) se
    // decide por tipo de orden en _toggleLegendaEntrada: es el texto que el
    // cliente firma AL DEJAR los equipos, así que aplica en recepción.

    // Notas de entrega solo aplican al flujo de entrega (van en el email).
    // En recepción no se envía email, así que el campo se oculta.
    const notasWrap = document.getElementById('entregaNotasWrap');
    if (notasWrap) notasWrap.classList.toggle('hidden', esRecepcion);

    // "Equipos recibidos sin firma" solo aplica en recepción. Se resetea a
    // desmarcado cada vez que se aplica el modo (firma visible, motivo oculto).
    const sinFirmaWrap   = document.getElementById('entregaRecepcionSinFirmaWrap');
    const sinFirmaCb     = document.getElementById('entregaRecepcionSinFirma');
    const sinFirmaBloque = document.getElementById('entregaRecepcionSinFirmaBloque');
    const sigWrap        = document.getElementById('entregaSigWrap');
    if (sinFirmaWrap)   sinFirmaWrap.classList.toggle('hidden', !esRecepcion);
    if (sinFirmaCb)     sinFirmaCb.checked = false;
    if (sinFirmaBloque) sinFirmaBloque.classList.add('hidden');
    if (sigWrap)        sigWrap.classList.remove('hidden');

    APP.utils.lucideRefresh(root2);
  }

  // ── Public API ──────────────────────────────────────────────────
  // opts.modo: 'entrega' (default) o 'recepcion' — comparte el modal
  // con `abrirModalRecepcion`, que es solo un envoltorio.
  window.abrirModalEntrega = function (ordenId, opts = {}) {
    _ordenId = ordenId;
    const labelEl = document.getElementById('entregaModalOrdenId');
    if (labelEl) labelEl.textContent = ordenId;

    _reset();
    _applyModo(opts.modo || 'entrega');

    const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};
    _renderResumenEntrega(orden);
    // La leyenda ENTRADA aplica en AMBOS modos, decidida por tipo de orden:
    // en recepción es justo el descargo que el cliente firma al dejar los
    // equipos (daños por mal uso / accesorios no devueltos → cotización).
    _toggleLegendaEntrada(orden);
    _prefillClienteEmail(orden);

    // Modal.open wires Escape, Tab focus-trap, and saves/restores focus.
    // ARIA attrs (role=dialog, aria-modal, aria-labelledby) are on the
    // HTML root in ordenes/index.html. ORDENES_INDEX_IMPROVEMENTS.md §3a.11.
    // onEscape:false (2026-09-02, pedido de recepción): una firma dibujada no
    // se pierde por un Escape accidental — se cierra solo con X / Cancelar.
    Modal.open('modalEntrega', { onEscape: false });

    // Init / resize canvas after it becomes visible so clientWidth is correct
    requestAnimationFrame(() => {
      if (!_canvasInited) {
        _initCanvas();
      } else {
        _resizeCanvas();
      }
    });

    // Backdrop click NO cierra (2026-09-02, pedido de recepción): el tap
    // afuera botaba el modal con la firma del cliente ya dibujada. Este modal
    // se cierra ÚNICAMENTE con la X o Cancelar.
    const modal = document.getElementById('modalEntrega');
    if (modal) modal.onclick = null;
  };

  window.cerrarModalEntrega = function () {
    Modal.close('modalEntrega');
    const modal = document.getElementById('modalEntrega');
    if (modal) modal.classList.add('hidden');  // preserve .hidden invariant
    _tabletReset(true);
    _ordenId = null;
    // Reset modo so the next open defaults to 'entrega' even if the
    // modal was last used for recepción.
    _modo = 'entrega';
  };

  // Atajo público para abrir el modal en modo recepción — usado por
  // botonesFlujo cuando la orden está POR ASIGNAR.
  window.abrirModalRecepcion = function (ordenId) {
    window.abrirModalEntrega(ordenId, { modo: 'recepcion' });
  };

  window.limpiarEntregaFirma = _clearCanvas;

  // ── Firma en tablet (firmas_tablet + /firmar/tablet.html) ────────────
  // Mismo mecanismo que el acuse de devolución (ordenes-devolucion.js), con
  // un ciclo de vida más simple: este modal es TRANSIENTE y compartido entre
  // órdenes, así que la solicitud se cancela al cerrar/reabrir el modal en
  // vez de sobrevivirlo. La firma llega como URL (la tablet ya la subió a
  // ordenes_firmas/) y el confirm la usa tal cual, sin canvas ni upload.
  let _solTablet = null;    // id de la solicitud pendiente en firmas_tablet
  let _unsubTablet = null;
  let _firmaTablet = null;  // {url, nombre} cuando la tablet ya firmó

  // La tablet de firmas vive EN EL MOSTRADOR: en un teléfono o pantalla
  // táctil (vendedor en la calle) la opción se oculta — parecería el acceso
  // para firmar en el propio dispositivo, y ahí el canvas del modal ya
  // cumple. Mismo corte que .btn-firma-tablet en ordenes-index.css.
  function _tabletMostradorDisponible() {
    try {
      return !window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches;
    } catch (e) { return true; }
  }

  function _tabletUI() {
    const esperando = !!_solTablet && !_firmaTablet;
    document.getElementById('entregaCanvasWrap')?.classList.toggle('hidden', esperando || !!_firmaTablet);
    document.getElementById('entregaTabletEspera')?.classList.toggle('hidden', !esperando);
    document.getElementById('entregaTabletListo')?.classList.toggle('hidden', !_firmaTablet);
    if (_firmaTablet) {
      const n = document.getElementById('entregaTabletNombre');
      if (n) n.textContent = (_firmaTablet.nombre || '—') + (_firmaTablet.cedula ? ` · Céd. ${_firmaTablet.cedula}` : '');
      const img = document.getElementById('entregaTabletPreview');
      if (img && _firmaTablet.url) img.src = _firmaTablet.url;
    }
  }

  // cancelarPendiente: true cuando el operador abandona (cerrar modal,
  // reabrir, Cancelar) — la solicitud pendiente se cancela para que no quede
  // huérfana en la tablet. La firmada no se toca: ya es constancia.
  function _tabletReset(cancelarPendiente) {
    _unsubTablet?.(); _unsubTablet = null;
    if (cancelarPendiente && _solTablet && !_firmaTablet) {
      firebase.firestore().collection('firmas_tablet').doc(_solTablet)
        .update({ estado: 'cancelada' })
        .catch(() => { /* ya firmada/cancelada: nada que hacer */ });
    }
    _solTablet = null;
    _firmaTablet = null;
    _tabletUI();
  }

  window._entregaFirmarEnTablet = async function () {
    if (!_ordenId || _solTablet || _firmaTablet) return;
    if (!_tabletMostradorDisponible()) {
      Toast.show('La firma en tablet es de la tablet del mostrador de recepción — en este dispositivo el cliente firma en el recuadro de aquí mismo.', 'warn');
      return;
    }
    const orden = APP.state.orders.find(o => o.ordenId === _ordenId) || {};
    const esRecepcion = _modo === 'recepcion';
    const ACC = [['bateria', 'Batería'], ['antena', 'Antena'], ['clip', 'Clip'],
                 ['cargador', 'Cargador'], ['fuente', 'Fuente'], ['cubrepolvo', 'Cubrepolvo']];
    const unidades = (Array.isArray(orden.equipos) ? orden.equipos : [])
      .filter(e => e && !e.eliminado)
      .map(e => ({
        serial: e.numero_de_serie || e.SERIAL || e.serial || '—',
        modelo: e.modelo || '',
        detalle: ACC.filter(([k]) => e[k]).map(([, l]) => l).join(', ') || 'Sin accesorios',
      }));
    // La leyenda que firma el cliente: solo aplica al dejar equipos de una
    // ENTRADA (mismo criterio que _toggleLegendaEntrada).
    const leyenda = String(orden.tipo_de_servicio || '').toUpperCase().includes('ENTRADA')
      ? 'Los radios ingresarán al taller para su revisión. Cualquier daño identificado como causado por mal uso, así como los accesorios o equipos no devueltos, serán notificados oportunamente mediante cotización para su posterior facturación.'
      : null;
    const user = firebase.auth().currentUser;
    try {
      const ref = await firebase.firestore().collection('firmas_tablet').add({
        tipo: esRecepcion ? 'recepcion' : 'entrega',
        estado: 'pendiente',
        orden_id: _ordenId,
        cliente_nombre: orden.cliente_nombre || '',
        contrato_id: orden.contrato?.contrato_id || null,
        numero: _ordenId,
        titulo: esRecepcion ? 'Acuse de recibo en mostrador' : 'Acuse de entrega de equipos',
        nombre_label: esRecepcion ? 'Nombre de quien entrega' : 'Nombre de quien recibe',
        leyenda,
        copia_a: null,
        unidades,
        creado_at: firebase.firestore.FieldValue.serverTimestamp(),
        creado_por_uid: user?.uid || null,
        creado_por_email: user?.email || null,
      });
      _solTablet = ref.id;
      _firmaTablet = null;
      _unsubTablet = firebase.firestore().collection('firmas_tablet').doc(ref.id)
        .onSnapshot((s) => {
          const d = s.exists ? s.data() : null;
          if (!d) return;
          if (d.estado === 'firmada') {
            _firmaTablet = { url: d.firma?.url || null, nombre: d.firma?.nombre || '', cedula: d.firma?.cedula || '' };
            _unsubTablet?.(); _unsubTablet = null; _solTablet = null;
            // El nombre que tecleó el cliente en la tablet prellena el campo
            // (editable); si recepción ya había escrito uno, se respeta.
            const inp = document.getElementById('entregaReceptorNombre');
            if (inp && !inp.value.trim() && _firmaTablet.nombre) inp.value = _firmaTablet.nombre;
            _tabletUI();
            Toast.show('Firma recibida de la tablet.', 'ok');
          } else if (d.estado === 'cancelada') {
            _tabletReset(false);
          }
        });
      _tabletUI();
      Toast.show('Solicitud enviada — ya aparece en la tablet del mostrador.', 'ok');
    } catch (err) {
      console.error('[_entregaFirmarEnTablet]', err);
      Toast.show('No se pudo enviar la solicitud a la tablet.', 'bad');
    }
  };

  window._entregaTabletCancelar = () => _tabletReset(true);
  // Descarta la firma recibida y vuelve al recuadro (p.ej. firmó la persona
  // equivocada). La firma queda archivada en la solicitud, pero la orden
  // solo guarda la que esté vigente al confirmar.
  window._entregaTabletDescartar = () => { _firmaTablet = null; _tabletUI(); };

  // Exposed for data-action change handlers in ordenes-events.js.
  // Use classList.toggle('hidden', ...) — the global `.hidden` class
  // is `display:none !important`, so plain `style.display` can't
  // override it when the element starts with class="hidden".
  window._toggleEntregaNoRecibido = function () {
    const checked = !!document.getElementById('entregaNoRecibido')?.checked;
    const nb = document.getElementById('entregaNoRecibidoBloque');
    const norm = document.getElementById('entregaNormalBloque');
    const leg  = document.getElementById('entregaLegendaEntrada');
    if (nb)   nb.classList.toggle('hidden', !checked);
    if (norm) norm.classList.toggle('hidden', checked);
    // Hide ENTRADA legend when toggled into "firma en papel" (flag
    // histórico no_recibido): la leyenda es el texto que el cliente firma
    // digitalmente, y en esta rama ya firmó la nota impresa.
    if (leg && checked) leg.classList.add('hidden');
    if (leg && !checked) {
      const t = String(leg.dataset.tipo || '').toUpperCase();
      leg.classList.toggle('hidden', !t.includes('ENTRADA'));
    }
  };

  window._toggleEntregaSinId = function () {
    const checked = !!document.getElementById('entregaSinId')?.checked;
    const conId = document.getElementById('entregaConIdBloque');
    const sinId = document.getElementById('entregaSinIdBloque');
    if (conId) conId.classList.toggle('hidden', checked);
    if (sinId) sinId.classList.toggle('hidden', !checked);
  };

  // Recepción: "equipos recibidos sin firma" — al marcar se oculta el canvas
  // de firma y se muestra el motivo (obligatorio).
  window._toggleEntregaSinFirma = function () {
    const checked = !!document.getElementById('entregaRecepcionSinFirma')?.checked;
    const bloque  = document.getElementById('entregaRecepcionSinFirmaBloque');
    const sigWrap = document.getElementById('entregaSigWrap');
    if (bloque)  bloque.classList.toggle('hidden', !checked);
    if (sigWrap) sigWrap.classList.toggle('hidden', checked);
  };

  window._entregaFotoIdChange = function (input) {
    const file = input.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const preview = document.getElementById('entregaPreviewId');
    if (preview) preview.innerHTML = `<img src="${url}" style="max-width:100%;border:1px solid var(--line);border-radius:8px;margin-top:4px;">`;
  };

  // ── ID-photo upload preparation ─────────────────────────────────
  // Modern phones produce 4–6 MB JPEGs; without resizing, a year of
  // deliveries fills storage with multi-GB of ID photos and 4G techs
  // spend 10–30 s per upload. Resize to ≤1280 px on the longest edge,
  // re-encode as JPEG q=0.85. Skip when file is already small or not an
  // image (e.g. PDF). Fail open: on any error, upload the original.
  async function _prepareIdUpload(file) {
    const origExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const origCT  = file.type || 'image/jpeg';
    if (!file.type.startsWith('image/') || file.size < 200 * 1024) {
      return { blob: file, contentType: origCT, ext: origExt };
    }
    try {
      const img = await createImageBitmap(file);
      const scale = Math.min(1, 1280 / Math.max(img.width, img.height));
      const w = Math.round(img.width  * scale);
      const h = Math.round(img.height * scale);
      const canvas = (typeof OffscreenCanvas !== 'undefined')
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const blob = canvas.convertToBlob
        ? await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
        : await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
      if (!blob) throw new Error('toBlob returned null');
      return { blob, contentType: 'image/jpeg', ext: 'jpg' };
    } catch (err) {
      console.warn('[ordenes-flujo] ID image compression failed, uploading original', err);
      return { blob: file, contentType: origCT, ext: origExt };
    }
  }

  // Email HTML is now built server-side by
  // `functions/src/domain/emailRenderer.js → buildBodyNotaEntrega`.
  // The frontend enqueues a structured payload (`template` + `data`)
  // and `onMailQueued` renders the final HTML via `renderByTemplate`.
  // Single source of truth for branding (ORDENES_INDEX_IMPROVEMENTS §3a.12).

  // Distill the order doc down to just the fields the entrega email
  // needs. Mail queue docs are public to anyone with read on the
  // collection, so we ship the minimum, not the whole order.
  // `consumos` (opcional) son las piezas registradas por el técnico
  // (subcolección consumos); se adjuntan por equipo casando por equipoId
  // con fallback por serial (equipos legacy sin id).
  function _ordenEmailSnapshot(orden, consumos = []) {
    if (!orden || typeof orden !== 'object') return {};
    const consumosDe = (e) => (Array.isArray(consumos) ? consumos : []).filter(c => {
      if (!c || !c.equipoId) return false;
      const serial = e.numero_de_serie || e.SERIAL || e.serial || null;
      return (e.id && c.equipoId === e.id) || (serial && c.equipoId === serial);
    }).map(c => ({
      pieza_nombre: c.pieza_nombre || null,
      sku:          c.sku || null,
      qty:          Number(c.qty || 0),
      precio_unit:  Number(c.precio_unit || 0),
      tipo:         c.tipo || 'cobro',
    }));
    const equipos = (Array.isArray(orden.equipos) ? orden.equipos : [])
      .filter(e => e && !e.eliminado)
      .map(e => ({
        modelo:          e.modelo || null,
        numero_de_serie: e.numero_de_serie || e.SERIAL || e.serial || null,
        trabajo_tecnico: e.trabajo_tecnico || null,
        // Accesorios (flags booleanos) — se listan en la nota como columna
        // "Accesorios", con la misma fuente de datos que "Imprimir orden".
        bateria:  !!e.bateria,
        clip:     !!e.clip,
        cargador: !!e.cargador,
        fuente:   !!e.fuente,
        antena:   !!e.antena,
        cubrepolvo: !!e.cubrepolvo,
        // Repuestos/accesorios usados por el técnico (tabla por equipo).
        consumos: consumosDe(e),
      }));
    return {
      cliente_nombre:    orden.cliente_nombre    || null,
      tecnico_asignado:  orden.tecnico_asignado  || null,
      tipo_de_servicio:  orden.tipo_de_servicio  || null,
      observaciones:     orden.observaciones     || null,
      equipos,
    };
  }

  // ── Submit recepción ────────────────────────────────────────────
  // Flujo simplificado: validar receptor + firma, subir firma a
  // Storage, llamar al service que escribe el estado RECIBIDO EN
  // MOSTRADOR. No envía email (el cliente se lleva la nota impresa
  // desde "Imprimir orden" si la necesita).
  async function _confirmarRecepcion(ordenId, user) {
    const receptorNombre = (document.getElementById('entregaReceptorNombre')?.value || '').trim();
    if (!receptorNombre) { Toast.show('Ingrese el nombre de quien entrega', 'bad'); return; }

    // "Equipos recibidos sin firma": omite la firma pero exige motivo.
    const sinFirma = !!document.getElementById('entregaRecepcionSinFirma')?.checked;
    const sinFirmaMotivo = sinFirma ? (document.getElementById('entregaRecepcionSinFirmaMotivo')?.value || '').trim() : '';
    if (sinFirma) {
      if (!sinFirmaMotivo) { Toast.show('Indique el motivo por el cual se reciben sin firma', 'bad'); return; }
    } else if (!_firmaTablet && _isCanvasEmpty()) {
      Toast.show('La firma del que entrega es obligatoria', 'bad'); return;
    }

    const btn = document.getElementById('btnConfirmarEntrega');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      let firmaUrl = null;
      if (!sinFirma && _firmaTablet?.url) {
        firmaUrl = _firmaTablet.url; // la tablet ya la subió a ordenes_firmas/
      } else if (!sinFirma) {
        const canvas = document.getElementById('entregaFirmaCanvas');
        const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
        const pathFirma = `ordenes_firmas/${ordenId}_recepcion_${Date.now()}.png`;
        await CargaDiferida.storage(); // SDK diferido (P3.15): se paga al firmar
        const refFirma = firebase.storage().ref(pathFirma);
        await refFirma.put(blob, { contentType: 'image/png' });
        firmaUrl = await refFirma.getDownloadURL();
      }

      await OrdenesService.receiveAtCounter(ordenId, {
        receptorNombre, firmaUrl, sinFirma, sinFirmaMotivo,
        cedula: (!sinFirma && _firmaTablet?.cedula) || '',
      });

      // Si el operador editó el email del cliente, persistirlo en su
      // doc — mismo patrón que confirmarEntrega. Fallo no-fatal.
      const clienteEmailInput = (document.getElementById('entregaClienteEmail')?.value || '').trim().toLowerCase();
      const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};
      if (clienteEmailInput && orden.cliente_id) {
        if (!_isValidEmail(clienteEmailInput)) {
          Toast.show('⚠️ Recepción registrada, pero el email del cliente no es válido', 'warn');
        } else {
          const clienteEmailOriginal = (_clienteDoc?.email || '').toLowerCase().trim();
          if (clienteEmailInput !== clienteEmailOriginal) {
            try {
              await ClientesService.updateCliente(orden.cliente_id, { email: clienteEmailInput });
            } catch (err) {
              console.warn('[confirmarRecepcion] no se pudo actualizar email del cliente', err);
            }
          }
        }
      }

      cerrarModalEntrega();
      Toast.show('✅ Recepción registrada correctamente', 'ok');
    } catch (err) {
      console.error('[confirmarRecepcion]', err);
      Toast.show('❌ Error al registrar la recepción: ' + err.message, 'bad');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="check"></i> <span id="btnConfirmarEntregaLabel">Confirmar Recepción</span>';
        APP.utils.lucideRefresh(btn);
      }
    }
  }

  // ── Submit ──────────────────────────────────────────────────────
  window.confirmarEntrega = async function () {
    if (!_ordenId) return;
    const ordenId = _ordenId;
    const user = firebase.auth().currentUser;
    if (!user) { Toast.show('No hay usuario autenticado', 'bad'); return; }

    // Despacha al flujo de recepción cuando el modal fue abierto en ese
    // modo — comparte canvas/validaciones/firma pero salta no-recibido,
    // ID, leyenda y email automático.
    if (_modo === 'recepcion') {
      return _confirmarRecepcion(ordenId, user);
    }

    const noRecibido = !!document.getElementById('entregaNoRecibido')?.checked;
    const orden = APP.state.orders.find(o => o.ordenId === ordenId) || {};

    // Notas de entrega — opcionales, libres. Aplican a ambos flujos
    // (entrega normal y no-recibido) y se incluyen en el email.
    const notasEntrega = (document.getElementById('entregaNotas')?.value || '').trim();

    // Email del cliente — editable en el modal. Si está vacío se omite
    // el envío al cliente; si tiene formato inválido se aborta.
    const clienteEmailInput = (document.getElementById('entregaClienteEmail')?.value || '').trim().toLowerCase();
    if (clienteEmailInput && !_isValidEmail(clienteEmailInput)) {
      Toast.show('El email del cliente no tiene un formato válido', 'bad');
      return;
    }

    const btn = document.getElementById('btnConfirmarEntrega');
    if (btn) { btn.disabled = true; btn.textContent = 'Guardando…'; }

    try {
      let firestoreData = {
        estado_reparacion: 'ENTREGADO AL CLIENTE',
        no_recibido: noRecibido,
        notas_entrega: notasEntrega || null,
        fecha_entrega: firebase.firestore.FieldValue.serverTimestamp(),
        entrega_por_uid: user.uid,
        entrega_por_email: user.email,
        os_logs: firebase.firestore.FieldValue.arrayUnion({ action: 'ENTREGAR', by: user.uid })
      };
      let emailOpts = { noRecibido, notas: notasEntrega };

      if (noRecibido) {
        // ── Branch A: entrega con firma en papel (sin firma digital) ──
        // `no_recibido` es el nombre histórico del flag: el cliente SÍ
        // recibió y firmó la nota impresa; lo que falta es la firma digital.
        const motivo = (document.getElementById('entregaNoRecibidoMotivo')?.value || '').trim();
        const personaInterna = (document.getElementById('entregaPersonaInterna')?.value || '').trim();
        if (!motivo) { Toast.show('Indique por qué no se pudo firmar digitalmente', 'bad'); return; }
        if (!personaInterna) { Toast.show('Indique quién recibió los equipos por el cliente', 'bad'); return; }
        firestoreData.no_recibido_motivo = motivo;
        firestoreData.entrega_persona_interna = personaInterna;
        emailOpts = { ...emailOpts, motivo, personaInterna };

      } else {
        // ── Branch B: normal delivery ──
        const receptorNombre = (document.getElementById('entregaReceptorNombre')?.value || '').trim();
        const sinId = !!document.getElementById('entregaSinId')?.checked;
        const sinIdMotivo = sinId ? (document.getElementById('entregaSinIdMotivo')?.value || '').trim() : '';

        if (!receptorNombre) { Toast.show('Ingrese el nombre de quien recibe', 'bad'); return; }
        if (!_firmaTablet && _isCanvasEmpty()) { Toast.show('La firma es obligatoria', 'bad'); return; }
        if (sinId && !sinIdMotivo) { Toast.show('Indique por qué el cliente no proporciona ID', 'bad'); return; }

        // Firma: de la tablet (ya subida a Storage por /firmar/tablet.html)
        // o del canvas del modal.
        await CargaDiferida.storage(); // SDK diferido (P3.15): cubre firma + ID abajo
        let firmaUrl;
        if (_firmaTablet?.url) {
          firmaUrl = _firmaTablet.url;
        } else {
          const canvas = document.getElementById('entregaFirmaCanvas');
          const blob = await (await fetch(canvas.toDataURL('image/png'))).blob();
          const pathFirma = `ordenes_firmas/${ordenId}_firma_${Date.now()}.png`;
          const refFirma = firebase.storage().ref(pathFirma);
          await refFirma.put(blob, { contentType: 'image/png' });
          firmaUrl = await refFirma.getDownloadURL();
        }

        // Upload ID photo (if provided and not waived). We store only the
        // Storage PATH — never a tokenized download URL — because the ID is
        // sensitive PII. Admins view it via the getIdentificacionUrl callable
        // (short-lived signed URL). See storage.rules: read is locked off.
        let identificacionPath = null;
        if (!sinId) {
          const fileIdRaw = document.getElementById('entregaFotoId')?.files[0];
          if (fileIdRaw) {
            const { blob, contentType, ext } = await _prepareIdUpload(fileIdRaw);
            const pathId = `ordenes_identificacion/${ordenId}_id_${Date.now()}.${ext}`;
            const refId  = firebase.storage().ref(pathId);
            await refId.put(blob, { contentType });
            identificacionPath = pathId;
          }
        }

        firestoreData.receptor_nombre = receptorNombre;
        // Cédula de quien recibe — hoy solo la captura la firma en tablet.
        firestoreData.receptor_cedula = _firmaTablet?.cedula || null;
        firestoreData.firma_url = firmaUrl;
        firestoreData.identificacion_path = identificacionPath;
        firestoreData.sin_id = sinId;
        firestoreData.sin_id_motivo = sinId ? sinIdMotivo : null;
        emailOpts = { ...emailOpts, receptorNombre, firmaUrl, sinId, sinIdMotivo };
      }

      await OrdenesService.mergeOrder(ordenId, firestoreData);

      // Look up recipient emails in parallel. _clienteDoc was populated
      // when the modal opened; refetch only if missing (e.g., modal opened
      // before the async load resolved or no orden.cliente_id at open time).
      const clienteDocPromise = _clienteDoc
        ? Promise.resolve(_clienteDoc)
        : (orden.cliente_id ? ClientesService.getCliente(orden.cliente_id).catch(() => null) : Promise.resolve(null));
      const [clienteDoc, vendedorDoc, tecnicoDoc, empresaConfig, consumosOrden] = await Promise.all([
        clienteDocPromise,
        orden.vendedor_asignado ? UsuariosService.getUsuario(orden.vendedor_asignado).catch(() => null)    : Promise.resolve(null),
        orden.tecnico_uid      ? UsuariosService.getUsuario(orden.tecnico_uid).catch(() => null)           : Promise.resolve(null),
        // Buzón único de recepción (config de empresa) — lleva el control de entregas.
        EmpresaService.getConfig().catch(() => ({})),
        // Repuestos registrados por el técnico — se agrupan por equipo en el
        // correo. Fallo no-fatal: la nota sale sin esa tabla.
        OrdenesService.getConsumos(ordenId).catch(err => { console.warn('[confirmarEntrega] no se pudieron cargar los consumos', err); return []; }),
      ]);

      // Persist email change back to the cliente doc if the user edited
      // it. Skip when blank (user opted out of cliente email this time)
      // or when unchanged. Failure is non-fatal — the entrega already
      // saved; we just log so it can be retried manually later.
      const clienteEmailOriginal = (clienteDoc?.email || '').toLowerCase().trim();
      if (orden.cliente_id && clienteEmailInput && clienteEmailInput !== clienteEmailOriginal) {
        try {
          await ClientesService.updateCliente(orden.cliente_id, { email: clienteEmailInput });
        } catch (err) {
          console.warn('[confirmarEntrega] no se pudo actualizar email del cliente', err);
          Toast.show('⚠️ Entrega registrada, pero no se pudo actualizar el email del cliente', 'warn');
        }
      }
      const clienteEmailToUse = clienteEmailInput || clienteEmailOriginal;

      const subject = `Nota de Entrega — Orden ${ordenId}${noRecibido ? ' (Firma en papel)' : ''}`;
      // Structured payload — onMailQueued renders the body via
      // emailRenderer.renderByTemplate. fechaISO is included so the
      // email reflects the moment the entrega was confirmed even if
      // there's queue latency. ctaUrl se inyecta por-destinatario (abajo).
      const baseData = {
        ordenId,
        orden:  _ordenEmailSnapshot(orden, consumosOrden),
        opts:   { ...emailOpts, fechaISO: new Date().toISOString() },
      };

      // CTA "Ver orden": deep-link al índice INTERNO → abre el modal de
      // Entrega/Recepción sobre la lista completa de órdenes. Es útil para
      // el personal, pero NO debe ir al cliente: detrás del modal quedaría
      // expuesta toda la cartera de órdenes de la empresa (y la página exige
      // login del staff). Por eso el cliente recibe la nota SIN botón — el
      // cuerpo del correo ya es su comprobante completo (equipos, receptor,
      // firma, notas). Solo los internos llevan el deep-link.
      const internalCtaUrl = `https://app.cecomunica.net/ordenes/index.html?entrega=${encodeURIComponent(ordenId)}`;

      // Destinatarios. Set normaliza a minúsculas para no duplicar.
      const recepcionEmail = (empresaConfig?.email_recepcion_entregas || '').toLowerCase().trim();
      const clienteEmail   = (clienteEmailToUse || '').toLowerCase().trim();
      const internos = new Set();
      if (vendedorDoc?.email) internos.add(vendedorDoc.email.toLowerCase().trim());
      if (tecnicoDoc?.email)  internos.add(tecnicoDoc.email.toLowerCase().trim());
      if (recepcionEmail)     internos.add(recepcionEmail);
      // Jefe de taller (empresa/config.email_taller — string o array).
      const tallerCfg = empresaConfig?.email_taller;
      (Array.isArray(tallerCfg) ? tallerCfg : (tallerCfg ? [tallerCfg] : []))
        .map(e => String(e || '').toLowerCase().trim())
        .filter(Boolean)
        .forEach(e => internos.add(e));
      // Si el correo del cliente coincide con uno interno, mándalo como cliente
      // (sin link) — nunca le des el deep-link a un destinatario externo.
      if (clienteEmail) internos.delete(clienteEmail);

      const jobs = [];
      if (clienteEmail) {
        jobs.push(MailService.enqueue({ to: clienteEmail, subject, template: 'nota_entrega', data: baseData }));
      }
      for (const to of internos) {
        if (!to) continue;
        // `interno: true` habilita columnas sensibles (precio/tipo) en la
        // tabla de repuestos — el cliente recibe la nota sin precios.
        jobs.push(MailService.enqueue({
          to, subject, template: 'nota_entrega',
          data: { ...baseData, ctaUrl: internalCtaUrl, interno: true },
        }));
      }
      await Promise.allSettled(jobs);

      cerrarModalEntrega();
      Toast.show('✅ Entrega registrada correctamente', 'ok');
      // Live snapshot picks up the estado_reparacion + fecha_entrega
      // write — no manual reload.

    } catch (err) {
      console.error('[confirmarEntrega]', err);
      Toast.show('❌ Error al registrar la entrega: ' + err.message, 'bad');
    } finally {
      if (btn) {
        btn.disabled = false;
        // Preserva el span btnConfirmarEntregaLabel para que la próxima
        // apertura del modal (potencialmente en modo recepción) pueda
        // ajustar el texto vía _applyModo.
        btn.innerHTML = '<i data-lucide="check"></i> <span id="btnConfirmarEntregaLabel">Confirmar Entrega</span>';
        APP.utils.lucideRefresh(btn);
      }
    }
  };

})();

