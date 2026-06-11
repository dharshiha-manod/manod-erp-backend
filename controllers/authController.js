/**
 * ====================================================
 * AUTHENTICATION CONTROLLER
 * Register, Login, Logout Logic
 * ====================================================
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// ── REGISTER NEW USER ──
const register = async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    // ── VALIDATION ──
    if (!name || !email || !password) {
      return res.status(400).json({ 
        error: 'Name, email, and password are required' 
      });
    }

    // Check if user already exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({ 
        error: 'User with this email already exists' 
      });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into database
    const result = await pool.query(
      'INSERT INTO users (name, email, password, phone, role) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, email, phone, role, created_at',
      [name, email, hashedPassword, phone || null, 'user']
    );

    const newUser = result.rows[0];

    res.status(201).json({
      message: 'User registered successfully',
      user: newUser
    });
  } catch (err) {
    console.error('❌ Register Error:', err);
    res.status(500).json({ error: 'Failed to register user' });
  }
};

// ── LOGIN USER ──
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // ── VALIDATION ──
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'Email and password are required' 
      });
    }

    // Find user by email
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.status !== 'active') {
      return res.status(403).json({ 
        error: 'User account is inactive',
        code: 'ACCOUNT_INACTIVE'
      });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ 
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
    }

    // Create JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email, 
        role: user.role,
        name: user.name
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );

    // Return success response
    res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        status: user.status
      }
    });
  } catch (err) {
    console.error('❌ Login Error:', err);
    res.status(500).json({ error: 'Failed to login' });
  }
};

// ── VERIFY TOKEN (optional endpoint) ──
const verifyToken = (req, res) => {
  try {
    res.status(200).json({
      message: 'Token is valid',
      user: req.user
    });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ── LOGOUT (optional - mainly for frontend) ──
const logout = (req, res) => {
  // Logout is typically handled on frontend by removing token
  res.status(200).json({ message: 'Logged out successfully' });
};

module.exports = {
  register,
  login,
  verifyToken,
  logout
};