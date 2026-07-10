/**
 * ====================================================
 * routes/hrm.js
 * All REST endpoints for the HRM module.
 * Mount point: /api/hrm  (add to server.js)
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const auth  = require('../middleware/auth');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl  = require('../controllers/hrmController');

// ── Permission shorthand ─────────────────────────────────────
const VIEW_HRM     = [['Essentials','Add/Edit/View/Delete all leave'],['Essentials','View all Payroll'],['Essentials','Add/Edit/View/Delete all attendance']];
const MANAGE_HRM   = [['Essentials','Add/Edit/View/Delete all leave'],['Essentials','View all Payroll']];

// ── DASHBOARD ────────────────────────────────────────────────
router.get('/dashboard',               auth, requireAnyPermission(VIEW_HRM),   ctrl.getDashboardStats);

// ── DEPARTMENTS ──────────────────────────────────────────────
router.get   ('/departments',          auth, requireAnyPermission(VIEW_HRM),   ctrl.getDepartments);
router.post  ('/departments',          auth, requireAnyPermission(MANAGE_HRM), ctrl.createDepartment);
router.put   ('/departments/:id',      auth, requireAnyPermission(MANAGE_HRM), ctrl.updateDepartment);
router.delete('/departments/:id',      auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteDepartment);

// ── DESIGNATIONS ─────────────────────────────────────────────
router.get   ('/designations',         auth, requireAnyPermission(VIEW_HRM),   ctrl.getDesignations);
router.post  ('/designations',         auth, requireAnyPermission(MANAGE_HRM), ctrl.createDesignation);
router.put   ('/designations/:id',     auth, requireAnyPermission(MANAGE_HRM), ctrl.updateDesignation);
router.delete('/designations/:id',     auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteDesignation);

// ── LEAVE TYPES ──────────────────────────────────────────────
router.get   ('/leave-types',          auth, requireAnyPermission(VIEW_HRM),   ctrl.getLeaveTypes);
router.post  ('/leave-types',          auth, requireAnyPermission(MANAGE_HRM), ctrl.createLeaveType);
router.put   ('/leave-types/:id',      auth, requireAnyPermission(MANAGE_HRM), ctrl.updateLeaveType);
router.delete('/leave-types/:id',      auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteLeaveType);

// ── LEAVES ───────────────────────────────────────────────────
router.get   ('/leaves',               auth, requireAnyPermission(VIEW_HRM),   ctrl.getLeaves);
router.post  ('/leaves',               auth, requireAnyPermission(VIEW_HRM),   ctrl.createLeave);
router.put   ('/leaves/:id',           auth, requireAnyPermission(MANAGE_HRM), ctrl.updateLeave);
router.patch ('/leaves/:id/status',    auth, requireAnyPermission(MANAGE_HRM), ctrl.updateLeaveStatus);
router.delete('/leaves/:id',           auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteLeave);

// ── SHIFTS ───────────────────────────────────────────────────
router.get   ('/shifts',               auth, requireAnyPermission(VIEW_HRM),   ctrl.getShifts);
router.post  ('/shifts',               auth, requireAnyPermission(MANAGE_HRM), ctrl.createShift);
router.put   ('/shifts/:id',           auth, requireAnyPermission(MANAGE_HRM), ctrl.updateShift);
router.delete('/shifts/:id',           auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteShift);

// ── ATTENDANCE ───────────────────────────────────────────────
// GET /api/hrm/attendance?date_filter=Today&employee=All&status=All
router.get   ('/attendance',           auth, requireAnyPermission(VIEW_HRM),   ctrl.getAttendance);
router.get   ('/attendance/stats',     auth, requireAnyPermission(VIEW_HRM),   ctrl.getAttendanceStats);
router.post  ('/attendance/clock-in',  auth,                                   ctrl.clockIn);
router.patch ('/attendance/:id/clock-out', auth,                               ctrl.clockOut);
router.post  ('/attendance',           auth, requireAnyPermission(MANAGE_HRM), ctrl.createAttendance);
router.put   ('/attendance/:id',       auth, requireAnyPermission(MANAGE_HRM), ctrl.updateAttendance);
router.delete('/attendance/:id',       auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteAttendance);

// ── PAYROLL ──────────────────────────────────────────────────
router.get   ('/payroll',              auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getPayrolls);
router.post  ('/payroll',              auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.createPayroll);
router.put   ('/payroll/:id',          auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.updatePayroll);
router.delete('/payroll/:id',          auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.deletePayroll);
router.get   ('/payroll-run/eligible', auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getEligibleForRun);
router.get   ('/payroll-run/preview/:employeeId', auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.previewPayroll);
router.post  ('/payroll-run',          auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.runPayroll);
router.get   ('/payroll/:id/items',    auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getPayrollItems);

// ── PAY COMPONENTS ───────────────────────────────────────────
router.get   ('/pay-components',       auth, requireAnyPermission(MANAGE_HRM), ctrl.getPayComponents);
router.post  ('/pay-components',       auth, requireAnyPermission(MANAGE_HRM), ctrl.createPayComponent);
router.put   ('/pay-components/:id',   auth, requireAnyPermission(MANAGE_HRM), ctrl.updatePayComponent);
router.delete('/pay-components/:id',   auth, requireAnyPermission(MANAGE_HRM), ctrl.deletePayComponent);

// ── PAYROLL GROUPS ───────────────────────────────────────────
router.get   ('/payroll-groups',       auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getPayrollGroups);
router.post  ('/payroll-groups',       auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.createPayrollGroup);
router.put   ('/payroll-groups/:id',   auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.updatePayrollGroup);
router.delete('/payroll-groups/:id',   auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.deletePayrollGroup);
router.get   ('/payroll-groups/:id/components', auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getGroupComponents);
router.put   ('/payroll-groups/:id/components', auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.updateGroupComponents);
router.get   ('/employees',            auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getEmployeesWithGroups);
router.put   ('/employees/:id/payroll-group', auth, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.assignPayrollGroup);

// ── HOLIDAYS ─────────────────────────────────────────────────
router.get   ('/holidays',             auth, requireAnyPermission(VIEW_HRM),   ctrl.getHolidays);
router.post  ('/holidays',             auth, requireAnyPermission(MANAGE_HRM), ctrl.createHoliday);
router.put   ('/holidays/:id',         auth, requireAnyPermission(MANAGE_HRM), ctrl.updateHoliday);
router.delete('/holidays/:id',         auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteHoliday);

// ── SALES TARGETS ────────────────────────────────────────────
// NEW
// ── SALES TARGETS ────────────────────────────────────────────
router.get   ('/sales-targets',        auth, requireAnyPermission(VIEW_HRM),   ctrl.getSalesTargets);
router.post  ('/sales-targets',        auth, requireAnyPermission(MANAGE_HRM), ctrl.createSalesTarget);
router.put   ('/sales-targets/:id',    auth, requireAnyPermission(MANAGE_HRM), ctrl.updateSalesTarget);
router.delete('/sales-targets/:id',    auth, requireAnyPermission(MANAGE_HRM), ctrl.deleteSalesTarget);

// ── SETTINGS ─────────────────────────────────────────────────
router.get   ('/settings',             auth, requireAnyPermission(VIEW_HRM),   ctrl.getSettings);
router.put   ('/settings',             auth, requireAnyPermission(MANAGE_HRM), ctrl.updateSettings);

module.exports = router;