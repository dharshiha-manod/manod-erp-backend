/**
 * ====================================================
 * routes/sell.js
 * All REST endpoints for the Sell module: Invoices, POS,
 * Quotations, Returns, Shipments, Discounts, CSV Import.
 * Mirrors the style of routes/purchases.js.
 * Mount point: '/api'  (so paths become /api/sales-invoice,
 * /api/pos-sales, /api/quotations, etc. — matching what
 * Sell.jsx already calls)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken        = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl                     = require('../controllers/sellController');// NOTE: only 'View all sell' / 'View own sell only' / 'View paid
// sells only' and 'View POS sell' / 'Add POS sell' are confirmed to
// exist in your featurePermissionMap.js. If you later add separate
// "Add/Edit/Delete sale" permissions in your permissions table,
// swap them in below — for now writes are gated with the same
// view-level groups so nothing breaks.
const VIEW_SELL = [
  ['Sell', 'View all sell'],
  ['Sell', 'View own sell only'],
  ['Sell', 'View paid sells only'],
];
const VIEW_POS = [
  ['POS', 'View POS sell'],
  ['POS', 'Add POS sell'],
];
const ADD_POS = [['POS', 'Add POS sell']];

// ═══════════════════════════════════════════════════════════════
// SALES INVOICES  → /api/sales-invoice
// ═══════════════════════════════════════════════════════════════
router.get('/sales-invoice',      authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getAllInvoices);
router.get('/sales-invoice/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getInvoiceById);
router.post('/sales-invoice',     authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.createInvoice);
router.put('/sales-invoice/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.updateInvoice);
router.delete('/sales-invoice/:id', authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.deleteInvoice);

// ═══════════════════════════════════════════════════════════════
// POS SALES  → /api/pos-sales
// ═══════════════════════════════════════════════════════════════
router.get('/pos-sales',      authenticateToken, requireAnyPermission(VIEW_POS), ctrl.getAllPOSSales);
router.get('/pos-sales/:id',  authenticateToken, requireAnyPermission(VIEW_POS), ctrl.getPOSSaleById);
router.post('/pos-sales',     authenticateToken, requireAnyPermission(ADD_POS),  ctrl.createPOSSale);
router.put('/pos-sales/:id',  authenticateToken, requireAnyPermission(ADD_POS),  ctrl.updatePOSSale);
router.delete('/pos-sales/:id', authenticateToken, requireAnyPermission(ADD_POS), ctrl.deletePOSSale);

// ═══════════════════════════════════════════════════════════════
// QUOTATIONS  → /api/quotations
// ═══════════════════════════════════════════════════════════════
router.get('/quotations',      authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getAllQuotations);
router.get('/quotations/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getQuotationById);
router.post('/quotations',     authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.createQuotation);
router.put('/quotations/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.updateQuotation);
router.delete('/quotations/:id', authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.deleteQuotation);
// ═══════════════════════════════════════════════════════════════
// DRAFTS  → /api/sales-drafts
// ═══════════════════════════════════════════════════════════════
router.get('/sales-drafts',      authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getAllDrafts);
router.get('/sales-drafts/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getDraftById);
router.post('/sales-drafts',     authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.createDraft);
router.put('/sales-drafts/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.updateDraft);
router.delete('/sales-drafts/:id', authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.deleteDraft);

// ═══════════════════════════════════════════════════════════════
// SALES RETURNS  → /api/sales-returns
// ═══════════════════════════════════════════════════════════════
router.get('/sales-returns',      authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getAllReturns);
router.get('/sales-returns/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getReturnById);
router.post('/sales-returns',     authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.createReturn);
router.put('/sales-returns/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.updateReturn);
router.delete('/sales-returns/:id', authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.deleteReturn);
// ═══════════════════════════════════════════════════════════════
// SHIPMENTS  → /api/shipments
// ═══════════════════════════════════════════════════════════════
router.get('/shipments',      authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getAllShipments);
router.get('/shipments/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getShipmentById);
router.post('/shipments',     authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.createShipment);
router.put('/shipments/:id',  authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.updateShipment);
router.delete('/shipments/:id', authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.deleteShipment);

// ═══════════════════════════════════════════════════════════════
// DISCOUNTS  → /api/discounts
// ═══════════════════════════════════════════════════════════════
router.get('/discounts',            authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getAllDiscounts);
router.get('/discounts/code/:code', authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.validateDiscountCode);
router.get('/discounts/:id',        authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.getDiscountById);
router.post('/discounts',           authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.createDiscount);
router.put('/discounts/:id',        authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.updateDiscount);
router.delete('/discounts/:id',     authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.deleteDiscount);

// ═══════════════════════════════════════════════════════════════
// IMPORT SALES (CSV)  → /api/import/sales
// (matches the hard-coded URL already used in Sell.jsx's ImportSales)
// ═══════════════════════════════════════════════════════════════
router.post('/import/sales', authenticateToken, requireAnyPermission(VIEW_SELL), ctrl.importSales);

module.exports = router;