/**
 * services/expenseService.js
 */
'use strict';

const pool = require('../config/database');

// ── Reference number ─────────────────────────────────────────────────────
const generateReferenceNo = async (client = pool) => {
  const year = new Date().getFullYear();
  const result = await client.query(
    `SELECT expense_number FROM expenses WHERE expense_number LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`EP-${year}-%`]
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
const fetchAllExpenses = async (filters = {}) => {
  const { page = 1, limit = 25, search = '', category_id = '', payment_status = '', date_from = '', date_to = '' } = filters;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const params = [];
  const where = [];

  if (search) { params.push(`%${search}%`); where.push(`(e.expense_number ILIKE $${params.length} OR e.description ILIKE $${params.length})`); }
  if (category_id) { params.push(category_id); where.push(`e.category_id = $${params.length}`); }
  if (payment_status) { params.push(payment_status); where.push(`e.payment_status = $${params.length}`); }
  if (date_from) { params.push(date_from); where.push(`e.expense_date >= $${params.length}`); }
  if (date_to) { params.push(date_to); where.push(`e.expense_date <= $${params.length}`); }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
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

const fetchExpenseById = async (id) => {
  const result = await pool.query(
    `SELECT e.*, c.name AS category_name, s.name AS sub_category_name
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_categories s ON s.id = e.sub_category_id
     WHERE e.id = $1`, [id]
  );
  return result.rows[0] || null;
};

const createExpense = async (data, userId) => {
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
    ? expense_number.trim() : await generateReferenceNo();

  const finalPaymentDue = payment_due !== undefined
    ? parseFloat(payment_due)
    : (payment_status === 'paid' ? 0 : finalTotal);

  const netExpense = finalTotal - (cleanRefundAmount || 0);

  const result = await pool.query(
    `INSERT INTO expenses
       (expense_number, expense_date, location, category_id, sub_category_id, category,
        amount, description, payment_status, tax_amount, total_amount, payment_due,
        amount_paid, payment_method, expense_for,
        is_refund, refund_amount, refund_date, refund_reason, refund_method,
        is_recurring, recurring_interval, recurring_interval_unit, recurring_repetitions,
        attachment_url, net_expense, added_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW(),NOW())
     RETURNING *`,
    [
      refNo, expense_date || new Date(), location, category_id || null, sub_category_id || null,
      data.category_name || null, finalTotal, description || null, payment_status,
      parseFloat(tax_amount) || 0, finalTotal, finalPaymentDue,
      parseFloat(amount_paid) || 0, payment_method,
      expense_for || null,
      is_refund, cleanRefundAmount, cleanRefundDate, refund_reason || null, refund_method || null,
      is_recurring, recurring_interval || null, recurring_interval_unit || 'Days', recurring_repetitions || null,
      attachment_url || null, netExpense, userId,
    ]
  );
  return result.rows[0];
};

const updateExpense = async (id, data, userId) => {
  const existing = await fetchExpenseById(id);
  if (!existing) throw new Error('Expense not found');

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

  // payment_due — use client-sent value if present, else derive
  if (data.payment_due !== undefined) {
    params.push(cleanVal('payment_due', data.payment_due));
    sets.push(`payment_due = $${params.length}`);
  } else if (data.total_amount !== undefined && data.payment_status !== undefined) {
    const totalVal = parseFloat(data.total_amount) || 0;
    const pDue = data.payment_status === 'paid' ? 0
      : data.payment_status === 'partial' ? Math.max(0, totalVal - (parseFloat(data.amount_paid) || 0))
      : totalVal;
    params.push(pDue);
    sets.push(`payment_due = $${params.length}`);
  }

  // net_expense
  const totalForNet = parseFloat(data.total_amount || existing.total_amount) || 0;
  const refundForNet = data.is_refund ? parseFloat(data.refund_amount || 0) : 0;
  params.push(totalForNet - refundForNet);
  sets.push(`net_expense = $${params.length}`);

  sets.push('updated_at = NOW()');
  params.push(id);

  const result = await pool.query(
    `UPDATE expenses SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
    params
  );
  return result.rows[0];
};

const deleteExpense = async (id) => {
  const result = await pool.query(`DELETE FROM expenses WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Expense not found');
  return result.rows[0];
};

// ── CATEGORIES ───────────────────────────────────────────────────────────

const generateCategoryCode = async () => {
  const result = await pool.query(
    `SELECT code FROM expense_categories WHERE code LIKE 'EXP-%' ORDER BY id DESC LIMIT 1`
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].code.split('-').pop(), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `EXP-${String(next).padStart(3, '0')}`;
};

const fetchAllCategories = async () => {
  const result = await pool.query(
    `SELECT c.*, p.name AS parent_name FROM expense_categories c
     LEFT JOIN expense_categories p ON p.id = c.parent_id ORDER BY c.name`
  );
  return result.rows;
};

const createCategory = async ({ name, parent_id }) => {
  const code = await generateCategoryCode();
  const result = await pool.query(
    `INSERT INTO expense_categories (name, code, parent_id, created_at, updated_at)
     VALUES ($1,$2,$3,NOW(),NOW()) RETURNING *`,
    [name, code, parent_id || null]
  );
  return result.rows[0];
};

const updateCategory = async (id, { name, parent_id }) => {
  const result = await pool.query(
    `UPDATE expense_categories SET name=$1, parent_id=$2, updated_at=NOW() WHERE id=$3 RETURNING *`,
    [name, parent_id || null, id]
  );
  if (result.rows.length === 0) throw new Error('Category not found');
  return result.rows[0];
};

const deleteCategory = async (id) => {
  const result = await pool.query(`DELETE FROM expense_categories WHERE id=$1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Category not found');
  return result.rows[0];
};

const getTotals = async (filters = {}) => {
  const { rows } = await fetchAllExpenses({ ...filters, limit: 100000, page: 1 });
  const total = rows.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  const due   = rows.reduce((s, r) => s + parseFloat(r.payment_due || 0), 0);
  return { total, due };
};

module.exports = {
  generateReferenceNo, fetchAllExpenses, fetchExpenseById,
  createExpense, updateExpense, deleteExpense,
  fetchAllCategories, createCategory, updateCategory, deleteCategory, getTotals,
};