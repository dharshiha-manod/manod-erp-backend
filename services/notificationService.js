/**
 * ====================================================
 * services/notificationService.js
 * ONE shared in-app notification engine for every ERP
 * module (Leave, Holiday, Sales Target, Attendance,
 * Payroll, Approvals, etc).
 *
 * Mirrors the auditLogService.js pattern exactly:
 * fire-and-forget, never throws, called as an extra
 * non-blocking line after real business logic already
 * succeeded. Does NOT replace the existing
 * hrm_leaves.employee_seen mechanism — that keeps
 * working as-is for backward compatibility.
 * ====================================================
 */
const pool = require('../config/database');

/**
 * Create one notification for one recipient.
 * Never throws — logs and swallows on failure, exactly like logAudit.
 */
const notifyUser = async ({ recipientId, recipientSource = 'user', module, eventType, title, message, recordId }) => {
  if (!recipientId || !module || !eventType || !title) return null;
  try {
    const { rows } = await pool.query(
      `INSERT INTO hrm_notifications
         (recipient_id, recipient_source, module, event_type, title, message, record_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [String(recipientId), recipientSource, module, eventType, title, message || null, recordId || null]
    );
    return rows[0];
  } catch (err) {
    console.error('[notificationService] notifyUser failed:', err.message);
    return null;
  }
};

/**
 * Broadcast the same notification to a list of recipients.
 * recipients: [{ id, source }] — source defaults to 'user'.
 */
const notifyUsers = async (recipients = [], payload = {}) => {
  const results = [];
  for (const r of recipients) {
    const recipientId = typeof r === 'object' ? r.id : r;
    const recipientSource = (typeof r === 'object' && r.source) || 'user';
    results.push(await notifyUser({ ...payload, recipientId, recipientSource }));
  }
  return results;
};

/** Broadcast to every active user (used for company-wide events like a new holiday). */
const notifyAllActiveUsers = async (payload = {}) => {
  try {
    const { rows } = await pool.query(`SELECT id FROM users WHERE status = 'active'`);
    return notifyUsers(rows.map(r => ({ id: r.id, source: 'user' })), payload);
  } catch (err) {
    console.error('[notificationService] notifyAllActiveUsers failed:', err.message);
    return [];
  }
};

const fetchMyNotifications = async (userId, recipientSource = 'user') => {
  const { rows } = await pool.query(
    `SELECT * FROM hrm_notifications
     WHERE recipient_id = $1 AND recipient_source = $2 AND seen = FALSE
     ORDER BY created_at DESC`,
    [String(userId), recipientSource]
  );
  return rows;
};

const markNotificationSeen = async (userId, id, recipientSource = 'user') => {
  const { rows } = await pool.query(
    `UPDATE hrm_notifications SET seen = TRUE
     WHERE id = $1 AND recipient_id = $2 AND recipient_source = $3 RETURNING id, seen`,
    [id, String(userId), recipientSource]
  );
  if (!rows.length) throw new Error('Notification not found');
  return rows[0];
};

const markAllSeen = async (userId, recipientSource = 'user') => {
  await pool.query(
    `UPDATE hrm_notifications SET seen = TRUE WHERE recipient_id = $1 AND recipient_source = $2 AND seen = FALSE`,
    [String(userId), recipientSource]
  );
  return { success: true };
};

module.exports = {
  notifyUser, notifyUsers, notifyAllActiveUsers,
  fetchMyNotifications, markNotificationSeen, markAllSeen,
};