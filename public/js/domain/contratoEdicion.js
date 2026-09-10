// @ts-nocheck
/* =============================================================
   ¿Se puede editar este contrato? — criterio ÚNICO (2026-09-10).

   Estaba escrito tres veces, con tres respuestas distintas:
     · editar-contrato.js  bloqueaba 'activo' y el enlace de firma abierto.
     · clientes-centro.js  bloqueaba 'activo' y su propia noción de enlace.
     · contratos-list.js   bloqueaba 'activo', 'aprobado' y 'anulado' — o sea
       ni siquiera OFRECÍA editar un contrato aprobado, que es justo el caso
       que el editor sí permite (con reaprobación y aviso a ventas).
   Resultado: el Centro ofrecía "Editar…", el usuario hacía clic, y la página
   lo devolvía con un aviso. O al revés: la lista escondía una edición que sí
   era legal.

   Aquí vive el criterio y nada más. El permiso de ROL es otra pregunta
   (canRole 'editar-contrato') y se responde aparte: una cosa es si el
   contrato admite cambios y otra si esta persona los puede hacer.

   Los dos candados, con su porqué:
     · 'activo' — el contrato ya se firmó y se activó. Los cambios van por
       anexo, ajuste o renovación, no reescribiendo el papel firmado.
     · enlace de firma abierto — el cliente está leyendo una copia congelada;
       editar por debajo lo dejaría firmando otra cosa (2026-09-04). Tiene
       salida: retirar el enlace de firma y volver a intentar.
   ============================================================= */
window.ContratoEdicion = {
  // → { ok, motivo, texto, salida }
  //   motivo: null | 'activo' | 'firma_pendiente'
  //   salida: qué puede hacer el usuario para desbloquearlo (o null si no hay)
  puedeEditarse(c) {
    if (!c) return { ok: false, motivo: 'inexistente', texto: 'El contrato no existe.', salida: null };

    if (c.estado === 'activo') {
      return {
        ok: false,
        motivo: 'activo',
        texto: 'Un contrato activo ya no se edita: los cambios van por anexo, ajuste o renovación.',
        salida: null,
      };
    }
    if (c.firma_solicitud_estado === 'pendiente') {
      return {
        ok: false,
        motivo: 'firma_pendiente',
        texto: 'El cliente tiene un enlace de firma abierto sobre una copia congelada: retíralo primero.',
        salida: 'retirar_firma',
      };
    }
    return { ok: true, motivo: null, texto: '', salida: null };
  },

  // Azúcar para los sitios que solo quieren el booleano.
  ok(c) { return this.puedeEditarse(c).ok; },

  // Editar un contrato YA APROBADO no es lo mismo que editar un borrador: si
  // cambia lo económico o el plazo, vuelve a pendiente de aprobación (Alberto
  // 2026-09-04: "el vendedor puede ajustar, pero sin reaprobación nadie se
  // entera"). El QUÉ cambió lo decide ContratoTarifario.requiereReaprobacion;
  // aquí solo se dice si esa pregunta aplica.
  aplicaReaprobacion(c) { return c?.estado === 'aprobado'; },
};
