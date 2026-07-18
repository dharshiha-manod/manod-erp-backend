'use strict';
const registerService = require('../services/registerService');

const ok = (res, data) => res.status(200).json({ success: true, data });
const err = (res, e, msg = 'Server error') => {
  console.error('[RegisterController]', msg, e?.message || e);
  res.status(400).json({ success: false, message: e?.message || msg });
};

const openShift = async (req, res) => {
  try {
    const data = await registerService.openSession({ ...req.body, cashier_id: req.body.cashier_id || req.user?.id });
    res.status(201).json({ success: true, data });
  } catch (e) { err(res, e, 'Failed to open shift'); }
};

const closeShift = async (req, res) => {
  try {
    const data = await registerService.closeSession(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, 'Failed to close shift'); }
};

const addCashMovement = async (req, res) => {
  try {
    const data = await registerService.addCashMovement(req.params.id, req.body);
    ok(res, data);
  } catch (e) { err(res, e, 'Failed to record cash movement'); }
};

const getOpenShift = async (req, res) => {
  try {
    const cashierId = req.query.cashier_id || req.user?.id;
    const data = await registerService.getOpenSessionForCashier(cashierId);
    ok(res, data);
  } catch (e) { err(res, e, 'Failed to fetch open shift'); }
};

module.exports = { openShift, closeShift, addCashMovement, getOpenShift };