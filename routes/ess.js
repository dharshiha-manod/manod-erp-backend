/**
 * ====================================================
 * routes/ess.js
 * Employee Self-Service endpoints.
 * Mount point: /api/ess  (add to server.js)
 *
 * Deliberately guarded by `auth` ONLY — no requirePermission /
 * requireAnyPermission. This section is available to every
 * logged-in user regardless of role (HR, Sales, Purchase,
 * Accounts, Manufacturing, Inventory, Admin, etc.), by design.
 *
 * This does NOT replace or modify /api/hrm/* — that module keeps
 * its existing Essentials-permission gating exactly as-is.
 * ====================================================
 */

const express = require('express');
const router  = express.Router();

const auth = require('../middleware/auth');
const ctrl = require('../controllers/essController');

// ── MY PROFILE ────────────────────────────────────────────────
router.get ('/profile', auth, ctrl.getMyProfile);
router.put ('/profile', auth, ctrl.updateMyProfile);

// ── MY ATTENDANCE ────────────────────────────────────────────
router.get  ('/attendance',            auth, ctrl.getMyAttendance);
router.get  ('/attendance/stats',      auth, ctrl.getMyAttendanceStats);
// NEW
router.post ('/attendance/clock-in',   auth, ctrl.clockInSelf);
router.patch('/attendance/:id/clock-out', auth, ctrl.clockOutSelf);
router.get  ('/departments',           auth, ctrl.getMyDepartments);
router.get  ('/shifts',                auth, ctrl.getMyShifts);

// ── MY LEAVE ─────────────────────────────────────────────────
router.get   ('/leaves',         auth, ctrl.getMyLeaves);
router.get   ('/leaves/balance', auth, ctrl.getMyLeaveBalance);
router.post  ('/leaves',         auth, ctrl.applyMyLeave);
router.patch ('/leaves/:id/cancel', auth, ctrl.cancelMyLeave);

// ── MY LEAVE NOTIFICATIONS ───────────────────────────────────
// Note: this route must come before '/leaves/:id/cancel' style params
// only matters if paths collide — they don't here ('notifications' is
// a fixed segment, not under /:id), so ordering is safe either way.
router.get   ('/leaves/notifications',  auth, ctrl.getMyLeaveNotifications);
router.patch ('/leaves/:id/seen',       auth, ctrl.markLeaveNotificationSeen);

// ── MY PAYROLL / PAYSLIPS ───────────────────────────────────
// NEW CODE
// ── MY HOLIDAYS ──────────────────────────────────────────────
router.get ('/holidays', auth, ctrl.getMyHolidays);

// ── MY SALES TARGET ──────────────────────────────────────────
router.get ('/sales-target', auth, ctrl.getMySalesTarget);

// ── MY PAYROLL / PAYSLIPS ───────────────────────────────────
router.get ('/payroll',            auth, ctrl.getMyPayroll);
router.get ('/payroll/:id/items',  auth, ctrl.getMyPayrollItems);

// ── MY NOTIFICATIONS (shared bell — Leave, Holiday, Sales Target, etc) ──
router.get   ('/notifications',          auth, ctrl.getMyNotifications);
router.patch ('/notifications/:id/seen', auth, ctrl.markNotificationSeen);
router.patch ('/notifications/seen-all', auth, ctrl.markAllNotificationsSeen);

module.exports = router;