// documentosClientePublico — el CLIENTE sube los documentos de su expediente
// desde un enlace, sin sesión (documentos/index.html).
//
// El problema (Zuleika, 2026-11-25): el Aviso de Operación, la cédula del
// representante y el recibo de servicio llegan por correo al vendedor y ahí se
// quedan. Censo de ese día: 20 de 278 clientes activos tenían algún documento.
// Con el enlace el archivo cae directo en el expediente y Cobros solo revisa.
//
// DOS portadores, los dos ids imposibles de adivinar:
//   · s = documentos_solicitudes/{s}   el enlace que pide el personal desde la
//         ficha ("Pedir documentos al cliente"). Vence a los 30 días.
//   · f = firma_solicitudes/{f}        el enlace de firma del contrato: el
//         cliente que ya lo abrió para firmar completa ahí mismo lo que falte.
//
// El enlace SOLO sirve para subir. Nunca devuelve un archivo, un nombre de
// archivo ni nada del expediente fuera de "esto ya lo recibimos".
//
// Por qué una Function y no el navegador: quien sube no tiene sesión. Storage
// le deja crear el archivo en una carpeta de ENTRADA propia del enlace
// (clientes_docs_entrada/{id}/, sin lectura) y aquí se valida el enlace, se
// comprueba que el archivo es lo que dice ser, se MUEVE al expediente
// (clientes_documentos/{cliente}/) y se anota en clientes/{id}/documentos con
// `revision: pendiente`. Lo que no se registra no queda en la carpeta.
//
// Input:  { accion: 'ver'|'registrar', s?|f?, nombre?, archivos?: [{ requisito, tipo, path, nombre }] }
// Output: ver       → { status, cliente?, pide?: [{ id, label, ayuda, tipos, estado }], vence? }
//         registrar → { status, registrados, rechazados, pide? }
//   status: 'ok' | 'completo' | 'vencido' | 'no_disponible'

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const { admin, db } = require("../lib/admin");
const { APP_BASE_URL } = require("../lib/inventario");
const { expedienteEmailTo } = require("../lib/mailRecipients");
const E = require("../domain/expedienteCliente");

const CARPETA_ENTRADA = "clientes_docs_entrada";
const MAX_BYTES = 10 * 1024 * 1024;
const MAX_POR_LLAMADA = 12;
// Tope de archivos que un mismo enlace puede dejar en un expediente: un
// enlace reenviado de más no llena la ficha de nadie.
const MAX_POR_ENLACE = 30;
// El enlace de firma sirve para completar documentos hasta 60 días después de
// creado (la firma caduca a los 45; la copia del cliente sigue abierta).
const DIAS_ENLACE_FIRMA = 60;
const TIPOS_OK = { "application/pdf": "pdf", "image/jpeg": "jpg" };
const ETIQUETA_TIPO = {
  aviso_operacion: "Aviso de Operación",
  registro_publico: "Registro Público",
  cedula_representante: "Cédula del representante legal",
  comprobante_direccion: "Recibo de servicio",
};

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[m]));

function aFecha(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  return null;
}

function idLimpio(v) {
  const s = String(v || "").trim();
  return s && s.length <= 64 && /^[A-Za-z0-9_-]+$/.test(s) ? s : null;
}

// El nombre del archivo es solo una etiqueta en la ficha: sin separadores de
// ruta ni caracteres de control.
function nombreArchivoLimpio(v) {
  return [...String(v || "")]
    .map((c) => (c === "/" || c === "\\" || c.charCodeAt(0) < 32 ? " " : c))
    .join("").trim().slice(0, 120);
}

function limpiarInput(data) {
  const d = data || {};
  const accion = String(d.accion || "").trim();
  if (!["ver", "registrar"].includes(accion)) throw new HttpsError("invalid-argument", "Acción inválida.");
  const s = idLimpio(d.s);
  const f = idLimpio(d.f);
  // Uno y solo uno: el enlace dice de dónde viene.
  if ((s && f) || (!s && !f)) throw new HttpsError("invalid-argument", "Enlace inválido.");
  const out = { accion, s, f };
  if (accion === "registrar") {
    out.nombre = String(d.nombre || "").replace(/\s+/g, " ").trim().slice(0, 120);
    // El nombre es el rastro de quién entregó los documentos.
    if (out.nombre.length < 3) throw new HttpsError("invalid-argument", "Escriba su nombre completo.");
    const xs = Array.isArray(d.archivos) ? d.archivos : [];
    if (!xs.length) throw new HttpsError("invalid-argument", "No hay archivos que registrar.");
    if (xs.length > MAX_POR_LLAMADA) throw new HttpsError("invalid-argument", "Demasiados archivos en un solo envío.");
    out.archivos = xs.map((a) => ({
      requisito: String((a && a.requisito) || ""),
      tipo: String((a && a.tipo) || ""),
      path: String((a && a.path) || ""),
      nombre: nombreArchivoLimpio(a && a.nombre),
    }));
  }
  return out;
}

