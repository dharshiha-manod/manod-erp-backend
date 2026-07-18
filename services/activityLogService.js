/**
 * ====================================================
 * services/activityLogService.js
 *
 * Single write-path for the activity_logs table.
 * Every controller that mutates data calls logActivity()
 * fire-and-forget (never blocks or fails the main request).
 * ====================================================
 */

'use strict';

const pool = require('../config/database');

const logActivity = async ({ userId = null, userName = null, module, action, detail = null, req = null }) => {
  try {
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.socket?.remoteAddress || null;

    let resolvedName = userName;
    if (!resolvedName && userId) {
      const { rows } = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
      resolvedName = rows[0]?.full_name || null;
    }

    await pool.query(
      `INSERT INTO activity_logs (user_id, user_name, module, action, detail, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [userId, resolvedName, module, action, detail, ip]
    );
  } catch (err) {
    // Never let logging break the actual request
    console.error('⚠️ [activityLogService.logActivity]', err.message);
  }
};

module.exports = { logActivity };