// Reemplazo por DAÑO CAUSADO POR EL CLIENTE (2026-09-25, Alberto).
//
// EL PROBLEMA. El taller solo podía proponer un reemplazo por GARANTÍA: un
// radio de alquiler que el cliente rompió (golpe, líquido, carcasa partida)
// se reponía igual, gratis, por el mismo camino. Ese reemplazo se cotiza y se
// factura, y el proceso tiene que ser distinto.
//
// EL CAMINO (reusa las dos máquinas que ya existen, no inventa una tercera):
//   1. El técnico propone desde la fila del radio eligiendo "Daño causado por
//      el cliente", con fotos. Nace la MISMA gestión GR, con `causa:
//      'dano_cliente'` y `cobro.monto_referencia` = valor de reposición del
//      catálogo (decisión de Alberto: el precio de venta del catálogo, el
//      mismo del Anexo A).
//   2. Administración aprueba CON CARGO (fija el monto) → la gestión queda
//      `pendiente_cliente` y este módulo arma sola la COTIZACIÓN DE TALLER de
//      la reposición, en borrador, para que la jefa de taller la envíe.
//      (Aprobar SIN cargo —cortesía— sigue el camino de garantía de siempre.)
//   3. El cliente acepta —por correo o de palabra, casi nunca por la página—
//      y el taller lo anota con "El cliente aceptó" en la cotización: se abre
//      la fila de facturación (lib/facturacionCotizacion) y la gestión pasa a
//      `pendiente_bodega`, que es lo que le manda el correo a Bodega. Bodega
//      NO se entera antes: no se saca un radio del estante por un cobro que el
//      cliente no aceptó (decisión de Alberto).
//   4. El cliente NO acepta: la gestión se CIERRA sin reemplazo y el daño
//      pasa a cobranza (renglón en `cobros_equipos`, la bandeja que ya se
//      persigue a diario). El caso nunca queda colgando: si el cliente no
//      contesta, administración lo pasa a cobranza desde el expediente.
//
// UNA COTIZACIÓN POR ORDEN (2026-11-19, Solangel / WESTIN, orden 2026111702).
// Cuatro radios dañados de la misma orden eran cuatro gestiones y, al aprobarse
// con cargo, cuatro cotizaciones de un renglón: cuatro documentos al cliente
// por un solo caso y el riesgo de facturarlo dos veces. Ahora la reposición
// aprobada se SUMA a la cotización de reposición que la orden ya tenga en
// borrador (un renglón por radio, `gestion_ids`), y solo si no hay ninguna —o
// ya salió al cliente— nace otra. Aceptarla libera a bodega TODAS sus
// gestiones; rechazarla las cierra todas. Anular una gestión le quita su
// renglón a la cotización en borrador.
//
// Las funciones puras (renglón, totales, documento) van exportadas para los
// tests; las que escriben reciben ids y releen en transacción.
const logger = require("firebase-functions/logger");
const { admin, db } = require("./admin");
const { APP_BASE_URL } = require("./inventario");
const { ITBMS_RATE } = require("./constants");
const { gestionesDe } = require("./cotizacionServicio");
const CotizacionTotales = require("../domain/cotizacionesTotales");

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const TIPOS_DANO = {
  golpe: "Golpe o caída",
  liquido: "Líquido o humedad",
  carcasa: "Carcasa, pantalla o antena rota",
  manipulacion: "Manipulación o sellos violados",
  otro: "Otro daño físico",
};

// ¿Esta gestión es un reemplazo por daño que se le cobra al cliente?
function esReposicionDano(g) {
  return g?.tipo === "reemplazo" && g?.causa === "dano_cliente";
}
function cobraCargo(g) {
  return esReposicionDano(g) && g?.cobro?.requiere === true;
}

// El monto que se cobra: el que fijó administración al aprobar; si no, el de
// referencia del catálogo. null = nadie le puso precio (no se inventa uno).
function montoReposicion(g) {
  const a = Number(g?.cobro?.monto);
  if (Number.isFinite(a) && a > 0) return r2(a);
  const ref = Number(g?.cobro?.monto_referencia);
  return Number.isFinite(ref) && ref > 0 ? r2(ref) : null;
}

function totalesReposicion(monto, { exento = false, tasa = ITBMS_RATE } = {}) {
  const subtotal = r2(monto);
  const itbms = exento ? 0 : r2(subtotal * tasa);
  return { subtotal, itbms, total: r2(subtotal + itbms) };
}

