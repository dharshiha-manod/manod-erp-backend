/**
 * ====================================================
 * routes/stockTransfers.js
 * All REST endpoints for the Stock Transfer module.
 * Mirrors the style of routes/purchases.js exactly.
 * Mount point: /api/stock-transfers  (registered in server.js)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken        = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl                     = require('../controllers/stockTransferController');

// ── Permission groups (mirror featurePermissionMap.js STOCK_TRANSFERS entry) ─
const VIEW_STOCK_TRANSFERS   = [
  ['Stock Transfer', 'View all stock transfer'],
  ['Stock Transfer', 'View own stock transfer'],
];
const ADD_STOCK_TRANSFERS    = [['Stock Transfer', 'Add stock transfer']];
const EDIT_STOCK_TRANSFERS   = [['Stock Transfer', 'Edit stock transfer']];
const DELETE_STOCK_TRANSFERS = [['Stock Transfer', 'Delete stock transfer']];

// ── STATS  (must come before /:id to avoid route clash) ──────────────────────
router.get(
  '/stats',
  authenticateToken,
  requireAnyPermission(VIEW_STOCK_TRANSFERS),
  ctrl.getStats
);

// ── PRODUCTS DROPDOWN  (must come before /:id to avoid route clash) ──────────
router.get(
  '/products',
  authenticateToken,
  requireAnyPermission(VIEW_STOCK_TRANSFERS),
  ctrl.getProducts
);

// ── LIST ALL STOCK TRANSFERS ──────────────────────────────────────────────────
// GET /api/stock-transfers?page=1&limit=25&search=&status=&location_from=&location_to=&date_from=&date_to=
router.get(
  '/',
  authenticateToken,
  requireAnyPermission(VIEW_STOCK_TRANSFERS),
  ctrl.getAllStockTransfers
);

// ── GET SINGLE STOCK TRANSFER ─────────────────────────────────────────────────
// GET /api/stock-transfers/:id
router.get(
  '/:id',
  authenticateToken,
  requireAnyPermission(VIEW_STOCK_TRANSFERS),
  ctrl.getStockTransferById
);

// ── CREATE STOCK TRANSFER ─────────────────────────────────────────────────────
// POST /api/stock-transfers
// Body: { location_from, location_to, status, items[], shipping_charges, additional_notes, ... }
router.post(
  '/',
  authenticateToken,
  requireAnyPermission(ADD_STOCK_TRANSFERS),
  ctrl.createStockTransfer
);

// ── UPDATE STOCK TRANSFER ─────────────────────────────────────────────────────
// PUT /api/stock-transfers/:id
router.put(
  '/:id',
  authenticateToken,
  requireAnyPermission(EDIT_STOCK_TRANSFERS),
  ctrl.updateStockTransfer
);

// ── DELETE STOCK TRANSFER ─────────────────────────────────────────────────────
// DELETE /api/stock-transfers/:id
router.delete(
  '/:id',
  authenticateToken,
  requireAnyPermission(DELETE_STOCK_TRANSFERS),
  ctrl.deleteStockTransfer
);

module.exports = router;