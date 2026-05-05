/**
 * Migration script to add cliente_nombre_lower field to all contracts
 * This enables server-side text search on client names
 * 
 * Run with: node migrate-add-cliente-nombre-lower.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function migrateContracts() {
  console.log('🔄 Starting migration: Adding cliente_nombre_lower field...\n');
  
  const batch = db.batch();
  let count = 0;
  let updated = 0;
  let skipped = 0;

  try {
    // Get all contracts
    const snapshot = await db.collection('contratos').get();
    
    console.log(`📊 Found ${snapshot.size} contracts to process\n`);

    snapshot.forEach(doc => {
      count++;
      const data = doc.data();
      
      // Check if already has the field
      if (data.cliente_nombre_lower) {
        skipped++;
        console.log(`⏭️  [${count}/${snapshot.size}] Skipping ${doc.id} - already has cliente_nombre_lower`);
        return;
      }
      
      // Add the lowercase field
      if (data.cliente_nombre) {
        const clienteNombreLower = data.cliente_nombre.toLowerCase();
        batch.update(doc.ref, { cliente_nombre_lower: clienteNombreLower });
        updated++;
        console.log(`✅ [${count}/${snapshot.size}] Queued ${doc.id}: "${data.cliente_nombre}" → "${clienteNombreLower}"`);
      } else {
        console.log(`⚠️  [${count}/${snapshot.size}] Warning: ${doc.id} has no cliente_nombre`);
        skipped++;
      }
    });

    // Commit the batch
    if (updated > 0) {
      console.log(`\n💾 Committing batch update for ${updated} contracts...`);
      await batch.commit();
      console.log('✅ Batch committed successfully!');
    }

    console.log('\n📈 Migration Summary:');
    console.log(`   Total contracts: ${snapshot.size}`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    console.error('❌ Error during migration:', error);
    process.exit(1);
  }
}

migrateContracts()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  });
