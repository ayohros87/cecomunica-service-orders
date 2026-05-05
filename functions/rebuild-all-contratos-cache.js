/**
 * rebuild-all-contratos-cache.js
 * 
 * Script administrativo para reconstruir el cache de órdenes en contratos
 * 
 * PROPÓSITO:
 *   Recalcula y actualiza manualmente el cache de contratos/{id}/ordenes/{ordenId}
 *   para todos los contratos que tienen órdenes asociadas.
 *   
 *   Útil para:
 *   - Migración inicial cuando se implementa la CF por primera vez
 *   - Reparar datos después de períodos sin CF activa
 *   - Limpiar caches huérfanos o inconsistentes
 * 
 * USO:
 *   node rebuild-all-contratos-cache.js
 * 
 * SEGURIDAD:
 *   - Requiere admin SDK (usa credenciales por defecto)
 *   - Modo dry-run disponible para preview
 *   - Genera log detallado de operaciones
 */

const admin = require("firebase-admin");

// Inicializar Firebase Admin (usa credenciales por defecto)
admin.initializeApp();
const db = admin.firestore();

// ===== CONFIGURACIÓN =====
const DRY_RUN = false; // Cambiar a false para escribir en DB
const BATCH_SIZE = 500;
const LOG_EVERY = 10;
const MAX_ORDENES_PER_BATCH = 100; // Para evitar timeout

// ===== HELPERS =====

function normalizeSerial(equipo) {
  if (!equipo) return "";
  return (equipo.serial || equipo.SERIAL || equipo.numero_de_serie || "")
    .toString()
    .trim();
}

function extractCacheData(ordenId, ordenData) {
  if (!ordenData) return null;
  
  const equipos = (ordenData.equipos || []).filter(e => !e.eliminado);
  const serials = equipos.map(normalizeSerial).filter(Boolean);
  
  return {
    numero_orden: ordenId,
    cliente_id: ordenData.cliente_id || null,
    cliente_nombre: ordenData.cliente_nombre || null,
    tipo_de_servicio: ordenData.tipo_de_servicio || null,
    estado_reparacion: ordenData.estado_reparacion || null,
    fecha_creacion: ordenData.fecha_creacion || null,
    equipos: equipos.map(e => ({
      serial: normalizeSerial(e),
      modelo: e.modelo || e.MODEL || e.modelo_nombre || "",
      descripcion: e.descripcion || e.nombre || "",
      unit_id: e.unit_id || e.unitId || "",
      sim: e.sim || e.simcard || ""
    })),
    equipos_count: equipos.length,
    serials,
    updated_at: admin.firestore.FieldValue.serverTimestamp(),
    _rebuilt_at: admin.firestore.FieldValue.serverTimestamp()
  };
}

// ===== MAIN =====

