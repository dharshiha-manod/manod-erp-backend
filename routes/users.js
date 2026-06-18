/**
 * ====================================================
 * USER MANAGEMENT ROUTES
 * /api/users endpoints
 * ====================================================
 */

const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
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
router.get('/', authenticateToken, getAllUsers);

// ── GET /api/users/profile ── Get my profile (must be before /:id)
router.get('/profile', authenticateToken, getProfile);

// ── GET /api/users/:id ── Get user by ID
router.get('/:id', authenticateToken, getUserById);

// ── POST /api/users ── Create new user
router.post('/', authenticateToken, createUser);

// ── PUT /api/users/:id ── Update user
router.put('/:id', authenticateToken, updateUser);

// ── DELETE /api/users/:id ── Delete user
router.delete('/:id', authenticateToken, deleteUser);

// ── POST /api/users/change-password ── Change own password
router.post('/change-password', authenticateToken, changePassword);

// ── PUT /api/users/:id/reset-password ── Admin reset user password
router.put('/:id/reset-password', authenticateToken, resetUserPassword);

module.exports = router;