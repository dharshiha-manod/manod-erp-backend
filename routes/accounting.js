/**
 * ====================================================
 * routes/accounting.js
 * Mount point: /api/accounting (register in server.js)
 * Same gating style as routes/reports.js — authenticateToken
 * only for now, since no 'Accounting' permission group exists
 * yet in role_permissions. Swap in requireAnyPermission(['Accounting', ...])
 * once that permission is added, without changing anything else.
 * ====================================================
 */

const express = require('express');
const router = express.Router();

const authenticateToken = require('../middleware/auth');
const ctrl = require('../controllers/accountingController');

// Dashboard
router.get('/dashboard', authenticateToken, ctrl.dashboard);

// Accounts Receivable / Payable
router.get('/receivables', authenticateToken, ctrl.receivables);
router.get('/payables', authenticateToken, ctrl.payables);

// Cash & Bank
router.get('/bank-accounts', authenticateToken, ctrl.listBankAccounts);
router.post('/bank-accounts', authenticateToken, ctrl.createBankAccount);
router.get('/bank-transactions', authenticateToken, ctrl.listBankTransactions);
router.post('/bank-transactions', authenticateToken, ctrl.createBankTransaction);
router.patch('/bank-transactions/:id', authenticateToken, ctrl.updateBankTransaction);
router.delete('/bank-transactions/:id', authenticateToken, ctrl.deleteBankTransaction);
router.patch('/bank-transactions/:id/reconcile', authenticateToken, ctrl.reconcileBankTransaction);
router.get('/bank-accounts/:id/ledger', authenticateToken, ctrl.bankAccountLedger);
router.get('/bank-accounts/:id/statement', authenticateToken, ctrl.bankStatement);
router.get('/cash-bank-summary', authenticateToken, ctrl.cashBankSummary);
// GST & Tax
router.get('/gst', authenticateToken, ctrl.gstSummary);
router.get('/gst/ledger', authenticateToken, ctrl.gstLedger);
router.get('/gst/trend', authenticateToken, ctrl.gstTrend);
router.get('/gst/settings', authenticateToken, ctrl.gstSettings);
router.patch('/gst/settings', authenticateToken, ctrl.updateGSTSettings);
router.get('/gst/hsn-summary', authenticateToken, ctrl.gstHsnSummary);
router.get('/gst/by-state', authenticateToken, ctrl.gstByState);

// Fixed Assets
router.get('/fixed-assets', authenticateToken, ctrl.listFixedAssets);
router.post('/fixed-assets', authenticateToken, ctrl.createFixedAsset);
router.patch('/fixed-assets/:id/dispose', authenticateToken, ctrl.disposeFixedAsset);
router.delete('/fixed-assets/:id', authenticateToken, ctrl.deleteFixedAsset);
router.post('/fixed-assets/post-depreciation', authenticateToken, ctrl.postMonthlyDepreciation);

// Cost Centers & Product Costing
router.get('/cost-centers', authenticateToken, ctrl.listCostCenters);
router.post('/cost-centers', authenticateToken, ctrl.createCostCenter);
router.put('/cost-centers/:id', authenticateToken, ctrl.updateCostCenter);
router.delete('/cost-centers/:id', authenticateToken, ctrl.deleteCostCenter);
router.get('/expense-locations', authenticateToken, ctrl.expenseLocations);
router.get('/product-costing', authenticateToken, ctrl.productCosting);

// Budgets & Expense Requests
router.get('/budgets', authenticateToken, ctrl.listBudgets);
router.post('/budgets', authenticateToken, ctrl.createBudget);
router.get('/expense-requests', authenticateToken, ctrl.listExpenseRequests);

// Chart of Accounts & General Ledger
router.get('/chart-of-accounts', authenticateToken, ctrl.chartOfAccounts);
router.get('/journal-entries', authenticateToken, ctrl.journalEntries);
router.post('/journal-entries', authenticateToken, ctrl.createJournalEntry);
router.delete('/journal-entries/:id', authenticateToken, ctrl.deleteJournalEntry);

// Trial Balance
router.get('/statements/trial-balance', authenticateToken, ctrl.trialBalance);

// Financial Statements
router.get('/statements/pl', authenticateToken, ctrl.profitAndLoss);
router.get('/statements/balance-sheet', authenticateToken, ctrl.balanceSheet);
router.get('/statements/cash-flow', authenticateToken, ctrl.cashFlow);
router.put('/fixed-assets/:id', authenticateToken, ctrl.updateFixedAsset);
router.get('/fixed-assets/:id/depreciation-log', authenticateToken, ctrl.getAssetDepreciationLog);

module.exports = router;