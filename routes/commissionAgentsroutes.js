/**
 * ====================================================
 * SALES COMMISSION AGENT ROUTES
 * /api/sales-commission-agents endpoints
 * ====================================================
 */

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const {
  getAllAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  getDashboardStats,
  recalculateCommissions
} = require('../controllers/commissionAgentController');

// ───────────────────────────────────────────────────
// PUBLIC ENDPOINTS (no permission check)
// ───────────────────────────────────────────────────

// ── GET /api/sales-commission-agents/stats ──
// Get dashboard statistics (aggregate data)
router.get('/stats', authenticateToken, getDashboardStats);

// ───────────────────────────────────────────────────
// PROTECTED ENDPOINTS (with permission checks)
// ───────────────────────────────────────────────────

// ── GET /api/sales-commission-agents ──
// Get all agents with pagination, search, filters
router.get('/', 
  authenticateToken, 
  requirePermission('Sales Commission', 'View agents'), 
  getAllAgents
);

// ── GET /api/sales-commission-agents/:id ──
// Get single agent by ID
router.get('/:id', 
  authenticateToken, 
  requirePermission('Sales Commission', 'View agents'), 
  getAgentById
);

// ── POST /api/sales-commission-agents ──
// Create new agent
router.post('/', 
  authenticateToken, 
  requirePermission('Sales Commission', 'Add agent'), 
  createAgent
);

// ── PUT /api/sales-commission-agents/:id ──
// Update agent
router.put('/:id', 
  authenticateToken, 
  requirePermission('Sales Commission', 'Edit agent'), 
  updateAgent
);

// ── DELETE /api/sales-commission-agents/:id ──
// Delete agent
router.delete('/:id', 
  authenticateToken, 
  requirePermission('Sales Commission', 'Delete agent'), 
  deleteAgent
);

// ── POST /api/sales-commission-agents/:id/recalculate ──
// Recalculate commission for an agent
router.post('/:id/recalculate', 
  authenticateToken, 
  requirePermission('Sales Commission', 'Edit agent'), 
  recalculateCommissions
);

module.exports = router;