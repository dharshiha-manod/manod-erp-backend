/**
 * ====================================================
 * USER ROUTES
 * /api/users endpoints
 * ====================================================
 */

const express = require('express');
const { 
  getProfile, 
  updateProfile, 
  changePassword,
  getAllUsers,
  deleteUser 
} = require('../controllers/userController');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// ── PROTECTED ROUTES (All require authentication) ──

/**
 * @route   GET /api/users/profile
 * @desc    Get current user profile
 * @access  Private
 * @header  Authorization: Bearer <token>
 */
router.get('/profile', authenticateToken, getProfile);

/**
 * @route   PUT /api/users/profile
 * @desc    Update current user profile
 * @access  Private
 * @body    { name, email, phone, address }
 */
router.put('/profile', authenticateToken, updateProfile);

/**
 * @route   POST /api/users/change-password
 * @desc    Change user password
 * @access  Private
 * @body    { currentPassword, newPassword, confirmPassword }
 */
router.post('/change-password', authenticateToken, changePassword);

/**
 * @route   GET /api/users
 * @desc    Get all users (Admin only)
 * @access  Private (Admin)
 */
router.get('/', authenticateToken, getAllUsers);

/**
 * @route   DELETE /api/users/:id
 * @desc    Delete user (Admin only)
 * @access  Private (Admin)
 */
router.delete('/:id', authenticateToken, deleteUser);

module.exports = router;