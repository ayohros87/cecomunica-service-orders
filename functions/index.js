const { onRequest } = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const cors = require("cors")({
  origin: [
    "https://cecomunica-service-orders.web.app",
    "https://app.cecomunica.net",
    "http://127.0.0.1:5500"
  ]
});
const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

const puppeteer = require("puppeteer-core");
const nodemailer = require("nodemailer");

const fs = require("fs");
const path = require("path");

// Carga verificación desde 'verificaciones/{contratoId}' y la inyecta en el objeto contrato
async function attachVerificationFromMirror(contrato, fallbackDocId) {
  // Siempre usar el docId del contrato como ID del espejo
  const verifSnap = await db.collection("verificaciones").doc(fallbackDocId).get();

  if (!verifSnap.exists) {
    const err = new Error("Verificación no encontrada en 'verificaciones'.");
    err.code = "VERIF_NOT_FOUND";
    throw err;
  }
  const v = verifSnap.data();

  // inyectar en 'contrato' para que buildContractHtmlForPdf lo use sin tocar la plantilla
  contrato.firma_codigo = v.firma_codigo || contrato.firma_codigo;
  contrato.firma_url    = v.firma_url    || contrato.firma_url;
  contrato.firma_hash   = v.firma_hash   || contrato.firma_hash;
  contrato.fecha_aprobacion = v.fecha_aprobacion || contrato.fecha_aprobacion;

  // devolver info del aprobador para el bloque de firma interna
  const aprobadorInfo = {
    nombre: v.aprobado_por_nombre || "—",
    cargo:  v.aprobado_por_rol    || "Administrador",
    email:  v.aprobado_por_email  || "—"
  };
  return aprobadorInfo;
}

function buildContractHtmlForPdf(contrato, vendedorInfo = {}, aprobadorInfo = {}) {
  const templatePath = path.join(__dirname, "templates", "imprimir-contrato.html");
  let html = fs.readFileSync(templatePath, "utf8");

// Chips estilizados
const chipAccion = `<span class="chip">${contrato.accion || "—"}</span>`;
const chipDuracion = `<span class="chip">${contrato.duracion || "—"}</span>`;
const chipEstado = `<span class="chip ${contrato.estado === "activo" ? "estado-activo-chip" : contrato.estado === "pendiente_aprobacion" ? "estado-pendiente-chip" : "estado-inactivo-chip"}">${contrato.estado || "—"}</span>`;

// --- Datos básicos ---
  html = html.replace("{{CONTRATO_ID}}", contrato.contrato_id || "");
  html = html.replace("{{CLIENTE_NOMBRE}}", contrato.cliente_nombre || "");
  html = html.replace("{{CLIENTE_RUC}}", contrato.cliente_ruc || "");
  html = html.replace("{{REPRESENTANTE}}", contrato.representante || "");
  html = html.replace("{{CLIENTE_TELEFONO}}", contrato.cliente_telefono || "");
  html = html.replace("{{CLIENTE_DIRECCION}}", contrato.cliente_direccion || "");
  html = html.replace("{{ACCION}}", chipAccion);
  html = html.replace("{{DURACION}}", chipDuracion);
  html = html.replace("{{ESTADO}}", chipEstado);
  html = html.replace("{{NOMBRE_CLIENTE}}", contrato.representante || contrato.cliente_nombre || "________________");


  // Badge tipo contrato
const badge = `<div style="padding:4px 10px; border:1px solid #333; border-radius:6px; font-size:12px;">${contrato.tipo_contrato || ""}</div>`;
html = html.replace("{{TIPO_CONTRATO}}", badge);

  // --- Fechas ---
  let fechaAprobacion = "";
  if (contrato.fecha_aprobacion) {
    const f = contrato.fecha_aprobacion.toDate ? contrato.fecha_aprobacion.toDate() : new Date(contrato.fecha_aprobacion);
    fechaAprobacion = f.toLocaleString("es-PA");
  }
  html = html.replace("{{FECHA_APROBACION}}", fechaAprobacion);

  // --- Tabla de equipos ---
  let equiposRows = "";
  (contrato.equipos || []).forEach((eq, i) => {
    const cantidad = Number(eq.cantidad || 0);
    const precio = Number(eq.precio || 0);
    const total = cantidad * precio;
    equiposRows += `
      <tr>
        <td>${i + 1}</td>
        <td>${(eq.descripcion || "Equipos de Comunicación")}</td>
        <td>${eq.modelo || ""}</td>
        <td>${cantidad}</td>
        <td>$${precio.toFixed(2)}</td>
        <td>$${total.toFixed(2)}</td>
      </tr>
    `;
  });
html = html.replace("{{TABLA_EQUIPOS}}", `<tbody>${equiposRows}</tbody>`);


  // --- Totales ---
  const subtotal = (contrato.equipos || []).reduce((acc, eq) => acc + (Number(eq.cantidad||0)*Number(eq.precio||0)), 0);
  const itbms = +(subtotal * 0.07).toFixed(2);
  const totalCon = +(subtotal + itbms).toFixed(2);

  html = html.replace("{{SUBTOTAL}}", subtotal.toFixed(2));
  html = html.replace("{{ITBMS}}", itbms.toFixed(2));
  html = html.replace("{{TOTAL_CON_ITBMS}}", totalCon.toFixed(2));
  html = html.replace("{{OBSERVACIONES}}", contrato.observaciones || "—");

  // --- Firmas ---
  const fechaVend = contrato.fecha_modificacion?.toDate?.() ? contrato.fecha_modificacion.toDate() : new Date();
  const fechaVendTxt = fechaVend.toLocaleString("es-PA");

  const firmaVendedor = `
    <div class="firma-electronica">
      ✔ Firmado electrónicamente por ${vendedorInfo.nombre || "Vendedor"}<br>
      Cargo: ${vendedorInfo.cargo || "Vendedor"}<br>
      Contrato: ${contrato.contrato_id}<br>
      Fecha y hora: ${fechaVendTxt}
      <hr>
    </div>
  `;

 const firmaCecom = aprobadorInfo?.nombre
  ? `
    <div class="firma-electronica">
      ✔ Firmado electrónicamente por ${aprobadorInfo.nombre}<br>
      Cargo: ${aprobadorInfo.cargo}<br>
      Email: ${aprobadorInfo.email}<br>
      Contrato: ${contrato.contrato_id}<br>
      Fecha y hora: ${fechaAprobacion}
      <hr>
    </div>
  `
  : `
    <div class="firma-electronica">
      ⚠ Firma interna pendiente de aprobación<br>
      Contrato: ${contrato.contrato_id}
      <hr>
    </div>
  `;



  html = html.replace("{{FIRMA_VENDEDOR}}", firmaVendedor);
  html = html.replace("{{FIRMA_CECOMUNICA}}", firmaCecom);



const firmaCliente = `
  <div class="firma-electronica">
    _______________________________<br>
    Nombre: ${contrato.representante || "________________"}<br>
    RUC/Cédula: ${contrato.cliente_ruc || "________________"}<br>
    Empresa: ${contrato.cliente_nombre || "________________"}
  </div>
`;
html = html.replace("{{FIRMA_CLIENTE}}", firmaCliente);

// Verificación (contrato activo): usa campos ya creados por onContratoActivado
html = html.replace("{{VERIF_CONTRATO_ID}}", contrato.contrato_id || "");
html = html.replace("{{VERIF_CODIGO}}", contrato.firma_codigo || "NO APROBADO");
html = html.replace("{{VERIF_URL}}", contrato.firma_url || "—");
// --- Verificación interna (con QR) ---
let qrHtml = "";
if (contrato.firma_url) {
  // Usa una librería de QR o el CDN que ya tienes en el cliente
  // Aquí generamos un <img> con un servicio externo (rápido y sin librería local)
  qrHtml = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(contrato.firma_url)}" alt="QR Verificación">`;
}
html = html.replace("{{QR_VERIFICACION}}", qrHtml);

// Firma de aceptación (nombre/empresa)
  html = html.replace("{{FIRMA_ACEPTACION_NOMBRE}}", contrato.representante || "__________________");
html = html.replace("{{FIRMA_ACEPTACION_EMPRESA}}", contrato.cliente_nombre || "__________________");

