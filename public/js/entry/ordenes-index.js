// Entry de ordenes/index.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/firebase-aggregates.js';
import '/js/core/carga-diferida.js';
import '/js/services/clientesService.js';
import '/js/domain/pendientes.js';
import '/js/domain/entregaTandas.js';
import '/js/domain/contratoFirma.js';
import '/js/services/ordenesService.js';
import '/js/services/senalesService.js';
import '/js/services/empresaService.js';
import '/js/services/usuariosService.js';
import '/js/services/mailService.js';
import '/js/services/piezasService.js';
import '/js/services/modelosService.js';
import '/js/services/equiposPoolService.js';
import '/js/services/equiposDescartadosService.js';
import '/js/services/equiposCondicionesService.js';
import '/js/ui/equipo-ficha.js';
import '/js/ui/serial-field.js';
import '/js/domain/scoring.js';
import '/js/ui/toast.js';
import '/js/ui/busy.js';
import '/js/ui/firmaTablet.js';
import '/js/ui/modal.js';
import '/js/pages/ordenes-state.js';
import '/js/pages/ordenes-data.js';
import '/js/pages/ordenes-render.js';
import '/js/pages/ordenes-filters.js';
import '/js/pages/ordenes-flujo.js';
import '/js/pages/ordenes-qc.js';
import '/js/pages/ordenes-equipos.js';
import '/js/pages/ordenes-ui.js';
import '/js/pages/ordenes-presets.js';
import '/js/pages/ordenes-events.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/pages/ordenes-index.js';
