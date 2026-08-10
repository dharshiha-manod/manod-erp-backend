/**
 * ====================================================
 * scripts/fix-stock-adjustments-reference-no-constraint.js
 *
 * The pre-existing "stock_adjustments_reference_no_key" UNIQUE
 * constraint applies to reference_no ALONE, across the whole
 * table. Now that Stock Adjustments are industry-scoped, two
 * different industries legitimately generate the same reference
 * number (e.g. "SA-2026-001" in both Industry A and Industry B),
 * and Postgres rejects the second insert with:
 *   duplicate key value violates unique constraint
 *   "stock_adjustments_reference_no_key"
 *
 * This migration:
 *   1. Drops the old single-column unique constraint (if present)
 *   2. Adds a composite UNIQUE (industry_id, reference_no) instead
 *
 * Safe to run multiple times — every step checks pg_constraint
 * first and only acts if the expected state isn't already there.
 * Does not touch any row data.
 *
 * Usage: node scripts/fix-stock-adjustments-reference-no-constraint.js
 * ====================================================
 */
const pool = require('../config/database');

const OLD_CONSTRAINT = 'stock_adjustments_reference_no_key';
const NEW_CONSTRAINT = 'stock_adjustments_industry_reference_no_key';

(async () => {
  try {
    // ── Step 1: drop the old global unique constraint, if it exists ──
    const oldCheck = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1`,
      [OLD_CONSTRAINT]
    );
    if (oldCheck.rows.length > 0) {
      await pool.query(`ALTER TABLE stock_adjustments DROP CONSTRAINT ${OLD_CONSTRAINT}`);
      console.log(`✅ Dropped old constraint: ${OLD_CONSTRAINT}`);
    } else {
      console.log(`ℹ️  Old constraint "${OLD_CONSTRAINT}" not present — skipping drop.`);
    }

    // ── Step 2: add the new composite unique constraint, if missing ──
    const newCheck = await pool.query(
      `SELECT 1 FROM pg_constraint WHERE conname = $1`,
      [NEW_CONSTRAINT]
    );
    if (newCheck.rows.length === 0) {
      await pool.query(
        `ALTER TABLE stock_adjustments
         ADD CONSTRAINT ${NEW_CONSTRAINT} UNIQUE (industry_id, reference_no)`
      );
      console.log(`✅ Added new constraint: ${NEW_CONSTRAINT} UNIQUE (industry_id, reference_no)`);
    } else {
      console.log(`ℹ️  New constraint "${NEW_CONSTRAINT}" already present — skipping add.`);
    }

    console.log('✅ Stock Adjustment reference_no constraint fix complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
})();