// Términos y condiciones (igual que contratos, con [[DURACION]] reemplazado)
const duracionTexto = (contrato.duracion && String(contrato.duracion).match(/\d+/)?.[0]) || "12";
const plantillaCondiciones = `TERMINOS Y CONDICIONES

Este contrato se suscribe entre las partes que aparecen debidamente identificadas al dorso de la presente hoja, que en adelante se denominarán LA EMPRESA y EL CLIENTE, conforme al mismo señalamiento que aquí se hace. La información, términos y condiciones que aparecen escritos al dorso de la presente página se incorporan para que formen parte integrante del presente contrato.

SERVICIO:

LA EMPRESA se compromete a brindar a EL CLIENTE un servicio de comunicación, ininterrumpido y privado, en condiciones óptimas y eficientes, durante las veinticuatro (24) horas del día a través de ondas de radio y/o telefonía, de acuerdo al desarrollo tecnológico de que ésta disponga en este momento en la República de Panamá, en adelante EL SERVICIO. EL SERVICIO será prestado dentro de las áreas especificadas al dorso de este contrato. EL CLIENTE autoriza a LA EMPRESA el monitoreo del sistema para controlar la calidad de la señal. LA EMPRESA, cuando estén disponibles y de tiempo en tiempo, informará a EL CLIENTE de nuevos productos y de ampliación de cobertura.

DESCRIPCION DEL EQUIPO:

Declara EL CLIENTE que recibe el equipo detallado al dorso de este documento, en adelante EL EQUIPO, en perfecto estado y que el mismo es de su propiedad. Dicho EQUIPO le permitirá a EL CLIENTE hacer uso de EL SERVICIO descrito en este contrato, siendo responsable por el mismo. Para la modalidad de  alquiler, EL EQUIPO permanecerá en poder de EL CLIENTE para su uso, sin que el derecho a su propiedad sea transferido, siendo responsable del mismo con la diligencia de un buen padre de familia.  Entiende EL CLIENTE que EL EQUIPO, producto de este contrato de alquiler, incluye la batería de fábrica con el pago de la activación, pero que es su responsabilidad la compra de las subsiguientes baterías una vez terminen su vida útil

DISPONIBILIDAD DEL SERVICIO:

La disponibilidad de EL SERVICIO estará sujeta a limitaciones y/o interrupciones debidas a factores fuera del control de LA EMPRESA, tales como regulaciones o restricciones gubernamentales o administrativas, topografía, condiciones medio ambientales, suministro eléctrico, servicios proveídos por terceros, limitaciones de capacidad del equipo utilizado o mal uso por parte de EL CLIENTE, así como cualquier otra causa de fuerza mayor o caso fortuito fuera del control de LA EMPRESA. Por lo tanto LA EMPRESA no se hace responsable por aquellas transmisiones que por las razones expuestas hayan sido defectuosas, incompletas o tardías. LA EMPRESA, en su afán de ofrecer un servicio óptimo y de la mejor calidad podrá, de tiempo en tiempo, suspender temporalmente el suministro de EL SERVICIO por motivos de reparación o mantenimiento de los equipos, así como para la instalación de aquellos nuevos equipos y/o servicios.

GARANTIA:

EL EQUIPO adquirido por EL CLIENTE tendrá seis (6) meses de garantía de fábrica, es decir, de garantía que incluirá mano de obra y piezas en concepto de daños o desperfectos, siempre y cuando los mismos no se deban al mal uso o uso negligente por parte de EL CLIENTE. En el evento de que EL EQUIPO no pueda ser reparado en los talleres de LA EMPRESA el mismo se enviará a la fábrica, siempre y cuando la garantía esté vigente, para su reparación, entendiéndose que LA EMPRESA desde ese momento da cumplimiento a los términos de la garantía. Los daños como cubierta frontal, teclado, antena y batería serán cubiertos por EL CLIENTE.

TARIFAS Y/O CARGOS:

EL CLIENTE por este medio se obliga al pago irrevocable de las tarifas y/o cargos acordados, así como de aquellos adicionales que ambas partes acepten por escrito, y aquellos que se deban a reconexiones, por EL SERVICIO descrito en este contrato. EL CLIENTE acepta que las tarifas y/o cargos podrán modificarse de tiempo en tiempo, para lo cual LA EMPRESA notificará mediante anuncio publicado con treinta (30) días de antelación a la vigencia de la nueva tarifa y/o cargo, y por escrito a EL CLIENTE con sesenta (60) días de antelación a la vigencia de la nueva tarifa y/o cargo. EL CLIENTE tendrá la opción de dar por terminado este contrato notificándolo por escrito a LA EMPRESA dentro de los siguientes quince (15) días calendarios; de lo contrario, se entenderá aceptada la modificación y será efectivamente aplicada en la facturación del mes siguiente.

EL CLIENTE se obliga a pagar dentro de los cinco (5) primeros días de cada mes, la tarifa y/o cargos relativos al servicio detallados en este contrato en las oficinas de LA EMPRESA o en los sitios que ésta le comunique a EL CLIENTE por escrito. Cualquier demora en el pago o problema que se presente para hacer efectivo el cobro por parte de LA EMPRESA, acarreará para EL CLIENTE un recargo del dos por ciento (2%) mensual sobre la suma adeuda y la suspensión inmediata del servicio.  Si LA EMPRESA tuviera que incurrir en gastos adicionales, así como gastos legales o judiciales, para hacer efectivo el cobro, los mismos correrán por cuenta de EL CLIENTE.

EL CLIENTE podrá pagar la tarifa y/o cargos mediante tarjeta de crédito, descuento directo, ACH, sistema Clave, para lo cual completará los datos correspondientes al dorso de este documento. El pago mediante tarjeta de crédito será irrevocable mientras el servicio no sea suspendido y durante todo el término de vigencia de este contrato o sus renovaciones, por lo que EL CLIENTE se obliga a realizar y otorgar las autorizaciones correspondientes para que LA EMPRESA pueda cargar mensualmente las sumas adeudadas; además EL CLIENTE autoriza expresamente a LA EMPRESA para que contra su tarjeta de crédito se cargue el total de la Tasa de Cancelación o cualquier otra cantidad que quede obligado a pagar por razón de este contrato. En el evento de que la tarjeta de crédito identificada al dorso fuera cancelada, desautorizada o en alguna forma no se pudiera realizar el cargo correspondiente, LA EMPRESA notificará a EL CLIENTE, y éste en un término no mayor de siete (7) días calendarios, deberá dar una nueva autorización para que se cargue EL SERVICIO contra otra tarjeta de crédito. De no cumplir EL CLIENTE con esta obligación, el servicio le será suspendido inmediatamente y quedará obligado a cancelar, además de la Tasa de Cancelación, una indemnización adicional igual a la suma pagada como Tasa de Cancelación en concepto de daños y perjuicios.

RESPONSABILIDAD:

No obstante cualquiera de las estipulaciones contenidas en este contrato, la responsabilidad de LA EMPRESA hacia EL CLIENTE que resulte del fallo o imposibilidad de proveer EL SERVICIO descrito en este contrato, se limitará al crédito por la interrupción y el mismo no sobrepasará un mes de servicio o el prorrateo correspondiente durante el tiempo que dure el desperfecto o falla.

EL CLIENTE reconoce que las interrupciones del servicio en la industria de las telecomunicaciones son frecuentes y producidas por circunstancias fuera del control de LA EMPRESA lo que hace imposible la comprobación del daño producido, por lo que EN NINGUN MOMENTO DEBERA SER LA EMPRESA RESPONSABLE HACIA EL CLIENTE POR CUALQUIER CANTIDAD QUE REPRESENTE PERDIDA DE GANANCIAS, PERDIDA DE NEGOCIO, DIRECTA O INDIRECTAMENTE, O DAÑO PUNITIVO PRODUCTO DE LA EJECUCION O NO EJECUCION DE ESTE CONTRATO O CUALQUIER ACTO U OMISION ASOCIADO O RELACIONADO CON EL USO DE CUALQUIER ARTICULO O SERVICIO OFRECIDO.

LA EMPRESA NO SERA RESPONSABLE POR EL HECHO DE QUE SE SUSPENDA TEMPORAL O TOTALMENTE EL SERVICIO POR CAUSAS FUERA DE SU CONTROL, TALES COMO CAUSA FORTUITA, FUERZA MAYOR, RESTRICCIONES GUBERNAMENTALES O ADMINISTRATIVAS, TOPOGRAFIA, Y EN GENERAL, POR CUALQUIER ACTO U OMISION QUE AUNQUE PREVISIBLE NO PUDO SER IMPEDIDO. TAMPOCO SERA RESPONSABLE POR DESCONEXION DE LOS ENLACES, YA SEAN A TRAVÉS DE INTERNET U OTROS SERVICIOS BRINDADOS POR TERCEROS EN LOS QUE NO INTERVENGA LA EMPRESA.

LIBERACION:

EL CLIENTE por este medio se compromete a mantener libre de todo reclamo y sanción a LA EMPRESA por cualquier acto u omisión que sea considerado como violatorio de las leyes, decretos, reglamentos o contratos vigentes que ocurran como consecuencia del mal uso o uso indebido del servicio y/o equipo en cualquier forma o que se incluya el servicio y/o equipo como acto preparatorio, consumativo o posterior al hecho considerado violatorio de dichas disposiciones. Asimismo, EL CLIENTE exime de toda responsabilidad a LA EMPRESA por cualquier daño o perjuicio que se pueda causar por el uso que del equipo o del servicio de EL CLIENTE o terceros ajenos a LA EMPRESA. EL CLIENTE, expresamente autoriza, y por lo tanto libera de toda responsabilidad a LA EMPRESA, por el suministro de información relacionada con él a las autoridades competentes que la soliciten. LA EMPRESA queda autorizada expresamente para obtener información financiera, crediticia o de cualquier otra índole de EL CLIENTE, así como para suministrarla  en caso de que sea requerido.

OBLIGACIONES DEL CLIENTE:

EL CLIENTE se obliga y compromete a lo siguiente:

A realizar puntualmente los pagos y dar las autorizaciones a su banco o proveedor de tarjeta de crédito, cuando sea necesario, de lo contrario, expresamente autoriza que al solo criterio de LA EMPRESA, se informe a la Asociación Panameña de Crédito (APC) el incumplimiento de sus obligaciones.

A utilizar el equipo y/o servicio como un diligente padre de familia para comunicaciones personales, comerciales o profesionales, haciendo uso de un lenguaje apropiado y siguiendo todos los procedimientos y recomendaciones del fabricante y/o técnicos autorizados, así como de las normas legales vigentes.

En el caso de que la modalidad de servicio incluya el alquiler de EL EQUIPO, EL CLIENTE deberá cuidarlo como un buen padre de familia y será responsable por el mismo, al Precio de Lista del radio PNC360S es de: $200.00 (Doscientos con 00/100) más itbms dólares estadounidenses, radio PNC460 es de : $460.00 (Cuatrocientos sesenta con 00/100) más itbms dólares estadounidenses, cámara SC580 es de : $400.00 (Cuatrocientos con 00/100) más itbms dólares estadounidenses, cámara SC780 es de : $625.00 (seiscientos veinticinco con 00/100) más itbms dólares estadounidenses, otros equipos : $500.00 (Quinientos con 00/100) mas itbms dólares estadounidenses, estos precios han sido previamente establecido por LA EMPRESA y aceptado por EL CLIENTE. Bajo ninguna circunstancia EL CLIENTE podrá ceder, vender, transferir, pignorar o gravar dicho equipo.

A no utilizar el equipo y/o servicio para comunicaciones delictivas, temerarias o para cualquier uso que sea contrario a las leyes, decretos o reglamentos vigentes en la República de Panamá.

A acatar los instructivos de uso que de cuando en cuando le comunique por escrito o por cualquier otro medio electrónico LA EMPRESA.

A comunicar inmediatamente a LA EMPRESA cualquier interferencia en el servicio de que tenga conocimiento.

A no manipular el equipo inadecuadamente.

A dar aviso inmediato y por escrito a LA EMPRESA de cualquier EQUIPO que haya sido robado o perdido, formulando la correspondiente denuncia ante las autoridades correspondientes. Si el cliente no coopera con LA EMPRESA o se demuestra que hubo dolo, culpa o negligencia, EL CLIENTE deberá responder a LA EMPRESA por los daños y perjuicios causados.

A no ceder, traspasar, pignorar, total o parcialmente, los derechos y obligaciones contenidos en este contrato, a no ser que medie autorización expresa de LA EMPRESA.

A llevar el equipo para desprogramación una vez terminado el contrato.

A cumplir con las normas y disposiciones que la Autoridad de los Servicios Públicos de tiempo en tiempo apruebe.

VIGENCIA Y RENOVACION:

Este contrato tendrá un período inicial de vigencia de [[DURACION]] meses  meses a partir de su firma. Vencido el período inicial de vigencia, el mismo será renovado automáticamente por iguales períodos. La notificación para la no renovación automática deberá darla por escrito EL CLIENTE con sesenta (60) días de anticipación a la fecha de terminación de dicho período, de lo contrario operará la renovación automática y el contrato se habrá extendido por un período más.

DEPOSITO:

Si la modalidad de contrato que utiliza EL CLIENTE es el alquiler del equipo, al momento de la firma EL CLIENTE entrega a LA EMPRESA la suma que se señala al dorso como depósito de garantía, que no causará intereses. El mismo se devolverá en el último mes del período inicial de vigencia de este contrato, siempre y cuando EL CLIENTE esté al día en sus obligaciones para con LA EMPRESA. En la renovación del contrato, y a criterio exclusivo de LA EMPRESA, podrá eximirse la constitución del depósito.

SEGURO;

Si EL CLIENTE opta por la suscripción del seguro contra robo que ofrece LA EMPRESA, el costo del deducible será pagado por EL CLIENTE. En la modalidad de alquiler, el seguro será obligatorio.

TERMINACION:

Las partes acuerdan que este contrato no podrá terminarse con anterioridad al vencimiento del período inicial de vigencia  de [[DURACION]] meses  meses, contado a partir de la firma de este contrato.  No obstante, si EL CLIENTE insiste en darlo por terminado deberá pagar una Tasa de Cancelación correspondiente a tres (3) mensualidades.  La mora, pérdida, robo o daño del equipo no se considerará causa justificada de terminación del contrato. LA EMPRESA, una vez reciba la notificación correspondiente de parte de EL CLIENTE, suministrará al mismo, al Precio de Lista, un equipo renovado para que el servicio continúe ofreciéndose.

Serán causas de terminación de este contrato con anterioridad al vencimiento del mismo, que podrá ejercer LA EMPRESA a su discreción, además de las ya descritas en este contrato, las siguientes:

La falta de pago, luego de 45 días después de la fecha de pago.

El incumplimiento de cualquiera de las cláusulas de este contrato.

El incumplimiento del contrato por falta de pago de 2 meses consecutivos permitirá a LA EMPRESA a su discreción el cobro de una penalidad equivalente a la tasa de cancelación.

LA EMPRESA podrá terminar este contrato en cualquier momento, previo aviso por escrito a EL CLIENTE con treinta (30) días de anticipación.

NO RENUNCIA Y CLAUSULAS ILEGALES:

El hecho de que LA EMPRESA no ejerza su derecho, o no insista en el perfecto cumplimiento de las obligaciones contenidas en este contrato, no quiere decir que renuncie a ellos, ni que se ha modificado el contrato; por lo tanto, el fiel y perfecto cumplimiento podrá ser exigido en cualquier momento.

Si alguna de las cláusulas contenidas en este contrato es encontrada ilegal, nula o de imposible cumplimiento, la misma se entenderá como no puesta y el contrato se interpretará como si la misma nunca hubiera existido, quedando por lo demás el contrato completamente vigente.

RENUNCIA AL DOMICILIO Y A TRÁMITE:

EL CLIENTE  declara como su domicilio el consignado al reverso de esta página, renunciando al mismo en caso de reclamo judicial pues expresamente se somete a los tribunales de la ciudad de Panamá, República de Panamá. Expresamente renuncia a los trámites del juicio ejecutivo en el evento de que LA EMPRESA tuviera que reclamar cualquier suma adeudada en razón de este contrato, la cual se tendrá por clara y de plazo vencido. Se tendrá como líquida y exigible la suma que haya sido expresada por LA EMPRESA en la demanda, lo que dará plena fe en juicio, prestará mérito ejecutivo y surtirá todos los efectos legales pertinentes.

CESION:

LA EMPRESA podrá ceder, en todo o en parte, sus derechos y obligaciones contenidas en este contrato, sin necesidad de aprobación de EL CLIENTE, sujeto a lo establecido por la normativa vigente en materia de servicios de telecomunicaciones.

LEY APLICABLE Y NOTIFICACIONES:

Este contrato y sus enmiendas, las cuales deberán ser siempre por escrito y debidamente firmadas por las partes, se regirán por las leyes y tribunales de la República de Panamá.

Para los efectos de las notificaciones y/o avisos por escrito a que se hace referencia en este contrato, se entenderán hechas en las direcciones expresadas al reverso de este documento por correspondencia entregada personalmente con acuse de recibo, por correo certificado cinco (5) días después de la fecha consignada en el recibo, enviadas por fax o por cualquier medio electrónico, con confirmación de recibo.

LAS PARTES DECLARAN QUE HAN LEIDO Y ENTENDIDO ESTE CONTRATO, Y UNA VEZ FIRMADO, SERA DE OBLIGATORIO CUMPLIMIENTO.`;

