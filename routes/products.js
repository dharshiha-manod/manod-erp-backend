/**
 * ====================================================
 * PRODUCT ROUTES
 * /api/products  — Products, Brands, Units, Variations, Categories
 * ====================================================
 */

const express = require('express');
const router  = express.Router();
const authenticateToken  = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');

const {
  // Brands
  getAllBrands, getBrandById, addBrand, editBrand, removeBrand,
  // Units
  getAllUnits, getUnitById, addUnit, editUnit, removeUnit,
  // Variations
  getAllVariations, getVariationById, addVariation, editVariation, removeVariation,
  // Categories
  getAllCategories, getCategoryById, addCategory, editCategory, removeCategory,
  // Products
  getAllProducts, getProductById, addProduct, editProduct, removeProduct, toggleProductStatus,
} = require('../controllers/productController');

// ─────────────────────────────────────────────────────────────
// BRANDS   /api/products/brands
// ─────────────────────────────────────────────────────────────
router.get('/brands',
  authenticateToken,
  requirePermission('Product', 'View brands'),
  getAllBrands
);

router.get('/brands/:id',
  authenticateToken,
  requirePermission('Product', 'View brands'),
  getBrandById
);

router.post('/brands',
  authenticateToken,
  requirePermission('Product', 'Add brand'),
  addBrand
);

router.put('/brands/:id',
  authenticateToken,
  requirePermission('Product', 'Edit brand'),
  editBrand
);

router.delete('/brands/:id',
  authenticateToken,
  requirePermission('Product', 'Delete brand'),
  removeBrand
);

// ─────────────────────────────────────────────────────────────
// UNITS    /api/products/units
// ─────────────────────────────────────────────────────────────
router.get('/units',
  authenticateToken,
  requirePermission('Product', 'View units'),
  getAllUnits
);

router.get('/units/:id',
  authenticateToken,
  requirePermission('Product', 'View units'),
  getUnitById
);

router.post('/units',
  authenticateToken,
  requirePermission('Product', 'Add unit'),
  addUnit
);

router.put('/units/:id',
  authenticateToken,
  requirePermission('Product', 'Edit unit'),
  editUnit
);

router.delete('/units/:id',
  authenticateToken,
  requirePermission('Product', 'Delete unit'),
  removeUnit
);

// ─────────────────────────────────────────────────────────────
// VARIATIONS   /api/products/variations
// ─────────────────────────────────────────────────────────────
router.get('/variations',
  authenticateToken,
  requirePermission('Product', 'View variations'),
  getAllVariations
);

router.get('/variations/:id',
  authenticateToken,
  requirePermission('Product', 'View variations'),
  getVariationById
);

router.post('/variations',
  authenticateToken,
  requirePermission('Product', 'Add variation'),
  addVariation
);

router.put('/variations/:id',
  authenticateToken,
  requirePermission('Product', 'Edit variation'),
  editVariation
);

router.delete('/variations/:id',
  authenticateToken,
  requirePermission('Product', 'Delete variation'),
  removeVariation
);

// ─────────────────────────────────────────────────────────────
// CATEGORIES   /api/products/categories
// ─────────────────────────────────────────────────────────────
router.get('/categories',
  authenticateToken,
  requirePermission('Product', 'View categories'),
  getAllCategories
);

router.get('/categories/:id',
  authenticateToken,
  requirePermission('Product', 'View categories'),
  getCategoryById
);

router.post('/categories',
  authenticateToken,
  requirePermission('Product', 'Add category'),
  addCategory
);

router.put('/categories/:id',
  authenticateToken,
  requirePermission('Product', 'Edit category'),
  editCategory
);

router.delete('/categories/:id',
  authenticateToken,
  requirePermission('Product', 'Delete category'),
  removeCategory
);

// ─────────────────────────────────────────────────────────────
// PRODUCTS     /api/products
// Note: specific sub-routes (/brands, /units etc.) are defined
// ABOVE so they take precedence over /:id  — order matters!
// ─────────────────────────────────────────────────────────────
router.get('/',
  authenticateToken,
  requirePermission('Product', 'View product'),
  getAllProducts
);

router.get('/:id',
  authenticateToken,
  requirePermission('Product', 'View product'),
  getProductById
);

router.post('/',
  authenticateToken,
  requirePermission('Product', 'Add product'),
  addProduct
);

router.put('/:id',
  authenticateToken,
  requirePermission('Product', 'Edit product'),
  editProduct
);

router.patch('/:id/status',
  authenticateToken,
  requirePermission('Product', 'Edit product'),
  toggleProductStatus
);

router.delete('/:id',
  authenticateToken,
  requirePermission('Product', 'Delete product'),
  removeProduct
);

module.exports = router;