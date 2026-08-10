/**
 * ====================================================
 * scripts/fix-expenses-unique-constraints.js
 *
 * Same class of issue as fix-stock-adjustments-reference-no-constraint.js:
 * if expenses.expense_number or expense_categories.code has a
 * pre-existing single-column UNIQUE constraint (common default
 * naming: expenses_expense_number_key / expense_categories_code_key),
 * two industries generating the same number/code (e.g. "EP-2026-001"
 * or "EXP-001") will collide at the database level even though
 * app code now scopes duplicate checks per industry.
 *
 * This migration, for EACH of the two columns:
 *   1. Finds any UNIQUE constraint whose ONLY column is that column
 *      (found dynamically via information_schema — doesn't assume
 *      a specific constraint name, since it may vary by environment)
 *   2. Drops it
 *   3. Adds a composite UNIQUE (industry_id, <column>) instead
 *
 * Safe to run multiple times — every step checks current state
 * first and only acts if the expected state isn't already there.
 * Does not touch any row data. If no such constraint exists on a
 * column (e.g. it was never enforced at the DB level), that
 * column is skipped with a log message — nothing to fix there.
 *
 * Usage: node scripts/fix-expenses-unique-constraints.js
 * ====================================================
 */
const pool = require('../config/database');

const TARGETS = [
  { table: 'expenses',           column: 'expense_number', newConstraint: 'expenses_industry_expense_number_key' },
  { table: 'expense_categories', column: 'code',            newConstraint: 'expense_categories_industry_code_key' },
];

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
    for (const { table, column, newConstraint } of TARGETS) {
      const oldConstraint = await findSingleColumnUniqueConstraint(table, column);

      if (oldConstraint) {
        await pool.query(`ALTER TABLE ${table} DROP CONSTRAINT "${oldConstraint}"`);
        console.log(`✅ [${table}] Dropped old single-column constraint: ${oldConstraint}`);
      } else {
        console.log(`ℹ️  [${table}] No single-column UNIQUE constraint on "${column}" found — nothing to drop.`);
      }

      const newCheck = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [newConstraint]);
      if (newCheck.rows.length === 0) {
        await pool.query(
          `ALTER TABLE ${table} ADD CONSTRAINT ${newConstraint} UNIQUE (industry_id, ${column})`
        );
        console.log(`✅ [${table}] Added new constraint: ${newConstraint} UNIQUE (industry_id, ${column})`);
      } else {
        console.log(`ℹ️  [${table}] New constraint "${newConstraint}" already present — skipping add.`);
      }
    }

    console.log('✅ Expense unique-constraint fix complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('   If this failed while ADDing a composite constraint, it likely means two rows');
    console.error('   in the SAME industry already share the same value — resolve that duplicate');
    console.error('   manually, then re-run this script.');
    process.exit(1);
  }
})();