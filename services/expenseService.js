/**
 * services/expenseService.js
 */
'use strict';

const pool = require('../config/database');
const bankIntegrationService = require('./bankIntegrationService');
const { logAudit } = require('./auditLogService');

// ── Reference number ─────────────────────────────────────────────────────
const generateReferenceNo = async (industryId, client = pool) => {
  const year = new Date().getFullYear();
  const result = await client.query(
    `SELECT expense_number FROM expenses WHERE expense_number LIKE $1 AND industry_id = $2 ORDER BY id DESC LIMIT 1`,
    [`EP-${year}-%`, industryId]
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].expense_number.split('-').pop(), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `EP-${year}-${String(next).padStart(3, '0')}`;
};

// ── Integer/numeric fields — empty string must become null ────────────────
const INT_FIELDS = new Set([
  'category_id','sub_category_id','contact_id',
  'tax_amount','total_amount','amount_paid','payment_due','net_expense',
  'refund_amount','recurring_interval','recurring_repetitions',
]);
const cleanVal = (f, v) => {
  if (v === '' || v === undefined) return INT_FIELDS.has(f) ? null : v;
  return v;
};

// ── FETCH ALL (with filters + pagination) ────────────────────────────────
const fetchAllExpenses = async (industryId, filters = {}) => {
  const { page = 1, limit = 25, search = '', category_id = '', payment_status = '', date_from = '', date_to = '' } = filters;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [industryId];
  const where = ['e.industry_id = $1'];

  if (search) { params.push(`%${search}%`); where.push(`(e.expense_number ILIKE $${params.length} OR e.description ILIKE $${params.length})`); }
  if (category_id) { params.push(category_id); where.push(`e.category_id = $${params.length}`); }
  if (payment_status) { params.push(payment_status); where.push(`e.payment_status = $${params.length}`); }
  if (date_from) { params.push(date_from); where.push(`e.expense_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); where.push(`e.expense_date <= $${params.length}`); }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const countResult = await pool.query(`SELECT COUNT(*) FROM expenses e ${whereSql}`, params);
  params.push(limit, offset);
  const rowsResult = await pool.query(
    `SELECT e.*, c.name AS category_name, s.name AS sub_category_name
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_categories s ON s.id = e.sub_category_id
     ${whereSql} ORDER BY e.id DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { rows: rowsResult.rows, total: parseInt(countResult.rows[0].count) };
};

const fetchExpenseById = async (id, industryId) => {
  const result = await pool.query(
    `SELECT e.*, c.name AS category_name, s.name AS sub_category_name
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_categories s ON s.id = e.sub_category_id
     WHERE e.id = $1 AND e.industry_id = $2`, [id, industryId]
  );
  return result.rows[0] || null;
};

const createExpense = async (industryId, data, userId, userName) => {
  const {
    location, category_id, sub_category_id, expense_number,
    expense_date, expense_for, tax_amount = 0,
    amount, total_amount, description, is_refund = false,
    refund_amount, refund_date, refund_reason, refund_method,
    is_recurring = false, recurring_interval, recurring_interval_unit,
    recurring_repetitions, attachment_url, payment_status = 'due',
    amount_paid = 0, payment_method = 'Cash', payment_due,
  } = data;

if (!amount && !total_amount) throw new Error('Total amount is required');
  const finalTotal = parseFloat(total_amount || amount);

  let cleanRefundAmount = null, cleanRefundDate = null;
  if (is_refund) {
    const amt = parseFloat(refund_amount);
    if (refund_amount === undefined || refund_amount === null || refund_amount === '' || isNaN(amt))
      throw new Error('Refund amount is required when "Is refund?" is checked');
    if (amt <= 0) throw new Error('Refund amount must be greater than 0');
    if (amt > finalTotal) throw new Error('Refund amount cannot exceed original expense amount');
    cleanRefundAmount = amt;
    cleanRefundDate = refund_date || new Date().toISOString().slice(0, 10);
  }

  const refNo = expense_number && expense_number.trim()
    ? expense_number.trim() : await generateReferenceNo(industryId);

  // payment_due is ALWAYS derived server-side from net_expense (total minus
  // any refund) — never trust a client-sent payment_due, or a refunded
  // expense's form (which computes payment_due off the raw total, unaware
  // of the refund) turns a fully-refunded ₹10,000 expense into a fresh
  // ₹10,000 unpaid bill in Accounts Payable.
 const netExpense = finalTotal - (cleanRefundAmount || 0);
  const paidNowForDue = parseFloat(amount_paid) || 0;
  const finalPaymentDue = payment_status === 'paid'
    ? 0
    : Math.max(0, netExpense - paidNowForDue);

  const result = await pool.query(
    `INSERT INTO expenses
       (expense_number, expense_date, location, category_id, sub_category_id, category,
        amount, description, payment_status, tax_amount, total_amount, payment_due,
        amount_paid, payment_method, expense_for,
        is_refund, refund_amount, refund_date, refund_reason, refund_method,
        is_recurring, recurring_interval, recurring_interval_unit, recurring_repetitions,
        attachment_url, net_expense, added_by, industry_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,NOW(),NOW())
     RETURNING *`,
    [
      refNo, expense_date || new Date(), location, category_id || null, sub_category_id || null,
      data.category_name || null, finalTotal, description || null, payment_status,
      parseFloat(tax_amount) || 0, finalTotal, finalPaymentDue,
      parseFloat(amount_paid) || 0, payment_method,
      expense_for || null,
      is_refund, cleanRefundAmount, cleanRefundDate, refund_reason || null, refund_method || null,
      is_recurring, recurring_interval || null, recurring_interval_unit || 'Days', recurring_repetitions || null,
   attachment_url || null, netExpense, userId, industryId,
    ]
  );
const expense = result.rows[0];

  logAudit({
    userId, userName,
    module: 'Expenses',
    action: 'CREATE',
    recordId: expense.id,
    recordLabel: expense.expense_number,
    oldData: null,
    newData: expense,
  }).catch(() => {});

  // Auto-mirror this expense payment into Cash & Bank.
  const paidNow = parseFloat(amount_paid) || 0;
  if (paidNow > 0) {
    bankIntegrationService.safeRecord({
      sourceModule: 'Expense',
      sourceId: expense.id,
      sourceEvent: 'payment',
      txnType: 'Debit',
      amount: paidNow,
      paymentMethod: payment_method,
      description: `Expense payment — ${expense.expense_number}`,
      txnDate: expense_date || new Date(),
      userId,
    }).catch(() => {});
  }

  // Auto-mirror a refund entered at creation time into Cash & Bank — a real
  // cash inflow (Credit), same as how a refund added later via updateExpense
  // is mirrored.
  if (cleanRefundAmount > 0) {
    bankIntegrationService.safeRecord({
      sourceModule: 'Expense',
      sourceId: expense.id,
      sourceEvent: `refund-${cleanRefundAmount}`,
      txnType: 'Credit',
      amount: cleanRefundAmount,
      paymentMethod: refund_method || 'Cash',
      description: `Expense refund received — ${expense.expense_number}`,
      txnDate: cleanRefundDate || new Date(),
      userId,
    }).catch(() => {});
  }

  return expense;
};

const updateExpense = async (industryId, id, data, userId, userName) => { 
  const existing = await fetchExpenseById(id, industryId);
  if (!existing) throw new Error('Expense not found');
  const oldData = existing;

  const fields = [
    'location','category_id','sub_category_id','expense_date','expense_for',
    'tax_amount','total_amount','description','payment_status','is_refund',
    'refund_amount','refund_date','refund_reason','refund_method',
    'is_recurring','recurring_interval','recurring_interval_unit','recurring_repetitions',
    'attachment_url','amount_paid','payment_method',
  ];
  const sets = [];
  const params = [];

  fields.forEach((f) => {
    if (data[f] !== undefined) {
      params.push(cleanVal(f, data[f]));
      sets.push(`${f} = $${params.length}`);
    }
  });

  // Legacy text category column
  if (data.category_name !== undefined) {
    params.push(data.category_name);
    sets.push(`category = $${params.length}`);
  }
// net_expense — a refund reduces what this expense actually cost.
  const totalForNet = parseFloat(data.total_amount || existing.total_amount) || 0;
  const isRefundNow = data.is_refund !== undefined ? data.is_refund : existing.is_refund;
  const refundForNet = isRefundNow ? parseFloat(data.refund_amount ?? existing.refund_amount ?? 0) : 0;
  const netExpense = totalForNet - refundForNet;
  params.push(netExpense);
  sets.push(`net_expense = $${params.length}`);

  // payment_due — always derived server-side from net_expense (not the raw
  // total_amount), so a refunded expense's "amount owed" reflects the refund
  // instead of showing up as a fresh unpaid bill in Accounts Payable.
  const statusForDue = data.payment_status !== undefined ? data.payment_status : existing.payment_status;
  const paidForDue = data.amount_paid !== undefined ? parseFloat(data.amount_paid) || 0 : parseFloat(existing.amount_paid) || 0;
  const pDue = statusForDue === 'paid' ? 0 : Math.max(0, netExpense - paidForDue);
  params.push(pDue);
  sets.push(`payment_due = $${params.length}`); 

  sets.push('updated_at = NOW()');
  params.push(id, industryId);

 const result = await pool.query(
    `UPDATE expenses SET ${sets.join(', ')} WHERE id = $${params.length - 1} AND industry_id = $${params.length} RETURNING *`,
    params
  );
 const updated = result.rows[0];

  logAudit({
    userId, userName,
    module: 'Expenses',
    action: 'UPDATE',
    recordId: id,
    recordLabel: updated.expense_number,
    oldData,
    newData: updated,
  }).catch(() => {});

// Auto-mirror an increased payment amount into Cash & Bank. Only fires
  // when amount_paid went up from what it was before this edit.
  if (data.amount_paid !== undefined) {
    const before = parseFloat(existing.amount_paid) || 0;
    const after = parseFloat(data.amount_paid) || 0;
    const delta = after - before;
    if (delta > 0) {
      bankIntegrationService.safeRecord({
        sourceModule: 'Expense',
        sourceId: id,
        sourceEvent: `payment-update-${after}`,
        txnType: 'Debit',
        amount: delta,
        paymentMethod: data.payment_method || existing.payment_method,
        description: `Expense payment update — ${updated.expense_number}`,
        txnDate: new Date(),
      }).catch(() => {});
    }
  }

  // Auto-mirror a NEW refund into Cash & Bank — money coming back from the
  // vendor is a real cash inflow (Credit). Only fires the first time this
  // refund_amount is set (existing had none/lower), so re-saving the same
  // expense doesn't double-record the credit.
  if (data.is_refund) {
    const refundBefore = existing.is_refund ? parseFloat(existing.refund_amount) || 0 : 0;
    const refundAfter = parseFloat(data.refund_amount) || 0;
    const refundDelta = refundAfter - refundBefore;
    if (refundDelta > 0) {
      bankIntegrationService.safeRecord({
        sourceModule: 'Expense',
        sourceId: id,
        sourceEvent: `refund-${refundAfter}`,
        txnType: 'Credit',
        amount: refundDelta,
        paymentMethod: data.refund_method || existing.refund_method || 'Cash',
        description: `Expense refund received — ${updated.expense_number}`,
        txnDate: data.refund_date || existing.refund_date || new Date(),
      }).catch(() => {});
    }
  }

  return updated;
};

const deleteExpense = async (industryId, id, userId, userName) => {
  const existing = await pool.query(`SELECT * FROM expenses WHERE id = $1 AND industry_id = $2`, [id, industryId]);
  if (existing.rows.length === 0) throw new Error('Expense not found');
  const oldData = existing.rows[0];

  const result = await pool.query(`DELETE FROM expenses WHERE id = $1 AND industry_id = $2 RETURNING id`, [id, industryId]);

  logAudit({
    userId, userName,
    module: 'Expenses',
    action: 'DELETE',
    recordId: id,
    recordLabel: oldData.expense_number,
    oldData,
    newData: null,
  }).catch(() => {});

  return result.rows[0];
};

// ── CATEGORIES ───────────────────────────────────────────────────────────

const generateCategoryCode = async (industryId) => {
  const result = await pool.query(
    `SELECT code FROM expense_categories WHERE code LIKE 'EXP-%' AND industry_id = $1 ORDER BY id DESC LIMIT 1`,
    [industryId]
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].code.split('-').pop(), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `EXP-${String(next).padStart(3, '0')}`;
};

const fetchAllCategories = async (industryId) => {
  const result = await pool.query(
    `SELECT c.*, p.name AS parent_name FROM expense_categories c
     LEFT JOIN expense_categories p ON p.id = c.parent_id
     WHERE c.industry_id = $1 ORDER BY c.name`,
    [industryId]
  );
  return result.rows;
};

const createCategory = async (industryId, { name, parent_id }) => {
  const code = await generateCategoryCode(industryId);
  const result = await pool.query(
    `INSERT INTO expense_categories (name, code, parent_id, industry_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,NOW(),NOW()) RETURNING *`,
    [name, code, parent_id || null, industryId]
  );
  return result.rows[0];
};

const updateCategory = async (industryId, id, { name, parent_id }) => {
  const result = await pool.query(
    `UPDATE expense_categories SET name=$1, parent_id=$2, updated_at=NOW() WHERE id=$3 AND industry_id=$4 RETURNING *`,
    [name, parent_id || null, id, industryId]
  );
  if (result.rows.length === 0) throw new Error('Category not found');
  return result.rows[0];
};

const deleteCategory = async (industryId, id) => {
  const result = await pool.query(`DELETE FROM expense_categories WHERE id=$1 AND industry_id=$2 RETURNING id`, [id, industryId]);
  if (result.rows.length === 0) throw new Error('Category not found');
  return result.rows[0];
};

const getTotals = async (industryId, filters = {}) => {
  const { rows } = await fetchAllExpenses(industryId, { ...filters, limit: 100000, page: 1 });
  const total = rows.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  const due   = rows.reduce((s, r) => s + parseFloat(r.payment_due || 0), 0);
  return { total, due };
};

module.exports = {
  generateReferenceNo, fetchAllExpenses, fetchExpenseById,
  createExpense, updateExpense, deleteExpense,
  fetchAllCategories, createCategory, updateCategory, deleteCategory, getTotals,
};  