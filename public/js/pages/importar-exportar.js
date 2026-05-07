    function parseFechaExcel(value) {
      if (typeof value === 'number') {
        const fecha = new Date(Date.UTC(0, 0, value - 1));
        return fecha.toISOString().split('T')[0];
      }
      return value;
    }

    window.onload = () => {
  const auth = firebase.auth();

  auth.onAuthStateChanged((user) => {
    if (!user) {
      document.body.innerHTML = "<h3 style='text-align:center; color:red;'>❌ Debes iniciar sesión para usar esta función.</h3>";
      return;
    }


    // 🔽 Aquí abajo pegamos todo lo que estaba antes dentro de DOMContentLoaded

        
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

      importarXlsxBtn.addEventListener("click", async () => {
        status.textContent = "";
        if (!archivoXlsx) return alert("Primero selecciona un archivo .xlsx");

        status.textContent = "⏳ Importando archivo...";
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            const workbook = XLSX.read(event.target.result, { type: "binary" });
            const ordenes = {};

            for (const sheetName of workbook.SheetNames) {
              const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
              for (const [i, row] of rows.entries()) {
                if (!row || typeof row !== "object") {
                  throw new Error(`Fila ${i + 2} vacía o malformada en hoja ${sheetName}`);
                }
                if (!row.tipo || (row.tipo !== "equipo" && row.tipo !== "orden")) {
                  throw new Error(`Fila ${i + 2} con tipo inválido en hoja ${sheetName}`);
                }

                const id = row.id || row.orden_id;
                if (!id) throw new Error(`Fila ${i + 2} sin campo 'id' u 'orden_id'`);

                if (!ordenes[id]) ordenes[id] = { id, equipos: [] };
                else if (!Array.isArray(ordenes[id].equipos)) ordenes[id].equipos = [];

                if (row.tipo === "equipo") {
                  const equipoId = row.id || firebase.firestore().collection("_").doc().id;
                  const eq = {
                    id: equipoId,
                    numero_de_serie: row.numero_de_serie || "",
                    modelo: row.modelo || "",
                    observaciones: row.observaciones || "",
                    antena: row.antena ?? false,
                    bateria: row.bateria ?? false,
                    cargador: row.cargador ?? false,
                    clip: row.clip ?? false,
                    fuente: row.fuente ?? false
                  };

                  ordenes[id].equipos.push(eq);
                } else if (row.tipo === "orden") {
                  const cleanRow = {
                    cliente: row.cliente || "",
                    estado_reparacion: row.estado_reparacion || "POR ASIGNAR",
                    fecha_entrada: parseFechaExcel(row.fecha_entrada || ""),
                    fecha_inicio: parseFechaExcel(row.fecha_inicio || ""),
                    fecha_salida: parseFechaExcel(row.fecha_salida || ""),
                    observaciones: row.observaciones || "",
                    tecnico_asignado: row.tecnico_asignado || "",
                    tipo_de_servicio: row.tipo_de_servicio || ""
                  };
                  Object.assign(ordenes[id], cleanRow);
                }
              }
            }

            const resumen = [];
            for (const [id, orden] of Object.entries(ordenes)) {
              const { id: _, ...data } = orden;
              await OrdenesService.setOrder(id, data);
              resumen.push({ orden_id: id, equipos: Array.isArray(orden.equipos) ? orden.equipos.length : 0 });
            }

            status.textContent = "✅ Importación completada exitosamente";
            importarXlsxInput.value = "";
            archivoXlsx = null;

            const resumenWs = XLSX.utils.json_to_sheet(resumen);
            const resumenWb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(resumenWb, resumenWs, "Resumen");
            XLSX.writeFile(resumenWb, "resumen_importacion.xlsx");

          } catch (err) {
            console.error("Error al importar .xlsx:", err);
            status.textContent = "";
            alert("Error durante la importación: " + (err.message || err));
          }
        };
        reader.readAsBinaryString(archivoXlsx);
      });

      exportarOrdenesBtn.addEventListener("click", async () => {
        try {
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
          alert("Error al exportar órdenes a Excel.");
        }
      });

      exportarEquiposBtn.addEventListener("click", async () => {
        try {
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
          alert("Error al exportar equipos a Excel.");
        }
      });

      descargarEjemploBtn.addEventListener("click", () => {
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
            fuente: true
          }
        ];

        const wb = XLSX.utils.book_new();
        const wsOrdenes = XLSX.utils.json_to_sheet(ordenes);
        const wsEquipos = XLSX.utils.json_to_sheet(equipos);
        XLSX.utils.book_append_sheet(wb, wsOrdenes, "Ordenes");
        XLSX.utils.book_append_sheet(wb, wsEquipos, "Equipos");
        XLSX.writeFile(wb, "plantilla_importacion_cecomunica.xlsx");
      });
      }); // cierra auth.onAuthStateChanged
  }; // cierra window.onload
