// Defaults applied as fallback when empresa/config is missing or partial.
// Each consumer MUST also keep a literal default in its own module so the
// system survives a Firestore outage — see PLAN_ADMIN_PANEL.md §12.1.
const EMPRESA_CONFIG_DEFAULTS = Object.freeze({
  itbms_rate:                0.07,
  cotizacion_validez_dias:   15,
  pii_retention_dias:        90,
  pii_purge_enabled:         true,
  stock_minimo_default:      5,
  orden_stale_dias:          10,
  orden_stale_max_dias:      30,   // umbral superior — > N días estancada se considera legacy noise (no alerta)
  orden_sin_asignar_max_dias: 30,  // umbral superior — > N días sin asignar se considera legacy noise (no alerta)
  mail_cc_orden_completada:  [],
  mail_cc_contrato_aprobado: [],
  email_recepcion_entregas:  '',   // buzón único que recibe copia de cada nota de entrega ('' = no copiar)
  email_taller:              [],   // emails del taller (jefe_taller) copiados en orden COMPLETADA y nota de entrega ([] = no copiar)
  cotizacion_aprobacion_to:  [],   // emails que reciben la solicitud de aprobación de cotización ([] = fallback ventas@)
  email_solicitud_seriales:  [],   // usuarios que reciben "Solicitud de seriales" al aprobar contrato ([] = fallback inventario@)
  seriales_recordatorio_dias: 3,   // cada cuántos días se le recuerda a inventario un contrato con seriales pendientes
  seriales_editores_extra:   [],   // emails habilitados a EDITAR seriales ya "asignados" (además de admin). [] = solo administradores
  cotizacion_descuento_max_pct: 15, // descuento % máximo que un vendedor puede enviar sin aprobación
  cotizacion_total_max:      5000, // total máximo (USD) que un vendedor puede enviar sin aprobación
  cotizaciones_supervisores: [],   // emails habilitados a VER todas las cotizaciones en solo-lectura, sin importar su rol (coordinación de ventas). [] = solo admin/jefe_taller/gerente ven todas
  mail_bcc_cotizacion:       [],   // emails en copia oculta (BCC) de cada cotización enviada al cliente ([] = sin copia)
  alertas:                   [],  // array de {id, kind, threshold, severity, message, enabled} — ver AdminMetrics.evaluateAlertas
  // Categorías del catálogo de piezas (select en piezas-tarifas; el drawer de
  // cotizar-orden agrupa por el string libre del doc, así que una categoría
  // nueva aparece sola). Editable en admin/config.html.
  piezas_categorias: [
    'Batería', 'Antena', 'Cargador', 'Clip', 'Fuente', 'Repuesto interno', 'Servicio', 'Otros',
  ],
  // Grupos PoC propuestos como chips de alta rápida en admin/grupos (editable).
  poc_grupos_comunes: [
    'Ventas', 'Operaciones', 'Administración', 'Gerencia', 'Contabilidad',
    'GPS', 'Bodega', 'Logística', 'Soporte', 'Mantenimiento', 'Cobranzas', 'Recursos Humanos',
  ],
});

const EmpresaService = {

  async getOperadores() {
    const db = firebase.firestore();
    const doc = await db.collection('empresa').doc('operadores').get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async getDoc(docId) {
    const db = firebase.firestore();
    const doc = await db.collection('empresa').doc(docId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
  },

  async setDoc(docId, data) {
    const db = firebase.firestore();
    return db.collection('empresa').doc(docId).set(data);
  },

  /**
   * Read the admin-tunable config document, merged over hardcoded defaults.
   * Never throws — on error returns the defaults so the calling page degrades
   * gracefully (offline, missing doc, ITP-blocked Safari, etc.).
   */
  async getConfig() {
    try {
      const d = await this.getDoc('config');
      return { ...EMPRESA_CONFIG_DEFAULTS, ...(d || {}) };
    } catch (err) {
      console.warn('[EmpresaService.getConfig] fallback to defaults:', err?.code || err);
      return { ...EMPRESA_CONFIG_DEFAULTS };
    }
  },

  /**
   * Patch-merge the config doc and stamp updater + timestamp.
   * Caller is responsible for value validation.
   */
  async setConfig(patch) {
    const db = firebase.firestore();
    const uid = firebase.auth().currentUser?.uid || null;
    return db.collection('empresa').doc('config').set({
      ...patch,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: uid,
    }, { merge: true });
  },

  CONFIG_DEFAULTS: EMPRESA_CONFIG_DEFAULTS,
};

window.EmpresaService = EmpresaService;
