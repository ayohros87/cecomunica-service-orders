// @ts-nocheck
// Casilla del RUC POR PARTES (2026-09-25) — como la pide e-Tax de la DGI:
// tipo de contribuyente → provincia → letras (en blanco si no lleva) → tomo →
// asiento, y el DV verificado contra el que calcula la DGI. La lógica (formatos,
// DV, lectura de lo viejo) vive en js/domain/rucPanama.js; aquí solo el DOM.
//
// Por qué por partes y no una casilla libre: en producción el RUC libre dejó
// 100+ DV pegados dentro del número, NT perdidos (8-1-12607 por 8-NT-1-12607)
// y DV con los dígitos cambiados. Con las partes el guion y las letras los pone
// el sistema, y el DV se compara al escribirlo.
//
// El valor que se guarda sigue en los mismos inputs de siempre (#ruc, #dv, y
// el nuevo #ruc_tipo, ocultos los dos primeros), así el kit de formularios los
// rastrea igual: el componente los escribe y dispara `input`.
//
// Lo VIEJO no se reescribe al abrir (abrir una ficha no cambia datos): se
// muestra por partes y, si lo guardado no está en su forma limpia, se ofrece
// "Acomodar". Un DV que no cuadra solo tranca si el usuario tocó el RUC o el
// DV — y aun así se puede confirmar "así sale en el documento".
//
// Uso:
//   const w = RucInput.montar(document.getElementById('rucBloque'));
//   w.cargar(c.ruc, c.ruc_tipo, c.dv);   // tras llenar la ficha
//   const msg = w.problema();            // antes de guardar: string | null
(function () {
  "use strict";

  const R = () => window.RucPanama;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // [largo, corto]: el corto es para el celular.
  const TIPO_LBL = { juridica: ["Persona jurídica", "Jurídica"], natural: ["Persona natural", "Natural"], otro: ["Otro", "Otro"] };

  function montar(raiz) {
    const $ruc = raiz.querySelector("#ruc");
    const $tipo = raiz.querySelector("#ruc_tipo");
    const $dv = raiz.querySelector("#dv");
    const $w = raiz.querySelector("[data-ruc-widget]");
    const $estado = raiz.querySelector("[data-ruc-estado]");
    const $msg = raiz.querySelector("[data-ruc-msg]");

    // Estado vivo de las partes (lo que se ve), y lo que había al cargar.
    let p = { tipo: "" };
    let guardado = { ruc: "", tipo: "", dv: "" };
    let tocado = false;        // ¿el usuario cambió el RUC/DV desde que se cargó?
    let confirmado = false;    // "así sale en el documento" (DV que no cuadra)

    // ── Pintar ──
    function pintar() {
      const letras = p.tipo === "juridica" || p.tipo === "natural" ? R().LETRAS[p.tipo] : [];
      const letra = (p.letra || "").toUpperCase();
      const lim = R().limites(p.tipo, letra);
      const sinProv = R().SIN_PROVINCIA.includes(letra);
      const deshab = $ruc.disabled ? "disabled" : "";

      const seg = `<div class="ruc-seg" role="radiogroup" aria-label="Tipo de contribuyente">${
        ["juridica", "natural", "otro"].map((t) =>
          `<button type="button" class="ruc-seg-btn${p.tipo === t ? " is-on" : ""}" role="radio" aria-checked="${p.tipo === t}"
             data-tipo="${t}" ${deshab}><span class="ruc-seg-largo">${TIPO_LBL[t][0]}</span><span class="ruc-seg-corto">${TIPO_LBL[t][1]}</span></button>`).join("")}</div>`;

      const parte = (k, lbl, max, ancho) => `
        <label class="ruc-parte" style="--w:${ancho}ch">
          <span class="ruc-cap">${lbl}</span>
          <input class="form-input ruc-in" data-k="${k}" inputmode="numeric" autocomplete="off"
                 maxlength="${max || 12}" value="${esc(p[k] || "")}" ${deshab}>
        </label>`;
      const guion = `<span class="ruc-guion" aria-hidden="true">–</span>`;
      const selProv = `
        <label class="ruc-parte">
          <span class="ruc-cap">Provincia</span>
          <select class="form-select ruc-sel" data-k="provincia" ${deshab}>
            <option value="">—</option>
            ${R().PROVINCIAS.map(([c, n]) =>
              `<option value="${c}" ${String(p.provincia || "").replace(/^0+(?=\d)/, "") === c ? "selected" : ""}>${c} · ${esc(n)}</option>`).join("")}
          </select>
        </label>`;
      const selLetra = `
        <label class="ruc-parte">
          <span class="ruc-cap">Letras</span>
          <select class="form-select ruc-sel" data-k="letra" ${deshab}>
            ${letras.map(([c, n]) => `<option value="${c}" ${letra === c ? "selected" : ""}>${esc(n)}</option>`).join("")}
          </select>
        </label>`;

      let filas = "";
      if (p.tipo === "juridica" && letra !== "NT") {
        filas = selLetra + parte("p1", "Tomo / ficha / folio", lim.p1, 11) + guion +
                parte("p2", "Folio / rollo", lim.p2, 6) + guion + parte("p3", "Asiento / imagen", lim.p3, 8);
      } else if (p.tipo === "juridica" || p.tipo === "natural") {
        filas = (sinProv ? "" : selProv) + selLetra + guion +
                parte("tomo", "Tomo", lim.tomo, 6) + guion + parte("asiento", "Asiento", lim.asiento, 10);
      } else if (p.tipo === "otro") {
        filas = `
          <label class="ruc-parte ruc-parte-libre">
            <span class="ruc-cap">Pasaporte o identificación fiscal extranjera</span>
            <input class="form-input ruc-in-libre" data-k="texto" autocapitalize="characters" autocomplete="off"
                   maxlength="20" value="${esc(p.texto || "")}" ${deshab}>
          </label>`;
      }
      $w.innerHTML = seg + (filas ? `<div class="ruc-partes">${filas}</div>` : "");
      pintarEstado();
    }

    // La línea de abajo: cómo queda, y qué dice el DV.
    function pintarEstado() {
      const txt = R().componer(p);
      const dv = ($dv.value || "").trim();
      const out = [];
      const legado = !tocado && guardado.ruc && (guardado.ruc.trim() !== txt || (p.dvPegado && !guardado.dv));

      if (p.tipo === "juridica" && (p.letra || "").toUpperCase() === "NT") {
        out.push(`<span class="ruc-nota">NT: entidades del Estado, organismos internacionales, P.H., asociaciones sin fines de lucro y consorcios.</span>`);
      }
      if (!p.tipo) {
        out.push(`<span class="ruc-nota">Elige si el cliente es persona jurídica (una sociedad, el Estado, un P.H.) o natural (una cédula).</span>`);
      } else if (p.tipo === "otro") {
        if (legado) out.push(`<span class="ruc-nota ruc-warn">Guardado como <b>${esc(guardado.ruc)}</b>, que no sigue ningún formato de la DGI. Si tienes el documento, escoge persona jurídica o natural y escríbelo por partes.</span>`);
        else out.push(`<span class="ruc-nota">Solo para quien no tiene RUC panameño. No lleva DV.</span>`);
      } else if (txt) {
        const v = R().verificarDV(p, dv);
        let linea = `Queda así: <b class="ruc-mono">${esc(txt)}</b>${dv ? ` · DV <b class="ruc-mono">${esc(dv)}</b>` : ""}`;
        if (v.estado === "ok") out.push(`<span class="ruc-nota ruc-ok">${linea} — el DV cuadra con el de la DGI.</span>`);
        // Ficha vieja con el DV pegado: "Acomodar" ya lo pone en su casilla.
        else if (v.estado === "sin_dv" && legado && p.dvPegado) out.push(`<span class="ruc-nota">${linea}.</span>`);
        else if (v.estado === "sin_dv") out.push(`<span class="ruc-nota">${linea}. DV según la DGI: <b class="ruc-mono">${v.esperado}</b>
            <button type="button" class="btn btn-sm ruc-accion" data-accion="usar-dv" data-dv="${v.esperado}">Usar ${v.esperado}</button></span>`);
        else if (v.estado === "no_cuadra") {
          const sug = R().sugerirCorreccion(p, dv);
          out.push(`<span class="ruc-nota ruc-bad">${linea}. <b>El DV no cuadra:</b> para este RUC la DGI da <b class="ruc-mono">${v.esperado}</b>. Revisa los dos contra el documento del cliente.</span>`);
          if (sug) out.push(`<span class="ruc-nota ruc-warn">¿Tal vez ${esc(sug.motivo)}? Con <b class="ruc-mono">${esc(sug.ruc)}</b> el DV ${esc(dv)} sí cuadra.
              <button type="button" class="btn btn-sm ruc-accion" data-accion="sugerencia">Cambiar a ${esc(sug.ruc)}</button></span>`);
          else out.push(`<span class="ruc-nota"><button type="button" class="btn btn-sm ruc-accion" data-accion="usar-dv" data-dv="${v.esperado}">Usar DV ${v.esperado}</button></span>`);
          if (tocado) out.push(`<label class="ruc-nota ruc-confirma"><input type="checkbox" data-accion="confirmar" ${confirmado ? "checked" : ""}>
              El documento del cliente dice exactamente este RUC y este DV.</label>`);
        }
        if (legado) {
          const dvLimpio = guardado.dv || p.dvPegado || "";
          out.push(`<span class="ruc-nota ruc-warn">Guardado como <b class="ruc-mono">${esc(guardado.ruc)}</b>${guardado.dv ? ` DV ${esc(guardado.dv)}` : ""}.
              <button type="button" class="btn btn-sm ruc-accion" data-accion="acomodar">Acomodar a ${esc(txt)}${dvLimpio ? " DV " + esc(dvLimpio) : ""}</button></span>`);
        }
      } else if (tocado) {
        const prob = R().problemaPartes(p);
        if (prob) out.push(`<span class="ruc-nota ruc-nota-falta">${esc(prob)}</span>`);
      }
      $estado.innerHTML = out.join("");
      if ($msg) $msg.textContent = R().problemaPartes(p) || "Revisa el RUC.";
    }

    // Las casillas vacías de la fila, en rojo (el resto no: ver form-kit.css).
    function marcarFaltantes() {
      $w.querySelectorAll(".ruc-partes input, .ruc-partes select").forEach((el) => {
        const vacia = !el.value && !(el.dataset.k === "letra");
        el.classList.toggle("ruc-falta", vacia);
      });
    }

    // ── Escribir el valor en los inputs que guarda la página ──
    function volcar() {
      tocado = true;
      confirmado = false;
      const txt = R().componer(p);
      $ruc.value = txt;
      $tipo.value = p.tipo || "";
      $ruc.dispatchEvent(new Event("input", { bubbles: true }));
      $tipo.dispatchEvent(new Event("input", { bubbles: true }));
      // Si el campo estaba en rojo y ya quedó completo, soltarlo.
      const wrap = $ruc.closest(".form-field");
      if (wrap && wrap.classList.contains("has-error") && window.FormKit) FormKit.validarCampo($ruc);
      if (wrap && wrap.classList.contains("has-error")) marcarFaltantes();
    }
    function ponerDV(v) {
      $dv.value = v;
      $dv.dispatchEvent(new Event("input", { bubbles: true }));
      tocado = true;
      confirmado = false;
    }

    // Pegar un RUC completo en cualquier parte lo reparte en todas.
    function pegar(texto) {
      const d = R().descomponer(texto, { tipo: p.tipo === "otro" ? "" : p.tipo });
      if (d.vacio) return false;
      if (d.tipo === "otro" && p.tipo !== "otro") return false;
      p = { ...d };
      pintar(); volcar();
      if (d.dvPegado) ponerDV(d.dvPegado);
      pintarEstado();
      return true;
    }

    // ── Eventos (delegados: el contenido se re-pinta) ──
    $w.addEventListener("click", (e) => {
      const b = e.target.closest("[data-tipo]");
      if (!b || b.disabled || $ruc.disabled) return;   // solo lectura: la ficha deshabilita #ruc
      const t = b.dataset.tipo;
      if (t === p.tipo) return;
      // Al cambiar de tipo se conserva lo que sirve: el número de un "otro"
      // se intenta leer; las partes de natural ↔ jurídica NT pasan tal cual.
      const antes = p;
      if (t === "otro") p = { tipo: "otro", texto: R().componer(antes) || "" };
      else if (antes.tipo === "otro" && antes.texto) {
        const d = R().descomponer(antes.texto, { tipo: t });
        p = d.tipo === t ? d : { tipo: t, letra: "" };
      } else p = { ...antes, tipo: t, letra: antes.letra === "NT" ? "NT" : "" };
      pintar(); volcar(); pintarEstado();
      const primero = $w.querySelector(".ruc-partes select, .ruc-partes input");
      if (primero) primero.focus();
    });

    $w.addEventListener("input", (e) => {
      const el = e.target;
      const k = el.dataset && el.dataset.k;
      if (!k || el.tagName === "SELECT") return;   // los select van por `change`
      if (k !== "texto") {
        const limpio = el.value.replace(/\D/g, "");
        if (limpio !== el.value) el.value = limpio;
      }
      if (k === "texto") el.value = el.value.toUpperCase().replace(/\s+/g, "");
      p[k] = el.value;
      volcar(); pintarEstado();
    });

    $w.addEventListener("change", (e) => {
      const el = e.target;
      if (el.tagName !== "SELECT") return;
      p[el.dataset.k] = el.value;
      if (el.dataset.k === "letra" && R().SIN_PROVINCIA.includes(el.value)) p.provincia = "";
      const foco = el.dataset.k;
      pintar(); volcar(); pintarEstado();
      const vuelve = $w.querySelector(`[data-k="${foco}"]`);
      if (vuelve) vuelve.focus();
    });

    // El guion salta a la parte siguiente (la gente escribe 8-712-1043 de corrido).
    $w.addEventListener("keydown", (e) => {
      if (e.key !== "-" || !e.target.classList.contains("ruc-in")) return;
      e.preventDefault();
      const todos = Array.from($w.querySelectorAll(".ruc-partes select, .ruc-partes input"));
      const sig = todos[todos.indexOf(e.target) + 1];
      if (sig) sig.focus(); else $dv.focus();
    });

    function onPaste(e) {
      const t = (e.clipboardData || window.clipboardData).getData("text");
      if (!t || !/[-A-Za-z:]/.test(t)) return;   // un número suelto se pega normal
      if (pegar(t)) e.preventDefault();
    }
    $w.addEventListener("paste", onPaste);
    $dv.addEventListener("paste", (e) => {
      const t = (e.clipboardData || window.clipboardData).getData("text");
      if (t && /-/.test(t) && pegar(t)) e.preventDefault();
    });

    $dv.addEventListener("input", () => {
      const limpio = $dv.value.replace(/\D/g, "").slice(0, 2);
      if (limpio !== $dv.value) $dv.value = limpio;
      tocado = true; confirmado = false; pintarEstado();
    });

    $estado.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-accion]");
      if (!b || $ruc.disabled) return;
      const a = b.dataset.accion;
      if (a === "usar-dv") { ponerDV(b.dataset.dv); pintarEstado(); }
      if (a === "sugerencia") {
        const sug = R().sugerirCorreccion(p, $dv.value);
        if (sug) { p = { ...sug.partes }; pintar(); volcar(); pintarEstado(); }
      }
      if (a === "acomodar") {
        const dvLimpio = guardado.dv || p.dvPegado || "";
        volcar();
        if (dvLimpio && dvLimpio !== $dv.value) ponerDV(dvLimpio);
        pintarEstado();
      }
    });
    $estado.addEventListener("change", (e) => {
      if (e.target.dataset && e.target.dataset.accion === "confirmar") confirmado = e.target.checked;
    });

    // Descartar del kit: vuelve a lo guardado.
    $ruc.addEventListener("fk:restaurado", () => cargar($ruc.value, $tipo.value, $dv.value));

    // ── API ──
    function cargar(ruc, tipo, dv) {
      guardado = { ruc: String(ruc || ""), tipo: String(tipo || ""), dv: String(dv || "") };
      $ruc.value = guardado.ruc;
      $tipo.value = guardado.tipo;
      $dv.value = guardado.dv;
      tocado = false; confirmado = false;
      p = R().descomponer(guardado.ruc, { tipo: guardado.tipo, dv: guardado.dv });
      if (p.vacio) p = { tipo: guardado.tipo || "" };
      pintar();
    }

    // Lo que impide guardar, o null. Solo cuenta lo que el usuario tocó.
    function problema() {
      if (!tocado) return null;
      // Sin tipo elegido no hay partes que revisar: el `required` del kit
      // ya para el RUC vacío.
      const prob = p.tipo ? R().problemaPartes(p) : null;
      if (prob) {
        // A medias, #ruc sigue vacío como al cargar y el kit no lo ve sucio:
        // el rojo del campo lo pone el componente.
        const wrap = $ruc.closest(".form-field");
        if (wrap) wrap.classList.add("has-error");
        if ($msg) $msg.textContent = prob;
        marcarFaltantes();
        return "RUC: " + prob.charAt(0).toLowerCase() + prob.slice(1);
      }
      const v = R().verificarDV(p, $dv.value);
      if (v.estado === "no_cuadra" && !confirmado) {
        return `El DV no cuadra con el RUC (la DGI da ${v.esperado}). Corrígelo, o marca que el documento del cliente dice exactamente eso.`;
      }
      return null;
    }

    cargar($ruc.value, $tipo.value, $dv.value);
    return { cargar, problema, partes: () => ({ ...p }) };
  }

  window.RucInput = { montar };
})();
