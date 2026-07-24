/**
 * ============================================================
 * services/bankIntegrationService.js
 * NEW FILE — does not modify any existing service.
 *
 * Purpose: whenever Sales / Purchases / Expenses / Payroll /
 * Fixed Assets record a payment or receipt, this helper mirrors
 * it into accounting_bank_transactions so the Cash & Bank tab,
 * bank balances, and General Ledger derived view reflect it
 * automatically — WITHOUT touching the source module's own
 * tables, transactions, or return values.
 * ============================================================
 */

'use strict';

const pool = require('../config/database');

const CASH_METHODS = new Set(['cash', 'petty cash']);

let cashAccountId = null;
let bankAccountId = null;

const ensureDefaultAccounts = async () => {
  if (cashAccountId && bankAccountId) return { cashAccountId, bankAccountId };

  let { rows: cashRows } = await pool.query(
    `SELECT id FROM accounting_bank_accounts WHERE account_type = 'Cash' ORDER BY id LIMIT 1`
  );
  if (!cashRows.length) {
    const ins = await pool.query(
      `INSERT INTO accounting_bank_accounts (name, account_type, opening_balance)
       VALUES ('Cash in Hand', 'Cash', 0) RETURNING id`
    );
    cashRows = ins.rows;
  }
  cashAccountId = cashRows[0].id;

  let { rows: bankRows } = await pool.query(
    `SELECT id FROM accounting_bank_accounts WHERE account_type <> 'Cash' ORDER BY id LIMIT 1`
  );
  if (!bankRows.length) {
    const ins = await pool.query(
      `INSERT INTO accounting_bank_accounts (name, account_type, opening_balance)
       VALUES ('Default Bank Account', 'Current', 0) RETURNING id`
    );
    bankRows = ins.rows;
  }
  bankAccountId = bankRows[0].id;

  return { cashAccountId, bankAccountId };
};

const resolveAccountId = async (paymentMethod) => {
  const { cashAccountId: c, bankAccountId: b } = await ensureDefaultAccounts();
  const m = (paymentMethod || '').toString().trim().toLowerCase();
  return CASH_METHODS.has(m) ? c : b;
};

let schemaReady = false;
const ensureBankIntegrationSchema = async () => {
  if (schemaReady) return;
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS source_module VARCHAR(30)`);
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS source_id INTEGER`);
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS source_event VARCHAR(40)`);
  await pool.query(`ALTER TABLE accounting_bank_transactions ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN DEFAULT FALSE`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS ux_bank_txn_source
    ON accounting_bank_transactions (source_module, source_id, source_event)
    WHERE source_module IS NOT NULL
  `);
  schemaReady = true;
};

const recordAutoTransaction = async ({
  sourceModule,
  sourceId,
  sourceEvent,
  txnType,
  amount,
  paymentMethod,
  description,
  txnDate,
  userId,
}) => {
  if (!amount || Number(amount) <= 0) return null;

  await ensureBankIntegrationSchema();
  const bankAccountId = await resolveAccountId(paymentMethod);

  const exists = await pool.query(
    `SELECT id FROM accounting_bank_transactions
     WHERE source_module = $1 AND source_id = $2 AND source_event = $3`,
    [sourceModule, sourceId, sourceEvent]
  );
  if (exists.rows.length) return exists.rows[0];

  const ins = await pool.query(
    `INSERT INTO accounting_bank_transactions
       (bank_account_id, txn_date, description, txn_type, amount, created_by,
        source_module, source_id, source_event, auto_generated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE) RETURNING *`,
    [bankAccountId, txnDate || new Date(), description || null, txnType, amount, userId || null,
     sourceModule, sourceId, sourceEvent]
  );
  return ins.rows[0];
};

const safeRecord = async (params) => {
  try {
    return await recordAutoTransaction(params);
  } catch (err) {
    console.error(`⚠️ [bankIntegrationService] Failed to auto-record ${params.sourceModule} ${params.sourceEvent} (id ${params.sourceId}):`, err.message);
    return null;
  }
};

module.exports = { safeRecord, ensureDefaultAccounts, resolveAccountId };