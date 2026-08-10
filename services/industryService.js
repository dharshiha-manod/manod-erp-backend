/**
 * ====================================================
 * INDUSTRY SERVICE
 * Manages Industry Workspaces (the data-isolation boundary)
 * ====================================================
 */
const pool = require('../config/database');

let industrySchemaReady = false;

// Every table listed here gets an industry_id column + index
// automatically the next time the server boots. Add a table name
// here when you isolate a new module — nothing else to configure.
// NEW
// NEW
const ISOLATED_TABLES = [
  // Products / Catalog
  'product_categories', 'product_brands', 'product_units', 'product_variations',
  'product_variation_values', 'products', 'product_stock_by_location',
  'product_selling_prices', 'product_warranties', 'selling_price_groups',
  // CRM
  'crm_leads', 'crm_lead_contact_persons', 'crm_followups', 'crm_campaigns',
'crm_proposals', 'crm_templates', 'crm_contacts',
'purchases', 'purchase_returns',
  'sales_invoices',

  // Sales (needed by Sales Commission Agents dashboard/commission calc)
  'sales_invoices',

  // Contacts (Customers / Suppliers / Customer Groups)
  'contacts', 'customer_groups',

  // Warehouses / Business Locations
  'business_locations',

  // Stock movements (Stock Transfer / Stock Adjustment)
  'stock_transfers', 'stock_adjustments',

  // Expenses
  'expenses', 'expense_categories',

// Settings (industry-specific slice only — see settingsService.js)
  'general_settings',
  'invoice_settings',
  'tax_rates', 'receipt_printers', 'barcode_settings',

// User Management (User Management Industry-isolation)
  'users', 'roles', 'role_permissions',

  // Sales Commission Agents
  'sales_commission_agents',

  // Manufacturing
  'mfg_plans', 'mfg_plan_resources', 'mfg_plan_machines',
  'mfg_bom', 'mfg_bom_items',
  'mfg_work_orders', 'mfg_wo_resources', 'mfg_wo_machines',
  'mfg_production',
  'mfg_resources', 'mfg_machines', 'mfg_machine_logs', 'mfg_machine_documents',
  'mfg_quality_checks', 'mfg_maintenance', 'mfg_schedule',

 // NEW
  // Accounting & Finance
  'accounting_accounts', 'accounting_bank_accounts', 'accounting_bank_transactions',
  'accounting_journal_entries', 'accounting_journal_lines', 'accounting_fixed_assets',
  'accounting_depreciation_log', 'accounting_cost_centers', 'accounting_budgets',
  'gst_settings',

// HRM (HRM Industry Workspace isolation — NEW)
  'hrm_employees', 'hrm_departments', 'hrm_designations', 'hrm_attendance',
  'hrm_leave_types', 'hrm_leaves', 'hrm_holidays', 'hrm_shifts',
  'hrm_payroll', 'hrm_payroll_groups', 'hrm_payroll_group_components',
  'hrm_payroll_items', 'hrm_pay_components', 'hrm_employee_component_overrides',
  'hrm_employee_documents', 'hrm_docs_employee', 'hrm_employee_education',
  'hrm_edu_employee', 'hrm_employee_experience', 'hrm_exp_employee',
  'hrm_employee_skills', 'hrm_skills_employee', 'hrm_employee_timeline',
  'hrm_timeline_employee', 'hrm_timeline_name', 'hrm_notifications',
  'hrm_notifications_recipient', 'hrm_sales_targets', 'hrm_settings',
// Essentials — Memos (Phase 1 of Essentials enterprise upgrade).
  'essentials_memos',

  // Essentials — Knowledge Base (Phase 2). Base tables are created by
  // essentialsService.ensureKbSchema(); this just adds industry_id +
  // index, same as every other isolated table.
  'essentials_kb_articles', 'essentials_kb_categories', 'essentials_kb_tags',

 // Essentials — To-Do / Documents / Reminders (Phase 3: closing the
  // industry-isolation gap found in audit). No new tables — these already
  // exist; this just adds industry_id + index like everything else here.
  'essentials_todos', 'essentials_documents', 'essentials_reminders',

  // Reports — Activity Log & Register (Reports industry-isolation audit).
  // Existing rows get industry_id = NULL and are excluded from every
  // industry's filtered report (nothing is deleted; they just won't
  // display in the isolated view until re-tagged).
  'activity_logs', 'register_sessions',
];
const ensureIndustrySchema = async () => {
  if (industrySchemaReady) return;
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS industries (
        id            SERIAL PRIMARY KEY,
        business_id   INTEGER NOT NULL DEFAULT 1,
        name          VARCHAR(150) NOT NULL,
        code          VARCHAR(50) NOT NULL,
        industry_type VARCHAR(50),
        is_active     BOOLEAN DEFAULT true,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(business_id, code)
      );
    `);

    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_industry_id INTEGER;`);

    for (const table of ISOLATED_TABLES) {
      try {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS industry_id INTEGER;`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_${table}_industry_id ON ${table}(industry_id);`);
      } catch (e) {
        console.error(`⚠️ industry_id column warning on ${table}:`, e.message);
      }
    }
    industrySchemaReady = true;
    console.log('✅ Industry schema ready');
  } catch (err) {
    console.error('❌ industry schema migration warning:', err.message);
    industrySchemaReady = true; // don't loop-crash the server
  }
};

