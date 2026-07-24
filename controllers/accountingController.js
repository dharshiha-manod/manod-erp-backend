/**
 * ====================================================
 * controllers/accountingController.js
 * Thin HTTP layer over services/accountingService.js
 * Mirrors the style of controllers/reportsController.js
 * ====================================================
 */

'use strict';

const svc = require('../services/accountingService');

const wrap = (fn, label) => async (req, res) => {
  try {
    const data = await fn(req);
    res.json({ success: true, ...data });
  } catch (err) {
    console.error(`❌ [accountingController.${label}]`, err.message);
    res.status(500).json({ success: false, error: err.message || `Failed to load ${label}` });
  }
};

module.exports = {
  // Dashboard
  dashboard: wrap(async () => ({
    data: await svc.getDashboardSummary(),
    trend: await svc.getRevenueExpenseTrend(),
    aging: await svc.getARAging(),
  }), 'dashboard'),

  // Receivables / Payables
  receivables: wrap(async (req) => {
    const { rows, summary, aging } = await svc.getReceivables(req.query);
    return { data: rows, summary, aging };
  }, 'receivables'),

  payables: wrap(async (req) => {
    const { rows, summary } = await svc.getPayables(req.query);
    return { data: rows, summary };
  }, 'payables'),

  // Cash & Bank
  listBankAccounts: wrap(async () => ({ data: await svc.listBankAccounts() }), 'listBankAccounts'),
  createBankAccount: wrap(async (req) => ({ data: await svc.createBankAccount(req.body) }), 'createBankAccount'),
  
listBankTransactions: wrap(async (req) => ({ data: await svc.listBankTransactions(req.query) }), 'listBankTransactions'),
  createBankTransaction: wrap(async (req) => ({ data: await svc.createBankTransaction(req.body, req.user?.id) }), 'createBankTransaction'),
  updateBankTransaction: wrap(async (req) => ({ data: await svc.updateBankTransaction(req.params.id, req.body) }), 'updateBankTransaction'),
  deleteBankTransaction: wrap(async (req) => ({ data: await svc.deleteBankTransaction(req.params.id) }), 'deleteBankTransaction'),
  reconcileBankTransaction: wrap(async (req) => ({ data: await svc.reconcileBankTransaction(req.params.id) }), 'reconcileBankTransaction'),
  bankAccountLedger: wrap(async (req) => ({ data: await svc.getBankAccountLedger(req.params.id, req.query) }), 'bankAccountLedger'),
  bankStatement: wrap(async (req) => ({ data: await svc.getBankStatement(req.params.id, req.query) }), 'bankStatement'),
  cashBankSummary: wrap(async () => ({ data: await svc.getCashBankSummary() }), 'cashBankSummary'),
// GST & Tax
  gstSummary: wrap(async () => ({
    data: await svc.getGSTSummary(),
    taxRates: await svc.getTaxRateMaster(),
    returns: await svc.getGSTQuarterly(),
  }), 'gstSummary'),
  gstLedger: wrap(async () => ({ data: await svc.getGSTLedger() }), 'gstLedger'),
  gstTrend: wrap(async () => ({ data: await svc.getGSTMonthlyTrend() }), 'gstTrend'),
 gstSettings: wrap(async () => ({ data: await svc.getGSTSettings() }), 'gstSettings'),
  updateGSTSettings: wrap(async (req) => ({ data: await svc.updateGSTSettings(req.body) }), 'updateGSTSettings'),
 gstHsnSummary: wrap(async () => ({ data: await svc.getHSNSummary() }), 'gstHsnSummary'),
  gstByState: wrap(async () => ({ data: await svc.getGSTByState() }), 'gstByState'),

  // Fixed Assets
 listFixedAssets: wrap(async () => ({ data: await svc.listFixedAssets() }), 'listFixedAssets'),
  createFixedAsset: wrap(async (req) => ({ data: await svc.createFixedAsset(req.body) }), 'createFixedAsset'),
  updateFixedAsset: wrap(async (req) => ({ data: await svc.updateFixedAsset(req.params.id, req.body) }), 'updateFixedAsset'),
disposeFixedAsset: wrap(async (req) => ({ data: await svc.disposeFixedAsset(req.params.id) }), 'disposeFixedAsset'),
  deleteFixedAsset: wrap(async (req) => ({ data: await svc.deleteFixedAsset(req.params.id) }), 'deleteFixedAsset'),
  getAssetDepreciationLog: wrap(async (req) => ({ data: await svc.getAssetDepreciationLog(req.params.id) }), 'getAssetDepreciationLog'),
  postMonthlyDepreciation: wrap(async () => ({ data: await svc.postMonthlyDepreciation() }), 'postMonthlyDepreciation'),

// Cost Centers & Costing
  listCostCenters: wrap(async () => ({ data: await svc.listCostCenters() }), 'listCostCenters'),
  createCostCenter: wrap(async (req) => ({ data: await svc.createCostCenter(req.body) }), 'createCostCenter'),
  updateCostCenter: wrap(async (req) => ({ data: await svc.updateCostCenter(req.params.id, req.body) }), 'updateCostCenter'),
  deleteCostCenter: wrap(async (req) => ({ data: await svc.deleteCostCenter(req.params.id) }), 'deleteCostCenter'),
  expenseLocations: wrap(async () => ({ data: await svc.getExpenseLocations() }), 'expenseLocations'),
  productCosting: wrap(async () => ({ data: await svc.getProductCosting() }), 'productCosting'),

  // Budgets
  listBudgets: wrap(async () => ({ data: await svc.listBudgets() }), 'listBudgets'),
  createBudget: wrap(async (req) => ({ data: await svc.createBudget(req.body) }), 'createBudget'),
  listExpenseRequests: wrap(async () => ({ data: await svc.listExpenseRequests() }), 'listExpenseRequests'),

  // Chart of Accounts & General Ledger
  chartOfAccounts: wrap(async () => ({ data: await svc.getChartOfAccounts() }), 'chartOfAccounts'),
  journalEntries: wrap(async (req) => ({
    data: await svc.listManualJournalEntries(req.query.limit),
    derived: await svc.listDerivedJournal(req.query.limit),
  }), 'journalEntries'),
  createJournalEntry: wrap(async (req) => ({ data: await svc.createManualJournalEntry(req.body, req.user?.id) }), 'createJournalEntry'),
  deleteJournalEntry: wrap(async (req) => ({ data: await svc.deleteManualJournalEntry(req.params.id) }), 'deleteJournalEntry'), 
  // Trial Balance
  trialBalance: wrap(async () => ({ data: await svc.getTrialBalance() }), 'trialBalance'),

  // Financial Statements
  profitAndLoss: wrap(async (req) => ({ data: await svc.getProfitAndLoss(req.query) }), 'profitAndLoss'),
  balanceSheet: wrap(async () => ({ data: await svc.getBalanceSheet() }), 'balanceSheet'),
  cashFlow: wrap(async () => ({ data: await svc.getCashFlow() }), 'cashFlow'),
};