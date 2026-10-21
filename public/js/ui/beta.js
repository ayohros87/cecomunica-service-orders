// Funciones en BETA (2026-10-21): un chip "Beta" junto a lo nuevo, con fecha
// de vencimiento. Pasada la fecha el chip desaparece solo, sin otro deploy —
// la función sigue, solo deja de anunciarse como nueva.
//
// Uso: Beta.chip('clave') → HTML del chip ('' si venció o no existe).
//      Beta.activa('clave') → boolean.
(function () {
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  window.Beta = {
    // clave → { hasta: 'YYYY-MM-DD' (último día visible, hora de Panamá), nota }
    FUNCIONES: {
      // Zuleika / Brenda: programación de radios en la renovación (JSON para
      // recepción, lote desde la renovación, archivo parcial y segundo archivo).
      programacion_renovacion: {
        hasta: '2026-11-20',
        nota: 'Función nueva (beta hasta el 20 de noviembre): si algo no cuadra, avísale a Alberto.',
      },
    },

    activa(clave, hoy = new Date()) {
      const f = this.FUNCIONES[clave];
      if (!f) return false;
      return hoy.getTime() <= new Date(`${f.hasta}T23:59:59-05:00`).getTime();
    },

    chip(clave) {
      if (!this.activa(clave)) return '';
      return `<span class="beta-chip" title="${esc(this.FUNCIONES[clave].nota)}" style="display:inline-block; margin-left:6px; ` +
        `padding:1px 7px; border-radius:999px; font-size:10.5px; font-weight:700; letter-spacing:.04em; ` +
        `text-transform:uppercase; vertical-align:middle; line-height:1.5; background:#EDE9FE; color:#5B21B6; ` +
        `border:1px solid #C4B5FD;">Beta</span>`;
    },
  };
})();
