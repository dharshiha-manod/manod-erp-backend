/**
 * ============================================================
 * ROLE CONTROLLER
 * Handles HTTP requests → calls roleService → sends response
 * ============================================================
 */

const roleService = require('../services/roleService');

// GET /api/roles
const getAllRoles = async (req, res) => {
  try {
    const roles = await roleService.getAllRoles();
    res.json({ success: true, data: roles });
  } catch (err) {
    console.error('getAllRoles error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch roles' });
  }
};

// GET /api/roles/:id
const getRoleById = async (req, res) => {
  try {
    const role = await roleService.getRoleById(req.params.id);
    if (!role) return res.status(404).json({ success: false, error: 'Role not found' });
    res.json({ success: true, data: role });
  } catch (err) {
    console.error('getRoleById error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch role' });
  }
};

// POST /api/roles
const createRole = async (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Role name is required' });
    }
    const role = await roleService.createRole(name.trim(), permissions || []);
    res.status(201).json({ success: true, data: role, message: 'Role created successfully' });
  } catch (err) {
    console.error('createRole error:', err.message);
    const status = err.message === 'Role name already exists' ? 409 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// PUT /api/roles/:id
const updateRole = async (req, res) => {
  try {
    const { name, permissions } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, error: 'Role name is required' });
    }
    const role = await roleService.updateRole(req.params.id, name.trim(), permissions || []);
    res.json({ success: true, data: role, message: 'Role updated successfully' });
  } catch (err) {
    console.error('updateRole error:', err.message);
    const status = err.message === 'Role name already exists' ? 409 : 500;
    res.status(status).json({ success: false, error: err.message });
  }
};

// DELETE /api/roles/:id
const deleteRole = async (req, res) => {
  try {
    await roleService.deleteRole(req.params.id);
    res.json({ success: true, message: 'Role deleted successfully' });
  } catch (err) {
    console.error('deleteRole error:', err.message);
    const status = err.message.includes('not found') ? 404 : 400;
    res.status(status).json({ success: false, error: err.message });
  }
};

// GET /api/roles/permissions
const getAllPermissions = async (req, res) => {
  try {
    const permissions = await roleService.getAllPermissions();
    res.json({ success: true, data: permissions });
  } catch (err) {
    console.error('getAllPermissions error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch permissions' });
  }
};

module.exports = {
  getAllRoles,
  getRoleById,
  createRole,
  updateRole,
  deleteRole,
  getAllPermissions,
};