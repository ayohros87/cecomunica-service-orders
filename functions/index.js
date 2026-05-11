const admin = require("firebase-admin");
admin.initializeApp();

const { onContratoActivado, onContratoActivadoSendPdf }                              = require("./src/triggers/contratos/onApproval");
const { onContratoOrdenWrite, onOrdenWriteSyncContratoCache, onOrdenHardDelete }     = require("./src/triggers/ordenes/onWriteCacheSync");

exports.sendMail                      = require("./src/http/sendMail");
exports.sendContractPdf               = require("./src/http/sendContractPdf");
exports.onContratoActivado            = onContratoActivado;
exports.onContratoActivadoSendPdf     = onContratoActivadoSendPdf;
exports.onMailQueued                  = require("./src/triggers/mail/onMailQueued");
exports.onContratoAnuladoNotify       = require("./src/triggers/contratos/onAnnulment");
exports.onOrdenCompletada             = require("./src/triggers/ordenes/onComplete");
exports.onContratoOrdenWrite          = onContratoOrdenWrite;
exports.onOrdenWriteSyncContratoCache = onOrdenWriteSyncContratoCache;
exports.onOrdenHardDelete             = onOrdenHardDelete;
