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
const requireIndustry = require('../middleware/industry');
const { requireAnyPermission } = require('../middleware/permission');
const ctrl  = require('../controllers/hrmController');
// ── Permission shorthand ─────────────────────────────────────
const VIEW_HRM     = [['Essentials','Add/Edit/View/Delete all leave'],['Essentials','View all Payroll'],['Essentials','Add/Edit/View/Delete all attendance']];
const MANAGE_HRM   = [['Essentials','Add/Edit/View/Delete all leave'],['Essentials','View all Payroll']];

// ── DASHBOARD ────────────────────────────────────────────────
router.get('/dashboard',               auth, requireAnyPermission(VIEW_HRM),   ctrl.getDashboardStats);

// ── DEPARTMENTS ──────────────────────────────────────────────
router.get   ('/departments',          auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.getDepartments);
router.post  ('/departments',          auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.createDepartment);
router.put   ('/departments/:id',      auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.updateDepartment);
router.delete('/departments/:id',      auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deleteDepartment);

// ── DESIGNATIONS ─────────────────────────────────────────────
router.get   ('/designations',         auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.getDesignations);
router.post  ('/designations',         auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.createDesignation);
router.put   ('/designations/:id',     auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.updateDesignation);
router.delete('/designations/:id',     auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deleteDesignation);    

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
router.get   ('/payroll',              auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getPayrolls);
router.post  ('/payroll',              auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.createPayroll);
router.put   ('/payroll/:id',          auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.updatePayroll);
router.delete('/payroll/:id',          auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.deletePayroll);
router.get   ('/payroll-run/eligible', auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getEligibleForRun);
router.get   ('/payroll-run/preview/:employeeId', auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.previewPayroll);
router.post  ('/payroll-run',          auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.runPayroll);
router.get   ('/payroll/:id/items',    auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getPayrollItems);

// ── PAY COMPONENTS ───────────────────────────────────────────
// NEW
router.get   ('/pay-components',       auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.getPayComponents);
router.post  ('/pay-components',       auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.createPayComponent);
router.put   ('/pay-components/:id',   auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.updatePayComponent);
router.delete('/pay-components/:id',   auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deletePayComponent); 

router.get   ('/payroll-groups',       auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getPayrollGroups);
router.post  ('/payroll-groups',       auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.createPayrollGroup);
router.put   ('/payroll-groups/:id',   auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.updatePayrollGroup);
router.delete('/payroll-groups/:id',   auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.deletePayrollGroup);
router.get   ('/payroll-groups/:id/components', auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.getGroupComponents);
router.put   ('/payroll-groups/:id/components', auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.updateGroupComponents);
router.get   ('/employees',            auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.getEmployeesWithGroups);
router.put   ('/employees/:id/payroll-group', auth, requireIndustry, requireAnyPermission([['Essentials','View all Payroll']]), ctrl.assignPayrollGroup);

router.get   ('/hrm-employees',        auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.getEmployees);
router.post  ('/hrm-employees',        auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.createEmployee);
router.put   ('/hrm-employees/:id',    auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.updateEmployee);
router.delete('/hrm-employees/:id',    auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deleteEmployee);
router.post('/hrm-employees/:id/enable-login', auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.enableEmployeeLogin);

// ── EMPLOYEE EDUCATION / EXPERIENCE / DOCUMENTS / SKILLS (Phase 2) ──
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const DOC_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'hrm-documents');
fs.mkdirSync(DOC_UPLOAD_DIR, { recursive: true });
const docStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, DOC_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const uploadDoc = multer({
  storage: docStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB cap
  fileFilter: (req, file, cb) => {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'];
    if (!allowed.includes(file.mimetype)) return cb(new Error('Only PDF, JPG, PNG files are allowed'));
    cb(null, true);
  },
});

router.get   ('/hrm-employees/:employeeId/education',      auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.getEmployeeEducation);
router.post  ('/hrm-employees/:employeeId/education',      auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.createEmployeeEducation);
router.put   ('/hrm-employees/education/:id',               auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.updateEmployeeEducation);
router.delete('/hrm-employees/education/:id',               auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deleteEmployeeEducation);

router.get   ('/hrm-employees/:employeeId/experience',      auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.getEmployeeExperience);
router.post  ('/hrm-employees/:employeeId/experience',      auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.createEmployeeExperience);
router.put   ('/hrm-employees/experience/:id',               auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.updateEmployeeExperience);
router.delete('/hrm-employees/experience/:id',               auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deleteEmployeeExperience);

router.get   ('/hrm-employees/:employeeId/documents',        auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.getEmployeeDocuments);
router.post  ('/hrm-employees/:employeeId/documents',        auth, requireIndustry, requireAnyPermission(MANAGE_HRM), uploadDoc.single('file'), ctrl.uploadEmployeeDocument);
router.delete('/hrm-employees/documents/:id',                 auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deleteEmployeeDocument);

router.get   ('/hrm-employees/:employeeId/skills',            auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.getEmployeeSkills);
router.post  ('/hrm-employees/:employeeId/skills',            auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.createEmployeeSkill);
router.delete('/hrm-employees/skills/:id',                     auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.deleteEmployeeSkill);

// ── EMPLOYEE TIMELINE (Phase 3) ─────────────────────────────
router.get('/hrm-employees/:employeeId/timeline', auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.getEmployeeTimeline);

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
router.get   ('/settings',             auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.getSettings);
router.put   ('/settings',             auth, requireIndustry, requireAnyPermission(MANAGE_HRM), ctrl.updateSettings);
router.get   ('/hrm-employees/search', auth, requireIndustry, requireAnyPermission(VIEW_HRM),   ctrl.searchEmployees);

router.get   ('/reports/attendance',          auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.attendanceReport);
router.get   ('/reports/leave',               auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.leaveReport);
router.get   ('/reports/late',                auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.lateReport);
router.get   ('/reports/overtime',            auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.overtimeReport);
router.get   ('/reports/employee-directory',  auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.employeeDirectory);
router.get   ('/reports/payroll',             auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.payrollReport);
router.get   ('/reports/joining',             auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.joiningReport);
router.get   ('/reports/exit',                auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.exitReport);
router.get   ('/reports/department',          auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.departmentReport);
router.get   ('/reports/branch',              auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.branchReport);
router.get   ('/reports/salary',              auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.salaryReport);
router.get   ('/reports/training',            auth, requireIndustry, requireAnyPermission(VIEW_HRM), ctrl.trainingReport);
module.exports = router;