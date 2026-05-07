// @ts-nocheck
const PAGE_LIMIT_BY_ROLE = { administrador: 40, vendedor: 30, recepcion: 20 };
const MAX_ROWS_BY_ROLE = { administrador: 400, vendedor: 250, recepcion: 120 };
const MIN_QUERY_INTERVAL_MS = 800;
let isLoadingContratos = false;
let lastQueryAt = 0;

function getPageLimit() {
  return PAGE_LIMIT_BY_ROLE[AUTH.getRole()] || 20;
}

function getMaxRows() {
  return MAX_ROWS_BY_ROLE[AUTH.getRole()] || 120;
}

function updateBtnCargarMasState(forceNoMore = false) {
  const btn = document.getElementById('btnCargarMas');
  if (!btn) return;

  const reachedMax = contratosCargados.length >= getMaxRows();
  const noMore = !!forceNoMore || !lastDoc || reachedMax;
  btn.disabled = isLoadingContratos || noMore;

  if (reachedMax) btn.textContent = '🔒 Límite de consulta alcanzado';
  else if (noMore) btn.textContent = 'Sin más resultados';
  else btn.textContent = isLoadingContratos ? '⏳ Cargando...' : '⬇️ Cargar más contratos';
}

document.getElementById('btnCargarMas').addEventListener('click', async () => {
  if (isLoadingContratos) return;
  if (contratosCargados.length >= getMaxRows()) {
    Toast.show('⚠️ Límite de consulta alcanzado para tu rol.', 'warn');
    updateBtnCargarMasState(true);
    return;
  }
  await cargarContratos(false);
});

  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

    let contratoPendiente = null;
    let contratoIDPendiente = null;

    let mapaUsuarios = {};

    async function cargarUsuarios() {
      if (!currentUser?.uid) return;
      if (!mapaUsuarios[currentUser.uid]) {
        const me = await db.collection("usuarios").doc(currentUser.uid).get();
        if (me.exists) {
          const u = me.data() || {};
          mapaUsuarios[currentUser.uid] = u.nombre || u.email || currentUser.uid;
        }
      }
    }

    async function precargarUsuariosParaContratos(contratos) {
      const ids = [...new Set((contratos || []).map(c => c?.creado_por_uid).filter(Boolean))]
        .filter(uid => !mapaUsuarios[uid]);
      if (!ids.length) return;

      const chunks = [];
      for (let i = 0; i < ids.length; i += 10) {
        chunks.push(ids.slice(i, i + 10));
      }

      for (const chunk of chunks) {
        const snap = await db.collection("usuarios")
          .where(firebase.firestore.FieldPath.documentId(), "in", chunk)
          .get();
        snap.forEach(doc => {
          const u = doc.data() || {};
          mapaUsuarios[doc.id] = u.nombre || u.email || doc.id;
        });
      }
    }

   const auth = firebase.auth();
let currentUser = null;
let lastDoc = null;
let contratosCargados = [];
let campoOrden = "fecha_creacion";
let direccionAsc = false;

auth.onAuthStateChanged(async user => {
  if (!user) {
    window.location.href = "/login.html";
  } else {
    currentUser = user;
    const snap = await db.collection("usuarios").doc(user.uid).get();
    const rol = snap.data()?.rol || "vista";
    window.userRole = rol;

    aplicarRestriccionesPorRol(rol);      // valida acceso primero
    await cargarUsuarios();               // mapa de usuarios para "Creado por"
    await cargarContratos(true);          // luego carga la tabla
    updateBtnCargarMasState(false);

    // 🔗 Si viene desde el email con ?aprobar=DOC_ID, abre el modal de aprobación
    const params = new URLSearchParams(location.search);
    const aprobarId = params.get("aprobar");
    if (aprobarId) {
      if (rol === ROLES.ADMIN) {
        try {
          const doc = await ContratosService.getContrato(aprobarId);
          if (doc) {
            aprobarContrato(aprobarId);   // muestra overlay con los detalles
              // 🚨 Eliminar el parámetro ?aprobar de la URL una vez abierto
            const url = new URL(window.location);
            url.searchParams.delete("aprobar");
            window.history.replaceState({}, document.title, url.toString());
          } else {
            Toast.show("⚠️ El contrato indicado no existe o fue eliminado.", 'warn');
          }
        } catch (e) {
          console.error(e);
          Toast.show("⚠️ No se pudo abrir el contrato para aprobación.", 'warn');
        }
      } else {
        Toast.show("⚠️ Solo un administrador puede aprobar contratos.", 'warn');
      }
    }
  }
});

   function aplicarRestriccionesPorRol(rol) {
  // Solo admin, vendedor y recepción pueden usar este módulo
  if (rol !== ROLES.ADMIN && rol !== ROLES.VENDEDOR && rol !== ROLES.RECEPCION) {
    alert("❌ No autorizado para ver Contratos.");
    window.location.href = "/index.html";
    return;
  }

  const btnNuevoContrato = document.getElementById("btnNuevoContrato");
  if (btnNuevoContrato) {
    btnNuevoContrato.style.display = (rol === ROLES.ADMIN || rol === ROLES.VENDEDOR) ? "inline-block" : "none";
  }

  // ⚠️ Botón de backfill deshabilitado - Cloud Functions sincronizan automáticamente
  // const btnBackfill = document.getElementById("btnBackfillEquipos");
  // if (btnBackfill && rol === ROLES.ADMIN) {
  //   btnBackfill.style.display = "inline-block";
  // }

  // Mostrar botón "Nuevo Contrato" solo a admin y vendedor
  // (si quieres ocultarlo al vendedor, quita 'vendedor' del if)
  // No tocar nada si debe estar visible para ambos
}

const chkSoloPendientes = document.getElementById('chkSoloPendientes');
if (chkSoloPendientes) {
  chkSoloPendientes.addEventListener('change', () => {
    const sel = document.getElementById('filtroEstado');
    if (!sel) return;
    sel.value = chkSoloPendientes.checked ? 'pendiente_aprobacion' : '';
    cargarContratos(true);
  });

  (function initSoloPendState() {
    const sel = document.getElementById('filtroEstado');
    chkSoloPendientes.checked = !!(sel && sel.value === 'pendiente_aprobacion');
  })();
}

const btnLimpiarBusqueda = document.getElementById('btnLimpiarBusqueda');
if (btnLimpiarBusqueda) {
  btnLimpiarBusqueda.addEventListener('click', () => {
    const inputCliente = document.getElementById('filtroCliente');
    const selEstado = document.getElementById('filtroEstado');
    const chkPend = document.getElementById('chkSoloPendientes');
    const chkInactivos = document.getElementById('chkMostrarInactivos');

    if (inputCliente) inputCliente.value = '';
    if (selEstado) selEstado.value = '';
    if (chkPend) chkPend.checked = false;
    if (chkInactivos) chkInactivos.checked = false;

    cargarContratos(true);
  });
}

// Listener para el ganchito de inactivos/anulados
const chkMostrarInactivos = document.getElementById("chkMostrarInactivos");
if (chkMostrarInactivos) {
  chkMostrarInactivos.addEventListener("change", () => {
    cargarContratos(true);
  });
}

// 🔍 Debounced search for client name (searches entire database)
let searchTimeout;
const filtroClienteInput = document.getElementById("filtroCliente");
if (filtroClienteInput) {
  filtroClienteInput.addEventListener("input", () => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
      cargarContratos(true);
    }, 500); // Wait 500ms after user stops typing
  });

  // Also trigger on Enter key
  filtroClienteInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimeout);
      cargarContratos(true);
    }
  });
}

    document.getElementById("btnFiltrar").addEventListener("click", () => cargarContratos(true));

    function limpiarTabla() {
      document.getElementById("tablaContratos").innerHTML = "";
      document.getElementById("resumenContratos").innerHTML = '<div class="loader" style="width: 24px; height: 24px; border-width: 3px;"></div>';
    }

