/**
 * ============================================================
 * ROLE SERVICE (FIXED)
 * Uses 'role_name' column to match your existing DB structure
 * ============================================================
 */

const pool = require('../config/database');

// ── Get all roles ──────────────────────────────────────────
const getAllRoles = async () => {
  const result = await pool.query(
    `SELECT id, role_name AS name, description, deletable, created_at
     FROM roles
     ORDER BY id ASC`
  );
  return result.rows;
};

// ── Get single role with its permissions ──────────────────
const getRoleById = async (id) => {
  const roleResult = await pool.query(
    `SELECT id, role_name AS name, description, deletable
     FROM roles WHERE id = $1`,
    [id]
  );

  if (roleResult.rows.length === 0) return null;

  const role = roleResult.rows[0];

  // Fetch permissions assigned to this role
  const permsResult = await pool.query(
    `SELECT p.group_name, p.name
     FROM permissions p
     INNER JOIN role_permissions rp ON rp.permission_id = p.id
     WHERE rp.role_id = $1`,
    [id]
  );

  // Build permission keys in format "Group::PermissionName"
  role.permissions = permsResult.rows.map(
    (p) => `${p.group_name}::${p.name}`
  );

  return role;
};

// ── Create a new role ──────────────────────────────────────
const createRole = async (name, permissionKeys) => {
  // Check for duplicate role_name
  const existing = await pool.query(
    `SELECT id FROM roles WHERE LOWER(role_name) = LOWER($1)`,
    [name]
  );
  if (existing.rows.length > 0) {
    throw new Error('Role name already exists');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roleResult = await client.query(
      `INSERT INTO roles (role_name, deletable, created_at, updated_at)
       VALUES ($1, TRUE, NOW(), NOW()) RETURNING id, role_name AS name, deletable`,
      [name]
    );
    const roleId = roleResult.rows[0].id;

    if (permissionKeys && permissionKeys.length > 0) {
      await insertPermissions(client, roleId, permissionKeys);
    }

    await client.query('COMMIT');
    return roleResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Update an existing role ────────────────────────────────
const updateRole = async (id, name, permissionKeys) => {
  // Check duplicate name (exclude current role)
  const existing = await pool.query(
    `SELECT id FROM roles WHERE LOWER(role_name) = LOWER($1) AND id != $2`,
    [name, id]
  );
  if (existing.rows.length > 0) {
    throw new Error('Role name already exists');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const roleResult = await client.query(
      `UPDATE roles
       SET role_name = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, role_name AS name, deletable`,
      [name, id]
    );

    if (roleResult.rows.length === 0) throw new Error('Role not found');

    // Replace all permissions for this role
    await client.query(
      `DELETE FROM role_permissions WHERE role_id = $1`, [id]
    );

    if (permissionKeys && permissionKeys.length > 0) {
      await insertPermissions(client, id, permissionKeys);
    }

    await client.query('COMMIT');
    return roleResult.rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ── Delete a role ──────────────────────────────────────────
const deleteRole = async (id) => {
  const roleResult = await pool.query(
    `SELECT deletable FROM roles WHERE id = $1`, [id]
  );

  if (roleResult.rows.length === 0) throw new Error('Role not found');
  if (!roleResult.rows[0].deletable)  throw new Error('This role cannot be deleted');

  // ON DELETE CASCADE handles role_permissions automatically
  await pool.query(`DELETE FROM roles WHERE id = $1`, [id]);
  return true;
};

// ── Get all permissions grouped ────────────────────────────
const getAllPermissions = async () => {
  const result = await pool.query(
    `SELECT id, group_name, name
     FROM permissions
     ORDER BY group_name, id`
  );

  const grouped = {};
  result.rows.forEach((p) => {
    if (!grouped[p.group_name]) grouped[p.group_name] = [];
    grouped[p.group_name].push({ id: p.id, name: p.name });
  });

  return grouped;
};

// ── Helper: link permissions to a role ────────────────────
// permissionKeys = ["Others::Payment Received", "User::View user", ...]
async function insertPermissions(client, roleId, permissionKeys) {
  for (const key of permissionKeys) {
    const idx        = key.indexOf('::');
    const group_name = key.substring(0, idx);
    const name       = key.substring(idx + 2);

    const permResult = await client.query(
      `SELECT id FROM permissions WHERE group_name = $1 AND name = $2`,
      [group_name, name]
    );

    if (permResult.rows.length > 0) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_id)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [roleId, permResult.rows[0].id]
      );
    }
  }
}

module.exports = {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getAllPermissions,
};