// ── CRUD ──────────────────────────────────────────────────────
const listIndustries = async (businessId) => {
  await ensureIndustrySchema();
  const result = await pool.query(
    `SELECT * FROM industries WHERE business_id = $1 AND is_active = true ORDER BY name ASC`,
    [businessId]
  );
  return result.rows;
};

const createIndustry = async (businessId, { name, code, industry_type }) => {
  await ensureIndustrySchema();
  if (!name?.trim()) throw new Error('Industry name is required');
  const finalCode = (code || name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_');

  const result = await pool.query(
    `INSERT INTO industries (business_id, name, code, industry_type)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [businessId, name.trim(), finalCode, industry_type || null]
  );
  return result.rows[0];
};

const updateIndustry = async (businessId, id, { name, industry_type }) => {
  await ensureIndustrySchema();
  const result = await pool.query(
    `UPDATE industries
     SET name = COALESCE($1, name), industry_type = COALESCE($2, industry_type), updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 AND business_id = $4
     RETURNING *`,
    [name?.trim() || null, industry_type || null, id, businessId]
  );
  if (result.rows.length === 0) throw new Error('Industry not found');
  return result.rows[0];
};

const deleteIndustry = async (businessId, id) => {
  await ensureIndustrySchema();
  const result = await pool.query(
    `UPDATE industries SET is_active = false, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 RETURNING *`,
    [id, businessId]
  );
  if (result.rows.length === 0) throw new Error('Industry not found');
  return result.rows[0];
};

const setActiveIndustry = async (userId, businessId, industryId) => {
  await ensureIndustrySchema();
  const check = await pool.query(
    `SELECT * FROM industries WHERE id = $1 AND business_id = $2 AND is_active = true`,
    [industryId, businessId]
  );
  if (check.rows.length === 0) throw new Error('Invalid industry');
  await pool.query(`UPDATE users SET last_active_industry_id = $1 WHERE id = $2`, [industryId, userId]);
  return check.rows[0];
};

// NEW
const getIndustryById = async (businessId, id) => {
  await ensureIndustrySchema();
  const result = await pool.query(
    `SELECT * FROM industries WHERE id = $1 AND business_id = $2`,
    [id, businessId]
  );
  return result.rows[0] || null;
};

module.exports = {
  ensureIndustrySchema,
  listIndustries,
  createIndustry,
  updateIndustry,
  deleteIndustry,
  setActiveIndustry,
  getIndustryById, // NEW
  ISOLATED_TABLES,
};