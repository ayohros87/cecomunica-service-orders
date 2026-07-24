// @ts-nocheck
// FirmaPad — captura de firma manuscrita sobre <canvas>, común a todos los
// puntos donde el cliente firma (acuse de devolución, entrega, cierre de
// visita).
//
// Reemplaza al helper `_wireFirmaCanvas` que estaba copiado en
// ordenes-devolucion.js / ordenes-visita.js / ordenes-flujo.js y que solo
// escuchaba `mouse*` + `touch*`. Ese patrón funciona con el dedo en una
// tablet pero es frágil con mouse y no cubre pads de firma / lápices:
//
//   · Pointer Events (no mouse/touch): un PAD de firma USB o un digitalizador
//     tipo Wacom entra como `pointerType: 'pen'`. Los eventos de puntero los
//     cubren los tres tipos (mouse, pen, touch) con un solo camino de código.
//   · setPointerCapture: con mouse el trazo se sale del recuadro de 140px todo
//     el tiempo. Sin captura, `mouseleave` cortaba el trazo y al volver ya no
//     dibujaba — el operador creía que "no agarra la firma". Con captura el
//     trazo sigue vivo aunque el cursor salga, y termina donde se suelte.
//   · Coordenadas por getBoundingClientRect() para TODOS los punteros. Con
//     captura activa el target del evento deja de ser el canvas, así que
//     `offsetX/offsetY` deja de ser confiable.
//   · Un clic sin arrastre pinta un punto: antes `moveTo` sin `lineTo` no
//     dejaba pixel alguno y el trazo corto no contaba como firma.
//   · isEmpty() por bandera de trazo real, no escaneando pixeles con
//     getImageData (más barato y no depende del relleno de fondo).
//   · La presión (`e.pressure`) modula el grosor: con un pad de firma el
//     trazo sale con el peso natural de la pluma; con mouse queda constante.
//
// Uso:
//   const pad = FirmaPad.mount(canvasEl, { alto: 140, onChange });
//   pad.isEmpty(); pad.clear(); await pad.toBlob(); pad.destroy();
(function () {
  'use strict';

  const ANCHO_BASE = 2;      // px CSS del trazo a presión "neutra"
  const ALTO_DEFAULT = 140;

  function mount(canvas, opts) {
    if (!canvas) return null;
    const o = opts || {};
    const alto = Number(o.alto) || canvas.clientHeight || ALTO_DEFAULT;
    const color = o.color || '#111827';
    const onChange = typeof o.onChange === 'function' ? o.onChange : null;

    const ctx = canvas.getContext('2d');
    let dirty = false;          // ¿hay al menos un trazo real?
    let dibujando = false;
    let movio = false;          // ¿hubo arrastre desde el pointerdown?
    let punteroId = null;
    let ancho = 0, altoCss = 0; // tamaño CSS vigente del backing store

    // ── Backing store en píxeles del dispositivo ────────────────────────
    // El canvas se dibuja en coordenadas CSS (transform = dpr) para que el
    // trazo salga nítido en pantallas HiDPI sin ensuciar la matemática.
    function ajustar(preservar) {
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const cssW = Math.max(1, Math.round(canvas.clientWidth || canvas.offsetWidth || 300));
      const cssH = Math.max(1, Math.round(alto));
      if (cssW === ancho && cssH === altoCss) return;

      // Conserva lo ya firmado al cambiar de tamaño (rotar la tablet, abrir
      // el panel lateral): sin esto un resize borraba la firma en silencio.
      let previo = null;
      if (preservar && dirty && ancho > 0) {
        try { previo = new Image(); previo.src = canvas.toDataURL('image/png'); } catch (e) { previo = null; }
      }

      ancho = cssW; altoCss = cssH;
      canvas.width  = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.lineWidth = ANCHO_BASE;
      if (previo) {
        previo.onload = () => { try { ctx.drawImage(previo, 0, 0, cssW, cssH); } catch (e) {} };
      }
    }

    function pos(ev) {
      const r = canvas.getBoundingClientRect();
      // Touch legacy (fallback sin PointerEvent): las coordenadas viven en
      // touches[0]; en pointerup/touchend la lista viene vacía.
      const src = (ev.touches && ev.touches.length) ? ev.touches[0]
                : (ev.changedTouches && ev.changedTouches.length) ? ev.changedTouches[0]
                : ev;
      return { x: src.clientX - r.left, y: src.clientY - r.top };
    }

    // Presión: los pads de firma y los lápices reportan 0..1 real; el mouse
    // reporta 0.5 fijo y touch a veces 0. Se acota para que el trazo nunca
    // desaparezca ni se engorde de más.
    function grosor(ev) {
      const p = (typeof ev.pressure === 'number' && ev.pressure > 0 && ev.pointerType !== 'mouse')
        ? ev.pressure : 0.5;
      return ANCHO_BASE * (0.6 + 0.8 * Math.min(1, p));
    }

    function marcar() {
      if (dirty) return;
      dirty = true;
      if (onChange) { try { onChange(true); } catch (e) {} }
    }

    function iniciar(ev) {
      ajustar(true);
      dibujando = true;
      movio = false;
      const p = pos(ev);
      ctx.lineWidth = grosor(ev);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
    }

    function mover(ev) {
      if (!dibujando) return;
      const p = pos(ev);
      ctx.lineWidth = grosor(ev);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
      // Continúa el trazo desde el último punto sin reabrir el path completo
      // (evita re-stroke acumulativo y el engrosado progresivo).
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      movio = true;
      marcar();
    }

    function terminar(ev) {
      if (!dibujando) return;
      dibujando = false;
      // Toque/clic sin arrastre: deja un punto. Antes no pintaba nada y una
      // firma de trazos muy cortos podía no registrar ni un pixel.
      if (!movio) {
        const p = pos(ev);
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(1, grosor(ev) / 2), 0, Math.PI * 2);
        ctx.fill();
        marcar();
      }
      ctx.beginPath();
    }

    // ── Enlace de eventos ───────────────────────────────────────────────
    const listeners = [];
    const on = (target, tipo, fn, op) => {
      target.addEventListener(tipo, fn, op);
      listeners.push([target, tipo, fn, op]);
    };

    if (window.PointerEvent) {
      on(canvas, 'pointerdown', (ev) => {
        if (ev.button != null && ev.button > 0) return; // solo botón principal
        punteroId = ev.pointerId;
        // Captura: el trazo sigue aunque el puntero salga del recuadro, y el
        // pointerup llega aquí aun si se suelta fuera.
        try { canvas.setPointerCapture(ev.pointerId); } catch (e) {}
        iniciar(ev);
        ev.preventDefault();
      });
      on(canvas, 'pointermove', (ev) => {
        if (punteroId !== null && ev.pointerId !== punteroId) return;
        mover(ev);
        if (dibujando) ev.preventDefault();
      });
      const soltar = (ev) => {
        if (punteroId !== null && ev.pointerId !== punteroId) return;
        terminar(ev);
        try { canvas.releasePointerCapture(ev.pointerId); } catch (e) {}
        punteroId = null;
      };
      on(canvas, 'pointerup', soltar);
      on(canvas, 'pointercancel', soltar);
    } else {
      // Fallback para navegadores sin Pointer Events. move/up van al
      // documento para no cortar el trazo al salir del canvas.
      on(canvas, 'mousedown', (ev) => { iniciar(ev); ev.preventDefault(); });
      on(document, 'mousemove', (ev) => { if (dibujando) { mover(ev); ev.preventDefault(); } });
      on(document, 'mouseup', (ev) => { if (dibujando) terminar(ev); });
      on(canvas, 'touchstart', (ev) => { iniciar(ev); ev.preventDefault(); }, { passive: false });
      on(canvas, 'touchmove', (ev) => { if (dibujando) { mover(ev); ev.preventDefault(); } }, { passive: false });
      on(canvas, 'touchend', (ev) => { if (dibujando) { terminar(ev); ev.preventDefault(); } }, { passive: false });
    }

    const alRedimensionar = () => ajustar(true);
    on(window, 'resize', alRedimensionar);

    // El canvas suele montarse dentro de un modal recién insertado: el ancho
    // real solo se conoce después del layout.
    ajustar(false);
    if (!canvas.clientWidth) requestAnimationFrame(() => ajustar(false));

    return {
      isEmpty() { return !dirty; },
      clear() {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        dibujando = false;
        if (dirty) {
          dirty = false;
          if (onChange) { try { onChange(false); } catch (e) {} }
        }
      },
      // dataURL de la firma, o null si nadie firmó — evita subir un PNG en
      // blanco cuando el flujo se guardó sin firma.
      snapshot() { return dirty ? canvas.toDataURL('image/png') : null; },
      // Restaura una firma previa (p.ej. el modal se volvió a renderizar
      // mientras el cliente ya había firmado).
      restore(dataUrl) {
        if (!dataUrl) return;
        const img = new Image();
        img.onload = () => {
          ajustar(false);
          try { ctx.drawImage(img, 0, 0, ancho, altoCss); marcar(); } catch (e) {}
        };
        img.src = dataUrl;
      },
      // Blob PNG listo para subir a Storage. toBlob evita el rodeo
      // fetch(dataURL) → blob que usaban los llamadores.
      toBlob() {
        return new Promise((resolve, reject) => {
          if (!dirty) return resolve(null);
          try {
            canvas.toBlob(b => b ? resolve(b) : reject(new Error('No se pudo generar la imagen de la firma')), 'image/png');
          } catch (e) { reject(e); }
        });
      },
      destroy() {
        listeners.forEach(([t, tipo, fn, op]) => { try { t.removeEventListener(tipo, fn, op); } catch (e) {} });
        listeners.length = 0;
      },
    };
  }

  window.FirmaPad = { mount };
})();
