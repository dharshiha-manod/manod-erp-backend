/**
 * controllers/expenseController.js
 */

'use strict';

const svc = require('../services/expenseService');

const getAllExpenses = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '', category_id = '', payment_status = '', date_from = '', date_to = '' } = req.query;
    const { rows, total } = await svc.fetchAllExpenses({ page, limit, search, category_id, payment_status, date_from, date_to });
    const totals = await svc.getTotals({ search, category_id, payment_status, date_from, date_to });
    res.json({
      success: true,
      total,
      page: +page,
      limit: +limit,
      pages: Math.ceil(total / +limit),
      expenses: rows,
      totals,
    });
  } catch (err) {
    console.error('getAllExpenses:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch expenses' });
  }
};

const getExpenseById = async (req, res) => {
  try {
    const expense = await svc.fetchExpenseById(req.params.id);
    if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });
    res.json({ success: true, expense });
  } catch (err) {
    console.error('getExpenseById:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch expense' });
  }
};

const createExpense = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || null;
    if (!req.body.amount && !req.body.total_amount) {
      return res.status(400).json({ success: false, error: 'Total amount is required' });
    }
    const expense = await svc.createExpense(req.body, userId);
    res.status(201).json({ success: true, message: 'Expense saved successfully', expense });
  } catch (err) {
    console.error('createExpense:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateExpense = async (req, res) => {
  try {
    const userId = req.user?.userId || req.user?.id || null;
    const expense = await svc.updateExpense(req.params.id, req.body, userId);
    res.json({ success: true, message: 'Expense updated successfully', expense });
  } catch (err) {
    console.error('updateExpense:', err.message);
    res.status(err.message === 'Expense not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteExpense = async (req, res) => {
  try {
    const result = await svc.deleteExpense(req.params.id);
    res.json({ success: true, message: 'Expense deleted successfully', deleted: result });
  } catch (err) {
    console.error('deleteExpense:', err.message);
    res.status(err.message === 'Expense not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

// ── Categories ────────────────────────────────────────────────────────────
const getAllCategories = async (req, res) => {
  try {
    const categories = await svc.fetchAllCategories();
    res.json({ success: true, categories });
  } catch (err) {
    console.error('getAllCategories:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
};

const createCategory = async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }
    const category = await svc.createCategory(req.body);
    res.status(201).json({ success: true, message: 'Category created successfully', category });
  } catch (err) {
    console.error('createCategory:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
};

const updateCategory = async (req, res) => {
  try {
    if (!req.body.name || !req.body.name.trim()) {
      return res.status(400).json({ success: false, error: 'Category name is required' });
    }
    const category = await svc.updateCategory(req.params.id, req.body);
    res.json({ success: true, message: 'Category updated successfully', category });
  } catch (err) {
    console.error('updateCategory:', err.message);
    res.status(err.message === 'Category not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteCategory = async (req, res) => {
  try {
    const result = await svc.deleteCategory(req.params.id);
    res.json({ success: true, message: 'Category deleted successfully', deleted: result });
  } catch (err) {
    console.error('deleteCategory:', err.message);
    res.status(err.message === 'Category not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

module.exports = {
  getAllExpenses,
  getExpenseById,
  createExpense,
  updateExpense,
  deleteExpense,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
};