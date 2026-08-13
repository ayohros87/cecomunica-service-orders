// @ts-nocheck
// Detector de seriales mal transcritos dentro de una tanda de conteo.
//
// Las hojas de bodega llegan tecleadas a mano y el error no se ve solo: un
// serial errado no falla, entra — crea una ficha fantasma que infla el stock y
// que después hay que fusionar. Ya pasó tres veces en dos días:
//   · `O180828000175` entre bases 7TM…/9TM…/DTM… — el real era `ZRK180828000175`
//     (faltaban tres caracteres al principio, no era la letra O).
//   · `16O13D0998` entre radios `20229C0013`/`20912A0443` — la O cae justo donde
//     la serie lleva un dígito.
//   · `B3710905` en un conteo de NX-420 — era `B7310905`, ya entregado a otro
//     cliente. Ese no lo atrapa esta heurística (encaja perfecto en el patrón):
//     una transposición de dígitos es un serial válido de la misma serie. Lo que
//     se detecta aquí es la forma, no la identidad.
//
// La idea: en una tanda de un mismo modelo los seriales comparten forma. Se
// deriva la MÁSCARA dominante (D = dígito, L = letra, por posición) y se marca
// lo que no encaja. No decide nada — solo levanta la mano para que quien tiene
// el radio delante confirme, que es la única fuente de verdad para un serial.
//
// Deliberadamente conservador: con tandas cortas o muy heterogéneas se calla.
// Un falso positivo cuesta una pregunta a bodega; un falso negativo cuesta una
// ficha fantasma y una fusión.
window.SerialPatron = (() => {

  // Pares que se confunden al teclear o al leer una etiqueta gastada. Solo
  // letra→dígito: es el sentido en que aparece el error (la etiqueta trae un
  // dígito y quien copia escribe la letra parecida).
  const CONFUNDIBLES = { O: '0', I: '1', L: '1', S: '5', B: '8', Z: '2', G: '6', Q: '0' };

  // Cobertura mínima del patrón dominante para atreverse a marcar nada. Por
  // debajo, la tanda no tiene una forma clara y callar es lo correcto.
  const COBERTURA_MIN = 0.6;
  const TANDA_MIN = 4;

  // En UNA pasada: encadenar dos replace convertía en 'L' las 'D' recién
  // puestas (la D es [A-Z]) y toda máscara salía "LLLL…".
  const mascara = (s) => (s || '').replace(/./g, (c) =>
    (c >= '0' && c <= '9') ? 'D' : (c >= 'A' && c <= 'Z') ? 'L' : c);

  // Máscara más frecuente de la tanda, con su cobertura.
  function dominante(seriales) {
    const cuenta = new Map();
    for (const s of seriales) {
      const m = mascara(s);
      cuenta.set(m, (cuenta.get(m) || 0) + 1);
    }
    let mejor = null, mejorN = 0;
    for (const [m, n] of cuenta) if (n > mejorN) { mejor = m; mejorN = n; }
    return { mascara: mejor, n: mejorN, cobertura: seriales.length ? mejorN / seriales.length : 0 };
  }

  // ¿Se arregla cambiando letras confundibles por su dígito? Devuelve el serial
  // corregido solo si el resultado encaja EXACTO en la máscara esperada — una
  // sugerencia a medias es peor que ninguna.
  function sugerir(serial, mascaraEsperada) {
    if (serial.length !== mascaraEsperada.length) return null;
    let out = '';
    for (let i = 0; i < serial.length; i++) {
      const c = serial[i];
      const esperado = mascaraEsperada[i];
      if (esperado === 'D' && /[A-Z]/.test(c) && CONFUNDIBLES[c]) out += CONFUNDIBLES[c];
      else out += c;
    }
    return out !== serial && mascara(out) === mascaraEsperada ? out : null;
  }

  // Revisa una tanda de seriales YA normalizados (mayúsculas, sin separadores).
  // Retorna { patron, cobertura, revisados: [{ serial, sospechoso, motivo, sugerencia }] }.
  // `patron` es null cuando la tanda no da para opinar.
  function revisar(serialesNorm) {
    const lista = (serialesNorm || []).filter(Boolean);
    const base = { patron: null, cobertura: 0, revisados: lista.map(s => ({ serial: s, sospechoso: false, motivo: '', sugerencia: null })) };
    if (lista.length < TANDA_MIN) return base;

    const dom = dominante(lista);
    if (!dom.mascara || dom.cobertura < COBERTURA_MIN) return base;

    const revisados = lista.map(serial => {
      const m = mascara(serial);
      if (m === dom.mascara) return { serial, sospechoso: false, motivo: '', sugerencia: null };

      const sugerencia = sugerir(serial, dom.mascara);
      if (sugerencia) {
        return { serial, sospechoso: true, sugerencia,
          motivo: `lleva una letra donde el resto de la serie tiene un número — ¿es ${sugerencia}?` };
      }
      if (serial.length !== dom.mascara.length) {
        return { serial, sospechoso: true, sugerencia: null,
          motivo: `tiene ${serial.length} caracteres y el resto de la serie ${dom.mascara.length}` };
      }
      return { serial, sospechoso: true, sugerencia: null,
        motivo: 'no sigue la forma del resto de la serie' };
    });

    return { patron: dom.mascara, cobertura: dom.cobertura, revisados };
  }

  // Máscara en algo que un humano lea: DDDDDLDDDD → "5 números, 1 letra, 4 números".
  function describirPatron(m) {
    if (!m) return '';
    const partes = [];
    let i = 0;
    while (i < m.length) {
      const c = m[i];
      let n = 0;
      while (i < m.length && m[i] === c) { n++; i++; }
      partes.push(`${n} ${c === 'D' ? (n === 1 ? 'número' : 'números') : (n === 1 ? 'letra' : 'letras')}`);
    }
    return partes.join(' + ');
  }

  return { revisar, describirPatron, _mascara: mascara, _dominante: dominante, _sugerir: sugerir };
})();

// Node (tests): el módulo se carga en un sandbox con `window`, igual que los
// servicios del front. Este puente permite `require()` directo si algún día hace falta.
if (typeof module !== 'undefined' && module.exports) module.exports = window.SerialPatron;
