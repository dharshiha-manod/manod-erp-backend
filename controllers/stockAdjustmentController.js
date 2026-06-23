/**
 * ====================================================
 * controllers/stockAdjustmentController.js
 * Thin HTTP layer — validates input, calls service,
 * returns structured JSON. Mirrors stockTransferController.js style.
 * ====================================================
 */

const svc = require('../services/stockAdjustmentService');

// ── GET ALL  (paginated + filters) ───────────────────────────────────────────
const getAllAdjustments = async (req, res) => {
  try {
    const {
      page = 1, limit = 25, search = '',
      status = '', adjustment_type = '', location = '',
      date_from = '', date_to = '',
    } = req.query;

    const { rows, total } = await svc.fetchAllAdjustments({
      page, limit, search,
      status, adjustment_type, location,
      date_from, date_to,
    });

    res.status(200).json({
      success: true,
      total,
      page:  parseInt(page,  10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      stockAdjustments: rows,
    });
  } catch (err) {
    console.error('❌ Get All Adjustments Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stock adjustments' });
  }
};

// ── GET SINGLE  (with items) ──────────────────────────────────────────────────
const getAdjustmentById = async (req, res) => {
  try {
    const adj = await svc.fetchAdjustmentById(req.params.id);
    if (!adj) {
      return res.status(404).json({ success: false, error: 'Stock Adjustment not found' });
    }
    res.status(200).json({ success: true, stockAdjustment: adj });
  } catch (err) {
    console.error('❌ Get Adjustment By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stock adjustment' });
  }
};

// ── CREATE ────────────────────────────────────────────────────────────────────
const createAdjustment = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;

    if (!req.body.location) {
      return res.status(400).json({ success: false, error: 'Business location is required' });
    }
    if (!req.body.adjustment_type) {
      return res.status(400).json({ success: false, error: 'Adjustment type is required' });
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one product item is required' });
    }

    const adj = await svc.createAdjustment(req.body, userId);
    console.log(`✅ Stock Adjustment created: ${adj.adjustment_number}`);
    res.status(201).json({
      success:  true,
      message:  'Stock Adjustment created successfully',
      stockAdjustment: adj,
    });
  } catch (err) {
    console.error('❌ Create Adjustment Error:', err.message);
    const status = err.message.includes('already exists') ? 409 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to create stock adjustment' });
  }
};

// ── UPDATE ────────────────────────────────────────────────────────────────────
const updateAdjustment = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    const adj    = await svc.updateAdjustment(req.params.id, req.body, userId);
    console.log(`✅ Stock Adjustment updated: id ${req.params.id}`);
    res.status(200).json({
      success:  true,
      message:  'Stock Adjustment updated successfully',
      stockAdjustment: adj,
    });
  } catch (err) {
    console.error('❌ Update Adjustment Error:', err.message);
    const status = err.message === 'Stock Adjustment not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to update stock adjustment' });
  }
};

// ── DELETE ────────────────────────────────────────────────────────────────────
const deleteAdjustment = async (req, res) => {
  try {
    const result = await svc.deleteAdjustment(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Stock Adjustment deleted successfully',
      deleted: result,
    });
  } catch (err) {
    console.error('❌ Delete Adjustment Error:', err.message);
    const status = err.message === 'Stock Adjustment not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete stock adjustment' });
  }
};

// ── APPROVE  (one-click complete + stock deduction) ───────────────────────────
const approveAdjustment = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    const adj    = await svc.approveAdjustment(req.params.id, userId);
    console.log(`✅ Stock Adjustment approved: id ${req.params.id}`);
    res.status(200).json({
      success:  true,
      message:  'Stock Adjustment approved and stock updated',
      stockAdjustment: adj,
    });
  } catch (err) {
    console.error('❌ Approve Adjustment Error:', err.message);
    const status = err.message === 'Stock Adjustment not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to approve stock adjustment' });
  }
};

// ── STATS ─────────────────────────────────────────────────────────────────────
const getStats = async (req, res) => {
  try {
    const stats = await svc.getAdjustmentStats();
    res.status(200).json({ success: true, stats });
  } catch (err) {
    console.error('❌ Get Stats Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

// ── PRODUCTS DROPDOWN ─────────────────────────────────────────────────────────
const getProducts = async (req, res) => {
  try {
    const products = await svc.getProductsList(req.query.search || '');
    res.status(200).json({ success: true, products });
  } catch (err) {
    console.error('❌ Get Products Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch products' });
  }
};

// ── LOCATIONS DROPDOWN ────────────────────────────────────────────────────────
const getLocations = async (req, res) => {
  try {
    const locations = await svc.getLocations();
    res.status(200).json({ success: true, locations });
  } catch (err) {
    console.error('❌ Get Locations Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch locations' });
  }
};

module.exports = {
  getAllAdjustments,
  getAdjustmentById,
  createAdjustment,
  updateAdjustment,
  deleteAdjustment,
  approveAdjustment,
  getStats,
  getProducts,
  getLocations,
};