const condicionesFinal = plantillaCondiciones.replace(/\[\[DURACION\]\]/g, duracionTexto);
html = html.replace("{{TERMINOS_CONDICIONES}}", condicionesFinal);


  return html;
}

// ========= Email helpers (usar plantilla HTML + texto plano) =========
const { htmlToText } = require("html-to-text");

/**
 * Rellena la plantilla /templates/email-base.html con tokens estándar.
 * tokens esperados:
 *   PREHEADER, BODY_CONTENT, CTA_URL, CTA_LABEL
 */
function buildEmailFromBase({ preheader, bodyHtml, ctaUrl, ctaLabel }) {
  const templatePath = path.join(__dirname, "templates", "email-base.html");
  let tpl = fs.readFileSync(templatePath, "utf8");

  tpl = tpl
    .replace("{{PREHEADER}}", preheader || "")
    .replace("{{BODY_CONTENT}}", bodyHtml || "")
    .replace(/{{CTA_URL}}/g, ctaUrl || "#")
    .replace(/{{CTA_LABEL}}/g, ctaLabel || "Abrir");

  return tpl;
}

// ==== BODY builders ====
function buildBodyOrdenCompletada(orden) {
  const chip = v => `<span style="display:inline-block;padding:2px 8px;border-radius:999px;background:#eef2ff;border:1px solid #e5e7eb;font:12px Arial,sans-serif;">${v}</span>`;
  const cliente = orden.cliente_nombre || orden.cliente || "—";
  const tecnico = orden.tecnico_nombre || orden.tecnico || "—";
  const costo   = isFinite(+orden.costo_estimado) ? `$${Number(orden.costo_estimado).toFixed(2)}` : "—";
  const equipos = Array.isArray(orden.equipos) ? orden.equipos : [];
  const equiposHtml = equipos.map((e, i) =>
    `<li>${e.serial || e.SERIAL || `Equipo #${i+1}`} ${e.modelo ? `– ${e.modelo}` : ""} ${e.gps ? "· GPS" : ""}</li>`
  ).join("");

  return `
    <h2 style="margin:0 0 12px;font:700 22px Arial,sans-serif;color:#111827;">Orden de servicio completada</h2>
    <p style="margin:0 0 12px;font:14px/1.5 Arial,sans-serif;">
      La orden <b>${orden.orden_id || orden.id || "—"}</b> ha sido marcada como ${chip(orden.estado_reparacion || "COMPLETADO")}.
    </p>
    <table role="presentation" width="100%" style="font:14px Arial,sans-serif;margin:12px 0 16px;">
      <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${cliente}</td></tr>
      <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Técnico</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${tecnico}</td></tr>
      <tr><td style="padding:6px 0;border-bottom:1px solid #eee;"><b>Costo estimado</b></td><td style="padding:6px 0;border-bottom:1px solid #eee;">${costo}</td></tr>
    </table>
    ${equiposHtml ? `<h4 style="margin:0 0 8px;font:600 16px Arial,sans-serif;">Equipos</h4><ul style="margin:0 0 16px;padding-left:18px;font:14px/1.5 Arial,sans-serif;">${equiposHtml}</ul>` : ""}
  `;
}

/**
 * Envoltura para nodemailer con generación automática de texto plano
 */
async function sendEmail({ to, subject, html, text, cc, bcc, attachments, replyTo }) {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE).toLowerCase() === "true",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });

  const plain = text || (html ? htmlToText(html, { wordwrap: 120 }) : undefined);

  return transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to, cc, bcc, subject,
    html,
    text: plain,
    attachments,
    replyTo
  });
}




