/**
 * ====================================================
 * scripts/backfill-hrm-industry-ids.js
 *
 * One-time backfill: assigns industry_id to pre-existing HRM
 * records across all HRM tables. Same pattern as
 * backfill-crm-industry-ids.js / backfill-accounting-industry-ids.js.
 *
 * Only touches rows where industry_id IS NULL. Never rewrites
 * a row that already has an industry_id set.
 *
 * Usage: node scripts/backfill-hrm-industry-ids.js
 * ====================================================
 */
const pool = require('../config/database');
const { ensureIndustrySchema } = require('../services/industryService');

const HRM_TABLES = [
  'hrm_employees', 'hrm_departments', 'hrm_designations', 'hrm_attendance',
  'hrm_leave_types', 'hrm_leaves', 'hrm_holidays', 'hrm_shifts',
  'hrm_payroll', 'hrm_payroll_groups', 'hrm_payroll_group_components',
  'hrm_payroll_items', 'hrm_pay_components', 'hrm_employee_component_overrides',
  'hrm_employee_documents', 'hrm_docs_employee', 'hrm_employee_education',
  'hrm_edu_employee', 'hrm_employee_experience', 'hrm_exp_employee',
  'hrm_employee_skills', 'hrm_skills_employee', 'hrm_employee_timeline',
  'hrm_timeline_employee', 'hrm_notifications',
  'hrm_notifications_recipient', 'hrm_sales_targets', 'hrm_settings',
];

(async () => {
  try {
    await ensureIndustrySchema(); // make sure industries table + industry_id columns exist

    const DEFAULT_BUSINESS_ID = 1;

    // Find (or create) a default/fallback industry to backfill into.
    let { rows: industries } = await pool.query(
      `SELECT * FROM industries WHERE business_id = $1 AND is_active = true ORDER BY id ASC LIMIT 1`,
      [DEFAULT_BUSINESS_ID]
    );

    let fallbackIndustry = industries[0];

    if (!fallbackIndustry) {
      console.log('No existing industry found — creating a "Default Industry" workspace to hold legacy HRM data.');
      const created = await pool.query(
        `INSERT INTO industries (business_id, name, code, industry_type, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [DEFAULT_BUSINESS_ID, 'Default Industry', 'default_industry', 'general_manufacturing']
      );
      fallbackIndustry = created.rows[0];
    }

    console.log(`Backfilling legacy HRM rows into industry: "${fallbackIndustry.name}" (id=${fallbackIndustry.id})`);

    for (const table of HRM_TABLES) {
      try {
        const result = await pool.query(
          `UPDATE ${table} SET industry_id = $1 WHERE industry_id IS NULL`,
          [fallbackIndustry.id]
        );
        console.log(`  ${table}: ${result.rowCount} row(s) backfilled`);
      } catch (e) {
        console.error(`  ⚠️ ${table} backfill warning: ${e.message}`);
      }
    }

    console.log('✅ HRM industry_id backfill complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  }
})();