// El renglón que ve el cliente. Mismo formato que los de cotizar-orden
// (`equipo` estructurado + `spec` de texto), así el documento se agrupa por
// equipo igual que una reparación.
function renglonReposicion(g, monto, gid = "") {
  const it = (g.items || [])[0] || {};
  const dano = g.dano || {};
  const tipoTxt = TIPOS_DANO[dano.tipo] || dano.tipo_label || "Daño físico";
  const modelo = it.modelo || "equipo";
  const intervencion = `Reposición por daño: ${tipoTxt}${g.origen?.diagnostico ? ` — ${g.origen.diagnostico}` : ""}`;
  return {
    // El id lleva la gestión: es lo único del renglón que el editor de
    // cotizaciones conserva tal cual, y por él se le quita si se anula.
    id: gid ? `rep-${gid}` : "rep1",
    modelo: String(it.modelo_codigo || it.modelo || "").slice(0, 60),
    nombre: `Reposición de equipo ${modelo}`,
    spec: `Equipo: Serie ${it.serial_saliente || "—"} · Modelo ${modelo} · Intervención: ${intervencion}`,
    equipo: {
      id: g.origen?.equipo_id || null,
      serial: it.serial_saliente || "",
      modelo,
      marca: "",
      intervencion,
    },
    cant: 1,
    precio: r2(monto),
    desc: 0,
    modalidad: "venta",
  };
}

// La introducción, para uno o varios radios de la misma orden. Se regenera al
// sumar un radio SOLO si nadie la editó (se compara contra la que tocaba).
function introReposicion(ordenId, radios = []) {
  const lista = radios.filter((r) => r && r.serial);
  if (lista.length <= 1) {
    const r = lista[0] || {};
    return `Cotización de la reposición del radio ${r.serial || ""} (${r.modelo || "—"}), `
      + `recibido en la orden de servicio ${ordenId || "—"} con daño físico que no cubre la garantía. `
      + "Al aceptarla se entrega un equipo de reposición en su lugar.";
  }
  return `Cotización de la reposición de ${lista.length} radios (${lista.map((r) => r.serial).join(", ")}), `
    + `recibidos en la orden de servicio ${ordenId || "—"} con daño físico que no cubre la garantía. `
    + "Al aceptarla se entrega un equipo de reposición en lugar de cada uno.";
}
// Los radios que ya cobra una cotización de reposición, leídos de sus renglones.
function radiosDeCotizacion(cot = {}) {
  return (Array.isArray(cot.items) ? cot.items : [])
    .map((it) => ({ serial: String(it?.equipo?.serial || "").trim(), modelo: String(it?.equipo?.modelo || "").trim() }))
    .filter((r) => r.serial);
}
// Totales del documento a partir de sus renglones (los que escribe el editor).
function totalesDeItems(cot) {
  const t = CotizacionTotales.calcTotales(cot);
  return {
    subtotal: r2(t.subtotal), descuento_global: r2(t.descGlobal), itbms_monto: r2(t.itbms),
    total_con_itbms: r2(t.total), total: r2(t.total), total_venta: r2(t.venta.total),
  };
}

/**
 * La cotización de la reposición, lista para escribir (sin timestamps del
 * servidor — los pone quien escribe). Es una cotización de TALLER: origen
 * 'orden' + la orden del radio dañado, así la imprime, la envía y la factura
 * el mismo circuito que una reparación.
 */
// `overrides` (2026-10-15, reposición de un equipo NO DEVUELTO, lib/
// reposicionNoDevuelto): el mismo documento con otra introducción, otro
// renglón y campos extra (cobro_equipo_id en vez de gestion_id). El daño no
// pasa nada y queda exactamente igual.
function docCotizacionReposicion({ gid, g, cliente = {}, firmante = {}, cotizacionId, fechaIso, validezDias = 15, monto }, overrides = {}) {
  const exento = cliente.itbms_exento === true;
  const t = totalesReposicion(monto, { exento });
  const it = (g.items || [])[0] || {};
  const ordenId = g.origen?.orden_id || "";
  const base = {
    cotizacion_id: cotizacionId,
    estado: "borrador",
    origen: "orden",
    orden_id: ordenId,
    gestion_id: gid,
    ...(gid ? { gestion_ids: [gid] } : {}),
    generada_por: "sistema:reposicion_dano",
    clienteId: g.cliente_id || "",
    cliente_nombre: g.cliente_nombre || cliente.nombre || "",
    cliente_ruc: [cliente.ruc, cliente.dv].filter(Boolean).join(" DV "),
    cliente_email: cliente.email || "",
    cliente_representante: cliente.representante || "",
    cliente_itbms_exento: exento,
    dirigido_a: cliente.representante || "",
    dirigido_email: cliente.email || "",
    ejecutivoId: firmante.uid || "",
    ejecutivo_nombre: firmante.nombre || "",
    ejecutivo_cargo: firmante.cargo || "",
    ejecutivo_email: firmante.email || "",
    fecha: fechaIso,
    validezDias: Number(validezDias) || 15,
    moneda: "USD",
    descuentoPct: 0,
    itbms_aplica: !exento,
    itbms_porcentaje: ITBMS_RATE,
    itbms_monto: t.itbms,
    total_con_itbms: t.total,
    itbmsPct: exento ? 0 : Math.round(ITBMS_RATE * 100),
    intro: introReposicion(ordenId, [{ serial: it.serial_saliente || "", modelo: it.modelo || "" }]),
    items: [renglonReposicion(g, monto, gid)],
    plazoMeses: 0,
    condiciones: [],
    adjuntos: [],
    subtotal: t.subtotal,
    descuento_global: 0,
    total: t.total,
    total_venta: t.total,
    total_mensual: 0,
    compromiso_plazo: 0,
    incluye_carta: true,
    requiere_aprobacion: false,
    creado_por_uid: firmante.uid || null,
    creado_por_email: firmante.email || null,
    deleted: false,
  };
  if (overrides.intro) base.intro = overrides.intro;
  if (overrides.renglon) base.items = [overrides.renglon];
  return { ...base, ...(overrides.extra || {}) };
}

