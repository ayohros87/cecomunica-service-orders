const admin = require("firebase-admin");
const { setGlobalOptions } = require("firebase-functions/v2");
admin.initializeApp();

// Cap de escalado por defecto para TODAS las funciones (las opciones por-función
// lo pueden sobreescribir). Evita que un endpoint HTTP abusado o un loop de
// triggers dispare instancias sin tope (costo). 10 es holgado para uso interno.
setGlobalOptions({ maxInstances: 10 });

const { onContratoActivado, onContratoAprobadoSolicitaSeriales, onSerialesAsignadasSendPdf, onContratoActivadoSendPdf } = require("./src/triggers/contratos/onApproval");
const { onContratoOrdenWrite, onOrdenWriteSyncContratoCache, onOrdenHardDelete }     = require("./src/triggers/ordenes/onWriteCacheSync");

exports.sendMail                      = require("./src/http/sendMail");
exports.sendContractPdf               = require("./src/http/sendContractPdf");
exports.quickbooksOAuth               = require("./src/http/quickbooksOAuth");
exports.quickbooksWebhook             = require("./src/http/quickbooksWebhook");
exports.onContratoActivado                 = onContratoActivado;
exports.onContratoAprobadoSolicitaSeriales = onContratoAprobadoSolicitaSeriales;
exports.onSerialesAsignadasSendPdf         = onSerialesAsignadasSendPdf;
// Conservada pero deshabilitada (no envía) — borrado pendiente. Se mantiene
// exportada para que el deploy NO la elimine todavía.
exports.onContratoActivadoSendPdf          = onContratoActivadoSendPdf;
exports.onMailQueued                  = require("./src/triggers/mail/onMailQueued");
exports.onContratoAnuladoNotify       = require("./src/triggers/contratos/onAnnulment");
exports.onCancelacionWrite            = require("./src/triggers/cancelaciones/onCancelacionWrite");
exports.onSerialWrite                 = require("./src/triggers/contratos/onSerialWrite");
exports.onSerialCambio                = require("./src/triggers/contratos/onSerialCambio");
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
exports.manageUser                    = require("./src/callable/manageUser");
exports.rebuildContractCache          = require("./src/callable/rebuildContractCache");
exports.runBackfill                   = require("./src/callable/runBackfill");
exports.previewEmail                  = require("./src/callable/previewEmail");
exports.getIdentificacionUrl          = require("./src/callable/getIdentificacionUrl");
exports.getClienteDocUrl              = require("./src/callable/getClienteDocUrl");
exports.listQBOItems                  = require("./src/callable/listQBOItems");
exports.listQBOPiezas                 = require("./src/callable/listQBOPiezas");
exports.listQBOEquipos                = require("./src/callable/listQBOEquipos");
exports.gestionarFacturacion          = require("./src/callable/gestionarFacturacion");
exports.onOrdenEntregada              = require("./src/triggers/ordenes/onOrdenEntregada");
exports.facturacionDiaria             = require("./src/triggers/scheduled/facturacionDiaria");
exports.calcularFacturaContrato       = require("./src/callable/calcularFacturaContrato");
exports.listQBOCustomers              = require("./src/callable/listQBOCustomers");
exports.migrarIdentificacionPII       = require("./src/callable/migrarIdentificacionPII");