function crearFilaContrato(id, data) {
  const puedeEditar = (AUTH.is(ROLES.ADMIN) || AUTH.is(ROLES.VENDEDOR));
  const esAdmin = AUTH.is(ROLES.ADMIN);
  const esRecepcion = AUTH.is(ROLES.RECEPCION);
  const puedePanelTrabajo = esAdmin || esRecepcion;
  const editable = puedeEditar && !['activo','aprobado','anulado'].includes(data.estado);
  const yaFirmado = !!data.firmado_url;

  // Estado: clase y texto
  const estadoClase =
    data.estado === 'activo' ? 'estado-activo' :
    data.estado === 'aprobado' ? 'estado-aprobado' :
    data.estado === 'pendiente_aprobacion' ? 'estado-pendiente' :
    data.estado === 'anulado' ? 'estado-anulado' :
    'estado-inactivo';

  const estadoTexto =
    data.estado === 'pendiente_aprobacion' ? 'Pendiente Aprobación' :
    data.estado === 'aprobado' ? 'Aprobado' :
    data.estado === 'activo' ? 'Activo' :
    data.estado === 'anulado' ? 'Anulado' :
    'Inactivo';

  // ✔️ Ganchito si está marcado para comisión
  const iconoComisionFila = data.listo_para_comision
    ? `<span title="Listo para Comisión" aria-label="Listo para comisión" style="margin-left:6px;">✔️</span>`
    : '';

  // Totales normalizados (con fallback)
  const tot = ContractTotals.fromDoc(data);

  // Botones base
  const btnImprimir = data.contrato_id
    ? `<button class="btn" onclick="verContrato('${data.contrato_id}')" title="Imprimir/Ver">🖨️</button>`
    : '';

  const btnEditar = editable
    ? `<button class="btn" onclick="editarContrato('${id}')" title="Editar">✏️</button>`
    : '';

  // Eliminar: no mostrar si activo, aprobado o anulado
  let btnBorrar = '';
  if (!['activo','aprobado','anulado'].includes(data.estado)) {
    if (esAdmin || AUTH.is(ROLES.VENDEDOR)) {
      btnBorrar = `<button class="btn danger" onclick="borrarContrato('${id}')" title="Eliminar">🗑️</button>`;
    }
  }

  // Firmado: solo si aprobado
  let bloqueFirmado = '';
  const puedeSubirFirmado = (data.estado === 'aprobado') && puedeEditar;

  if (yaFirmado) {
    bloqueFirmado = `<a class="btn" href="${data.firmado_url}" target="_blank" rel="noopener" title="Ver firmado">📄</a>`;
    if (puedeSubirFirmado) {
      bloqueFirmado += ` <button class="btn" onclick="subirFirmado('${id}')" title="Reemplazar firmado">🔁</button>`;
    }
  } else if (puedeSubirFirmado) {
    bloqueFirmado = `<button class="btn" onclick="subirFirmado('${id}')" title="Subir contrato firmado">📤</button>`;
  }

// Eliminado para evitar correo duplicado (solo quedará el de template via mail_queue)
const btnSolicitar = '';


  // Anular: solo admin si activo o aprobado
  const btnAnular = (['activo','aprobado'].includes(data.estado) && esAdmin)
    ? `<button class="btn danger" onclick="anularContrato('${id}')" title="Anular contrato APROBADO o ACTIVO">🚫</button>`
    : '';

  // Duplicar: si está anulado o inactivo
  const btnDuplicar = (puedeEditar && (data.estado === 'anulado' || data.estado === 'inactivo'))
    ? `<button class="btn" onclick="duplicarContrato('${id}')" title="Duplicar contrato">📄</button>`
    : '';

  // Comisión (solo admin)
  const btnComisionAgregar = esAdmin && !data.listo_para_comision
    ? `<button class="btn" onclick="marcarParaComision('${id}')" title="Marcar como listo para comisión">💰</button>`
    : '';
  const btnComisionQuitar = esAdmin && data.listo_para_comision
    ? `<button class="btn danger" onclick="quitarMarcaComision('${id}')" title="Quitar marca de comisión">🧹</button>`
    : '';

  const accionesHtml = esRecepcion
    ? `${btnImprimir}${puedePanelTrabajo ? `<button class="btn" onclick="abrirPanelTrabajoContrato('${id}')" title="Panel de trabajo">🗂️</button>` : ''}`
    : `${btnImprimir}
      ${puedePanelTrabajo ? `<button class="btn" onclick="abrirPanelTrabajoContrato('${id}')" title="Panel de trabajo">🗂️</button>` : ''}
      ${btnEditar}
      ${btnBorrar}
      ${bloqueFirmado}
      ${btnSolicitar}
      ${esAdmin && data.estado === 'pendiente_aprobacion' ? `<button class="btn" onclick="aprobarContrato('${id}')" title="Aprobar">✅</button>` : ''}
      ${btnComisionAgregar}
      ${btnComisionQuitar}
      ${btnAnular}
      ${btnDuplicar}`;

  const fila = document.createElement('tr');
  fila.setAttribute('data-contrato-doc-id', id); // Para referencia en cargarIconosEquipos
  fila.innerHTML = `
    <td>${data.contrato_id || "-"} ${iconoComisionFila}</td>
    <td>${esc(data.cliente_nombre || "-")}</td>
    <td>${esc(data.tipo_contrato || "-")}</td>
    <td>${esc(data.accion || "-")}</td>
    <td style="text-align: center;" data-contrato-equipos="${id}">
      <span style="opacity:0.3;">⏳</span>
    </td>
    <td class="estado-cell">
      <span class="estado ${estadoClase}">
        <span class="estado-dot" aria-hidden="true"></span>
        ${estadoTexto}
      </span>
    </td>
    <td>${data.fecha_creacion?.toDate ? data.fecha_creacion.toDate().toLocaleDateString() : "-"}</td>
    <td>${esc(mapaUsuarios[data.creado_por_uid] || "-")}</td>
    <td>${FMT.money(tot.totalConITBMS)}</td>
    <td class="acciones">${accionesHtml}</td>
  `;
  return fila;
}
async function anularContrato(id) {
  try {
    const c = await ContratosService.getContrato(id);
    if (!c) return alert("Contrato no encontrado.");

    const esAdmin = AUTH.is(ROLES.ADMIN);

    // Ahora solo se puede anular si está ACTIVO y eres ADMIN
    if (!esAdmin) {
      return alert("Solo el administrador puede anular contratos.");
    }
if (!["activo","aprobado"].includes(c.estado)) {
  return alert("Solo se puede anular un contrato ACTIVO o APROBADO.");
}

    const motivo = prompt("Motivo de anulación (ej: envío errado, datos incorrectos):");
    if (motivo === null) return; // cancelado
    const motivoTrim = (motivo || "").trim();
    if (!motivoTrim) return alert("Debes indicar un motivo.");

    const update = {
      estado: "anulado",
      anulado: true,
      anulado_motivo: motivoTrim,
      anulado_fecha: firebase.firestore.Timestamp.now(),
      anulado_por_uid: firebase.auth().currentUser?.uid || null,
      anulado_ref: c.contrato_id || id,
      fecha_modificacion: new Date()
    };

    // Si estaba firmado, preserva evidencia y limpia los campos vigentes
    if (c.firmado || c.firmado_url) {
      update.firmado_anulado = true;
      update.firmado_url_anulado = c.firmado_url || null;
      update.firmado_nombre_anulado = c.firmado_nombre || null;
      update.firmado_storage_path_anulado = c.firmado_storage_path || null;
      update.firmado_fecha_anulado = c.firmado_fecha || null;

      update.firmado = false;
      update.firmado_url = null;
      update.firmado_nombre = null;
      update.firmado_storage_path = null;
      update.firmado_fecha = null;
      update.firmado_por_uid = null;
    }

    await ContratosService.updateContrato(id, update);

    Toast.show("✅ Contrato ANULADO correctamente.", 'ok');
    setTimeout(() => location.reload(), 1000);
  } catch (e) {
    console.error(e);
    alert("No se pudo anular el contrato.");
  }
}