// Fecha de hoy en Panamá (YYYY-MM-DD): la cotización se fecha como la vería
// quien la firma, no en UTC — a las 8 p. m. de Panamá UTC ya es mañana.
function hoyPanamaIso(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Panama", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

// Correlativo COT-YYYY-NNNN: el MISMO contador que usa la app
// (contadores/cotizaciones_{año}), en transacción. Si el contador del año no
// existe todavía, se siembra con el mayor número emitido.
async function pisoCorrelativo() {
  const y = Number(hoyPanamaIso().slice(0, 4));
  const prefix = `COT-${y}-`;
  let piso = 0;
  try {
    const snap = await db.collection("cotizaciones")
      .where("cotizacion_id", ">=", prefix).where("cotizacion_id", "<", prefix + "\uf8ff")
      .orderBy("cotizacion_id", "desc").limit(1).get();
    snap.forEach((d) => {
      const n = parseInt(String(d.data().cotizacion_id || "").slice(prefix.length), 10);
      if (!isNaN(n)) piso = Math.max(piso, n);
    });
  } catch (e) { logger.warn("[reposicionDano] piso del correlativo no leído", { error: e.message }); }
  return { y, prefix, piso, ref: db.collection("contadores").doc(`cotizaciones_${y}`) };
}
// El incremento, DENTRO de una transacción que el llamador ya tiene abierta:
// `leer` antes de cualquier escritura, `tomar` cuando ya decidió crear. Así
// una cotización que al final no nace no quema un número.
function correlativoEnTx(tx, c) {
  let actual = 0;
  return {
    async leer() { const s = await tx.get(c.ref); actual = s.exists ? Number(s.data().seq || 0) : 0; },
    tomar() {
      const sig = Math.max(actual, c.piso) + 1;
      tx.set(c.ref, { seq: sig, anio: c.y, actualizado_en: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
      return c.prefix + String(sig).padStart(4, "0");
    },
  };
}
async function siguienteCotizacionId() {
  const c = await pisoCorrelativo();
  return db.runTransaction(async (tx) => {
    const k = correlativoEnTx(tx, c);
    await k.leer();
    return k.tomar();
  });
}

// Quien firma la cotización de reposición: la jefatura de taller (es una
// cotización de taller). Su cargo sale de su ficha.
async function firmanteTaller() {
  const snap = await db.collection("usuarios").where("rol", "==", "jefe_taller").get();
  const vivos = snap.docs.filter((d) => d.data()?.activo !== false && d.data()?.deleted !== true);
  const d = vivos[0] || snap.docs[0];
  if (!d) return {};
  const u = d.data() || {};
  return {
    uid: d.id,
    nombre: u.nombre || u.name || u.email || "",
    email: String(u.email || "").trim().toLowerCase(),
    cargo: u.cargo || "Jefe(a) de Taller",
  };
}

// Candado por ORDEN: la cotización de reposición abierta (en borrador) a la
// que se suman las siguientes. Vive en una subcolección para no despertar los
// triggers de la orden; la transacción sobre este doc es lo que hace que
// cuatro aprobaciones seguidas no armen cuatro cotizaciones.
const refAbierta = (ordenId) => db.collection("ordenes_de_servicio").doc(String(ordenId))
  .collection("sistema").doc("reposicion_dano");

/**
 * Administración aprobó CON CARGO → la reposición entra a una cotización: se
 * SUMA a la que la orden tenga en borrador o, si no hay, nace una.
 * Idempotente: el candado `cobro.cotizacion_en_curso` se reserva en
 * transacción ANTES de crear nada (el eco del trigger sobre la misma gestión
 * no puede crear una segunda cotización).
 * @returns {Promise<{docId, cotizacionId, sumada:boolean}|null>}
 */
async function crearCotizacionReposicion(gid) {
  const gRef = db.collection("gestiones").doc(gid);
  const g = await db.runTransaction(async (tx) => {
    const s = await tx.get(gRef);
    if (!s.exists) return null;
    const d = s.data();
    if (!cobraCargo(d) || d.estado !== "pendiente_cliente") return null;
    if (d.cobro?.cotizacion_doc_id || d.cobro?.cotizacion_en_curso) return null;
    tx.update(gRef, { "cobro.cotizacion_en_curso": true });
    return d;
  });
  if (!g) return null;

  const G = require("./gestiones");
  try {
    const monto = montoReposicion(g);
    if (!monto) throw new Error("La gestión no tiene monto de reposición");
    const ordenId = String(g.origen?.orden_id || "");
    const [cliSnap, cfgSnap, firmante, corr] = await Promise.all([
      db.collection("clientes").doc(g.cliente_id).get().catch(() => null),
      db.collection("empresa").doc("config").get().catch(() => null),
      firmanteTaller(),
      pisoCorrelativo(),
    ]);
    const cliente = cliSnap?.exists ? cliSnap.data() : {};
    const validez = Number(cfgSnap?.exists ? cfgSnap.data().cotizacion_validez_dias : 0) || 15;
    const it = (g.items || [])[0] || {};
    const nuevaRef = db.collection("cotizaciones").doc();
    const lockRef = ordenId ? refAbierta(ordenId) : null;
    const FV = admin.firestore.FieldValue;

    const r = await db.runTransaction(async (tx) => {
      // Lecturas primero: el candado de la orden, la cotización abierta y el
      // contador (por si hay que crear).
      const lock = lockRef ? await tx.get(lockRef) : null;
      const abiertaId = lock?.exists ? String(lock.data().cotizacion_doc_id || "") : "";
      const abiertaRef = abiertaId ? db.collection("cotizaciones").doc(abiertaId) : null;
      const abierta = abiertaRef ? await tx.get(abiertaRef) : null;
      const k = correlativoEnTx(tx, corr);
      await k.leer();

      const c = abierta?.exists ? abierta.data() : null;
      const sumable = c && c.estado === "borrador" && c.deleted !== true
        && String(c.clienteId || "") === String(g.cliente_id || "")
        && c.generada_por === "sistema:reposicion_dano";
      if (sumable) {
        const antes = radiosDeCotizacion(c);
        const items = [...(c.items || []).filter((x) => x.id !== `rep-${gid}`), renglonReposicion(g, monto, gid)];
        const patch = {
          items,
          gestion_ids: FV.arrayUnion(...gestionesDe(c), gid),
          ...totalesDeItems({ ...c, items }),
          fecha_modificacion: FV.serverTimestamp(),
        };
        // La introducción se rehace solo si sigue siendo la automática.
        if (c.intro === introReposicion(ordenId, antes)) {
          patch.intro = introReposicion(ordenId, [...antes, { serial: it.serial_saliente || "", modelo: it.modelo || "" }]);
        }
        tx.update(abiertaRef, patch);
        return { docId: abiertaRef.id, cotizacionId: c.cotizacion_id || abiertaRef.id, sumada: true, radios: antes.length + 1 };
      }
      const cotizacionId = k.tomar();
      const doc = docCotizacionReposicion({
        gid, g, cliente, firmante, cotizacionId, fechaIso: hoyPanamaIso(), validezDias: validez, monto,
      });
      tx.set(nuevaRef, { ...doc, fecha_creacion: FV.serverTimestamp(), fecha_modificacion: FV.serverTimestamp() });
      if (lockRef) tx.set(lockRef, { cotizacion_doc_id: nuevaRef.id, cotizacion_id: cotizacionId, actualizado_en: FV.serverTimestamp() });
      return { docId: nuevaRef.id, cotizacionId, sumada: false, radios: 1 };
    });

    await gRef.update({
      "cobro.cotizacion_doc_id": r.docId,
      "cobro.cotizacion_id": r.cotizacionId,
      "cobro.estado": "cotizada",
      "cobro.cotizacion_en_curso": FV.delete(),
    });
    // Enlace en la orden del radio: la pantalla de cotizar la orden y la lista
    // de cotizaciones de la orden la ven como una más.
    if (ordenId && !r.sumada) {
      await db.collection("ordenes_de_servicio").doc(ordenId).set({
        cotizaciones_ids: FV.arrayUnion(r.docId),
      }, { merge: true }).catch((e) => logger.warn("[reposicionDano] orden sin enlace a la cotización", { gid, error: e.message }));
    }
    await G.registrarEvento(gid, "cotizacion_reposicion", r.sumada
      ? `La reposición ($${monto.toFixed(2)} + ITBMS si aplica) se sumó a la cotización ${r.cotizacionId}, que ya estaba en borrador para la orden ${ordenId} (${r.radios} radios en total). La envía la jefatura de taller.`
      : `Cotización ${r.cotizacionId} de la reposición creada en borrador ($${monto.toFixed(2)} + ITBMS si aplica). La envía la jefatura de taller.`);
    await correoCotizacionLista(gid, g, { docId: r.docId, cotizacionId: r.cotizacionId, monto, firmante, sumada: r.sumada, radios: r.radios });
    return r;
  } catch (e) {
    // Se suelta el candado: un reintento del evento puede volver a intentarlo.
    await gRef.update({ "cobro.cotizacion_en_curso": admin.firestore.FieldValue.delete() }).catch(() => {});
    logger.error("[reposicionDano] cotización de reposición NO creada", { gid, error: e.message });
    await G.registrarEvento(gid, "cotizacion_reposicion_error",
      `No se pudo armar la cotización de la reposición: ${e.message}. Hay que cotizarla a mano desde la orden.`);
    return null;
  }
}

async function correoCotizacionLista(gid, g, { docId, cotizacionId, monto, firmante, sumada = false, radios = 1 }) {
  const G = require("./gestiones");
  const { tallerEmailTo } = require("./mailRecipients");
  const it = (g.items || [])[0] || {};
  const to = firmante?.email || await tallerEmailTo();
  if (!to) return;
  const cc = [g.origen?.tecnico_email, await G.vendedorEmailDeCliente(g.cliente_id)]
    .filter(Boolean).filter((e) => e !== to).join(",") || null;
  await G.encolarCorreo({
    to, cc,
    subject: sumada
      ? `Se sumó a ${cotizacionId}: reposición del radio ${it.serial_saliente || "—"} · ${g.cliente_nombre || "Cliente"} (${radios} radios en la misma cotización)`
      : `Enviar al cliente: reposición por daño ${cotizacionId} — radio ${it.serial_saliente || "—"} · ${g.cliente_nombre || "Cliente"}`,
    preheader: sumada
      ? "Otra reposición de la misma orden — va en la cotización que ya estaba en borrador"
      : "Administración aprobó el reemplazo con cargo — la cotización está lista en borrador",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#0B2A47;">${sumada ? "Otro radio en la misma cotización de reposición" : "Cotización de reposición lista para enviar"}</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        Administración aprobó <b>con cargo</b> el reemplazo del radio <b><code>${G.escapeHtml(it.serial_saliente || "—")}</code></b>
        (${G.escapeHtml(it.modelo || "—")}) de <b>${G.escapeHtml(g.cliente_nombre || "—")}</b>, dañado por el cliente
        (gestión <b>${G.escapeHtml(gid)}</b>, orden <b>${G.escapeHtml(g.origen?.orden_id || "—")}</b>).</p>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        ${sumada
          ? `Se agregó como un renglón más ($${Number(monto).toFixed(2)} más ITBMS si aplica) a la cotización <b>${G.escapeHtml(cotizacionId)}</b>,
             que ya estaba en borrador para esa orden: ahora cobra <b>${radios} radios</b>. Una sola cotización para el cliente.`
          : `La cotización <b>${G.escapeHtml(cotizacionId)}</b> por <b>$${Number(monto).toFixed(2)}</b> (más ITBMS si aplica) quedó
             en borrador. Si se aprueban más reposiciones de la misma orden antes de enviarla, se suman a esta.`}
        <b>Revísala y envíala al cliente.</b> Cuando el cliente responda —por correo, por teléfono o en persona—
        márcalo con <b>Respuesta del cliente</b>: si acepta, Bodega recibe el aviso para asignar ${radios > 1 ? "los radios" : "el radio"} de reposición y
        Recepción la fila para facturar; si no acepta, el caso se cierra y pasa a cobranza.</p>`,
    ctaUrl: `${APP_BASE_URL}/cotizaciones/detalle-cotizacion.html?id=${encodeURIComponent(docId)}`,
    ctaLabel: "Abrir la cotización",
    meta: { gestion_id: gid, paso: "cotizacion_reposicion", cotizacion_id: cotizacionId, sumada },
  });
}

/**
 * El cliente ACEPTÓ la cotización de reposición → la gestión sigue a bodega.
 * Solo si sigue esperando al cliente; una gestión anulada o ya liberada no se
 * toca. Acepta cualquier cotización de la gestión (una rehecha con Duplicar
 * también sirve) y deja apuntada la que se aceptó.
 * `gidUnico`: una cotización que cobra varias reposiciones llama una vez por
 * gestión (alAceptarseTodas); sin él vale la primera, como siempre.
 */
async function alAceptarse(docId, cot, gidUnico = null) {
  const gid = String(gidUnico || gestionesDe(cot)[0] || "");
  if (!gid) return null;
  const gRef = db.collection("gestiones").doc(gid);
  const r = await db.runTransaction(async (tx) => {
    const s = await tx.get(gRef);
    if (!s.exists) return { ok: false, motivo: "no_existe" };
    const g = s.data();
    if (g.estado !== "pendiente_cliente") return { ok: false, motivo: g.estado };
    tx.update(gRef, {
      estado: "pendiente_bodega",
      "cierre.cotizacion": true,
      "cobro.estado": "aceptada",
      "cobro.cotizacion_doc_id": docId,
      "cobro.cotizacion_id": cot.cotizacion_id || docId,
      "cobro.aceptada_at": admin.firestore.FieldValue.serverTimestamp(),
      "cobro.aceptacion": {
        medio: cot.aceptacion?.medio || null,
        nota: cot.aceptacion?.nota || "",
        por_email: cot.aceptacion?.por_email || null,
      },
    });
    return { ok: true };
  });
  const G = require("./gestiones");
  await G.registrarEvento(gid, r.ok ? "reposicion_aceptada" : "reposicion_aceptada_ignorada", r.ok
    ? `El cliente aceptó la cotización ${cot.cotizacion_id || docId}: pasa a Bodega para asignar el radio de reposición, y a Facturación pendiente.`
    : `La cotización ${cot.cotizacion_id || docId} se marcó aceptada, pero la gestión ya estaba "${r.motivo}": no se movió nada.`);
  return r;
}

// Una cotización, varias reposiciones: cada gestión avanza (o se cierra) por
// separado y el fallo de una no frena a las demás.
async function porCadaGestion(docId, cot, fn, que) {
  const out = [];
  for (const gid of gestionesDe(cot)) {
    try { out.push({ gid, ...(await fn(docId, cot, gid) || {}) }); }
    catch (e) {
      logger.error(`[reposicionDano] ${que}: la gestión no se movió`, { gid, cotizacion: cot?.cotizacion_id || docId, error: e.message });
      out.push({ gid, ok: false, motivo: "error", error: e.message });
    }
  }
  return out;
}
const alAceptarseTodas = (docId, cot) => porCadaGestion(docId, cot, alAceptarse, "reposición aceptada");
const alRechazarseTodas = (docId, cot) => porCadaGestion(docId, cot, alRechazarse, "reposición rechazada");

/**
 * El cliente NO aceptó → el reemplazo no se hace, la gestión se CIERRA y el
 * daño pasa a cobranza. Solo con la cotización VIGENTE de la gestión: rechazar
 * una copia vieja no puede cerrar un caso que sigue vivo con otra.
 */
async function alRechazarse(docId, cot, gidUnico = null) {
  const gid = String(gidUnico || gestionesDe(cot)[0] || "");
  if (!gid) return null;
  const gRef = db.collection("gestiones").doc(gid);
  const r = await db.runTransaction(async (tx) => {
    const s = await tx.get(gRef);
    if (!s.exists) return { ok: false, motivo: "no_existe" };
    const g = s.data();
    if (g.estado !== "pendiente_cliente") return { ok: false, motivo: g.estado };
    if (g.cobro?.cotizacion_doc_id && g.cobro.cotizacion_doc_id !== docId) return { ok: false, motivo: "otra_cotizacion" };
    tx.update(gRef, {
      estado: "cerrada",
      resultado: "sin_reemplazo_cobranza",
      cerrada_motivo: cot.cierre_motivo || "El cliente no aceptó la cotización de la reposición",
      cerrada_at: admin.firestore.FieldValue.serverTimestamp(),
      "cobro.estado": "cobranza",
      "cobro.rechazada_at": admin.firestore.FieldValue.serverTimestamp(),
    });
    return { ok: true, g };
  });
  const G = require("./gestiones");
  if (!r.ok) {
    if (r.motivo !== "otra_cotizacion") {
      await G.registrarEvento(gid, "reposicion_rechazada_ignorada",
        `La cotización ${cot.cotizacion_id || docId} se marcó rechazada, pero la gestión ya estaba "${r.motivo}": no se movió nada.`);
    }
    return r;
  }
  const g = r.g;
  const it = (g.items || [])[0] || {};
  let cobroId = null;
  try {
    const CE = require("./cobrosEquipos");
    cobroId = await CE.abrirCobro({
      cliente_id: g.cliente_id || "", cliente_nombre: g.cliente_nombre || "",
      serial: it.serial_saliente || "", serial_norm: it.serial_saliente || "",
      pool_doc_id: it.pool_doc_id_saliente || null,
      modelo_id: it.modelo_id || "", modelo_label: it.modelo || "",
      motivo_codigo: "dano_cliente",
      motivo_detalle: `Daño causado por el cliente — no aceptó la reposición (${cot.cotizacion_id || docId}).`
        + (cot.cierre_motivo ? ` ${cot.cierre_motivo}` : ""),
      por_email: "system:reposicion_dano",
      gestion_id: gid, orden_id: g.origen?.orden_id || "", cotizacion_id: cot.cotizacion_id || "",
      monto_unit_aprobado: montoReposicion(g),
    });
    if (cobroId) await gRef.update({ "cobro.cobro_equipo_id": cobroId });
  } catch (e) {
    logger.error("[reposicionDano] renglón de cobranza NO abierto", { gid, error: e.message });
  }
  await G.registrarEvento(gid, "reposicion_rechazada",
    `El cliente no aceptó la cotización ${cot.cotizacion_id || docId}. El reemplazo no se hace; la gestión se cierra`
    + ` y el daño pasa a cobranza${cobroId ? " (Almacén · No devueltos / cobros)" : " — el renglón de cobranza NO se abrió: revisar a mano"}.`);
  await correoRechazo(gid, g, cot, cobroId).catch((e) =>
    logger.warn("[reposicionDano] correo de rechazo no encolado", { gid, error: e.message }));
  return { ok: true, cobroId };
}

async function correoRechazo(gid, g, cot, cobroId) {
  const G = require("./gestiones");
  const { tallerEmailTo } = require("./mailRecipients");
  const it = (g.items || [])[0] || {};
  const cc = [g.origen?.tecnico_email, await G.vendedorEmailDeCliente(g.cliente_id), await tallerEmailTo()]
    .flatMap((e) => String(e || "").split(",")).map((e) => e.trim()).filter(Boolean);
  await G.encolarCorreo({
    to: await G.aprobacionesTo(),
    cc: [...new Set(cc)].join(",") || null,
    subject: `Reposición no aceptada → cobranza: radio ${it.serial_saliente || "—"} — ${g.cliente_nombre || "Cliente"} (${gid})`,
    preheader: "El cliente no aceptó pagar la reposición del radio que dañó",
    bodyContent: `
      <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#991B1B;">El cliente no aceptó la reposición</h2>
      <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
        <b>${G.escapeHtml(g.cliente_nombre || "—")}</b> no aceptó la cotización <b>${G.escapeHtml(cot.cotizacion_id || "—")}</b>
        por la reposición del radio <b><code>${G.escapeHtml(it.serial_saliente || "—")}</code></b> (${G.escapeHtml(it.modelo || "—")}).</p>
      <ul style="margin:0 0 12px;padding-left:18px;font:14px/1.6 Arial,sans-serif;">
        <li><b>No se repone el radio</b>: Bodega no recibió ni recibirá el aviso.</li>
        <li>La gestión <b>${G.escapeHtml(gid)}</b> quedó <b>cerrada</b>.</li>
        <li>El daño ${cobroId ? "quedó abierto en <b>cobranza</b> por $" + Number(montoReposicion(g) || 0).toFixed(2) + " (más ITBMS si aplica)" : "debe abrirse a mano en cobranza (el sistema no pudo hacerlo)"}.</li>
        <li>El radio dañado sigue su curso en la orden <b>${G.escapeHtml(g.origen?.orden_id || "—")}</b>.</li>
      </ul>`,
    ctaUrl: G.urlGestion(g, gid),
    ctaLabel: "Ver el expediente",
    meta: { gestion_id: gid, paso: "reposicion_rechazada", cotizacion_id: cot.cotizacion_id || "" },
  });
}

/**
 * La gestión se ANULÓ con la cotización todavía viva.
 *   · Era su única reposición → la cotización se descarta con el motivo, para
 *     que nadie la envíe ni la marque aceptada.            → 'descartada'
 *   · La cotización cobra otras reposiciones y sigue en borrador → se le quita
 *     el renglón de esta y se recalcula.                   → 'renglon_quitado'
 *   · Cobra otras y YA SALIÓ al cliente → no se toca (cambiarle el monto a un
 *     documento enviado sería peor): hay que rehacerla.     → 'enviada_con_otras'
 * @returns {Promise<false|'descartada'|'renglon_quitado'|'enviada_con_otras'>}
 */
async function alAnularse(gid, g) {
  const docId = g?.cobro?.cotizacion_doc_id;
  if (!docId) return false;
  const ref = db.collection("cotizaciones").doc(docId);
  const FV = admin.firestore.FieldValue;
  return db.runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (!s.exists) return false;
    const c = s.data();
    if (!["borrador", "enviada", "aprobada", "vencida"].includes(String(c.estado || ""))) return false;
    const otras = gestionesDe(c).filter((x) => x !== gid);
    if (!otras.length) {
      tx.update(ref, {
        estado: "descartada",
        cierre_motivo: `Se anuló la gestión ${gid}${g.anulada_motivo ? `: ${g.anulada_motivo}` : ""}`.slice(0, 300),
        fecha_descarte: admin.firestore.Timestamp.now(),
        descartada_por_uid: "system",
      });
      return "descartada";
    }
    if (c.estado !== "borrador") return "enviada_con_otras";
    const serial = String((g.items || [])[0]?.serial_saliente || "").trim();
    const antes = radiosDeCotizacion(c);
    const items = (c.items || []).filter((x) => x.id !== `rep-${gid}`
      && !(x.id === "rep1" && String(c.gestion_id || "") === gid)
      && !(serial && String(x?.equipo?.serial || "").trim() === serial));
    const patch = {
      items,
      gestion_id: otras[0],
      gestion_ids: otras,
      ...totalesDeItems({ ...c, items }),
      fecha_modificacion: FV.serverTimestamp(),
    };
    if (c.intro === introReposicion(c.orden_id, antes)) patch.intro = introReposicion(c.orden_id, radiosDeCotizacion({ items }));
    tx.update(ref, patch);
    return "renglon_quitado";
  });
}

/**
 * La reposición YA ESTABA COTIZADA en otra cotización de la misma orden
 * (2026-11-19, WESTIN: la jefa de taller cotizó a mano los cuatro radios y
 * después cada reemplazo aprobado armó la suya). Las gestiones de las
 * cotizaciones `origen` pasan a cobrarse en `destino`, y las de origen se
 * descartan con el motivo — sin cerrar las gestiones ni mandar nada a
 * cobranza (descartar no es rechazar). Al aceptarse la de destino, todas sus
 * gestiones siguen a bodega.
 * @returns {Promise<{destino:string, gestiones:string[], descartadas:string[]}>}
 */
async function unirACotizacion({ origenDocIds = [], destinoDocId, porEmail = "system", execute = true }) {
  const col = db.collection("cotizaciones");
  const dSnap = await col.doc(String(destinoDocId)).get();
  if (!dSnap.exists) throw new Error("La cotización de destino no existe");
  const dest = dSnap.data();
  if (!["borrador", "enviada", "aprobada"].includes(String(dest.estado || ""))) {
    throw new Error(`La cotización de destino está "${dest.estado}": tiene que estar viva`);
  }
  if (dest.cobro_equipo_id) throw new Error("La cotización de destino es de un equipo no devuelto");
  const legDest = dest.cotizacion_id || dSnap.id;
  const gestiones = [];
  const descartar = [];
  for (const id of origenDocIds) {
    const s = await col.doc(String(id)).get();
    if (!s.exists) throw new Error(`La cotización ${id} no existe`);
    const c = s.data();
    if (s.id === dSnap.id) throw new Error("Origen y destino son la misma cotización");
    if (String(c.orden_id || "") !== String(dest.orden_id || "")) throw new Error(`${c.cotizacion_id || id} es de otra orden`);
    if (String(c.clienteId || "") !== String(dest.clienteId || "")) throw new Error(`${c.cotizacion_id || id} es de otro cliente`);
    if (!["borrador", "enviada", "aprobada", "vencida"].includes(String(c.estado || ""))) throw new Error(`${c.cotizacion_id || id} está "${c.estado}"`);
    const gs = gestionesDe(c);
    if (!gs.length) throw new Error(`${c.cotizacion_id || id} no es una cotización de reposición`);
    for (const gid of gs) {
      const g = await db.collection("gestiones").doc(gid).get();
      if (!g.exists || g.data().estado !== "pendiente_cliente") {
        throw new Error(`La gestión ${gid} no está esperando al cliente (${g.exists ? g.data().estado : "no existe"})`);
      }
      gestiones.push(gid);
    }
    descartar.push({ ref: s.ref, legible: c.cotizacion_id || s.id });
  }
  const res = { destino: legDest, gestiones, descartadas: descartar.map((d) => d.legible) };
  if (!execute || !gestiones.length) return res;

  const FV = admin.firestore.FieldValue;
  const batch = db.batch();
  batch.update(dSnap.ref, { gestion_ids: FV.arrayUnion(...gestionesDe(dest), ...gestiones), fecha_modificacion: FV.serverTimestamp() });
  for (const d of descartar) {
    batch.update(d.ref, {
      estado: "descartada",
      cierre_motivo: `Duplicada: la reposición ya estaba cotizada en ${legDest}`,
      fecha_descarte: admin.firestore.Timestamp.now(),
      descartada_por_uid: "system",
      unida_a: { cotizacion_doc_id: dSnap.id, cotizacion_id: legDest, por_email: porEmail },
    });
  }
  for (const gid of gestiones) {
    batch.update(db.collection("gestiones").doc(gid), {
      "cobro.cotizacion_doc_id": dSnap.id,
      "cobro.cotizacion_id": legDest,
      "cobro.estado": "cotizada",
    });
  }
  await batch.commit();
  const G = require("./gestiones");
  for (const gid of gestiones) {
    await G.registrarEvento(gid, "cotizacion_reposicion_unida",
      `La reposición se cobra en la cotización ${legDest}, que ya la incluía; la cotización automática se descartó por duplicada (${porEmail}). Sigue esperando la respuesta del cliente.`);
  }
  return res;
}

module.exports = {
  TIPOS_DANO, esReposicionDano, cobraCargo, montoReposicion, totalesReposicion,
  renglonReposicion, docCotizacionReposicion, hoyPanamaIso, introReposicion,
  siguienteCotizacionId, firmanteTaller, gestionesDe,
  crearCotizacionReposicion, alAceptarse, alRechazarse, alAnularse,
  alAceptarseTodas, alRechazarseTodas, unirACotizacion,
};
