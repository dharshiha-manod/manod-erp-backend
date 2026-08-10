/**
 * ====================================================
 * scripts/backfill-user-industry-ids.js
 *
 * One-time backfill: assigns industry_id to pre-existing
 * User Management records (users, roles). role_permissions
 * is left alone — it's keyed off role_id, not industry_id
 * directly, so it inherits isolation from roles.industry_id.
 *
 * Only touches rows where industry_id IS NULL. Never rewrites
 * a row that already has an industry_id set.
 *
 * Usage: node scripts/backfill-user-industry-ids.js
 * ====================================================
 */
const pool = require('../config/database');
const { ensureIndustrySchema } = require('../services/industryService');

(async () => {
  try {
    await ensureIndustrySchema(); // make sure industries table + industry_id columns exist

    // NOTE: business_id isn't stored on users/roles rows themselves
    // (single-tenant schema), so we resolve a single default industry
    // per the app's DEFAULT_BUSINESS_ID (1), matching industryController.js.
    const DEFAULT_BUSINESS_ID = 1;

    // Find (or create) a default/fallback industry to backfill into.
    let { rows: industries } = await pool.query(
      `SELECT * FROM industries WHERE business_id = $1 AND is_active = true ORDER BY id ASC LIMIT 1`,
      [DEFAULT_BUSINESS_ID]
    );

    let fallbackIndustry = industries[0];

    if (!fallbackIndustry) {
      console.log('No existing industry found — creating a "Default Industry" workspace to hold legacy user/role data.');
      const created = await pool.query(
        `INSERT INTO industries (business_id, name, code, industry_type, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [DEFAULT_BUSINESS_ID, 'Default Industry', 'default_industry', 'general_manufacturing']
      );
      fallbackIndustry = created.rows[0];
    }

    console.log(`Backfilling legacy Users/Roles rows into industry: "${fallbackIndustry.name}" (id=${fallbackIndustry.id})`);

    // Roles first (users reference role by name, not FK, but keeping
    // order consistent with how the app resolves roles before users).
    const rolesResult = await pool.query(
      `UPDATE roles SET industry_id = $1 WHERE industry_id IS NULL`,
      [fallbackIndustry.id]
    );
    console.log(`  roles: ${rolesResult.rowCount} row(s) backfilled`);

    const usersResult = await pool.query(
      `UPDATE users SET industry_id = $1 WHERE industry_id IS NULL`,
      [fallbackIndustry.id]
    );
    console.log(`  users: ${usersResult.rowCount} row(s) backfilled`);

    console.log('✅ Users/Roles industry_id backfill complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  }
})();