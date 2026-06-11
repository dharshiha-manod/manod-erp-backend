/**
 * ====================================================
 * AUTHENTICATION ROUTES
 * /api/auth endpoints
 * ====================================================
 */

const express = require('express');
const { register, login, verifyToken, logout } = require('../controllers/authController');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// ── PUBLIC ROUTES ──

/**
 * @route   POST /api/auth/register
 * @desc    Register new user
 * @access  Public
 * @body    { name, email, password, phone }
 */
router.post('/register', register);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 * @body    { email, password }
 */
router.post('/login', login);

// ── PROTECTED ROUTES ──

/**
 * @route   GET /api/auth/verify
 * @desc    Verify JWT token
 * @access  Private
 * @header  Authorization: Bearer <token>
 */
router.get('/verify', authenticateToken, verifyToken);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authenticateToken, logout);

module.exports = router;