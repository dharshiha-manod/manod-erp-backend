/**
 * ====================================================
 * controllers/hrmController.js
 * Thin HTTP layer — validates input, calls hrmService,
 * returns structured JSON.  Mirrors purchaseController.js style.
 * ====================================================
 */

const svc = require('../services/hrmService');

const ok  = (res, data, status = 200) => res.status(status).json({ success: true,  ...data });
const err = (res, e,    status = 500) => {
  console.error('❌ HRM Error:', e.message);
  res.status(status).json({ success: false, error: e.message || 'Internal error' });
};

// ── DASHBOARD ────────────────────────────────────────────────
const getDashboardStats  = async (req, res) => { try { ok(res, { stats: await svc.fetchDashboardStats() }); } catch(e) { err(res,e); } };

// ── DEPARTMENTS ──────────────────────────────────────────────
const getDepartments     = async (req, res) => { try { ok(res, { departments: await svc.fetchDepartments() }); } catch(e) { err(res,e); } };
const createDepartment   = async (req, res) => { try { ok(res, { department: await svc.createDepartment(req.body) }, 201); } catch(e) { err(res,e,400); } };
const updateDepartment   = async (req, res) => { try { ok(res, { department: await svc.updateDepartment(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deleteDepartment   = async (req, res) => { try { await svc.deleteDepartment(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── DESIGNATIONS ─────────────────────────────────────────────
const getDesignations    = async (req, res) => { try { ok(res, { designations: await svc.fetchDesignations() }); } catch(e) { err(res,e); } };
const createDesignation  = async (req, res) => { try { ok(res, { designation: await svc.createDesignation(req.body) }, 201); } catch(e) { err(res,e,400); } };
const updateDesignation  = async (req, res) => { try { ok(res, { designation: await svc.updateDesignation(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deleteDesignation  = async (req, res) => { try { await svc.deleteDesignation(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── LEAVE TYPES ──────────────────────────────────────────────
const getLeaveTypes      = async (req, res) => { try { ok(res, { leaveTypes: await svc.fetchLeaveTypes() }); } catch(e) { err(res,e); } };
const createLeaveType    = async (req, res) => { try { ok(res, { leaveType: await svc.createLeaveType(req.body) }, 201); } catch(e) { err(res,e,400); } };
const updateLeaveType    = async (req, res) => { try { ok(res, { leaveType: await svc.updateLeaveType(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deleteLeaveType    = async (req, res) => { try { await svc.deleteLeaveType(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── LEAVES ───────────────────────────────────────────────────
const getLeaves          = async (req, res) => { try { ok(res, { leaves: await svc.fetchLeaves(req.query) }); } catch(e) { err(res,e); } };
const createLeave        = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    ok(res, { leave: await svc.createLeave(req.body, userId) }, 201);
  } catch(e) { err(res,e,400); }
};
const updateLeave        = async (req, res) => { try { ok(res, { leave: await svc.updateLeave(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const updateLeaveStatus  = async (req, res) => { try { ok(res, { leave: await svc.updateLeaveStatus(req.params.id, req.body.status) }); } catch(e) { err(res,e,400); } };
const deleteLeave        = async (req, res) => { try { await svc.deleteLeave(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── SHIFTS ───────────────────────────────────────────────────
const getShifts          = async (req, res) => { try { ok(res, { shifts: await svc.fetchShifts() }); } catch(e) { err(res,e); } };
const createShift        = async (req, res) => { try { ok(res, { shift: await svc.createShift(req.body) }, 201); } catch(e) { err(res,e,400); } };
const updateShift        = async (req, res) => { try { ok(res, { shift: await svc.updateShift(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deleteShift        = async (req, res) => { try { await svc.deleteShift(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── ATTENDANCE ───────────────────────────────────────────────
const getAttendance      = async (req, res) => { try { ok(res, { attendance: await svc.fetchAttendance(req.query) }); } catch(e) { err(res,e); } };
const getAttendanceStats = async (req, res) => { try { ok(res, { stats: await svc.fetchAttendanceStats() }); } catch(e) { err(res,e); } };
const clockIn            = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    ok(res, { record: await svc.clockIn(req.body, userId) }, 201);
  } catch(e) { err(res,e,400); }
};
const clockOut           = async (req, res) => { try { ok(res, { record: await svc.clockOut(req.params.id) }); } catch(e) { err(res,e,400); } };

// ── PAYROLL ──────────────────────────────────────────────────
const getPayrolls        = async (req, res) => { try { ok(res, { payrolls: await svc.fetchPayrolls(req.query) }); } catch(e) { err(res,e); } };
const createPayroll      = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || null;
    ok(res, { payroll: await svc.createPayroll(req.body, userId) }, 201);
  } catch(e) { err(res,e,400); }
};
const updatePayroll      = async (req, res) => { try { ok(res, { payroll: await svc.updatePayroll(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deletePayroll      = async (req, res) => { try { await svc.deletePayroll(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── PAY COMPONENTS ───────────────────────────────────────────
const getPayComponents   = async (req, res) => { try { ok(res, { components: await svc.fetchPayComponents() }); } catch(e) { err(res,e); } };
const createPayComponent = async (req, res) => { try { ok(res, { component: await svc.createPayComponent(req.body) }, 201); } catch(e) { err(res,e,400); } };
const updatePayComponent = async (req, res) => { try { ok(res, { component: await svc.updatePayComponent(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deletePayComponent = async (req, res) => { try { await svc.deletePayComponent(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── HOLIDAYS ─────────────────────────────────────────────────
const getHolidays        = async (req, res) => { try { ok(res, { holidays: await svc.fetchHolidays() }); } catch(e) { err(res,e); } };
const createHoliday      = async (req, res) => { try { ok(res, { holiday: await svc.createHoliday(req.body) }, 201); } catch(e) { err(res,e,400); } };
const updateHoliday      = async (req, res) => { try { ok(res, { holiday: await svc.updateHoliday(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deleteHoliday      = async (req, res) => { try { await svc.deleteHoliday(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── SALES TARGETS ────────────────────────────────────────────
const getSalesTargets    = async (req, res) => { try { ok(res, { targets: await svc.fetchSalesTargets(req.query) }); } catch(e) { err(res,e); } };
const createSalesTarget  = async (req, res) => { try { ok(res, { target: await svc.createSalesTarget(req.body) }, 201); } catch(e) { err(res,e,400); } };
const updateSalesTarget  = async (req, res) => { try { ok(res, { target: await svc.updateSalesTarget(req.params.id, req.body) }); } catch(e) { err(res,e,400); } };
const deleteSalesTarget  = async (req, res) => { try { await svc.deleteSalesTarget(req.params.id); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

module.exports = {
  getDashboardStats,
  getDepartments, createDepartment, updateDepartment, deleteDepartment,
  getDesignations, createDesignation, updateDesignation, deleteDesignation,
  getLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType,
  getLeaves, createLeave, updateLeave, updateLeaveStatus, deleteLeave,
  getShifts, createShift, updateShift, deleteShift,
  getAttendance, getAttendanceStats, clockIn, clockOut,
  getPayrolls, createPayroll, updatePayroll, deletePayroll,
  getPayComponents, createPayComponent, updatePayComponent, deletePayComponent,
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
  getSalesTargets, createSalesTarget, updateSalesTarget, deleteSalesTarget,
};