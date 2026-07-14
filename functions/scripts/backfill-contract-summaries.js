/**
 * backfill-contract-summaries.js
 * 
 * Script para poblar os_count/equipos_total en contratos existentes
 * 
 * PROPÓSITO:
 *   Los campos os_count, equipos_total y tiene_os son mantenidos
 *   automáticamente por la Cloud Function onContratoOrdenWrite.
 *   Este script es necesario SOLO UNA VEZ para calcular valores
 *   para contratos que ya tenían órdenes antes de implementar
 *   la automatización.
 * 
 * USO:
 *   1) Ejecutar desde Terminal en carpeta functions/:
 *      node backfill-contract-summaries.js
 * 
 *   2) El script:
 *      - Lee todos los contratos
 *      - Para cada uno, cuenta órdenes en subcollection
 *      - Suma equipos_count de cada orden
 *      - Actualiza contrato con os_count/equipos_total/tiene_os
 * 
 * SEGURIDAD:
 *   - Usa admin SDK (requiere service account)
 *   - Solo actualiza contratos que NO tienen os_count definido
 *   - Modo dry-run disponible para preview sin escribir
 * 
 * DESPUÉS DE EJECUTAR:
 *   - Los valores se mantendrán automáticamente por la Cloud Function
 *   - NO es necesario volver a ejecutar este script
 *   - Front-end leerá estos campos para mostrar iconos instantáneamente
 */

const admin = require("firebase-admin");

// Inicializar Firebase Admin (usa credenciales por defecto del entorno)
admin.initializeApp();
const db = admin.firestore();

// ===== CONFIGURACIÓN =====
const DRY_RUN = false; // Cambiar a false para escribir en DB
const BATCH_SIZE = 500; // Firestore batch limit
const LOG_EVERY = 10; // Log cada N contratos procesados

// ===== FUNCIONES =====

/**
 * Procesa un contrato: cuenta órdenes y equipos
 */
async function processContract(contratoDoc) {
  const contratoId = contratoDoc.id;
  const contratoData = contratoDoc.data();
  
  // Saltar si ya tiene os_count definido (ya fue procesado)
  if (contratoData.os_count !== undefined && contratoData.os_count !== null) {
    return {
      contratoId,
      skipped: true,
      reason: "already_has_os_count"
    };
  }
  
  try {
    // Obtener órdenes de la subcollection
    const ordenesSnapshot = await contratoDoc.ref
      .collection("ordenes")
      .get();
    
    let osCount = 0;
    let equiposTotal = 0;
    
    // Contar y sumar
    ordenesSnapshot.forEach(ordenDoc => {
      osCount++;
      const ordenData = ordenDoc.data();
      const equiposCount = Number(ordenData.equipos_count || 0);
      equiposTotal += equiposCount;
    });
    
    return {
      contratoId,
      skipped: false,
      osCount,
      equiposTotal,
      tieneOS: osCount > 0,
      contratoRef: contratoDoc.ref
    };
  } catch (error) {
    return {
      contratoId,
      error: error.message
    };
  }
}

/**
 * Backfill principal
 */
async function backfillContractSummaries() {
  console.log("🚀 Iniciando backfill de resúmenes de contratos...");
  console.log(`   Modo: ${DRY_RUN ? "DRY RUN (sin escribir)" : "WRITE (escribirá en DB)"}`);
  console.log("");
  
  try {
    // Obtener todos los contratos (no eliminados)
    console.log("📥 Cargando contratos...");
    const contratosSnapshot = await db.collection("contratos")
      .where("deleted", "!=", true)
      .get();
    
    const totalContratos = contratosSnapshot.size;
    console.log(`   ✅ ${totalContratos} contratos encontrados`);
    console.log("");
    
    if (totalContratos === 0) {
      console.log("⚠️  No hay contratos para procesar");
      return;
    }
    
    // Procesar contratos en paralelo (con límite)
    console.log("⚙️  Procesando contratos...");
    const results = [];
    let processed = 0;
    
    for (const contratoDoc of contratosSnapshot.docs) {
      const result = await processContract(contratoDoc);
      results.push(result);
      processed++;
      
      if (processed % LOG_EVERY === 0) {
        console.log(`   📊 Progreso: ${processed}/${totalContratos}`);
      }
    }
    
    console.log("");
    console.log("📊 Análisis completado:");
    
    // Filtrar resultados
    const skipped = results.filter(r => r.skipped);
    const errors = results.filter(r => r.error);
    const toUpdate = results.filter(r => !r.skipped && !r.error);
    
    console.log(`   ⏭️  Saltados (ya tenían os_count): ${skipped.length}`);
    console.log(`   ❌ Errores: ${errors.length}`);
    console.log(`   ✅ Para actualizar: ${toUpdate.length}`);
    console.log("");
    
    if (errors.length > 0) {
      console.log("⚠️  Errores encontrados:");
      errors.forEach(e => {
        console.log(`      ${e.contratoId}: ${e.error}`);
      });
      console.log("");
    }
    
    if (toUpdate.length === 0) {
      console.log("✅ Nada que actualizar. Proceso completado.");
      return;
    }
    
    // Mostrar muestra de actualizaciones
    console.log("📝 Muestra de actualizaciones (primeros 5):");
    toUpdate.slice(0, 5).forEach(r => {
      console.log(`   ${r.contratoId}: os_count=${r.osCount}, equipos_total=${r.equiposTotal}`);
    });
    console.log("");
    
    // Escribir actualizaciones si no es dry-run
    if (DRY_RUN) {
      console.log("🏁 DRY RUN completado. No se escribió nada en DB.");
      console.log("   Para escribir, cambia DRY_RUN = false");
      return;
    }
    
    console.log("💾 Escribiendo actualizaciones en DB...");
    
    // Usar batches para eficiencia
    let batch = db.batch();
    let batchCount = 0;
    let batchesCommitted = 0;
    
    for (const result of toUpdate) {
      batch.update(result.contratoRef, {
        os_count: result.osCount,
        equipos_total: result.equiposTotal,
        tiene_os: result.tieneOS,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
        _backfill_date: admin.firestore.FieldValue.serverTimestamp()
      });
      
      batchCount++;
      
      if (batchCount >= BATCH_SIZE) {
        await batch.commit();
        batchesCommitted++;
        console.log(`   ✅ Batch ${batchesCommitted} committed (${batchCount} docs)`);
        batch = db.batch();
        batchCount = 0;
      }
    }
    
    // Commit remaining
    if (batchCount > 0) {
      await batch.commit();
      batchesCommitted++;
      console.log(`   ✅ Batch final committed (${batchCount} docs)`);
    }
    
    console.log("");
    console.log("🎉 Backfill completado exitosamente!");
    console.log(`   📝 ${toUpdate.length} contratos actualizados`);
    console.log(`   📦 ${batchesCommitted} batches escritos`);
    console.log("");
    console.log("📋 Siguiente paso:");
    console.log("   1) Verificar que los iconos 📦 aparezcan en contratos/index.html");
    console.log("   2) Los valores se mantendrán automáticamente por Cloud Function");
    console.log("   3) No es necesario volver a ejecutar este script");
    
  } catch (error) {
    console.error("❌ Error fatal:", error);
    throw error;
  }
}

// ===== EJECUCIÓN =====
if (require.main === module) {
  backfillContractSummaries()
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

module.exports = { backfillContractSummaries };
