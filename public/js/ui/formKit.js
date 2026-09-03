// FormKit — comportamiento compartido de los formularios de la plataforma
// (kit de formularios 2026-09-03; piloto: clientes/ficha.html).
//
// Qué resuelve, una sola vez para todos los formularios:
//   · Cambios sucios: rastrea los campos [data-fk] contra su valor original y
//     pinta la barra pegajosa de guardado con el conteo y los nombres.
//   · Validación en dos tiempos: formato al salir del campo (.has-error +
//     .form-error-msg, que ceco-ui.css ya trae) — las reglas de negocio van
//     en el onGuardar de cada página.
//   · Guardia de salida: beforeunload con cambios sin guardar, y
//     confirmarSalida() para los botones "Volver" de la página.
//
// Contrato del markup:
//   <div class="form-field">           ← contenedor del campo
//     <input data-fk="Teléfono" data-fk-valida="tel" ...>
//     <span class="form-error-msg">Mensaje concreto</span>
//   </div>
//   data-fk        = etiqueta humana (aparece en la barra y el historial)
//   data-fk-valida = regla de formato (ver VALIDA); `required` nativo aplica
//
// Uso:
//   const fk = FormKit.crear({ root, onGuardar: async (cambios) => {...} });
//   fk.setLimpio()   → re-toma la foto de originales (tras cargar/guardar)
//   fk.confirmarSalida() → Promise<bool> para interceptar "Volver"

