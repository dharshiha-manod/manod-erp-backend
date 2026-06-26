/**
 * services/expenseService.js
 * Mirrors the style of services/stockAdjustmentService.js
 */

'use strict';

const pool = require('../config/database');

// ── Reference number ───────────────────────────────────────────────────────
const generateReferenceNo = async (client = pool) => {
  const year = new Date().getFullYear();
  const result = await client.query(
    `SELECT expense_number FROM expenses
     WHERE  expense_number LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`EP-${year}-%`]
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].expense_number.split('-').pop(), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `EP-${year}-${String(next).padStart(3, '0')}`;
};

// ── FETCH ALL (with filters + pagination) ───────────────────────────────────
const fetchAllExpenses = async (filters = {}) => {
  const {
    page = 1, limit = 25, search = '',
    category_id = '', payment_status = '',
    date_from = '', date_to = '',
  } = filters;

  const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
  const params = [];
  const where = [];

  if (search) {
    params.push(`%${search}%`);
    where.push(`(e.expense_number ILIKE $${params.length} OR e.description ILIKE $${params.length})`);
  }
  if (category_id) {
    params.push(category_id);
    where.push(`e.category_id = $${params.length}`);
  }
  if (payment_status) {
    params.push(payment_status);
    where.push(`e.payment_status = $${params.length}`);
  }
  if (date_from) {
    params.push(date_from);
    where.push(`e.expense_date >= $${params.length}`);
  }
  if (date_to) {
    params.push(date_to);
    where.push(`e.expense_date <= $${params.length}`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM expenses e ${whereSql}`, params
  );

  params.push(limit, offset);
  const rowsResult = await pool.query(
    `SELECT e.*,
            c.name  AS category_name,
            s.name  AS sub_category_name
     FROM   expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_categories s ON s.id = e.sub_category_id
     ${whereSql}
     ORDER BY e.id DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows: rowsResult.rows, total: parseInt(countResult.rows[0].count, 10) };
};

const fetchExpenseById = async (id) => {
  const result = await pool.query(
    `SELECT e.*, c.name AS category_name, s.name AS sub_category_name
     FROM   expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     LEFT JOIN expense_categories s ON s.id = e.sub_category_id
     WHERE  e.id = $1`,
    [id]
  );
  return result.rows[0] || null;
};

const createExpense = async (data, userId) => {
  const {
    location, category_id, sub_category_id, expense_number,
    expense_date, expense_for, contact_id, tax_amount = 0,
    amount, total_amount, description, is_refund = false,
    is_recurring = false, recurring_interval, recurring_interval_unit,
    recurring_repetitions, attachment_url, payment_status = 'due',
  } = data;

  if (!amount && !total_amount) {
    throw new Error('Total amount is required');
  }

  const refNo = expense_number && expense_number.trim()
    ? expense_number.trim()
    : await generateReferenceNo();

  const finalTotal = total_amount || amount;
  const paymentDue = payment_status === 'paid' ? 0 : finalTotal;

  const result = await pool.query(
    `INSERT INTO expenses
       (expense_number, expense_date, location, category_id, sub_category_id,
        category, amount, description, payment_status, tax_amount, total_amount,
        payment_due, expense_for, contact_id, is_refund, is_recurring,
        recurring_interval, recurring_interval_unit, recurring_repetitions,
        attachment_url, added_by, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW(),NOW())
     RETURNING *`,
    [
      refNo, expense_date || new Date(), location, category_id || null, sub_category_id || null,
      data.category_name || null, finalTotal, description || null, payment_status, tax_amount,
      finalTotal, paymentDue, expense_for || null, contact_id || null, is_refund, is_recurring,
      recurring_interval || null, recurring_interval_unit || 'Days', recurring_repetitions || null,
      attachment_url || null, userId,
    ]
  );
  return result.rows[0];
};

const updateExpense = async (id, data, userId) => {
  const existing = await fetchExpenseById(id);
  if (!existing) throw new Error('Expense not found');

  // Columns that are integer/numeric in Postgres — an empty string ("")
  // from the form must become NULL, never be written as-is, or Postgres
  // throws "invalid input syntax for type integer: ''".
  const INT_OR_NUMERIC_FIELDS = new Set([
    'category_id', 'sub_category_id', 'contact_id',
    'tax_amount', 'total_amount',
    'recurring_interval', 'recurring_repetitions',
  ]);
  const clean = (f, v) => {
    if (v === '' || v === undefined) return INT_OR_NUMERIC_FIELDS.has(f) ? null : v;
    return v;
  };

  const fields = [
    'location', 'category_id', 'sub_category_id', 'expense_date', 'expense_for',
    'contact_id', 'tax_amount', 'total_amount', 'description', 'payment_status',
    'is_refund', 'is_recurring', 'recurring_interval', 'recurring_interval_unit',
    'recurring_repetitions', 'attachment_url',
  ];
  const sets = [];
  const params = [];
  fields.forEach((f) => {
    if (data[f] !== undefined) {
      params.push(clean(f, data[f]));
      sets.push(`${f} = $${params.length}`);
    }
  });
  if (data.category_name !== undefined) {
    params.push(data.category_name);
    sets.push(`category = $${params.length}`);
  }
  if (data.total_amount !== undefined && data.payment_status !== undefined) {
    const totalVal = clean('total_amount', data.total_amount) ?? 0;
    params.push(data.payment_status === 'paid' ? 0 : totalVal);
    sets.push(`payment_due = $${params.length}`);
  }
  params.push(id);
  sets.push('updated_at = NOW()');

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

// ── Category code (auto-increment EXP-001, EXP-002, ...) ───────────────────
const generateCategoryCode = async () => {
  const result = await pool.query(
    `SELECT code FROM expense_categories
     WHERE  code LIKE 'EXP-%' ORDER BY id DESC LIMIT 1`
  );
  let next = 1;
  if (result.rows.length > 0) {
    const lastNum = parseInt(result.rows[0].code.split('-').pop(), 10);
    if (!isNaN(lastNum)) next = lastNum + 1;
  }
  return `EXP-${String(next).padStart(3, '0')}`;
};

// ── CATEGORIES ───────────────────────────────────────────────────────────────
const fetchAllCategories = async () => {
  const result = await pool.query(
    `SELECT c.*, p.name AS parent_name
     FROM   expense_categories c
     LEFT JOIN expense_categories p ON p.id = c.parent_id
     ORDER BY c.name`
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
    `UPDATE expense_categories
     SET name = $1, parent_id = $2, updated_at = NOW()
     WHERE id = $3 RETURNING *`,
    [name, parent_id || null, id]
  );
  if (result.rows.length === 0) throw new Error('Category not found');
  return result.rows[0];
};

const deleteCategory = async (id) => {
  const result = await pool.query(`DELETE FROM expense_categories WHERE id = $1 RETURNING id`, [id]);
  if (result.rows.length === 0) throw new Error('Category not found');
  return result.rows[0];
};

// ── Totals for footer row ────────────────────────────────────────────────────
const getTotals = async (filters = {}) => {
  const { rows } = await fetchAllExpenses({ ...filters, limit: 100000, page: 1 });
  const total = rows.reduce((s, r) => s + parseFloat(r.total_amount || 0), 0);
  const due   = rows.reduce((s, r) => s + parseFloat(r.payment_due || 0), 0);
  return { total, due };
};

module.exports = {
  generateReferenceNo,
  fetchAllExpenses,
  fetchExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  fetchAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getTotals,
};