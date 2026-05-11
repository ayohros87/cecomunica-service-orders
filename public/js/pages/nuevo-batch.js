// @ts-nocheck
    async function cargarSelect(ruta, id) {
      const docId = ruta.split('/')[1];
      const snap = await EmpresaService.getDoc(docId);
      const select = document.getElementById(id);
      if (snap) {
        (snap.list || []).forEach(item => {
          const option = new Option(item, item);
          select.appendChild(option);
        });
      }
    }
async function cargarListaSelect(ruta, selectId) {
  const docId = ruta.split('/')[1];
  const snap = await EmpresaService.getDoc(docId);
  const select = document.getElementById(selectId);

  select.innerHTML = '<option value="" disabled selected>Seleccione...</option>';

  if (snap) {
    const lista = snap.list || [];
    lista.sort().forEach(item => {
      const option = document.createElement("option");
      option.value = item;
      option.textContent = item;
      select.appendChild(option);
    });
  }
}

async function mostrarUltimosUnitIDs() {
  const recientes = await PocService.getRecent(5);

  const ul = document.getElementById("ultimosUnitIDs");
  ul.innerHTML = "";

  recientes.forEach(d => {
    const item = document.createElement("li");
    item.textContent = `${d.unit_id || "(sin Unit ID)"} – ${d.radio_name || "(sin nombre)"}`;
    ul.appendChild(item);
  });
}



