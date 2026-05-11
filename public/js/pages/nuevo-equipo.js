// @ts-nocheck
    const mensaje = document.getElementById("mensaje");

    function mostrarMensaje(texto, tipo = 'verde') {
      mensaje.style.color = tipo === 'verde' ? 'green' : 'red';
      mensaje.textContent = texto;
    }

    async function cargarListaSelect(path, selectId) {
      const docId = path.split('/')[1];
      const snap = await EmpresaService.getDoc(docId);
      const select = document.getElementById(selectId);
      if (snap) {
        const lista = snap.list || [];
        lista.forEach(op => {
          const option = document.createElement("option");
          option.value = op;
          option.textContent = op;
          select.appendChild(option);
        });
      }
    }

    function agregarGrupoAnimado() {
      const contenedor = document.getElementById("gruposContainer");
      const div = document.createElement("div");
      div.className = "grupo-container";
      div.innerHTML = `<input type="text" class="grupo-input">
                       <button type="button" onclick="this.parentNode.remove()">❌</button>`;
      contenedor.appendChild(div);
      div.scrollIntoView({ behavior: "smooth", block: "center" });
      div.style.backgroundColor = "#e6f7ff";
      setTimeout(() => div.style.backgroundColor = "transparent", 800);
    }

    
    document.addEventListener("DOMContentLoaded", async () => {
      firebase.auth().onAuthStateChanged(async user => {
        if (!user) return window.location.href = "/login.html";
        window.currentUser = user;
        if (location.search.includes("copiar=1")) {
  const datos = JSON.parse(localStorage.getItem("duplicarEquipo") || "{}");
  delete datos.created_at;
  delete datos.id;

  // Campos simples
  const camposTexto = [
    "sim_number", "sim_phone", "serial", "unit_id",
    "radio_name", "ip", "cliente", "operador", "notas"
  ];
  camposTexto.forEach(id => {
    if (datos[id]) {
      const input = document.getElementById(id);
      if (input) input.value = datos[id];
    }
  });

  // Checkboxes
  document.getElementById("gps").checked = !!datos.gps;
  document.getElementById("activo").checked = !!datos.activo;

  // Grupos
  const grupos = datos.grupos || [];
  const contenedor = document.getElementById("gruposContainer");
  contenedor.innerHTML = "";
  grupos.forEach(valor => {
    const div = document.createElement("div");
    div.className = "grupo-container";
    div.innerHTML = `<input type="text" class="grupo-input" value="${valor}">
                     <button type="button" onclick="this.parentNode.remove()">❌</button>`;
    contenedor.appendChild(div);
  });

  // Siempre dejar al menos una fila si no hay grupos
  if (grupos.length === 0) agregarGrupoAnimado();
}



        await cargarListaSelect("empresa/clientes", "cliente");
        await cargarListaSelect("empresa/operadores", "operador");
        await cargarListaSelect("empresa/IPs", "ip");

        document.getElementById("addCliente").onclick = async () => {
          const nuevo = prompt("Nuevo cliente:");
          if (nuevo) {
            const snap = await EmpresaService.getDoc("clientes");
            const lista = snap ? snap.list || [] : [];
            if (!lista.includes(nuevo)) {
              lista.push(nuevo);
              await EmpresaService.setDoc("clientes", { list: lista });
              const option = new Option(nuevo, nuevo);
              document.getElementById("cliente").appendChild(option);
              document.getElementById("cliente").value = nuevo;
            }
          }
        };

        document.getElementById("addIP").onclick = async () => {
          const nuevo = prompt("Nueva IP:");
          if (nuevo) {
            const snap = await EmpresaService.getDoc("IPs");
            const lista = snap ? snap.list || [] : [];
            if (!lista.includes(nuevo)) {
              lista.push(nuevo);
              await EmpresaService.setDoc("IPs", { list: lista });
              const option = new Option(nuevo, nuevo);
              document.getElementById("ip").appendChild(option);
              document.getElementById("ip").value = nuevo;
            }
          }
        };

        document.getElementById("addGrupo").addEventListener("click", agregarGrupoAnimado);
        agregarGrupoAnimado();

        document.getElementById("equipoForm").addEventListener("submit", async (e) => {
          e.preventDefault();

          const sim = document.getElementById("sim_number").value.trim();
          const tel = document.getElementById("sim_phone").value.trim();
          const serial = document.getElementById("serial").value.trim();

          const checks = await Promise.all([
            PocService.findByField("sim_number", sim),
            PocService.findByField("sim_phone", tel),
            PocService.findByField("serial", serial)
          ]);

          if (checks[0].length > 0) return mostrarMensaje("⚠️ SIM ya registrado.", "rojo");
          if (checks[1].length > 0) return mostrarMensaje("⚠️ Teléfono ya registrado.", "rojo");
          if (checks[2].length > 0) return mostrarMensaje("⚠️ Serial ya registrado.", "rojo");

          const grupos = [...document.querySelectorAll(".grupo-input")].map(i => i.value.trim()).filter(g => g);
          const setGrupos = new Set(grupos);
          if (grupos.length !== setGrupos.size) {
            return mostrarMensaje("⚠️ Hay grupos duplicados. Revise.", "rojo");
          }

          const data = {
            cliente: document.getElementById("cliente").value,
            operador: document.getElementById("operador").value,
            sim_number: sim,
            sim_phone: tel,
            serial: serial,
            gps: document.getElementById("gps").checked,
            activo: document.getElementById("activo").checked,
            ip: document.getElementById("ip").value,
            unit_id: document.getElementById("unit_id").value,
            radio_name: document.getElementById("radio_name").value,
            grupos,
            notas: document.getElementById("notas").value,
            creado_por_uid: window.currentUser?.uid || "",
            creado_por_email: window.currentUser?.email || "",
            created_at: firebase.firestore.FieldValue.serverTimestamp(),
            updated_at: firebase.firestore.FieldValue.serverTimestamp(),
            deleted: false
          };

          try {
            await PocService.addPocDevice(data);
            mostrarMensaje("✅ Equipo guardado exitosamente.");
            setTimeout(() => window.location.href = "index.html", 1000);
          } catch (error) {
            mostrarMensaje("Error: " + error.message, "rojo");
          }
        });
      });
    });
