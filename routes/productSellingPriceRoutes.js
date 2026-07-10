/**
 * ====================================================
 * PRODUCT SELLING PRICE ROUTES
 * /api/product-selling-prices
 * ====================================================
 */

const express = require('express');
const router  = express.Router();
const authenticateToken     = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');

const {
  getPricesForProduct, setPricesForProduct, removePrice,
} = require('../controllers/productSellingPriceController');

router.get   ('/:productId',              authenticateToken, requirePermission('Product','View product'), getPricesForProduct);
router.put   ('/:productId',              authenticateToken, requirePermission('Product','Edit product'), setPricesForProduct);
router.delete('/:productId/:groupId',     authenticateToken, requirePermission('Product','Edit product'), removePrice);

module.exports = router;