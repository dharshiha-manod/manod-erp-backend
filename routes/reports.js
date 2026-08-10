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
const requireIndustry    = require('../middleware/industry');
const ctrl               = require('../controllers/reportsController');

// ═══════════════════════════════════════════════════════════════
// NET PROFIT (DASHBOARD)  → /api/reports/net-profit
// ═══════════════════════════════════════════════════════════════
router.get('/net-profit', authenticateToken, requireIndustry, ctrl.netProfitSummary);
router.get('/stock', authenticateToken, requireIndustry, ctrl.stockReport);
router.get('/location-wise-stock', authenticateToken, requireIndustry, ctrl.locationWiseStockReport);
router.get('/stock-adjustment', authenticateToken, requireIndustry, ctrl.stockAdjustmentReport);
router.get('/items', authenticateToken, requireIndustry, ctrl.itemsReport);
router.get('/product-purchase', authenticateToken, requireIndustry, ctrl.productPurchaseReport);
router.get('/product-sell', authenticateToken, requireIndustry, ctrl.productSellReport);
router.get('/expense', authenticateToken, requireIndustry, ctrl.expenseReport);
router.get('/sales-representative', authenticateToken, requireIndustry, ctrl.salesRepresentativeReport);
router.get('/purchase-payment', authenticateToken, requireIndustry, ctrl.purchasePaymentReport);
router.get('/sell-payment', authenticateToken, requireIndustry, ctrl.sellPaymentReport);
router.get('/profit-loss', authenticateToken, requireIndustry, ctrl.profitLossReport);
router.get('/tax', authenticateToken, requireIndustry, ctrl.taxReport);
router.get('/tax-by-product', authenticateToken, requireIndustry, ctrl.taxByProductReport);
router.get('/trending-products', authenticateToken, requireIndustry, ctrl.trendingProductsReport);
router.get('/supplier-customer', authenticateToken, requireIndustry, ctrl.supplierCustomerReport);
router.post('/send-ledger/:contactId', authenticateToken, requireIndustry, ctrl.sendLedger);
router.get('/customer-groups', authenticateToken, requireIndustry, ctrl.customerGroupsReport);
router.get('/purchase-sale', authenticateToken, requireIndustry, ctrl.purchaseSaleReport);
router.get('/sales-by-category', authenticateToken, requireIndustry, ctrl.salesByCategoryReport);
router.get('/activity-log', authenticateToken, requireIndustry, ctrl.activityLogReport);
router.get('/register', authenticateToken, requireIndustry, ctrl.registerReport);

module.exports = router;