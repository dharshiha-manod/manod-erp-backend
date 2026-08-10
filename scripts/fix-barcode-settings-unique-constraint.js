/**
 * ====================================================
 * scripts/fix-barcode-settings-unique-constraint.js
 *
 * barcode_settings previously had a single-column UNIQUE
 * constraint on business_id (common default naming:
 * barcode_settings_business_id_key), which only allowed ONE
 * barcode-settings row per business. Now that barcode settings
 * are industry-scoped, two industries under the same business
 * would collide at the database level even though app code
 * (settingsService.js updateBarcodeSettings) already upserts on
 * ON CONFLICT (business_id, industry_id).
 *
 * This migration:
 *   1. Finds any UNIQUE constraint whose ONLY column is business_id
 *      (found dynamically via information_schema — doesn't assume
 *      a specific constraint name, since it may vary by environment)
 *   2. Drops it
 *   3. Adds a composite UNIQUE (business_id, industry_id) instead
 *
 * Safe to run multiple times — every step checks current state
 * first and only acts if the expected state isn't already there.
 * Does not touch any row data. If no such old constraint exists
 * (e.g. it was never enforced at the DB level), that step is
 * skipped with a log message — nothing to fix there.
 *
 * Usage: node scripts/fix-barcode-settings-unique-constraint.js
 * ====================================================
 */
const pool = require('../config/database');

const TABLE = 'barcode_settings';
const COLUMN = 'business_id';
const NEW_CONSTRAINT = 'barcode_settings_business_industry_key';

const findSingleColumnUniqueConstraint = async (table, column) => {
  // Finds a UNIQUE constraint on `table` whose column set is exactly {column}.
  const { rows } = await pool.query(
    `SELECT tc.constraint_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
     WHERE tc.constraint_type = 'UNIQUE'
       AND tc.table_name = $1
       AND tc.table_schema = 'public'
     GROUP BY tc.constraint_name
     HAVING COUNT(*) = 1 AND bool_and(kcu.column_name = $2)`,
    [table, column]
  );
  return rows[0]?.constraint_name || null;
};

(async () => {
  try {
    const oldConstraint = await findSingleColumnUniqueConstraint(TABLE, COLUMN);

    if (oldConstraint) {
      await pool.query(`ALTER TABLE ${TABLE} DROP CONSTRAINT "${oldConstraint}"`);
      console.log(`✅ [${TABLE}] Dropped old single-column constraint: ${oldConstraint}`);
    } else {
      console.log(`ℹ️  [${TABLE}] No single-column UNIQUE constraint on "${COLUMN}" found — nothing to drop.`);
    }

    const newCheck = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [NEW_CONSTRAINT]);
    if (newCheck.rows.length === 0) {
      await pool.query(
        `ALTER TABLE ${TABLE} ADD CONSTRAINT ${NEW_CONSTRAINT} UNIQUE (business_id, industry_id)`
      );
      console.log(`✅ [${TABLE}] Added new constraint: ${NEW_CONSTRAINT} UNIQUE (business_id, industry_id)`);
    } else {
      console.log(`ℹ️  [${TABLE}] New constraint "${NEW_CONSTRAINT}" already present — skipping add.`);
    }

    console.log('✅ barcode_settings unique-constraint fix complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('   If this failed while ADDing the composite constraint, it likely means two rows');
    console.error('   for the SAME business already share the same industry_id (or industry_id is NULL');
    console.error('   on some rows) — run scripts/backfill-settings-industry-ids.js first, resolve any');
    console.error('   remaining duplicates manually, then re-run this script.');
    process.exit(1);
  }
})();