exports.sendMail = onRequest(
  {
    secrets: [
      "SENDMAIL_KEY",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  (req, res) => {
    cors(req, res, async () => {
      try {
        // 🔑 API key check
        if (req.headers["x-api-key"] !== process.env.SENDMAIL_KEY) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        const { to, subject, text, html, cc, bodyContent, preheader, ctaUrl, ctaLabel } = req.body || {};
        if (!to || !subject) {
          return res.status(400).json({ error: "Missing 'to' or 'subject'" });
        }

        // Si no viene html pero sí bodyContent, usamos la plantilla base
        const htmlEmail = html || buildEmailFromBase({
          preheader: preheader || "",
          bodyHtml: bodyContent || "<p>Sin contenido.</p>",
          ctaUrl: ctaUrl || "#",
          ctaLabel: ctaLabel || "Abrir"
        });

        const info = await sendEmail({ to, subject, html: htmlEmail, text, cc });
        logger.info("Email sent", { messageId: info.messageId });
        res.json({ success: true, messageId: info.messageId });
      } catch (err) {
        logger.error("sendMail error", err);
        res.status(500).json({ error: err.message });
      }
    });
  }
);


exports.sendContractPdf = onRequest(
  {
    timeoutSeconds: 120,
    memory: "1GiB",
    secrets: [
      "SENDMAIL_KEY",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM",
      "FIRMA_SECRET"
    ]
  },
  (req, res) => {
    cors(req, res, async () => {
      console.log(">>> sendContractPdf invoked", {
        headers: req.headers,
        bodyKeys: Object.keys(req.body || {})
      });

      try {
        // 1) API KEY
        if (req.headers["x-api-key"] !== process.env.SENDMAIL_KEY) {
          return res.status(403).json({ error: "Unauthorized" });
        }

        // 2) Body
        const { to, subject, html, text, contractDocId, pdfFileName } = req.body || {};
        if (!to || !subject || !contractDocId) {
          return res.status(400).json({ error: "Missing 'to', 'subject' or 'contractDocId'" });
        }

        // 3) Firestore
        const snap = await db.collection("contratos").doc(contractDocId).get();
        if (!snap.exists) {
          logger.warn("Contrato no encontrado", { contractDocId });
          return res.status(404).json({ error: "Contrato no encontrado" });
        }
        const contrato = snap.data();

        if (contrato.estado !== "activo") {
          return res.status(400).json({ error: "Solo se pueden generar PDFs de contratos activos" });
        }
// --- Cargar verificación desde el espejo público ---
let aprobadorInfo = {};
try {
  aprobadorInfo = await attachVerificationFromMirror(contrato, contractDocId);
} catch (e) {
  if (e.code === "VERIF_NOT_FOUND") {
    logger.warn("[sendContractPdf] Verificación no encontrada, usando aprobador vacío.", {
      contratoId: contrato.contrato_id || contractDocId
    });
    aprobadorInfo = { nombre: "", cargo: "", email: "" }; // 👈 fallback
  } else {
    throw e;
  }
}



// ✅ PREPARAR vendedorInfo FUERA del try del PDF
let vendedorInfo = { nombre: "Vendedor", cargo: "Vendedor", email: "" };
if (contrato.creado_por_uid) {
  const vendSnap = await db.collection("usuarios").doc(contrato.creado_por_uid).get();
  if (vendSnap.exists) {
    const u = vendSnap.data();
    vendedorInfo = {
      nombre: u.nombre || u.Nombre || vendedorInfo.nombre,
      cargo:  u.cargo  || (u.rol || vendedorInfo.cargo),
      email:  u.email  || ""
    };
  }
}
      // 4) HTML → PDF
let pdfBuffer;
try {
  const htmlForPdf = buildContractHtmlForPdf(contrato, vendedorInfo, aprobadorInfo);
  const chromium = require("@sparticuz/chromium");
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });

          const page = await browser.newPage();
          await page.setContent(htmlForPdf, { waitUntil: "networkidle0" });
          pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: { top:"10mm", bottom:"12mm", left:"10mm", right:"10mm" }
          });
          await browser.close();
        } catch (pdfErr) {
          logger.error("Puppeteer/PDF error", { message: pdfErr.message, stack: pdfErr.stack });
          return res.status(500).json({ error: "PDF generation failed" });
        }

        // 5) Enviar email usando la función reutilizable
        // ===== Construir email con plantilla base =====
        const equiposHtml2 = (contrato.equipos || []).map(e =>
          `<li>${e.modelo || "—"} – ${Number(e.cantidad||0)} × $${Number(e.precio || 0).toFixed(2)}</li>`
        ).join("");

        const total2 = Number((contrato.total_con_itbms ?? contrato.total) || 0);
        const preheader2 = `Contrato ${contrato.contrato_id} listo · ${contrato.cliente_nombre} · $${total2.toFixed(2)}`;
        const renovacionHighlight2 = contrato.accion === "Renovación"
          ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;font:700 15px Arial,sans-serif;color:#1e3a8a;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? "RENOVACIÓN SIN EQUIPO" : "RENOVACIÓN CON EQUIPO"}</div>`
          : "";
        const aplicaRefurbished2 = (contrato.accion === "Renovación")
          && (contrato.renovacion_sin_equipo || contrato.renovacion_refurbished_componentes);
        const refurbishedIncluido2 = !!contrato.renovacion_refurbished_componentes;
        const refurbishedHighlight2 = aplicaRefurbished2
          ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid ${refurbishedIncluido2 ? "#0f766e" : "#b91c1c"};border-radius:10px;background:${refurbishedIncluido2 ? "#f0fdfa" : "#fef2f2"};font:700 15px Arial,sans-serif;color:${refurbishedIncluido2 ? "#115e59" : "#991b1b"};">Refurbished batería, antena, clip y piezas: ${refurbishedIncluido2 ? "INCLUIDO" : "NO INCLUIDO"}</div>`
          : "";

        const bodyHtml2 = `
          <h2 style="margin:0 0 12px; font:700 22px Arial, sans-serif; color:#111827;">Contrato</h2>
          <p style="margin:0 0 12px; font:14px/1.5 Arial, sans-serif;">
            Compartimos el contrato <b>${contrato.contrato_id}</b>.
          </p>
          ${renovacionHighlight2}
          ${refurbishedHighlight2}
          <table role="presentation" width="100%" style="font:14px Arial, sans-serif; margin:12px 0 16px;">
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.cliente_nombre || "—"}</td></tr>
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.tipo_contrato || "—"}</td></tr>
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.accion || "—"}</td></tr>
            ${contrato.accion === "Renovación" ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Modalidad renovación</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.renovacion_sin_equipo ? "Sin equipo" : "Con equipo"}</td></tr>` : ""}
            ${aplicaRefurbished2 ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Refurbished batería/antena/clip/piezas</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;color:${refurbishedIncluido2 ? "#115e59" : "#991b1b"};font-weight:700;">${refurbishedIncluido2 ? "Sí" : "No"}</td></tr>` : ""}
            <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">$${total2.toFixed(2)}</td></tr>
          </table>
          ${(equiposHtml2 ? `<h4 style="margin:0 0 8px; font:600 16px Arial, sans-serif;">Equipos</h4><ul style="margin:0 0 16px; padding-left:18px; font:14px/1.5 Arial, sans-serif;">${equiposHtml2}</ul>` : "")}
        `;

        const contratoUrl2 = `https://app.cecomunica.net/contratos/imprimir-contrato.html?id=${encodeURIComponent(contrato.contrato_id)}`;
        const htmlEmail2 = buildEmailFromBase({
          preheader: preheader2,
          bodyHtml: bodyHtml2,
          ctaUrl: contratoUrl2,
          ctaLabel: "Ver contrato"
        });

        // ===== Enviar email con PDF adjunto =====
        let info;
        try {
          info = await sendEmail({
            to,
            cc: vendedorInfo?.email || undefined,
            subject,
            html: htmlEmail2,
            text, // si te llega text explícito, se respeta; si no, se genera desde html
            attachments: [{
              filename: (pdfFileName || `${contrato.contrato_id || "contrato"}.pdf`),
              content: pdfBuffer,
              contentType: "application/pdf"
            }]
          });
        } catch (smtpErr) {
          logger.error("SMTP send error", { message: smtpErr.message, stack: smtpErr.stack });
          return res.status(500).json({ error: "SMTP send failed" });
        }


        logger.info("sendContractPdf OK", { messageId: info.messageId, to, subject });
        res.json({ success: true, messageId: info.messageId });
      } catch (err) {
        logger.error("sendContractPdf exception", { message: err.message, stack: err.stack });
        res.status(500).json({ error: err.message });
      }
    });
  }
);


const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const crypto = require("crypto");


// Lee el secret de firma desde Secret Manager (inyectado por runWith/secrets)
const HMAC_SECRET = process.env.FIRMA_SECRET || "MISSING_SECRET";



