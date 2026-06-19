/**
 * ============================================================
 * PERMISSION MIDDLEWARE
 * File: middleware/permission.js
 * FIX: Role name matching normalizes case AND strips spaces/symbols
 *      so "Sales Manager" matches "salesmanager" / "sales_manager" /
 *      "SALES-MANAGER" etc. — protects against spacing/casing drift
 *      between users.role and roles.role_name.
 * FIX 2: Admin-tier roles bypass row-by-row permission assignment
 *        and get every permission automatically.
 * FIX 3: getMyPermissions also returns role + isAdmin flag so the
 *        frontend can bypass fragile permission-string matching
 *        for admin users.
 * ============================================================
 */

const pool = require('../config/database');

const ADMIN_ROLES = ["admin", "super admin", "administrator"];

/**
 * Fetches the logged-in user's permission keys from the DB.
 * Caches them on req.permissions so we only query once per request.
 * Permission key format: "group_name::permission_name"
 */
const loadUserPermissions = async (req) => {
  if (req.permissions) return req.permissions; // already loaded

  // req.user is set by authenticateToken middleware (JWT payload)
  const userId = req.user?.id || req.user?.userId;
  if (!userId) return [];

  // Get user's role from users table
  const userResult = await pool.query(
    `SELECT role FROM users WHERE id = $1`,
    [userId]
  );
  if (userResult.rows.length === 0) return [];

  const roleName = userResult.rows[0].role;
  if (!roleName) return [];

  // ✅ Admin-tier roles bypass row-by-row permission assignment.
  // They always get every permission that exists, regardless of
  // whether role_permissions has been fully seeded for them.
  if (ADMIN_ROLES.includes(roleName.toLowerCase())) {
    const allPerms = await pool.query(`SELECT group_name, name FROM permissions`);
    req.permissions = allPerms.rows.map((p) => `${p.group_name}::${p.name}`);
    return req.permissions;
  }

  // ✅ FIX: Normalize both sides — lowercase AND strip everything that
  // isn't a letter/number — so "Sales Manager" matches "salesmanager",
  // "sales_manager", "SALES-MANAGER", etc. Plain LOWER() alone only
  // handled case, not spacing/underscore/hyphen differences.
  const result = await pool.query(
    `SELECT p.group_name, p.name
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     INNER JOIN roles r ON r.id = rp.role_id
     WHERE REGEXP_REPLACE(LOWER(r.role_name), '[^a-z0-9]', '', 'g')
         = REGEXP_REPLACE(LOWER($1), '[^a-z0-9]', '', 'g')`,
    [roleName]
  );

  req.permissions = result.rows.map((p) => `${p.group_name}::${p.name}`);
  return req.permissions;
};

/**
 * Middleware factory — protects a route by checking one permission.
 *
 * @param {string} group  e.g. 'User'
 * @param {string} name   e.g. 'View user'
 *
 * Example:
 *   router.get('/', auth, requirePermission('User', 'View user'), getAllUsers);
 */
const requirePermission = (group, name) => {
  return async (req, res, next) => {
    try {
      const perms = await loadUserPermissions(req);
      const key   = `${group}::${name}`;

      if (perms.includes(key)) {
        return next();
      }

      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        required: key,
        code: 'PERMISSION_DENIED'
      });
    } catch (err) {
      console.error('Permission check error:', err.message);
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }
  };
};

/**
 * Middleware factory — requires ANY ONE of the given permissions.
 *
 * @param {Array<[string,string]>} permPairs  e.g. [['User','View user'],['Roles','View role']]
 */
const requireAnyPermission = (permPairs) => {
  return async (req, res, next) => {
    try {
      const perms = await loadUserPermissions(req);
      const hasAny = permPairs.some(([g, n]) => perms.includes(`${g}::${n}`));

      if (hasAny) return next();

      return res.status(403).json({
        success: false,
        error: 'Permission denied',
        code: 'PERMISSION_DENIED'
      });
    } catch (err) {
      console.error('Permission check error:', err.message);
      return res.status(500).json({ success: false, error: 'Permission check failed' });
    }
  };
};

/**
 * GET /api/auth/my-permissions
 * Returns all permission keys for the logged-in user, plus role
 * and an isAdmin flag the frontend can use to bypass permission-string
 * matching entirely for admin-tier users.
 * Called once on login/refresh — frontend stores this in state.
 */
const getMyPermissions = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId;
    const userResult = await pool.query(`SELECT role FROM users WHERE id = $1`, [userId]);
    const roleName = userResult.rows[0]?.role || "";
    const isAdmin = ADMIN_ROLES.includes(roleName.toLowerCase());

    const perms = await loadUserPermissions(req);
    res.json({ success: true, permissions: perms, role: roleName, isAdmin });
  } catch (err) {
    console.error('getMyPermissions error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to load permissions' });
  }
};

module.exports = { requirePermission, requireAnyPermission, getMyPermissions, loadUserPermissions };