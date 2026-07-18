/**
 * ====================================================
 * controllers/purchaseController.js
 * Thin HTTP layer — validates input, calls service,
 * returns structured JSON. Mirrors contactController.js style.
 * ====================================================
 */

const purchaseService = require('../services/purchaseService');
const { logActivity }  = require('../services/activityLogService');

// ── GET ALL PURCHASES (list with pagination + filters) ───────────────────────
const getAllPurchases = async (req, res) => {
  try {
    const {
      page = 1, limit = 25, search = '',
      supplier_id = '', purchase_status = '', payment_status = '',
      date_from = '', date_to = '', location = '',
    } = req.query;

    const { rows, total } = await purchaseService.fetchAllPurchases({
      page, limit, search,
      supplier_id, purchase_status, payment_status,
      date_from, date_to, location,
    });

    res.status(200).json({
      success: true,
      total,
      page:  parseInt(page, 10),
      limit: parseInt(limit, 10),
      pages: Math.ceil(total / parseInt(limit, 10)),
      purchases: rows,
    });
  } catch (err) {
    console.error('❌ Get All Purchases Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch purchases' });
  }
};

// ── GET SINGLE PURCHASE (with items + payments) ──────────────────────────────
const getPurchaseById = async (req, res) => {
  try {
    const purchase = await purchaseService.fetchPurchaseById(req.params.id);
    if (!purchase) {
      return res.status(404).json({ success: false, error: 'Purchase not found' });
    }
    res.status(200).json({ success: true, purchase });
  } catch (err) {
    console.error('❌ Get Purchase By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch purchase' });
  }
};

// ── CREATE PURCHASE ──────────────────────────────────────────────────────────
const createPurchase = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;

    if (!req.body.purchase_status) {
      return res.status(400).json({ success: false, error: 'Purchase status is required' });
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one product item is required' });
    }

  const purchase = await purchaseService.createPurchase(req.body, userId);
    console.log(`✅ Purchase created: ${purchase.reference_no}`);
    logActivity({ userId, module: 'Purchases', action: `Created Purchase ${purchase.reference_no}`, detail: `Status: ${purchase.purchase_status}`, req });
    res.status(201).json({
      success: true,
      message: 'Purchase created successfully',
      purchase,
    });
  } catch (err) {
    console.error('❌ Create Purchase Error:', err.message);
    const status = err.message.includes('already exists') ? 409 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to create purchase' });
  }
};

// ── UPDATE PURCHASE ──────────────────────────────────────────────────────────
const updatePurchase = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
   const purchase = await purchaseService.updatePurchase(req.params.id, req.body, userId);
    console.log(`✅ Purchase updated: id ${req.params.id}`);
    logActivity({ userId, module: 'Purchases', action: `Updated Purchase ${purchase.reference_no || req.params.id}`, req });
    res.status(200).json({
      success: true,
      message: 'Purchase updated successfully',
      purchase,
    });
  } catch (err) {
    console.error('❌ Update Purchase Error:', err.message);
    const status = err.message === 'Purchase not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to update purchase' });
  }
};

// ── DELETE PURCHASE ──────────────────────────────────────────────────────────
const deletePurchase = async (req, res) => {
  try {
    const result = await purchaseService.deletePurchase(req.params.id);
    res.status(200).json({
      success: true,
      message: 'Purchase deleted successfully',
      deleted: result,
    });
  } catch (err) {
    console.error('❌ Delete Purchase Error:', err.message);
    const status = err.message === 'Purchase not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete purchase' });
  }
};

// ── ADD PAYMENT ──────────────────────────────────────────────────────────────
const addPayment = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    const { id: purchaseId } = req.params;

    if (!req.body.amount || parseFloat(req.body.amount) <= 0) {
      return res.status(400).json({ success: false, error: 'Valid payment amount is required' });
    }

    const payment = await purchaseService.addPayment(purchaseId, req.body, userId);
    res.status(201).json({
      success: true,
      message: 'Payment recorded successfully',
      payment,
    });
  } catch (err) {
    console.error('❌ Add Payment Error:', err.message);
    const status = err.message === 'Purchase not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to add payment' });
  }
};

// ── DELETE PAYMENT ───────────────────────────────────────────────────────────
const deletePayment = async (req, res) => {
  try {
    const { id: purchaseId, paymentId } = req.params;
    const result = await purchaseService.deletePayment(purchaseId, paymentId);
    res.status(200).json({
      success: true,
      message: 'Payment deleted successfully',
      deleted: result,
    });
  } catch (err) {
    console.error('❌ Delete Payment Error:', err.message);
    const status = err.message === 'Payment not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete payment' });
  }
};

// ── DASHBOARD STATS ──────────────────────────────────────────────────────────
const getStats = async (req, res) => {
  try {
    const stats = await purchaseService.getPurchaseStats();
    res.status(200).json({ success: true, stats });
  } catch (err) {
    console.error('❌ Get Purchase Stats Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

// ── SUPPLIERS DROPDOWN ───────────────────────────────────────────────────────
const getSuppliers = async (req, res) => {
  try {
    const suppliers = await purchaseService.getSuppliersList();
    res.status(200).json({ success: true, suppliers });
  } catch (err) {
    console.error('❌ Get Suppliers Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch suppliers' });
  }
};

// ── PRODUCTS SEARCH (for Add Purchase product dropdown) ──────────────────────
const searchProducts = async (req, res) => {
  try {
    const products = await purchaseService.searchProducts(req.query.q || '');
    res.status(200).json({ success: true, products: products || [] });
  } catch (err) {
    console.error('❌ Search Products Error:', err.message);
    // Return empty array instead of 500 so frontend still works
    res.status(200).json({ success: true, products: [] });
  }
};

module.exports = {
  getAllPurchases,
  getPurchaseById,
  createPurchase,
  updatePurchase,
  deletePurchase,
  addPayment,
  deletePayment,
  getStats,
  getSuppliers,
  searchProducts,
};