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
const getDashboardStats  = async (req, res) => { try { ok(res, { stats: await svc.fetchDashboardStats(req.industryId) }); } catch(e) { err(res,e); } };

// ── DEPARTMENTS ──────────────────────────────────────────────
// NEW
const getDepartments     = async (req, res) => { try { ok(res, { departments: await svc.fetchDepartments(req.industryId) }); } catch(e) { err(res,e); } };
const createDepartment   = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { department: await svc.createDepartment(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateDepartment   = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { department: await svc.updateDepartment(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteDepartment   = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteDepartment(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── DESIGNATIONS ─────────────────────────────────────────────
// NEW
const getDesignations    = async (req, res) => { try { ok(res, { designations: await svc.fetchDesignations(req.industryId) }); } catch(e) { err(res,e); } };
const createDesignation  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { designation: await svc.createDesignation(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateDesignation  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { designation: await svc.updateDesignation(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteDesignation  = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteDesignation(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── LEAVE TYPES ──────────────────────────────────────────────
const getLeaveTypes      = async (req, res) => { try { ok(res, { leaveTypes: await svc.fetchLeaveTypes(req.industryId) }); } catch(e) { err(res,e); } };
const createLeaveType    = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leaveType: await svc.createLeaveType(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateLeaveType    = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leaveType: await svc.updateLeaveType(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteLeaveType    = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteLeaveType(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── LEAVES ───────────────────────────────────────────────────
const getLeaves          = async (req, res) => { try { ok(res, { leaves: await svc.fetchLeaves(req.industryId, req.query) }); } catch(e) { err(res,e); } };
const createLeave        = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    const body = { ...req.body, employee_name: req.body.employee_name || userName };
    ok(res, { leave: await svc.createLeave(req.industryId, body, userId, userName) }, 201);
  } catch(e) { err(res,e,400); }
};
const updateLeave        = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leave: await svc.updateLeave(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const updateLeaveStatus  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { leave: await svc.updateLeaveStatus(req.industryId, req.params.id, req.body.status, userId, userName, req.body.remarks) }); } catch(e) { err(res,e,400); } };
const deleteLeave        = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteLeave(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// (removed — duplicate declaration; the correct version lives further down, in the SHIFTS block near HOLIDAYS)

// ── ATTENDANCE ───────────────────────────────────────────────
const getAttendance      = async (req, res) => { try { ok(res, { attendance: await svc.fetchAttendance(req.industryId, req.query) }); } catch(e) { err(res,e); } };
const getAttendanceStats = async (req, res) => { try { ok(res, { stats: await svc.fetchAttendanceStats(req.industryId) }); } catch(e) { err(res,e); } };
const { getRequestMeta } = require('../utils/requestMeta');
const clockIn            = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    const body = { ...req.body, employee_name: req.body.employee_name || userName };
    ok(res, { record: await svc.clockIn(req.industryId, body, userId, userName, getRequestMeta(req)) }, 201);
  } catch(e) { err(res,e,400); }
};
const clockOut           = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { record: await svc.clockOut(req.industryId, req.params.id, userId, userName) }); } catch(e) { err(res,e,400); } };
const createAttendance = async (req, res) => { try { const { userId, userName } = getUser(req); const body = { ...req.body, employee_name: req.body.employee_name || userName }; ok(res, { record: await svc.createAttendanceRecord(req.industryId, body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateAttendance = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { record: await svc.updateAttendanceRecord(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteAttendance = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteAttendanceRecord(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── PAYROLL ──────────────────────────────────────────────────
const getPayrolls        = async (req, res) => { try { ok(res, { payrolls: await svc.fetchPayrolls(req.industryId, req.query) }); } catch(e) { err(res,e); } };
const createPayroll      = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    ok(res, { payroll: await svc.createPayroll(req.industryId, req.body, userId, userName) }, 201);
  } catch(e) { err(res,e,400); }
};
const updatePayroll      = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { payroll: await svc.updatePayroll(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deletePayroll      = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deletePayroll(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

const getEligibleForRun  = async (req, res) => { try { ok(res, { employees: await svc.fetchEligibleEmployeesForRun(req.industryId, req.query.month_year) }); } catch(e) { err(res,e); } };
const previewPayroll     = async (req, res) => { try { ok(res, { preview: await svc.computeEmployeePayroll(req.industryId, req.params.employeeId, req.query.source || 'user', req.query.month || null) }); } catch(e) { err(res,e,400); } };
const runPayroll         = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    const { employeeIds, month_year } = req.body;
    if (!month_year) throw new Error('Month/Year is required');
    if (!Array.isArray(employeeIds) || !employeeIds.length) throw new Error('Select at least one employee');
    const result = await svc.runPayrollBulk(req.industryId, employeeIds, month_year, userId, userName);
    ok(res, result, 201);
  } catch(e) { err(res,e,400); }
};
const getPayrollItems    = async (req, res) => { try { ok(res, { items: await svc.fetchPayrollItems(req.industryId, req.params.id) }); } catch(e) { err(res,e); } };

// ── PAY COMPONENTS ───────────────────────────────────────────
const getPayComponents   = async (req, res) => { try { ok(res, { components: await svc.fetchPayComponents(req.industryId) }); } catch(e) { err(res,e); } };
const createPayComponent = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { component: await svc.createPayComponent(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updatePayComponent = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { component: await svc.updatePayComponent(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deletePayComponent = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deletePayComponent(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };
// ── PAYROLL GROUPS ───────────────────────────────────────────
const getPayrollGroups    = async (req, res) => { try { ok(res, { groups: await svc.fetchPayrollGroups(req.industryId) }); } catch(e) { err(res,e); } };
const createPayrollGroup  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { group: await svc.createPayrollGroup(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updatePayrollGroup  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { group: await svc.updatePayrollGroup(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deletePayrollGroup  = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deletePayrollGroup(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };
const getGroupComponents  = async (req, res) => { try { ok(res, { components: await svc.fetchGroupComponents(req.industryId, req.params.id) }); } catch(e) { err(res,e); } };
const updateGroupComponents = async (req, res) => { try { ok(res, { components: await svc.setGroupComponents(req.industryId, req.params.id, req.body.componentIds || []) }); } catch(e) { err(res,e,400); } };
const getEmployeesWithGroups = async (req, res) => { try { ok(res, { employees: await svc.fetchEmployeesWithGroups(req.industryId) }); } catch(e) { err(res,e); } };
const assignPayrollGroup    = async (req, res) => { try { ok(res, { employee: await svc.assignPayrollGroup(req.industryId, req.params.id, req.body.payroll_group_id, req.body.source || 'user') }); } catch(e) { err(res,e,400); } };
// ── EMPLOYEES (non-login) ───────────────────────────────────
const getEmployees       = async (req, res) => { try { ok(res, { employees: await svc.fetchEmployees(req.industryId) }); } catch(e) { err(res,e); } };
const createEmployee     = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { employee: await svc.createEmployee(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateEmployee     = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { employee: await svc.updateEmployee(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteEmployee     = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteEmployee(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };
// ── EMPLOYEE EDUCATION (Phase 2) ────────────────────────────
const getEmployeeEducation    = async (req, res) => { try { ok(res, { education: await svc.fetchEmployeeEducation(req.industryId, req.params.employeeId) }); } catch(e) { err(res,e); } };
const createEmployeeEducation = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { education: await svc.createEmployeeEducation(req.industryId, req.params.employeeId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateEmployeeEducation = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { education: await svc.updateEmployeeEducation(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteEmployeeEducation = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteEmployeeEducation(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── EMPLOYEE EXPERIENCE (Phase 2) ───────────────────────────
const getEmployeeExperience    = async (req, res) => { try { ok(res, { experience: await svc.fetchEmployeeExperience(req.industryId, req.params.employeeId) }); } catch(e) { err(res,e); } };
const createEmployeeExperience = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { experience: await svc.createEmployeeExperience(req.industryId, req.params.employeeId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateEmployeeExperience = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { experience: await svc.updateEmployeeExperience(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteEmployeeExperience = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteEmployeeExperience(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── EMPLOYEE DOCUMENTS (Phase 2) ────────────────────────────
const getEmployeeDocuments   = async (req, res) => { try { ok(res, { documents: await svc.fetchEmployeeDocuments(req.industryId, req.params.employeeId) }); } catch(e) { err(res,e); } };
const uploadEmployeeDocument = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    if (!req.file) throw new Error('No file uploaded');
    const file_url = `/uploads/hrm-documents/${req.file.filename}`;
    const doc = await svc.createEmployeeDocument(req.industryId, req.params.employeeId, { doc_type: req.body.doc_type, file_name: req.file.originalname, file_url }, userId, userName);
    ok(res, { document: doc }, 201);
  } catch(e) { err(res,e,400); }
};
const deleteEmployeeDocument = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteEmployeeDocument(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── EMPLOYEE SKILLS (Phase 2) ───────────────────────────────
const getEmployeeSkills    = async (req, res) => { try { ok(res, { skills: await svc.fetchEmployeeSkills(req.industryId, req.params.employeeId) }); } catch(e) { err(res,e); } };
const createEmployeeSkill  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { skill: await svc.createEmployeeSkill(req.industryId, req.params.employeeId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const deleteEmployeeSkill  = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteEmployeeSkill(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── EMPLOYEE TIMELINE (Phase 3) ─────────────────────────────
const getEmployeeTimeline = async (req, res) => { try { ok(res, { timeline: await svc.fetchEmployeeTimeline(req.industryId, req.params.employeeId) }); } catch(e) { err(res,e); } };
const enableEmployeeLogin = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { user: await svc.enableEmployeeLogin(req.industryId, req.params.id, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
// ── HOLIDAYS ─────────────────────────────────────────────────
const getHolidays        = async (req, res) => { try { ok(res, { holidays: await svc.fetchHolidays(req.industryId) }); } catch(e) { err(res,e); } };
const createHoliday       = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { holiday: await svc.createHoliday(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateHoliday       = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { holiday: await svc.updateHoliday(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteHoliday       = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteHoliday(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── SHIFTS ───────────────────────────────────────────────────
const getShifts          = async (req, res) => { try { ok(res, { shifts: await svc.fetchShifts(req.industryId) }); } catch(e) { err(res,e); } };
const createShift        = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { shift: await svc.createShift(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateShift        = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { shift: await svc.updateShift(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteShift        = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteShift(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };
// ── SALES TARGETS ────────────────────────────────────────────
// NEW
// ── SALES TARGETS ────────────────────────────────────────────
const getSalesTargets    = async (req, res) => { try { ok(res, { targets: await svc.fetchSalesTargets(req.industryId, req.query) }); } catch(e) { err(res,e); } };
const createSalesTarget  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { target: await svc.createSalesTarget(req.industryId, req.body, userId, userName) }, 201); } catch(e) { err(res,e,400); } };
const updateSalesTarget  = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { target: await svc.updateSalesTarget(req.industryId, req.params.id, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const deleteSalesTarget  = async (req, res) => { try { const { userId, userName } = getUser(req); await svc.deleteSalesTarget(req.industryId, req.params.id, userId, userName); ok(res, { message: 'Deleted' }); } catch(e) { err(res,e); } };

// ── SETTINGS ─────────────────────────────────────────────────
const getSettings        = async (req, res) => { try { ok(res, { settings: await svc.fetchSettings(req.industryId) }); } catch(e) { err(res,e); } };
const updateSettings     = async (req, res) => { try { const { userId, userName } = getUser(req); ok(res, { settings: await svc.updateSettings(req.industryId, req.body, userId, userName) }); } catch(e) { err(res,e,400); } };
const searchEmployees    = async (req, res) => { try { ok(res, { employees: await svc.searchEmployees(req.industryId, req.query) }); } catch(e) { err(res,e); } };

const attendanceReport   = async (req, res) => { try { const { rows, summary } = await svc.getAttendanceReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const leaveReport        = async (req, res) => { try { const { rows, summary } = await svc.getLeaveReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const lateReport         = async (req, res) => { try { const { rows, summary } = await svc.getLateReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const overtimeReport     = async (req, res) => { try { const { rows, summary } = await svc.getOvertimeReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const employeeDirectory  = async (req, res) => { try { const { rows, summary } = await svc.getEmployeeDirectory(req.industryId); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const payrollReport      = async (req, res) => { try { const { rows, summary } = await svc.getPayrollReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const joiningReport      = async (req, res) => { try { const { rows, summary } = await svc.getJoiningReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const exitReport         = async (req, res) => { try { const { rows, summary } = await svc.getExitReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const departmentReport   = async (req, res) => { try { const { rows, summary } = await svc.getDepartmentReport(req.industryId); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const branchReport       = async (req, res) => { try { const { rows, summary } = await svc.getBranchReport(req.industryId); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const salaryReport       = async (req, res) => { try { const { rows, summary } = await svc.getSalaryReport(req.industryId, req.query); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } };
const trainingReport     = async (req, res) => { try { const { rows, summary } = await svc.getTrainingReport(req.industryId); ok(res, { data: rows, summary }); } catch(e) { err(res,e); } }; 
module.exports = {
  searchEmployees,
  attendanceReport, leaveReport, lateReport, overtimeReport, employeeDirectory,
  payrollReport, joiningReport, exitReport, departmentReport, branchReport,
  salaryReport, trainingReport,
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
  getEmployeeEducation, createEmployeeEducation, updateEmployeeEducation, deleteEmployeeEducation,
  getEmployeeExperience, createEmployeeExperience, updateEmployeeExperience, deleteEmployeeExperience,
  getEmployeeDocuments, uploadEmployeeDocument, deleteEmployeeDocument,
getEmployeeSkills, createEmployeeSkill, deleteEmployeeSkill,
  getEmployeeTimeline,
// NEW
  getHolidays, createHoliday, updateHoliday, deleteHoliday,
  getSalesTargets, createSalesTarget, updateSalesTarget, deleteSalesTarget,
  getSettings, updateSettings,
};