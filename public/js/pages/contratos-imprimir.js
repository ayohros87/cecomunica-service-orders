// @ts-nocheck
    const params = new URLSearchParams(window.location.search);
    const contratoId = params.get("id");

async function cargarContrato() {
  const data = await ContratosService.getByContratoId(contratoId);
  if (!data) return alert("Contrato no encontrado");

  // --- declarar antes de usar ---
  let nombreVendedorResuelto = null;
  let cargoVendedor = "Vendedor";

  // Tipo de contrato (badge)
  const tipo = data.tipo_contrato || "";
  const tipoBadge = document.getElementById("tipoContratoBadge");
  if (tipoBadge) tipoBadge.textContent = tipo ? `Tipo: ${tipo}` : "Tipo: —";

  // Chips de resumen (si los agregas en el paso 2)
  const chipTipo = document.getElementById("chipTipo");
  if (chipTipo) chipTipo.textContent = data.tipo_contrato || "—";
  const chipAccion = document.getElementById("chipAccion");
  if (chipAccion) chipAccion.textContent = data.accion || "—";
  const chipDur = document.getElementById("chipDuracion");
  if (chipDur) chipDur.textContent = data.duracion || "—";
const chipEstado = document.getElementById("chipEstado");
if (chipEstado) {
  chipEstado.textContent =
    data.estado === "activo" ? "Activo" :
    data.estado === "aprobado" ? "Aprobado" :
    data.estado === "pendiente_aprobacion" ? "Pendiente aprobación" :
    data.estado === "anulado" ? "Anulado" :
    "Inactivo";

  chipEstado.classList.remove("estado-activo-chip","estado-aprobado-chip","estado-pendiente-chip","estado-inactivo-chip","estado-cancelado-chip");
  const cls =
    data.estado === "activo" ? "estado-activo-chip" :
    data.estado === "aprobado" ? "estado-aprobado-chip" :
    data.estado === "pendiente_aprobacion" ? "estado-pendiente-chip" :
    data.estado === "anulado" ? "estado-cancelado-chip" :
    "estado-inactivo-chip";
  chipEstado.classList.add(cls);
}


  // Fechas de aprobación en layout
if (data.estado === "activo" && data.fecha_aprobacion) {
  const fecha = new Date(data.fecha_aprobacion.toDate ? data.fecha_aprobacion.toDate() : data.fecha_aprobacion);
  const fechaFormato = fecha.toLocaleDateString("es-PA");
  // Solo actualizar fecha en la firma de Cecomunica
  const firmaCecom = document.querySelector("#firmaCecomunica .fecha-aprobacion");
  if (firmaCecom) firmaCecom.textContent = `Fecha: ${fechaFormato}`;
}


  // Datos cliente
  document.getElementById("contrato_id").textContent = data.contrato_id || "";
  document.getElementById("cliente_nombre").textContent = data.cliente_nombre || "";
  document.getElementById("cliente_direccion").textContent = data.cliente_direccion || data.direccion || "";
  document.getElementById("cliente_telefono").textContent = data.cliente_telefono || data.telefono || "";
    // Construye "RUC - DV" con fallbacks para contratos antiguos
  const rucdv = (data.cliente_rucdv && String(data.cliente_rucdv).trim())
    ? data.cliente_rucdv
    : ((data.cliente_ruc || data.ruc || "") + (data.cliente_dv ? (" - DV" + data.cliente_dv) : "")).trim();

  document.getElementById("cliente_ruc").textContent = rucdv || "—";
  document.getElementById("firmaClienteLabel").textContent = `Firma del Cliente – ${data.cliente_nombre || ""}`;
  document.getElementById("nombreRepresentante").textContent = data.representante || "____________________";
  document.getElementById("rucRepresentante").textContent = data.representante_cedula || "________________";
  document.getElementById("observaciones").textContent = data.observaciones || "—";
  const repEl = document.getElementById("cliente_representante");
  if (repEl) repEl.textContent = data.representante || "";


  // Evitar error si #total no existe en el HTML actual
  const totalEl = document.getElementById("total");
  if (totalEl) totalEl.textContent = (data.total || 0).toFixed(2);

  // Tabla equipos + totales (ITBMS 7%)
    const tbody = document.getElementById("tablaEquipos");
    tbody.innerHTML = "";

  
    let subtotal = 0;
    (data.equipos || []).forEach((eq, i) => {

    const cantidad = Number(eq.cantidad || 0);
    const precio   = Number(eq.precio || 0);
    const filaTotal = cantidad * precio;
    subtotal += filaTotal;
    const tr = document.createElement("tr");
    const desc = (eq.descripcion || "Equipos de Comunicación");
    tr.innerHTML = `
      <td>${i+1}</td>
      <td>${desc}</td>
      <td>${eq.modelo || ""}</td>
      <td>${cantidad}</td>
      <td>$${precio.toFixed(2)}</td>
      <td>$${filaTotal.toFixed(2)}</td>
    `;
    tbody.appendChild(tr);
  });

  // 👉 Pintar totales usando los campos persistidos y,
  //    si faltan, usando el subtotal calculado arriba.
  const mergedParaTotales = { ...data, subtotal: Number((data.subtotal ?? subtotal) || 0) };
  pintarTotalesImpresion(resolverTotalesParaImpresion(mergedParaTotales));

  // --- Vendedor / Elaborador ---
let vendedorInfo = { nombre: "Vendedor", cargo: "Vendedor", email: "" };

if (data.creado_por_uid) {
  try {
    const docUser = await UsuariosService.getUsuario(data.creado_por_uid);
   if (docUser) {
  const u = docUser;
  vendedorInfo.nombre = u.nombre || u.Nombre || vendedorInfo.nombre; // acepta ambas variantes
  vendedorInfo.cargo  = u.cargo || "Vendedor";
  vendedorInfo.email  = u.email || "";
}


  } catch (e) {
    console.warn("No se pudo leer el usuario (vendedor):", e);
  }
}

  // --- Aprobador ---
let aprobadorInfo = null;
if (data.aprobado_por_uid) {
  try {
    const docApr = await UsuariosService.getUsuario(data.aprobado_por_uid);
    if (docApr) {
      const u = docApr;
      aprobadorInfo = {
        nombre: u.nombre || "________",
        cargo:  u.cargo || (u.rol ? u.rol.charAt(0).toUpperCase() + u.rol.slice(1) : "Administrador"),
        email:  u.email || "________",
      };
    }
  } catch (e) {
    console.warn("No se pudo leer el usuario aprobador:", e);
  }
}
  // Fecha de firma del vendedor
  const tsVend = data.fecha_modificacion || data.fecha_creacion;
  if (tsVend) {
    const fechaVend = tsVend.toDate ? tsVend.toDate() : new Date(tsVend);
    const fechaVendTxt = fechaVend.toLocaleDateString("es-PA");
    const fechaVendEl = document.querySelector("#firmaVendedor .fecha-vendedor");
    if (fechaVendEl) fechaVendEl.textContent = `Fecha: ${fechaVendTxt}`;
  }

 // Firmas electrónicas (activo o aprobado)
if (data.estado === "activo" || data.estado === "aprobado") {
  renderFirmasElectronicas(data, vendedorInfo, aprobadorInfo);
}

 // Términos y condiciones (duración)
  const duracionTexto = data.duracion?.match(/\d+/)?.[0] || "12";
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
  document.getElementById("contenidoCondiciones").textContent = condicionesFinal;
renderVerificacion(data);

}

    cargarContrato();

