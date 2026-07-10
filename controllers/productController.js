/**
 * ====================================================
 * PRODUCT CONTROLLER
 * Handles: Brands, Units, Variations, Categories, Products
 * ====================================================
 */

const {
  fetchAllBrands, fetchBrandById, createBrand, updateBrand, deleteBrand,
  fetchAllUnits, fetchUnitById, createUnit, updateUnit, deleteUnit,
  fetchAllVariations, fetchVariationById, createVariation, updateVariation, deleteVariation,
  fetchAllCategories, fetchCategoryById, createCategory, updateCategory, deleteCategory,
  fetchAllProducts, fetchProductById, createProduct, updateProduct, deleteProduct, updateProductStatus,
  fetchComponentEligibleProducts, fetchFinishedProducts,
} = require('../services/productService');

// ─────────────────────────────────────────────────────────────
// BRANDS
// ─────────────────────────────────────────────────────────────

const getAllBrands = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { brands, total } = await fetchAllBrands({ search, limit: parseInt(limit), offset });

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      brands
    });
  } catch (err) {
    console.error('❌ Get All Brands Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch brands' });
  }
};

const getBrandById = async (req, res) => {
  try {
    const brand = await fetchBrandById(req.params.id);
    if (!brand) return res.status(404).json({ success: false, error: 'Brand not found' });
    res.status(200).json({ success: true, brand });
  } catch (err) {
    console.error('❌ Get Brand Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch brand' });
  }
};