async function duplicarContrato(id) {
  try {
    const c = await ContratosService.getContrato(id);
    if (!c) return alert("Contrato no encontrado.");

    // Arma borrador para prellenar: NO escribas en Firestore aquí
    const draft = {
      cliente_id: c.cliente_id || "",
      codigo_tipo: c.codigo_tipo || "",        // ALQ/PROP/REEMP/DEMO
      accion: c.accion || "",
      renovacion_sin_equipo: !!c.renovacion_sin_equipo,
      renovacion_refurbished_componentes: !!c.renovacion_refurbished_componentes,
      duracion: c.duracion || "",              // "12 meses" | "18 meses" | "XX meses"
      observaciones: c.observaciones || "",
      equipos: (c.equipos || []).map(e => ({
        modelo_id: e.modelo_id || null,
        modelo: e.modelo || "",
        descripcion: e.descripcion || "Equipos de Comunicación",
        cantidad: Number(e.cantidad || 0),
        precio: Number(e.precio || 0)
      }))
    };

    // Guarda borrador en sessionStorage
    sessionStorage.setItem("contrato_prefill", JSON.stringify(draft));
    delete draft.estado;


    // Redirige a "nuevo-contrato" para que ahí se genere un nuevo contrato_id
    const q = draft.cliente_id ? `?prefill=1&cliente_id=${encodeURIComponent(draft.cliente_id)}` : `?prefill=1`;
    window.location.href = `nuevo-contrato.html${q}`;
  } catch (e) {
    console.error(e);
    alert("No se pudo preparar el borrador para duplicar.");
  }
}


async function aprobarContrato(id) {
  console.log(">>> [UI] Abrir overlay / buscar contrato en Firestore. doc.id =", id);
  contratoPendiente = await ContratosService.getContrato(id);
  if (!contratoPendiente) {
    console.error(">>> [UI] Contrato no encontrado en Firestore. doc.id =", id);
    return alert("Contrato no encontrado");
  }
  contratoIDPendiente = id;

  const esRenovacion = contratoPendiente.accion === "Renovación";
  const esRenovacionSinEquipo = esRenovacion && !!contratoPendiente.renovacion_sin_equipo;
  const renovacionModalidadTexto = esRenovacion
    ? (esRenovacionSinEquipo ? "Renovación sin equipo" : "Renovación con equipo")
    : "No aplica";
  const refurbishedTexto = esRenovacionSinEquipo
    ? (contratoPendiente.renovacion_refurbished_componentes ? "Sí, incluye refurbished de batería, antena, clip y piezas" : "No incluye refurbished")
    : "No aplica";

  let elaborador = "-";
  if (contratoPendiente.creado_por_uid) {
    elaborador = mapaUsuarios[contratoPendiente.creado_por_uid] || "-";
    if (elaborador === "-") {
      try {
        const userSnap = await db.collection("usuarios").doc(contratoPendiente.creado_por_uid).get();
        if (userSnap.exists) {
          const u = userSnap.data() || {};
          elaborador = u.nombre || u.email || contratoPendiente.creado_por_uid;
          mapaUsuarios[contratoPendiente.creado_por_uid] = elaborador;
        }
      } catch (e) {
        console.warn("No se pudo resolver elaborador para modal de aprobación", e);
      }
    }
  }

  // Totales normalizados para el modal
  const totModal = ContractTotals.fromDoc(contratoPendiente);

  const detalles = `
    <p><strong>Contrato ID:</strong> ${esc(contratoPendiente.contrato_id)}</p>
    <p><strong>Cliente:</strong> ${esc(contratoPendiente.cliente_nombre)}</p>
    <p><strong>Elaborador:</strong> ${esc(elaborador)}</p>
    <p><strong>Tipo:</strong> ${esc(contratoPendiente.tipo_contrato)}</p>
    <p><strong>Acción:</strong> ${esc(contratoPendiente.accion)}</p>
    <p><strong>Modalidad renovación:</strong> ${esc(renovacionModalidadTexto)}</p>
    <p><strong>Refurbished batería/antena/clip/piezas:</strong> ${esc(refurbishedTexto)}</p>
    <p><strong>Observaciones:</strong> ${esc(contratoPendiente.observaciones || "-")}</p>

    <div style="margin-top:8px; padding:8px; border:1px dashed var(--line); border-radius:8px; max-width:420px;">
      <div style="display:flex; justify-content:space-between;"><span>Subtotal</span><strong>${FMT.money(totModal.subtotal)}</strong></div>
      <div style="display:flex; justify-content:space-between;"><span>${totModal.itbmsLabel}</span><strong>${FMT.money(totModal.itbmsMonto)}</strong></div>
      <div style="border-top:1px solid var(--line); margin-top:6px; padding-top:6px; display:flex; justify-content:space-between;">
        <span>Total</span><strong>${FMT.money(totModal.totalConITBMS)}</strong>
      </div>
    </div>
  `;
  document.getElementById("detallesContrato").innerHTML = detalles;

  const tbody = document.getElementById("tablaEquiposAprobacion");
  tbody.innerHTML = "";
  (contratoPendiente.equipos || []).forEach(eq => {
  const fila = document.createElement("tr");
  const subtotal = (eq.cantidad || 0) * (eq.precio || 0);
  fila.innerHTML = `
    <td style="border:1px solid #ccc; padding:6px;">${esc(eq.modelo || "")}</td>
    <td style="border:1px solid #ccc; padding:6px;">${Number(eq.cantidad || 0)}</td>
    <td style="border:1px solid #ccc; padding:6px;">$${Number(eq.precio || 0).toFixed(2)}</td>
    <td style="border:1px solid #ccc; padding:6px;">$${subtotal.toFixed(2)}</td>
  `;
  tbody.appendChild(fila);
});

  abrirOverlay();

}
function cancelarAprobacion() {
  contratoIDPendiente = null;
  contratoPendiente = null;
  cerrarOverlay(); // ← en vez de style.display = 'none'
}

