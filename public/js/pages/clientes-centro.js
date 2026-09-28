// Este archivo YA NO define nada (2026-09-28, auditoría UX §4.3 #13).
//
// El Centro de gestión de clientes se partió por sus secciones en
// public/js/pages/centro-core.js (window.Centro: estado, init, helpers) y
// centro-*.js (una por sección, Object.assign sobre window.Centro). El orden
// de carga es el de js/entry/clientes-centro.js; los tests lo montan con
// functions/test/_helpers/centro.js (fuenteCentro()).
//
// Se deja este archivo vacío, y no borrado, porque functions/test-browser
// (harness-constancia.html, revisar-aprobaciones.js) todavía lo cargan por
// nombre: cuando se actualicen a las secciones, esto se puede borrar.
