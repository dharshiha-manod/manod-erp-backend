/**
 * ====================================================
 * scripts/backfill-accounting-industry-ids.js
 *
 * One-time backfill: assigns industry_id to pre-existing
 * Accounting & Finance records (accounting_accounts,
 * accounting_bank_accounts, accounting_bank_transactions,
 * accounting_journal_entries, accounting_journal_lines,
 * accounting_fixed_assets, accounting_depreciation_log,
 * accounting_cost_centers, accounting_budgets).
 *
 * Only touches rows where industry_id IS NULL. Never rewrites
 * a row that already has an industry_id set. Same pattern as
 * backfill-expenses-industry-ids.js.
 *
 * accounting_journal_lines and accounting_depreciation_log are
 * child tables (entry_id / asset_id) but still carry their own
 * industry_id column (see ISOLATED_TABLES in industryService.js) —
 * backfilled to the same industry as their parent row so a single
 * WHERE industry_id = $1 filter works directly on the child table
 * too, with no extra join required at query time.
 *
 * Usage: node scripts/backfill-accounting-industry-ids.js
 * ====================================================
 */
const pool = require('../config/database');
const { ensureIndustrySchema } = require('../services/industryService');

// Parent tables: just stamp industry_id directly.
// accounting_accounts is handled separately below (it's a Chart-of-Accounts
// TEMPLATE — 13 system-seeded rows, not per-workspace transactional data —
// so instead of assigning the existing rows to one industry, we clone them
// into every active industry that doesn't have its own copy yet).
const DIRECT_TABLES = [
  'accounting_bank_accounts',
  'accounting_bank_transactions',
  'accounting_journal_entries',
  'accounting_fixed_assets',
  'accounting_cost_centers',
  'accounting_budgets',
];

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
      console.log('No existing industry found — creating a "Default Industry" workspace to hold legacy Accounting data.');
      const created = await pool.query(
        `INSERT INTO industries (business_id, name, code, industry_type, is_active)
         VALUES ($1, $2, $3, $4, true) RETURNING *`,
        [DEFAULT_BUSINESS_ID, 'Default Industry', 'default_industry', 'general_manufacturing']
      );
      fallbackIndustry = created.rows[0];
    }

    console.log(`Backfilling legacy Accounting rows into industry: "${fallbackIndustry.name}" (id=${fallbackIndustry.id})`);

    // Chart of Accounts is a template, not transactional data — clone the
    // existing system-seeded rows into every OTHER active industry first
    // (so every workspace starts with a full 13-row COA), then assign the
    // original 13 rows to the fallback industry like everything else.
    const { rows: allIndustries } = await pool.query(
      `SELECT id FROM industries WHERE business_id = $1 AND is_active = true`,
      [DEFAULT_BUSINESS_ID]
    );
    const { rows: templateAccounts } = await pool.query(
      `SELECT code, name, type, subtype, normal_side, source_key, is_system
       FROM accounting_accounts WHERE industry_id IS NULL`
    );
    for (const ind of allIndustries) {
      if (ind.id === fallbackIndustry.id) continue; // gets the original rows below
      const { rows: already } = await pool.query(
        `SELECT 1 FROM accounting_accounts WHERE industry_id = $1 LIMIT 1`, [ind.id]
      );
      if (already.length) continue; // already has its own COA — don't duplicate
      for (const acc of templateAccounts) {
        await pool.query(
          `INSERT INTO accounting_accounts (code, name, type, subtype, normal_side, source_key, is_system, industry_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [acc.code, acc.name, acc.type, acc.subtype, acc.normal_side, acc.source_key, acc.is_system, ind.id]
        );
      }
      console.log(`  accounting_accounts: cloned ${templateAccounts.length} row(s) into industry id=${ind.id}`);
    }
    const coaResult = await pool.query(
      `UPDATE accounting_accounts SET industry_id = $1 WHERE industry_id IS NULL`,
      [fallbackIndustry.id]
    );
    console.log(`  accounting_accounts: ${coaResult.rowCount} row(s) backfilled (original rows -> fallback industry)`);

    for (const table of DIRECT_TABLES) {
      const result = await pool.query(
        `UPDATE ${table} SET industry_id = $1 WHERE industry_id IS NULL`,
        [fallbackIndustry.id]
      );
      console.log(`  ${table}: ${result.rowCount} row(s) backfilled`);
    }

    // Child tables — inherit industry_id from their parent row so the
    // column is directly queryable without a join.
    const journalLines = await pool.query(
      `UPDATE accounting_journal_lines jl
       SET industry_id = je.industry_id
       FROM accounting_journal_entries je
       WHERE jl.entry_id = je.id AND jl.industry_id IS NULL`
    );
    console.log(`  accounting_journal_lines: ${journalLines.rowCount} row(s) backfilled (from parent entry)`);

    const depreciationLog = await pool.query(
      `UPDATE accounting_depreciation_log dl
       SET industry_id = fa.industry_id
       FROM accounting_fixed_assets fa
       WHERE dl.asset_id = fa.id AND dl.industry_id IS NULL`
    );
    console.log(`  accounting_depreciation_log: ${depreciationLog.rowCount} row(s) backfilled (from parent asset)`);

    console.log('✅ Accounting industry_id backfill complete.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Backfill failed:', err.message);
    process.exit(1);
  }
})();