async function confirmarAprobacion() {
  if (!contratoIDPendiente) { alert("No hay contrato seleccionado para aprobar."); return; }
  const btn = document.querySelector('#overlayAprobacion .btn.ok');
  if (btn) btn.disabled = true;

  try {
    const c = await ContratosService.getContrato(contratoIDPendiente);
    if (!c) return alert("Contrato no encontrado.");

    if (c.estado === "anulado") { alert("Este contrato fue ANULADO y no puede aprobarse."); return; }
    if (c.estado !== "pendiente_aprobacion") { alert("Solo se pueden aprobar contratos en 'Pendiente Aprobación'."); return; }

  await ContratosService.updateContrato(contratoIDPendiente, {
    estado: "aprobado",
    fecha_aprobacion: firebase.firestore.Timestamp.now(),
    aprobado_por_uid: firebase.auth().currentUser?.uid || null
  });

    cerrarOverlay();
    Toast.show("✅ Contrato aprobado. Enviando PDF por correo en segundo plano…", 'ok');
    setTimeout(() => location.reload(), 1200);
  } catch (e) {
    console.error(e);
    alert("No se pudo aprobar el contrato.");
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function editarContrato(id) {
  try {
    const c = await ContratosService.getContrato(id);
    if (!c) {
      alert("Contrato no encontrado.");
      return;
    }
if (c.estado === "activo" || c.estado === "aprobado") {
  alert("Este contrato ya fue aprobado y no se puede editar.");
  return;
}
if (c.estado === "anulado") {
  alert("Este contrato fue ANULADO y no se puede editar. Usa 'Duplicar' para rehacerlo.");
  return;
}

    window.location.href = `editar-contrato.html?id=${id}`;
  } catch (e) {
    console.error(e);
    alert("No se pudo validar el estado del contrato.");
  }
}

async function borrarContrato(id) {
  try {
    const c = await ContratosService.getContrato(id);
    if (!c) return alert("Contrato no encontrado.");

    const esAdmin = AUTH.is(ROLES.ADMIN);
    const esVendedor = AUTH.is(ROLES.VENDEDOR);

if (["activo","aprobado","anulado"].includes(c.estado)) {
  return alert("Un contrato APROBADO/ACTIVO/ANULADO no se puede eliminar. Use ANULAR si corresponde.");
}

    // Vendedor solo puede borrar si no está activo ni anulado (ya validado) y (opcional) si es su creador
    if (esVendedor && c.creado_por_uid && c.creado_por_uid !== (firebase.auth().currentUser?.uid || "")) {
      return alert("Solo el creador o un administrador pueden eliminar este contrato.");
    }

    if (!confirm("¿Seguro que deseas eliminar este contrato?")) return;

    await ContratosService.updateContrato(id, {
      deleted: true,
      fecha_modificacion: new Date()
    });
    Toast.show("✅ Contrato eliminado", 'ok');
    setTimeout(() => location.reload(), 1500);

  } catch (e) {
    console.error(e);
    alert("No se pudo eliminar el contrato.");
  }
}
async function marcarParaComision(id) {
  try {
    if (!AUTH.is(ROLES.ADMIN)) {
      alert("Solo el administrador puede cambiar este estado.");
      return;
    }
    if (!confirm("¿Marcar este contrato como 'Listo para Comisión'?")) return;

    await ContratosService.updateContrato(id, {
      listo_para_comision: true,
      fecha_envio_comision: firebase.firestore.Timestamp.now(),
      enviado_por_uid: firebase.auth().currentUser?.uid || null,
      fecha_modificacion: new Date()
    });

    Toast.show("💼 Marcado como listo para comisión.", 'ok');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    console.error(e);
    alert("No se pudo marcar como listo para comisión.");
  }
}

async function quitarMarcaComision(id) {
  try {
    if (!AUTH.is(ROLES.ADMIN)) {
      alert("Solo el administrador puede cambiar este estado.");
      return;
    }
    if (!confirm("¿Quitar la marca de 'Listo para Comisión'?")) return;

    await ContratosService.updateContrato(id, {
      listo_para_comision: false,
      fecha_envio_comision: null,
      enviado_por_uid: null,
      fecha_modificacion: new Date()
    });

    Toast.show("Etiqueta de comisión retirada.", 'ok');
    setTimeout(() => location.reload(), 600);
  } catch (e) {
    console.error(e);
    alert("No se pudo quitar la marca de comisión.");
  }
}


function filtrarLocal(data) {
  const mostrarInactivos = document.getElementById("chkMostrarInactivos")?.checked;

  return data.filter(doc => {
    // 🚫 Ocultar inactivo/anulado si no está marcado el ganchito
    const visiblePorEstado =
      mostrarInactivos ? true : !["inactivo", "anulado"].includes(doc.estado);

    return visiblePorEstado;
  });
}

// Helper to create search range for Firestore text queries
function getSearchRange(searchText) {
  if (!searchText) return null;
  const lower = searchText.toLowerCase();
  // Create upper bound by replacing last char with next char in sequence
  const upper = lower.slice(0, -1) + String.fromCharCode(lower.charCodeAt(lower.length - 1) + 1);
  return { lower, upper };
}


function comparable(v) {
  if (v == null) return '';
  if (typeof v.toDate === 'function') return v.toDate().getTime(); // Firestore Timestamp
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') return v.toLowerCase();
  return v;
}

function getSortValue(row, key){
  if (key === 'total') {
    const t = ContractTotals.fromDoc(row);
    return t.totalConITBMS;
  }
  return row[key];
}
function ordenar(data) {
  return data.sort((a, b) => {
    const A = comparable(getSortValue(a, campoOrden));
    const B = comparable(getSortValue(b, campoOrden));
    if (A < B) return direccionAsc ? -1 : 1;
    if (A > B) return direccionAsc ? 1 : -1;
    return 0;
  });
}

async function cargarContratos(reset = false) {
  const now = Date.now();
  if (isLoadingContratos) return;

  if (!reset && (now - lastQueryAt) < MIN_QUERY_INTERVAL_MS) {
    Toast.show("⚠️ Espera un momento antes de consultar de nuevo.", 'warn', 2500);
    return;
  }

  if (!reset && contratosCargados.length >= getMaxRows()) {
    Toast.show("⚠️ Límite de consulta alcanzado para tu rol.", 'warn');
    updateBtnCargarMasState(true);
    return;
  }

  isLoadingContratos = true;
  lastQueryAt = now;
  updateBtnCargarMasState(false);

  try {
    hideTip();
    if (typeof activePeekEl !== 'undefined') activePeekEl = null;

    const tabla = document.getElementById("tablaContratos");
    const listaMovil = document.getElementById("listaContratosMovil");
    const estadoSel = document.getElementById("filtroEstado")?.value || "";
    const clienteSearch = document.getElementById("filtroCliente")?.value.trim() || "";
    const clienteSearchLower = clienteSearch.toLowerCase();
    const matchesClienteSearch = (contrato) => {
      if (!clienteSearchLower) return true;
      const nombre = String(contrato?.cliente_nombre_lower || contrato?.cliente_nombre || "").toLowerCase();
      return nombre.includes(clienteSearchLower);
    };

    if (reset) {
      limpiarTabla();
      contratosCargados = [];
      lastDoc = null;
    }

    document.querySelectorAll('.skeleton-row').forEach(el => el.remove());

    const role = String(window.userRole || "").toLowerCase();
    if (role === ROLES.VENDEDOR && !currentUser) return;
    const creadoPorUid = role === ROLES.VENDEDOR ? currentUser.uid : null;

    const searchRange = getSearchRange(clienteSearch);
    const cursor = lastDoc && !reset ? lastDoc : null;

    const { docs: newDocs, lastDoc: newCursor } = await ContratosService.listContratos({
      estadoSel: estadoSel || null,
      creadoPorUid,
      searchRange,
      campoOrden,
      direccionAsc,
      lastDoc: cursor,
      limit: getPageLimit(),
    });

    if (newDocs.length > 0) {
      lastDoc = newCursor;
      newDocs.forEach(data => contratosCargados.push(data));
    } else if (reset) {
      contratosCargados = [];
      lastDoc = null;
    }

    const maxRows = getMaxRows();
    if (clienteSearchLower && newDocs.length === 0) {
      let fallbackLastDoc = cursor;
      let fallbackPages = 0;
      while (contratosCargados.length < maxRows && fallbackPages < 8) {
        const { docs: fbDocs, lastDoc: fbCursor } = await ContratosService.listContratosFallback({
          estadoSel: estadoSel || null,
          creadoPorUid,
          campoOrden,
          direccionAsc,
          lastDoc: fallbackLastDoc,
          limit: getPageLimit(),
        });
        if (fbDocs.length === 0) {
          lastDoc = null;
          break;
        }
        fallbackLastDoc = fbCursor;
        fbDocs.forEach(data => contratosCargados.push(data));
        fallbackPages++;
      }
      if (fallbackPages > 0) {
        lastDoc = fallbackLastDoc;
      }
    }

    if (contratosCargados.length > maxRows) {
      contratosCargados = contratosCargados.slice(0, maxRows);
      lastDoc = null;
    }

    await precargarUsuariosParaContratos(contratosCargados);

    const filtrados = ordenar(
      filtrarLocal([...contratosCargados]).filter(matchesClienteSearch)
    );

    if (tabla) tabla.innerHTML = "";
    if (listaMovil) listaMovil.innerHTML = "";

    let pendientes = 0, aprobados = 0, activos = 0;

    if (esMovil()) {
      const tableWrap = document.querySelector(".table-wrap");
      if (tableWrap) tableWrap.style.display = "none";
      if (listaMovil) listaMovil.style.display = "grid";

      filtrados.forEach(data => {
        if (data.estado === "pendiente_aprobacion") pendientes++;
        if (data.estado === "aprobado") aprobados++;
        if (data.estado === "activo") activos++;
        if (listaMovil) listaMovil.appendChild(crearCardContratoMovil(data));
      });
    } else {
      const tableWrap = document.querySelector(".table-wrap");
      if (tableWrap) tableWrap.style.display = "";
      if (listaMovil) listaMovil.style.display = "none";

      filtrados.forEach(data => {
        if (data.estado === "pendiente_aprobacion") pendientes++;
        if (data.estado === "aprobado") aprobados++;
        if (data.estado === "activo") activos++;
        if (tabla) tabla.appendChild(crearFilaContrato(data.id, data));
      });

      actualizarFlechitasContratos();
    }

    const total = filtrados.length;
    const resumen = document.getElementById("resumenContratos");
    if (resumen) {
      resumen.innerHTML = `
        <strong title="Total de contratos">${total}</strong> contratos ·
        <span class="badge pendiente" title="Pendientes">${pendientes}</span>
        <span class="badge aprobado" title="Aprobados">${aprobados}</span>
        <span class="badge completo" title="Activos">${activos}</span>
      `;
    }

    cargarIconosEquipos();
    updateBtnCargarMasState(!lastDoc);
  } finally {
    isLoadingContratos = false;
    updateBtnCargarMasState(false);
  }
}

/**
 * cargarIconosEquipos - OPTIMIZADO v2.0
 *
 * ✅ ANTES: N+1 queries (1 por cada contrato) → 15-20s para 50 contratos
 * ✅ AHORA: Lee campos pre-calculados del documento → <100ms
 *
 * Los campos son mantenidos automáticamente por Cloud Functions:
 *   - onContratoOrdenWrite: actualiza os_count/equipos_total
 *   - onOrdenWriteSyncContratoCache: actualiza os_linked/os_serials_preview
 *
 * CAMPOS USADOS (mantenidos por CF):
 *   - os_linked: boolean (tiene órdenes ligadas)
 *   - os_count: number (cantidad de órdenes)
 *   - os_serials_preview: string[] (primeros 3 serials para hover)
 *   - os_equipos_count_last: number (equipos de última orden)
 *   - os_has_equipos: boolean (tiene equipos en órdenes)
 *
 * Ventajas:
 *   - Rendimiento constante O(1)
 *   - Sin queries adicionales
 *   - Hover con preview de serials
 *   - Siempre sincronizado por backend
 */
async function cargarIconosEquipos() {
  const filas = document.querySelectorAll('tbody tr[data-contrato-doc-id]');

  filas.forEach(fila => {
    const contratoDocId = fila.getAttribute('data-contrato-doc-id');
    const celdaIcono = fila.querySelector('td[data-contrato-equipos]');

    if (!celdaIcono || !contratoDocId) return;

    // Leer datos del contrato desde contratosCargados (array global)
    const contrato = contratosCargados.find(c => c.id === contratoDocId);
    if (!contrato) {
      celdaIcono.innerHTML = '<span style="opacity:0.3;">—</span>';
      return;
    }

    // ✅ Leer campos mantenidos por Cloud Functions
    const osLinked = !!(contrato.os_linked || contrato.tiene_os || (contrato.os_count ?? 0) > 0);
    const osCount = Number(contrato.os_count || 0);
    const hasEquipos = contrato.os_has_equipos || false;
    const serialsPreview = contrato.os_serials_preview || [];

    if (osLinked) {
      // Construir tooltip con preview de serials
      let tooltipText = `${osCount} orden(es) asociada(s)`;
      if (hasEquipos && serialsPreview.length > 0) {
        tooltipText += `\nSerials: ${serialsPreview.join(', ')}${serialsPreview.length >= 3 ? '...' : ''}`;
      }

      // Mostrar ícono con contador opcional
      const displayText = osCount > 1 ? `📦${osCount}` : '📦';
      celdaIcono.innerHTML = `<span class="equipos-peek" data-contrato-doc="${contratoDocId}">${displayText}</span>`;
    } else {
      celdaIcono.innerHTML = '<span style="opacity:0.3;" title="Sin órdenes asociadas">⬜</span>';
    }
  });
}


function actualizarFlechitasContratos() {
  const row = document.getElementById("encabezadoContratos");
  if (!row) return;
  [...row.children].forEach(th => {
    const m = th.getAttribute("onclick")?.match(/'(.+)'/);
    if (!m) return;
    const campo = m[1];

    th.classList.remove("ordenado-asc", "ordenado-desc", "sortable");
    if (campo === campoOrden) {
      th.classList.add(direccionAsc ? "ordenado-asc" : "ordenado-desc");
    } else {
      th.classList.add("sortable");
    }
  });
}

function renderDesdeCache() {
  const tabla = document.getElementById("tablaContratos");
  const listaMovil = document.getElementById("listaContratosMovil");
  const filtrados = ordenar(filtrarLocal([...contratosCargados]));

  tabla.innerHTML = "";
  if (listaMovil) listaMovil.innerHTML = "";

  let pendientes = 0, aprobados = 0, activos = 0;

  if (esMovil()) {
    document.querySelector(".table-wrap").style.display = "none";
    if (listaMovil) listaMovil.style.display = "grid";
    filtrados.forEach(data => {
      if (data.estado === "pendiente_aprobacion") pendientes++;
      if (data.estado === "aprobado") aprobados++;
      if (data.estado === "activo") activos++;
      if (listaMovil) listaMovil.appendChild(crearCardContratoMovil(data));
    });
  } else {
    document.querySelector(".table-wrap").style.display = "";
    if (listaMovil) listaMovil.style.display = "none";
    filtrados.forEach(data => {
      if (data.estado === "pendiente_aprobacion") pendientes++;
      if (data.estado === "aprobado") aprobados++;
      if (data.estado === "activo") activos++;
      tabla.appendChild(crearFilaContrato(data.id, data));
    });
    actualizarFlechitasContratos();
  }

  const total = filtrados.length;
  const resumen = document.getElementById("resumenContratos");
  if (resumen) {
  resumen.innerHTML = `
    <strong title="Total de contratos">${total}</strong> contratos ·
    <span class="badge pendiente" title="Pendientes">${pendientes}</span>
    <span class="badge aprobado" title="Aprobados">${aprobados}</span>
    <span class="badge completo" title="Activos">${activos}</span>
  `;
  }

  updateBtnCargarMasState(false);
}

let lastWidth = window.innerWidth;
window.addEventListener('resize', () => {
  if (Math.abs(window.innerWidth - lastWidth) > 50) {
    lastWidth = window.innerWidth;
    renderDesdeCache();
  }
});


function ordenarPor(campo) {
  if (campoOrden === campo) direccionAsc = !direccionAsc;
  else { campoOrden = campo; direccionAsc = true; }
  cargarContratos(true);
}

    function verContrato(idContrato) {
  window.open(`imprimir-contrato.html?id=${idContrato}`, '_blank');
}

// --- Storage y subida de contrato firmado ---
const storage = firebase.storage();
let contratoParaFirma = null;

function subirFirmado(idDocContrato) {
  if (!AUTH.is(ROLES.ADMIN) && !AUTH.is(ROLES.VENDEDOR)) {
    alert('Solo administrador o vendedor pueden subir contratos firmados.');
    return;
  }

  contratoParaFirma = idDocContrato;
  const fileEl = document.getElementById('fileFirmado');
  if (!fileEl) {
    alert('No se encontró el input de archivo (#fileFirmado).');
    return;
  }

  // 👇 Abrir input inmediatamente (funciona en iOS)
  fileEl.value = '';
  fileEl.click();

  // Validar en segundo plano
  ContratosService.getContrato(idDocContrato).then(c => {
    if (!c) {
      Toast.show("❌ Contrato no encontrado.", 'bad', 5000);
      contratoParaFirma = null;
      return;
    }
    if (c.estado !== 'aprobado') {
      Toast.show("⚠️ Solo se pueden subir firmados a contratos APROBADOS.", 'warn');
      contratoParaFirma = null;
      return;
    }
  }).catch(err => {
    console.error(err);
    Toast.show("⚠️ No se pudo validar el estado.", 'warn');
    contratoParaFirma = null;
  });
}




// Maneja el archivo seleccionado
document.addEventListener('DOMContentLoaded', () => {
  const fileInput = document.getElementById('fileFirmado');
  if (fileInput) fileInput.addEventListener('change', handleFileFirmado);
});


async function handleFileFirmado(e) {
  const file = e.target.files[0];
  if (!file || !contratoParaFirma) return;

  // ⛔ Si no hay contrato válido, descartar el archivo
  if (!file || !contratoParaFirma) {
    e.target.value = '';
    return;
  }

  try {
    // Obtener data del contrato para formar nombre legible
    const data = await ContratosService.getContrato(contratoParaFirma);
    if (!data) throw new Error('Contrato no encontrado.');
    const contratoIdLegible = data?.contrato_id || contratoParaFirma;

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
    const path = `contratos_firmados/${contratoIdLegible}_${Date.now()}.${ext}`;

    const uploadTask = storage.ref(path).put(file, {
      contentType: file.type,
      customMetadata: {
        contrato_doc_id: contratoParaFirma,
        contrato_id: contratoIdLegible
      }
    });

    // Mostrar progreso
    document.getElementById('uploadStatus').style.display = 'inline';
    uploadTask.on(
      'state_changed',
      (snap) => {
        const pct = Math.round((snap.bytesTransferred / snap.totalBytes) * 100);
        document.getElementById('uploadPct').textContent = pct + '%';
      },
      (err) => {
        console.error(err);
        alert('❌ Error al subir el archivo: ' + err.message);
        document.getElementById('uploadStatus').style.display = 'none';
        e.target.value = '';
        contratoParaFirma = null;
      },
      async () => {
        const url = await uploadTask.snapshot.ref.getDownloadURL();

        // Guardar metadata en el contrato
      await ContratosService.updateContrato(contratoParaFirma, {
        firmado: true,
        firmado_url: url,
        firmado_nombre: file.name,
        firmado_storage_path: path,
        firmado_fecha: firebase.firestore.Timestamp.now(),
        firmado_por_uid: firebase.auth().currentUser?.uid || null,
        estado_previo: data.estado,     // ← guarda el estado anterior (aprobado)
        estado: "activo",
        fecha_activacion: firebase.firestore.Timestamp.now()
      });

        document.getElementById('uploadStatus').style.display = 'none';
        Toast.show("✅ Contrato firmado subido y guardado.", 'ok');
        e.target.value = '';
        contratoParaFirma = null;

        // Recargar la tabla para reflejar el estado
        location.reload();
      }
    );
  } catch (err) {
    console.error(err);
    alert('❌ No se pudo procesar el archivo: ' + err.message);
    document.getElementById('uploadStatus').style.display = 'none';
    e.target.value = '';
    contratoParaFirma = null;
  }
}

async function solicitarAprobacionPorCorreo(docId) {
  // Deshabilitado: los avisos se envían solo mediante mail_queue (con template).
  Toast.show("📨 Aviso de aprobación se envía automáticamente con plantilla.", 'ok');
}

// Decide mobile view
const esMovil = () => window.matchMedia("(max-width: 760px)").matches;

function crearCardContratoMovil(data) {
  const esAdmin = AUTH.is(ROLES.ADMIN);
  const esRecepcion = AUTH.is(ROLES.RECEPCION);
  const puedeEditar = (AUTH.is(ROLES.ADMIN) || AUTH.is(ROLES.VENDEDOR));
  const puedePanelTrabajo = esAdmin || esRecepcion;
  const editable = puedeEditar && !['activo','aprobado','anulado'].includes(data.estado);
  const puedeAprobar = esAdmin && data.estado === 'pendiente_aprobacion';

  const tot = ContractTotals.fromDoc(data);
  const totalStr = FMT.money(tot.totalConITBMS);

  const estadoClase =
    data.estado === 'activo' ? 'estado-activo' :
    data.estado === 'aprobado' ? 'estado-aprobado' :
    data.estado === 'pendiente_aprobacion' ? 'estado-pendiente' :
    data.estado === 'anulado' ? 'estado-anulado' :
    'estado-inactivo';

  const estadoTexto =
    data.estado === 'pendiente_aprobacion' ? 'Pendiente' :
    data.estado === 'aprobado' ? 'Aprobado' :
    data.estado === 'activo' ? 'Activo' :
    data.estado === 'anulado' ? 'Anulado' :
    'Inactivo';

  let bloqueFirmado = '';
  if (data.firmado_url) {
    bloqueFirmado = `<a class="btn" href="${data.firmado_url}" target="_blank" rel="noopener" title="Ver firmado">📄</a>`;
    if (data.estado === 'aprobado' && puedeEditar) {
      bloqueFirmado += ` <button class="btn" onclick="subirFirmado('${data.id}')" title="Reemplazar firmado">🔁</button>`;
    }
  } else if (data.estado === 'aprobado' && puedeEditar) {
    bloqueFirmado = `<button class="btn" onclick="subirFirmado('${data.id}')" title="Subir firmado">📤</button>`;
  }

  const accionesMovilHtml = esRecepcion
    ? `${data.contrato_id ? `<button class="btn" onclick="verContrato('${data.contrato_id}')" title="Ver/Imprimir">🖨️ Ver</button>` : ''}
      ${puedePanelTrabajo ? `<button class="btn" onclick="abrirPanelTrabajoContrato('${data.id}')" title="Panel de trabajo">🗂️ Panel</button>` : ''}`
    : `${data.contrato_id ? `<button class="btn" onclick="verContrato('${data.contrato_id}')" title="Ver/Imprimir">🖨️ Ver</button>` : ''}
      ${puedePanelTrabajo ? `<button class="btn" onclick="abrirPanelTrabajoContrato('${data.id}')" title="Panel de trabajo">🗂️ Panel</button>` : ''}
      ${editable ? `<button class="btn" onclick="editarContrato('${data.id}')" title="Editar">✏️ Editar</button>` : ''}
      ${puedeAprobar ? `<button class="btn ok block" onclick="aprobarContrato('${data.id}')" title="Aprobar ahora">✅ Aprobar</button>` : ''}
      ${bloqueFirmado}
      ${esAdmin && !data.listo_para_comision
        ? `<button class="btn" onclick="marcarParaComision('${data.id}')" title="Marcar como listo para comisión">💰 Comisión</button>`
        : ''}
      ${esAdmin && data.listo_para_comision
        ? `<button class="btn danger" onclick="quitarMarcaComision('${data.id}')" title="Quitar marca de comisión">🧹 Quitar</button>`
        : ''}`;

  const card = document.createElement('div');
  card.className = 'card-contrato';

  card.innerHTML = `
    <div class="row">
      <div>
        <div class="t1">
          ${esc(data.contrato_id || '-')}
          ${data.listo_para_comision ? '<span title="Listo para Comisión" aria-label="Listo para comisión" style="margin-left:6px;">✔️</span>' : ''}
        </div>
        <div class="t2">${esc(data.cliente_nombre || '-')}</div>
      </div>
      <div class="${estadoClase}">${estadoTexto}</div>
    </div>

    <div class="row">
      <div class="t2">${esc(data.tipo_contrato || '-')} · ${esc(data.accion || '-')}</div>
      <div class="t1">${totalStr}</div>
    </div>

    <div class="acciones">${accionesMovilHtml}</div>
  `;
  return card;
}
function cerrarSesion() {
  firebase.auth().signOut().then(() => {
    window.location.href = "/login.html";
  });
}
function abrirOverlay() {
  const ov = document.getElementById('overlayAprobacion');
  const sheet = document.getElementById('sheetAprobacion');
  if (!ov || !sheet) return;
  Modal.open('overlayAprobacion', { onEscape: false });
  document.addEventListener('keydown', handleSheetKeydown);
  const first = ov.querySelector('.btn.ok') || ov.querySelector('button,[href],input,select,textarea');
  if (first) setTimeout(() => first.focus(), 0);
  initSwipeClose(sheet);
}
function cerrarOverlay() {
  Modal.close('overlayAprobacion');
  document.removeEventListener('keydown', handleSheetKeydown);
  const sheet = document.getElementById('sheetAprobacion');
  if (sheet) sheet.style.transform = 'translateY(0)';
}
function handleSheetKeydown(e){
  if (e.key === 'Escape') cerrarOverlay();
}

// Gesto simple de "arrastrar hacia abajo para cerrar"
function initSwipeClose(el){
  let startY = 0, dy = 0, dragging = false;

  const onStart = e => {
    const t = e.touches ? e.touches[0] : e;
    startY = t.clientY; dy = 0; dragging = true;
    el.style.transition = 'none';
  };
  const onMove = e => {
    if (!dragging) return;
    const t = e.touches ? e.touches[0] : e;
    dy = t.clientY - startY;
    if (dy > 0) el.style.transform = `translateY(${dy}px)`;
  };
  const onEnd = () => {
    if (!dragging) return;
    dragging = false;
    el.style.transition = 'transform .18s ease';
    if (dy > 90) { cerrarOverlay(); }
    else { el.style.transform = 'translateY(0)'; }
  };

  // Sólo enganchar una vez
  if (!el.__swipeBound){
    el.addEventListener('touchstart', onStart, {passive:true});
    el.addEventListener('touchmove', onMove, {passive:true});
    el.addEventListener('touchend', onEnd);
    el.__swipeBound = true;
  }
}

// ===== SISTEMA DE EQUIPOS ASOCIADOS =====

const contratoEquiposCache = new Map(); // contratoDocId -> {html, fetchedAt}

async function fetchEquiposPreviewHTML(contratoDocId) {
  // cached?
  const cached = contratoEquiposCache.get(contratoDocId);
  if (cached && (Date.now() - cached.fetchedAt < 60000)) { // 1 minuto
    return cached;
  }

  try {
    const ordenes = await ContratosService.getOrdenesDeContrato(contratoDocId, { limit: 5 });

    let totalOrdenes = 0;
    let totalEquipos = 0;
    const lines = [];

    for (const x of ordenes) {
      // ✅ Verificar que la orden aún existe y no está eliminada
      const orden = await OrdenesService.getOrder(x.id);
      if (!orden || orden.eliminado === true) {
        console.log("🗑️ Orden eliminada detectada, saltando:", x.id);
        continue;
      }

      totalOrdenes++;
      const count = Number(x.equipos_count || 0);
      totalEquipos += count;

      const sampleSerials = (x.serials || []).slice(0, 3).join(", ");
      lines.push(`<div class="tooltip-line"><strong>OS ${esc(x.numero_orden)}</strong>: ${count} equipos${sampleSerials ? ` · ${esc(sampleSerials)}` : ""}</div>`);
    }

    const html = ordenes.length === 0
      ? `<div class="tooltip-line">No hay órdenes asociadas.</div>`
      : `<div class="tooltip-line"><strong>${totalOrdenes}</strong> órdenes · <strong>${totalEquipos}</strong> equipos (últimas 5)</div>
         ${lines.join("")}
         <div class="tooltip-line" style="margin-top:8px; opacity:.8;">Click para ver detalle</div>`;

    const result = { html, hasOrders: ordenes.length > 0, fetchedAt: Date.now() };
    contratoEquiposCache.set(contratoDocId, result);
    return result;
  } catch (error) {
    console.error("Error cargando preview de equipos:", error);
    return { html: `<div class="tooltip-line" style="color:red;">Error al cargar equipos</div>`, hasOrders: false, fetchedAt: Date.now() };
  }
}

let tipEl = null;

function showTip(html, x, y){
  if (!tipEl){
    tipEl = document.createElement("div");
    tipEl.id = "equiposTooltip";
    document.body.appendChild(tipEl);
  }
  tipEl.innerHTML = html;
  tipEl.style.left = Math.min(x + 12, window.innerWidth - 440) + "px";
  tipEl.style.top  = Math.min(y + 12, window.innerHeight - 220) + "px";
  tipEl.style.display = "block";
}

function hideTip(){
  if (tipEl) tipEl.style.display = "none";
}

let activePeekEl = null;

// Show on enter
document.addEventListener("pointerover", async (e) => {
  const el = e.target.closest(".equipos-peek");
  if (!el) return;

  activePeekEl = el;

  const id = el.getAttribute("data-contrato-doc");
  const result = await fetchEquiposPreviewHTML(id);

  // If user already left to another icon while awaiting Firestore
  if (activePeekEl !== el) return;

  showTip(result.html, e.clientX, e.clientY);
});

// Follow mouse while active
document.addEventListener("pointermove", (e) => {
  if (!activePeekEl) return;
  if (tipEl && tipEl.style.display === "block") {
    tipEl.style.left = Math.min(e.clientX + 12, window.innerWidth - 440) + "px";
    tipEl.style.top  = Math.min(e.clientY + 12, window.innerHeight - 220) + "px";
  }
});

// Hide on leave (only when actually leaving the icon)
document.addEventListener("pointerout", (e) => {
  const leavingIcon = e.target.closest(".equipos-peek");
  if (!leavingIcon) return;

  // If moving to another equipos-peek, don't hide (the other handler will update it)
  const to = e.relatedTarget?.closest?.(".equipos-peek");
  if (to) return;

  if (activePeekEl === leavingIcon) activePeekEl = null;
  hideTip();
});

// Extra safety: hide if user scrolls / switches tab / clicks elsewhere
window.addEventListener("scroll", () => { activePeekEl = null; hideTip(); }, { passive: true });
window.addEventListener("blur",  () => { activePeekEl = null; hideTip(); });
document.addEventListener("pointerdown", (e) => {
  if (!e.target.closest(".equipos-peek")) {
    activePeekEl = null;
    hideTip();
  }
});

// Click para modal detallado
document.addEventListener("click", async (e) => {
  const el = e.target.closest(".equipos-peek");
  if (!el) return;

  hideTip(); // ocultar tooltip
  const contratoDocId = el.getAttribute("data-contrato-doc");
  await abrirModalEquiposContrato(contratoDocId);
});

async function abrirModalEquiposContrato(contratoDocId){
  try {
    const ordenes = await ContratosService.getOrdenesDeContratoCompleto(contratoDocId);

    const rows = [];
    for (const x of ordenes) {
      // ✅ Verificar que la orden aún existe
      const orden = await OrdenesService.getOrder(x.id);
      if (!orden || orden.eliminado === true) {
        console.log("🗑️ Orden eliminada detectada en modal:", x.id);
        continue;
      }

      (x.equipos || []).forEach(eq => {
        rows.push(`
          <tr>
            <td style="border:1px solid var(--line); padding:6px;">${esc(x.numero_orden || "")}</td>
            <td style="border:1px solid var(--line); padding:6px;">${esc(eq.serial || "")}</td>
            <td style="border:1px solid var(--line); padding:6px;">${esc(eq.modelo || "")}</td>
            <td style="border:1px solid var(--line); padding:6px;">${esc(eq.observaciones ?? eq.descripcion ?? "")}</td>
          </tr>
        `);
      });
    }

    document.getElementById("modalEquiposBody").innerHTML = `
      <div style="margin-bottom:10px; font-weight:700;">Equipos asociados (${rows.length})</div>
      <div class="table-scroll">
        <table style="width:100%; border-collapse:collapse; font-size:14px; min-width:720px;">
          <thead style="background:#f5f5f5;">
            <tr>
              <th style="border:1px solid var(--line); padding:6px;">OS</th>
              <th style="border:1px solid var(--line); padding:6px;">Serial</th>
              <th style="border:1px solid var(--line); padding:6px;">Modelo</th>
              <th style="border:1px solid var(--line); padding:6px;">Observaciones</th>
            </tr>
          </thead>
          <tbody>
            ${rows.join("") || `<tr><td colspan="4" style="padding:10px; text-align:center;">No hay equipos.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    Modal.open('overlayEquiposContrato');
  } catch (error) {
    console.error("Error abriendo modal de equipos:", error);
    alert("Error al cargar equipos: " + error.message);
  }
}

function cerrarModalEquiposContrato(){
  Modal.close('overlayEquiposContrato');
}

let __panelTrabajoRows = [];

async function abrirPanelTrabajoContrato(contratoDocId) {
  try {
    const contrato = await ContratosService.getContrato(contratoDocId);
    if (!contrato) {
      alert("Contrato no encontrado.");
      return;
    }

    const contratoIdVisible = contrato.contrato_id || contratoDocId;
    const equipos = Array.isArray(contrato.equipos) ? contrato.equipos : [];

    __panelTrabajoRows = equipos.map(eq => ({
      contratoId: contratoIdVisible,
      modelo: String(eq?.modelo || "-").trim() || "-",
      cantidad: Number(eq?.cantidad || 0),
      precio: Number(eq?.precio || 0)
    }));

    const rowsHtml = __panelTrabajoRows.map((row, idx) => `
      <tr>
        <td style="border:1px solid var(--line); padding:6px;">${esc(row.contratoId)}</td>
        <td style="border:1px solid var(--line); padding:6px;">${esc(row.modelo)}</td>
        <td style="border:1px solid var(--line); padding:6px; text-align:right;">${row.cantidad}</td>
        <td style="border:1px solid var(--line); padding:6px; text-align:right;">$${row.precio.toFixed(2)}</td>
        <td style="border:1px solid var(--line); padding:6px; text-align:center;">
          <button class="btn" onclick="copiarFilaPanelTrabajo(${idx})" title="Copiar fila">📋</button>
        </td>
      </tr>
    `).join("");

    document.getElementById("panelTrabajoBody").innerHTML = `
      <div style="margin-bottom:10px; font-weight:700;">Panel de trabajo (${__panelTrabajoRows.length} fila${__panelTrabajoRows.length === 1 ? "" : "s"})</div>
      <div class="table-scroll">
        <table style="width:100%; border-collapse:collapse; font-size:14px; min-width:760px;">
          <thead style="background:#f5f5f5;">
            <tr>
              <th style="border:1px solid var(--line); padding:6px;">ID del contrato</th>
              <th style="border:1px solid var(--line); padding:6px;">Modelo</th>
              <th style="border:1px solid var(--line); padding:6px;">Cantidad</th>
              <th style="border:1px solid var(--line); padding:6px;">Precio Unitario</th>
              <th style="border:1px solid var(--line); padding:6px;">Acción</th>
            </tr>
          </thead>
          <tbody>
            ${rowsHtml || `<tr><td colspan="5" style="padding:10px; text-align:center;">No hay equipos en este contrato.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;

    Modal.open('overlayPanelTrabajo');
  } catch (error) {
    console.error("Error abriendo panel de trabajo:", error);
    alert("No se pudo abrir el panel de trabajo.");
  }
}

async function copiarFilaPanelTrabajo(index) {
  const row = __panelTrabajoRows[index];
  if (!row) return;
  const texto = `${row.contratoId}\t${row.modelo}\t${row.cantidad}\t${row.precio.toFixed(2)}`;

  try {
    await navigator.clipboard.writeText(texto);
    Toast.show("✅ Fila copiada al portapapeles.", 'ok');
  } catch (e) {
    const ta = document.createElement("textarea");
    ta.value = texto;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    Toast.show("✅ Fila copiada al portapapeles.", 'ok');
  }
}

function cerrarPanelTrabajo(){
  Modal.close('overlayPanelTrabajo');
}

// 🧹 Limpiar caché manualmente
function limpiarCacheEquipos() {
  contratoEquiposCache.clear();
  alert("✅ Caché de equipos limpiado. Los datos se recargarán automáticamente.");
  // Recargar íconos
  cargarIconosEquipos();
}

// ===== BACKFILL DE EQUIPOS EN CACHE =====

async function backfillContratoEquipos(contratoDocId) {
  try {
    // Buscar órdenes ya asociadas en la subcollection
    const subcDocs = await ContratosService.getOrdenesDeContratoCompleto(contratoDocId, { limit: 200 });

    let procesadas = 0;
    for (const cacheDoc of subcDocs) {
      const ordenId = cacheDoc.id;

      // Leer la orden real
      const orden = await OrdenesService.getOrder(ordenId);
      if (!orden || orden.eliminado === true) continue;

      const equipos = Array.isArray(orden.equipos)
        ? orden.equipos.filter(e => !e.eliminado)
        : [];
      const serials = equipos
        .map(e => (e?.serial || e?.SERIAL || "").toString().trim())
        .filter(Boolean);

      // Actualizar cache
      await ContratosService.linkOrden(contratoDocId, ordenId, {
        numero_orden: ordenId,
        cliente_id: orden.cliente_id || null,
        cliente_nombre: orden.cliente_nombre || null,
        tipo_de_servicio: orden.tipo_de_servicio || null,
        estado_reparacion: orden.estado_reparacion || null,
        fecha_creacion: orden.fecha_creacion || null,
        equipos: equipos.map(e => ({
          serial: (e?.serial || e?.SERIAL || e?.numero_de_serie || "").toString().trim(),
          modelo: e?.modelo || e?.MODEL || e?.modelo_nombre || "",
          descripcion: e?.observaciones || e?.descripcion || e?.nombre || "",
          unit_id: e?.unit_id || e?.unitId || "",
          sim: e?.sim || e?.simcard || ""
        })),
        equipos_count: equipos.length,
        serials,
        updated_at: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      procesadas++;
    }

    return procesadas;
  } catch (error) {
    console.error("Error en backfill de contrato:", contratoDocId, error);
    throw error;
  }
}

async function iniciarBackfillTodosContratos() {
  if (!AUTH.is(ROLES.ADMIN)) {
    alert("❌ Solo administradores pueden ejecutar esta acción.");
    return;
  }

  const confirmacion = confirm(
    "🔄 Esta operación re-sincronizará los equipos de TODOS los contratos.\n\n" +
    "Puede tardar varios segundos.\n\n" +
    "¿Continuar?"
  );

  if (!confirmacion) return;

  const btn = document.getElementById("btnBackfillEquipos");
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = "⏳ Procesando...";
  }

  try {
    // Obtener todos los contratos activos/aprobados
    const contratos = await ContratosService.getContratosActivosAprobados();

    let totalContratos = 0;
    let totalOrdenes = 0;

    for (const contrato of contratos) {
      const procesadas = await backfillContratoEquipos(contrato.id);
      totalOrdenes += procesadas;
      totalContratos++;
    }

    alert(
      `✅ Backfill completado\n\n` +
      `Contratos procesados: ${totalContratos}\n` +
      `Órdenes actualizadas: ${totalOrdenes}`
    );

    // Limpiar cache y recargar
    contratoEquiposCache.clear();
    await cargarContratos(true);

  } catch (error) {
    console.error("Error en backfill global:", error);
    alert("❌ Error durante el backfill: " + error.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = "🔄 Re-sincronizar equipos (admin)";
    }
  }
}
