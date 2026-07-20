  /**
   * ====================================================
   * controllers/reportsController.js
   * Thin HTTP layer over services/reportService.js
   * Mirrors the style of stockAdjustmentController.js
   * ====================================================
   */

'use strict';

const reportService = require('../services/reportService');
  const notificationEngine = require('../services/notificationEngine');

  // ── NET PROFIT (DASHBOARD) ──────────────────────────────────────────────
  const netProfitSummary = async (req, res) => {
    try {
      const data = await reportService.getNetProfitSummary(req.query);
      res.json({ success: true, data });
    } catch (err) {
      console.error('❌ [reportsController.netProfitSummary]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load net profit summary' });
    }
  };

  // ── STOCK REPORT ──────────────────────────────────────────────────────────
  const stockReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getStockReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.stockReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load stock report' });
    }
  };

  // ── STOCK ADJUSTMENT REPORT ───────────────────────────────────────────────
  const stockAdjustmentReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getStockAdjustmentReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.stockAdjustmentReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load stock adjustment report' });
    }
  };

  // ── ITEMS REPORT ──────────────────────────────────────────────────────────
  const itemsReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getItemsReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.itemsReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load items report' });
    }
  };

  // ── PRODUCT PURCHASE REPORT ───────────────────────────────────────────────
  const productPurchaseReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getProductPurchaseReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.productPurchaseReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load product purchase report' });
    }
  };

  // ── PRODUCT SELL REPORT ───────────────────────────────────────────────────
  const productSellReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getProductSellReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.productSellReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load product sell report' });
    }
  };

  // ── EXPENSE REPORT ─────────────────────────────────────────────────────────
  const expenseReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getExpenseReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.expenseReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load expense report' });
    }
  };

  // ── SALES REPRESENTATIVE REPORT ───────────────────────────────────────────
  const salesRepresentativeReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getSalesRepresentativeReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.salesRepresentativeReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load sales representative report' });
    }
  };

  // ── PURCHASE PAYMENT REPORT ────────────────────────────────────────────────
  const purchasePaymentReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getPurchasePaymentReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.purchasePaymentReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load purchase payment report' });
    }
  };

  // ── SELL PAYMENT REPORT ────────────────────────────────────────────────────
  const sellPaymentReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getSellPaymentReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.sellPaymentReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load sell payment report' });
    }
  };

  // ── PROFIT / LOSS REPORT ───────────────────────────────────────────────────
  const profitLossReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getProfitLossReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.profitLossReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load profit/loss report' });
    }
  };
  // ── TAX REPORT ──────────────────────────────────────────────────────────────
  const taxReport = async (req, res) => {
  try {
    const { rows, total, summary, byProduct } = await reportService.getTaxReport(req.query);
    res.json({ success: true, data: rows, total, summary, byProduct });
  } catch (err) {
    console.error('❌ [reportsController.taxReport]', err.message);
    res.status(500).json({ success: false, error: 'Failed to load tax report' });
  }
};

  // ── TAX BY PRODUCT REPORT ────────────────────────────────────────────────────
  const taxByProductReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getTaxByProductReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.taxByProductReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load tax by product report' });
    }
  };

  // ── TRENDING PRODUCTS REPORT ────────────────────────────────────────────────
  const trendingProductsReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getTrendingProductsReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.trendingProductsReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load trending products report' });
    }
  };

  // ── SUPPLIER & CUSTOMER REPORT ─────────────────────────────────────────────
  const supplierCustomerReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getSupplierCustomerReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.supplierCustomerReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load supplier & customer report' });
    }
  };

  // ── CUSTOMER GROUPS REPORT ──────────────────────────────────────────────────
  // ── SEND LEDGER (email a contact's statement of account) ────────────────────
  const fmtINR = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const fmtLedgerDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB') : '—');

  const buildTransactionsTable = (transactions) => {
    if (!transactions.length) return '<p>No transactions on record.</p>';
    const rows = transactions.map((t) => `
      <tr>
        <td style="padding:6px 10px;border-bottom:1px solid #ddd">${fmtLedgerDate(t.date)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #ddd">${t.type}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #ddd">${t.ref || '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:right">${fmtINR(t.amount)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:right">${fmtINR(t.paid)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #ddd;text-align:right">${fmtINR(t.balance)}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #ddd">${t.status || '—'}</td>
      </tr>`).join('');
    return `<table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#2e7d32;color:#fff">
          <th style="padding:6px 10px;text-align:left">Date</th>
          <th style="padding:6px 10px;text-align:left">Type</th>
          <th style="padding:6px 10px;text-align:left">Ref</th>
          <th style="padding:6px 10px;text-align:right">Amount</th>
          <th style="padding:6px 10px;text-align:right">Paid</th>
          <th style="padding:6px 10px;text-align:right">Balance</th>
          <th style="padding:6px 10px;text-align:left">Status</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  };

  const sendLedger = async (req, res) => {
    try {
      const { contactId } = req.params;
      const ledger = await reportService.getContactLedger(contactId);

      if (!ledger) {
        return res.status(404).json({ success: false, error: 'Contact not found' });
      }
      if (!ledger.contact.email) {
        return res.status(400).json({ success: false, error: 'This contact has no email address on file' });
      }

      const values = {
        contact_name: ledger.contact.name,
        contact_type: ledger.contact.contact_type,
        total_business: fmtINR(ledger.summary.total),
        total_settled: fmtINR(ledger.summary.settled),
        total_due: fmtINR(ledger.summary.due),
        transactions_table: buildTransactionsTable(ledger.transactions),
        to: ledger.contact.email,
      };

      const result = await notificationEngine.sendNotification('send_ledger', values);

      if (result.skipped) {
        return res.status(400).json({ success: false, error: result.reason });
      }

      res.json({ success: true, sentTo: ledger.contact.email });
    } catch (err) {
      console.error('❌ [reportsController.sendLedger]', err.message);
      res.status(500).json({ success: false, error: 'Failed to send ledger email' });
    }
  };
  const customerGroupsReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getCustomerGroupsReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.customerGroupsReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load customer groups report' });
    }
  };
  // ── PURCHASE & SALE REPORT ──────────────────────────────────────────────────
  const purchaseSaleReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getPurchaseSaleReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.purchaseSaleReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load purchase & sale report' });
    }
  };

// ── SALES BY CATEGORY REPORT ───────────────────────────────────────────────
  const salesByCategoryReport = async (req, res) => {
    try {
      const { data } = await reportService.getSalesByCategoryReport(req.query);
      res.json({ success: true, data });
    } catch (err) {
      console.error('❌ [reportsController.salesByCategoryReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load sales by category report' });
    }
  };

  // ── ACTIVITY LOG REPORT ───────────────────────────────────────────────────
  const activityLogReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getActivityLogReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.activityLogReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load activity log' });
    }
  };
  // ── REGISTER REPORT ────────────────────────────────────────────────────────
  const registerReport = async (req, res) => {
    try {
      const { rows, total, summary } = await reportService.getRegisterReport(req.query);
      res.json({ success: true, data: rows, total, summary });
    } catch (err) {
      console.error('❌ [reportsController.registerReport]', err.message);
      res.status(500).json({ success: false, error: 'Failed to load register report' });
    }
  };

module.exports = {
    netProfitSummary,
    activityLogReport,
    salesByCategoryReport,
    stockReport,
    stockAdjustmentReport,
    itemsReport,
    productPurchaseReport,
    productSellReport,
    expenseReport,
    salesRepresentativeReport,
    purchasePaymentReport,
    sellPaymentReport,
    profitLossReport,
    taxReport,
    taxByProductReport,
    trendingProductsReport,
supplierCustomerReport,
    sendLedger,
    customerGroupsReport,
    purchaseSaleReport,
    registerReport,
  };