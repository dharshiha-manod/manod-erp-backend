/**
 * ====================================================
 * AUTHENTICATION ROUTES (FIXED FOR YOUR SCHEMA)
 * ====================================================
 */

const express = require('express');
const router = express.Router();
const {
  register,
  login,
  verifyToken,
  logout,
  getUserProfile
} = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const { getMyPermissions } = require('../middleware/permission');

/**
 * Public Routes (No Authentication Required)
 */

// Register new user
router.post('/register', register);

// Login user
router.post('/login', login);

/**
 * Protected Routes (Authentication Required)
 */

// Verify token
router.post('/verify-token', authMiddleware, verifyToken);

// Get user profile
router.get('/profile', authMiddleware, getUserProfile);

// Logout
router.post('/logout', authMiddleware, logout);

// Get logged-in user's permissions (called after login by frontend)
router.get('/my-permissions', authMiddleware, getMyPermissions);

module.exports = router;