/**
 * ¿Sirve el enlace? Puro: recibe el doc ya leído.
 * @returns {{status:'ok', cliente_id, marcados, recibidos}|{status:'no_disponible'|'vencido'|'completo'}}
 */
function evaluarPortador(clase, doc, ahora = new Date()) {
  if (!doc || !doc.cliente_id) return { status: "no_disponible" };
  if (clase === "solicitud") {
    if (doc.estado === "completada") return { status: "completo" };
    if (doc.estado !== "pendiente") return { status: "no_disponible" };
    const vence = aFecha(doc.vence_at);
    const creado = aFecha(doc.creado_at);
    // Tope duro además del vence_at que puso el navegador del personal.
    const tope = creado ? new Date(creado.getTime() + (E.DIAS_ENLACE + 1) * 864e5) : null;
    if (!vence || vence <= ahora || (tope && tope <= ahora)) return { status: "vencido" };
    return { status: "ok", cliente_id: doc.cliente_id, marcados: doc.pide || [], recibidos: doc.recibidos || {}, vence };
  }
  // Enlace de firma: cancelado o caducado no hubo trato; el resto vale.
  if (["cancelado", "caducado"].includes(doc.estado)) return { status: "no_disponible" };
  const creado = aFecha(doc.created_at);
  if (!creado) return { status: "no_disponible" };
  const vence = new Date(creado.getTime() + DIAS_ENLACE_FIRMA * 864e5);
  if (vence <= ahora) return { status: "vencido" };
  return { status: "ok", cliente_id: doc.cliente_id, marcados: [], recibidos: {}, vence };
}

/**
 * Lo que la página le muestra al cliente. Puro.
 * Con requisitos MARCADOS por el personal (p. ej. "mándame la cédula nueva")
 * se pide aunque ya haya una en el expediente; lo que ya entró por este mismo
 * enlace sale como recibido.
 */
function listaPedidos(portador, docs) {
  const r = E.resumen(docs);
  const marcados = (portador.marcados || []).filter((id) => E.IDS.includes(id));
  const recibidos = portador.recibidos || {};
  // Sin marcar nada se pide lo que no esté completo; lo que ya entró por este
  // enlace se sigue mostrando, como recibido, para que el cliente vea su avance.
  const ids = E.IDS.filter((id) => (marcados.length ? marcados.includes(id) : (r[id] !== "ok" || !!recibidos[id])));
  return ids.map((id) => {
    const q = E.requisito(id);
    const recibido = !!recibidos[id] || (!marcados.length && r[id] === "por_revisar");
    return {
      id, label: q.label, ayuda: q.ayuda, estado: recibido ? "recibido" : "pedir",
      tipos: q.tipos.map((t) => ({ value: t, label: ETIQUETA_TIPO[t] || t })),
    };
  });
}

function pathValido(path, portadorId, requisito) {
  const re = new RegExp(`^${CARPETA_ENTRADA}/${portadorId}/${requisito}-[0-9]{13}-[0-9]{1,2}[.](pdf|jpg)$`);
  return re.test(path);
}

// Los primeros bytes dicen qué es el archivo de verdad: el content-type lo
// declara quien sube.
function firmaDeArchivo(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return "pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpg";
  return null;
}

async function primerosBytes(file, n = 8) {
  const [buf] = await file.download({ start: 0, end: n - 1 });
  return buf;
}

