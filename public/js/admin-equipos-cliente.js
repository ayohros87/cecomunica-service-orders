// @ts-nocheck
(function initAdminEquiposCliente() {
  const state = {
    user: null,
    role: null,
    clientesMap: {},
    lastResults: []
  };

  const ESTADOS = [
    'POR ASIGNAR',
    'ASIGNADO',
    'COMPLETADO (EN OFICINA)',
    'ENTREGADO AL CLIENTE'
  ];

  const refs = {
    accesoDenegado: document.getElementById('accesoDenegado'),
    panelBusqueda: document.getElementById('panelBusqueda'),
    panelResultados: document.getElementById('panelResultados'),
    filtroCliente: document.getElementById('filtroClienteAdmin'),
    filtroTipo: document.getElementById('filtroTipoOrdenAdmin'),
    filtroEstado: document.getElementById('filtroEstadoOrdenAdmin'),
    sortBy: document.getElementById('sortByAdmin'),
    soloConSerial: document.getElementById('soloConSerial'),
    incluirEquiposEliminados: document.getElementById('incluirEquiposEliminados'),
    resumen: document.getElementById('resumenAdmin'),
    tbody: document.getElementById('adminResultsBody'),
    btnBuscar: document.getElementById('btnBuscarAdmin'),
    btnExportarExcel: document.getElementById('btnExportarExcelAdmin'),
    btnLimpiar: document.getElementById('btnLimpiarAdmin'),
    btnVolver: document.getElementById('btnVolverOrdenes')
  };

  function norm(value) {
    return String(value || '')
      .toLowerCase()
      .trim()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getClienteNombre(orden) {
    if (orden?.cliente_nombre) return orden.cliente_nombre;
    if (orden?.cliente) return orden.cliente;
    if (orden?.cliente_id && state.clientesMap[orden.cliente_id]) {
      return state.clientesMap[orden.cliente_id];
    }
    return '';
  }

  async function cargarClientesMap() {
    const { docs } = await ClientesService.listClientes({ limit: 2000 });
    const map = {};
    docs.forEach((c) => {
      map[c.id] = c.nombre || c.razon_social || '';
    });
    state.clientesMap = map;
  }

  async function cargarTipos() {
    try {
      const snap = await EmpresaService.getDoc('tipo_de_servicio');
      if (!snap) return;
      const list = Array.isArray(snap.list) ? snap.list : [];
      refs.filtroTipo.innerHTML = '<option value="">Todos</option>';
      list.forEach((tipo) => {
        const option = document.createElement('option');
        option.value = tipo;
        option.textContent = tipo;
        refs.filtroTipo.appendChild(option);
      });
    } catch (error) {
      console.warn('No se pudieron cargar tipos de servicio', error);
    }
  }

  function getDescription(equipo) {
    return (
      equipo.descripcion ||
      equipo.nombre ||
      equipo.observaciones ||
      equipo.detalle ||
      '-'
    );
  }

  function matchesEstado(estadoFiltro, estadoOrden) {
    if (!estadoFiltro) return true;
    return String(estadoOrden || '').trim().toUpperCase() === estadoFiltro;
  }

  function buildRows(ordenes, filters) {
    const customerNeedle = norm(filters.cliente);
    return ordenes.flatMap((orden) => {
      if (orden.eliminado === true) return [];

      const cliente = getClienteNombre(orden);
      if (!norm(cliente).includes(customerNeedle)) return [];

      if (filters.tipo && String(orden.tipo_de_servicio || '') !== filters.tipo) return [];
      if (!matchesEstado(filters.estado, orden.estado_reparacion)) return [];

      const equipos = Array.isArray(orden.equipos) ? orden.equipos : [];

      return equipos
        .filter((equipo) => (filters.incluirEquiposEliminados ? true : equipo?.eliminado !== true))
        .filter((equipo) => (filters.soloConSerial ? !!String(equipo?.numero_de_serie || '').trim() : true))
        .map((equipo) => ({
          cliente,
          ordenId: orden.ordenId,
          tipo: orden.tipo_de_servicio || '-',
          estado: orden.estado_reparacion || '-',
          serial: equipo?.numero_de_serie || '-',
          modelo: equipo?.modelo || '-',
          descripcion: getDescription(equipo)
        }));
    });
  }

  function sortRows(rows, sortBy) {
    const sorted = [...rows];
    sorted.sort((a, b) => String(a[sortBy] || '').localeCompare(String(b[sortBy] || ''), 'es'));
    return sorted;
  }

  async function cargarTodasLasOrdenes() {
    const pageSize = 150;
    const allOrders = [];
    let lastDocId = null;

    while (true) {
      let query = db
        .collection('ordenes_de_servicio')
        .orderBy(firebase.firestore.FieldPath.documentId())
        .limit(pageSize);

      if (lastDocId) {
        query = query.startAfter(lastDocId);
      }

      let snap;
      try {
        snap = await query.get({ source: 'server' });
      } catch (_serverError) {
        snap = await query.get();
      }

      if (snap.empty) break;

      snap.forEach((doc) => {
        allOrders.push({ ordenId: doc.id, ...(doc.data() || {}) });
      });

      lastDocId = snap.docs[snap.docs.length - 1].id;
      refs.resumen.textContent = `Escaneando base de datos... ${allOrders.length} órdenes`;

      if (snap.size < pageSize) break;
    }

    return allOrders;
  }

  function renderRows(rows) {
    refs.panelResultados.style.display = 'block';
    state.lastResults = Array.isArray(rows) ? rows : [];

    if (!rows.length) {
      refs.tbody.innerHTML = '<tr><td colspan="7" class="empty-row">No se encontraron equipos con los filtros indicados.</td></tr>';
      refs.resumen.textContent = '0 equipos encontrados';
      if (refs.btnExportarExcel) refs.btnExportarExcel.disabled = true;
      return;
    }

    refs.tbody.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.cliente || '-')}</td>
        <td>${escapeHtml(row.ordenId || '-')}</td>
        <td>${escapeHtml(row.tipo || '-')}</td>
        <td>${escapeHtml(row.estado || '-')}</td>
        <td>${escapeHtml(row.serial || '-')}</td>
        <td>${escapeHtml(row.modelo || '-')}</td>
        <td>${escapeHtml(row.descripcion || '-')}</td>
      </tr>
    `).join('');

    const ordenesUnicas = new Set(rows.map((row) => row.ordenId)).size;
    refs.resumen.textContent = `${rows.length} equipos en ${ordenesUnicas} órdenes`;
    if (refs.btnExportarExcel) refs.btnExportarExcel.disabled = false;
  }

  function exportarExcel() {
    if (!Array.isArray(state.lastResults) || state.lastResults.length === 0) {
      refs.resumen.textContent = 'No hay resultados para exportar';
      if (refs.btnExportarExcel) refs.btnExportarExcel.disabled = true;
      return;
    }

    if (typeof XLSX === 'undefined') {
      refs.resumen.textContent = 'No se pudo cargar la librería de Excel';
      return;
    }

    const excelRows = state.lastResults.map((row) => ({
      Cliente: row.cliente || '-',
      Orden: row.ordenId || '-',
      Tipo: row.tipo || '-',
      Estado: row.estado || '-',
      Serial: row.serial || '-',
      Modelo: row.modelo || '-',
      Descripcion: row.descripcion || '-'
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelRows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'EquiposCliente');

    const cliente = (refs.filtroCliente?.value || 'cliente').trim().replace(/[^a-zA-Z0-9_-]/g, '_');
    const fecha = new Date().toISOString().slice(0, 10);
    const fileName = `equipos_${cliente || 'cliente'}_${fecha}.xlsx`;

    XLSX.writeFile(workbook, fileName);
  }

  async function buscar() {
    const cliente = refs.filtroCliente.value || '';
    if (!cliente.trim()) {
      refs.filtroCliente.focus();
      refs.panelResultados.style.display = 'block';
      refs.tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Escribe el nombre del cliente para buscar.</td></tr>';
      refs.resumen.textContent = 'Cliente requerido';
      return;
    }

    refs.btnBuscar.disabled = true;
    refs.btnBuscar.textContent = 'Buscando...';

    try {
      const filters = {
        cliente,
        tipo: refs.filtroTipo.value,
        estado: refs.filtroEstado.value,
        soloConSerial: refs.soloConSerial.checked,
        incluirEquiposEliminados: refs.incluirEquiposEliminados.checked
      };

      const ordenes = await cargarTodasLasOrdenes();

      const rows = buildRows(ordenes, filters);
      const sortedRows = sortRows(rows, refs.sortBy.value || 'cliente');
      renderRows(sortedRows);
    } catch (error) {
      console.error('Error al buscar equipos por cliente', error);
      refs.panelResultados.style.display = 'block';
      refs.tbody.innerHTML = '<tr><td colspan="7" class="empty-row">Error al consultar datos. Intenta nuevamente.</td></tr>';
      refs.resumen.textContent = 'Error de consulta';
    } finally {
      refs.btnBuscar.disabled = false;
      refs.btnBuscar.textContent = '🔎 Buscar';
    }
  }

  function limpiar() {
    refs.filtroCliente.value = '';
    refs.filtroTipo.value = '';
    refs.filtroEstado.value = '';
    refs.sortBy.value = 'cliente';
    refs.soloConSerial.checked = false;
    refs.incluirEquiposEliminados.checked = false;
    refs.panelResultados.style.display = 'none';
    refs.resumen.textContent = 'Sin resultados';
    refs.tbody.innerHTML = '';
    state.lastResults = [];
    if (refs.btnExportarExcel) refs.btnExportarExcel.disabled = true;
  }

  function setupActions() {
    refs.btnBuscar.addEventListener('click', buscar);
    refs.btnExportarExcel?.addEventListener('click', exportarExcel);
    refs.btnLimpiar.addEventListener('click', limpiar);
    refs.btnVolver.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
    refs.filtroCliente.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        buscar();
      }
    });
  }

  async function checkAccessAndInit() {
    firebase.auth().onAuthStateChanged(async (user) => {
      if (!user) {
        window.location.href = '../login.html';
        return;
      }

      state.user = user;
      const userDoc = await UsuariosService.getUsuario(user.uid);
      const role = userDoc ? (userDoc.rol || '') : '';
      state.role = role;

      if (role !== 'administrador') {
        refs.accesoDenegado.style.display = 'block';
        refs.panelBusqueda.style.display = 'none';
        refs.panelResultados.style.display = 'none';
        return;
      }

      refs.accesoDenegado.style.display = 'none';
      refs.panelBusqueda.style.display = 'block';

      await Promise.all([cargarClientesMap(), cargarTipos()]);
      setupActions();
      refs.filtroCliente.focus();
    });
  }

  refs.filtroEstado.innerHTML = '<option value="">Todos</option>' + ESTADOS.map((estado) => `<option value="${estado}">${estado}</option>`).join('');
  checkAccessAndInit();
})();