function renderVerificacion(data) {
  const contId = document.getElementById("verifContratoId");
  const contCod = document.getElementById("verifCodigo");
  const contUrl = document.getElementById("verifUrl");
  const contQR = document.getElementById("qrVerificacion");

// Mostrar QR también si está aprobado
if (!data.firma_url || !data.firma_codigo || (data.estado !== "activo" && data.estado !== "aprobado")) {
  if (contId) contId.textContent = data.contrato_id || "—";
  if (contCod) contCod.textContent = "NO APROBADO";
  if (contUrl) contUrl.textContent = "—";
  if (contQR) contQR.innerHTML = "";
  return;
}


  if (contId) contId.textContent = data.contrato_id || "";
  if (contCod) contCod.textContent = data.firma_codigo;
  if (contUrl) contUrl.textContent = data.firma_url;

  if (contQR) {
    contQR.innerHTML = "";
    const canvas = document.createElement("canvas");
    QRCode.toCanvas(canvas, data.firma_url, { width: 100 }, (err) => {
      if (err) {
        console.error("Error generando QR:", err);
        return;
      }
      contQR.appendChild(canvas);
    });
  }
}

function renderFirmasElectronicas(data, vendedorInfo, aprobadorInfo) {
  const fechaAprob = data.fecha_aprobacion?.toDate?.()
    ? data.fecha_aprobacion.toDate()
    : (data.fecha_modificacion?.toDate?.()
        ? data.fecha_modificacion.toDate()
        : new Date());
  const fechaTxt = fechaAprob.toLocaleString("es-PA");

  // Firma electrónica Cecomunica (aprobador)
  const cecom = document.getElementById("firmaCecomunica");
  if (cecom && aprobadorInfo) {
   cecom.insertAdjacentHTML("afterbegin", `
    <div class="firma-electronica" style="margin-top:8px; border-top:none;">
      ✔ Firmado electrónicamente por ${aprobadorInfo.nombre}<br>
      Cargo: ${aprobadorInfo.cargo}<br>
      Email: ${aprobadorInfo.email}<br>
      Contrato: ${data.contrato_id}<br>
      Fecha y hora: ${fechaTxt}
    </div>
  `);

  }

  // Firma electrónica del vendedor (elaborador)
  const vend = document.getElementById("firmaVendedor");
  if (vend && vendedorInfo) {
    const fechaVendBase = data.fecha_modificacion?.toDate?.()
      ? data.fecha_modificacion.toDate()
      : (data.fecha_creacion?.toDate?.()
          ? data.fecha_creacion.toDate()
          : new Date());

    vend.insertAdjacentHTML("afterbegin", `
    <div class="firma-electronica" style="margin-top:8px; border-top:none;">
      ✔ Firmado electrónicamente por ${vendedorInfo.nombre}<br>
      Cargo: ${vendedorInfo.cargo}<br>
      Contrato: ${data.contrato_id}<br>
      Fecha y hora: ${fechaVendBase.toLocaleString("es-PA")}
    </div>
  `);

  }
}
function round2(n){ return Math.round((Number(n)+Number.EPSILON)*100)/100; }
function fmt(n){ return `$${round2(n).toFixed(2)}`; }