async function agregarElemento(ruta, selectId, label) {
  const nuevo = prompt(`Nuevo ${label}:`);
  if (nuevo) {
    const docId = ruta.split('/')[1];
    const snap = await EmpresaService.getDoc(docId);
    const lista = snap ? (snap.list || []) : [];
    if (!lista.includes(nuevo)) {
      lista.push(nuevo);
      await EmpresaService.setDoc(docId, { list: lista });
      const option = new Option(nuevo, nuevo);
      const select = document.getElementById(selectId);
      select.appendChild(option);
      select.value = nuevo;
    }
  }
}
async function cargarClientes() {
  const { docs } = await ClientesService.listClientes({ limit: 2000 });
  const select = document.getElementById("cliente");
  select.innerHTML = '<option value="" disabled selected>Seleccione...</option>';
  docs.forEach(d => {
    const option = document.createElement("option");
    option.value = d.id;
    option.textContent = d.nombre;
    select.appendChild(option);
  });
}


    // ✅ Data-sanity validator: Block invalid group values (magnifying glass, icon-only, etc.)
    function limpiarGrupos(grupos = []) {
      return grupos
        .map(g => g.trim())
        .filter(g =>
          g !== "" &&
          g !== "🔍" &&          // bloquea lupa explícitamente
          !/^[🔍]+$/.test(g) &&  // bloquea solo iconos
          g.length > 1           // evita símbolos sueltos
        );
    }

    document.addEventListener("DOMContentLoaded", async () => {
      firebase.auth().onAuthStateChanged(async user => {
        if (!user) return window.location.href = "/login.html";

        await cargarClientes();
        await cargarListaSelect("empresa/IPs", "ip");
        await mostrarUltimosUnitIDs();
document.getElementById("addCliente").onclick = async () => {
  const nombre = prompt("Ingrese el nombre del nuevo cliente:");
  if (!nombre) return;

  const nombreLimpio = nombre.trim();
  const regexProhibidos = /[\\/\\.#[\\]\\$]/;

  if (regexProhibidos.test(nombreLimpio)) {
    alert("❌ El nombre contiene caracteres no permitidos: / . # [ ]");
    return;
  }

  await registrarCliente(nombreLimpio);
  await cargarClientes();

  // Selecciona automáticamente si se encuentra
  const select = document.getElementById("cliente");
  for (let i = 0; i < select.options.length; i++) {
    if (select.options[i].textContent === nombreLimpio) {
      select.selectedIndex = i;
      break;
    }
  }

  alert("✅ Cliente registrado y cargado.");
};


        document.getElementById("addIP").onclick = () => agregarElemento("empresa/IPs", "ip", "IP");

      
      });

      document.getElementById("batchForm").addEventListener("submit", async e => {
        e.preventDefault();

        const seriales = document.getElementById("seriales").value.trim().split('\n').map(s => s.trim()).filter(s => s);
        const unitIdInicial = parseInt(document.getElementById("unit_id_inicial").value.trim(), 10);

        if (isNaN(unitIdInicial)) {
        alert("Debe ingresar un número válido para Unit ID inicial.");
        return;
        }


        if (seriales.length === 0) {
          alert("Debe ingresar al menos un serial.");
          return;
        }

        const grupos = [...document.querySelectorAll(".grupo-input")].map(i => i.value.trim()).filter(g => g);
        const cliente = document.getElementById("cliente").value;
        await registrarCliente(document.getElementById("cliente").selectedOptions[0].textContent);

        if ((detallesBatch || []).length > 0 && detallesBatch.length !== seriales.length) {
          alert(`❌ El archivo JSON tiene ${detallesBatch.length} filas pero ingresaste ${seriales.length} seriales. Deben coincidir para guardar modelo por equipo.`);
          return;
        }

        // ✅ Hard-stop: Block save if invalid groups detected in batch
        const gruposInvalidos = (detallesBatch || [])
          .flatMap(d => d.grupos || [])
          .some(g => g === "🔍");

        if (gruposInvalidos) {
          alert("❌ El archivo contiene un grupo inválido (🔍). Corrige el archivo antes de continuar.");
          return;
        }

        for (let i = 0; i < seriales.length; i++) {
         const detalle = normalizarDetalleBatch(detallesBatch?.[i] || {});
         const data = {
        cliente_id: cliente,
        cliente_nombre: document.getElementById("cliente").selectedOptions[0].textContent,
        ip: document.getElementById("ip").value,
        serial: seriales[i],
        unit_id: String(unitIdInicial + i), // Unit ID consecutivo
        radio_name: "",
        notas: document.getElementById("notas").value,
        creado_por_uid: firebase.auth().currentUser.uid,
        creado_por_email: firebase.auth().currentUser.email,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
        updated_at: firebase.firestore.FieldValue.serverTimestamp(),
        radio_name: detalle.radio_name || "",
        gps: detalle.gps ?? false,
        modelo: detalle.modelo_label || detalle.modelo || "",
        modelo_id: detalle.modelo_id || detalle.modeloId || null,
        modelo_label: detalle.modelo_label || detalle.modeloLabel || detalle.modelo || "",
        grupos: limpiarGrupos(detalle.grupos || []),
        activo: true,
        deleted: false
        };
          await PocService.addPocDevice(data);
        }

        alert("✅ Equipos creados correctamente.");
        window.location.href = "index.html";
      });
    });

let detallesBatch = [];

function obtenerValor(...valores) {
  for (const valor of valores) {
    if (typeof valor === "string" && valor.trim() !== "") return valor.trim();
    if (valor !== undefined && valor !== null && typeof valor !== "string") return valor;
  }
  return "";
}

function normalizarBooleanGPS(valor) {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor === 1;
  if (typeof valor === "string") {
    const v = valor.trim().toLowerCase();
    return ["true", "1", "si", "sí", "yes", "y", "✅", "🛰️"].includes(v);
  }
  return false;
}

function normalizarDetalleBatch(item = {}) {
  const modeloIdRaw = obtenerValor(
    item.modelo_id,
    item.modeloId,
    item.model_id,
    item.modelId
  );
  const modeloLabelRaw = obtenerValor(
    item.modelo_label,
    item.modeloLabel,
    item.model_label,
    item.modelLabel,
    item.Modelo,
    item.modelo,
    item.model
  );

  return {
    ...item,
    radio_name: obtenerValor(item.radio_name, item.radioName, item.nombre_radio, item.nombreRadio, item.Nombre, item.nombre),
    gps: normalizarBooleanGPS(obtenerValor(item.gps, item.GPS)),
    modelo_id: typeof modeloIdRaw === "string" ? modeloIdRaw.trim() : String(modeloIdRaw || "").trim(),
    modelo_label: typeof modeloLabelRaw === "string" ? modeloLabelRaw.trim() : String(modeloLabelRaw || "").trim(),
    modelo: typeof modeloLabelRaw === "string" ? modeloLabelRaw.trim() : String(modeloLabelRaw || ""),
    grupos: Array.isArray(item.grupos)
      ? item.grupos
      : (typeof item.grupos === "string" ? item.grupos.split(",") : [])
  };
}

function cargarDesdeJSON(input) {
  const file = input.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function (e) {
    try {
            const dataRaw = JSON.parse(e.target.result);
          if (!Array.isArray(dataRaw)) throw "Formato inválido";
          const data = dataRaw.map(normalizarDetalleBatch);

      const clienteSelect = document.getElementById("cliente");
      const clienteIdSeleccionado = clienteSelect.value;
      const clienteNombreSeleccionado = clienteSelect.options[clienteSelect.selectedIndex]?.textContent || "";

      if (data.length > 0 && data[0].cliente_id && data[0].cliente_id !== clienteIdSeleccionado) {
        alert("⚠️ El cliente seleccionado no coincide con el cliente del archivo JSON:\n\n" +
              "Cliente seleccionado: " + clienteNombreSeleccionado + "\n" +
              "Cliente en archivo: " + (data[0].cliente_nombre || "desconocido"));
        return;
      }

      detallesBatch = data;

      const preview = document.getElementById("previewVendedor");
      preview.className = "file-preview";
      preview.innerHTML = `
        <strong style="color: #155724;">✅ Archivo cargado: ${data.length} equipos detectados</strong>
        <table>
          <thead>
            <tr>
              <th>Nombre del Radio</th>
              <th>Modelo</th>
              <th>GPS</th>
              <th>Grupos</th>
              <th>Cliente Referencia</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(d => `
              <tr>
                <td>${d.radio_name || "—"}</td>
                <td>${d.modelo || "—"}</td>
                <td>${d.gps ? "✅" : "❌"}</td>
                <td>${(d.grupos || []).join(", ") || "—"}</td>
                <td>${d.cliente_nombre || "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `;
      
      alert("✅ Archivo cargado correctamente. Puedes continuar pegando los seriales y eligiendo el cliente correcto.");
    } catch (err) {
      alert("❌ Error al leer el archivo JSON: " + err);
    }
  };
  reader.readAsText(file);
}

async function registrarCliente(nombreCliente) {
  if (!nombreCliente) return;

  const nombre = nombreCliente.trim();
  if (await ClientesService.existsByNorm("nombre", nombre)) return; // ya existe

  await ClientesService.createCliente({
    nombre,
    fecha_creacion: new Date()
  });
}


