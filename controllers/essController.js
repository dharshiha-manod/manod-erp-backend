/**
 * ====================================================
 * controllers/essController.js
 * Employee Self-Service — thin HTTP layer.
 * Mirrors hrmController.js style.
 *
 * SECURITY: every handler below reads the employee identity from
 * req.user.id (verified JWT via middleware/auth.js) — never from
 * req.body or req.query. This is what guarantees an employee can
 * only ever see/act on their own records.
 * ====================================================
 */

const svc = require('../services/hrmService');
const notificationService = require('../services/notificationService');

const ok  = (res, data, status = 200) => res.status(status).json({ success: true, ...data });
const err = (res, e, status = 500) => {
  console.error('❌ ESS Error:', e.message);
  res.status(status).json({ success: false, error: e.message || 'Internal error' });
};
const getUser = (req) => ({
  userId: req.user?.id || req.user?.userId || null,
  userName: req.user?.name || req.user?.full_name || req.user?.username || req.user?.email || null,
});

// ── MY PROFILE ────────────────────────────────────────────────
const getMyProfile    = async (req, res) => { try { const { userId } = getUser(req); ok(res, { profile: await svc.fetchMyProfile(userId) }); } catch(e) { err(res,e,404); } };
const updateMyProfile = async (req, res) => { try { const { userId } = getUser(req); ok(res, { profile: await svc.updateMyProfile(userId, req.body) }); } catch(e) { err(res,e,400); } };

// ── MY ATTENDANCE ────────────────────────────────────────────
const getMyAttendance      = async (req, res) => { try { const { userId } = getUser(req); ok(res, { attendance: await svc.fetchMyAttendance(userId, req.query) }); } catch(e) { err(res,e); } };
const getMyAttendanceStats = async (req, res) => { try { const { userId } = getUser(req); ok(res, { stats: await svc.fetchMyAttendanceStats(userId) }); } catch(e) { err(res,e); } };
// NEW
const { getRequestMeta } = require('../utils/requestMeta');
const clockInSelf          = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    ok(res, { attendance: await svc.clockInSelf(userId, userName, req.body?.department, req.body?.note, req.body?.shift_name, req.body?.location, getRequestMeta(req)) }, 201);
  } catch(e) { err(res,e,400); }
};
const clockOutSelf = async (req, res) => {
  try { const { userId } = getUser(req); ok(res, { attendance: await svc.clockOutSelf(userId, req.params.id) }); } catch(e) { err(res,e,400); }
};

const getMyDepartments = async (req, res) => { try { ok(res, { departments: await svc.fetchDepartments() }); } catch(e) { err(res,e); } };
const getMyShifts      = async (req, res) => { try { ok(res, { shifts: await svc.fetchShifts() }); } catch(e) { err(res,e); } };

// ── MY LEAVE ─────────────────────────────────────────────────
const getMyLeaves       = async (req, res) => { try { const { userId } = getUser(req); ok(res, { leaves: await svc.fetchMyLeaves(userId) }); } catch(e) { err(res,e); } };
const getMyLeaveBalance = async (req, res) => { try { const { userId } = getUser(req); ok(res, { balance: await svc.fetchMyLeaveBalance(req.industryId, userId) }); } catch(e) { err(res,e); } };
const applyMyLeave      = async (req, res) => {
  try {
    const { userId, userName } = getUser(req);
    ok(res, { leave: await svc.applyMyLeave(userId, userName, req.body) }, 201);
  } catch(e) { err(res,e,400); }
};
const cancelMyLeave = async (req, res) => {
  try { const { userId } = getUser(req); ok(res, { leave: await svc.cancelMyLeave(userId, req.params.id) }); } catch(e) { err(res,e,400); }
};

// ── MY LEAVE NOTIFICATIONS ──────────────────────────────────
const getMyLeaveNotifications = async (req, res) => {
  try { const { userId } = getUser(req); ok(res, { notifications: await svc.fetchMyLeaveNotifications(userId) }); } catch(e) { err(res,e); }
};
const markLeaveNotificationSeen = async (req, res) => {
  try { const { userId } = getUser(req); ok(res, { result: await svc.markLeaveNotificationSeen(userId, req.params.id) }); } catch(e) { err(res,e,400); }
};

// ── MY PAYROLL / PAYSLIPS ───────────────────────────────────
// NEW CODE
// ── MY HOLIDAYS ──────────────────────────────────────────────
const getMyHolidays = async (req, res) => { try { ok(res, { holidays: await svc.fetchMyHolidays() }); } catch(e) { err(res,e); } };

// ── MY SALES TARGET ──────────────────────────────────────────
const getMySalesTarget = async (req, res) => { try { const { userId } = getUser(req); ok(res, { targets: await svc.fetchMySalesTarget(userId) }); } catch(e) { err(res,e); } };

// ── MY PAYROLL / PAYSLIPS ───────────────────────────────────
const getMyPayroll      = async (req, res) => { try { const { userId } = getUser(req); ok(res, { payrolls: await svc.fetchMyPayroll(userId) }); } catch(e) { err(res,e); } };
const getMyPayrollItems = async (req, res) => {
  try { const { userId } = getUser(req); ok(res, { items: await svc.fetchMyPayrollItems(userId, req.params.id) }); } catch(e) { err(res,e,404); }
};
// ── MY DOCUMENTS / EDUCATION / TIMELINE (Phase 6) ────────────
const getMyDocuments = async (req, res) => { try { const { userId } = getUser(req); ok(res, { documents: await svc.fetchMyDocuments(userId) }); } catch(e) { err(res,e); } };
const getMyEducation = async (req, res) => { try { const { userId } = getUser(req); ok(res, { education: await svc.fetchMyEducation(userId) }); } catch(e) { err(res,e); } };
const getMyTimeline  = async (req, res) => { try { const { userId } = getUser(req); ok(res, { timeline: await svc.fetchMyTimeline(userId) }); } catch(e) { err(res,e); } };

// ── MY NOTIFICATIONS (shared, all modules) ───────────────────
const getMyNotifications      = async (req, res) => { try { const { userId } = getUser(req); ok(res, { notifications: await notificationService.fetchMyNotifications(userId) }); } catch(e) { err(res,e); } };
const markNotificationSeen    = async (req, res) => { try { const { userId } = getUser(req); ok(res, { result: await notificationService.markNotificationSeen(userId, req.params.id) }); } catch(e) { err(res,e,400); } };
const markAllNotificationsSeen= async (req, res) => { try { const { userId } = getUser(req); ok(res, { result: await notificationService.markAllSeen(userId) }); } catch(e) { err(res,e,400); } };

// NEW CODE
module.exports = {
  getMyProfile, updateMyProfile,

  getMyAttendance, getMyAttendanceStats, clockInSelf, clockOutSelf,
  getMyDepartments, getMyShifts,
  getMyLeaves, getMyLeaveBalance, applyMyLeave, cancelMyLeave,
  getMyLeaveNotifications, markLeaveNotificationSeen,
  getMyHolidays, getMySalesTarget,
  getMyPayroll, getMyPayrollItems,
  getMyDocuments, getMyEducation, getMyTimeline,
  getMyNotifications, markNotificationSeen, markAllNotificationsSeen,
};