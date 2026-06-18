/**
 * ====================================================
 * USER MANAGEMENT CONTROLLER
 * Full CRUD + Reset Password
 * ====================================================
 */

const bcrypt = require('bcryptjs');
const pool = require('../config/database');

// ── GET ALL USERS ──
const getAllUsers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, full_name, phone, role, status, department, created_at, updated_at 
       FROM users 
       ORDER BY created_at DESC`
    );
    res.status(200).json({ success: true, total: result.rows.length, users: result.rows });
  } catch (err) {
    console.error('❌ Get All Users Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
};

// ── GET USER BY ID ──
const getUserById = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT id, email, full_name, phone, role, status, department, created_at, updated_at 
       FROM users WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.status(200).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('❌ Get User By ID Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch user' });
  }
};

// ── CREATE USER ──
const createUser = async (req, res) => {
  try {
    const { email, password, full_name, phone, role, department } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, error: 'Email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ success: false, error: 'Email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash, full_name, phone, role, department, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING id, email, full_name, phone, role, department, status, created_at`,
      [email, hashedPassword, full_name || null, phone || null, role || 'employee', department || null]
    );

    console.log('✅ User created:', result.rows[0].email);
    res.status(201).json({ success: true, message: 'User created successfully', user: result.rows[0] });
  } catch (err) {
    console.error('❌ Create User Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
};

// ── UPDATE USER ──
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { full_name, email, phone, role, status, department } = req.body;

    const existing = await pool.query('SELECT id FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (email) {
      const emailCheck = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND id != $2',
        [email, id]
      );
      if (emailCheck.rows.length > 0) {
        return res.status(400).json({ success: false, error: 'Email already in use' });
      }
    }

    const result = await pool.query(
      `UPDATE users 
       SET full_name = COALESCE($1, full_name),
           email = COALESCE($2, email),
           phone = COALESCE($3, phone),
           role = COALESCE($4, role),
           status = COALESCE($5, status),
           department = COALESCE($6, department)
       WHERE id = $7
       RETURNING id, email, full_name, phone, role, status, department`,
      [full_name, email, phone, role, status, department, id]
    );

    console.log('✅ User updated:', result.rows[0].email);
    res.status(200).json({ success: true, message: 'User updated successfully', user: result.rows[0] });
  } catch (err) {
    console.error('❌ Update User Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
};

// ── DELETE USER ──
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    if (req.user.id === id) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, email, full_name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    console.log('✅ User deleted:', result.rows[0].email);
    res.status(200).json({ success: true, message: 'User deleted successfully', user: result.rows[0] });
  } catch (err) {
    console.error('❌ Delete User Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
};

// ── GET MY PROFILE ──
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT id, email, full_name, phone, role, status, department, created_at, updated_at 
       FROM users WHERE id = $1`,
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }
    res.status(200).json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error('❌ Get Profile Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to fetch profile' });
  }
};

// ── CHANGE OWN PASSWORD ──
const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ success: false, error: 'All fields are required' });
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, error: 'New passwords do not match' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const userResult = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const validPassword = await bcrypt.compare(currentPassword, userResult.rows[0].password_hash);
    if (!validPassword) {
      return res.status(401).json({ success: false, error: 'Current password is incorrect' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, userId]);

    res.status(200).json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    console.error('❌ Change Password Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to change password' });
  }
};

// ── ADMIN RESET USER PASSWORD ──
const resetUserPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, error: 'Password must be at least 6 characters' });
    }

    const existing = await pool.query('SELECT id, email FROM users WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [hashedPassword, id]);

    console.log('✅ Password reset for:', existing.rows[0].email);
    res.status(200).json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    console.error('❌ Reset Password Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to reset password' });
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  getProfile,
  changePassword,
  resetUserPassword,
};