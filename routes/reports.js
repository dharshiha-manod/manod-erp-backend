/**
 * ====================================================
 * routes/reports.js
 * Read-only reporting endpoints. Mirrors the style of
 * routes/stockAdjustments.js.
 * Mount point: /api/reports (register in server.js)
 *
 * NOTE on permissions: no 'Reports' permission group
 * exists yet in permissions/role_permissions (confirmed
 * by searching the codebase). Gating with authenticateToken
 * only for now, same as /profile — safe default that won't
 * lock anyone out. Swap in requireAnyPermission(['Reports', '...'])
 * once the exact permission name is confirmed from
 * featurePermissionMap.js, without changing anything else here.
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken = require('../middleware/auth');
const ctrl               = require('../controllers/reportsController');

// ═══════════════════════════════════════════════════════════════
// NET PROFIT (DASHBOARD)  → /api/reports/net-profit
// ═══════════════════════════════════════════════════════════════
router.get('/net-profit', authenticateToken, ctrl.netProfitSummary);

// ═══════════════════════════════════════════════════════════════
// STOCK REPORT  → /api/reports/stock
// ═══════════════════════════════════════════════════════════════
router.get('/stock', authenticateToken, ctrl.stockReport);

// ═══════════════════════════════════════════════════════════════
// STOCK ADJUSTMENT REPORT  → /api/reports/stock-adjustment
// ═══════════════════════════════════════════════════════════════
router.get('/stock-adjustment', authenticateToken, ctrl.stockAdjustmentReport);

// ═══════════════════════════════════════════════════════════════
// ITEMS REPORT  → /api/reports/items
// ═══════════════════════════════════════════════════════════════
router.get('/items', authenticateToken, ctrl.itemsReport);

// ═══════════════════════════════════════════════════════════════
// PRODUCT PURCHASE REPORT  → /api/reports/product-purchase
// ═══════════════════════════════════════════════════════════════
router.get('/product-purchase', authenticateToken, ctrl.productPurchaseReport);

// ═══════════════════════════════════════════════════════════════
// PRODUCT SELL REPORT  → /api/reports/product-sell
// ═══════════════════════════════════════════════════════════════
router.get('/product-sell', authenticateToken, ctrl.productSellReport);

// ═══════════════════════════════════════════════════════════════
// EXPENSE REPORT  → /api/reports/expense
// ═══════════════════════════════════════════════════════════════
router.get('/expense', authenticateToken, ctrl.expenseReport);

// ═══════════════════════════════════════════════════════════════
// SALES REPRESENTATIVE REPORT  → /api/reports/sales-representative
// ═══════════════════════════════════════════════════════════════
router.get('/sales-representative', authenticateToken, ctrl.salesRepresentativeReport);

// ═══════════════════════════════════════════════════════════════
// PURCHASE PAYMENT REPORT  → /api/reports/purchase-payment
// ═══════════════════════════════════════════════════════════════
router.get('/purchase-payment', authenticateToken, ctrl.purchasePaymentReport);

// ═══════════════════════════════════════════════════════════════
// SELL PAYMENT REPORT  → /api/reports/sell-payment
// ═══════════════════════════════════════════════════════════════
router.get('/sell-payment', authenticateToken, ctrl.sellPaymentReport);
// ═══════════════════════════════════════════════════════════════
// PROFIT / LOSS REPORT  → /api/reports/profit-loss
// ═══════════════════════════════════════════════════════════════
router.get('/profit-loss', authenticateToken, ctrl.profitLossReport);

// ═══════════════════════════════════════════════════════════════
// TAX REPORT  → /api/reports/tax
// ═══════════════════════════════════════════════════════════════
router.get('/tax', authenticateToken, ctrl.taxReport);

// ═══════════════════════════════════════════════════════════════
// TAX BY PRODUCT REPORT  → /api/reports/tax-by-product
// ═══════════════════════════════════════════════════════════════
router.get('/tax-by-product', authenticateToken, ctrl.taxByProductReport);

// ═══════════════════════════════════════════════════════════════
// TRENDING PRODUCTS REPORT  → /api/reports/trending-products
// ═══════════════════════════════════════════════════════════════
router.get('/trending-products', authenticateToken, ctrl.trendingProductsReport);

// ═══════════════════════════════════════════════════════════════
// SUPPLIER & CUSTOMER REPORT  → /api/reports/supplier-customer
// ═══════════════════════════════════════════════════════════════
router.get('/supplier-customer', authenticateToken, ctrl.supplierCustomerReport);
router.post('/send-ledger/:contactId', authenticateToken, ctrl.sendLedger);
// ═══════════════════════════════════════════════════════════════
// CUSTOMER GROUPS REPORT  → /api/reports/customer-groups
// ═══════════════════════════════════════════════════════════════
router.get('/customer-groups', authenticateToken, ctrl.customerGroupsReport);

// ═══════════════════════════════════════════════════════════════
// PURCHASE & SALE REPORT  → /api/reports/purchase-sale
// ═══════════════════════════════════════════════════════════════
router.get('/purchase-sale', authenticateToken, ctrl.purchaseSaleReport);

// ═══════════════════════════════════════════════════════════════
// SALES BY CATEGORY REPORT  → /api/reports/sales-by-category
// ═══════════════════════════════════════════════════════════════
router.get('/sales-by-category', authenticateToken, ctrl.salesByCategoryReport);

// ═══════════════════════════════════════════════════════════════
// ACTIVITY LOG REPORT  → /api/reports/activity-log
// ═══════════════════════════════════════════════════════════════
router.get('/activity-log', authenticateToken, ctrl.activityLogReport);

// ═══════════════════════════════════════════════════════════════
// REGISTER REPORT  → /api/reports/register
// ═══════════════════════════════════════════════════════════════
router.get('/register', authenticateToken, ctrl.registerReport);

module.exports = router;