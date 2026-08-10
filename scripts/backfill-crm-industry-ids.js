/**
 * ====================================================
 * scripts/backfill-crm-industry-ids.js
 *
 * One-time backfill: assigns industry_id to pre-existing CRM
 * records (crm_leads, crm_lead_contact_persons is left alone —
 * it's keyed off lead_id, not industry_id directly).
 *
 * Only touches rows where industry_id IS NULL. Never rewrites
 * a row that already has an industry_id set.
 *
 * Usage: node scripts/backfill-crm-industry-ids.js
 * ====================================================
 */
const pool = require('../config/database');
const { ensureIndustrySchema } = require('../services/industryService');

const CRM_TABLES = [
  'crm_leads',
  'crm_followups',
  'crm_campaigns',
  'crm_proposals',
  'crm_templates',
  'crm_contacts',
];

(async () => {
  try {
    await ensureIndustrySchema(); // make sure industries table + industry_id columns exist

    // Get every business_id that actually has CRM data needing a home.
    const { rows: businesses } = await pool.query(`
      SELECT DISTINCT business_id FROM (
        SELECT 1 AS business_id -- fallback: default business used across this codebase
      ) b
    `);
    // NOTE: business_id isn't stored on CRM rows themselves (single-tenant
    // schema), so we resolve a single default industry per the app's
    // DEFAULT_BUSINESS_ID (1), matching industryController.js.
    const DEFAULT_BUSINESS_ID = 1;

    // Find (or create) a default/fallback industry to backfill into.
    let { rows: industries } = await pool.query(
      `SELECT * FROM industries WHERE business_id = $1 AND is_active = true ORDER BY id ASC LIMIT 1`,
      [DEFAULT_BUSINESS_ID]
    );

    let fallbackIndustry = industries[0];

    if (!fallbackIndustry) {
      console.log('No existing industry found — creating a "Default Industry" workspace to hold legacy CRM data.');
      const created = await pool.query(
        `INSERT INTO industries (business_id, name, code, industry_type, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [DEFAULT_BUSINESS_ID, 'Default Industry', 'default_industry', 'general_manufacturing']
      );
      fallbackIndustry = created.rows[0];
    }

    console.log(`Backfilling legacy CRM rows into industry: "${fallbackIndustry.name}" (id=${fallbackIndustry.id})`);

    for (const table of CRM_TABLES) {
      const result = await pool.query(
        `UPDATE ${table} SET industry_id = $1 WHERE industry_id IS NULL`,
        [fallbackIndustry.id]
      );
      console.log(`  ${table}: ${result.rowCount} row(s) backfilled`);
    }

    console.log('✅ CRM industry_id backfill complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  }
})();