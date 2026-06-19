/**
 * ====================================================
 * USER MANAGEMENT ROUTES
 * /api/users endpoints
 * ====================================================
 */

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const { requirePermission } = require('../middleware/permission');
const {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getProfile,
  changePassword,
  resetUserPassword,
} = require('../controllers/userController');

// ── GET /api/users ── Get all users
router.get('/', authenticateToken, requirePermission('User', 'View user'), getAllUsers);

// ── GET /api/users/profile ── Get my profile (must be before /:id)
router.get('/profile', authenticateToken, getProfile);

// ── GET /api/users/:id ── Get user by ID
router.get('/:id', authenticateToken, requirePermission('User', 'View user'), getUserById);

// ── POST /api/users ── Create new user
router.post('/', authenticateToken, requirePermission('User', 'Add user'), createUser);

// ── PUT /api/users/:id ── Update user
router.put('/:id', authenticateToken, requirePermission('User', 'Edit user'), updateUser);

// ── DELETE /api/users/:id ── Delete user
router.delete('/:id', authenticateToken, requirePermission('User', 'Delete user'), deleteUser);

// ── POST /api/users/change-password ── Change own password (no permission check, any user can change own password)
router.post('/change-password', authenticateToken, changePassword);

// ── PUT /api/users/:id/reset-password ── Admin reset user password
router.put('/:id/reset-password', authenticateToken, requirePermission('User', 'Edit user'), resetUserPassword);

module.exports = router;