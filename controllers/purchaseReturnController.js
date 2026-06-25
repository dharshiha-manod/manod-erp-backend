/**
 * ====================================================
 * controllers/purchaseReturnController.js
 * Thin HTTP layer for Purchase Returns.
 * ====================================================
 */

const service = require('../services/purchaseReturnService');

// GET /api/purchase-returns
const getAllReturns = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '', supplier_id = '', date_from = '', date_to = '' } = req.query;
    const { rows, total } = await service.fetchAllReturns({ page, limit, search, supplier_id, date_from, date_to });
    res.status(200).json({
      success: true,
      total,
      page: parseInt(page, 10),
      limit: parseInt(limit, 10),
      returns: rows,
    });
  } catch (err) {
    console.error('❌ Get All Purchase Returns Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch purchase returns' });
  }
};

// GET /api/purchase-returns/:id
const getReturnById = async (req, res) => {
  try {
    const ret = await service.fetchReturnById(req.params.id);
    if (!ret) return res.status(404).json({ success: false, error: 'Purchase return not found' });
    res.status(200).json({ success: true, purchaseReturn: ret });
  } catch (err) {
    console.error('❌ Get Purchase Return By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch purchase return' });
  }
};

// POST /api/purchase-returns
const createReturn = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    if (!req.body.supplier_id && !req.body.supplier_name) {
      return res.status(400).json({ success: false, error: 'Supplier is required' });
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      return res.status(400).json({ success: false, error: 'At least one product item is required' });
    }
    const ret = await service.createReturn(req.body, userId);
    res.status(201).json({ success: true, message: 'Purchase return created', purchaseReturn: ret });
  } catch (err) {
    console.error('❌ Create Purchase Return Error:', err.message);
    const status = err.message.includes('already exists') ? 409 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to create purchase return' });
  }
};

// PUT /api/purchase-returns/:id
const updateReturn = async (req, res) => {
  try {
    const ret = await service.updateReturn(req.params.id, req.body);
    res.status(200).json({ success: true, message: 'Purchase return updated', purchaseReturn: ret });
  } catch (err) {
    console.error('❌ Update Purchase Return Error:', err.message);
    const status = err.message === 'Purchase return not found' ? 404 : 400;
    res.status(status).json({ success: false, error: err.message || 'Failed to update purchase return' });
  }
};

// DELETE /api/purchase-returns/:id
const deleteReturn = async (req, res) => {
  try {
    const result = await service.deleteReturn(req.params.id);
    res.status(200).json({ success: true, message: 'Purchase return deleted', deleted: result });
  } catch (err) {
    console.error('❌ Delete Purchase Return Error:', err.message);
    const status = err.message === 'Purchase return not found' ? 404 : 500;
    res.status(status).json({ success: false, error: err.message || 'Failed to delete purchase return' });
  }
};

module.exports = { getAllReturns, getReturnById, createReturn, updateReturn, deleteReturn };