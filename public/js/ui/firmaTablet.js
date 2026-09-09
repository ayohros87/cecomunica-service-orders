// @ts-nocheck
// FirmaTablet — el protocolo de la tablet de firmas del mostrador, sin UI.
//
// La tablet (Lenovo del mostrador, /firmar/tablet.html) vive con la página
// abierta escuchando `firmas_tablet` con estado 'pendiente'. Quien atiende
// crea una solicitud desde la PC, el cliente firma allá y la solicitud pasa a
// 'firmada' con la URL de la firma ya subida a Storage; la PC la recoge por
// onSnapshot.
//
// POR QUÉ ESTE ARCHIVO. Ese ida y vuelta estaba copiado en ordenes-flujo.js
// (entrega/recepción) y en ordenes-devolucion.js (acuse), y al aparecer un
// tercer punto de firma —la tanda de entrega parcial— la copia ya no se
// sostenía: son tres sitios donde acordarse de cancelar la solicitud
// pendiente, de soltar el listener y de no pisar una firma vieja. Aquí vive
// el protocolo; cada pantalla pone su propia UI encima.
//
// Lo que este módulo NO hace a propósito: pintar nada. Los ids de los bloques
// de espera/listo son de cada pantalla, y meterlos aquí habría cambiado un
// duplicado por un acoplamiento peor.
//
// El `tipo` tiene que ser uno de los que la tablet sabe pintar
// (TIPOS en /firmar/tablet.html: 'acuse_devolucion', 'recepcion', 'entrega').
// Una entrega parcial usa 'entrega': el título, la etiqueta del nombre y las
// unidades viajan en el propio documento, así que la tablet no necesita saber
// que existen las tandas.
window.FirmaTablet = (() => {

  const TIPOS = ['acuse_devolucion', 'recepcion', 'entrega'];

  // Ventana de frescura de una solicitud, la misma que aplica la tablet para
  // decidir qué sigue mostrando (TIPOS + corte de 4 h en /firmar/tablet.html).
  // Más allá de eso, una solicitud es de otro día y no se retoma.
  const VENTANA_FRESCA_MS = 4 * 60 * 60 * 1000;

  // La tablet vive EN EL MOSTRADOR. En un teléfono o pantalla táctil (un
  // vendedor en la calle) la opción se oculta: parecería el acceso para
  // firmar en el propio dispositivo, y ahí el recuadro de la pantalla ya
  // cumple. Mismo corte que .btn-firma-tablet en ordenes-index.css.
  function disponible() {
    try {
      return !window.matchMedia('(max-width: 768px), (hover: none) and (pointer: coarse)').matches;
    } catch (e) { return true; }
  }

  // Crea la solicitud y devuelve su id. `unidades` es lo que el cliente ve
  // en la tablet antes de firmar: [{serial, modelo, detalle}].
  async function solicitar({
    tipo = 'entrega', ordenId, titulo, nombreLabel, leyenda = null,
    unidades = [], clienteNombre = '', contratoId = null, numero = null,
    copiaA = null,
  } = {}) {
    if (!TIPOS.includes(tipo)) {
      // Un tipo que la tablet no pinta deja la solicitud invisible: el
      // operador se queda mirando "esperando la firma" para siempre.
      throw new Error(`La tablet no sabe mostrar el tipo "${tipo}".`);
    }
    if (!ordenId) throw new Error('Falta la orden para la solicitud de firma.');
    const user = firebase.auth().currentUser;
    const ref = await firebase.firestore().collection('firmas_tablet').add({
      tipo,
      estado: 'pendiente',
      orden_id: ordenId,
      cliente_nombre: clienteNombre || '',
      contrato_id: contratoId || null,
      numero: numero || ordenId,
      titulo: titulo || 'Acuse de recibo de equipos',
      nombre_label: nombreLabel || 'Nombre de quien recibe',
      leyenda,
      copia_a: copiaA,
      unidades,
      creado_at: firebase.firestore.FieldValue.serverTimestamp(),
      creado_por_uid: user?.uid || null,
      creado_por_email: user?.email || null,
    });
    return ref.id;
  }

  // Escucha UNA solicitud. Devuelve la función para soltar el listener.
  // `onFirmada` recibe {url, nombre, cedula}; `onCancelada` no recibe nada
  // (alguien la canceló desde la tablet o desde otra pestaña).
  function escuchar(id, { onFirmada, onCancelada } = {}) {
    if (!id) return () => {};
    return firebase.firestore().collection('firmas_tablet').doc(id)
      .onSnapshot((s) => {
        const d = s.exists ? s.data() : null;
        if (!d) return;
        if (d.estado === 'firmada' && typeof onFirmada === 'function') {
          onFirmada({
            url: d.firma?.url || null,
            nombre: d.firma?.nombre || '',
            cedula: d.firma?.cedula || '',
          });
        } else if (d.estado === 'cancelada' && typeof onCancelada === 'function') {
          onCancelada();
        }
      });
  }

  // Corrige el correo de la copia con la tablet YA en la mano del cliente: él
  // lo ve en pantalla y avisa si está mal antes de firmar. La tablet repinta
  // en vivo. Es informativo — quién recibe la copia lo decide después el
  // flujo que guarda el acuse, con el estado vigente de su casilla.
  // Silencioso: si la solicitud ya se firmó, el dato dejó de importar.
  async function actualizarCopia(id, correo) {
    if (!id) return;
    try {
      await firebase.firestore().collection('firmas_tablet').doc(id)
        .update({ copia_a: correo || null });
    } catch (e) { /* ya firmada o cancelada */ }
  }

  // Solicitudes VIVAS de una orden, para retomarlas al reabrir la pantalla.
  // Existe porque hay flujos donde la solicitud sobrevive al modal (el acuse
  // de devolución): sin esto, cerrar la ventana dejaba al cliente firmando
  // contra nadie.
  //
  // `excluir` son los ids ya aplicados (acuses guardados): una solicitud que
  // ya se consumió no se vuelve a retomar.
  //
  // La 'firmada' solo se devuelve si es FRESCA (4 h, la misma ventana que
  // muestra la tablet). Una firma de otra tanda, de otro día, pegada a lo que
  // se está capturando ahora sería una constancia falsa.
  //
  // Solo igualdades + in: no necesita índice compuesto.
  async function vivasDeOrden(ordenId, tipo, { excluir = [] } = {}) {
    const vacio = { pendiente: null, firmada: null };
    if (!ordenId || !tipo) return vacio;
    try {
      const s = await firebase.firestore().collection('firmas_tablet')
        .where('orden_id', '==', ordenId)
        .where('estado', 'in', ['pendiente', 'firmada'])
        .where('tipo', '==', tipo)
        .get();
      const fuera = new Set(excluir.filter(Boolean));
      const docs = s.docs.filter(d => !fuera.has(d.id));
      const frescoMs = Date.now() - VENTANA_FRESCA_MS;
      return {
        pendiente: docs.find(d => d.data().estado === 'pendiente') || null,
        firmada: docs.find(d => d.data().estado === 'firmada'
          && (d.data().creado_at?.toDate?.().getTime() || 0) >= frescoMs) || null,
      };
    } catch (e) {
      // Sin permiso, o la colección aún no existe: no es crítico — el
      // operador simplemente vuelve a mandar la solicitud.
      return vacio;
    }
  }

  // Cancela una solicitud que quedó colgando (el operador cerró el modal).
  // Silencioso a propósito: si ya la firmaron o cancelaron, no hay nada que
  // hacer y no es un error que merezca molestar a nadie.
  async function cancelar(id) {
    if (!id) return;
    try {
      await firebase.firestore().collection('firmas_tablet').doc(id)
        .update({ estado: 'cancelada' });
    } catch (e) { /* ya firmada o cancelada */ }
  }

  // Las unidades tal como las lee el cliente en la tablet, a partir de los
  // equipos de una orden. Los accesorios van en `detalle` porque es lo que
  // el cliente revisa antes de firmar.
  const ACC = [['bateria', 'Batería'], ['antena', 'Antena'], ['clip', 'Clip'],
               ['cargador', 'Cargador'], ['fuente', 'Fuente'], ['cubrepolvo', 'Cubrepolvo']];
  function unidadesDeEquipos(equipos) {
    return (Array.isArray(equipos) ? equipos : [])
      .filter(e => e && !e.eliminado)
      .map(e => ({
        serial: e.numero_de_serie || e.SERIAL || e.serial || '—',
        modelo: e.modelo || '',
        detalle: ACC.filter(([k]) => e[k]).map(([, l]) => l).join(', ') || 'Sin accesorios',
      }));
  }

  return { TIPOS, VENTANA_FRESCA_MS, disponible, solicitar, escuchar,
           actualizarCopia, vivasDeOrden, cancelar, unidadesDeEquipos };
})();
