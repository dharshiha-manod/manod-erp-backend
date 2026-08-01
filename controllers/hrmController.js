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
const getUser = (req) => ({
  userId: req.user?.id || req.user?.userId || null,
  userName: req.user?.name || req.user?.full_name || req.user?.username || req.user?.email || null,
});

// ── DASHBOARD ────────────────────────────────────────────────
const getDashboardStats  = async (req, res) => { try { ok(res, { stats: await svc.fetchDashboardStats() }); } catch(e) { err(res,e); } };

// ── DEPARTMENTS ──────────────────────────────────────────────
const getDepartments     = async (req, res) => { try { ok(res, { departments: await svc.fetchDepartments() }); } catch(e) { err(res,e); } };
const createDepartment   = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { department: await svc.createDepartment(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateDepartment   = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { department: await svc.updateDepartment(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteDepartment   = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteDepartment(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── DESIGNATIONS ─────────────────────────────────────────────
const getDesignations    = async (req, res) => { try { ok(res, { designations: await svc.fetchDesignations() }); } catch(e) { err(res,e); } };
const createDesignation  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { designation: await svc.createDesignation(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateDesignation  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { designation: await svc.updateDesignation(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteDesignation  = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteDesignation(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── LEAVE TYPES ──────────────────────────────────────────────
const getLeaveTypes      = async (req, res) => { try { ok(res, { leaveTypes: await svc.fetchLeaveTypes() }); } catch(e) { err(res,e); } };
const createLeaveType    = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leaveType: await svc.createLeaveType(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateLeaveType    = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leaveType: await svc.updateLeaveType(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteLeaveType    = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteLeaveType(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── LEAVES ───────────────────────────────────────────────────
const getLeaves          = async (req, res) => { try { ok(res, { leaves: await svc.fetchLeaves(req.query) }); } catch(e) { err(res,e); } };
const createLeave        = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    const body = { ...req.body, employee_name: req.body.employee_name || userName };
    ok(res, { leave: await svc.createLeave(body, userId, userName) }, 201);
  } catch(e) { err(res,e,400); }
};
const updateLeave        = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leave: await svc.updateLeave(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const updateLeaveStatus  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leave: await svc.updateLeaveStatus(req.params.id, req.body.status, userId, userName, req.body.remarks) }); } catch(e) { err(res,e,400); } };
const deleteLeave        = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteLeave(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── SHIFTS ───────────────────────────────────────────────────
const getShifts          = async (req, res) => { try { ok(res, { shifts: await svc.fetchShifts() }); } catch(e) { err(res,e); } };
const createShift        = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { shift: await svc.createShift(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateShift        = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { shift: await svc.updateShift(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteShift        = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteShift(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── ATTENDANCE ───────────────────────────────────────────────
const getAttendance      = async (req, res) => { try { ok(res, { attendance: await svc.fetchAttendance(req.query) }); } catch(e) { err(res,e); } };
const getAttendanceStats = async (req, res) => { try { ok(res, { stats: await svc.fetchAttendanceStats() }); } catch(e) { err(res,e); } };
const clockIn            = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    const body = { ...req.body, employee_name: req.body.employee_name || userName };
    ok(res, { record: await svc.clockIn(body, userId, userName) }, 201);
  } catch(e) { err(res,e,400); }
};  
const clockOut           = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { record: await svc.clockOut(req.params.id, userId, userName) }); } catch(e) { err(res,e,400); } };
const createAttendance = async (req, res) => { try { const { userId, userName } = getUser(req); const body = { ...req.body, employee_name: req.body.employee_name || userName }; ok(res, { record: await svc.createAttendanceRecord(body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateAttendance = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { record: await svc.updateAttendanceRecord(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteAttendance = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteAttendanceRecord(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── PAYROLL ──────────────────────────────────────────────────
const getPayrolls        = async (req, res) => { try { ok(res, { payrolls: await svc.fetchPayrolls(req.query) }); } catch(e) { err(res,e); } };
const createPayroll      = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    ok(res, { payroll: await svc.createPayroll(req.body, userId, userName) }, 201);
  } catch(e) { err(res,e,400); }
};
const updatePayroll      = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { payroll: await svc.updatePayroll(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deletePayroll      = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deletePayroll(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

const getEligibleForRun  = async (req, res) => { try { ok(res, { employees: await svc.fetchEligibleEmployeesForRun(req.query.month_year) }); } catch(e) { err(res,e); } };
const previewPayroll     = async (req, res) => { try { ok(res, { preview: await svc.computeEmployeePayroll(req.params.employeeId, req.query.source || 'user', req.query.month || null) }); } catch(e) { err(res,e,400); } };
const runPayroll         = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    const { employeeIds, month_year } = req.body;
    if (!month_year) throw new Error('Month/Year is required');
    if (!Array.isArray(employeeIds) || !employeeIds.length) throw new Error('Select at least one employee');
    const result = await svc.runPayrollBulk(employeeIds, month_year, userId, userName);
    ok(res, result, 201);
  } catch(e) { err(res,e,400); }
};
const getPayrollItems    = async (req, res) => { try { ok(res, { items: await svc.fetchPayrollItems(req.params.id) }); } catch(e) { err(res,e); } };

// ── PAY COMPONENTS ───────────────────────────────────────────
const getPayComponents   = async (req, res) => { try { ok(res, { components: await svc.fetchPayComponents() }); } catch(e) { err(res,e); } };
const createPayComponent = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { component: await svc.createPayComponent(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updatePayComponent = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { component: await svc.updatePayComponent(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deletePayComponent = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deletePayComponent(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };
// ── PAYROLL GROUPS ───────────────────────────────────────────
const getPayrollGroups    = async (req, res) => { try { ok(res, { groups: await svc.fetchPayrollGroups() }); } catch(e) { err(res,e); } };
const createPayrollGroup  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { group: await svc.createPayrollGroup(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updatePayrollGroup  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { group: await svc.updatePayrollGroup(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deletePayrollGroup  = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deletePayrollGroup(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };
const getGroupComponents  = async (req, res) => { try { ok(res, { components: await svc.fetchGroupComponents(req.params.id) }); } catch(e) { err(res,e); } };
const updateGroupComponents = async (req, res) => { try { ok(res, { components: await svc.setGroupComponents(req.params.id, req.body.componentIds || []) }); } catch(e) { err(res,e,400); } };
const getEmployeesWithGroups = async (req, res) => { try { ok(res, { employees: await svc.fetchEmployeesWithGroups() }); } catch(e) { err(res,e); } };
const assignPayrollGroup    = async (req, res) => { try { ok(res, { employee: await svc.assignPayrollGroup(req.params.id, req.body.payroll_group_id, req.body.source || 'user') }); } catch(e) { err(res,e,400); } };
// ── EMPLOYEES (non-login) ───────────────────────────────────
const getEmployees       = async (req, res) => { try { ok(res, { employees: await svc.fetchEmployees() }); } catch(e) { err(res,e); } };
const createEmployee     = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { employee: await svc.createEmployee(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateEmployee     = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { employee: await svc.updateEmployee(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteEmployee     = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteEmployee(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };
const enableEmployeeLogin = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { user: await svc.enableEmployeeLogin(req.params.id, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
// ── HOLIDAYS ─────────────────────────────────────────────────
const getHolidays        = async (req, res) => { try { ok(res, { holidays: await svc.fetchHolidays() }); } catch(e) { err(res,e); } };
const createHoliday      = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { holiday: await svc.createHoliday(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateHoliday      = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { holiday: await svc.updateHoliday(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteHoliday      = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteHoliday(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── SALES TARGETS ────────────────────────────────────────────
// NEW
// ── SALES TARGETS ────────────────────────────────────────────
const getSalesTargets    = async (req, res) => { try { ok(res, { targets: await svc.fetchSalesTargets(req.query) }); } catch(e) { err(res,e); } };
const createSalesTarget  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { target: await svc.createSalesTarget(req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateSalesTarget  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { target: await svc.updateSalesTarget(req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteSalesTarget  = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteSalesTarget(req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── SETTINGS ─────────────────────────────────────────────────
const getSettings        = async (req, res) => { try { ok(res, { settings: await svc.fetchSettings() }); } catch(e) { err(res,e); } };
const updateSettings     = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { settings: await svc.updateSettings(req.body, userId, userName) }); } catch(e) { err(res,e,400); } };

module.exports = {
  getDashboardStats,
  getDepartments, createDepartment, updateDepartment, deleteDepartment,
  getDesignations, createDesignation, updateDesignation, deleteDesignation,
  getLeaveTypes, createLeaveType, updateLeaveType, deleteLeaveType,
  getLeaves, createLeave, updateLeave, updateLeaveStatus, deleteLeave,
  getShifts, createShift, updateShift, deleteShift,
 getAttendance, getAttendanceStats, clockIn, clockOut,
  createAttendance, updateAttendance, deleteAttendance,
getPayrolls, createPayroll, updatePayroll, deletePayroll,
  getEligibleForRun, previewPayroll, runPayroll, getPayrollItems,
getPayComponents, createPayComponent, updatePayComponent, deletePayComponent,
 getPayrollGroups, createPayrollGroup, updatePayrollGroup, deletePayrollGroup,
getGroupComponents, updateGroupComponents,
  getEmployeesWithGroups, assignPayrollGroup,
  getEmployees, createEmployee, updateEmployee, deleteEmployee, enableEmployeeLogin,
// NEW
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
  getSalesTargets, createSalesTarget, updateSalesTarget, deleteSalesTarget,
  getSettings, updateSettings,
};