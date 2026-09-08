// @ts-nocheck
// Kit de bandeja — la fila, el grupo y la antigüedad que comparten las
// bandejas de trabajo del app (propuesta "Bandejas y pickers" 2026-09-04, F1).
//
// Antes cada bandeja inventaba su fila (.hy-row en Almacén, .pend-fila en el
// home, .cg-hoy en el Centro, .fo-row en los feeds) y su semáforo de
// antigüedad con umbrales distintos. Aquí hay UNA fila: chip de tono + texto
// + antigüedad + CTA. La bandeja decide qué dice cada parte; el kit decide
// cómo se ve. CSS en css/bandeja.css (prefijo .bj-).
//
// Sin dependencias: no toca document al cargar, para que los tests de
// functions/test lo carguen en un vm. Los helpers devuelven HTML; el CTA
// nunca lleva onclick inline (regla del plan de preparación modular): usa
// data-attributes y la página delega el clic.
//
// Tonos (uno por significado, no por bandeja):
//   aviso   → hay que hacer algo (ámbar)
//   info    → en curso / informativo (azul)
//   alerta  → algo está mal (rojo)
//   listo   → resuelto / bien (verde)
//   neutro  → sin juicio (gris)
window.Bandeja = (() => {

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, s =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s]));

  const TONOS = ['aviso', 'info', 'alerta', 'listo', 'neutro'];
  const tono = (t) => TONOS.includes(t) ? t : 'neutro';

  // Umbrales del semáforo, por CLASE de bandeja (decisión 2026-09-04):
  //   cola    → trabajo del día: ámbar a 3 días, rojo a 7.
  //   senal   → seguimiento: ámbar a 10, rojo a 30.
  const UMBRALES = { cola: [3, 7], senal: [10, 30] };

  function dias(ms) {
    if (!ms) return null;
    return Math.floor((Date.now() - ms) / 86400000);
  }

  // "hoy" · "1 día" · "N días" — texto corto para la columna de antigüedad.
  function edadTexto(ms) {
    const d = dias(ms);
    if (d === null) return '';
    return d <= 0 ? 'hoy' : (d === 1 ? '1 día' : `${d} días`);
  }

  // "hace N h" · "hace N días" — para subtítulos.
  function hace(ms) {
    if (!ms) return '';
    const h = Math.floor((Date.now() - ms) / 3600000);
    if (h < 1) return 'hace un momento';
    if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);
    return d === 1 ? 'hace 1 día' : `hace ${d} días`;
  }

  // <span class="bj-age [warn|bad]">N días</span> a partir de los DÍAS.
  function edadDeDias(d, { clase = 'cola', umbrales = null } = {}) {
    if (d === null || d === undefined || Number.isNaN(Number(d))) return '';
    const n = Number(d);
    const [warn, bad] = umbrales || UMBRALES[clase] || UMBRALES.cola;
    const cls = n >= bad ? 'bj-age bad' : n >= warn ? 'bj-age warn' : 'bj-age';
    const txt = n <= 0 ? 'hoy' : (n === 1 ? '1 día' : `${n} días`);
    return `<span class="${cls}">${txt}</span>`;
  }
  // …a partir de un timestamp en ms.
  function edad(ms, opts) {
    const d = dias(ms);
    return d === null ? '' : edadDeDias(d, opts);
  }

  // Chip de tono. `label` ya viene en texto plano.
  function chip(label, t = 'neutro') {
    return `<span class="bj-chip bj-chip--${tono(t)}">${esc(label)}</span>`;
  }
  // Etiqueta pequeña dentro de la fila (pospuesto, en curso…).
  function tag(label, t = 'neutro', title = '') {
    return `<span class="bj-tag bj-chip--${tono(t)}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</span>`;
  }
  // Botón de texto (tomar · soltar · posponer · reactivar). `data` → data-attrs.
  function btnTexto(label, data = null, title = '') {
    const attrs = Object.entries(data || {}).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join('');
    return `<button type="button" class="bj-btn-txt"${attrs}${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
  }

  // CTA como enlace. `data` → data-attributes para que la página delegue el
  // clic (sin onclick inline). `ghost` = secundario. `plano` = sin el kit de
  // botones de ceco-ui (páginas que solo cargan ceco-command.css).
  function cta({ href = '#', label, icono = null, data = null, ghost = false, plano = false, title = '' } = {}) {
    const attrs = Object.entries(data || {}).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join('');
    const cls = plano ? 'bj-cta bj-cta--plano' : `btn btn-sm ${ghost ? 'btn-ghost' : 'btn-accent'} bj-cta`;
    return `<a class="${cls}" href="${esc(href)}"${attrs}${title ? ` title="${esc(title)}"` : ''}>`
      + (icono ? `<i data-lucide="${esc(icono)}" style="width:14px;height:14px;"></i> ` : '') + esc(label) + '</a>';
  }

  // La fila. `txt` es HTML (la bandeja escapa lo suyo); `chip` texto plano.
  // `at` (ms) o `dias` alimentan la antigüedad; `data` → data-attrs en la fila;
  // `off` la atenúa (pospuesta, descartada).
  function fila({ chip: label = '', tono: t = 'neutro', txt = '', at = null, dias: d = null, clase = 'cola', umbrales = null,
                  ctaHtml = '', extraHtml = '', data = null, off = false } = {}) {
    const attrs = Object.entries(data || {}).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join('');
    const antig = (d !== null && d !== undefined) ? edadDeDias(d, { clase, umbrales }) : (at ? edad(at, { clase, umbrales }) : '');
    return `<div class="bj-row${off ? ' is-off' : ''}"${attrs}>
      ${label ? chip(label, t) : ''}
      <span class="bj-txt">${txt}</span>
      ${extraHtml || ''}
      ${antig}
      ${ctaHtml || ''}
    </div>`;
  }

  // Panel: tarjeta con encabezado (título · contador · enlace) y filas dentro.
  function panelHead({ titulo, n = null, href = '', hrefLabel = 'Abrir en su módulo →' } = {}) {
    return `<div class="bj-panel-h">${esc(titulo)}${n != null ? ` <span class="bj-n">${esc(String(n))}</span>` : ''}
      ${href ? `<a href="${esc(href)}">${esc(hrefLabel)}</a>` : ''}</div>`;
  }
  // Pie de panel (…y N más).
  function pie(html) { return `<div class="bj-pie">${html}</div>`; }

  // Esqueleto de carga con la forma de N filas.
  function esqueleto(n = 2) {
    const f = `<div class="bj-row"><span class="bj-skel bj-skel--chip"></span><span class="bj-txt"><span class="bj-skel bj-skel--l1" style="display:inline-block;"></span></span><span class="bj-skel bj-skel--l2"></span></div>`;
    return Array.from({ length: Math.max(1, n) }, () => f).join('');
  }

  // Grupo con título y contador. Vacío (sin filas ni notas) → no se pinta.
  function grupo({ titulo, n = 0, filasHtml = '', notaHtml = '' } = {}) {
    if (!filasHtml && !notaHtml) return '';
    return `<div class="bj-grupo">
      <h3 class="bj-grupo-t">${esc(titulo)} <span class="bj-n">${Number(n) || 0}</span></h3>
      ${filasHtml}${notaHtml}
    </div>`;
  }

  // N filas visibles + "Ver todos (M) →".
  function conMas(items, renderFila, { max = 8, hrefTodos = '#', label = 'todos' } = {}) {
    const html = (items || []).slice(0, max).map(renderFila).join('');
    const resto = (items || []).length - max;
    const mas = resto > 0
      ? `<p class="bj-mas"><a href="${esc(hrefTodos)}">Ver ${esc(label)} (${items.length}) →</a></p>` : '';
    return html + mas;
  }

  // Nota informativa bajo un grupo (no cuenta como trabajo). HTML.
  function nota(html) { return `<p class="bj-nota">${html}</p>`; }

  // Aviso de carga parcial: "No se pudo leer: X, Y."
  function aviso(fallidas) {
    const lista = (fallidas || []).filter(Boolean);
    if (!lista.length) return '';
    return `<div class="bj-aviso"><i data-lucide="alert-triangle" style="width:16px;height:16px;flex:none;"></i>
      <span>No se pudo leer: ${esc(lista.join(', '))}. Lo que ves está incompleto.</span></div>`;
  }

  // Estado vacío = éxito.
  function vacio(texto = 'Nada pendiente.', icono = 'check-circle-2') {
    return `<div class="bj-vacio"><i data-lucide="${esc(icono)}"></i><p>${esc(texto)}</p></div>`;
  }

  // Pastilla pequeña de dato inline (un serial, un modelo) dentro de .bj-txt.
  function pastilla(html) { return `<span class="bj-eq">${html}</span>`; }

  // ── Lista seleccionable (cola de trabajo con un ítem abierto) ──────────
  // Cabecera de sección de la lista.
  function listaTitulo(titulo, n) {
    return `<div class="bj-lista-h"><span>${esc(titulo)}</span><span>${n == null ? '' : esc(String(n))}</span></div>`;
  }
  // Ítem: título + contador a la derecha + subtítulo. `data` → data-attrs.
  function item({ titulo, n = '', sub = '', sel = false, listo = false, data = null } = {}) {
    const attrs = Object.entries(data || {}).map(([k, v]) => ` data-${esc(k)}="${esc(v)}"`).join('');
    return `<button type="button" class="bj-item${sel ? ' is-on' : ''}"${attrs}>
      <span class="bj-item-t">${esc(titulo)}</span>
      <span class="bj-item-n${listo ? ' ok' : ''}">${esc(n)}</span>
      <span class="bj-item-s">${esc(sub)}</span>
    </button>`;
  }
  function listaVacia(texto) { return `<p class="bj-lista-vacia">${esc(texto)}</p>`; }

  return { esc, TONOS, UMBRALES, dias, edadTexto, hace, edad, edadDeDias, chip, tag, btnTexto, cta, fila, grupo, conMas,
    nota, aviso, vacio, pastilla, panelHead, pie, esqueleto, listaTitulo, item, listaVacia };
})();
