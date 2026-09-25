// Entry de verify/cotizacion.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/domain/cotizacionesTotales.js';
import '/js/domain/cotizacionTaller.js';
import '/js/domain/cartaPresentacion.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/pages/verify-cotizacion.js';
