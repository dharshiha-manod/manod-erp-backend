/**
 * ====================================================
 * CONTACT ROUTES
 * /api/contacts  and  /api/customer-groups
 * ====================================================
 */

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl = require('../controllers/contactController');

// ── Permission groups used here match featurePermissionMap.js on the frontend ──
const VIEW_CONTACTS = [
  ['Customer', 'View all customer'], ['Customer', 'View own customer'],
  ['Supplier', 'View all supplier'], ['Supplier', 'View own supplier'],
];
const ADD_CONTACTS = [['Customer', 'Add customer'], ['Supplier', 'Add supplier']];
const EDIT_CONTACTS = [['Customer', 'Edit customer'], ['Supplier', 'Edit supplier']];
const DELETE_CONTACTS = [['Customer', 'Delete customer'], ['Supplier', 'Delete supplier']];

// ── Dashboard stats ──
router.get('/stats', authenticateToken, requireAnyPermission(VIEW_CONTACTS), ctrl.getStats);

// ── Customer Groups (must come before /:id) ──
router.get('/groups', authenticateToken, requireAnyPermission(VIEW_CONTACTS), ctrl.getAllGroups);
router.post('/groups', authenticateToken, requireAnyPermission(ADD_CONTACTS), ctrl.createGroup);
router.put('/groups/:id', authenticateToken, requireAnyPermission(EDIT_CONTACTS), ctrl.updateGroup);
router.delete('/groups/:id', authenticateToken, requireAnyPermission(DELETE_CONTACTS), ctrl.deleteGroup);

// ── Import ──
router.post('/import', authenticateToken, requireAnyPermission(ADD_CONTACTS), ctrl.importContacts);

// ── CRUD ──
router.get('/', authenticateToken, requireAnyPermission(VIEW_CONTACTS), ctrl.getAllContacts);
router.get('/:id/pricing-info', authenticateToken, requireAnyPermission(VIEW_CONTACTS), ctrl.getCustomerPricingInfo);
router.get('/:id', authenticateToken, requireAnyPermission(VIEW_CONTACTS), ctrl.getContactById);
router.post('/', authenticateToken, requireAnyPermission(ADD_CONTACTS), ctrl.createContact);
router.put('/:id', authenticateToken, requireAnyPermission(EDIT_CONTACTS), ctrl.updateContact);
router.delete('/:id', authenticateToken, requireAnyPermission(DELETE_CONTACTS), ctrl.deleteContact);

module.exports = router;