(function () {
  "use strict";

  // Reglas de FORMATO (no de negocio). permiteVacio: un vacío no es error —
  // lo obligatorio se marca con `required` en el input.
  const VALIDA = {
    ruc:    { re: /^[0-9-]+$/ },
    dv:     { re: /^\d{1,2}$/ },
    cedula: { re: /^(PE|E|N|\d{1,2})-\d{1,4}-\d{1,6}$/i },
    email:  { re: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
    tel:    { re: /^[+\d][\d\s-]{5,}$/ },
  };

  // Pura (testeable): ¿el valor pasa la regla de formato?
  function esValido(tipo, valor, { requerido = false } = {}) {
    const v = String(valor == null ? "" : valor).trim();
    if (!v) return !requerido;
    const regla = VALIDA[tipo];
    return regla ? regla.re.test(v) : true;
  }

  function _valorDe(el) {
    return el.type === "checkbox" ? !!el.checked : el.value;
  }
  function _ponerValor(el, v) {
    if (el.type === "checkbox") el.checked = !!v;
    else el.value = v == null ? "" : v;
  }

  function validarCampo(el) {
    const wrap = el.closest(".form-field");
    const ok = esValido(el.dataset.fkValida, _valorDe(el), { requerido: el.required });
    if (wrap) wrap.classList.toggle("has-error", !ok);
    return ok;
  }

  function crear({ root, onGuardar, textoGuardar = "Guardar cambios" }) {
    const campos = Array.prototype.slice.call(root.querySelectorAll("[data-fk]"));
    const originales = new Map();
    const sucios = new Map(); // el.id → etiqueta

    // ── Barra pegajosa ──
    const barra = document.createElement("div");
    barra.className = "fk-bar";
    barra.setAttribute("role", "status");
    barra.innerHTML = `
      <div class="fk-bar-cuenta"><b></b><span class="fk-bar-campos"></span></div>
      <button type="button" class="btn btn-ghost fk-bar-btn" data-fk-descartar>Descartar</button>
      <button type="button" class="btn btn-primary" data-fk-guardar>${textoGuardar}</button>`;
    root.appendChild(barra);
    const $cuenta = barra.querySelector(".fk-bar-cuenta b");
    const $camposTxt = barra.querySelector(".fk-bar-campos");
    const $btnGuardar = barra.querySelector("[data-fk-guardar]");
    const $btnDescartar = barra.querySelector("[data-fk-descartar]");

    function pintar() {
      const nombres = Array.from(new Set(sucios.values()));
      if (!nombres.length) { barra.classList.remove("visible"); return; }
      $cuenta.textContent = nombres.length === 1
        ? "1 cambio sin guardar" : `${nombres.length} cambios sin guardar`;
      $camposTxt.textContent = nombres.join(" · ");
      barra.classList.add("visible");
    }

    function marcar(el) {
      const igual = _valorDe(el) === originales.get(el);
      if (igual) sucios.delete(el); else sucios.set(el, el.dataset.fk);
      // Si el campo estaba en error, revalida en vivo para soltarlo apenas se corrige.
      const wrap = el.closest(".form-field");
      if (wrap && wrap.classList.contains("has-error")) validarCampo(el);
      pintar();
    }

    campos.forEach((el) => {
      el.addEventListener("input", () => marcar(el));
      el.addEventListener("change", () => marcar(el));
      el.addEventListener("blur", () => validarCampo(el));
    });

    function setLimpio() {
      campos.forEach((el) => originales.set(el, _valorDe(el)));
      sucios.clear();
      pintar();
    }
    setLimpio();

    function descartar() {
      campos.forEach((el) => {
        _ponerValor(el, originales.get(el));
        const wrap = el.closest(".form-field");
        if (wrap) wrap.classList.remove("has-error");
        // Notifica a la UI dependiente (campos condicionales tipo "motivo").
        el.dispatchEvent(new Event("fk:restaurado"));
      });
      sucios.clear();
      pintar();
    }
    $btnDescartar.addEventListener("click", descartar);

    $btnGuardar.addEventListener("click", async () => {
      let primero = null;
      campos.forEach((el) => { if (!validarCampo(el) && !primero) primero = el; });
      if (primero) {
        primero.focus();
        if (primero.scrollIntoView) primero.scrollIntoView({ block: "center", behavior: "smooth" });
        return;
      }
      const cambios = {};
      sucios.forEach((etiqueta, el) => { cambios[el.id || etiqueta] = { etiqueta, valor: _valorDe(el) }; });
      if (!Object.keys(cambios).length) return;
      $btnGuardar.disabled = true;
      const txt = $btnGuardar.textContent;
      $btnGuardar.textContent = "Guardando…";
      try {
        await onGuardar(cambios);
        setLimpio();
      } catch (e) {
        console.error("[FormKit] onGuardar falló:", e);
        if (window.Toast) Toast.show("No se pudo guardar: " + (e && e.message ? e.message : e), "bad");
      } finally {
        $btnGuardar.disabled = false;
        $btnGuardar.textContent = txt;
      }
    });

    // ── Guardia de salida ──
    function _onBeforeUnload(e) {
      if (!sucios.size) return undefined;
      e.preventDefault();
      e.returnValue = ""; // el navegador pone su propio texto
      return "";
    }
    window.addEventListener("beforeunload", _onBeforeUnload);

    async function confirmarSalida() {
      if (!sucios.size) return true;
      const msg = "Tienes cambios sin guardar. ¿Salir y descartarlos?";
      if (window.Modal && Modal.confirm) {
        return Modal.confirm({ message: msg, danger: true });
      }
      return window.confirm(msg);
    }

    // Al salir con confirmación propia, quitar el guard nativo para no
    // preguntar dos veces.
    function soltarGuardia() { window.removeEventListener("beforeunload", _onBeforeUnload); }

    return { setLimpio, descartar, confirmarSalida, soltarGuardia,
             esSucio: () => sucios.size > 0, campos };
  }

  // Adopción LIGERA para formularios con su propio botón de guardar (p. ej.
  // el alta de cliente): solo la validación de formato al salir del campo,
  // sin barra ni rastreo de sucios. Devuelve validarTodo() para el submit.
  function enlazarValidacion(root) {
    const campos = Array.prototype.slice.call(root.querySelectorAll("[data-fk-valida], [data-fk][required]"));
    campos.forEach((el) => {
      el.addEventListener("blur", () => validarCampo(el));
      el.addEventListener("input", () => {
        const wrap = el.closest(".form-field");
        if (wrap && wrap.classList.contains("has-error")) validarCampo(el);
      });
    });
    return function validarTodo() {
      let primero = null;
      campos.forEach((el) => { if (!validarCampo(el) && !primero) primero = el; });
      if (primero) {
        primero.focus();
        if (primero.scrollIntoView) primero.scrollIntoView({ block: "center", behavior: "smooth" });
      }
      return !primero;
    };
  }

  // Guardia de salida SUELTA, para formularios legacy con su propio botón y
  // flujo de guardado: con cambios sin guardar, cerrar la pestaña o navegar
  // dispara el aviso del navegador. El submit la libera (así el redirect
  // post-guardado no pregunta); si la validación del handler falla, el
  // siguiente teclazo la re-arma.
  function guardia(form) {
    let sucio = false;
    const marca = () => { sucio = true; };
    form.addEventListener("input", marca);
    form.addEventListener("change", marca);
    form.addEventListener("submit", () => { sucio = false; });
    const onBU = (e) => {
      if (!sucio) return undefined;
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBU);
    return {
      esSucio: () => sucio,
      limpiar: () => { sucio = false; },
      soltar: () => { sucio = false; window.removeEventListener("beforeunload", onBU); },
    };
  }

  if (typeof window !== "undefined") {
    window.FormKit = { VALIDA, esValido, validarCampo, crear, enlazarValidacion, guardia };
  }
  // Para los tests de node (sin DOM): exporta solo lo puro.
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { VALIDA, esValido };
  }
})();
