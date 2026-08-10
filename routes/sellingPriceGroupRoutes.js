/**
 * ====================================================
 * SELLING PRICE GROUP ROUTES
 * /api/selling-price-groups
 * ====================================================
 */

const express = require('express');
const router  = express.Router();
const authenticateToken     = require('../middleware/auth');
const requireIndustry        = require('../middleware/industry');
const { requirePermission } = require('../middleware/permission');

const {
  getAllGroups, getGroupById, addGroup, editGroup, removeGroup,
} = require('../controllers/sellingPriceGroupController');

router.get   ('/',     authenticateToken, requireIndustry, requirePermission('Product','View product'),   getAllGroups);
router.post  ('/',     authenticateToken, requireIndustry, requirePermission('Product','Add product'),    addGroup);
router.get   ('/:id',  authenticateToken, requireIndustry, requirePermission('Product','View product'),   getGroupById);
router.put   ('/:id',  authenticateToken, requireIndustry, requirePermission('Product','Edit product'),   editGroup);
router.delete('/:id',  authenticateToken, requireIndustry, requirePermission('Product','Delete product'), removeGroup);

module.exports = router;