async function rebuildAllContratosCache() {
  console.log("🔄 Iniciando rebuild de cache de contratos...");
  console.log(`   Modo: ${DRY_RUN ? "DRY RUN (sin escribir)" : "WRITE (escribirá en DB)"}`);
  console.log("");
  
  try {
    // Paso 1: Obtener todas las órdenes con contrato aplicable
    console.log("📥 Cargando órdenes con contrato aplicable...");
    const ordenesSnapshot = await db.collection("ordenes_de_servicio")
      .where("contrato.aplica", "==", true)
      .where("eliminado", "!=", true)
      .get();
    
    console.log(`   ✅ ${ordenesSnapshot.size} órdenes encontradas con contrato`);
    console.log("");
    
    if (ordenesSnapshot.empty) {
      console.log("⚠️  No hay órdenes con contrato para procesar");
      return;
    }
    
    // Agrupar por contrato
    const ordenesPerContrato = new Map();
    let sinContratoDocId = 0;
    
    ordenesSnapshot.forEach(doc => {
      const data = doc.data();
      const contratoDocId = data.contrato?.contrato_doc_id;
      
      if (!contratoDocId) {
        sinContratoDocId++;
        return;
      }
      
      if (!ordenesPerContrato.has(contratoDocId)) {
        ordenesPerContrato.set(contratoDocId, []);
      }
      
      ordenesPerContrato.get(contratoDocId).push({
        id: doc.id,
        data
      });
    });
    
    console.log("📊 Análisis:");
    console.log(`   ✅ Contratos únicos: ${ordenesPerContrato.size}`);
    console.log(`   ⚠️  Órdenes sin contrato_doc_id: ${sinContratoDocId}`);
    console.log("");
    
    // Paso 2: Procesar cada contrato
    console.log("⚙️  Procesando contratos...");
    let processed = 0;
    let totalOrdenesUpdated = 0;
    let errors = [];
    
    for (const [contratoDocId, ordenes] of ordenesPerContrato.entries()) {
      processed++;
      
      if (processed % LOG_EVERY === 0) {
        console.log(`   📊 Progreso: ${processed}/${ordenesPerContrato.size} contratos`);
      }
      
      try {
        // Verificar que el contrato existe
        const contratoRef = db.collection("contratos").doc(contratoDocId);
        const contratoSnap = await contratoRef.get();
        
        if (!contratoSnap.exists) {
          errors.push({
            contratoId: contratoDocId,
            error: "Contrato no existe",
            ordenesCount: ordenes.length
          });
          continue;
        }
        
        if (DRY_RUN) {
          console.log(`   [DRY RUN] Procesaría contrato ${contratoDocId} con ${ordenes.length} órdenes`);
          totalOrdenesUpdated += ordenes.length;
          continue;
        }
        
        // Escribir cache para cada orden
        const batch = db.batch();
        let batchCount = 0;
        
        for (const orden of ordenes) {
          const cacheData = extractCacheData(orden.id, orden.data);
          if (!cacheData) continue;
          
          const cacheRef = contratoRef
            .collection("ordenes")
            .doc(orden.id);
          
          batch.set(cacheRef, cacheData, { merge: true });
          batchCount++;
          
          if (batchCount >= BATCH_SIZE) {
            await batch.commit();
            batchCount = 0;
          }
        }
        
        if (batchCount > 0) {
          await batch.commit();
        }
        
        // Actualizar resumen del contrato
        const lastOrden = ordenes[ordenes.length - 1];
        const lastCacheData = extractCacheData(lastOrden.id, lastOrden.data);
        
        await contratoRef.update({
          os_linked: true,
          os_last_orden_id: lastOrden.id,
          os_last_updated_at: admin.firestore.FieldValue.serverTimestamp(),
          os_equipos_count_last: lastCacheData.equipos_count,
          os_serials_preview: lastCacheData.serials.slice(0, 3),
          os_has_equipos: lastCacheData.equipos_count > 0,
          os_dirty: false, // Limpiar flag de dirty
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
          _cache_rebuilt_at: admin.firestore.FieldValue.serverTimestamp()
        });
        
        totalOrdenesUpdated += ordenes.length;
        
      } catch (err) {
        errors.push({
          contratoId: contratoDocId,
          error: err.message,
          ordenesCount: ordenes.length
        });
      }
    }
    
    console.log("");
    console.log("📊 Resultados:");
    console.log(`   ✅ Contratos procesados: ${processed}`);
    console.log(`   ✅ Órdenes actualizadas: ${totalOrdenesUpdated}`);
    console.log(`   ❌ Errores: ${errors.length}`);
    console.log("");
    
    if (errors.length > 0) {
      console.log("⚠️  Errores encontrados:");
      errors.forEach(e => {
        console.log(`   ${e.contratoId} (${e.ordenesCount} órdenes): ${e.error}`);
      });
      console.log("");
    }
    
    if (DRY_RUN) {
      console.log("🏁 DRY RUN completado. No se escribió nada en DB.");
      console.log("   Para escribir, cambia DRY_RUN = false");
    } else {
      console.log("🎉 Rebuild completado exitosamente!");
      console.log("");
      console.log("📋 Siguiente paso:");
      console.log("   1) Verificar iconos 📦 en contratos/index.html");
      console.log("   2) Verificar modales de equipos funcionando");
      console.log("   3) Las futuras actualizaciones serán automáticas (CF)");
    }
    
  } catch (error) {
    console.error("❌ Error fatal:", error);
    throw error;
  }
}

// ===== EJECUCIÓN =====
if (require.main === module) {
  rebuildAllContratosCache()
    .then(() => {
      console.log("");
      console.log("✅ Proceso terminado");
      process.exit(0);
    })
    .catch(error => {
      console.error("");
      console.error("❌ Error fatal:", error);
      process.exit(1);
    });
}

module.exports = { rebuildAllContratosCache };