const addBrand = async (req, res) => {
  try {
    const brand = await createBrand(req.body);
    console.log('✅ Brand created:', brand.name);
    res.status(201).json({ success: true, message: 'Brand created successfully', brand });
  } catch (err) {
    console.error('❌ Create Brand Error:', err.message);
    const status = err.message.includes('required') || err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const editBrand = async (req, res) => {
  try {
    const brand = await updateBrand(req.params.id, req.body);
    console.log('✅ Brand updated:', brand.name);
    res.status(200).json({ success: true, message: 'Brand updated successfully', brand });
  } catch (err) {
    console.error('❌ Update Brand Error:', err.message);
    const status = err.message.includes('not found') ? 404 : err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removeBrand = async (req, res) => {
  try {
    const brand = await deleteBrand(req.params.id);
    console.log('✅ Brand deleted:', brand.name);
    res.status(200).json({ success: true, message: 'Brand deleted successfully', brand });
  } catch (err) {
    console.error('❌ Delete Brand Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// UNITS
// ─────────────────────────────────────────────────────────────

const getAllUnits = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { units, total } = await fetchAllUnits({ search, limit: parseInt(limit), offset });

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      units
    });
  } catch (err) {
    console.error('❌ Get All Units Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch units' });
  }
};

const getUnitById = async (req, res) => {
  try {
    const unit = await fetchUnitById(req.params.id);
    if (!unit) return res.status(404).json({ success: false, error: 'Unit not found' });
    res.status(200).json({ success: true, unit });
  } catch (err) {
    console.error('❌ Get Unit Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch unit' });
  }
};

const addUnit = async (req, res) => {
  try {
    const unit = await createUnit(req.body);
    console.log('✅ Unit created:', unit.name);
    res.status(201).json({ success: true, message: 'Unit created successfully', unit });
  } catch (err) {
    console.error('❌ Create Unit Error:', err.message);
    const status = err.message.includes('required') || err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const editUnit = async (req, res) => {
  try {
    const unit = await updateUnit(req.params.id, req.body);
    console.log('✅ Unit updated:', unit.name);
    res.status(200).json({ success: true, message: 'Unit updated successfully', unit });
  } catch (err) {
    console.error('❌ Update Unit Error:', err.message);
    const status = err.message.includes('not found') ? 404 : err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removeUnit = async (req, res) => {
  try {
    const unit = await deleteUnit(req.params.id);
    console.log('✅ Unit deleted:', unit.name);
    res.status(200).json({ success: true, message: 'Unit deleted successfully', unit });
  } catch (err) {
    console.error('❌ Delete Unit Error:', err.message);
    const status = err.message.includes('not found') ? 404 : err.message.includes('Cannot delete') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// VARIATIONS
// ─────────────────────────────────────────────────────────────

const getAllVariations = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { variations, total } = await fetchAllVariations({ search, limit: parseInt(limit), offset });

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      variations
    });
  } catch (err) {
    console.error('❌ Get All Variations Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch variations' });
  }
};

const getVariationById = async (req, res) => {
  try {
    const variation = await fetchVariationById(req.params.id);
    if (!variation) return res.status(404).json({ success: false, error: 'Variation not found' });
    res.status(200).json({ success: true, variation });
  } catch (err) {
    console.error('❌ Get Variation Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch variation' });
  }
};

const addVariation = async (req, res) => {
  try {
    const variation = await createVariation(req.body);
    console.log('✅ Variation created:', variation.name);
    res.status(201).json({ success: true, message: 'Variation created successfully', variation });
  } catch (err) {
    console.error('❌ Create Variation Error:', err.message);
    const status = err.message.includes('required') || err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const editVariation = async (req, res) => {
  try {
    const variation = await updateVariation(req.params.id, req.body);
    console.log('✅ Variation updated:', variation.name);
    res.status(200).json({ success: true, message: 'Variation updated successfully', variation });
  } catch (err) {
    console.error('❌ Update Variation Error:', err.message);
    const status = err.message.includes('not found') ? 404 : err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removeVariation = async (req, res) => {
  try {
    const variation = await deleteVariation(req.params.id);
    console.log('✅ Variation deleted:', variation.name);
    res.status(200).json({ success: true, message: 'Variation deleted successfully', variation });
  } catch (err) {
    console.error('❌ Delete Variation Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// CATEGORIES
// ─────────────────────────────────────────────────────────────

const getAllCategories = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { categories, total } = await fetchAllCategories({ search, limit: parseInt(limit), offset });

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      categories
    });
  } catch (err) {
    console.error('❌ Get All Categories Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch categories' });
  }
};

const getCategoryById = async (req, res) => {
  try {
    const category = await fetchCategoryById(req.params.id);
    if (!category) return res.status(404).json({ success: false, error: 'Category not found' });
    res.status(200).json({ success: true, category });
  } catch (err) {
    console.error('❌ Get Category Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch category' });
  }
};

const addCategory = async (req, res) => {
  try {
    const category = await createCategory(req.body);
    console.log('✅ Category created:', category.name);
    res.status(201).json({ success: true, message: 'Category created successfully', category });
  } catch (err) {
    console.error('❌ Create Category Error:', err.message);
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const editCategory = async (req, res) => {
  try {
    const category = await updateCategory(req.params.id, req.body);
    console.log('✅ Category updated:', category.name);
    res.status(200).json({ success: true, message: 'Category updated successfully', category });
  } catch (err) {
    console.error('❌ Update Category Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removeCategory = async (req, res) => {
  try {
    const category = await deleteCategory(req.params.id);
    console.log('✅ Category deleted:', category.name);
    res.status(200).json({ success: true, message: 'Category deleted successfully', category });
  } catch (err) {
    console.error('❌ Delete Category Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────────────────────

const getAllProducts = async (req, res) => {
  try {
    const {
      page = 1, limit = 25,
      search = '', status = '',
      category_id = '', brand_id = ''
    } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const { products, total } = await fetchAllProducts({
      search, status, category_id, brand_id,
      limit: parseInt(limit), offset
    });

    res.status(200).json({
      success: true,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      products
    });
  } catch (err) {
    console.error('❌ Get All Products Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch products' });
  }
};

const getProductById = async (req, res) => {
  try {
    const product = await fetchProductById(req.params.id);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    res.status(200).json({ success: true, product });
  } catch (err) {
    console.error('❌ Get Product Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch product' });
  }
};

const addProduct = async (req, res) => {
  try {
    const product = await createProduct(req.body);
    console.log('✅ Product created:', product.name);
    res.status(201).json({ success: true, message: 'Product created successfully', product });
  } catch (err) {
    console.error('❌ Create Product Error:', err.message);
    const status = err.message.includes('required') || err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const editProduct = async (req, res) => {
  try {
    const product = await updateProduct(req.params.id, req.body);
    console.log('✅ Product updated:', product.name);
    res.status(200).json({ success: true, message: 'Product updated successfully', product });
  } catch (err) {
    console.error('❌ Update Product Error:', err.message);
    const status = err.message.includes('not found') ? 404 : err.message.includes('already') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removeProduct = async (req, res) => {
  try {
    const product = await deleteProduct(req.params.id);
    console.log('✅ Product deleted:', product.name);
    res.status(200).json({ success: true, message: 'Product deleted successfully', product });
  } catch (err) {
    console.error('❌ Delete Product Error:', err.message);
    const status = err.message.includes('not found') ? 404
      : err.message.includes('Cannot delete') ? 409
      : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const toggleProductStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const product = await updateProductStatus(req.params.id, status);
    console.log('✅ Product status updated:', product.name, '->', product.status);
    res.status(200).json({ success: true, message: 'Product status updated', product });
  } catch (err) {
    console.error('❌ Update Product Status Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
};

module.exports = {
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
};