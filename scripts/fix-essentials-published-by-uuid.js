/**
 * ====================================================
 * scripts/fix-essentials-published-by-uuid.js
 *
 * essentials_memos.published_by/updated_by and
 * essentials_kb_articles.published_by/updated_by were created as
 * INTEGER, but users.id is UUID — same mismatch class as
 * created_by (which is already correctly UUID on both tables).
 *
 * Converts the 4 mismatched columns to UUID. Safe to run once;
 * uses IF EXISTS / type checks so re-running is a no-op.
 *
 * Usage: node scripts/fix-essentials-published-by-uuid.js
 * ====================================================
 */
const pool = require('../config/database');

const TARGETS = [
  { table: 'essentials_memos',       column: 'published_by' },
  { table: 'essentials_memos',       column: 'updated_by' },
  { table: 'essentials_kb_articles', column: 'published_by' },
  { table: 'essentials_kb_articles', column: 'updated_by' },
];

(async () => {
  try {
    for (const { table, column } of TARGETS) {
      const { rows } = await pool.query(
        `SELECT data_type FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [table, column]
      );
      const currentType = rows[0]?.data_type;

      if (!currentType) {
        console.log(`ℹ️  [${table}] Column "${column}" not found — skipping.`);
        continue;
      }
      if (currentType === 'uuid') {
        console.log(`ℹ️  [${table}] "${column}" already uuid — skipping.`);
        continue;
      }

      await pool.query(
        `ALTER TABLE ${table} ALTER COLUMN ${column} TYPE UUID USING NULLIF(${column}::text, '')::uuid`
      );
      console.log(`✅ [${table}] Converted "${column}" from ${currentType} to uuid`);
    }

    console.log('✅ essentials published_by/updated_by uuid fix complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error('   If this failed on the USING cast, it likely means some rows have');
    console.error('   non-uuid integer values already stored in published_by/updated_by —');
    console.error('   those need to be nulled out or mapped to real user uuids first.');
    process.exit(1);
  }
})();