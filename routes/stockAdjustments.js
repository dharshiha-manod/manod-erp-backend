/**
 * ====================================================
 * routes/stockAdjustments.js
 * All REST endpoints for the Stock Adjustment module.
 * Mirrors the style of routes/stockTransfers.js exactly.
 * Mount point: /api/stock-adjustments  (register in server.js)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken        = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl                     = require('../controllers/stockAdjustmentController');

// ── Permission groups ─────────────────────────────────────────────────────────
const VIEW_ADJ   = [
  ['Stock Adjustment', 'View all stock adjustment'],
  ['Stock Adjustment', 'View own stock adjustment'],
];
const ADD_ADJ    = [['Stock Adjustment', 'Add stock adjustment']];
const EDIT_ADJ   = [['Stock Adjustment', 'Edit stock adjustment']];
const DELETE_ADJ = [['Stock Adjustment', 'Delete stock adjustment']];

// ── UTILITY ENDPOINTS  (must come before /:id) ────────────────────────────────

// GET /api/stock-adjustments/stats
router.get('/stats',
  authenticateToken,
  requireAnyPermission(VIEW_ADJ),
  ctrl.getStats
);

// GET /api/stock-adjustments/products?search=
router.get('/products',
  authenticateToken,
  requireAnyPermission(VIEW_ADJ),
  ctrl.getProducts
);

// GET /api/stock-adjustments/locations
router.get('/locations',
  authenticateToken,
  requireAnyPermission(VIEW_ADJ),
  ctrl.getLocations
);

// ── CRUD ENDPOINTS ────────────────────────────────────────────────────────────

// GET  /api/stock-adjustments
//   ?page=1&limit=25&search=&status=&adjustment_type=&location=&date_from=&date_to=
router.get('/',
  authenticateToken,
  requireAnyPermission(VIEW_ADJ),
  ctrl.getAllAdjustments
);

// GET  /api/stock-adjustments/:id
router.get('/:id',
  authenticateToken,
  requireAnyPermission(VIEW_ADJ),
  ctrl.getAdjustmentById
);

// POST /api/stock-adjustments
// Body: { location, adjustment_type, status, adjustment_date,
//         total_amount_recovered, reason, items[], reference_no? }
router.post('/',
  authenticateToken,
  requireAnyPermission(ADD_ADJ),
  ctrl.createAdjustment
);

// PUT  /api/stock-adjustments/:id
router.put('/:id',
  authenticateToken,
  requireAnyPermission(EDIT_ADJ),
  ctrl.updateAdjustment
);

// PATCH /api/stock-adjustments/:id/approve
// Moves status → Completed and deducts stock
router.patch('/:id/approve',
  authenticateToken,
  requireAnyPermission(EDIT_ADJ),
  ctrl.approveAdjustment
);

// DELETE /api/stock-adjustments/:id
router.delete('/:id',
  authenticateToken,
  requireAnyPermission(DELETE_ADJ),
  ctrl.deleteAdjustment
);

module.exports = router;