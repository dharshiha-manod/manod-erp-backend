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

const logActivity = async ({ userId = null, userName = null, module, action, detail = null, req = null, industryId = null }) => {
  try {
    const ip = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || req?.socket?.remoteAddress || null;

    // Industry Workspace Isolation: req.industryId is already set by the
    // requireIndustry middleware on every route that calls logActivity(),
    // so it's captured automatically — no changes needed at any of the
    // existing call sites. Callers without req (e.g. registerService)
    // can still pass industryId explicitly.
    const resolvedIndustryId = industryId ?? req?.industryId ?? null;

    let resolvedName = userName;
    if (!resolvedName && userId) {
      const { rows } = await pool.query('SELECT full_name FROM users WHERE id = $1', [userId]);
      resolvedName = rows[0]?.full_name || null;
    }

    await pool.query(
      `INSERT INTO activity_logs (user_id, user_name, module, action, detail, ip_address, industry_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId, resolvedName, module, action, detail, ip, resolvedIndustryId]
    );
  } catch (err) {
    // Never let logging break the actual request
    console.error('⚠️ [activityLogService.logActivity]', err.message);
  }
};
module.exports = { logActivity };