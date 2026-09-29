// Entry de almacen/index.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
// Conteos server-side (FbAgg.count): Firebase 12 dejó a la API compat sin
// Query.count(), y Hoy/Avanzado contaban "sin verificar" con ella (2026-09-29).
import '/js/firebase-aggregates.js';
import '/js/ui/modal.js';
import '/js/ui/bandeja.js';
import '/js/services/usuariosService.js';
import '/js/domain/transicionPendiente.js';
import '/js/services/colaInventarioService.js';
import '/js/services/conflictosPoolService.js';
import '/js/services/modelosService.js';
import '/js/services/inventarioService.js';
import '/js/domain/modeloFamilia.js';
import '/js/services/equiposPoolService.js';
import '/js/domain/stockAgg.js';
import '/js/ui/toast.js';
import '/js/ui/equipo-ficha.js';
import '/js/ui/asistente-conteo.js';
import '/js/ui/filtered-select.js';
import '/js/ui/asistente-recibir.js';
import '/js/ui/entity-combo.js';
import '/js/ui/asistente-venta.js';
import '/js/domain/serialPatron.js';
import '/js/ui/asistente-importar.js';
import '/js/services/clientesService.js';
import '/js/core/xlsx-loader.js';
import '/js/services/contratosService.js';
import '/js/services/gestionesService.js';
import '/js/services/equiposDescartadosService.js';
import '/js/services/equiposCondicionesService.js';
import '/js/ui/serial-field.js';
import '/js/ui/entity-picker.js';
import '/js/ui/asignador-seriales.js';
import '/js/pages/almacen-asignar.js';
import '/js/pages/almacen-hoy.js';
// Runner común de lotes (Existencias y Avanzado) — auditoría UX 2026-09-28.
import '/js/ui/asistente-lote.js';
import '/js/pages/almacen-existencias.js';
// Pestaña Avanzado (lista por serial): era inventario/equipos.html. PocService
// lo usa "Corregir estado" para desactivar el device POC vinculado.
import '/js/services/pocService.js';
import '/js/pages/inventario-equipos.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
