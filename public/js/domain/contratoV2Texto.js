// Texto legal del contrato v2 — UNA SOLA FUENTE para el documento interno
// (contratos/documento.html) y la página pública de firma (/firmar/). Si el
// asesor legal ajusta una cláusula, se toca SOLO aquí.
// Numeración: secciones 1-4 en el cuerpo del documento; cláusulas 5-18 abajo.
window.ContratoV2Texto = {

  // Versión del texto legal. Se estampa en cada solicitud de firma junto con
  // una COPIA CONGELADA del texto: lo que el cliente firma queda amarrado a
  // esta versión aunque las cláusulas cambien después. Subirla en CADA cambio
  // de fondo al texto.
  version: 'v2-2026-08-31',

  // Texto del ANEXO (aumento / regularización). Igual que el contrato: se
  // congela en la solicitud de firma junto con la versión.
  anexoIntro(regu) {
    return regu
      ? `Formaliza equipos que <b>ya están en poder de EL CLIENTE</b>: al firmarse, quedan
         incorporados al contrato marco con las tarifas de la tabla de arriba y su período
         corre <b>desde la firma</b> — no hay entrega pendiente.`
      : `Las líneas de la tabla de arriba se AGREGAN al contrato marco y forman parte
         integral de él (cláusula 18 — administración por anexos), con su propio período
         cuando aplique.`;
  },
  anexoMarco:
    `En lo no modificado por este anexo, rigen íntegras las condiciones del contrato marco,
     incluidas garantía (cláusula 8), tarifas y pagos (cláusulas 9–11), valor de reposición
     (cláusula 15) y terminación y bajas (cláusula 17).`,

  // Sección 3 (caja) — inventario por serial.
  inventarioHtml:
    `Los equipos se identifican por serial en el <b>Anexo A</b>, parte integral de este
     contrato, con iniciales de ambas partes en cada página. El Anexo A registra únicamente
     seriales verificados: los asignados por bodega o los levantados en verificación conjunta
     con EL CLIENTE al momento de la firma.`,

  // Sección 4 (caja) — vigencia; durHtml ya viene formateado (p.ej. "<b>dieciocho (18) meses</b>").
  vigenciaHtml(durHtml) {
    return `Este contrato rige por ${durHtml} desde su firma. La renovación se documenta
     mediante <b>anexo firmado por EL CLIENTE</b>. Mientras el anexo de renovación no se
     suscriba, el servicio continuará mes a mes bajo las tarifas vigentes, y EL CLIENTE podrá
     darlo por terminado con <b>sesenta (60) días</b> de aviso escrito. Los aumentos,
     reemplazos, traspasos y bajas de equipos se documentan igualmente por anexos firmados
     que forman parte integral de este contrato, cada uno con su propio período cuando aplique.`;
  },

  // Cláusulas 5-18 como <li> (el contenedor pone <ol class="clausulas">).
  clausulasHtml: `
    <li><b>5. SERVICIO.</b> LA EMPRESA brindará a EL CLIENTE un servicio de comunicación privado,
      en condiciones óptimas, las veinticuatro (24) horas del día, a través de ondas de radio y/o
      telefonía conforme al desarrollo tecnológico disponible en la República de Panamá, dentro de
      las áreas de cobertura indicadas en la Sección 2. EL CLIENTE autoriza el
      monitoreo del sistema para control de calidad de la señal.</li>

    <li><b>6. DISPONIBILIDAD.</b> El servicio estará sujeto a limitaciones o interrupciones por
      causas fuera del control de LA EMPRESA (regulaciones, topografía, condiciones ambientales,
      suministro eléctrico, servicios de terceros, mal uso por EL CLIENTE, fuerza mayor o caso
      fortuito). LA EMPRESA podrá suspender temporalmente el servicio por mantenimiento o
      instalación de nuevos equipos, procurando el menor impacto.</li>

    <li><b>7. EQUIPOS Y PROPIEDAD.</b> La propiedad de cada equipo consta en el Anexo A.
      <ul class="sub">
        <li><b>Modalidad venta:</b> EL CLIENTE declara recibir en perfecto estado los equipos
          identificados como de su propiedad, y es responsable de su uso.</li>
        <li><b>Modalidad alquiler:</b> los equipos identificados como propiedad de LA EMPRESA
          permanecen en poder de EL CLIENTE para su uso, sin transferencia de propiedad, debiendo
          cuidarlos con la diligencia de un buen padre de familia. El alquiler incluye la batería
          de fábrica con la activación; las baterías subsiguientes corren por cuenta de EL CLIENTE.</li>
      </ul></li>

    <li><b>8. GARANTÍA.</b> Los equipos adquiridos por EL CLIENTE tendrán <b>doce (12)
      meses</b> de garantía que incluye mano de obra y piezas por daños o desperfectos no
      atribuibles a mal uso o negligencia. Si el equipo no puede repararse en los talleres de LA
      EMPRESA, se enviará a fábrica estando vigente la garantía. Cubierta frontal, teclado, antena
      y batería corren por cuenta de EL CLIENTE.</li>

    <li><b>9. TARIFAS Y AJUSTES.</b> EL CLIENTE se obliga al pago de las tarifas y cargos de la
      Sección 2 y de los que ambas partes acepten mediante anexo firmado.
      Las tarifas podrán modificarse notificándolo LA EMPRESA por anuncio publicado con treinta
      (30) días y por escrito a EL CLIENTE con sesenta (60) días de antelación; EL CLIENTE podrá
      dar por terminado el contrato por escrito dentro de los quince (15) días siguientes, de lo
      contrario se entenderá aceptada la modificación.</li>

    <li><b>10. PAGOS Y MORA.</b> EL CLIENTE pagará dentro de los cinco (5) primeros días de cada mes.
      La demora causará un recargo del dos por ciento (2%) mensual sobre la suma
      adeudada y la suspensión del servicio; los gastos de cobro, incluidos los
      legales, correrán por cuenta de EL CLIENTE.</li>

    <li><b>11. FORMAS DE PAGO.</b> EL CLIENTE podrá pagar por tarjeta de crédito, descuento directo,
      ACH o sistema Clave. La autorización de cargo a tarjeta será irrevocable durante la vigencia
      del contrato y sus renovaciones; si la tarjeta fuera cancelada o rechazada, EL CLIENTE deberá
      autorizar otra en un máximo de siete (7) días, de lo contrario el servicio será suspendido y
      aplicará la cláusula 17.</li>

    <li><b>12. RESPONSABILIDAD.</b> La responsabilidad de LA EMPRESA por fallo o imposibilidad de
      proveer el servicio se limita al <b>crédito por la interrupción</b>, sin sobrepasar un mes de
      servicio o su prorrateo. EL CLIENTE reconoce que las interrupciones en telecomunicaciones son
      frecuentes y de difícil comprobación, por lo que LA EMPRESA <b>no responderá por pérdida de
      ganancias, pérdida de negocio ni daños indirectos o punitivos</b> derivados de la ejecución o
      no ejecución de este contrato, ni por suspensiones por causas fuera de su control (caso
      fortuito, fuerza mayor, restricciones gubernamentales, topografía, o desconexión de enlaces
      de terceros, incluido Internet).</li>

    <li><b>13. LIBERACIÓN.</b> EL CLIENTE mantendrá libre de reclamos y sanciones a LA EMPRESA por el
      mal uso o uso indebido del servicio o del equipo, y la exime de responsabilidad por daños
      causados por dicho uso. EL CLIENTE autoriza el suministro de su información a las autoridades
      competentes que la soliciten, y autoriza a LA EMPRESA a obtener y suministrar referencias
      financieras y crediticias cuando sea requerido.</li>

    <li><b>14. OBLIGACIONES DE EL CLIENTE.</b>
      <ul class="sub">
        <li>Pagar puntualmente y mantener vigentes las autorizaciones de cobro; en caso de
          incumplimiento, autoriza el reporte a la Asociación Panameña de Crédito (APC).</li>
        <li>Usar el equipo y el servicio de forma diligente, para comunicaciones lícitas, conforme
          a las recomendaciones del fabricante y las normas vigentes.</li>
        <li>No ceder, vender, transferir, pignorar ni gravar los equipos de LA EMPRESA, ni ceder
          este contrato sin autorización expresa.</li>
        <li>Reportar de inmediato interferencias, y por escrito el robo o pérdida de cualquier
          equipo, con la denuncia correspondiente.</li>
        <li>No manipular el equipo inadecuadamente y llevarlo a desprogramación al terminar el
          contrato.</li>
        <li>Cumplir las disposiciones de la Autoridad Nacional de los Servicios Públicos.</li>
      </ul></li>

    <li><b>15. VALOR DE REPOSICIÓN.</b> En la modalidad de alquiler, EL CLIENTE responderá por
      la pérdida o daño irreparable de cada equipo conforme al <b>valor de reposición por unidad
      indicado en el Anexo A</b>, más ITBMS, valores que declara conocer y aceptar con su firma.</li>

    <li><b>16. DEPÓSITO.</b> En la modalidad de alquiler, EL CLIENTE entrega el depósito de garantía
      acordado, sin intereses, que se devolverá en el último mes del período estando EL CLIENTE al
      día. En renovaciones, LA EMPRESA podrá eximirlo a su criterio.</li>

    <li><b>17. TERMINACIÓN ANTICIPADA Y BAJAS.</b> La terminación del contrato por EL CLIENTE
      causará una liquidación equivalente a tres (3) meses de mensualidad, <b>pagadera de
      inmediato</b> en todos los casos: antes del vencimiento del período, en concepto de
      penalidad; vencido el período y en continuidad mes a mes, en concepto de sesenta (60) días
      de preaviso — durante los cuales EL SERVICIO permanecerá activo — más treinta (30) días de
      penalidad. Toda terminación obliga a la devolución de los equipos de LA EMPRESA.
      Las bajas parciales de equipos se documentan por anexo y se liquidan por equipo bajo
      la misma regla, según el tramo de cada uno.</li>

    <li><b>18. ADMINISTRACIÓN POR ANEXOS Y NOTIFICACIONES.</b> Toda modificación de equipos,
      tarifas, períodos o partes se documentará mediante anexos firmados, numerados y verificables
      digitalmente, que forman parte integral de este contrato. Las notificaciones se harán
      por escrito a los correos y direcciones indicados en la Sección 1. Este documento y sus
      anexos son verificables mediante el código impreso al pie.</li>`,
};
