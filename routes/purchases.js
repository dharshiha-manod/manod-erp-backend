/**
 * ====================================================
 * routes/purchases.js
 * All REST endpoints for the Purchase module.
 * Mirrors the style of routes/contacts.js exactly.
 * Mount point: /api/purchases  (registered in server.js)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken       = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl                    = require('../controllers/purchaseController');

// ── Permission groups (mirror featurePermissionMap.js PURCHASES entry) ───────
const VIEW_PURCHASES   = [
  ['Purchase', 'View all Purchase'],
  ['Purchase', 'View own Purchase'],
];
const ADD_PURCHASES    = [['Purchase', 'Add purchase']];
const EDIT_PURCHASES   = [['Purchase', 'Edit purchase']];
const DELETE_PURCHASES = [['Purchase', 'Delete purchase']];
const ADD_PAYMENT      = [
  ['Purchase', 'Add purchase'],
  ['Purchase', 'Edit purchase'],
];

// ── STATS  (must come before /:id to avoid route clash) ──────────────────────
router.get(
  '/stats',
  authenticateToken,
  requireAnyPermission(VIEW_PURCHASES),
  ctrl.getStats
);

// ── PRODUCTS SEARCH (for Add Purchase form) ──────────────────────────────────
// GET /api/purchases/products/search?q=chai
router.get(
  '/products/search',
  authenticateToken,
  requireAnyPermission(VIEW_PURCHASES),
  ctrl.searchProducts
);

// ── SUPPLIERS DROPDOWN ───────────────────────────────────────────────────────
router.get(
  '/suppliers',
  authenticateToken,
  requireAnyPermission(VIEW_PURCHASES),
  ctrl.getSuppliers
);

// ── LIST ALL PURCHASES ───────────────────────────────────────────────────────
// GET /api/purchases?page=1&limit=25&search=&supplier_id=&purchase_status=&payment_status=&date_from=&date_to=
router.get(
  '/',
  authenticateToken,
  requireAnyPermission(VIEW_PURCHASES),
  ctrl.getAllPurchases
);

// ── GET SINGLE PURCHASE ──────────────────────────────────────────────────────
// GET /api/purchases/:id
router.get(
  '/:id',
  authenticateToken,
  requireAnyPermission(VIEW_PURCHASES),
  ctrl.getPurchaseById
);

// ── CREATE PURCHASE ──────────────────────────────────────────────────────────
// POST /api/purchases
// Body: { supplier_id, purchase_status, location, items[], payment_amount, payment_method, ... }
router.post(
  '/',
  authenticateToken,
  requireAnyPermission(ADD_PURCHASES),
  ctrl.createPurchase
);

// ── UPDATE PURCHASE ──────────────────────────────────────────────────────────
// PUT /api/purchases/:id
router.put(
  '/:id',
  authenticateToken,
  requireAnyPermission(EDIT_PURCHASES),
  ctrl.updatePurchase
);

// ── DELETE PURCHASE ──────────────────────────────────────────────────────────
// DELETE /api/purchases/:id
router.delete(
  '/:id',
  authenticateToken,
  requireAnyPermission(DELETE_PURCHASES),
  ctrl.deletePurchase
);

// ── ADD PAYMENT ──────────────────────────────────────────────────────────────
// POST /api/purchases/:id/payments
// Body: { amount, payment_method, paid_on, note }
router.post(
  '/:id/payments',
  authenticateToken,
  requireAnyPermission(ADD_PAYMENT),
  ctrl.addPayment
);

// ── DELETE PAYMENT ───────────────────────────────────────────────────────────
// DELETE /api/purchases/:id/payments/:paymentId
router.delete(
  '/:id/payments/:paymentId',
  authenticateToken,
  requireAnyPermission(DELETE_PURCHASES),
  ctrl.deletePayment
);

module.exports = router;