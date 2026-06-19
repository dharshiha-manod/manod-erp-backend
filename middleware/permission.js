/**
 * ============================================================
 * middleware/permission.js  (FIXED — case-insensitive role lookup)
 *
 * Root cause was: WHERE r.role_name = $1  (exact match)
 * "sales manager" != "Sales Manager" → no permissions found
 *
 * Fix: WHERE LOWER(r.role_name) = LOWER($1)
 * ============================================================
 */

const pool = require('../config/database');

const ADMIN_ROLES = ['super admin', 'administrator', 'admin'];

const loadUserPermissions = async (req) => {
  if (req.permissions) return req.permissions;

  const userId = req.user?.id || req.user?.userId;
  if (!userId) return [];

  const userResult = await pool.query(
    `SELECT role FROM users WHERE id = $1`, [userId]
  );
  if (userResult.rows.length === 0) return [];

  const roleName = userResult.rows[0].role;
  req.userRoleName = roleName;

  // ── FIXED: case-insensitive match ──────────────────────────
  const result = await pool.query(
    `SELECT p.group_name, p.name
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     INNER JOIN roles r ON r.id = rp.role_id
     WHERE LOWER(r.role_name) = LOWER($1)`,
    [roleName]
  );

  req.permissions = result.rows.map((p) => `${p.group_name}::${p.name}`);
  return req.permissions;
};

const requirePermission = (group, name) => {
  return async (req, res, next) => {
    try {
      const perms    = await loadUserPermissions(req);
      const roleName = (req.userRoleName || '').toLowerCase();
      if (ADMIN_ROLES.includes(roleName)) return next();
      if (perms.includes(`${group}::${name}`)) return next();
      return res.status(403).json({ success: false, error: 'Permission denied', code: 'PERMISSION_DENIED' });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }
  };
};

const requireAnyPermission = (permPairs) => {
  return async (req, res, next) => {
    try {
      const perms    = await loadUserPermissions(req);
      const roleName = (req.userRoleName || '').toLowerCase();
      if (ADMIN_ROLES.includes(roleName)) return next();
      if (permPairs.some(([g, n]) => perms.includes(`${g}::${n}`))) return next();
      return res.status(403).json({ success: false, error: 'Permission denied', code: 'PERMISSION_DENIED' });
    } catch (err) {
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }
  };
};

const getMyPermissions = async (req, res) => {
  try {
    const perms    = await loadUserPermissions(req);
    const roleName = (req.userRoleName || '').toLowerCase();
    const isAdmin  = ADMIN_ROLES.includes(roleName);
    res.json({ success: true, permissions: perms, isAdmin, role: req.userRoleName });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Failed to load permissions' });
  }
};

module.exports = { requirePermission, requireAnyPermission, getMyPermissions, loadUserPermissions };