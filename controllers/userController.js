/**
 * ====================================================
 * USER MANAGEMENT CONTROLLER
 * Full CRUD + Reset Password
 * ====================================================
 */
const bcrypt = require('bcryptjs');
const pool = require('../config/database');
const { logActivity } = require('../services/activityLogService');

// Module-level so every function below can see it
const SELECT_FIELDS = `
  id, email, full_name, phone, role, status, department, created_at, updated_at,
  designation, basic_salary, salary_period, dob, gender, marital_status,
  permanent_address, current_address,
  account_holder, account_number, bank_name, bank_code, branch,
  sales_commission_pct, max_discount_pct
`;

// ── GET ALL USERS ──
const getAllUsers = async (req, res) => {
  try {
    const industryId = req.industryId;
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS} FROM users WHERE industry_id = $1 ORDER BY created_at DESC`,
      [industryId]
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
    const industryId = req.industryId;
    const result = await pool.query(
      `SELECT ${SELECT_FIELDS} FROM users WHERE id = $1 AND industry_id = $2`,
      [id, industryId]
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
    const {
      email, password, full_name, phone, role, department,
      designation, basic_salary, salary_period,
      dob, gender, marital_status,
      permanent_address, current_address,
      account_holder, account_number, bank_name, bank_code, branch,
      sales_commission_pct, max_discount_pct,
    } = req.body;

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

  const industryId = req.industryId;

    if (role) {
      const roleCheck = await pool.query('SELECT id FROM roles WHERE LOWER(role_name) = LOWER($1) AND industry_id = $2', [role, industryId]);
      if (roleCheck.rows.length === 0) {
        return res.status(400).json({ success: false, error: `Role "${role}" does not exist. Please create it first under Roles.` });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (
         email, password_hash, full_name, phone, role, department, status,
         designation, basic_salary, salary_period,
         dob, gender, marital_status,
         permanent_address, current_address,
         account_holder, account_number, bank_name, bank_code, branch,
         sales_commission_pct, max_discount_pct, industry_id
       )
       VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       RETURNING ${SELECT_FIELDS}`,
      [
        email, hashedPassword, full_name || null, phone || null, (role || 'employee').trim(), department || null,
        designation || null, basic_salary || null, salary_period || 'Per Month',
        dob || null, gender || null, marital_status || null,
        permanent_address || null, current_address || null,
        account_holder || null, account_number || null, bank_name || null, bank_code || null, branch || null,
        sales_commission_pct || null, max_discount_pct || null, industryId,
      ]
    );

    console.log('✅ User created:', result.rows[0].email);
    logActivity({ userId: req.user?.id || null, module: 'Users', action: `Created User ${result.rows[0].email}`, detail: `Role: ${result.rows[0].role}`, req });
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
    const industryId = req.industryId;
    const {
      full_name, email, phone, role, status, department,
      designation, basic_salary, salary_period,
      dob, gender, marital_status,
      permanent_address, current_address,
      account_holder, account_number, bank_name, bank_code, branch,
      sales_commission_pct, max_discount_pct,
    } = req.body;

    const existing = await pool.query('SELECT id FROM users WHERE id = $1 AND industry_id = $2', [id, industryId]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'User not found' });
    }

    if (role) {
      const roleCheck = await pool.query('SELECT id FROM roles WHERE LOWER(role_name) = LOWER($1) AND industry_id = $2', [role, industryId]);
      if (roleCheck.rows.length === 0) {
        return res.status(400).json({ success: false, error: `Role "${role}" does not exist. Please create it first under Roles.` });
      }
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
           department = COALESCE($6, department),
           designation = COALESCE($7, designation),
           basic_salary = COALESCE($8, basic_salary),
           salary_period = COALESCE($9, salary_period),
           dob = COALESCE($10, dob),
           gender = COALESCE($11, gender),
           marital_status = COALESCE($12, marital_status),
           permanent_address = COALESCE($13, permanent_address),
           current_address = COALESCE($14, current_address),
           account_holder = COALESCE($15, account_holder),
           account_number = COALESCE($16, account_number),
           bank_name = COALESCE($17, bank_name),
           bank_code = COALESCE($18, bank_code),
           branch = COALESCE($19, branch),
           sales_commission_pct = COALESCE($20, sales_commission_pct),
           max_discount_pct = COALESCE($21, max_discount_pct)
       WHERE id = $22 AND industry_id = $23
       RETURNING ${SELECT_FIELDS}`,
      [
        full_name, email, phone, role, status, department,
        designation, basic_salary, salary_period,
        dob, gender, marital_status,
        permanent_address, current_address,
        account_holder, account_number, bank_name, bank_code, branch,
        sales_commission_pct, max_discount_pct,
        id, industryId,
      ]
    );

    console.log('✅ User updated:', result.rows[0].email);
    logActivity({ userId: req.user?.id || null, module: 'Users', action: `Updated User ${result.rows[0].email}`, detail: `Role: ${result.rows[0].role}, Status: ${result.rows[0].status}`, req });
    res.status(200).json({ success: true, message: 'User updated successfully', user: result.rows[0] });
  } catch (err) {
    console.error('❌ Update User Error:', err.message);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
};

// ── DELETE USER (soft delete — preserves message/sales/log history) ──
const deleteUser = async (req, res) => {
  try {
    const { id } = req.params;
    const industryId = req.industryId;

    if (req.user.id === id) {
      return res.status(400).json({ success: false, error: 'Cannot delete your own account' });
    }

    try {
      const result = await pool.query(
        'DELETE FROM users WHERE id = $1 AND industry_id = $2 RETURNING id, email, full_name',
        [id, industryId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      console.log('✅ User deleted:', result.rows[0].email);
      logActivity({ userId: req.user?.id || null, module: 'Users', action: `Deleted User ${result.rows[0].email}`, req });
      return res.status(200).json({ success: true, message: 'User deleted successfully', user: result.rows[0] });
    } catch (fkErr) {
      if (fkErr.code !== '23503') throw fkErr;

      const result = await pool.query(
        `UPDATE users SET status = 'inactive' WHERE id = $1 AND industry_id = $2
         RETURNING id, email, full_name, status`,
        [id, industryId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }
      console.log('⚠️ User has related records — deactivated instead:', result.rows[0].email);
      logActivity({ userId: req.user?.id || null, module: 'Users', action: `Deactivated User ${result.rows[0].email} (has related records)`, req });
      return res.status(200).json({
        success: true,
        softDeleted: true,
        message: 'This user has existing messages/records, so they were deactivated instead of deleted (their history is preserved).',
        user: result.rows[0],
      });
    }
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
      `SELECT ${SELECT_FIELDS} FROM users WHERE id = $1`,
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
    logActivity({ userId: req.user?.id || null, module: 'Users', action: `Reset Password for ${existing.rows[0].email}`, req });
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