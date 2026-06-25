/**
 * ====================================================
 * routes/purchaseReturns.js
 * Mount point: /api/purchase-returns (in server.js)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const authenticateToken        = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl                     = require('../controllers/purchaseReturnController');

const VIEW_PURCHASES   = [['Purchase', 'View all Purchase'], ['Purchase', 'View own Purchase']];
const ADD_PURCHASES    = [['Purchase', 'Add purchase']];
const EDIT_PURCHASES   = [['Purchase', 'Edit purchase']];
const DELETE_PURCHASES = [['Purchase', 'Delete purchase']];

// GET  /api/purchase-returns
router.get('/',    authenticateToken, requireAnyPermission(VIEW_PURCHASES),   ctrl.getAllReturns);

// GET  /api/purchase-returns/:id
router.get('/:id', authenticateToken, requireAnyPermission(VIEW_PURCHASES),   ctrl.getReturnById);

// POST /api/purchase-returns
router.post('/',   authenticateToken, requireAnyPermission(ADD_PURCHASES),    ctrl.createReturn);

// PUT  /api/purchase-returns/:id
router.put('/:id', authenticateToken, requireAnyPermission(EDIT_PURCHASES),   ctrl.updateReturn);

// DELETE /api/purchase-returns/:id
router.delete('/:id', authenticateToken, requireAnyPermission(DELETE_PURCHASES), ctrl.deleteReturn);

module.exports = router;