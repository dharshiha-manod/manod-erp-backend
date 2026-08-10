/**
 * ====================================================
 * scripts/backfill-product-industry-ids.js
 *
 * One-time backfill: assigns industry_id to pre-existing Product
 * module records (product_categories, product_brands, product_units,
 * product_variations, product_variation_values, products,
 * product_stock_by_location, product_selling_prices,
 * product_warranties, selling_price_groups).
 *
 * Only touches rows where industry_id IS NULL. Never rewrites
 * a row that already has an industry_id set.
 *
 * Reuses the same fallback industry as backfill-crm-industry-ids.js
 * (looks for an existing industry first; only creates a new
 * "Default Industry" if none exists yet) so legacy Products and
 * legacy CRM data end up in the same workspace.
 *
 * Usage: node scripts/backfill-product-industry-ids.js
 * ====================================================
 */
const pool = require('../config/database');
const { ensureIndustrySchema } = require('../services/industryService');

const PRODUCT_TABLES = [
  'product_categories',
  'product_brands',
  'product_units',
  'product_variations',
  'product_variation_values',
  'products',
  'product_stock_by_location',
  'product_selling_prices',
  'product_warranties',
  'selling_price_groups',
];

(async () => {
  try {
    await ensureIndustrySchema(); // make sure industries table + industry_id columns exist

    // NOTE: business_id isn't stored on Product rows themselves
    // (single-tenant schema), so we resolve a single default industry per
    // the app's DEFAULT_BUSINESS_ID (1), matching industryController.js
    // and backfill-crm-industry-ids.js.
    const DEFAULT_BUSINESS_ID = 1;

    // Find (or create) a default/fallback industry to backfill into.
    let { rows: industries } = await pool.query(
      `SELECT * FROM industries WHERE business_id = $1 AND is_active = true ORDER BY id ASC LIMIT 1`,
      [DEFAULT_BUSINESS_ID]
    );

    let fallbackIndustry = industries[0];

    if (!fallbackIndustry) {
      console.log('No existing industry found — creating a "Default Industry" workspace to hold legacy Product data.');
      const created = await pool.query(
        `INSERT INTO industries (business_id, name, code, industry_type, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [DEFAULT_BUSINESS_ID, 'Default Industry', 'default_industry', 'general_manufacturing']
      );
      fallbackIndustry = created.rows[0];
    }

    console.log(`Backfilling legacy Product rows into industry: "${fallbackIndustry.name}" (id=${fallbackIndustry.id})`);

    for (const table of PRODUCT_TABLES) {
      const result = await pool.query(
        `UPDATE ${table} SET industry_id = $1 WHERE industry_id IS NULL`,
        [fallbackIndustry.id]
      );
      console.log(`  ${table}: ${result.rowCount} row(s) backfilled`);
    }

    console.log('✅ Product industry_id backfill complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  }
})();