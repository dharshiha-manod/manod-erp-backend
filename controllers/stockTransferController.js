/**
 * ====================================================
 * controllers/stockTransferController.js
 * Thin HTTP layer — validates input, calls service,
 * returns structured JSON. Mirrors purchaseController.js style.
 * ====================================================
 */

const stockTransferService = require('../services/stockTransferService');
const { logActivity } = require('../services/activityLogService');

// ── GET ALL STOCK TRANSFERS (list with pagination + filters) ─────────────────
const getAllStockTransfers = async (req, res) => {
  try {
    const {
      page = 1, limit = 25, search = '',
      status = '', location_from = '', location_to = '',
      date_from = '', date_to = '',
    } = req.query;

    const { rows, total } = await stockTransferService.fetchAllStockTransfers({
      page, limit, search,
      status, location_from, location_to,
      date_from, date_to,
    });

    res.status(200).json({
      success: true,
      total,
      page:  parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      stockTransfers: rows,
    });
  } catch (err) {
    console.error('❌ Get All Stock Transfers Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stock transfers' });
  }
};

// ── GET SINGLE STOCK TRANSFER (with items) ────────────────────────────────────
const getStockTransferById = async (req, res) => {
  try {
    const stockTransfer = await stockTransferService.fetchStockTransferById(req.params.id);
    if (!stockTransfer) {
      return res.status(404).json({ success: false, error: 'Stock Transfer not found' });
    }
    res.status(200).json({ success: true, stockTransfer });
  } catch (err) {
    console.error('❌ Get Stock Transfer By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stock transfer' });
  }
};

// ── CREATE STOCK TRANSFER ─────────────────────────────────────────────────────
const createStockTransfer = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;

    if (!req.body.location_from || !req.body.location_to) {
      return res.status(400).json({ success: false, error: 'Both source and destination locations are required' });
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one product item is required' });
    }
    if (req.body.items.some((it) => !it.product_id && !it.id)) {
      return res.status(400).json({ success: false, error: 'Each item must reference a valid product' });
    }

const stockTransfer = await stockTransferService.createStockTransfer(req.body, userId);
    console.log(`✅ Stock Transfer created: ${stockTransfer.reference_no}`);
    logActivity({ userId, module: 'Stock Transfers', action: `Created Transfer ${stockTransfer.reference_no}`, detail: `${req.body.location_from} → ${req.body.location_to}`, req });
    res.status(201).json({
      success: true,
      message: 'Stock Transfer created successfully',
      stockTransfer,
   });
  } catch (err) {
    console.error('❌ Create Stock Transfer Error:', err.message);
    const status = err.message.includes('already exists') ? 409 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to create stock transfer' });
  }
};

// ── UPDATE STOCK TRANSFER ─────────────────────────────────────────────────────
const updateStockTransfer = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
   const stockTransfer = await stockTransferService.updateStockTransfer(req.params.id, req.body, userId);
    console.log(`✅ Stock Transfer updated: id ${req.params.id}`);
    logActivity({ userId, module: 'Stock Transfers', action: `Updated Transfer ${stockTransfer.reference_no || req.params.id}`, req });
    res.status(200).json({
      success: true,
      message: 'Stock Transfer updated successfully',
      stockTransfer,
    });
  } catch (err) {
    console.error('❌ Update Stock Transfer Error:', err.message);
    const status = err.message === 'Stock Transfer not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to update stock transfer' });
  }
};

// ── DELETE STOCK TRANSFER ─────────────────────────────────────────────────────
const deleteStockTransfer = async (req, res) => {
  try {
    const result = await stockTransferService.deleteStockTransfer(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Stock Transfer deleted successfully',
      deleted: result,
    });
  } catch (err) {
    console.error('❌ Delete Stock Transfer Error:', err.message);
    const status = err.message === 'Stock Transfer not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete stock transfer' });
  }
};

// ── DASHBOARD STATS ───────────────────────────────────────────────────────────
const getStats = async (req, res) => {
  try {
    const stats = await stockTransferService.getStockTransferStats();
    res.status(200).json({ success: true, stats });
  } catch (err) {
    console.error('❌ Get Stock Transfer Stats Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

// ── PRODUCTS DROPDOWN (for Add/Edit form item search) ─────────────────────────
const getProducts = async (req, res) => {
  try {
    const products = await stockTransferService.getProductsList();
    res.status(200).json({ success: true, products });
  } catch (err) {
    console.error('❌ Get Products Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch products' });
  }
};

module.exports = {
  getAllStockTransfers,
  getStockTransferById,
  createStockTransfer,
  updateStockTransfer,
  deleteStockTransfer,
  getStats,
  getProducts,
};