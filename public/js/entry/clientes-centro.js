// Entry de clientes/centro.html (F2, docs/plans/PLAN_MIGRACION_MODULAR.md).
// Mismo orden que tenían las etiquetas <script defer> que reemplaza: cada
// archivo sigue publicando sus globales en window (puente F1), así que el
// orden importa igual que antes. Vite lo empaqueta y le pone hash.
import '/js/firebase-init.js';
import '/js/firebase-aggregates.js';
import '/js/services/aprobacionesService.js';
import '/js/ui/bandeja.js';
import '/js/pages/centro-aprobaciones.js';
import '/js/services/usuariosService.js';
import '/js/services/clientesService.js';
import '/js/services/clienteDocumentosService.js';
import '/js/services/contratosService.js';
import '/js/domain/modeloFamilia.js';
import '/js/services/equiposPoolService.js';
import '/js/services/modelosService.js';
import '/js/domain/contratoV2Texto.js';
import '/js/services/cargosService.js';
import '/js/services/gestionesService.js';
import '/js/services/mailService.js';
import '/js/services/equiposDescartadosService.js';
import '/js/services/equiposCondicionesService.js';
import '/js/ui/serial-field.js';
import '/js/domain/totales.js';
import '/js/domain/contratoTarifario.js';
import '/js/domain/origenContrato.js';
import '/js/domain/docIdentidad.js';
import '/js/domain/firmante.js';
import '/js/domain/repValidacion.js';
import '/js/domain/transicionPlan.js';
import '/js/domain/contratoAnulacion.js';
import '/js/domain/contratoCierre.js';
import '/js/domain/contratoEdicion.js';
import '/js/domain/regularizacion.js';
// ?filtro=regularizacion excluye las cuentas pospuestas con el MISMO criterio
// que la tarjeta REGV del home (PendientesDomain.estaPospuesto).
import '/js/domain/pendientes.js';
import '/js/domain/gestionAutorizacion.js';
import '/js/domain/contratoFirma.js';
// Chip de composición (Alquiler / Propio / Mixto) junto al número del contrato (2026-09-28).
import '/js/domain/contratoComposicion.js';
// "Documento completo" abre el papel correcto (v2 o clásico) — auditoría UX 2026-09-28.
import '/js/domain/documentoContrato.js';
import '/js/vendor/lucide.min.js';
import '/js/core/icons.js';
import '/js/ui/toast.js';
import '/js/ui/busy.js';
import '/js/ui/modal.js';
import '/js/pages/contratos-upload.js';
import '/js/domain/garantiaEquipo.js';
import '/js/services/pocService.js';
// El Centro, partido por secciones (2026-09-28, auditoría UX §4.3 #13): el
// núcleo define window.Centro; cada sección le suma sus métodos con
// Object.assign. El init lo dispara centro.html en DOMContentLoaded.
// functions/test/_helpers/centro.js lee ESTA lista para montar el mismo
// conjunto en los tests: un archivo nuevo se anota aquí y solo aquí.
import '/js/pages/centro-core.js';
import '/js/pages/centro-directorio.js';
import '/js/pages/centro-ficha.js';
import '/js/pages/centro-regularizacion.js';
import '/js/pages/centro-ficha-bloques.js';
import '/js/pages/centro-firma.js';
import '/js/pages/centro-gestiones.js';
import '/js/pages/centro-acciones.js';
import '/js/pages/centro-menu-gestion.js';
import '/js/pages/centro-wiz-reemplazo-demo.js';
import '/js/pages/centro-cambio-serial.js';
import '/js/pages/centro-wiz-aumento.js';
import '/js/pages/centro-wiz-ajuste.js';
import '/js/pages/centro-wiz-contrato.js';
import '/js/pages/centro-plan-seriales-renovacion.js';
import '/js/pages/centro-editor-contrato.js';
import '/js/pages/centro-wiz-baja.js';
