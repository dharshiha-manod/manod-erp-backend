/**
 * ====================================================
 * SIMPLE AUTHENTICATION (NO OTP - DIRECT LOGIN)
 * Register → Save to DB → Login immediately
 * Uses Supabase built-in auth columns: full_name, not name
 * ====================================================
 */

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// ── REGISTER NEW USER ──
const register = async (req, res) => {
  try {
    console.log('📝 Register Request:', req.body);
    
    const { email, password, name, phone } = req.body;

    // ── VALIDATION ──
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and password are required' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        success: false,
        error: 'Password must be at least 6 characters' 
      });
    }

    // Check if email already exists
    const userExists = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userExists.rows.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Email already registered' 
      });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Insert user into database using Supabase column names
    const result = await pool.query(
  `INSERT INTO users 
   (email, password_hash, full_name, phone) 
   VALUES ($1, $2, $3, $4)
   RETURNING id, email, full_name, phone`,
  [email, hashedPassword, name || null, phone || null]
);

    const newUser = result.rows[0];

    console.log('✅ User registered successfully:', newUser.email);

    res.status(201).json({
      success: true,
      message: 'Registration successful! You can now login.',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.full_name
      }
    });

  } catch (err) {
    console.error('❌ Register Error:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Registration failed',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ── LOGIN USER ──
const login = async (req, res) => {
  try {
    console.log('🔐 Login Request:', { email: req.body.email });
    
    const { email, password } = req.body;

    // ── VALIDATION ──
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Email and password are required' 
      });
    }

    // Find user by email
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      console.log('❌ User not found:', email);
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password'
      });
    }

    const user = result.rows[0];
    console.log('👤 User found:', user.id);

    // Verify password - use encrypted_password column from Supabase
   const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      console.log('❌ Wrong password');
      return res.status(401).json({ 
        success: false,
        error: 'Invalid email or password'
      });
    }

    console.log('✅ Password verified');

    // Create JWT token
    const token = jwt.sign(
      { 
        id: user.id, 
        email: user.email,
        name: user.full_name
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('🎫 Token created for user:', user.id);

    // Return success
    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        phone: user.phone
      }
    });

  } catch (err) {
    console.error('❌ Login Error:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Login failed',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
};

// ── GET USER PROFILE ──
const getUserProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const result = await pool.query(
      'SELECT id, email, full_name, phone FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        error: 'User not found' 
      });
    }

    res.status(200).json({
      success: true,
      user: {
        id: result.rows[0].id,
        email: result.rows[0].email,
        name: result.rows[0].full_name,
        phone: result.rows[0].phone
      }
    });

  } catch (err) {
    console.error('❌ Get profile error:', err.message);
    res.status(500).json({ 
      success: false,
      error: 'Failed to get user profile' 
    });
  }
};

// ── VERIFY TOKEN ──
const verifyToken = (req, res) => {
  try {
    console.log('✅ Token verified for user:', req.user.id);
    res.status(200).json({
      success: true,
      message: 'Token is valid',
      user: req.user
    });
  } catch (err) {
    console.error('❌ Token verification error:', err.message);
    res.status(401).json({ 
      success: false,
      error: 'Invalid token' 
    });
  }
};

// ── LOGOUT ──
const logout = (req, res) => {
  console.log('👋 User logged out:', req.user.email);
  res.status(200).json({ 
    success: true,
    message: 'Logged out successfully' 
  });
};

module.exports = {
  register,
  login,
  getUserProfile,
  verifyToken,
  logout
};