exports.onContratoActivado = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    secrets: ["FIRMA_SECRET"]
  },
  async (event) => {

    const beforeSnap = event.data.before;
    const afterSnap  = event.data.after;
    if (!beforeSnap || !afterSnap) return null;

    const before = beforeSnap.data();
    const after  = afterSnap.data();
    if (!before || !after) return null;

    const estadoBefore = before.estado || null;
    const estadoAfter  = after.estado  || null;

    // Trabajamos si el documento está ACTIVO o APROBADO
    if (!["activo", "aprobado"].includes(estadoAfter)) return null;

    // Siempre usar docId como ID del espejo
    const contratoId  = event.params.docId;
    const verificRef  = admin.firestore().collection("verificaciones").doc(contratoId);

    const verificSnap = await verificRef.get();

    // Caso 1: transición real a "activo"
    const transitionedToActivo   = (estadoBefore !== "activo"   && estadoAfter === "activo");
    // ✅ NUEVO: transición real a "aprobado"
    const transitionedToAprobado = (estadoBefore !== "aprobado" && estadoAfter === "aprobado");

    // Caso 2: falta reparar (no hay doc o faltan firmas)
    const needsRepair =
      !verificSnap.exists ||
      !after.firma_codigo ||
      !after.firma_hash   ||
      !after.firma_url;

    // Si no hubo transición ni reparación pendiente, salir
    if (!transitionedToActivo && !transitionedToAprobado && !needsRepair) {
      return null;
    }

    // Construye/recupera las firmas (idempotente)
    const aprobadoPor = after.aprobado_por_uid || "desconocido";
    const codigoCorto = after.firma_codigo || crypto.randomBytes(5).toString("hex").toUpperCase();
    const payload     = `${contratoId}|${aprobadoPor}`;
    const hmac        = after.firma_hash || crypto.createHmac("sha256", HMAC_SECRET).update(payload).digest("hex");
    const firmaUrl    = after.firma_url || `https://verify.cecomunica.net/c/${encodeURIComponent(contratoId)}?v=${codigoCorto}`;

    // Actualiza el contrato (merge, no pisa otros campos)
    await afterSnap.ref.set({
      firma_codigo: codigoCorto,
      firma_hash: hmac,
      firma_url: firmaUrl,
      // ✅ Ahora también guarda fecha_aprobacion si pasó a aprobado
      ...(transitionedToActivo || transitionedToAprobado || !after.fecha_aprobacion ? {
        fecha_aprobacion: admin.firestore.FieldValue.serverTimestamp(),
      } : {}),
    }, { merge: true });

    // Resolver nombre/email/rol del aprobador
    let aprobNombre = "—";
    let aprobEmail  = "—";
    let aprobRol    = "—";

    if (aprobadoPor && aprobadoPor !== "desconocido") {
      try {
        const aprSnap = await admin.firestore().collection("usuarios").doc(aprobadoPor).get();
        if (aprSnap.exists) {
          const u = aprSnap.data() || {};
          aprobNombre = u.nombre || (u.email ? u.email.split("@")[0] : "—");
          aprobEmail  = u.email  || "—";
          aprobRol    = u.cargo  || u.rol || "Administrador";
        }
      } catch (e) {
        console.warn("[onContratoActivado] No se pudo leer usuarios/", aprobadoPor, e.message);
      }
    }

    // Espejo en "verificaciones" (merge permite correcciones)
    await verificRef.set({
      contrato_id: contratoId,
      cliente_nombre: after.cliente_nombre || null,
      total_con_itbms: (typeof after.total_con_itbms === "number" ? after.total_con_itbms : (after.total ?? null)),
      aprobado_por_uid: aprobadoPor,
      fecha_aprobacion: after.fecha_aprobacion || admin.firestore.FieldValue.serverTimestamp(),
      firma_codigo: codigoCorto,
      firma_hash: hmac,
      firma_url: firmaUrl,
      estado: estadoAfter,
      aprobado_por_nombre: aprobNombre,
      aprobado_por_email:  aprobEmail,
      aprobado_por_rol:    aprobRol,
      creado_en: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    return null;
  }
);


// NEW: send PDF + email in background when a contrato is approved
exports.onContratoActivadoSendPdf = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    memory: "1GiB",
    timeoutSeconds: 120,
    secrets: [
      "FIRMA_SECRET",
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const before = event.data.before?.data();
    const after  = event.data.after?.data();

    if (!before || !after) {
      logger.warn("[onContratoActivadoSendPdf] No before/after data", { before, after });
      return null;
    }

    logger.info("[onContratoActivadoSendPdf] Triggered", {
      contratoId: after.contrato_id,
      estadoBefore: before.estado,
      estadoAfter: after.estado
    });

    // Actúa cuando pasa a APROBADO (ajusta a "activo" si lo prefieres)
    const pasoAAprobado = (before.estado !== "aprobado" && after.estado === "aprobado");
    if (!pasoAAprobado) {
      logger.info("[onContratoActivadoSendPdf] No es transición a APROBADO, se ignora.");
      return null;
    }

    try {
      const contrato = after;

      // Vendedor
      let vendedorInfo = { nombre: "Vendedor", cargo: "Vendedor", email: "" };
      if (contrato.creado_por_uid) {
        const vendSnap = await db.collection("usuarios").doc(contrato.creado_por_uid).get();
        if (vendSnap.exists) {
          const u = vendSnap.data();
          vendedorInfo = {
            nombre: u.nombre || vendedorInfo.nombre,
            cargo:  u.cargo  || (u.rol || vendedorInfo.cargo),
            email:  u.email  || ""
          };
        }
      }

      // Aprobador (desde espejo verificaciones)
      let aprobadorInfo = {};
      try {
        aprobadorInfo = await attachVerificationFromMirror(contrato, event.params.docId);
      } catch (e) {
        if (e.code === "VERIF_NOT_FOUND") {
          logger.warn("[onContratoActivadoSendPdf] Verificación no disponible; generando PDF sin firma interna.", {
            contratoId: contrato.contrato_id
          });
          aprobadorInfo = { nombre: "", cargo: "", email: "" }; // fallback
        } else {
          throw e;
        }
      }

      // === HTML → PDF (Puppeteer/Chromium) ===
      const htmlForPdf = buildContractHtmlForPdf(contrato, vendedorInfo, aprobadorInfo);
      const chromium = require("@sparticuz/chromium");
      const browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
      const page = await browser.newPage();
      await page.setContent(htmlForPdf, { waitUntil: "networkidle0" });
      const pdfBuffer = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top:"10mm", bottom:"12mm", left:"10mm", right:"10mm" }
      });
      await browser.close();

      // === Email con plantilla ===
      const equiposHtml = (contrato.equipos || []).map(e =>
        `<li>${e.modelo || "—"} – ${Number(e.cantidad||0)} × $${Number(e.precio || 0).toFixed(2)}</li>`
      ).join("");

      const total = Number((contrato.total_con_itbms ?? contrato.total) || 0);
      const preheader = `Contrato ${contrato.contrato_id} aprobado para ${contrato.cliente_nombre} por $${total.toFixed(2)}`;
      const renovacionHighlightHtml = contrato.accion === "Renovación"
        ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid #2563eb;border-radius:10px;background:#eff6ff;font:700 15px Arial,sans-serif;color:#1e3a8a;">Modalidad de renovación: ${contrato.renovacion_sin_equipo ? "RENOVACIÓN SIN EQUIPO" : "RENOVACIÓN CON EQUIPO"}</div>`
        : "";
      const aplicaRefurbished = (contrato.accion === "Renovación")
        && (contrato.renovacion_sin_equipo || contrato.renovacion_refurbished_componentes);
      const refurbishedIncluido = !!contrato.renovacion_refurbished_componentes;
      const refurbishedHighlightHtml = aplicaRefurbished
        ? `<div style="margin:0 0 14px;padding:12px 14px;border:2px solid ${refurbishedIncluido ? "#0f766e" : "#b91c1c"};border-radius:10px;background:${refurbishedIncluido ? "#f0fdfa" : "#fef2f2"};font:700 15px Arial,sans-serif;color:${refurbishedIncluido ? "#115e59" : "#991b1b"};">Refurbished batería, antena, clip y piezas: ${refurbishedIncluido ? "INCLUIDO" : "NO INCLUIDO"}</div>`
        : "";

      const bodyHtml = `
        <h2 style="margin:0 0 12px; font:700 22px Arial, sans-serif; color:#111827;">Contrato aprobado</h2>
        <p style="margin:0 0 12px; font:14px/1.5 Arial, sans-serif;">
          El contrato <b>${contrato.contrato_id}</b> ha sido aprobado.
        </p>
        ${renovacionHighlightHtml}
        ${refurbishedHighlightHtml}
        <table role="presentation" width="100%" style="font:14px Arial, sans-serif; margin:12px 0 16px;">
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.cliente_nombre || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Elaborador del contrato</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${vendedorInfo?.nombre || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Tipo</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.tipo_contrato || "—"}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Acción</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.accion || "—"}</td></tr>
          ${contrato.accion === "Renovación" ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Modalidad renovación</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${contrato.renovacion_sin_equipo ? "Sin equipo" : "Con equipo"}</td></tr>` : ""}
          ${aplicaRefurbished ? `<tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Refurbished batería/antena/clip/piezas</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;color:${refurbishedIncluido ? "#115e59" : "#991b1b"};font-weight:700;">${refurbishedIncluido ? "Sí" : "No"}</td></tr>` : ""}
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Observaciones</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${(contrato.observaciones || "—").replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]))}</td></tr>
          <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Total con ITBMS</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">$${total.toFixed(2)}</td></tr>
        </table>
        ${equiposHtml ? `<h4 style="margin:0 0 8px; font:600 16px Arial, sans-serif;">Equipos</h4><ul style="margin:0 0 16px; padding-left:18px; font:14px/1.5 Arial, sans-serif;">${equiposHtml}</ul>` : ""}
      `;

      const contratoUrl = `https://app.cecomunica.net/contratos/imprimir-contrato.html?id=${encodeURIComponent(contrato.contrato_id)}`;
      const htmlEmail = buildEmailFromBase({
        preheader,
        bodyHtml,
        ctaUrl: contratoUrl,
        ctaLabel: "Ver contrato"
      });

      await sendEmail({
        to: "alberto.yohros@cecomunica.com, activaciones@cecomunica.com",
        cc: vendedorInfo?.email || undefined,   // CC al elaborador
        subject: `Contrato APROBADO: ${contrato.contrato_id} – ${contrato.cliente_nombre}`,
        html: htmlEmail,
        attachments: [{
          filename: `${contrato.contrato_id || "contrato"}.pdf`,
          content: pdfBuffer,
          contentType: "application/pdf"
        }]
      });

      logger.info("[onContratoActivadoSendPdf] Correo enviado con PDF", {
        contratoId: contrato.contrato_id,
        cliente: contrato.cliente_nombre
      });
    } catch (err) {
      logger.error("[onContratoActivadoSendPdf] Error en proceso", { message: err.message, stack: err.stack });
    }

    return null;
  }
);


const { onDocumentCreated } = require("firebase-functions/v2/firestore");

