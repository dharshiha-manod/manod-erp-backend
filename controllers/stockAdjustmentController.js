/**
 * controllers/stockAdjustmentController.js
 */

'use strict';

const svc = require('../services/stockAdjustmentService');
const { logActivity } = require('../services/activityLogService');

const getAllAdjustments = async (req, res) => {
  try {
    const { page = 1, limit = 25, search = '', status = '', adjustment_type = '', location = '', date_from = '', date_to = '' } = req.query;
    const { rows, total } = await svc.fetchAllAdjustments({ page, limit, search, status, adjustment_type, location, date_from, date_to });
    res.json({ success: true, total, page: +page, limit: +limit, pages: Math.ceil(total / +limit), stockAdjustments: rows });
  } catch (err) {
    console.error('getAllAdjustments:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stock adjustments' });
  }
};

const getAdjustmentById = async (req, res) => {
  try {
    const adj = await svc.fetchAdjustmentById(req.params.id);
    if (!adj) return res.status(404).json({ success: false, error: 'Stock Adjustment not found' });
    res.json({ success: true, stockAdjustment: adj });
  } catch (err) {
    console.error('getAdjustmentById:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch stock adjustment' });
  }
};

const createAdjustment = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    if (!req.body.location)
      return res.status(400).json({ success: false, error: 'Business location is required' });
    if (!req.body.adjustment_type)
      return res.status(400).json({ success: false, error: 'Adjustment type is required' });
    if (!Array.isArray(req.body.items) || req.body.items.length === 0)
      return res.status(400).json({ success: false, error: 'At least one product item is required' });

   const adj = await svc.createAdjustment(req.body, userId);
    logActivity({ userId, module: 'Stock', action: `Created Adjustment ${adj.reference_no || adj.id}`, detail: `Type: ${req.body.adjustment_type}`, req });
    res.status(201).json({ success: true, message: 'Stock Adjustment created successfully', stockAdjustment: adj });
  } catch (err) {
    console.error('createAdjustment:', err.message);
    res.status(err.message.includes('already exists') ? 409 : 400).json({ success: false, error: err.message });
  }
};

const updateAdjustment = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    const adj    = await svc.updateAdjustment(req.params.id, req.body, userId);
    res.json({ success: true, message: 'Stock Adjustment updated successfully', stockAdjustment: adj });
  } catch (err) {
    console.error('updateAdjustment:', err.message);
    res.status(err.message === 'Stock Adjustment not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const deleteAdjustment = async (req, res) => {
  try {
    const result = await svc.deleteAdjustment(req.params.id);
    res.json({ success: true, message: 'Stock Adjustment deleted successfully', deleted: result });
  } catch (err) {
    console.error('deleteAdjustment:', err.message);
    res.status(err.message === 'Stock Adjustment not found' ? 404 : 500).json({ success: false, error: err.message });
  }
};

const approveAdjustment = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
const adj    = await svc.approveAdjustment(req.params.id, userId);
    logActivity({ userId, module: 'Stock', action: `Approved Adjustment ${adj.reference_no || req.params.id}`, req });
    res.json({ success: true, message: 'Stock Adjustment approved and stock updated', stockAdjustment: adj });
  } catch (err) {
    console.error('approveAdjustment:', err.message);
    res.status(err.message === 'Stock Adjustment not found' ? 404 : 400).json({ success: false, error: err.message });
  }
};

const getStats = async (req, res) => {
  try {
    const stats = await svc.getAdjustmentStats();
    res.json({ success: true, stats });
  } catch (err) {
    console.error('getStats:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch statistics' });
  }
};

const getProducts = async (req, res) => {
  try {
    const products = await svc.getProductsList(req.query.search || '');
    res.json({ success: true, products });
  } catch (err) {
    console.error('getProducts:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch products' });
  }
};

const getLocations = async (req, res) => {
  try {
    const locations = await svc.getLocations();
    res.json({ success: true, locations });
  } catch (err) {
    console.error('getLocations:', err.message);
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
