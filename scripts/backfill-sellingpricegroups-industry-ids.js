/**
 * ====================================================
 * scripts/backfill-sellingpricegroups-industry-ids.js
 *
 * One-time backfill: assigns industry_id to pre-existing
 * Selling Price Group records (selling_price_groups).
 *
 * Only touches rows where industry_id IS NULL. Never rewrites
 * a row that already has an industry_id set. Same pattern as
 * backfill-expenses-industry-ids.js.
 *
 * Usage: node scripts/backfill-sellingpricegroups-industry-ids.js
 * ====================================================
 */
const pool = require('../config/database');
const { ensureIndustrySchema } = require('../services/industryService');

(async () => {
  try {
    await ensureIndustrySchema();

    const DEFAULT_BUSINESS_ID = 1;

    let { rows: industries } = await pool.query(
      `SELECT * FROM industries WHERE business_id = $1 AND is_active = true ORDER BY id ASC LIMIT 1`,
      [DEFAULT_BUSINESS_ID]
    );

    let fallbackIndustry = industries[0];

    if (!fallbackIndustry) {
      console.log('No existing industry found — creating a "Default Industry" workspace to hold legacy Selling Price Group data.');
      const created = await pool.query(
        `INSERT INTO industries (business_id, name, code, industry_type, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [DEFAULT_BUSINESS_ID, 'Default Industry', 'default_industry', 'general_manufacturing']
      );
      fallbackIndustry = created.rows[0];
    }

    console.log(`Backfilling legacy Selling Price Group rows into industry: "${fallbackIndustry.name}" (id=${fallbackIndustry.id})`);

    const result = await pool.query(
      `UPDATE selling_price_groups SET industry_id = $1 WHERE industry_id IS NULL`,
      [fallbackIndustry.id]
    );
    console.log(`  selling_price_groups: ${result.rowCount} row(s) backfilled`);

    console.log('✅ Selling Price Group industry_id backfill complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  }
})();