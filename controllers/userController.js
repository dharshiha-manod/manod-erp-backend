/**
 * ====================================================
 * USER CONTROLLER
 * User Profile Management
 * ====================================================
 */

const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

// ── GET USER PROFILE ──
const getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT id, name, email, phone, role, status, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Get Profile Error:', err);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
};

// ── UPDATE USER PROFILE ──
const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email, phone, address } = req.body;

    // Validate input
    if (!name || !email) {
      return res.status(400).json({ 
        error: 'Name and email are required' 
      });
    }

    // Check if email is already used by another user
    const emailCheck = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, userId]
    );

    if (emailCheck.rows.length > 0) {
      return res.status(400).json({ 
        error: 'Email is already in use' 
      });
    }

    // Update user
    const result = await pool.query(
      'UPDATE users SET name = $1, email = $2, phone = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING id, name, email, phone, role, status, updated_at',
      [name, email, phone || null, userId]
    );

    res.status(200).json({
      message: 'Profile updated successfully',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('❌ Update Profile Error:', err);
    res.status(500).json({ error: 'Failed to update profile' });
  }
};

// ── CHANGE PASSWORD ──
const changePassword = async (req, res) => {
  try {
    const userId = req.user.id;
    const { currentPassword, newPassword, confirmPassword } = req.body;

    // ── VALIDATION ──
    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        error: 'All password fields are required' 
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        error: 'New passwords do not match' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        error: 'New password must be at least 6 characters' 
      });
    }

    // Get current user password
    const userResult = await pool.query(
      'SELECT password FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const validPassword = await bcrypt.compare(
      currentPassword,
      userResult.rows[0].password
    );

    if (!validPassword) {
      return res.status(401).json({ 
        error: 'Current password is incorrect' 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedPassword, userId]
    );

    res.status(200).json({ 
      message: 'Password changed successfully' 
    });
  } catch (err) {
    console.error('❌ Change Password Error:', err);
    res.status(500).json({ error: 'Failed to change password' });
  }
};

// ── GET ALL USERS (Admin only) ──
const getAllUsers = async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Only admins can view all users' 
      });
    }

    const result = await pool.query(
      'SELECT id, name, email, phone, role, status, created_at FROM users ORDER BY created_at DESC'
    );

    res.status(200).json({
      total: result.rows.length,
      users: result.rows
    });
  } catch (err) {
    console.error('❌ Get All Users Error:', err);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
};

// ── DELETE USER (Admin only) ──
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user is admin
    if (req.user.role !== 'admin') {
      return res.status(403).json({ 
        error: 'Only admins can delete users' 
      });
    }

    // Prevent deleting self
    if (req.user.id === parseInt(id)) {
      return res.status(400).json({ 
        error: 'Cannot delete your own account' 
      });
    }

    const result = await pool.query(
      'DELETE FROM users WHERE id = $1 RETURNING id, name, email',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.status(200).json({
      message: 'User deleted successfully',
      user: result.rows[0]
    });
  } catch (err) {
    console.error('❌ Delete User Error:', err);
    res.status(500).json({ error: 'Failed to delete user' });
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changePassword,
  getAllUsers,
  deleteUser
};