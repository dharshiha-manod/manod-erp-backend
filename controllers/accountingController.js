/**
 * ====================================================
 * controllers/accountingController.js
 * Thin HTTP layer over services/accountingService.js
 * Mirrors the style of controllers/reportsController.js
 *
 * Every handler forwards req.industryId (set by the
 * requireIndustry middleware) as the first argument to
 * the corresponding service function, so every query is
 * scoped to the caller's active Industry Workspace.
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
  dashboard: wrap(async (req) => ({
    data: await svc.getDashboardSummary(req.industryId),
    trend: await svc.getRevenueExpenseTrend(req.industryId),
    aging: await svc.getARAging(req.industryId),
  }), 'dashboard'),

  // Receivables / Payables
  receivables: wrap(async (req) => {
    const { rows, summary, aging } = await svc.getReceivables(req.industryId, req.query);
    return { data: rows, summary, aging };
  }, 'receivables'),

  payables: wrap(async (req) => {
    const { rows, summary } = await svc.getPayables(req.industryId, req.query);
    return { data: rows, summary };
  }, 'payables'),

  // Cash & Bank
  listBankAccounts: wrap(async (req) => ({ data: await svc.listBankAccounts(req.industryId) }), 'listBankAccounts'),
  createBankAccount: wrap(async (req) => ({ data: await svc.createBankAccount(req.industryId, req.body) }), 'createBankAccount'),

  listBankTransactions: wrap(async (req) => ({ data: await svc.listBankTransactions(req.industryId, req.query) }), 'listBankTransactions'),
  createBankTransaction: wrap(async (req) => ({ data: await svc.createBankTransaction(req.industryId, req.body, req.user?.id) }), 'createBankTransaction'),
  updateBankTransaction: wrap(async (req) => ({ data: await svc.updateBankTransaction(req.industryId, req.params.id, req.body) }), 'updateBankTransaction'),
  deleteBankTransaction: wrap(async (req) => ({ data: await svc.deleteBankTransaction(req.industryId, req.params.id) }), 'deleteBankTransaction'),
  reconcileBankTransaction: wrap(async (req) => ({ data: await svc.reconcileBankTransaction(req.industryId, req.params.id) }), 'reconcileBankTransaction'),
  bankAccountLedger: wrap(async (req) => ({ data: await svc.getBankAccountLedger(req.industryId, req.params.id, req.query) }), 'bankAccountLedger'),
  bankStatement: wrap(async (req) => ({ data: await svc.getBankStatement(req.industryId, req.params.id, req.query) }), 'bankStatement'),
  cashBankSummary: wrap(async (req) => ({ data: await svc.getCashBankSummary(req.industryId) }), 'cashBankSummary'),
// GST & Tax
  gstSummary: wrap(async (req) => ({
    data: await svc.getGSTSummary(req.industryId),
    taxRates: await svc.getTaxRateMaster(req.industryId),
    returns: await svc.getGSTQuarterly(req.industryId),
  }), 'gstSummary'),
  gstLedger: wrap(async (req) => ({ data: await svc.getGSTLedger(req.industryId) }), 'gstLedger'),
  gstTrend: wrap(async (req) => ({ data: await svc.getGSTMonthlyTrend(req.industryId) }), 'gstTrend'),
 gstSettings: wrap(async (req) => ({ data: await svc.getGSTSettings(req.industryId) }), 'gstSettings'),
  updateGSTSettings: wrap(async (req) => ({ data: await svc.updateGSTSettings(req.industryId, req.body) }), 'updateGSTSettings'),
 gstHsnSummary: wrap(async (req) => ({ data: await svc.getHSNSummary(req.industryId) }), 'gstHsnSummary'),
  gstByState: wrap(async (req) => ({ data: await svc.getGSTByState(req.industryId) }), 'gstByState'),

  // Fixed Assets
 listFixedAssets: wrap(async (req) => ({ data: await svc.listFixedAssets(req.industryId) }), 'listFixedAssets'),
  createFixedAsset: wrap(async (req) => ({ data: await svc.createFixedAsset(req.industryId, req.body) }), 'createFixedAsset'),
  updateFixedAsset: wrap(async (req) => ({ data: await svc.updateFixedAsset(req.industryId, req.params.id, req.body) }), 'updateFixedAsset'),
disposeFixedAsset: wrap(async (req) => ({ data: await svc.disposeFixedAsset(req.industryId, req.params.id) }), 'disposeFixedAsset'),
  deleteFixedAsset: wrap(async (req) => ({ data: await svc.deleteFixedAsset(req.industryId, req.params.id) }), 'deleteFixedAsset'),
  getAssetDepreciationLog: wrap(async (req) => ({ data: await svc.getAssetDepreciationLog(req.industryId, req.params.id) }), 'getAssetDepreciationLog'),
  postMonthlyDepreciation: wrap(async (req) => ({ data: await svc.postMonthlyDepreciation(req.industryId) }), 'postMonthlyDepreciation'),

// Cost Centers & Costing
  listCostCenters: wrap(async (req) => ({ data: await svc.listCostCenters(req.industryId) }), 'listCostCenters'),
  createCostCenter: wrap(async (req) => ({ data: await svc.createCostCenter(req.industryId, req.body) }), 'createCostCenter'),
  updateCostCenter: wrap(async (req) => ({ data: await svc.updateCostCenter(req.industryId, req.params.id, req.body) }), 'updateCostCenter'),
  deleteCostCenter: wrap(async (req) => ({ data: await svc.deleteCostCenter(req.industryId, req.params.id) }), 'deleteCostCenter'),
  expenseLocations: wrap(async (req) => ({ data: await svc.getExpenseLocations(req.industryId) }), 'expenseLocations'),
  productCosting: wrap(async (req) => ({ data: await svc.getProductCosting(req.industryId) }), 'productCosting'),

  // Budgets
  listBudgets: wrap(async (req) => ({ data: await svc.listBudgets(req.industryId) }), 'listBudgets'),
  createBudget: wrap(async (req) => ({ data: await svc.createBudget(req.industryId, req.body) }), 'createBudget'),
  listExpenseRequests: wrap(async (req) => ({ data: await svc.listExpenseRequests(req.industryId) }), 'listExpenseRequests'),

  // Chart of Accounts & General Ledger
  chartOfAccounts: wrap(async (req) => ({ data: await svc.getChartOfAccounts(req.industryId) }), 'chartOfAccounts'),
  journalEntries: wrap(async (req) => ({
    data: await svc.listManualJournalEntries(req.industryId, req.query.limit),
    derived: await svc.listDerivedJournal(req.industryId, req.query.limit),
  }), 'journalEntries'),
  createJournalEntry: wrap(async (req) => ({ data: await svc.createManualJournalEntry(req.industryId, req.body, req.user?.id) }), 'createJournalEntry'),
  deleteJournalEntry: wrap(async (req) => ({ data: await svc.deleteManualJournalEntry(req.industryId, req.params.id) }), 'deleteJournalEntry'),
  // Trial Balance
  trialBalance: wrap(async (req) => ({ data: await svc.getTrialBalance(req.industryId) }), 'trialBalance'),

  // Financial Statements
  profitAndLoss: wrap(async (req) => ({ data: await svc.getProfitAndLoss(req.industryId, req.query) }), 'profitAndLoss'),
  balanceSheet: wrap(async (req) => ({ data: await svc.getBalanceSheet(req.industryId) }), 'balanceSheet'),
  cashFlow: wrap(async (req) => ({ data: await svc.getCashFlow(req.industryId) }), 'cashFlow'),
};