// Usa los valores persistidos si existen; si no, asume histórico 7% aplicado.
// contrato: objeto leído de Firestore.
function resolverTotalesParaImpresion(contrato) {
  const tieneCamposNuevos = typeof contrato.itbms_aplica !== 'undefined';

  const subtotal = Number(contrato.subtotal ?? contrato.total ?? 0);
  const itbmsPorc = Number(contrato.itbms_porcentaje ?? 0.07);

  let itbmsAplica, itbmsMonto, totalConITBMS;

  if (tieneCamposNuevos) {
    itbmsAplica = Boolean(contrato.itbms_aplica);
    itbmsMonto = Number(contrato.itbms_monto ?? 0);
    totalConITBMS = Number(contrato.total_con_itbms ?? subtotal + itbmsMonto);
  } else {
    // Fallback para contratos antiguos (consistencia histórica)
    itbmsAplica = true;
    itbmsMonto = round2(subtotal * itbmsPorc);
    totalConITBMS = round2(subtotal + itbmsMonto);
  }

  const itbmsLabel = itbmsAplica ? `ITBMS (${round2(itbmsPorc*100)}%)` : 'ITBMS EXENTO';

  return { subtotal, itbmsAplica, itbmsPorc, itbmsMonto, totalConITBMS, itbmsLabel };
}

function pintarTotalesImpresion(tot) {
  const $sub = document.getElementById('imp_subtotal');
  const $lbl = document.getElementById('imp_itbms_label');
  const $itb = document.getElementById('imp_itbms');
  const $tot = document.getElementById('imp_total');

  if ($sub) $sub.textContent = fmt(tot.subtotal);
  if ($lbl) $lbl.textContent = tot.itbmsLabel;
  if ($itb) $itb.textContent = fmt(tot.itbmsMonto);
  if ($tot) $tot.textContent = fmt(tot.totalConITBMS);
}