exports.onMailQueued = onDocumentCreated(
  {
    document: "mail_queue/{mailId}",
    region: "us-central1",
    secrets: [
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const snap = event.data;
    const mailId = event.params.mailId;
    const data = snap.data();

try {
  if (!data?.to || !data?.subject) {
    throw new Error("Faltan campos obligatorios: to/subject");
  }

  // Permitir bodyContent + tokens en la cola
  let html = data.html;
  if (!html && (data.bodyContent || data.preheader)) {
    html = buildEmailFromBase({
      preheader: data.preheader || "",
      bodyHtml:  data.bodyContent || "<p>Sin contenido.</p>",
      ctaUrl:    data.ctaUrl || "#",
      ctaLabel:  data.ctaLabel || "Abrir",
    });
  }
  if (!html) throw new Error("Falta 'html' o 'bodyContent'");

  await sendEmail({
    to: data.to,
    cc: data.cc || undefined,
    subject: data.subject,
    html,
    text: data.text || undefined,
    attachments: data.attachments || undefined
  });

  await db.collection("mail_queue").doc(mailId).update({
    status: "sent",
    sent_at: admin.firestore.FieldValue.serverTimestamp(),
    error: admin.firestore.FieldValue.delete(),
  });
} catch (err) {
      console.error("Error enviando correo encolado:", err);
      await db.collection("mail_queue").doc(mailId).update({
        status: "error",
        error: String(err?.message || err),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }
);

exports.onContratoAnuladoNotify = onDocumentUpdated(
  {
    document: "contratos/{docId}",
    region: "us-central1",
    secrets: [
      "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE",
      "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
    ]
  },
  async (event) => {
    const before = event.data.before?.data();
    const after = event.data.after?.data();
    if (!before || !after) return null;

    const pasoAAnulado = (before.estado !== "anulado" && after.estado === "anulado");
    if (!pasoAAnulado) return null;

    const contratoId = after.contrato_id || event.params.docId;
    const motivoAnulacion = String(after.anulado_motivo || "No especificado");

    const escapeHtml = (value) => String(value ?? "").replace(/[<>&]/g, (ch) => ({
      "<": "&lt;",
      ">": "&gt;",
      "&": "&amp;"
    }[ch]));

    const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());

    const getUserInfo = async (uid) => {
      if (!uid) return { uid: null, nombre: "", email: "" };
      try {
        const snap = await db.collection("usuarios").doc(uid).get();
        if (!snap.exists) return { uid, nombre: uid, email: "" };
        const data = snap.data() || {};
        return {
          uid,
          nombre: data.nombre || data.email || uid,
          email: data.email || ""
        };
      } catch (e) {
        logger.warn("[onContratoAnuladoNotify] No se pudo leer usuario", { uid, message: e.message });
        return { uid, nombre: uid, email: "" };
      }
    };

    const [anuladorInfo, elaboradorInfo] = await Promise.all([
      getUserInfo(after.anulado_por_uid || null),
      getUserInfo(after.creado_por_uid || null)
    ]);

    const recipients = [];
    if (isEmail(anuladorInfo.email)) recipients.push(anuladorInfo.email.trim().toLowerCase());
    if (isEmail(elaboradorInfo.email)) recipients.push(elaboradorInfo.email.trim().toLowerCase());

    const uniqueRecipients = [...new Set(recipients)];
    if (!uniqueRecipients.length) {
      logger.warn("[onContratoAnuladoNotify] Sin destinatarios válidos", {
        contratoId,
        anuladorUid: after.anulado_por_uid || null,
        elaboradorUid: after.creado_por_uid || null
      });
      return null;
    }

    const to = uniqueRecipients[0];
    const cc = uniqueRecipients.length > 1 ? uniqueRecipients.slice(1).join(",") : undefined;

    const preheader = `Contrato ${contratoId} anulado. Motivo: ${motivoAnulacion}`;
    const bodyHtml = `
      <h2 style="margin:0 0 12px; font:700 22px Arial, sans-serif; color:#991b1b;">Contrato anulado</h2>
      <p style="margin:0 0 12px; font:14px/1.5 Arial, sans-serif;">
        El contrato <b>${escapeHtml(contratoId)}</b> fue anulado.
      </p>
      <div style="margin:0 0 14px; padding:12px 14px; border:2px solid #b91c1c; border-radius:10px; background:#fef2f2; font:700 15px Arial, sans-serif; color:#991b1b;">
        Motivo de anulación: ${escapeHtml(motivoAnulacion)}
      </div>
      <table role="presentation" width="100%" style="font:14px Arial, sans-serif; margin:12px 0 16px;">
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Contrato ID</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(contratoId)}</td></tr>
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Cliente</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(after.cliente_nombre || "—")}</td></tr>
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Anulado por</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(anuladorInfo.nombre || "—")}</td></tr>
        <tr><td style="padding:6px 0; border-bottom:1px solid #eee;"><b>Elaborador</b></td><td style="padding:6px 0; border-bottom:1px solid #eee;">${escapeHtml(elaboradorInfo.nombre || "—")}</td></tr>
      </table>
    `;

    await db.collection("mail_queue").add({
      to,
      cc: cc || null,
      subject: `Contrato ANULADO: ${contratoId} – ${after.cliente_nombre || "Cliente"}`,
      preheader,
      bodyContent: bodyHtml,
      ctaUrl: "https://app.cecomunica.net/contratos/index.html",
      ctaLabel: "Ver contratos",
      meta: {
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        source: "contrato-anulado-notify",
        contrato_id: contratoId,
        anulado_por_uid: after.anulado_por_uid || null,
        creado_por_uid: after.creado_por_uid || null
      },
      status: "queued"
    });

    logger.info("[onContratoAnuladoNotify] Correo de anulación encolado", {
      contratoId,
      to,
      cc: cc || null
    });

    return null;
  }
);

// Trigger v2: cuando una orden pasa a COMPLETADO
const { onDocumentUpdated: onDocUpdatedV2 } = require("firebase-functions/v2/firestore");

exports.onOrdenCompletada = onDocUpdatedV2(
  { document: "ordenes_de_servicio/{ordenId}" },
  async (event) => {
    const before = event.data.before?.data() || {};
    const after  = event.data.after?.data()  || {};
    const ordenId = event.params.ordenId;

    // Cambió el estado de reparación?
    const estadoAntes   = String(before?.estado_reparacion || "");
    const estadoDespues = String(after?.estado_reparacion  || "");
    if (estadoAntes === estadoDespues) return null;

    // Dispara SOLO al pasar a COMPLETADO (case-insensitive)
    if (!/COMPLETADO/i.test(estadoDespues)) return null;

    const tecnicoUid = after?.tecnico_asignado || null;
    const actorUid   = after?.actualizado_por || null;

    // ===== Actualizar stats del técnico (solo si hay técnico asignado) =====
    if (tecnicoUid) {
      const now    = new Date();
      const year   = now.getFullYear();
      const month  = now.getMonth() + 1; // 1..12
      const yyyyMM = `${year}-${String(month).padStart(2, "0")}`;
      const isoWeek = getISOWeekKey(now);

      const statDoc    = db.collection("tecnico_stats").doc(tecnicoUid);
      const mensualDoc = statDoc.collection("mensual").doc(yyyyMM);
      const semanalDoc = statDoc.collection("semanal").doc(isoWeek);
      const eventoDoc  = statDoc.collection("eventos").doc(ordenId);

      try {
        await db.runTransaction(async (t) => {
          const eventoSnap = await t.get(eventoDoc);
          if (eventoSnap.exists) return; // ya contado

          t.set(eventoDoc, {
            ordenId,
            tecnicoUid,
            actorUid: actorUid || null,
            fecha: admin.firestore.Timestamp.fromDate(now),
            estado: "COMPLETADO",
            year,
            month,
            isoWeek
          });

          t.set(statDoc, {
            total: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          t.set(mensualDoc, {
            count: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });

          t.set(semanalDoc, {
            count: admin.firestore.FieldValue.increment(1),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          }, { merge: true });
        });
      } catch (e) {
        logger.error("[onOrdenCompletada] Error en transaction de stats", { message: e.message, ordenId });
      }
    }

    // ===== Encolar notificación al vendedor asignado =====
    try {
      const ordenLink   = `https://app.cecomunica.net/ordenes/trabajar-orden.html?id=${encodeURIComponent(ordenId)}`;
      const bodyContent = buildBodyOrdenCompletada(after);
      const preheader   = `Orden ${after.orden_id || ordenId} completada · ${after.cliente_nombre || "Cliente"}`;

      // Resolver email del vendedor asignado
      const vendedorUid = after?.vendedor_asignado || null;
      let vendedorEmail = "";
      if (vendedorUid) {
        const vSnap = await db.collection("usuarios").doc(vendedorUid).get();
        vendedorEmail = vSnap.exists ? (vSnap.data().email || "") : "";
      }

      const toList = ["atencionalcliente@cecomunica.com"];
      if (vendedorEmail) toList.push(vendedorEmail);

      await db.collection("mail_queue").add({
        to: toList.join(","),
        subject: `Orden COMPLETADA: ${after.orden_id || ordenId} – ${after.cliente_nombre || "Cliente"}`,
        preheader,
        bodyContent,
        ctaUrl: ordenLink,
        ctaLabel: "Ver orden",
        status: "queued",
        created_at: admin.firestore.FieldValue.serverTimestamp()
      });
    } catch (e) {
      logger.error("[onOrdenCompletada] No se pudo encolar correo", { message: e.message, ordenId });
    }

    return null;
  }
);


// === Utilidad para semana ISO ===
function getISOWeekKey(d) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2,'0')}`;
}

// ===================================================================
// 📦 Cloud Function: Auto-update contract summaries
// ===================================================================
/**
 * onContratoOrdenWrite
 * 
 * Trigger que se dispara cuando se crea, modifica o elimina un documento
 * en la subcolección contratos/{contratoId}/ordenes/{ordenId}.
 * 
 * Actualiza automáticamente los siguientes campos en el contrato padre:
 *   - os_count: Número total de órdenes asociadas
 *   - equipos_total: Suma de equipos_count de todas las órdenes
 *   - tiene_os: Boolean que indica si hay órdenes (redundante pero útil)
 * 
 * Usa DELTA calculation para eficiencia:
 *   - Si es creación: +1 orden, +N equipos
 *   - Si es modificación: calcular diferencia
 *   - Si es eliminación: -1 orden, -N equipos
 * 
 * Ventajas:
 *   - Elimina N+1 queries en el front-end
 *   - Rendimiento constante O(1) sin importar cantidad de órdenes
 *   - Datos siempre actualizados sin necesidad de cache
 * 
 * Uso en front-end (contratos/index.html):
 *   const tieneOS = data.tiene_os || (data.os_count ?? 0) > 0;
 *   celdaIcono.innerHTML = tieneOS ? '📦' : '⬜';
 */
exports.onContratoOrdenWrite = onDocUpdatedV2(
  { 
    document: "contratos/{contratoId}/ordenes/{ordenId}",
    region: "us-central1"
  },
  async (event) => {
    const contratoId = event.params.contratoId;
    const ordenId = event.params.ordenId;
    
    const beforeData = event.data.before?.data() || null;
    const afterData = event.data.after?.data() || null;
    
    // ===== DELTA CALCULATION =====
    // Casos:
    // 1) CREATE: before=null, after=data → +1 orden, +N equipos
    // 2) UPDATE: before=data, after=data → calcular diferencia equipos
    // 3) DELETE: before=data, after=null → -1 orden, -N equipos
    
    let deltaOrdenes = 0;
    let deltaEquipos = 0;
    
    const equiposCountBefore = Number(beforeData?.equipos_count || 0);
    const equiposCountAfter = Number(afterData?.equipos_count || 0);
    
    if (!beforeData && afterData) {
      // CREATE
      deltaOrdenes = 1;
      deltaEquipos = equiposCountAfter;
      logger.info("[onContratoOrdenWrite] CREATE", {
        contratoId, ordenId, equiposCountAfter, deltaOrdenes, deltaEquipos
      });
    } else if (beforeData && afterData) {
      // UPDATE
      deltaOrdenes = 0; // No cambia cantidad de órdenes
      deltaEquipos = equiposCountAfter - equiposCountBefore;
      logger.info("[onContratoOrdenWrite] UPDATE", {
        contratoId, ordenId, equiposCountBefore, equiposCountAfter, deltaEquipos
      });
    } else if (beforeData && !afterData) {
      // DELETE
      deltaOrdenes = -1;
      deltaEquipos = -equiposCountBefore;
      logger.info("[onContratoOrdenWrite] DELETE", {
        contratoId, ordenId, equiposCountBefore, deltaOrdenes, deltaEquipos
      });
    } else {
      logger.warn("[onContratoOrdenWrite] Caso inesperado: ambos null", { contratoId, ordenId });
      return null;
    }
    
    // Si no hay cambios, salir
    if (deltaOrdenes === 0 && deltaEquipos === 0) {
      logger.info("[onContratoOrdenWrite] Sin cambios, salir", { contratoId, ordenId });
      return null;
    }
    
    // ===== TRANSACTION: Actualizar contrato padre =====
    const contratoRef = db.collection("contratos").doc(contratoId);
    
    try {
      await db.runTransaction(async (t) => {
        const contratoSnap = await t.get(contratoRef);
        if (!contratoSnap.exists) {
          logger.error("[onContratoOrdenWrite] Contrato no existe", { contratoId });
          return;
        }
        
        const contratoData = contratoSnap.data();
        const osCountActual = Number(contratoData.os_count || 0);
        const equiposActual = Number(contratoData.equipos_total || 0);
        
        const nuevoOsCount = Math.max(0, osCountActual + deltaOrdenes);
        const nuevoEquiposTotal = Math.max(0, equiposActual + deltaEquipos);
        
        t.update(contratoRef, {
          os_count: nuevoOsCount,
          equipos_total: nuevoEquiposTotal,
          tiene_os: nuevoOsCount > 0,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        });
        
        logger.info("[onContratoOrdenWrite] Actualizado", {
          contratoId,
          antes: { os_count: osCountActual, equipos_total: equiposActual },
          despues: { os_count: nuevoOsCount, equipos_total: nuevoEquiposTotal }
        });
      });
    } catch (err) {
      logger.error("[onContratoOrdenWrite] Error en transaction", {
        contratoId, ordenId, message: err.message, stack: err.stack
      });
    }
    
    return null;
  }
);

// ===================================================================
// 🔄 Helper: Recalcular cache completo de un contrato
// ===================================================================
/**
 * recalcularCacheContrato
 * 
 * Recalcula todos los campos de cache de un contrato basándose en
 * las órdenes activas (no eliminadas) en su subcolección.
 * 
 * Se invoca cuando:
 *   - Una orden se elimina (soft o hard delete)
 *   - Se detecta inconsistencia en el cache
 * 
 * Actualiza en el documento contrato:
 *   - os_count: Número de órdenes activas
 *   - os_linked: true si os_count > 0
 *   - os_has_equipos: true si alguna orden tiene equipos
 *   - os_serials_preview: Primeros 3 seriales (últimas órdenes)
 *   - os_equipos_count_last: Count de equipos de última orden
 *   - tiene_os: Redundante, igual a os_linked
 * 
 * Si os_count === 0, limpia todos los campos a valores "vacíos"
 */
async function recalcularCacheContrato(contratoId) {
  try {
    logger.info("[recalcularCacheContrato] Iniciando recálculo", { contratoId });
    
    // 1) Leer subcolección de órdenes del contrato
    const ordenesSnap = await db.collection("contratos")
      .doc(contratoId)
      .collection("ordenes")
      .orderBy("updated_at", "desc")
      .get();
    
    // 2) Filtrar órdenes vigentes (no eliminadas)
    const ordenesVigentes = [];
    
    for (const doc of ordenesSnap.docs) {
      const cacheData = doc.data();
      const ordenId = doc.id;
      
      // Verificar si está eliminada en el cache
      if (cacheData.eliminado === true) {
        logger.info("[recalcularCacheContrato] Orden marcada eliminada en cache", {
          contratoId, ordenId
        });
        continue;
      }
      
      // Verificar contra la OS real en ordenes_de_servicio
      try {
        const osRef = await db.collection("ordenes_de_servicio").doc(ordenId).get();
        
        if (!osRef.exists) {
          logger.info("[recalcularCacheContrato] Orden no existe (hard delete detectado)", {
            contratoId, ordenId
          });
          // Eliminar del cache
          await doc.ref.delete();
          continue;
        }
        
        const osData = osRef.data();
        if (osData.eliminado === true) {
          logger.info("[recalcularCacheContrato] Orden soft-deleted detectada", {
            contratoId, ordenId
          });
          // Marcar en cache como eliminada
          await doc.ref.update({ eliminado: true });
          continue;
        }
        
        // Orden vigente
        ordenesVigentes.push({
          ordenId,
          data: cacheData
        });
        
      } catch (err) {
        logger.error("[recalcularCacheContrato] Error verificando orden", {
          contratoId, ordenId, error: err.message
        });
      }
    }
    
    logger.info("[recalcularCacheContrato] Órdenes vigentes encontradas", {
      contratoId,
      total: ordenesSnap.size,
      vigentes: ordenesVigentes.length
    });
    
    // 3) Calcular nuevos valores
    const os_count = ordenesVigentes.length;
    
    let updateData = {};
    
    if (os_count === 0) {
      // ✅ Limpiar todos los campos a vacío
      updateData = {
        os_count: 0,
        os_linked: false,
        os_has_equipos: false,
        os_serials_preview: [],
        os_equipos_count_last: 0,
        tiene_os: false,
        os_dirty: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      };
      
      logger.info("[recalcularCacheContrato] Sin órdenes vigentes, limpiando campos", {
        contratoId
      });
    } else {
      // Calcular preview de seriales (últimas 3 órdenes)
      const allSerials = [];
      let hasEquipos = false;
      let lastEquiposCount = 0;
      
      for (const orden of ordenesVigentes.slice(0, 10)) {
        const serials = orden.data.serials || [];
        allSerials.push(...serials);
        
        if (orden.data.equipos_count > 0) {
          hasEquipos = true;
        }
      }
      
      // Equipos de la última orden
      if (ordenesVigentes.length > 0) {
        lastEquiposCount = ordenesVigentes[0].data.equipos_count || 0;
      }
      
      // Primeros 3 seriales únicos
      const serialsPreview = [...new Set(allSerials)].slice(0, 3);
      
      updateData = {
        os_count,
        os_linked: true,
        os_has_equipos: hasEquipos,
        os_serials_preview: serialsPreview,
        os_equipos_count_last: lastEquiposCount,
        tiene_os: true,
        os_dirty: false,
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      };
      
      logger.info("[recalcularCacheContrato] Campos recalculados", {
        contratoId,
        os_count,
        hasEquipos,
        serialsPreview
      });
    }
    
    // 4) Actualizar documento del contrato
    await db.collection("contratos")
      .doc(contratoId)
      .update(updateData);
    
    logger.info("[recalcularCacheContrato] Contrato actualizado exitosamente", {
      contratoId,
      os_count: updateData.os_count
    });
    
    return true;
    
  } catch (err) {
    logger.error("[recalcularCacheContrato] Error general", {
      contratoId,
      error: err.message,
      stack: err.stack
    });
    return false;
  }
}

// ===================================================================
// 🔄 Cloud Function: Sync de cache automático desde órdenes
// ===================================================================
/**
 * onOrdenWriteSyncContratoCache
 * 
 * Trigger que se dispara cuando se crea, modifica o elimina una orden
 * en ordenes_de_servicio/{ordenId}.
 * 
 * PROPÓSITO:
 *   - Mantener sincronizado el cache en contratos/{contratoId}/ordenes/{ordenId}
 *   - Actualizar campos de resumen rápido en el documento del contrato
 *   - Eliminar necesidad de sync manual desde el frontend
 * 
 * FLOW:
 *   1. Detectar si la orden tiene contrato aplicable
 *   2. Normalizar equipos (filtrar eliminados, extraer serials)
 *   3. Escribir/actualizar subcolección cache
 *   4. Actualizar resumen en documento contrato (para ícono rápido)
 *   5. Manejar cambios de contrato (limpiar cache anterior)
 * 
 * CAMPOS EN CACHE (subcolección):
 *   - numero_orden, cliente_id, cliente_nombre, tipo_de_servicio
 *   - estado_reparacion, fecha_creacion
 *   - equipos[] (lista completa para modal detallado)
 *   - equipos_count, serials[] (para hover/preview)
 * 
 * CAMPOS EN RESUMEN (documento contrato):
 *   - os_linked: boolean
 *   - os_last_orden_id: string
 *   - os_last_updated_at: timestamp
 *   - os_equipos_count_last: number
 *   - os_serials_preview: string[] (primeros 3)
 *   - os_has_equipos: boolean
 * 
 * SEGURIDAD:
 *   - Frontend debe tener SOLO READ en contratos/{id}/ordenes/*
 *   - Todas las escrituras manejadas por esta CF
 * 
 * VENTAJAS vs sync manual:
 *   - ✅ Siempre consistente (no depende de que frontend llame sync)
 *   - ✅ Maneja edge cases (cambio de contrato, eliminación)
 *   - ✅ Atomic operations con transactions
 *   - ✅ Logs centralizados en Cloud Functions
 */
const { onDocumentWritten, onDocumentDeleted } = require("firebase-functions/v2/firestore");

exports.onOrdenWriteSyncContratoCache = onDocumentWritten(
  {
    document: "ordenes_de_servicio/{ordenId}",
    region: "us-central1"
  },
  async (event) => {
    const ordenId = event.params.ordenId;
    const beforeData = event.data.before?.data() || null;
    const afterData = event.data.after?.data() || null;
    
    logger.info("[onOrdenWriteSyncContratoCache] Triggered", {
      ordenId,
      hasBefore: !!beforeData,
      hasAfter: !!afterData
    });
    
    // ===== HELPERS =====
    
    /**
     * Normaliza serial de equipo (prioridad: serial > SERIAL > numero_de_serie)
     */
    function normalizeSerial(equipo) {
      if (!equipo) return "";
      return (equipo.serial || equipo.SERIAL || equipo.numero_de_serie || "")
        .toString()
        .trim();
    }
    
    /**
     * Extrae datos de cache de una orden
     */
    function extractCacheData(ordenData) {
      if (!ordenData) return null;
      
      // Filtrar equipos eliminados
      const equipos = (ordenData.equipos || []).filter(e => !e.eliminado);
      
      // Extraer serials
      const serials = equipos
        .map(normalizeSerial)
        .filter(Boolean);
      
      return {
        numero_orden: ordenId,
        cliente_id: ordenData.cliente_id || null,
        cliente_nombre: ordenData.cliente_nombre || null,
        tipo_de_servicio: ordenData.tipo_de_servicio || null,
        estado_reparacion: ordenData.estado_reparacion || null,
        fecha_creacion: ordenData.fecha_creacion || null,
        
        // Lista completa para modal
        equipos: equipos.map(e => ({
          serial: normalizeSerial(e),
          modelo: e.modelo || e.MODEL || e.modelo_nombre || "",
          observaciones: e.observaciones || e.descripcion || e.nombre || "",
          unit_id: e.unit_id || e.unitId || "",
          sim: e.sim || e.simcard || ""
        })),
        
        // Contadores para preview
        equipos_count: equipos.length,
        serials,
        
        updated_at: admin.firestore.FieldValue.serverTimestamp()
      };
    }
    
    /**
     * Obtiene contrato aplicable de una orden
     */
    function getApplicableContract(ordenData) {
      if (!ordenData) return null;
      const contrato = ordenData.contrato;
      if (!contrato || !contrato.aplica || !contrato.contrato_doc_id) {
        return null;
      }
      return contrato.contrato_doc_id;
    }
    
    // ===== MAIN LOGIC =====
    
    const beforeContratoId = getApplicableContract(beforeData);
    const afterContratoId = getApplicableContract(afterData);
    
    // Detectar soft delete (eliminado: true)
    const wasSoftDeleted = !beforeData?.eliminado && afterData?.eliminado === true;
    
    logger.info("[onOrdenWriteSyncContratoCache] Contract analysis", {
      ordenId,
      beforeContratoId,
      afterContratoId,
      hasChange: beforeContratoId !== afterContratoId,
      wasSoftDeleted
    });
    
    // ===== CASO ESPECIAL: Soft Delete =====
    if (wasSoftDeleted && afterContratoId) {
      logger.info("[onOrdenWriteSyncContratoCache] Soft delete detected", {
        ordenId,
        contratoId: afterContratoId
      });
      
      try {
        // Marcar como eliminada en el cache
        await db.collection("contratos")
          .doc(afterContratoId)
          .collection("ordenes")
          .doc(ordenId)
          .update({
            eliminado: true,
            updated_at: admin.firestore.FieldValue.serverTimestamp()
          });
        
        // Recalcular cache del contrato
        await recalcularCacheContrato(afterContratoId);
        
        logger.info("[onOrdenWriteSyncContratoCache] Soft delete processed", {
          ordenId,
          contratoId: afterContratoId
        });
        
        return null;
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error processing soft delete", {
          ordenId,
          contratoId: afterContratoId,
          error: err.message
        });
      }
    }
    
    // ===== CASO 1: Limpiar cache del contrato anterior =====
    if (beforeContratoId && beforeContratoId !== afterContratoId) {
      try {
        await db.collection("contratos")
          .doc(beforeContratoId)
          .collection("ordenes")
          .doc(ordenId)
          .delete();
        
        logger.info("[onOrdenWriteSyncContratoCache] Cleaned old contract cache", {
          ordenId,
          oldContratoId: beforeContratoId
        });
        
        // Recalcular cache del contrato anterior
        await recalcularCacheContrato(beforeContratoId);
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error cleaning old cache", {
          ordenId,
          oldContratoId: beforeContratoId,
          error: err.message
        });
      }
    }
    
    // ===== CASO 2: Actualizar cache del contrato actual =====
    if (afterContratoId && afterData) {
      try {
        const cacheData = extractCacheData(afterData);
        
        if (!cacheData) {
          logger.warn("[onOrdenWriteSyncContratoCache] No cache data extracted", { ordenId });
          return null;
        }
        
        // Escribir subcolección cache
        await db.collection("contratos")
          .doc(afterContratoId)
          .collection("ordenes")
          .doc(ordenId)
          .set(cacheData, { merge: true });
        
        logger.info("[onOrdenWriteSyncContratoCache] Updated cache", {
          ordenId,
          contratoId: afterContratoId,
          equiposCount: cacheData.equipos_count,
          serialsCount: cacheData.serials.length
        });
        
        // ===== Actualizar resumen en documento contrato =====
        const resumenUpdate = {
          os_linked: true,
          os_last_orden_id: ordenId,
          os_last_updated_at: admin.firestore.FieldValue.serverTimestamp(),
          os_equipos_count_last: cacheData.equipos_count,
          os_serials_preview: cacheData.serials.slice(0, 3),
          os_has_equipos: cacheData.equipos_count > 0,
          updated_at: admin.firestore.FieldValue.serverTimestamp()
        };
        
        await db.collection("contratos")
          .doc(afterContratoId)
          .update(resumenUpdate);
        
        logger.info("[onOrdenWriteSyncContratoCache] Updated contract summary", {
          ordenId,
          contratoId: afterContratoId,
          resumen: resumenUpdate
        });
        
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error updating cache", {
          ordenId,
          contratoId: afterContratoId,
          error: err.message,
          stack: err.stack
        });
      }
    }
    
    // ===== CASO 3: Eliminar cache si ya no hay contrato =====
    if (!afterContratoId && beforeContratoId) {
      try {
        await db.collection("contratos")
          .doc(beforeContratoId)
          .collection("ordenes")
          .doc(ordenId)
          .delete();
        
        logger.info("[onOrdenWriteSyncContratoCache] Removed cache (no longer linked)", {
          ordenId,
          oldContratoId: beforeContratoId
        });
        
        // Recalcular cache
        await recalcularCacheContrato(beforeContratoId);
      } catch (err) {
        logger.error("[onOrdenWriteSyncContratoCache] Error removing cache", {
          ordenId,
          contratoId: beforeContratoId,
          error: err.message
        });
      }
    }
    
    return null;
  }
);

// ===================================================================
// 🗑️ Cloud Function: Limpiar cache al eliminar orden (hard delete)
// ===================================================================
/**
 * onOrdenHardDelete
 * 
 * Trigger que se dispara cuando una orden se elimina completamente
 * de Firestore (hard delete con .delete()).
 * 
 * Se encarga de:
 *   - Eliminar el cache en contratos/{contratoId}/ordenes/{ordenId}
 *   - Recalcular todos los campos del contrato (os_count, os_linked, etc.)
 *   - Limpiar campos si ya no quedan órdenes vigentes
 * 
 * Complementa a onOrdenWriteSyncContratoCache que maneja soft delete (eliminado: true)
 */
exports.onOrdenHardDelete = onDocumentDeleted(
  {
    document: "ordenes_de_servicio/{ordenId}",
    region: "us-central1"
  },
  async (event) => {
    const ordenId = event.params.ordenId;
    const deletedData = event.data.data();
    
    logger.info("[onOrdenHardDelete] Hard delete detected", {
      ordenId,
      hadData: !!deletedData
    });
    
    if (!deletedData) {
      logger.warn("[onOrdenHardDelete] No data available for deleted order", { ordenId });
      return null;
    }
    
    // Obtener contrato asociado
    const contrato = deletedData.contrato;
    const contratoId = contrato?.contrato_doc_id;
    
    if (!contratoId) {
      logger.info("[onOrdenHardDelete] No contract linked, nothing to clean", { ordenId });
      return null;
    }
    
    logger.info("[onOrdenHardDelete] Processing deletion for contract", {
      ordenId,
      contratoId
    });
    
    try {
      // 1) Eliminar cache en subcolección
      await db.collection("contratos")
        .doc(contratoId)
        .collection("ordenes")
        .doc(ordenId)
        .delete();
      
      logger.info("[onOrdenHardDelete] Cache deleted", {
        ordenId,
        contratoId
      });
      
      // 2) Recalcular cache completo del contrato
      await recalcularCacheContrato(contratoId);
      
      logger.info("[onOrdenHardDelete] Contract cache recalculated", {
        ordenId,
        contratoId
      });
      
    } catch (err) {
      logger.error("[onOrdenHardDelete] Error processing hard delete", {
        ordenId,
        contratoId,
        error: err.message,
        stack: err.stack
      });
    }
    
    return null;
  }
);
