/**
 * Migration script to repair broken UTF-8 encoding in contract `accion`
 * and `renovacion_modalidad` fields.
 *
 * Detects two forms of corruption seen in legacy documents:
 *   1. U+FFFD replacement char  — e.g.  "Renovaci�n", "Adici�n"
 *   2. UTF-8 → Latin-1 mojibake — e.g.  "RenovaciÃ³n", "AdiciÃ³n"
 *
 * Only documents that match a known-bad pattern AND a known-good target are
 * touched. Everything else is left alone and logged for inspection.
 *
 * Auth: uses Application Default Credentials. Make sure you've run
 *   gcloud auth application-default login
 * (or `firebase login` + `firebase use <project>`) before invoking.
 * If ADC can't find a project, set GOOGLE_CLOUD_PROJECT or pass
 * --project=<id> on the command line.
 *
 * Usage:
 *   node migrate-fix-accion-encoding.js              # dry-run (no writes)
 *   node migrate-fix-accion-encoding.js --apply      # actually write fixes
 *   node migrate-fix-accion-encoding.js --limit 50   # only process first N
 *   node migrate-fix-accion-encoding.js --project=cecomunica-prod
 */

const admin = require('firebase-admin');

const projectArg = process.argv.find(a => a.startsWith('--project='));
const projectId = projectArg ? projectArg.split('=')[1] : undefined;
admin.initializeApp(projectId ? { projectId } : undefined);
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : null;

// Known-good canonical values for each field.
const ACCION_TARGETS = ['Renovación', 'Adición'];
const MODALIDAD_TARGETS = ['Renovación sin equipo', 'Renovación con equipo'];

// Build a matcher that accepts any version where the accented vowel
// is replaced by either U+FFFD or the mojibake sequence "Ã³" / "Ã³n" etc.
// We match by stripping the canonical to its non-accent skeleton and
// comparing letter-by-letter, treating the bad char as a wildcard.
function tryFix(value, targets) {
  if (typeof value !== 'string' || !value) return null;

  // Fast path: already canonical
  if (targets.includes(value)) return null;

  // Quick heuristic: must contain either a replacement char or a typical
  // mojibake byte sequence — otherwise skip without comparing.
  const looksBad =
    value.includes('�') ||
    /Ã[-¿]/.test(value); // C3 followed by a UTF-8 continuation byte

  if (!looksBad) return null;

  for (const target of targets) {
    if (matchesCorrupted(value, target)) return target;
  }
  return null;
}

// True when `value` matches `target` after collapsing any U+FFFD or
// mojibake "Ã?" pair into the original accented character. We don't try
// to actually decode mojibake — we just check that everything outside
// the corrupted region is identical and that the corrupted region is in
// the position(s) where `target` has an accented vowel.
function matchesCorrupted(value, target) {
  let i = 0; // index into value
  let j = 0; // index into target
  while (j < target.length) {
    const tc = target[j];
    const vc = value[i];

    if (vc === tc) { i++; j++; continue; }

    // Target has an accented char here; value may have either U+FFFD
    // (1 char) or a 2-char mojibake sequence "Ã?" — accept both.
    if (isAccented(tc)) {
      if (vc === '�') { i++; j++; continue; }
      if (vc === 'Ã' && i + 1 < value.length) { i += 2; j++; continue; }
    }
    return false;
  }
  return i === value.length;
}

function isAccented(ch) {
  return /[áéíóúÁÉÍÓÚñÑ]/.test(ch);
}

async function migrate() {
  console.log(`🔄 Scanning contratos for encoding corruption in 'accion' / 'renovacion_modalidad'`);
  console.log(`   Mode: ${APPLY ? '✏️  APPLY (will write)' : '👀 DRY-RUN (no writes)'}`);
  if (LIMIT) console.log(`   Limit: first ${LIMIT} docs`);
  console.log('');

  let query = db.collection('contratos');
  if (LIMIT) query = query.limit(LIMIT);
  const snapshot = await query.get();
  console.log(`📊 Loaded ${snapshot.size} contratos\n`);

  const fixes = []; // { id, contrato_id, before: {...}, after: {...} }
  const flagged = []; // suspicious but no canonical match
  let clean = 0;

  snapshot.forEach(doc => {
    const data = doc.data();
    const before = {};
    const after = {};

    const accionFix = tryFix(data.accion, ACCION_TARGETS);
    if (accionFix !== null) {
      before.accion = data.accion;
      after.accion = accionFix;
    } else if (looksSuspicious(data.accion)) {
      flagged.push({ id: doc.id, contrato_id: data.contrato_id, field: 'accion', value: data.accion });
    }

    const modFix = tryFix(data.renovacion_modalidad, MODALIDAD_TARGETS);
    if (modFix !== null) {
      before.renovacion_modalidad = data.renovacion_modalidad;
      after.renovacion_modalidad = modFix;
    } else if (looksSuspicious(data.renovacion_modalidad)) {
      flagged.push({ id: doc.id, contrato_id: data.contrato_id, field: 'renovacion_modalidad', value: data.renovacion_modalidad });
    }

    if (Object.keys(after).length > 0) {
      fixes.push({ id: doc.id, ref: doc.ref, contrato_id: data.contrato_id, before, after });
    } else {
      clean++;
    }
  });

  console.log(`✅ Clean:       ${clean}`);
  console.log(`🔧 Fixable:     ${fixes.length}`);
  console.log(`⚠️  Flagged:    ${flagged.length} (suspicious but no canonical match — review manually)\n`);

  if (fixes.length > 0) {
    console.log('— Fixes preview —');
    fixes.forEach((f, idx) => {
      const tag = f.contrato_id || f.id;
      const changes = Object.keys(f.after)
        .map(k => `${k}: ${JSON.stringify(f.before[k])} → ${JSON.stringify(f.after[k])}`)
        .join(', ');
      console.log(`  [${idx + 1}] ${tag}  ${changes}`);
    });
    console.log('');
  }

  if (flagged.length > 0) {
    console.log('— Flagged (no auto-fix) —');
    flagged.forEach(f => {
      const tag = f.contrato_id || f.id;
      console.log(`  ${tag}  ${f.field} = ${JSON.stringify(f.value)}`);
    });
    console.log('');
  }

  if (!APPLY) {
    console.log('👀 Dry-run complete. Re-run with --apply to write the fixes above.');
    return;
  }

  if (fixes.length === 0) {
    console.log('✨ Nothing to write.');
    return;
  }

  // Firestore caps batches at 500 ops. Use 400 for headroom.
  const CHUNK = 400;
  for (let i = 0; i < fixes.length; i += CHUNK) {
    const slice = fixes.slice(i, i + CHUNK);
    const batch = db.batch();
    slice.forEach(f => batch.update(f.ref, f.after));
    await batch.commit();
    console.log(`💾 Committed ${Math.min(i + CHUNK, fixes.length)}/${fixes.length}`);
  }

  console.log('\n✅ Migration complete.');
}

function looksSuspicious(value) {
  if (typeof value !== 'string' || !value) return false;
  return value.includes('�') || /Ã[-¿]/.test(value);
}

migrate()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
  });
