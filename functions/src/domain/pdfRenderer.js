const fs   = require("fs");
const path = require("path");
const { db } = require("../lib/admin");

const ITBMS_RATE = 0.07;

async function attachVerificationFromMirror(contrato, fallbackDocId) {
  const verifSnap = await db.collection("verificaciones").doc(fallbackDocId).get();

  if (!verifSnap.exists) {
    const err = new Error("Verificación no encontrada en 'verificaciones'.");
    err.code = "VERIF_NOT_FOUND";
    throw err;
  }
  const v = verifSnap.data();

  contrato.firma_codigo = v.firma_codigo || contrato.firma_codigo;
  contrato.firma_url    = v.firma_url    || contrato.firma_url;
  contrato.firma_hash   = v.firma_hash   || contrato.firma_hash;
  contrato.fecha_aprobacion = v.fecha_aprobacion || contrato.fecha_aprobacion;

  return {
    nombre: v.aprobado_por_nombre || "—",
    cargo:  v.aprobado_por_rol    || "Administrador",
    email:  v.aprobado_por_email  || "—"
  };
}

function buildContractHtmlForPdf(contrato, vendedorInfo = {}, aprobadorInfo = {}) {
  const templatePath = path.join(__dirname, "../../templates", "imprimir-contrato.html");
  let html = fs.readFileSync(templatePath, "utf8");

  const chipAccion    = `<span class="chip">${contrato.accion || "—"}</span>`;
  const chipDuracion  = `<span class="chip">${contrato.duracion || "—"}</span>`;
  const chipEstado    = `<span class="chip ${contrato.estado === "activo" ? "estado-activo-chip" : contrato.estado === "pendiente_aprobacion" ? "estado-pendiente-chip" : "estado-inactivo-chip"}">${contrato.estado || "—"}</span>`;

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

  const badge = `<div style="padding:4px 10px; border:1px solid #333; border-radius:6px; font-size:12px;">${contrato.tipo_contrato || ""}</div>`;
  html = html.replace("{{TIPO_CONTRATO}}", badge);

  let fechaAprobacion = "";
  if (contrato.fecha_aprobacion) {
    const f = contrato.fecha_aprobacion.toDate ? contrato.fecha_aprobacion.toDate() : new Date(contrato.fecha_aprobacion);
    fechaAprobacion = f.toLocaleString("es-PA");
  }
  html = html.replace("{{FECHA_APROBACION}}", fechaAprobacion);

  let equiposRows = "";
  (contrato.equipos || []).forEach((eq, i) => {
    const cantidad = Number(eq.cantidad || 0);
    const precio   = Number(eq.precio || 0);
    const total    = cantidad * precio;
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

  const subtotal  = (contrato.equipos || []).reduce((acc, eq) => acc + (Number(eq.cantidad||0)*Number(eq.precio||0)), 0);
  const itbms     = +(subtotal * ITBMS_RATE).toFixed(2);
  const totalCon  = +(subtotal + itbms).toFixed(2);

  html = html.replace("{{SUBTOTAL}}", subtotal.toFixed(2));
  html = html.replace("{{ITBMS}}", itbms.toFixed(2));
  html = html.replace("{{TOTAL_CON_ITBMS}}", totalCon.toFixed(2));
  html = html.replace("{{OBSERVACIONES}}", contrato.observaciones || "—");

  const fechaVend    = contrato.fecha_modificacion?.toDate?.() ? contrato.fecha_modificacion.toDate() : new Date();
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

  html = html.replace("{{VERIF_CONTRATO_ID}}", contrato.contrato_id || "");
  html = html.replace("{{VERIF_CODIGO}}", contrato.firma_codigo || "NO APROBADO");
  html = html.replace("{{VERIF_URL}}", contrato.firma_url || "—");

  let qrHtml = "";
  if (contrato.firma_url) {
    qrHtml = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=100x100&data=${encodeURIComponent(contrato.firma_url)}" alt="QR Verificación">`;
  }
  html = html.replace("{{QR_VERIFICACION}}", qrHtml);

  html = html.replace("{{FIRMA_ACEPTACION_NOMBRE}}", contrato.representante || "__________________");
  html = html.replace("{{FIRMA_ACEPTACION_EMPRESA}}", contrato.cliente_nombre || "__________________");

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

module.exports = { attachVerificationFromMirror, buildContractHtmlForPdf };