function correoCobros({ clienteId, cliente, nombre, registrados, faltan, porFirma }) {
  const filas = registrados.map((r) =>
    `<li>${esc(ETIQUETA_TIPO[r.tipo] || r.tipo)}${r.n > 1 ? ` (${r.n} archivos)` : ""}</li>`).join("");
  const faltanTxt = E.fraseFaltan(faltan);
  return {
    subject: `Documentos recibidos — ${cliente}`,
    preheader: `${nombre} subió ${registrados.reduce((a, r) => a + r.n, 0)} archivo(s) al expediente; falta revisarlos`,
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">El cliente subió documentos</h2>
      <p style="margin:0 0 10px;font:14px/1.5 Arial,sans-serif;">
        <b>${esc(nombre)}</b> subió al expediente de <b>${esc(cliente)}</b>, desde
        ${porFirma ? "el enlace de firma de su contrato" : "el enlace de documentos"}:</p>
      <ul style="margin:0 0 12px 18px;padding:0;font:14px/1.6 Arial,sans-serif;">${filas}</ul>
      <p style="margin:0 0 10px;font:14px/1.5 Arial,sans-serif;">
        Quedaron <b>sin revisar</b>: ábrelos y márcalos como revisados, o recházalos si no se leen
        (el cliente los vuelve a subir con un enlace nuevo).</p>
      <p style="margin:0;font:14px/1.5 Arial,sans-serif;color:${faltanTxt ? "#92400e" : "#065F46"};">
        ${faltanTxt ? `Todavía falta: <b>${esc(faltanTxt)}</b>.` : "Con esto ya no falta ningún documento por recibir."}</p>`,
    ctaUrl: `${APP_BASE_URL}/clientes/centro.html?id=${encodeURIComponent(clienteId)}&docs=1`,
    ctaLabel: "Revisar los documentos",
  };
}

// El trabajo real, separado del wrapper onCall para probarlo con db y bucket falsos.
async function handler(request, deps = {}) {
  const fdb = deps.db || db;
  const fadmin = deps.admin || admin;
  const bucket = deps.bucket || fadmin.storage().bucket();
  const destinatarios = deps.expedienteEmailTo || expedienteEmailTo;
  const input = limpiarInput(request.data);
  const clase = input.s ? "solicitud" : "firma";
  const pid = input.s || input.f;
  const pRef = fdb.collection(clase === "solicitud" ? "documentos_solicitudes" : "firma_solicitudes").doc(pid);

  const pSnap = await pRef.get();
  const ahora = fadmin.firestore.Timestamp.now();
  const portador = evaluarPortador(clase, pSnap.exists ? pSnap.data() : null, ahora.toDate());
  if (portador.status !== "ok") return { status: portador.status };

  const cRef = fdb.collection("clientes").doc(portador.cliente_id);
  const cSnap = await cRef.get();
  const cli = cSnap.exists ? (cSnap.data() || {}) : null;
  if (!cli || cli.deleted === true) return { status: "no_disponible" };
  const cliente = cli.nombre || "su empresa";
  const docsCol = cRef.collection("documentos");
  const leerDocs = async () => (await docsCol.get()).docs.map((d) => d.data() || {});

  if (input.accion === "ver") {
    const pide = listaPedidos(portador, await leerDocs());
    // El enlace de firma no pide nada cuando no falta nada: la página de firma
    // ni muestra el aviso.
    if (!pide.length || pide.every((p) => p.estado === "recibido")) {
      return { status: "completo", cliente };
    }
    return { status: "ok", cliente, pide, vence: portador.vence ? portador.vence.toISOString() : null };
  }

  // ── registrar ──
  const previos = await leerDocs();
  const campoOrigen = clase === "solicitud" ? "solicitud" : "firma_solicitud";
  const yaDeEsteEnlace = previos.filter((d) => d.origen && d.origen[campoOrigen] === pid).length;
  if (yaDeEsteEnlace + input.archivos.length > MAX_POR_ENLACE) {
    throw new HttpsError("resource-exhausted", "Este enlace ya recibió demasiados archivos. Pida uno nuevo a su asesor.");
  }
  // Lo que ya se recibió se puede volver a mandar (una foto mejor, el reverso).
  const pedibles = new Set(listaPedidos(portador, previos).map((p) => p.id)
    .concat(clase === "firma" ? E.IDS : []));

  const registrados = [];
  const rechazados = [];
  for (const a of input.archivos) {
    const q = E.requisito(a.requisito);
    const motivo = (m) => rechazados.push({ path: a.path, motivo: m });
    if (!q || !pedibles.has(a.requisito)) { motivo("no_pedido"); continue; }
    const tipo = q.tipos.includes(a.tipo) ? a.tipo : q.tipos[0];
    if (!pathValido(a.path, pid, a.requisito)) { motivo("ruta"); continue; }
    const file = bucket.file(a.path);
    try {
      const [meta] = await file.getMetadata();
      const ext = TIPOS_OK[String(meta.contentType || "").toLowerCase()];
      const size = Number(meta.size || 0);
      const real = ext && size > 0 && size <= MAX_BYTES ? firmaDeArchivo(await primerosBytes(file)) : null;
      if (!ext || real !== ext) {
        await file.delete().catch(() => {});
        motivo("formato");
        continue;
      }
      const docRef = docsCol.doc();
      const destino = `clientes_documentos/${portador.cliente_id}/${docRef.id}.${ext}`;
      await file.move(destino);
      await docRef.set({
        tipo,
        nombre_archivo: a.nombre || `${ETIQUETA_TIPO[tipo] || "Documento"}.${ext}`,
        storage_path: destino,
        content_type: meta.contentType,
        size,
        subido_por: null,
        subido_en: ahora,
        deleted: false,
        origen: { cliente: true, [campoOrigen]: pid, nombre: input.nombre },
        revision: { estado: "pendiente" },
      });
      registrados.push({ requisito: a.requisito, tipo, doc_id: docRef.id });
    } catch (e) {
      logger.warn("[documentosClientePublico] archivo no registrado", { pid, path: a.path, error: e.message });
      motivo("no_encontrado");
    }
  }

  // Lo que quedó en la carpeta de entrada y no se registró (un intento a
  // medias, un archivo rechazado) no se conserva.
  try {
    const [resto] = await bucket.getFiles({ prefix: `${CARPETA_ENTRADA}/${pid}/` });
    await Promise.all(resto.map((f) => f.delete().catch(() => {})));
  } catch (e) {
    logger.warn("[documentosClientePublico] carpeta de entrada no limpiada", { pid, error: e.message });
  }

  if (!registrados.length) return { status: "ok", registrados: 0, rechazados, cliente };

  const despues = await leerDocs();
  const resumen = E.resumen(despues);
  let pideAhora = [];
  if (clase === "solicitud") {
    const recibidos = { ...(portador.recibidos || {}) };
    for (const r of registrados) recibidos[r.requisito] = { at: ahora, n: ((recibidos[r.requisito] || {}).n || 0) + 1 };
    pideAhora = listaPedidos({ ...portador, recibidos }, despues);
    const completa = pideAhora.every((p) => p.estado === "recibido");
    await pRef.update({
      recibidos,
      ultimo_recibido_at: ahora,
      ultimo_recibido_por: input.nombre,
      ...(completa ? { estado: "completada", completada_at: ahora } : {}),
    });
  } else {
    pideAhora = listaPedidos(portador, despues);
  }

  // El aviso va FUERA de lo anterior y es best-effort: los documentos ya
  // están en el expediente y la ficha los muestra "por revisar".
  try {
    const porTipo = {};
    for (const r of registrados) porTipo[r.tipo] = (porTipo[r.tipo] || 0) + 1;
    const to = await destinatarios();
    const cc = new Set();
    const solicitante = clase === "solicitud" ? String(pSnap.data().creado_por_email || "").trim().toLowerCase() : "";
    if (solicitante.includes("@")) cc.add(solicitante);
    if (cli.vendedor_asignado) {
      const v = await fdb.collection("usuarios").doc(cli.vendedor_asignado).get();
      const ve = v.exists ? String(v.data().email || "").trim().toLowerCase() : "";
      if (ve.includes("@")) cc.add(ve);
    }
    const paraSet = new Set(String(to || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean));
    const ccFinal = [...cc].filter((x) => !paraSet.has(x));
    if (to) {
      const mail = correoCobros({
        clienteId: portador.cliente_id, cliente, nombre: input.nombre,
        registrados: Object.keys(porTipo).map((tipo) => ({ tipo, n: porTipo[tipo] })),
        faltan: resumen.faltan, porFirma: clase === "firma",
      });
      await fdb.collection("mail_queue").add({
        to, cc: ccFinal.length ? ccFinal.join(", ") : null,
        ...mail,
        meta: {
          created_at: fadmin.firestore.FieldValue.serverTimestamp(),
          source: "documentosClientePublico",
          tipo: "expediente_documentos_recibidos",
          cliente_id: portador.cliente_id,
          [campoOrigen]: pid,
        },
        status: "queued",
        createdAt: fadmin.firestore.FieldValue.serverTimestamp(),
      });
    } else {
      logger.warn("[documentosClientePublico] sin destinatario para el aviso", { pid });
    }
  } catch (e) {
    logger.error("[documentosClientePublico] no se pudo avisar a Cobros", { pid, error: e.message });
  }

  logger.info("[documentosClientePublico] documentos registrados", {
    pid, clase, cliente_id: portador.cliente_id, n: registrados.length, rechazados: rechazados.length,
  });
  const todoRecibido = pideAhora.every((p) => p.estado === "recibido");
  return {
    status: todoRecibido ? "completo" : "ok",
    registrados: registrados.length, rechazados, cliente, pide: pideAhora,
  };
}

const fn = onCall(
  // Sin auth a propósito: lo llama el cliente desde su enlace. El control es
  // el id del enlace (portador), validado arriba en cada llamada.
  { region: "us-central1", memory: "256MiB", timeoutSeconds: 60, invoker: "public" },
  (request) => handler(request)
);

fn._interno = { handler, limpiarInput, evaluarPortador, listaPedidos, pathValido, firmaDeArchivo, correoCobros, CARPETA_ENTRADA };
module.exports = fn;
