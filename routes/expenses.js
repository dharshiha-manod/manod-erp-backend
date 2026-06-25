/**
 * ====================================================
 * routes/expenses.js
 * Mount point: /api/expenses  (register in server.js)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken        = require('../middleware/auth');
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
  authenticateToken, requireAnyPermission(VIEW_EXP), ctrl.getAllCategories);

router.post('/categories',
  authenticateToken, requireAnyPermission(ADD_EXP), ctrl.createCategory);

router.put('/categories/:id',
  authenticateToken, requireAnyPermission(EDIT_EXP), ctrl.updateCategory);

router.delete('/categories/:id',
  authenticateToken, requireAnyPermission(DELETE_EXP), ctrl.deleteCategory);

// ── CRUD ─────────────────────────────────────────────────────────────────────
// GET /api/expenses?page=&limit=&search=&category_id=&payment_status=&date_from=&date_to=
router.get('/',
  authenticateToken, requireAnyPermission(VIEW_EXP), ctrl.getAllExpenses);

router.get('/:id',
  authenticateToken, requireAnyPermission(VIEW_EXP), ctrl.getExpenseById);

router.post('/',
  authenticateToken, requireAnyPermission(ADD_EXP), ctrl.createExpense);

router.put('/:id',
  authenticateToken, requireAnyPermission(EDIT_EXP), ctrl.updateExpense);

router.delete('/:id',
  authenticateToken, requireAnyPermission(DELETE_EXP), ctrl.deleteExpense);

module.exports = router;
