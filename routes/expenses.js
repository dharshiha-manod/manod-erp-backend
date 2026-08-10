/**
 * ====================================================
 * routes/expenses.js
 * Mount point: /api/expenses  (register in server.js)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken        = require('../middleware/auth');
const requireIndustry          = require('../middleware/industry');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl                     = require('../controllers/expenseController');

const VIEW_EXP   = [
  ['Expense', 'Access all expenses'],
  ['Expense', 'View own expense only'],
];
const ADD_EXP    = [['Expense', 'Access all expenses'], ['Expense', 'Add expense']];
const EDIT_EXP   = [['Expense', 'Access all expenses'], ['Expense', 'Edit expense']];
const DELETE_EXP = [['Expense', 'Access all expenses'], ['Expense', 'Delete expense']];

// ── Categories (must come before /:id) ──────────────────────────────────────
router.get('/categories',
  authenticateToken, requireIndustry, requireAnyPermission(VIEW_EXP), ctrl.getAllCategories);

router.post('/categories',
  authenticateToken, requireIndustry, requireAnyPermission(ADD_EXP), ctrl.createCategory);

router.put('/categories/:id',
  authenticateToken, requireIndustry, requireAnyPermission(EDIT_EXP), ctrl.updateCategory);

router.delete('/categories/:id',
  authenticateToken, requireIndustry, requireAnyPermission(DELETE_EXP), ctrl.deleteCategory);

// ── CRUD ─────────────────────────────────────────────────────────────────────
// GET /api/expenses?page=&limit=&search=&category_id=&payment_status=&date_from=&date_to=
router.get('/',
  authenticateToken, requireIndustry, requireAnyPermission(VIEW_EXP), ctrl.getAllExpenses);

router.get('/:id',
  authenticateToken, requireIndustry, requireAnyPermission(VIEW_EXP), ctrl.getExpenseById);

router.post('/',
  authenticateToken, requireIndustry, requireAnyPermission(ADD_EXP), ctrl.createExpense);

router.put('/:id',
  authenticateToken, requireIndustry, requireAnyPermission(EDIT_EXP), ctrl.updateExpense);

router.delete('/:id',
  authenticateToken, requireIndustry, requireAnyPermission(DELETE_EXP), ctrl.deleteExpense);

module.exports = router;
