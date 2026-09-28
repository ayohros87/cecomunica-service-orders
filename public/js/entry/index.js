// Entry de index.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
// layout.js (rail + Ctrl+K) ya NO va aquí: el home lo carga clásico en el
// <head> como las demás páginas (fija data-cc-rail en el parse). Importarlo
// además lo ejecutaría dos veces (dos Layout, dos atajos).
import '/js/firebase-aggregates.js';
import '/js/services/usuariosService.js';
import '/js/domain/pendientes.js';
import '/js/domain/regularizacion.js';
import '/js/services/senalesService.js';
import '/js/services/aprobacionesService.js';
import '/js/ui/bandeja.js';
import '/js/pages/home-signals.js';
import '/js/domain/ordenProgPendiente.js';
import '/js/services/equiposPoolService.js';
import '/js/services/feedOrdenesService.js';
import '/js/pages/home-feed-ordenes.js';
import '/js/pages/home-feed-devoluciones.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
