    const storage = firebase.storage();

    let ordenId = null;
    let ctx, canvas, dibujando = false;

    function initCanvas() {
      canvas = document.getElementById("firmaCanvas");
      ctx = canvas.getContext("2d");
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";

      const ajustar = () => {
        canvas.width = canvas.clientWidth;
        canvas.height = 200;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0,0,canvas.width,canvas.height);
      };
      ajustar();

      const getPos = e => {
        if (e.touches) {
          return {
            x: e.touches[0].clientX - canvas.getBoundingClientRect().left,
            y: e.touches[0].clientY - canvas.getBoundingClientRect().top
          };
        } else {
          return { x: e.offsetX, y: e.offsetY };
        }
      };

      const start = e => { dibujando = true; ctx.beginPath(); const p = getPos(e); ctx.moveTo(p.x,p.y); e.preventDefault(); };
      const move = e => { if(!dibujando) return; const p = getPos(e); ctx.lineTo(p.x,p.y); ctx.stroke(); e.preventDefault(); };
      const end = e => { dibujando = false; e.preventDefault(); };

      canvas.addEventListener("mousedown", start);
      canvas.addEventListener("mousemove", move);
      canvas.addEventListener("mouseup", end);
      canvas.addEventListener("mouseleave", end);

      canvas.addEventListener("touchstart", start);
      canvas.addEventListener("touchmove", move);
      canvas.addEventListener("touchend", end);
    }

    function limpiarFirma(){
      ctx.clearRect(0,0,canvas.width,canvas.height);
      ctx.fillStyle="#fff";
      ctx.fillRect(0,0,canvas.width,canvas.height);
    }

