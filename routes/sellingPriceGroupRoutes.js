/**
 * ====================================================
 * SELLING PRICE GROUP ROUTES
 * /api/selling-price-groups
 * ====================================================
 */

const express = require('express');
const router  = express.Router();
const authenticateToken     = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');

const {
  getAllGroups, getGroupById, addGroup, editGroup, removeGroup,
} = require('../controllers/sellingPriceGroupController');

router.get   ('/',     authenticateToken, requirePermission('Product','View product'),   getAllGroups);
router.post  ('/',     authenticateToken, requirePermission('Product','Add product'),    addGroup);
router.get   ('/:id',  authenticateToken, requirePermission('Product','View product'),   getGroupById);
router.put   ('/:id',  authenticateToken, requirePermission('Product','Edit product'),   editGroup);
router.delete('/:id',  authenticateToken, requirePermission('Product','Delete product'), removeGroup);

module.exports = router;