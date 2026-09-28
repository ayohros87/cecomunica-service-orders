// Cotización de TALLER vs cotización de VENTAS (2026-09-25, pedido de Solangel).
//
// POR QUÉ EXISTE. El módulo de cotizaciones nació para ventas y el taller lo
// usaba prestado: su cotización salía con las condiciones de una venta de
// equipos ("4–6 semanas tras orden de compra", "50% anticipo"), firmada por
// un "Ejecutivo de Ventas", con el mismo asunto que una propuesta comercial y
// sin forma de decir "el cliente aceptó, a facturar" más que "Convertida a
// venta". Aquí vive TODO lo que distingue a la de taller, en un solo sitio,
// porque la leen cinco pantallas (editor, detalle, listado, impresión y la
// vista pública que abre el cliente) y cada copia que existía ya decía algo
// distinto.
//
// Puro: sin DOM ni Firestore. Lo cargan también la vista pública
// (verify/cotizacion.html) y los tests de node.
(() => {
  // Una cotización es de taller si nació de una orden de servicio. El
  // `orden_id` cubre las anteriores a que existiera `origen`.
  function esTaller(doc) {
    return (doc?.origen || '') === 'orden' || !!doc?.orden_id;
  }

  // Condiciones de una reparación (Alberto, 2026-09-25: "reparaciones tienen
  // una garantía de 30 días"). Van escritas en el documento al crearlo, así
  // que cambiar este texto mañana no reescribe lo que ya se le envió a nadie.
  // Solangel las puede corregir en la pantalla de cotizar la orden.
  const CONDICIONES_TALLER = [
    { k: 'Garantía de la reparación', v: '30 días sobre el trabajo realizado' },
  ];

  // Cargo del firmante cuando la ficha del usuario no lo trae. El de la
  // persona manda siempre (usuarios.cargo, lo pone administración en
  // Usuarios); esto es solo el respaldo por rol, sin adivinar el género.
  // Solo la jefatura de taller: en ventas el respaldo sigue siendo el de
  // siempre, para no cambiarle a nadie lo que ya imprime.
  const CARGO_POR_ROL = {
    jefe_taller: 'Jefe(a) de Taller',
  };
  const CARGO_VENTAS = 'Ejecutivo de Ventas';
  function cargoPorRol(rol) {
    return CARGO_POR_ROL[String(rol || '')] || '';
  }

  // El cargo que se imprime. Orden: lo que quedó guardado EN la cotización al
  // crearla (no cambia después) → el del catálogo de firmantes → el del rol →
  // el genérico del tipo de documento.
  function cargoFirmante(doc, ej) {
    return String(doc?.ejecutivo_cargo || ej?.rol || ej?.cargo || '').trim()
      || (esTaller(doc) ? CARGO_POR_ROL.jefe_taller : CARGO_VENTAS);
  }

  function tituloDocumento(doc) {
    return esTaller(doc) ? 'Cotización de servicio técnico' : 'Cotización';
  }

  // Asunto del correo al cliente. El de taller nombra la orden: es el número
  // que el cliente tiene en su comprobante de recepción del equipo.
  function asunto(doc, { clienteNombre = '' } = {}) {
    const id = doc?.cotizacion_id || doc?.id || '';
    const cli = String(clienteNombre || doc?.cliente_nombre || '').trim();
    if (esTaller(doc)) {
      const orden = doc?.orden_id ? ` · Orden ${doc.orden_id}` : '';
      return `Cotización de servicio técnico ${id}${orden}${cli ? ` · ${cli}` : ''} · Cecomunica`;
    }
    return `Cotización ${id}${cli ? ` · ${cli}` : ''} · Cecomunica`;
  }

  // Nota al pie. La de ventas habla de "orden de compra" e inventario; una
  // reparación no tiene nada de eso.
  function notaLegal(doc) {
    const base = 'Precios expresados en dólares de los Estados Unidos de América (USD), equivalentes a Balboas (PAB). Esta cotización no constituye factura fiscal. Los precios pueden variar sin previo aviso una vez vencida la validez indicada.';
    return esTaller(doc)
      ? `${base} Piezas sujetas a disponibilidad al momento de aceptar la cotización.`
      : `${base} Equipos sujetos a disponibilidad de inventario al momento de la orden de compra.`;
  }

  // Cómo aceptó el cliente. Casi nunca es por la página: responde el correo o
  // lo dice por teléfono o en el mostrador, y el proceso sigue igual
  // (Alberto, 2026-09-25).
  const MEDIOS_ACEPTACION = [
    ['correo', 'Por correo'],
    ['verbal', 'Verbalmente (teléfono o en persona)'],
    ['pagina', 'Desde el enlace de la cotización'],
    ['otro', 'Otro medio'],
  ];
  function medioLabel(k) {
    return (MEDIOS_ACEPTACION.find(([c]) => c === k) || [null, k || '—'])[1];
  }

  // El nombre de cada estado DEPENDE del tipo. En el taller 'convertida'
  // significa "el cliente aceptó y ya está en facturación": decir "Convertida
  // a venta" sobre una reparación no le dice nada a nadie. Mismo valor en la
  // base (los reportes y la bandeja de facturación no cambian); cambia lo que
  // se lee.
  function estadoLabel(estado, doc, fallback) {
    if (esTaller(doc) && estado === 'convertida') return 'Aceptada';
    return fallback || estado || '—';
  }

  // Los pasos que se ven en el detalle de una de taller, en orden. Una sola
  // acción principal por paso: el que sigue es el que se ofrece.
  function pasos(doc) {
    const e = String(doc?.estado || 'borrador');
    const fact = doc?.facturacion?.estado || null;
    const cerradaMal = ['rechazada', 'descartada', 'vencida'].includes(e);
    return [
      { k: 'borrador', t: 'Preparada', done: e !== 'borrador' },
      { k: 'enviada', t: 'Enviada al cliente', done: ['enviada', 'convertida'].includes(e) || !!doc?.enviada_en },
      { k: 'aceptada', t: 'Aceptada · en facturación', done: e === 'convertida' },
      { k: 'facturada', t: fact === 'facturada' && doc?.facturacion?.factura
          ? `Facturada · ${doc.facturacion.factura}` : 'Facturada', done: fact === 'facturada' },
    ].map((p) => ({ ...p, cortada: cerradaMal && !p.done }));
  }

  const api = {
    esTaller, CONDICIONES_TALLER, CARGO_POR_ROL, cargoPorRol, cargoFirmante,
    tituloDocumento, asunto, notaLegal, MEDIOS_ACEPTACION, medioLabel, estadoLabel, pasos,
  };
  if (typeof window !== 'undefined') window.CotizacionTaller = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
