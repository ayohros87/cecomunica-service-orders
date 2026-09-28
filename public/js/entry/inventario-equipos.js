// Entry de inventario/equipos.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/services/usuariosService.js';
import '/js/services/modelosService.js';
import '/js/services/clientesService.js';
import '/js/services/inventarioService.js';
import '/js/domain/modeloFamilia.js';
import '/js/services/equiposPoolService.js';
// Lo que Recibir y la ficha usan y esta página no cargaba (auditoría UX
// 2026-09-28): SerialPatron (seriales mal transcritos), condición
// particular en la ficha y descartados en QC al recibir.
import '/js/domain/serialPatron.js';
import '/js/services/equiposCondicionesService.js';
import '/js/services/equiposDescartadosService.js';
import '/js/domain/stockAgg.js';
import '/js/services/colaInventarioService.js';
import '/js/services/conflictosPoolService.js';
import '/js/ui/equipo-ficha.js';
import '/js/ui/filtered-select.js';
import '/js/ui/asistente-recibir.js';
import '/js/ui/entity-combo.js';
import '/js/ui/asistente-venta.js';
import '/js/services/pocService.js';
import '/js/core/xlsx-loader.js';
import '/js/ui/toast.js';
import '/js/ui/busy.js';
import '/js/ui/modal.js';
import '/js/pages/inventario-equipos.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
