const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
admin.initializeApp();

// Cap de escalado por defecto para TODAS las funciones (las opciones por-función
// lo pueden sobreescribir). Evita que un endpoint HTTP abusado o un loop de
// triggers dispare instancias sin tope (costo). 10 es holgado para uso interno.
setGlobalOptions({ maxInstances: 10 });

const { onContratoActivado, onContratoAprobadoSolicitaSeriales, onSerialesAsignadasSendPdf } = require("./src/triggers/contratos/onApproval");
const { onContratoOrdenWrite, onOrdenWriteSyncContratoCache, onOrdenHardDelete }     = require("./src/triggers/ordenes/onWriteCacheSync");

exports.sendMail                      = require("./src/http/sendMail");
exports.sendContractPdf               = require("./src/http/sendContractPdf");
exports.quickbooksOAuth               = require("./src/http/quickbooksOAuth");
exports.quickbooksWebhook             = require("./src/http/quickbooksWebhook");
exports.onContratoActivado                 = onContratoActivado;
exports.onContratoAprobadoSolicitaSeriales = onContratoAprobadoSolicitaSeriales;
exports.onSerialesAsignadasSendPdf         = onSerialesAsignadasSendPdf;
// onContratoActivadoSendPdf retirada 2026-07-17 (no-op desde el cambio a envío
// post-seriales): el próximo deploy de functions pedirá borrar el CF — aceptar.
exports.onMailQueued                  = require("./src/triggers/mail/onMailQueued");
exports.onContratoAnuladoNotify       = require("./src/triggers/contratos/onAnnulment");
exports.onCancelacionWrite            = require("./src/triggers/cancelaciones/onCancelacionWrite");
exports.onSerialWrite                 = require("./src/triggers/contratos/onSerialWrite");
exports.onSerialCambio                = require("./src/triggers/contratos/onSerialCambio");
// Transición renovación/reemplazo: aplica linaje del mapeo al pool (PLAN_CICLO_VIDA_EQUIPOS.md C.2)
exports.onMapeoWrite                  = require("./src/triggers/contratos/onMapeoWrite");
// Al confirmarse la entrega del contrato nuevo con origen vinculado: auto-registra
// la devolución de todo el alquiler de los contratos originales (regla 2026-07-20)
exports.onEntregaTransicion           = require("./src/triggers/contratos/onEntregaTransicion");
// Pool de equipos por serial — migración por contacto (PLAN_POOL_EQUIPOS_SERIAL.md)
exports.onEntregaPool                 = require("./src/triggers/contratos/onEntregaPool");
exports.onOrdenWritePool              = require("./src/triggers/ordenes/onOrdenWritePool");
exports.onPocDeviceWritePool          = require("./src/triggers/poc/onPocDeviceWritePool");
exports.onOrdenCompletada             = require("./src/triggers/ordenes/onComplete");
exports.onContratoOrdenWrite          = onContratoOrdenWrite;
exports.onOrdenWriteSyncContratoCache = onOrdenWriteSyncContratoCache;
exports.onOrdenHardDelete             = onOrdenHardDelete;
exports.onOrdenWriteSearchTokens      = require("./src/triggers/ordenes/onWriteSearchTokens");
exports.purgePIIRetention             = require("./src/triggers/scheduled/purgePIIRetention");
exports.onCotizacionOpened            = require("./src/triggers/cotizaciones/onOpened");
exports.onCotizacionEstadoChange      = require("./src/triggers/cotizaciones/onEstadoChange");
exports.markCotizacionesVencidas      = require("./src/triggers/scheduled/markCotizacionesVencidas");
exports.recordatorioSeriales          = require("./src/triggers/scheduled/recordatorioSeriales");
// Semanal: equipos pendientes de devolución por vendedor (CC recepción + ventas)
exports.recordatorioTransiciones      = require("./src/triggers/scheduled/recordatorioTransiciones");
// Diario: órdenes estancadas (taller) + cuarentena de entrada sin inspección (recepción)
exports.recordatorioOperativo         = require("./src/triggers/scheduled/recordatorioOperativo");
exports.manageUser                    = require("./src/callable/manageUser");
exports.rebuildContractCache          = require("./src/callable/rebuildContractCache");
exports.runBackfill                   = require("./src/callable/runBackfill");
exports.previewEmail                  = require("./src/callable/previewEmail");
exports.getIdentificacionUrl          = require("./src/callable/getIdentificacionUrl");
exports.getClienteDocUrl              = require("./src/callable/getClienteDocUrl");
exports.kpiReportSnapshot             = require("./src/callable/kpiReportSnapshot");
exports.listQBOItems                  = require("./src/callable/listQBOItems");
exports.listQBOPiezas                 = require("./src/callable/listQBOPiezas");
exports.listQBOEquipos                = require("./src/callable/listQBOEquipos");
exports.gestionarFacturacion          = require("./src/callable/gestionarFacturacion");
exports.onOrdenEntregada              = require("./src/triggers/ordenes/onOrdenEntregada");
exports.facturacionDiaria             = require("./src/triggers/scheduled/facturacionDiaria");
exports.calcularFacturaContrato       = require("./src/callable/calcularFacturaContrato");
exports.listQBOCustomers              = require("./src/callable/listQBOCustomers");
exports.migrarIdentificacionPII       = require("./src/callable/migrarIdentificacionPII");