async function guardarFirma() {
  try {
    if (!ordenId) return alert("No se detectó la orden.");

    const user = firebase.auth().currentUser;
    if (!user) return alert("No hay usuario autenticado");

    // 1) Validar que la firma no esté vacía
    if (isCanvasVacio(canvas)) {
      alert("⚠️ Debes ingresar una firma antes de confirmar.");
      return;
    }

    // 2) Subir firma
    const dataURL = canvas.toDataURL("image/png");
    const blob = await (await fetch(dataURL)).blob();
    const pathFirma = `ordenes_firmas/${ordenId}_firma_${Date.now()}.png`;
    const storageRef = firebase.storage().ref(pathFirma);
    await storageRef.put(blob, { contentType: "image/png" });
    const urlFirma = await storageRef.getDownloadURL();

    // 3) Subir foto de identificación (si existe)
    let urlIdentificacion = null;
    const fileId = document.getElementById("fotoIdentificacion").files[0];
    if (fileId) {
      const ext = (fileId.name.split(".").pop() || "jpg").toLowerCase();
      const pathId = `ordenes_identificacion/${ordenId}_id_${Date.now()}.${ext}`;
      const storageIdRef = firebase.storage().ref(pathId);
      await storageIdRef.put(fileId, { contentType: fileId.type });
      urlIdentificacion = await storageIdRef.getDownloadURL();
    }

    // 4) Email del cliente
    const emailCliente = document.getElementById("clienteEmail").value.trim();

    // 5) Actualizar Firestore
    const ordenData = (await OrdenesService.getOrder(ordenId)) || {};

    let nuevoEstado = "ENTREGADO AL CLIENTE";

    const fechaEntregaVal = document.getElementById("fechaEntrega").value;
    const fechaEntrega = fechaEntregaVal ? new Date(fechaEntregaVal) : null;

    await OrdenesService.mergeOrder(ordenId, {
    estado_reparacion: "ENTREGADO AL CLIENTE",
    fecha_entrega: firebase.firestore.FieldValue.serverTimestamp(),
    firma_url: urlFirma,
    identificacion_url: urlIdentificacion,
    email_cliente_entrega: emailCliente,
    entrega_por_uid: user.uid,
    entrega_por_email: user.email,
    entrega_ts: firebase.firestore.FieldValue.serverTimestamp(),
    os_logs: firebase.firestore.FieldValue.arrayUnion({
        action: "ENTREGAR",
        by: user.uid || ""
    })
    });


// 6) Enviar correo al cliente
if (emailCliente) {
  const cliente = ordenData.cliente_nombre || "—";
  const tipo = ordenData.tipo_de_servicio || "—";
  const radios = (ordenData.equipos || []).filter(e => !e.eliminado).length;

await MailService.enqueue({
  to: emailCliente,
  subject: `Orden ${ordenId} ENTREGADA AL CLIENTE`,
  text: `
Estimado cliente,

Su Orden de Servicio ${ordenId} ha sido marcada como ENTREGADA AL CLIENTE.

📋 Orden: ${ordenId}
👤 Cliente: ${cliente}
🔧 Tipo de servicio: ${tipo}
📻 Equipos entregados: ${radios}

Gracias por confiar en Cecomunica.
  `.trim(),
  html: `
<p>Estimado cliente,</p>
<p>Su <strong>Orden ${ordenId}</strong> ha sido marcada como <b>ENTREGADA AL CLIENTE</b>.</p>
<ul>
  <li><strong>Cliente:</strong> ${cliente}</li>
  <li><strong>Tipo de servicio:</strong> ${tipo}</li>
  <li><strong>Equipos entregados:</strong> ${radios}</li>
</ul>
<p>Gracias por confiar en <strong>Cecomunica</strong>.</p>
  `.trim(),
});

  console.log("📧 Email de confirmación enviado al cliente:", emailCliente);
}

// 7) Enviar correo al vendedor asignado
if (ordenData.vendedor_asignado) {
  try {
    const v = await UsuariosService.getUsuario(ordenData.vendedor_asignado);
    if (v) {
      if (v.email) {
        const asunto = `Orden ${ordenId} ENTREGADA AL CLIENTE`;
        await MailService.enqueue({
          to: v.email,
          subject: `Orden ${ordenId} ENTREGADA AL CLIENTE`,
          text: `
        Estimado(a) ${v.nombre || "Vendedor"},

        La Orden de Servicio ${ordenId} del cliente ${ordenData.cliente_nombre || "—"}
        ha sido marcada como ENTREGADO AL CLIENTE.

        Puede coordinar la facturación o el seguimiento correspondiente.
        `.trim(),
          html: `
        <p>Estimado(a) ${v.nombre || "Vendedor"},</p>
        <p>La <strong>Orden ${ordenId}</strong> del cliente <b>${ordenData.cliente_nombre || "—"}</b> ha sido marcada como <b>ENTREGADO AL CLIENTE</b>.</p>
        <p>Puede coordinar la facturación o el seguimiento correspondiente.</p>
        `.trim(),
        });
        console.log("📧 Email de notificación enviado al vendedor:", v.email);
      }
    }
  } catch (err) {
    console.error("❌ Error enviando correo al vendedor:", err);
  }
}

    // 8) Finalizar
    alert("✅ Firma, entrega y correos guardados correctamente");
    window.location.href = "index.html";

  } catch (e) {
    console.error("❌ Error al guardar firma:", e);
    alert("Error al guardar la firma: " + e.message);
  }
}


    function isCanvasVacio(c) {
      const imgData = c.getContext("2d").getImageData(0,0,c.width,c.height).data;
      return !imgData.some(v => v !== 255); // todo blanco
    }

    function mostrarMensaje(txt,color="green"){
      const el=document.getElementById("mensaje");
      el.textContent=txt; el.style.color=color;
    }

    async function cargarOrden(id) {
  const o = await OrdenesService.getOrder(id);
  if (!o) {
    alert("Orden no encontrada");
    return;
  }
  document.getElementById("ordenCliente").textContent = o.cliente_nombre || "—";
  document.getElementById("ordenTipo").textContent = o.tipo_de_servicio || "—";
  document.getElementById("ordenTecnico").textContent = o.tecnico_asignado || "—";
  document.getElementById("ordenEstado").textContent = o.estado_reparacion || "—";
  document.getElementById("ordenRadios").textContent = (o.equipos || []).filter(e => !e.eliminado).length;

  // Buscar email del cliente en la colección clientes
  if (o.cliente_id) {
    const cli = await ClientesService.getCliente(o.cliente_id);
    if (cli) document.getElementById("clienteEmail").value = cli.email || "";
  }
}
async function subirIdentificacion(ordenId) {
  const file = document.getElementById("fotoIdentificacion").files[0];
  if (!file) return null;

  const ext = (file.name.split('.').pop() || "jpg").toLowerCase();
  const path = `entregas_identificacion/${ordenId}_${Date.now()}.${ext}`;

  const storageRef = firebase.storage().ref(path);
  await storageRef.put(file, { contentType: file.type });
  return await storageRef.getDownloadURL();
}

  // 🔎 Extraer ID de la orden desde la URL
  const params = new URLSearchParams(window.location.search);
  ordenId = params.get("id");

  window.addEventListener("DOMContentLoaded", () => {
    initCanvas();
    if (ordenId) {
      cargarOrden(ordenId);
    } else {
      alert("No se detectó ID de orden en la URL.");
    }
  });
  document.getElementById("fotoIdentificacion").addEventListener("change", e => {
  const file = e.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  document.getElementById("previewId").innerHTML = `<img src="${url}" style="max-width:100%;border:1px solid #ccc;border-radius:8px;margin-top:8px">`;
});

