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
const requireIndustry = require('../middleware/industry');
const ctrl = require('../controllers/accountingController');

// Dashboard
router.get('/dashboard', authenticateToken, requireIndustry, ctrl.dashboard);

// Accounts Receivable / Payable
router.get('/receivables', authenticateToken, requireIndustry, ctrl.receivables);
router.get('/payables', authenticateToken, requireIndustry, ctrl.payables);

// Cash & Bank
router.get('/bank-accounts', authenticateToken, requireIndustry, ctrl.listBankAccounts);
router.post('/bank-accounts', authenticateToken, requireIndustry, ctrl.createBankAccount);
router.get('/bank-transactions', authenticateToken, requireIndustry, ctrl.listBankTransactions);
router.post('/bank-transactions', authenticateToken, requireIndustry, ctrl.createBankTransaction);
router.patch('/bank-transactions/:id', authenticateToken, requireIndustry, ctrl.updateBankTransaction);
router.delete('/bank-transactions/:id', authenticateToken, requireIndustry, ctrl.deleteBankTransaction);
router.patch('/bank-transactions/:id/reconcile', authenticateToken, requireIndustry, ctrl.reconcileBankTransaction);
router.get('/bank-accounts/:id/ledger', authenticateToken, requireIndustry, ctrl.bankAccountLedger);
router.get('/bank-accounts/:id/statement', authenticateToken, requireIndustry, ctrl.bankStatement);
router.get('/cash-bank-summary', authenticateToken, requireIndustry, ctrl.cashBankSummary);
// GST & Tax
router.get('/gst', authenticateToken, requireIndustry, ctrl.gstSummary);
router.get('/gst/ledger', authenticateToken, requireIndustry, ctrl.gstLedger);
router.get('/gst/trend', authenticateToken, requireIndustry, ctrl.gstTrend);
router.get('/gst/settings', authenticateToken, requireIndustry, ctrl.gstSettings);
router.patch('/gst/settings', authenticateToken, requireIndustry, ctrl.updateGSTSettings);
router.get('/gst/hsn-summary', authenticateToken, requireIndustry, ctrl.gstHsnSummary);
router.get('/gst/by-state', authenticateToken, requireIndustry, ctrl.gstByState);

// Fixed Assets
router.get('/fixed-assets', authenticateToken, requireIndustry, ctrl.listFixedAssets);
router.post('/fixed-assets', authenticateToken, requireIndustry, ctrl.createFixedAsset);
router.patch('/fixed-assets/:id/dispose', authenticateToken, requireIndustry, ctrl.disposeFixedAsset);
router.delete('/fixed-assets/:id', authenticateToken, requireIndustry, ctrl.deleteFixedAsset);
router.post('/fixed-assets/post-depreciation', authenticateToken, requireIndustry, ctrl.postMonthlyDepreciation);

// Cost Centers & Product Costing
router.get('/cost-centers', authenticateToken, requireIndustry, ctrl.listCostCenters);
router.post('/cost-centers', authenticateToken, requireIndustry, ctrl.createCostCenter);
router.put('/cost-centers/:id', authenticateToken, requireIndustry, ctrl.updateCostCenter);
router.delete('/cost-centers/:id', authenticateToken, requireIndustry, ctrl.deleteCostCenter);
router.get('/expense-locations', authenticateToken, requireIndustry, ctrl.expenseLocations);
router.get('/product-costing', authenticateToken, requireIndustry, ctrl.productCosting);

// Budgets & Expense Requests
router.get('/budgets', authenticateToken, requireIndustry, ctrl.listBudgets);
router.post('/budgets', authenticateToken, requireIndustry, ctrl.createBudget);
router.get('/expense-requests', authenticateToken, requireIndustry, ctrl.listExpenseRequests);

// Chart of Accounts & General Ledger
router.get('/chart-of-accounts', authenticateToken, requireIndustry, ctrl.chartOfAccounts);
router.get('/journal-entries', authenticateToken, requireIndustry, ctrl.journalEntries);
router.post('/journal-entries', authenticateToken, requireIndustry, ctrl.createJournalEntry);
router.delete('/journal-entries/:id', authenticateToken, requireIndustry, ctrl.deleteJournalEntry);

// Trial Balance
router.get('/statements/trial-balance', authenticateToken, requireIndustry, ctrl.trialBalance);

// Financial Statements
router.get('/statements/pl', authenticateToken, requireIndustry, ctrl.profitAndLoss);
router.get('/statements/balance-sheet', authenticateToken, requireIndustry, ctrl.balanceSheet);
router.get('/statements/cash-flow', authenticateToken, requireIndustry, ctrl.cashFlow);
router.put('/fixed-assets/:id', authenticateToken, requireIndustry, ctrl.updateFixedAsset);
router.get('/fixed-assets/:id/depreciation-log', authenticateToken, requireIndustry, ctrl.getAssetDepreciationLog);

module.exports = router;