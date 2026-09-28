// @ts-nocheck
    function parseFechaExcel(value) {
      if (typeof value === 'number') {
        const fecha = new Date(Date.UTC(0, 0, value - 1));
        return fecha.toISOString().split('T')[0];
      }
      return value;
    }

    const _escHtml = (v) => String(v ?? "").replace(/[&<>"']/g, m => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    }[m]));

    // Campos de la fila "orden" que el importador sabe escribir. En una orden
    // EXISTENTE solo se escriben los que la fila trae de verdad (auditoría UX
    // 2026-09-28, P0 #7): una celda vacía no puede borrar lo que ya hay.
    const CAMPOS_ORDEN = ["cliente", "estado_reparacion", "fecha_entrada", "fecha_inicio",
      "fecha_salida", "observaciones", "tecnico_asignado", "tipo_de_servicio"];
    const CAMPOS_FECHA = new Set(["fecha_entrada", "fecha_inicio", "fecha_salida"]);
    const CAMPOS_EQUIPO = ["numero_de_serie", "modelo", "observaciones",
      "antena", "bateria", "cargador", "clip", "fuente", "cubrepolvo"];

    const _tiene = (row, k) => row[k] !== undefined && row[k] !== null && row[k] !== "";

    window.onload = () => {
  // Guard de rol (auditoría UX 2026-09-28, P0 #7 / T4): antes bastaba con
  // estar logueado para reescribir órdenes desde un Excel. Solo administrador
  // (permiso 'admin-equipos' de roles.js), igual que el resto de Config.
  verificarAccesoYAplicarVisibilidad((rol) => {
    const esAdmin = typeof window.canRole === "function"
      ? window.canRole(rol, "admin-equipos")
      : rol === "administrador";
    if (!esAdmin) {
      const wrap = document.querySelector(".app-wrap") || document.body;
      wrap.innerHTML = `<div class="ds-card ds-card-padded" style="text-align:center;">
        <p style="font-weight:600;margin:0 0 var(--sp-2);">Esta página es solo para administradores.</p>
        <a class="btn btn-secondary" href="/ordenes/index.html">Volver a Órdenes</a></div>`;
      return;
    }

      const exportarOrdenesBtn = document.getElementById("exportar-ordenes-btn");
      const exportarEquiposBtn = document.getElementById("exportar-equipos-btn");
      const importarXlsxInput = document.getElementById("importar-xlsx-input");
      const importarXlsxBtn = document.getElementById("importar-xlsx-btn");
      const descargarEjemploBtn = document.getElementById("descargar-ejemplo-btn");
      const status = document.getElementById("mensaje-status");

      let archivoXlsx = null;
      importarXlsxInput.addEventListener("change", (e) => {
        archivoXlsx = e.target.files[0];
      });

      const leerArchivo = (file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (ev) => resolve(ev.target.result);
        reader.onerror = () => reject(reader.error || new Error("No se pudo leer el archivo"));
        reader.readAsBinaryString(file);
      });

      // Arma { ordenId: { campos, equipos[] } } desde el libro. Las filas de
      // equipo van a su orden por `orden_id` (su `id` es el del EQUIPO, p. ej.
      // "eq001"): antes `row.id || row.orden_id` las mandaba a una orden
      // fantasma "eq001" siguiendo la propia plantilla.
      function parsearLibro(workbook) {
        const ordenes = {};
        for (const sheetName of workbook.SheetNames) {
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
          for (const [i, row] of rows.entries()) {
            const fila = `Fila ${i + 2} de la hoja ${sheetName}`;
            if (!row || typeof row !== "object") throw new Error(`${fila}: vacía o malformada`);
            if (row.tipo !== "equipo" && row.tipo !== "orden") throw new Error(`${fila}: tipo inválido (debe ser "orden" o "equipo")`);

            const ordenId = String(row.tipo === "equipo"
              ? (row.orden_id || "")
              : (row.orden_id || row.id || "")).trim();
            if (!ordenId) {
              throw new Error(row.tipo === "equipo"
                ? `${fila}: el equipo no trae 'orden_id'`
                : `${fila}: la orden no trae 'id'`);
            }

            if (!ordenes[ordenId]) ordenes[ordenId] = { campos: null, equipos: [] };
            const o = ordenes[ordenId];

            if (row.tipo === "equipo") {
              const eq = { id: String(row.id || crypto.randomUUID()) };
              for (const k of CAMPOS_EQUIPO) if (row[k] !== undefined) eq[k] = row[k];
              o.equipos.push(eq);
            } else {
              const campos = {};
              for (const k of CAMPOS_ORDEN) {
                if (_tiene(row, k)) campos[k] = CAMPOS_FECHA.has(k) ? parseFechaExcel(row[k]) : row[k];
              }
              o.campos = Object.assign(o.campos || {}, campos);
            }
          }
        }
        return ordenes;
      }

      // Equipos de una orden existente: se actualizan por id y se agregan los
      // nuevos; los que no vienen en el archivo se quedan (set con merge
      // reemplaza arrays completos, así que la mezcla se hace aquí).
      function mezclarEquipos(actuales, entrantes) {
        const lista = (actuales || []).map(e => ({ ...e }));
        for (const eq of entrantes) {
          const i = lista.findIndex(e => String(e.id) === String(eq.id));
          if (i >= 0) lista[i] = { ...lista[i], ...eq };
          else lista.push(eq);
        }
        return lista;
      }

      const nuevoEquipo = (eq) => ({
        numero_de_serie: "", modelo: "", observaciones: "",
        antena: false, bateria: false, cargador: false, clip: false, fuente: false, cubrepolvo: false,
        ...eq,
      });

      importarXlsxBtn.addEventListener("click", async () => {
        status.textContent = "";
        if (!archivoXlsx) { Toast.show('Primero selecciona un archivo .xlsx', 'bad'); return; }

        await withBusy(importarXlsxBtn, async () => {
          status.textContent = "Leyendo archivo…";
          await cargarXLSX();   // SheetJS bajo demanda
          let ordenes;
          try {
            const workbook = XLSX.read(await leerArchivo(archivoXlsx), { type: "binary" });
            ordenes = parsearLibro(workbook);
          } catch (err) {
            status.textContent = "";
            Toast.show('El archivo no se puede importar: ' + (err.message || err), 'bad');
            return;
          }

          const ids = Object.keys(ordenes);
          if (!ids.length) { status.textContent = ""; Toast.show('El archivo no trae filas.', 'bad'); return; }

          // Vista previa: qué es nuevo y qué ya existe, ANTES de escribir.
          status.textContent = "Revisando órdenes existentes…";
          const existentes = new Map();
          // Lectura directa (no getOrder): getOrder oculta las eliminadas y una
          // orden eliminada NO es "nueva" — se le pisarían los defaults encima.
          const col = firebase.firestore().collection("ordenes_de_servicio");
          for (const id of ids) {
            const snap = await col.doc(id).get();
            if (snap.exists) existentes.set(id, snap.data() || {});
          }
          const sinCabecera = ids.filter(id => !existentes.has(id) && !ordenes[id].campos);
          if (sinCabecera.length) {
            status.textContent = "";
            Toast.show(`Hay equipos para órdenes que no existen ni vienen en el archivo: ${sinCabecera.slice(0, 5).join(", ")}${sinCabecera.length > 5 ? "…" : ""}`, 'bad');
            return;
          }
          const nNuevas = ids.length - existentes.size;
          const nEquipos = ids.reduce((s, id) => s + ordenes[id].equipos.length, 0);
          status.textContent = "";
          const ok = await Modal.confirm({
            title: "Confirmar importación",
            message: `El archivo trae <strong>${ids.length}</strong> orden(es) y <strong>${nEquipos}</strong> equipo(s).<br>
              · <strong>${nNuevas}</strong> orden(es) nueva(s)<br>
              · <strong>${existentes.size}</strong> orden(es) que ya existen: solo se actualizan los campos que trae el archivo; firmas, QC y el resto se conservan.`
              + (existentes.size ? `<br><small>Existentes: ${_escHtml([...existentes.keys()].slice(0, 8).join(", "))}${existentes.size > 8 ? "…" : ""}</small>` : ""),
            confirmLabel: "Importar",
          });
          if (!ok) return;

          status.textContent = "Importando…";
          const resumen = [];
          for (const id of ids) {
            const { campos, equipos } = ordenes[id];
            const actual = existentes.get(id);
            let data;
            if (actual) {
              data = { ...(campos || {}) };
              if (equipos.length) data.equipos = mezclarEquipos(actual.equipos, equipos);
            } else {
              data = {
                cliente: "", estado_reparacion: "POR ASIGNAR", fecha_entrada: "", fecha_inicio: "",
                fecha_salida: "", observaciones: "", tecnico_asignado: "", tipo_de_servicio: "",
                ...(campos || {}),
                equipos: equipos.map(nuevoEquipo),
              };
            }
            // merge: una reimportación ya no pisa el documento completo.
            if (Object.keys(data).length) await OrdenesService.mergeOrder(id, data);
            resumen.push({ orden_id: id, accion: actual ? "actualizada" : "creada", equipos_en_archivo: equipos.length });
          }

          status.textContent = `Importación completada: ${nNuevas} nueva(s), ${existentes.size} actualizada(s).`;
          importarXlsxInput.value = "";
          archivoXlsx = null;

          const resumenWs = XLSX.utils.json_to_sheet(resumen);
          const resumenWb = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(resumenWb, resumenWs, "Resumen");
          XLSX.writeFile(resumenWb, "resumen_importacion.xlsx");
        }, { label: "Importando…", mensajeError: "Error durante la importación", rethrow: false });
      });

      exportarOrdenesBtn.addEventListener("click", async () => {
        try {
          await cargarXLSX();
          const orders = await OrdenesService.listAll();
          const datos = orders.map(o => {
            const { equipos, ordenId, ...rest } = o;
            return { id: ordenId, tipo: "orden", ...rest };
          });
          const worksheet = XLSX.utils.json_to_sheet(datos);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, "Ordenes");
          XLSX.writeFile(workbook, "ordenes_de_servicio.xlsx");
        } catch (error) {
          console.error("Error al exportar órdenes:", error);
          Toast.show('Error al exportar órdenes a Excel.', 'bad');
        }
      });

      exportarEquiposBtn.addEventListener("click", async () => {
        try {
          await cargarXLSX();
          const orders = await OrdenesService.listAll();
          const datos = orders.flatMap(o => {
            const { equipos = [] } = o;
            return equipos.map(eq => ({ tipo: "equipo", orden_id: o.ordenId, ...eq }));
          });
          const worksheet = XLSX.utils.json_to_sheet(datos);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, worksheet, "Equipos");
          XLSX.writeFile(workbook, "equipos_de_servicio.xlsx");
        } catch (error) {
          console.error("Error al exportar equipos:", error);
          Toast.show('Error al exportar equipos a Excel.', 'bad');
        }
      });

      descargarEjemploBtn.addEventListener("click", async () => {
        await cargarXLSX();
        const ordenes = [
          {
            tipo: "orden",
            id: "20250605001",
            cliente: "EMPRESA DE EJEMPLO",
            estado_reparacion: "POR ASIGNAR",
            fecha_entrada: "2025-06-05",
            fecha_inicio: "",
            fecha_salida: "",
            observaciones: "Orden de prueba",
            tecnico_asignado: "JUAN PEREZ",
            tipo_de_servicio: "ENTRADA"
          }
        ];

        const equipos = [
          {
            tipo: "equipo",
            orden_id: "20250605001",
            id: "eq001",
            numero_de_serie: "ABC123",
            modelo: "PNC360",
            observaciones: "Equipo funcional",
            antena: true,
            bateria: true,
            cargador: true,
            clip: true,
            fuente: true,
            cubrepolvo: true
          }
        ];

        const wb = XLSX.utils.book_new();
        const wsOrdenes = XLSX.utils.json_to_sheet(ordenes);
        const wsEquipos = XLSX.utils.json_to_sheet(equipos);
        XLSX.utils.book_append_sheet(wb, wsOrdenes, "Ordenes");
        XLSX.utils.book_append_sheet(wb, wsEquipos, "Equipos");
        XLSX.writeFile(wb, "plantilla_importacion_cecomunica.xlsx");
      });
      }); // cierra verificarAccesoYAplicarVisibilidad
  }; // cierra window.onload
