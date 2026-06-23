/**
 * ====================================================
 * WARRANTY + STOCK CONTROLLER
 * ====================================================
 */

const {
  fetchAllWarranties, fetchWarrantyById,
  createWarranty, updateWarranty, deleteWarranty,
  setOpeningStock,
} = require('../services/warrantyStockService');

// ─────────────────────────────────────────────────────────────
// WARRANTIES
// ─────────────────────────────────────────────────────────────

const getAllWarranties = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '' } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const { warranties, total } = await fetchAllWarranties({ search, limit: parseInt(limit), offset });
    res.status(200).json({
      success: true, total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      warranties
    });
  } catch (err) {
    console.error('❌ Get All Warranties Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch warranties' });
  }
};

const getWarrantyById = async (req, res) => {
  try {
    const warranty = await fetchWarrantyById(req.params.id);
    if (!warranty) return res.status(404).json({ success: false, error: 'Warranty not found' });
    res.status(200).json({ success: true, warranty });
  } catch (err) {
    console.error('❌ Get Warranty Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch warranty' });
  }
};

const addWarranty = async (req, res) => {
  try {
    const warranty = await createWarranty(req.body);
    console.log('✅ Warranty created:', warranty.name);
    res.status(201).json({ success: true, message: 'Warranty created successfully', warranty });
  } catch (err) {
    console.error('❌ Create Warranty Error:', err.message);
    const status = err.message.includes('required') ? 400 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

const editWarranty = async (req, res) => {
  try {
    const warranty = await updateWarranty(req.params.id, req.body);
    console.log('✅ Warranty updated:', warranty.name);
    res.status(200).json({ success: true, message: 'Warranty updated successfully', warranty });
  } catch (err) {
    console.error('❌ Update Warranty Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
};

const removeWarranty = async (req, res) => {
  try {
    const warranty = await deleteWarranty(req.params.id);
    console.log('✅ Warranty deleted:', warranty.name);
    res.status(200).json({ success: true, message: 'Warranty deleted successfully', warranty });
  } catch (err) {
    console.error('❌ Delete Warranty Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// ─────────────────────────────────────────────────────────────
// STOCK
// ─────────────────────────────────────────────────────────────

const updateStock = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, type, unit_cost } = req.body;

    if (quantity === undefined || quantity === null) {
      return res.status(400).json({ success: false, error: 'Quantity is required' });
    }

    const product = await setOpeningStock(id, { quantity, type, unit_cost });
    console.log(`✅ Stock updated for product ${id}: qty=${quantity}`);
    res.status(200).json({ success: true, message: 'Stock updated successfully', product });
  } catch (err) {
    console.error('❌ Update Stock Error:', err.message);
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
};

module.exports = {
  getAllWarranties, getWarrantyById, addWarranty, editWarranty, removeWarranty,
  updateStock,
};