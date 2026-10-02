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
  mail_orden_creada_to:      [],   // destinatarios del aviso "Nueva orden creada" ([] = fallback tecnico@cecomunica.com)
  email_recepcion_entregas:  '',   // buzón único que recibe copia de cada nota de entrega ('' = no copiar)
  email_recepcion:           [],   // avisos de órdenes de ENTRADA automáticas (equipos devueltos). [] = todos los usuarios con rol recepción
  email_taller:              [],   // emails del taller (jefe_taller) copiados en orden COMPLETADA y nota de entrega ([] = no copiar)
  email_cobranza:            [],   // resumen diario de equipos que el cliente no devolvió y hay que facturarle ([] = recepción, que es quien cierra las devoluciones)
  cotizacion_aprobacion_to:  [],   // emails que reciben la solicitud de aprobación de cotización ([] = fallback ventas@)
  email_solicitud_seriales:  [],   // usuarios que reciben "Solicitud de seriales" al aprobar contrato ([] = fallback inventario@)
  seriales_recordatorio_dias: 3,   // cada cuántos días se le recuerda a inventario un contrato con seriales pendientes
  entrada_recordatorio_dias: 7,    // días en cuarentena (devuelto_revision) sin inspección antes de avisar a recepción
  devolucion_sla_dias: 15,         // días que una orden de DEVOLUCIÓN puede estar abierta antes de escalar en el digest diario
  seriales_editores_extra:   [],   // emails habilitados a EDITAR seriales ya "asignados" (además de admin). [] = solo administradores
  qc_revisores_extra:        [],   // emails habilitados a FIRMAR el control de calidad (además de admin/jefe_taller). [] = solo esos dos. Sin suplentes, la cola de entregas se detiene si falta el jefe de taller
  cotizacion_descuento_max_pct: 20, // descuento % máximo que un vendedor puede enviar sin aprobación (== CotizacionTotales.POLICY_DEFAULT)
  cotizacion_total_max:     15000, // total máximo (USD) que un vendedor puede enviar sin aprobación
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

  // Misma memo de sesión que getDoc (POC y SIM lo leen en cada arranque).
  async getOperadores({ fresh = false } = {}) {
    return this.getDoc('operadores', { fresh });
  },

  // Memo de sesión (Sesion.memo, 30 min, revalidación en segundo plano): 21
  // pantallas leen empresa/config o tipo_de_servicio al arrancar, en serie
  // con las demás lecturas de arranque. `fresh: true` va al servidor siempre
  // (pantallas que EDITAN estos documentos).
  async getDoc(docId, { fresh = false } = {}) {
    const leer = async () => {
      const db = firebase.firestore();
      const doc = await db.collection('empresa').doc(docId).get();
      if (!doc.exists) return null;
      return { id: doc.id, ...doc.data() };
    };
    if (fresh || !window.Sesion?.memo) return leer();
    return Sesion.memo(`empresa:${docId}`, 30 * 60 * 1000, leer);
  },

  async setDoc(docId, data) {
    const db = firebase.firestore();
    window.Sesion?.olvidar?.(`empresa:${docId}`);
    return db.collection('empresa').doc(docId).set(data);
  },

  /**
   * Read the admin-tunable config document, merged over hardcoded defaults.
   * Never throws — on error returns the defaults so the calling page degrades
   * gracefully (offline, missing doc, ITP-blocked Safari, etc.).
   */
  async getConfig({ fresh = false } = {}) {
    try {
      const d = await this.getDoc('config', { fresh });
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
    const quien = await this._quien();
    return db.collection('empresa').doc('config').set({
      ...patch,
      updated_at: firebase.firestore.FieldValue.serverTimestamp(),
      updated_by: quien.uid,
      // Nombre y correo además del uid (auditoría UX 2026-09-28): la pantalla
      // mostraba "Última edición por <uid>".
      editado_por_nombre: quien.nombre,
      editado_por_email: quien.email,
    }, { merge: true });
  },

  // Quién es el usuario actual, para sellar registros. Nunca lanza.
  async _quien() {
    const u = firebase.auth().currentUser;
    if (!u) return { uid: null, nombre: null, email: null };
    let nombre = null;
    try { nombre = window.Sesion?.nombre ? await window.Sesion.nombre(u) : null; } catch (_) { /* sin nombre */ }
    return { uid: u.uid, nombre: nombre || u.displayName || null, email: u.email || null };
  },

  // ── Registro de acciones del panel (auditoría UX 2026-09-28) ───────────────
  // Colección `admin_audit`: {tipo, cambios|detalle, por{uid,nombre,email}, fecha}.
  // tipo: 'config' (guardado de Configuración/Alertas/PII), 'fusion' (clientes
  // duplicados), 'backfill'. Lo lee admin/auditoria.html. Requiere la regla
  // `match /admin_audit/{id}` (create/read solo admin, sin update/delete).
  async registrarAdminAudit(tipo, data) {
    const db = firebase.firestore();
    const quien = await this._quien();
    return db.collection('admin_audit').add({
      ...(data || {}),
      tipo,
      por: quien,
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
    });
  },

  async listAdminAudit({ limit = 300 } = {}) {
    const db = firebase.firestore();
    const snap = await db.collection('admin_audit').orderBy('fecha', 'desc').limit(limit).get();
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  },

  // Diff superficial para el registro y el confirm de Configuración: solo los
  // campos cuyo valor cambió, con antes → después.
  diffConfig(antes, despues) {
    const cambios = [];
    const norm = (v) => JSON.stringify(v === undefined ? null : v);
    for (const k of Object.keys(despues || {})) {
      if (norm((antes || {})[k]) !== norm(despues[k])) {
        cambios.push({ campo: k, antes: (antes || {})[k] === undefined ? null : antes[k], despues: despues[k] });
      }
    }
    return cambios;
  },

  CONFIG_DEFAULTS: EMPRESA_CONFIG_DEFAULTS,
};

window.EmpresaService = EmpresaService;
